import { sectionDefinitions, type Note } from "./note";

export const readingTemplate =
  [
    "## 研究问题与已有工作不足",
    "## 主要贡献",
    "## 创新点示例",
    "## 方法与框架",
    "## 实验结果与分析",
    "## 阅读思考",
    "## 与其他工作的关联",
    "## 局限与后续问题",
  ].join("\n\n\n") + "\n\n";

export function noteBody(note: Pick<Note, "body" | "sections">): string {
  if (typeof note.body === "string") return note.body;
  return sectionDefinitions
    .filter((s) => note.sections[s.key])
    .map((s) => `## ${s.label}\n\n${note.sections[s.key]}`)
    .join("\n\n");
}

/** Keep every heading, paragraph and resource in its original order. */
export function importBody(text: string): { title: string; body: string } {
  let title = "";
  const body = text
    .replace(/\r\n/g, "\n")
    .replace(/^#\s+([^\n]+)\n?/m, (_, value) => {
      title = value.trim();
      return "";
    })
    .trim();
  return { title, body };
}

export function meaningfulBody(body: string): boolean {
  if (/!\[[^\]]*\]\([^)]+\)|<img\s/i.test(body)) return true;
  return !!body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*#{1,6}\s+.*$/gm, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\s#*_`>|:\-]/g, "")
    .trim();
}

/** Paths in the website's JSON are relative to the repository root. */
export function githubBody(body: string): string {
  return body
    .replace(
      /(\]\(<?|\bsrc=["'])(?:\.\/|\/)?assets\/uploads\//g,
      "$1../assets/uploads/",
    )
    .replace(
      /(^\s*\[[^\]]+\]:\s*<?)(?:\.\/|\/)?assets\/uploads\//gm,
      "$1../assets/uploads/",
    );
}
