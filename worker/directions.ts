import { summarize, type NoteSummary } from "../shared/note";
import {
  directionKey,
  directionName,
  directionFolder,
  mergeDirections,
  changedDirections,
  type DirectionCatalog,
  type DirectionChange,
} from "../shared/directions";
import {
  assertWriteAccess,
  github,
  HttpError,
  type Env,
  type Identity,
} from "./app";
import { readRepositoryJson } from "./profile";
import { directionReadme, layoutEntries } from "./layout";
import { readIndexedNotes } from "./repositoryNotes";

async function readCatalog(
  env: Env,
  user: Identity,
  ref: string,
  fetcher: typeof fetch,
) {
  const [catalog, index] = await Promise.all([
    readRepositoryJson<DirectionCatalog>(
      env,
      user,
      "data/directions.json",
      ref,
      { version: 1, directions: [] },
      fetcher,
    ),
    readRepositoryJson<{ notes: NoteSummary[] }>(
      env,
      user,
      "data/library.json",
      ref,
      { notes: [] },
      fetcher,
    ),
  ]);
  return {
    catalog,
    index,
    names: mergeDirections(
      catalog.directions || [],
      index.notes.flatMap((n) => n.tags || []),
    ),
  };
}

export async function repositoryDirections(
  env: Env,
  user: Identity,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  return (await readCatalog(env, user, env.GITHUB_BRANCH || "main", fetcher))
    .names;
}

export async function createDirection(
  env: Env,
  user: Identity,
  value: unknown,
  fetcher: typeof fetch = fetch,
): Promise<{ name: string; directions: string[] }> {
  let name: string;
  try {
    name = directionName(value);
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
    const { catalog, names } = await readCatalog(
      env,
      user,
      head.object.sha,
      fetcher,
    );
    const existing = names.find((n) => directionKey(n) === directionKey(name));
    if (existing) return { name: existing, directions: names };
    if (names.length >= 500)
      throw new HttpError(400, "研究方向目录已达 500 个，请联系维护者整理。");
    const headCommit = await github<any>(
      env,
      `${root}/git/commits/${head.object.sha}`,
      user.token,
      {},
      fetcher,
    );
    const directions = mergeDirections(catalog.directions || [], [name]);
    const tree = await github<any>(
      env,
      `${root}/git/trees`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({
          base_tree: headCommit.tree.sha,
          tree: [
            {
              path: "data/directions.json",
              mode: "100644",
              type: "blob",
              content: JSON.stringify(
                {
                  ...catalog,
                  version: 1,
                  directions,
                  retired: (catalog.retired || []).filter(
                    (n) => directionKey(n) !== directionKey(name),
                  ),
                },
                null,
                2,
              ),
            },
            directionReadme(directionFolder(name), name, []),
          ],
        }),
      },
      fetcher,
    );
    const commit = await github<any>(
      env,
      `${root}/git/commits`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({
          message: `docs: create research direction ${name}`,
          tree: tree.sha,
          parents: [head.object.sha],
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
          body: JSON.stringify({ sha: commit.sha, force: false }),
        },
        fetcher,
      );
      return { name, directions: mergeDirections(names, [name]) };
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 409 || attempt === 2)
        throw e;
    }
  }
  throw new HttpError(409, "目录正在更新，请稍后重试。");
}

export async function changeDirection(
  env: Env,
  user: Identity,
  value: DirectionChange,
  fetcher: typeof fetch = fetch,
): Promise<{
  name: string | null;
  directions: string[];
  notes: NoteSummary[];
  commitUrl: string;
}> {
  let name: string, replacement: string | null;
  try {
    name = directionName(value?.name);
    replacement =
      value?.replacement === null ? null : directionName(value?.replacement);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  const upstream = fetcher;
  let requests = 0;
  fetcher = async (input, init) => {
    if (++requests > 45)
      throw new HttpError(
        409,
        "并发更新较多，本次目录修改未提交，请刷新后重试。",
      );
    return upstream(input, init);
  };
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
    const { catalog, index, names } = await readCatalog(
      env,
      user,
      ref,
      fetcher,
    );
    const source = names.find((n) => directionKey(n) === directionKey(name));
    const commitUrl = `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commit/${ref}`;
    if (!source) {
      if (replacement === null)
        return { name: null, directions: names, notes: index.notes, commitUrl };
      throw new HttpError(409, "原研究方向已被修改或删除，请刷新后重试。");
    }
    if (replacement === source)
      return { name: source, directions: names, notes: index.notes, commitUrl };
    if (
      replacement &&
      directionKey(replacement) !== directionKey(source) &&
      names.some((n) => directionKey(n) === directionKey(replacement!))
    )
      throw new HttpError(
        409,
        "该研究方向已存在，请使用其他名称；可通过移动笔记合并方向。",
      );
    const change = { name: source, replacement };
    const affected = index.notes.filter((n) =>
      n.tags.some((t) => directionKey(t) === directionKey(source)),
    );
    if (affected.length > 250)
      throw new HttpError(
        413,
        "该方向超过 250 份笔记，请联系维护者批量整理；本次未修改。",
      );
    const previous = await readIndexedNotes(env, user, affected, ref, fetcher);
    const changed = previous.map((note) => ({
      ...note,
      tags: changedDirections(note.tags, change),
      revision: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    }));
    const byId = new Map(changed.map((n) => [n.id, summarize(n)]));
    const notes = index.notes.map((n) => byId.get(n.id) || n);
    const directions = changedDirections(names, change);
    const retired = mergeDirections(
      catalog.retired || [],
      !replacement || directionKey(replacement) !== directionKey(source)
        ? [source]
        : [],
    ).filter(
      (n) => !replacement || directionKey(n) !== directionKey(replacement),
    );
    const commit = await github<any>(
      env,
      `${root}/git/commits/${ref}`,
      user.token,
      {},
      fetcher,
    );
    const entries = [
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
        {
          directions,
          retired,
          removed: [source],
          touch: replacement ? [replacement] : [],
        },
      )),
    ];
    const body = JSON.stringify({ base_tree: commit.tree.sha, tree: entries });
    if (new TextEncoder().encode(body).byteLength > 8 * 1024 * 1024)
      throw new HttpError(
        413,
        "本次目录更新超过 8 MB，请联系维护者分批整理；本次未修改。",
      );
    const tree = await github<any>(
      env,
      `${root}/git/trees`,
      user.token,
      { method: "POST", body },
      fetcher,
    );
    const next = await github<any>(
      env,
      `${root}/git/commits`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({
          message: replacement
            ? `docs: rename research direction ${source} to ${replacement}`
            : `docs: remove research direction ${source} (keep notes)`,
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
        name: replacement,
        directions,
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
  throw new HttpError(409, "仓库正在更新，请刷新后重试。");
}
