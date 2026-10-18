import type { NoteSummary, Session } from "./note";
import type { PaperSummary } from "./catalog";

export interface PaperGroup {
  id: string;
  note: NoteSummary;
  notes: NoteSummary[];
  tags: string[];
  updatedAt: string;
  record?: PaperSummary;
}

export function contributorKey(note: NoteSummary): string {
  return note.authorId
    ? `github:${note.authorId}`
    : note.authorLogin
      ? `login:${note.authorLogin.toLowerCase()}`
      : `name:${note.author || "未署名"}`;
}

export function countContributors(notes: NoteSummary[]): number {
  const ids = new Map(
    notes
      .filter((n) => n.authorId && n.authorLogin)
      .map((n) => [n.authorLogin.toLowerCase(), n.authorId!]),
  );
  return new Set(
    notes.map((note) => {
      const id = note.authorId || ids.get(note.authorLogin.toLowerCase());
      return id ? `github:${id}` : contributorKey(note);
    }),
  ).size;
}

export function ownsNote(note: NoteSummary, user: Session): boolean {
  if (note.authorId) return note.authorId === user.id;
  return (
    !!note.authorLogin &&
    note.authorLogin.toLowerCase() === user.login.toLowerCase()
  );
}

export function canonicalPaperUrl(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "");
    if (["arxiv.org", "export.arxiv.org"].includes(host)) {
      const match = path.match(
        /^\/(?:abs|pdf|html)\/(.+?)(?:v\d+)?(?:\.pdf)?$/i,
      );
      if (match) return `arxiv:${match[1].toLowerCase()}`;
    }
    if (host === "doi.org" || host === "dx.doi.org")
      return `doi:${path.slice(1).toLowerCase()}`;
    if (host === "openreview.net" && url.searchParams.get("id"))
      return `openreview:${url.searchParams.get("id")}`;
    // Query parameters can identify different papers; discard tracking only.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${host}${path}${url.searchParams.size ? `?${url.searchParams}` : ""}`;
  } catch {
    return "";
  }
}

function titleKey(note: { title: string }) {
  return note.title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}

/** Catalog metadata is a display facade only; it is never counted or stored as a note. */
export function paperDisplay(paper: PaperSummary): NoteSummary {
  return {
    id: paper.id,
    title: paper.title,
    subtitle: paper.authors.join(", "),
    year: paper.year,
    venue: paper.venue,
    tags: paper.tags,
    paperUrl: paper.paperUrl,
    codeUrl: "",
    author: paper.addedBy,
    authorLogin: paper.addedBy,
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
    revision: "",
    excerpt: "",
    readingDepth: "待读",
  };
}

export function groupPapers(
  notes: NoteSummary[],
  catalog: PaperSummary[] = [],
): PaperGroup[] {
  // Union by identifiers or exact normalized title, including legacy notes without links.
  const parent = notes.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const keys = new Map<string, number>();
  notes.forEach((note, i) => {
    const url = canonicalPaperUrl(note.paperUrl);
    const title = titleKey(note);
    for (const key of [url && `url:${url}`, title && `title:${title}`].filter(
      Boolean,
    )) {
      const previous = keys.get(key);
      if (previous !== undefined) parent[find(i)] = find(previous);
      else keys.set(key, i);
    }
  });
  const groups = new Map<number, NoteSummary[]>();
  notes.forEach((note, i) => {
    const key = find(i);
    const group = groups.get(key) || [];
    group.push(note);
    groups.set(key, group);
  });
  const result: PaperGroup[] = [...groups.values()].map((entries) => {
    const sorted = [...entries].sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
    return {
      id: entries.map((n) => n.id).sort()[0],
      note: sorted[0],
      notes: sorted,
      tags: [...new Set(entries.flatMap((n) => n.tags))],
      updatedAt: sorted[0].updatedAt,
    };
  });
  for (const record of catalog) {
    const matches = result.filter(
      (p) =>
        p.notes.some(
          (n) =>
            canonicalPaperUrl(n.paperUrl) ===
              canonicalPaperUrl(record.paperUrl) ||
            titleKey(n) === titleKey(record),
        ) ||
        (p.record &&
          (canonicalPaperUrl(p.record.paperUrl) ===
            canonicalPaperUrl(record.paperUrl) ||
            titleKey(p.record) === titleKey(record))),
    );
    if (matches.length) {
      const group = matches[0];
      group.id = group.record?.id || record.id;
      group.record ||= record;
      group.tags = [...new Set([...group.tags, ...record.tags])];
      if (record.updatedAt > group.updatedAt)
        group.updatedAt = record.updatedAt;
    } else
      result.push({
        id: record.id,
        note: paperDisplay(record),
        notes: [],
        tags: [...record.tags],
        updatedAt: record.updatedAt,
        record,
      });
  }
  return result;
}
