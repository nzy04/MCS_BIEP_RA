import type { Note, NoteSummary, Session } from "../shared/note";
import { layoutEntries, type TreeEntry } from "./layout";
import { ownsNote } from "../shared/papers";
import {
  assertWriteAccess,
  github,
  HttpError,
  type Env,
  type Identity,
} from "./app";

interface AuthorProfile {
  id: number;
  login: string;
  nickname: string;
  githubName: string;
  updatedAt: string;
}

export async function readRepositoryJson<T>(
  env: Env,
  user: Identity,
  path: string,
  ref: string,
  fallback: T,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  try {
    const endpoint = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const file = await github<{
      content?: string;
      encoding?: string;
      size?: number;
    }>(env, endpoint, user.token, {}, fetcher);
    if ((file.size || 0) > 8 * 1024 * 1024)
      throw new HttpError(
        413,
        "单份目录数据已超过 8 MB，请联系维护者拆分目录后再修改。",
      );
    if (!file.content && file.encoding === "none") {
      return await github<T>(
        env,
        endpoint,
        user.token,
        { headers: { Accept: "application/vnd.github.raw+json" } },
        fetcher,
      );
    }
    if (!file.content)
      throw new HttpError(502, "仓库数据内容无法读取，本次修改未保存。");
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(file.content.replace(/\s/g, "")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return fallback;
    throw error;
  }
}

export async function profileSession(
  env: Env,
  user: Identity,
  ref = env.GITHUB_BRANCH || "main",
  fetcher: typeof fetch = fetch,
): Promise<Session> {
  const profile = await readRepositoryJson<AuthorProfile | null>(
    env,
    user,
    `data/authors/${user.id}.json`,
    ref,
    null,
    fetcher,
  );
  const githubName = user.githubName || user.name || user.login;
  return {
    id: user.id,
    login: user.login,
    name: profile?.nickname || githubName,
    githubName,
    nickname: profile?.nickname || "",
    avatar: user.avatar,
    canWrite: user.canWrite,
  };
}

async function readOwnedNotes(
  env: Env,
  user: Identity,
  owned: NoteSummary[],
  ref: string,
  fetcher: typeof fetch,
): Promise<Note[]> {
  if (owned.length <= 20) {
    const notes = await Promise.all(
      owned.map((n) =>
        readRepositoryJson<Note | null>(
          env,
          user,
          `data/notes/${n.id}.json`,
          ref,
          null,
          fetcher,
        ),
      ),
    );
    if (notes.some((n) => !n))
      throw new HttpError(
        409,
        "有一篇历史笔记暂时无法读取，昵称尚未修改，请稍后重试。",
      );
    return notes as Note[];
  }
  const notes: Note[] = [];
  for (let offset = 0; offset < owned.length; offset += 25) {
    const batch = owned.slice(offset, offset + 25);
    const fields = batch
      .map(
        (n, i) =>
          `n${i}: object(expression: ${JSON.stringify(`${ref}:data/notes/${n.id}.json`)}) { ... on Blob { text } }`,
      )
      .join("\n");
    const query = `{ repository(owner: ${JSON.stringify(env.GITHUB_OWNER)}, name: ${JSON.stringify(env.GITHUB_REPO)}) { ${fields} } }`;
    const result = await github<{
      data?: { repository?: Record<string, { text?: string }> };
      errors?: unknown[];
    }>(
      env,
      "/graphql",
      user.token,
      { method: "POST", body: JSON.stringify({ query }) },
      fetcher,
    );
    if (result.errors?.length || !result.data?.repository)
      throw new HttpError(
        409,
        "历史笔记批量读取失败，昵称尚未修改，请稍后重试。",
      );
    for (let i = 0; i < batch.length; i++) {
      const text = result.data.repository[`n${i}`]?.text;
      if (!text)
        throw new HttpError(409, "有一篇历史笔记暂时无法读取，昵称尚未修改。");
      const note = JSON.parse(text) as Note;
      if (note.id !== batch[i].id || !ownsNote(note, user))
        throw new HttpError(409, "历史笔记归属与目录不一致，昵称尚未修改。");
      notes.push(note);
    }
  }
  return notes;
}

export async function updateProfile(
  env: Env,
  user: Identity,
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<{ user: Session; notes: NoteSummary[] }> {
  if (typeof input !== "string") throw new HttpError(400, "昵称格式不正确。");
  const nickname = input.normalize("NFKC").trim();
  if (nickname.length > 40 || /[\p{Cc}\p{Cf}<>]/u.test(nickname))
    throw new HttpError(
      400,
      "昵称最多 40 字，不能包含换行、控制字符或尖括号。",
    );
  await assertWriteAccess(env, user, fetcher);
  const root = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const branch = env.GITHUB_BRANCH || "main";
  const githubName = user.githubName || user.name || user.login;
  const name = nickname || githubName;
  const profile: AuthorProfile = {
    id: user.id,
    login: user.login,
    nickname,
    githubName,
    updatedAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await github<any>(
      env,
      `${root}/git/ref/heads/${encodeURIComponent(branch)}`,
      user.token,
      {},
      fetcher,
    );
    const commit = await github<any>(
      env,
      `${root}/git/commits/${head.object.sha}`,
      user.token,
      {},
      fetcher,
    );
    const index = await readRepositoryJson<{
      version?: number;
      notes: NoteSummary[];
    }>(env, user, "data/library.json", head.object.sha, { notes: [] }, fetcher);
    const owned = index.notes.filter((n) => ownsNote(n, user));
    const notes = index.notes.map((n) =>
      ownsNote(n, user)
        ? { ...n, author: name, authorId: user.id, authorLogin: user.login }
        : n,
    );
    const files = [
      {
        path: `data/authors/${user.id}.json`,
        content: JSON.stringify(profile, null, 2),
      },
      {
        path: "data/library.json",
        content: JSON.stringify(
          { ...index, version: index.version || 1, notes },
          null,
          2,
        ),
      },
    ];
    const changed: Note[] = [];
    // Read from the same immutable head as the index; never commit a partial rename.
    for (const previous of await readOwnedNotes(
      env,
      user,
      owned,
      head.object.sha,
      fetcher,
    )) {
      const note = {
        ...previous,
        author: name,
        authorId: user.id,
        authorLogin: user.login,
      };
      changed.push(note);
      files.push({
        path: `data/notes/${previous.id}.json`,
        content: JSON.stringify(note, null, 2),
      });
    }
    // Git Trees accepts UTF-8 contents directly, avoiding two extra blob requests per historical note.
    const treeEntries: TreeEntry[] = files.map((file) => ({
      path: file.path,
      mode: "100644",
      type: "blob",
      content: file.content,
    }));
    treeEntries.push(
      ...(await layoutEntries(
        env,
        user,
        head.object.sha,
        commit.tree.sha,
        index.notes,
        notes,
        changed,
        fetcher,
      )),
    );
    const tree = await github<any>(
      env,
      `${root}/git/trees`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeEntries }),
      },
      fetcher,
    );
    const nextCommit = await github<any>(
      env,
      `${root}/git/commits`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({
          message: `docs: update contributor name for ${user.login}`,
          tree: tree.sha,
          parents: [head.object.sha],
        }),
      },
      fetcher,
    );
    try {
      await github(
        env,
        `${root}/git/refs/heads/${encodeURIComponent(branch)}`,
        user.token,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: nextCommit.sha, force: false }),
        },
        fetcher,
      );
      return {
        user: {
          id: user.id,
          login: user.login,
          name,
          githubName,
          nickname,
          avatar: user.avatar,
          canWrite: user.canWrite,
        },
        notes,
      };
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        error.status !== 409 ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new HttpError(409, "仓库正在更新，昵称尚未修改，请稍后重试。");
}
