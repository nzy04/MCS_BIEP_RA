import type { Note, NoteSummary, Session } from "../shared/note";
import { toMarkdown } from "../shared/note";
import { ownsNote } from "../shared/papers";
import { assertWriteAccess, github, HttpError, type Env, type Identity } from "./app";

interface AuthorProfile {
  id: number;
  login: string;
  nickname: string;
  githubName: string;
  updatedAt: string;
}

export async function readRepositoryJson<T>(env: Env, user: Identity, path: string, ref: string, fallback: T, fetcher: typeof fetch = fetch): Promise<T> {
  try {
    const file = await github<{ content?: string }>(env,
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      user.token, {}, fetcher);
    if (!file.content) throw new HttpError(413, "仓库数据文件过大，无法读取。");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g, "")), c => c.charCodeAt(0))));
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return fallback;
    throw error;
  }
}

export async function profileSession(env: Env, user: Identity, ref = env.GITHUB_BRANCH || "main", fetcher: typeof fetch = fetch): Promise<Session> {
  const profile = await readRepositoryJson<AuthorProfile | null>(env, user, `data/authors/${user.id}.json`, ref, null, fetcher);
  const githubName = user.githubName || user.name || user.login;
  return { id: user.id, login: user.login, name: profile?.nickname || githubName,
    githubName, nickname: profile?.nickname || "", avatar: user.avatar, canWrite: user.canWrite };
}

export async function updateProfile(env: Env, user: Identity, input: unknown, fetcher: typeof fetch = fetch): Promise<{ user: Session; notes: NoteSummary[] }> {
  if (typeof input !== "string") throw new HttpError(400, "昵称格式不正确。");
  const nickname = input.normalize("NFKC").trim();
  if (nickname.length > 40 || /[\p{Cc}\p{Cf}<>]/u.test(nickname)) throw new HttpError(400, "昵称最多 40 字，不能包含换行、控制字符或尖括号。");
  await assertWriteAccess(env, user, fetcher);
  const root = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const branch = env.GITHUB_BRANCH || "main";
  const githubName = user.githubName || user.name || user.login;
  const name = nickname || githubName;
  const profile: AuthorProfile = { id: user.id, login: user.login, nickname, githubName, updatedAt: new Date().toISOString() };
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await github<any>(env, `${root}/git/ref/heads/${encodeURIComponent(branch)}`, user.token, {}, fetcher);
    const commit = await github<any>(env, `${root}/git/commits/${head.object.sha}`, user.token, {}, fetcher);
    const index = await readRepositoryJson<{ version?: number; notes: NoteSummary[] }>(env, user, "data/library.json", head.object.sha, { notes: [] }, fetcher);
    const owned = index.notes.filter(n => ownsNote(n, user));
    const notes = index.notes.map(n => ownsNote(n, user) ? { ...n, author: name, authorId: user.id, authorLogin: user.login } : n);
    const files = [
      { path: `data/authors/${user.id}.json`, content: JSON.stringify(profile, null, 2) },
      { path: "data/library.json", content: JSON.stringify({ ...index, version: index.version || 1, notes }, null, 2) },
    ];
    // Read from the same immutable head as the index; never commit a partial rename.
    for (const entry of owned) {
      const previous = await readRepositoryJson<Note | null>(env, user, `data/notes/${entry.id}.json`, head.object.sha, null, fetcher);
      if (!previous) throw new HttpError(409, "有一篇历史笔记暂时无法读取，昵称尚未修改，请稍后重试。");
      const note = { ...previous, author: name, authorId: user.id, authorLogin: user.login };
      files.push({ path: `data/notes/${entry.id}.json`, content: JSON.stringify(note, null, 2) },
        { path: `papers/${entry.id}.md`, content: toMarkdown(note) });
    }
    // Git Trees accepts UTF-8 contents directly, avoiding two extra blob requests per historical note.
    const treeEntries = files.map(file => ({ path: file.path, mode: "100644", type: "blob", content: file.content }));
    const tree = await github<any>(env, `${root}/git/trees`, user.token, { method: "POST", body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeEntries }) }, fetcher);
    const nextCommit = await github<any>(env, `${root}/git/commits`, user.token, { method: "POST", body: JSON.stringify({ message: `docs: update contributor name for ${user.login}`, tree: tree.sha, parents: [head.object.sha] }) }, fetcher);
    try {
      await github(env, `${root}/git/refs/heads/${encodeURIComponent(branch)}`, user.token, { method: "PATCH", body: JSON.stringify({ sha: nextCommit.sha, force: false }) }, fetcher);
      return { user: { id: user.id, login: user.login, name, githubName, nickname, avatar: user.avatar, canWrite: user.canWrite }, notes };
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409 || attempt === 2) throw error;
    }
  }
  throw new HttpError(409, "仓库正在更新，昵称尚未修改，请稍后重试。");
}
