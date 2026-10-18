import { canonicalPaperUrl } from "../shared/papers";
import {
  summarizePaper,
  type PaperCandidate,
  type PaperRecord,
  type PaperSummary,
} from "../shared/catalog";
import {
  github,
  assertWriteAccess,
  HttpError,
  type Env,
  type Identity,
} from "./app";
import { readRepositoryJson } from "./profile";
import { acquirePaper } from "./paperLookup";

export async function paperId(paper: PaperCandidate) {
  const key = paper.doi
    ? `doi:${paper.doi.toLowerCase()}`
    : canonicalPaperUrl(paper.paperUrl);
  return `paper-${[
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32)}`;
}
const titleKey = (title: string) =>
  title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function samePaper(
  a: Pick<PaperCandidate, "doi" | "paperUrl" | "title" | "year" | "authors">,
  b: Pick<PaperCandidate, "doi" | "paperUrl" | "title" | "year" | "authors">,
) {
  if (a.doi && b.doi && a.doi.toLowerCase() === b.doi.toLowerCase())
    return true;
  if (
    canonicalPaperUrl(a.paperUrl) &&
    canonicalPaperUrl(a.paperUrl) === canonicalPaperUrl(b.paperUrl)
  )
    return true;
  return (
    titleKey(a.title) === titleKey(b.title) &&
    !!a.year &&
    a.year === b.year &&
    a.authors.some((author) =>
      b.authors.some((other) => titleKey(author) === titleKey(other)),
    )
  );
}
function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(""));
}
export async function collectPaper(
  env: Env,
  user: Identity,
  candidate: PaperCandidate,
  fetcher: typeof fetch = fetch,
): Promise<{ paper: PaperSummary; commitUrl: string; reused: boolean }> {
  await assertWriteAccess(env, user, fetcher);
  const root = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
    branch = env.GITHUB_BRANCH || "main";
  const initial = await readRepositoryJson<{ papers: PaperSummary[] }>(
    env,
    user,
    "data/papers/index.json",
    branch,
    { papers: [] },
    fetcher,
  );
  const existing = initial.papers.find((p) => samePaper(candidate, p));
  if (existing)
    return {
      paper: existing,
      commitUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/blob/${encodeURIComponent(branch)}/data/papers/${existing.id}.json`,
      reused: true,
    };
  const acquired = await acquirePaper(
    candidate,
    await paperId(candidate),
    user.login,
    fetcher,
  );
  return commitPaper(env, user, acquired.paper, acquired.pdf, fetcher);
}
export async function commitPaper(
  env: Env,
  user: Identity,
  paper: PaperRecord,
  pdf?: Uint8Array,
  fetcher: typeof fetch = fetch,
): Promise<{ paper: PaperSummary; commitUrl: string; reused: boolean }> {
  const root = `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
    branch = env.GITHUB_BRANCH || "main";
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
      papers: PaperSummary[];
    }>(
      env,
      user,
      "data/papers/index.json",
      head.object.sha,
      { papers: [] },
      fetcher,
    );
    const existing = index.papers.find((p) => samePaper(paper, p));
    if (existing)
      return {
        paper: existing,
        commitUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commit/${head.object.sha}`,
        reused: true,
      };
    const files = [
      {
        path: `data/papers/${paper.id}.json`,
        content: JSON.stringify(paper, null, 2),
        encoding: "utf-8",
      },
      {
        path: "data/papers/index.json",
        content: JSON.stringify(
          { version: 1, papers: [summarizePaper(paper), ...index.papers] },
          null,
          2,
        ),
        encoding: "utf-8",
      },
    ];
    if (pdf && paper.archivePath)
      files.push({
        path: paper.archivePath,
        content: base64(pdf),
        encoding: "base64",
      });
    const entries = await Promise.all(
      files.map(async (file) => {
        const blob = await github<any>(
          env,
          `${root}/git/blobs`,
          user.token,
          {
            method: "POST",
            body: JSON.stringify({
              content: file.content,
              encoding: file.encoding,
            }),
          },
          fetcher,
        );
        return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
      }),
    );
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
          message: `papers: collect ${paper.title}`,
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
          body: JSON.stringify({ sha: next.sha, force: false }),
        },
        fetcher,
      );
      return {
        paper: summarizePaper(paper),
        commitUrl: `https://github.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commit/${next.sha}`,
        reused: false,
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
  throw new HttpError(409, "仓库正在更新，请稍后重试收录。");
}
