import type { NoteSummary } from "../shared/note";
import {
  directionKey,
  directionName,
  mergeDirections,
} from "../shared/directions";
import {
  assertWriteAccess,
  github,
  HttpError,
  type Env,
  type Identity,
} from "./app";
import { readRepositoryJson } from "./profile";

interface Catalog {
  version: number;
  directions: string[];
}
async function readCatalog(
  env: Env,
  user: Identity,
  ref: string,
  fetcher: typeof fetch,
) {
  const [catalog, index] = await Promise.all([
    readRepositoryJson<Catalog>(
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
              content: JSON.stringify({ version: 1, directions }, null, 2),
            },
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
