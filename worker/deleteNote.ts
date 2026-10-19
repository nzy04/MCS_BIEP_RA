import { ownsNote } from "../shared/papers";
import type { Note, NoteSummary } from "../shared/note";
import {
  assertWriteAccess,
  github,
  HttpError,
  type Env,
  type Identity,
} from "./app";
import { readRepositoryJson } from "./profile";
import { layoutEntries } from "./layout";

export async function deleteNote(
  env: Env,
  user: Identity,
  id: string,
  revision: unknown,
  fetcher: typeof fetch = fetch,
): Promise<{ notes: NoteSummary[]; commitUrl: string }> {
  if (
    !/^note-[a-f0-9-]{36}$/.test(id) ||
    typeof revision !== "string" ||
    !revision ||
    revision.length > 200
  )
    throw new HttpError(400, "请选择笔记的当前版本后删除。");
  await assertWriteAccess(env, user, fetcher);
  const root = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
  const branch = encodeURIComponent(env.GITHUB_BRANCH || "main");
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = await github<any>(
      env,
      `${root}/git/ref/heads/${branch}`,
      user.token,
      {},
      fetcher,
    );
    const ref = head.object.sha;
    const index = await readRepositoryJson<{
      version?: number;
      notes: NoteSummary[];
    }>(env, user, "data/library.json", ref, { notes: [] }, fetcher);
    const previous = index.notes.find((n) => n.id === id);
    const commitUrl = `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commit/${ref}`;
    if (!previous) return { notes: index.notes, commitUrl };
    if (!ownsNote(previous, user))
      throw new HttpError(403, "只有上传者本人可以删除这份笔记。");
    if (previous.revision !== revision)
      throw new HttpError(409, "笔记已有更新，请刷新后再删除。");
    const note = await readRepositoryJson<Note | null>(
      env,
      user,
      `data/notes/${id}.json`,
      ref,
      null,
      fetcher,
    );
    if (
      !note ||
      note.id !== id ||
      note.revision !== revision ||
      !ownsNote(note, user)
    )
      throw new HttpError(409, "笔记与目录不一致，本次未删除。");
    const commit = await github<any>(
      env,
      `${root}/git/commits/${ref}`,
      user.token,
      {},
      fetcher,
    );
    const notes = index.notes.filter((n) => n.id !== id);
    const entries = [
      {
        path: "data/library.json",
        mode: "100644",
        type: "blob",
        content: JSON.stringify({ ...index, version: 1, notes }, null, 2),
      },
      ...(await layoutEntries(
        env,
        user,
        ref,
        commit.tree.sha,
        index.notes,
        notes,
        [],
        fetcher,
        { deletedNotes: [note] },
      )),
    ];
    const tree = await github<any>(
      env,
      `${root}/git/trees`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }),
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
          message: `docs: delete own reading note ${note.title}`,
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
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        error.status !== 409 ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new HttpError(409, "仓库正在更新，请刷新后重试删除。");
}
