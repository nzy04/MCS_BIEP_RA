export const sectionDefinitions = [
  {
    key: "summary",
    label: "一句话总结",
    aliases: ["总结", "摘要", "概述", "summary", "abstract", "一句话总结内容"],
  },
  {
    key: "problem",
    label: "研究问题",
    aliases: [
      "背景",
      "研究背景",
      "挑战",
      "动机",
      "问题",
      "background",
      "motivation",
      "本文挑战及已有工作不足",
    ],
  },
  {
    key: "method",
    label: "方法与贡献",
    aliases: [
      "方法",
      "贡献",
      "创新",
      "创新点",
      "创新贡献",
      "方法框架",
      "核心方法",
      "method",
      "contribution",
      "一句话总结创新贡献",
      "框架图",
    ],
  },
  {
    key: "evidence",
    label: "实验与证据",
    aliases: [
      "实验",
      "结果",
      "证据",
      "实验结果",
      "evaluation",
      "experiments",
      "results",
    ],
  },
  {
    key: "limitations",
    label: "局限与疑问",
    aliases: [
      "不足",
      "局限",
      "疑问",
      "未来工作",
      "limitations",
      "还有哪些不足的地方",
    ],
  },
  {
    key: "insights",
    label: "我的思考",
    aliases: [
      "启发",
      "个人思考",
      "感想",
      "备注",
      "读后感",
      "对我们的启发",
      "印象最深刻的点",
      "insights",
      "notes",
    ],
  },
  { key: "original", label: "其他原始笔记", aliases: [] },
] as const;
export type SectionKey = (typeof sectionDefinitions)[number]["key"];
export interface NoteAsset {
  path: string;
  mime: string;
  size: number;
  dataUrl?: string;
}
export interface NoteSummary {
  id: string;
  title: string;
  subtitle: string;
  year: string;
  venue: string;
  tags: string[];
  paperUrl: string;
  codeUrl: string;
  author: string;
  authorLogin: string;
  createdAt: string;
  updatedAt: string;
  revision: string;
  excerpt: string;
  readingDepth: string;
  local?: boolean;
  demo?: boolean;
}
export interface Note extends NoteSummary {
  sections: Record<SectionKey, string>;
  assets: NoteAsset[];
  sourceNames: string[];
}
export interface UploadAsset {
  path: string;
  mime: string;
  base64: string;
}
export interface SiteConfig {
  title: string;
  configured: boolean;
  authConfigured: boolean;
  repository: string;
  branch: string;
}
export interface Session {
  login: string;
  name: string;
  avatar: string;
  canWrite: boolean;
}
export function emptySections(): Record<SectionKey, string> {
  return Object.fromEntries(
    sectionDefinitions.map((s) => [s.key, ""]),
  ) as Record<SectionKey, string>;
}
export function createNote(): Note {
  const date = new Date().toISOString();
  return {
    id: `note-${crypto.randomUUID()}`,
    title: "",
    subtitle: "",
    year: "",
    venue: "",
    tags: [],
    paperUrl: "",
    codeUrl: "",
    author: "",
    authorLogin: "",
    createdAt: date,
    updatedAt: date,
    revision: "",
    excerpt: "",
    readingDepth: "阅读笔记",
    sections: emptySections(),
    assets: [],
    sourceNames: [],
  };
}
export function summarize(note: Note): NoteSummary {
  const { sections, assets, sourceNames, ...entry } = note;
  return {
    ...entry,
    excerpt: (sections.summary || sections.problem || sections.original)
      .replace(/[#*_`>]/g, "")
      .slice(0, 170),
  };
}
function normalizeHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s#*：:、.。()（）\d一二三四五六七八九十]/g, "");
}
export function structureText(text: string): {
  title: string;
  sections: Record<SectionKey, string>;
  matched: number;
} {
  const sections = emptySections();
  let current: SectionKey = "original";
  let title = "";
  let matched = 0;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line
      .trim()
      .replace(/^#{1,6}\s*/, "")
      .replace(/^\*\*(.*?)\*\*$/, "$1");
    const normalized = normalizeHeading(heading);
    const match =
      heading.length < 65 &&
      sectionDefinitions.find(
        (s) =>
          s.key !== "original" &&
          [s.label, ...s.aliases].some(
            (a) => normalizeHeading(a) === normalized,
          ),
      );
    if (match) {
      current = match.key;
      matched++;
      continue;
    }
    if (!title && /^#\s+/.test(line) && current === "original") {
      title = heading;
      continue;
    }
    sections[current] += `${line}\n`;
  }
  for (const key of Object.keys(sections) as SectionKey[])
    sections[key] = sections[key].trim();
  return { title, sections, matched };
}
export function toMarkdown(note: Note): string {
  const metadata = {
    id: note.id,
    title: note.title,
    author: note.author,
    github: note.authorLogin,
    date: note.updatedAt,
    year: note.year,
    venue: note.venue,
    tags: note.tags,
    paper_url: note.paperUrl,
    code_url: note.codeUrl,
    reading_depth: note.readingDepth,
  };
  const frontmatter = Object.entries(metadata)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n# ${note.title}\n\n${note.subtitle ? `${note.subtitle}\n\n` : ""}${sectionDefinitions
    .filter((s) => note.sections[s.key])
    .map((s) => `## ${s.label}\n\n${note.sections[s.key]}`)
    .join("\n\n")}\n`;
}
export function validateNote(note: Note): string[] {
  const errors: string[] = [];
  if (!note.title.trim()) errors.push("请填写笔记标题。");
  if (note.title.length > 250) errors.push("标题请控制在 250 字以内。");
  if (!Object.values(note.sections).some((t) => t.trim()))
    errors.push("请填写或导入至少一段笔记内容。");
  for (const url of [note.paperUrl, note.codeUrl])
    if (url && !/^https?:\/\//i.test(url))
      errors.push("论文和代码链接请使用完整的 http(s) 地址。");
  return errors;
}
