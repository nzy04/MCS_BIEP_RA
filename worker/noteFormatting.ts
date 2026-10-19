import type { Note } from "../shared/note";

const labels = new Set([
  "阅读笔记",
  "核心内容",
  "研究问题",
  "方法与贡献",
  "实验与结果",
  "阅读思考",
  "局限与疑问",
  "其他记录",
]);

function protectedAnchor(source: string, index: number): boolean {
  let fence = "",
    math = "";
  for (const line of source.slice(0, index).split("\n")) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (!math && marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
        fence = "";
    } else if (!fence) {
      if (math && line.trim() === math) math = "";
      else if (!math && line.trim() === "$$") math = "$$";
      else if (!math && line.trim() === "\\[") math = "\\]";
    }
  }
  return !!fence || !!math;
}

/** Adjust Markdown syntax only; keep prose, code, formulas and resources intact. */
export function basicMarkdown(body: string): string {
  const normalized = body.replace(/\r\n?/g, "\n");
  const wrapped = normalized.match(
    /^\s*```(?:markdown|md)\s*\n([\s\S]*?)\n```\s*$/i,
  );
  const source = wrapped && !/^```/m.test(wrapped[1]) ? wrapped[1] : normalized;
  let fence = "",
    math = "";
  return source
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
          fence = "";
        return line;
      }
      if (fence) return line;
      const trimmed = line.trim();
      if (math) {
        if (trimmed === math) math = "";
        return line;
      }
      if (trimmed === "$$") math = "$$";
      else if (trimmed === "\\[") math = "\\]";
      return math ? line : line.replace(/^(\s{0,3}#{1,6})(?=[^#\s])/u, "$1 ");
    })
    .join("\n")
    .trim();
}

/** The model may insert headings before exact paragraph anchors, never rewrite content. */
export function addSuggestedHeadings(
  note: Note,
  plan: unknown,
  maxCharacters: number,
): void {
  if (
    typeof note.body !== "string" ||
    /^\s{0,3}#{1,6}\s/m.test(note.body) ||
    /^\s*</m.test(note.body) ||
    !Array.isArray(plan)
  )
    return;
  const original = note.body;
  const insertions = new Map<number, string>();
  for (const item of plan.slice(0, 8)) {
    if (
      !labels.has(item?.label) ||
      typeof item.before !== "string" ||
      !item.before.trim() ||
      item.before.length > 300 ||
      /[\r\n]/.test(item.before)
    )
      continue;
    const index = original.indexOf(item.before);
    if (index < 0 || index !== original.lastIndexOf(item.before)) continue;
    if (
      protectedAnchor(original, index) ||
      /^(?: {4}|\t|\s*(?:<|\$\$|\\\[|`{3}|~{3}))/.test(item.before)
    )
      continue;
    if (index > 0 && original.slice(index - 2, index) !== "\n\n") continue;
    const end = original.indexOf("\n", index);
    if (original.slice(index, end < 0 ? undefined : end) !== item.before)
      continue;
    insertions.set(index, `## ${item.label}\n\n`);
  }
  for (const [index, heading] of [...insertions].sort((a, b) => b[0] - a[0])) {
    if (note.body.length + heading.length > maxCharacters) continue;
    note.body = note.body.slice(0, index) + heading + note.body.slice(index);
  }
}
