import {
  directionFolder,
  mergeDirections,
  noteFolders,
} from "../shared/directions";
import { toMarkdown, type Note, type NoteSummary } from "../shared/note";
import { github, HttpError, type Env, type Identity } from "./app";
import { readRepositoryJson } from "./profile";

export interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  content?: string;
  sha?: string | null;
}
const file = (path: string, content: string): TreeEntry => ({
  path,
  content,
  mode: "100644",
  type: "blob",
});
const text = (value: string) =>
  value.replace(/[\\`*_{}\[\]<>#|]/g, "\\$&").replace(/[\r\n]+/g, " ");

export function directionReadme(
  folder: string,
  name: string,
  notes: NoteSummary[],
  available?: Set<string>,
): TreeEntry {
  const members = notes.filter((n) => noteFolders(n.tags).includes(folder));
  const rows = members.map(
    (n) =>
      `- [${text(n.title)}](${available && !available.has(`${folder}/${n.id}.md`) && available.has(`papers/${n.id}.md`) ? "../" : "./"}${n.id}.md) · ${text(n.author || n.authorLogin || "未署名")}`,
  );
  return file(
    `${folder}/README.md`,
    `# ${text(name)}\n\n${rows.length ? rows.join("\n") : "暂无阅读笔记。"}\n`,
  );
}

/** Generate all affected reading copies from the same immutable repository head. */
export async function layoutEntries(
  env: Env,
  user: Identity,
  ref: string,
  baseTree: string,
  before: NoteSummary[],
  after: NoteSummary[],
  changed: Note[],
  fetcher: typeof fetch,
): Promise<TreeEntry[]> {
  const catalog = await readRepositoryJson<{ directions: string[] }>(
    env,
    user,
    "data/directions.json",
    ref,
    { directions: [] },
    fetcher,
  );
  const directions = mergeDirections(
    catalog.directions || [],
    before.flatMap((n) => n.tags),
    after.flatMap((n) => n.tags),
  );
  const entries = [
    file(
      "data/directions.json",
      JSON.stringify({ version: 1, directions }, null, 2),
    ),
  ];
  const affected = new Set(changed.flatMap((n) => noteFolders(n.tags)));
  const removed = new Set<string>();
  for (const note of changed) {
    for (const folder of noteFolders(note.tags))
      entries.push(file(`${folder}/${note.id}.md`, toMarkdown(note, "../../")));
    const previous = before.find((n) => n.id === note.id);
    if (!previous) continue;
    removed.add(`papers/${note.id}.md`);
    for (const folder of noteFolders(previous.tags)) {
      affected.add(folder);
      if (!noteFolders(note.tags).includes(folder))
        removed.add(`${folder}/${note.id}.md`);
    }
  }
  let available: Set<string> | undefined;
  // GitHub rejects deletion of nonexistent files. Only remove verified generated paths.
  if (
    removed.size ||
    after.some(
      (n) =>
        !changed.some((c) => c.id === n.id) &&
        noteFolders(n.tags).some((folder) => affected.has(folder)),
    )
  ) {
    const tree = await github<{
      tree: { path: string }[];
      truncated?: boolean;
    }>(
      env,
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/trees/${baseTree}?recursive=1`,
      user.token,
      {},
      fetcher,
    );
    if (tree.truncated)
      throw new HttpError(
        413,
        "仓库目录过大，本次修改尚未保存，请联系维护者。",
      );
    const existing = new Set(tree.tree.map((e) => e.path));
    available = new Set([...existing, ...entries.map((e) => e.path)]);
    for (const path of removed)
      if (existing.has(path))
        entries.push({ path, mode: "100644", type: "blob", sha: null });
  }
  for (const folder of affected) {
    const name =
      directions.find((n) => directionFolder(n) === folder) || "未分类";
    entries.push(directionReadme(folder, name, after, available));
  }
  return entries;
}
