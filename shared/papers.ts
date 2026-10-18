import type { NoteSummary, Session } from "./note";

export interface PaperGroup {
  id: string;
  note: NoteSummary;
  notes: NoteSummary[];
  tags: string[];
  updatedAt: string;
}

export function contributorKey(note: NoteSummary): string {
  return note.authorId
    ? `github:${note.authorId}`
    : note.authorLogin
      ? `login:${note.authorLogin.toLowerCase()}`
      : `name:${note.author || "未署名"}`;
}

export function countContributors(notes: NoteSummary[]): number {
  const ids = new Map(notes.filter(n => n.authorId && n.authorLogin).map(n => [n.authorLogin.toLowerCase(), n.authorId!]));
  return new Set(notes.map(note => {
    const id = note.authorId || ids.get(note.authorLogin.toLowerCase());
    return id ? `github:${id}` : contributorKey(note);
  })).size;
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

function titleKey(note: NoteSummary) {
  return note.title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
}

export function groupPapers(notes: NoteSummary[]): PaperGroup[] {
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
  return [...groups.values()].map((entries) => {
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
}
