import {
  directionKey,
  directionName,
  mergeDirections,
  movedDirections,
  type MoveNotesRequest,
} from "../shared/directions";
import { summarize, type Note, type NoteSummary } from "../shared/note";
import {
  assertWriteAccess,
  github,
  HttpError,
  type Env,
  type Identity,
} from "./app";
import { readRepositoryJson } from "./profile";
import { layoutEntries } from "./layout";

export async function moveNotes(
  env: Env,
  user: Identity,
  value: unknown,
  fetcher: typeof fetch = fetch,
): Promise<{ notes: NoteSummary[]; commitUrl: string }> {
  const input = value as MoveNotesRequest;
  if (
    !input ||
    !Array.isArray(input.notes) ||
    !input.notes.length ||
    input.notes.length > 30 ||
    input.notes.some(
      (n) =>
        !n ||
        !/^note-[a-f0-9-]{36}$/.test(n.id) ||
        typeof n.revision !== "string",
    ) ||
    new Set(input.notes.map((n) => n.id)).size !== input.notes.length ||
    (input.source !== null && typeof input.source !== "string")
  )
    throw new HttpError(400, "请选择有效的笔记和研究方向。");
  let target: string;
  try {
    target = directionName(input.target);
    if (input.source !== null) directionName(input.source);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  await assertWriteAccess(env, user, fetcher);
  const root = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
    branch = encodeURIComponent(env.GITHUB_BRANCH || "main");
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await github<any>(
      env,
      `${root}/git/ref/heads/${branch}`,
      user.token,
      {},
      fetcher,
    );
    const ref = head.object.sha;
    const [commit, index, catalog] = await Promise.all([
      github<any>(env, `${root}/git/commits/${ref}`, user.token, {}, fetcher),
      readRepositoryJson<{ version?: number; notes: NoteSummary[] }>(
        env,
        user,
        "data/library.json",
        ref,
        { notes: [] },
        fetcher,
      ),
      readRepositoryJson<{ directions: string[] }>(
        env,
        user,
        "data/directions.json",
        ref,
        { directions: [] },
        fetcher,
      ),
    ]);
    const canonical = mergeDirections(
      catalog.directions || [],
      index.notes.flatMap((n) => n.tags),
    ).find((n) => directionKey(n) === directionKey(target));
    if (!canonical)
      throw new HttpError(400, "目标方向不存在，请先创建研究方向。");
    const changed: Note[] = [];
    for (const entry of input.notes) {
      const previous = index.notes.find((n) => n.id === entry.id);
      if (!previous || previous.revision !== entry.revision)
        throw new HttpError(409, "笔记已有更新，请刷新后再移动。");
      if (
        input.source !== null &&
        !previous.tags.some(
          (t) => directionKey(t) === directionKey(input.source!),
        )
      )
        throw new HttpError(409, "笔记已不在原方向，请刷新后再移动。");
      const note = await readRepositoryJson<Note | null>(
        env,
        user,
        `data/notes/${entry.id}.json`,
        ref,
        null,
        fetcher,
      );
      if (!note || note.revision !== previous.revision)
        throw new HttpError(409, "笔记内容与目录不一致，请刷新后再试。");
      let tags: string[];
      try {
        tags = movedDirections(note.tags, input.source, canonical);
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
      if (JSON.stringify(tags) === JSON.stringify(note.tags)) continue;
      changed.push({
        ...note,
        tags,
        revision: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      });
    }
    if (!changed.length)
      return {
        notes: index.notes,
        commitUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commit/${ref}`,
      };
    const byId = new Map(changed.map((n) => [n.id, summarize(n)]));
    const notes = index.notes.map((n) => byId.get(n.id) || n);
    const treeEntries = [
      {
        path: "data/library.json",
        mode: "100644",
        type: "blob",
        content: JSON.stringify({ ...index, version: 1, notes }, null, 2),
      },
      ...changed.map((n) => ({
        path: `data/notes/${n.id}.json`,
        mode: "100644",
        type: "blob",
        content: JSON.stringify(n, null, 2),
      })),
      ...(await layoutEntries(
        env,
        user,
        ref,
        commit.tree.sha,
        index.notes,
        notes,
        changed,
        fetcher,
      )),
    ];
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
    const next = await github<any>(
      env,
      `${root}/git/commits`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({
          message: `docs: move ${changed.length} reading notes to ${canonical}`,
          tree: tree.sha,
          parents: [ref],
        }),
      },
      fetcher,
    );
    try {
      await github(
        env,
        `${root}/git/refs/heads/${branch}`,
        user.token,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: next.sha, force: false }),
        },
        fetcher,
      );
      return {
        notes,
        commitUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commit/${next.sha}`,
      };
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 409 || attempt === 2)
        throw e;
    }
  }
  throw new HttpError(409, "仓库正在更新，请稍后重试移动。");
}
