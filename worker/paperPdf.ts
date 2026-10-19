import type { Note } from "../shared/note";
import { canonicalPaperUrl } from "../shared/papers";

/** Only construct PDF links with documented, fixed academic URL patterns. */
export function inferPdfUrl(value: string): string {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port)
      return "";
    if (["arxiv.org", "export.arxiv.org"].includes(u.hostname)) {
      const id = u.pathname.match(
        /^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)(?:\.pdf)?$/i,
      )?.[1];
      return id ? `https://arxiv.org/pdf/${id}` : "";
    }
    if (
      u.hostname === "openreview.net" &&
      ["/forum", "/pdf"].includes(u.pathname)
    ) {
      const id = u.searchParams.get("id") || "";
      return /^[\w-]{1,100}$/.test(id)
        ? `https://openreview.net/pdf?id=${id}`
        : "";
    }
    if (u.hostname === "aclanthology.org" && /^\/[\w.-]+\/?$/.test(u.pathname))
      return `https://aclanthology.org${u.pathname.replace(/\/$/, "").replace(/\.pdf$/, "")}.pdf`;
    if (u.hostname === "proceedings.mlr.press") {
      if (/^\/v\d+\/[\w-]+\/[\w-]+\.pdf$/.test(u.pathname))
        return u.origin + u.pathname;
      const m = u.pathname.match(/^\/(v\d+)\/([\w-]+)\.html$/);
      if (m) return `${u.origin}/${m[1]}/${m[2]}/${m[2]}.pdf`;
    }
    if (
      u.hostname === "openaccess.thecvf.com" &&
      /^\/content[^?#]+(?:_paper\.html|\.pdf)$/.test(u.pathname)
    )
      return (
        u.origin +
        u.pathname.replace("/html/", "/papers/").replace(/\.html$/, ".pdf")
      );
    if (
      ["jmlr.org", "www.jmlr.org"].includes(u.hostname) &&
      /^\/papers\/.+\.pdf$/.test(u.pathname)
    )
      return u.origin + u.pathname;
    return "";
  } catch {
    return "";
  }
}
export interface PdfMatch {
  url: string;
  sourceUrl: string;
  title: string;
  kind: "arxiv" | "crossref";
  year?: string;
}
interface Candidate extends PdfMatch {
  year: string;
  doi: string;
  score: number;
}
const plain = (s: unknown) =>
  typeof s === "string"
    ? s
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
    : "";
export async function readMetadata(response: Response, max = 500_000) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Error("metadata too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}
/** A near-exact, unambiguous match is required; no guessed or model-generated URLs. */
export async function findFreePdf(
  note: Note,
  score: (a: string, b: string) => number,
  fetcher: typeof fetch = fetch,
): Promise<PdfMatch | null> {
  const doi = note.paperUrl.match(
    /^https:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^?#]+)$/i,
  )?.[1];
  const options: RequestInit = {
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "MCS-BIEP-RA/1.0" },
  };
  const results = await Promise.allSettled([
    (async () => {
      const r = await fetcher(
        `https://export.arxiv.org/api/query?search_query=ti:${encodeURIComponent('"' + note.title.replace(/["\r\n]/g, " ") + '"')}&max_results=5`,
        options,
      );
      if (!r.ok) return [];
      return [
        ...(await readMetadata(r)).matchAll(
          /<entry\b[^>]*>([\s\S]*?)<\/entry>/g,
        ),
      ].flatMap(([, entry]): Candidate[] => {
        const sourceUrl = plain(entry.match(/<id>(.*?)<\/id>/)?.[1]).replace(
            /^http:/,
            "https:",
          ),
          url = inferPdfUrl(sourceUrl),
          title = plain(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
        if (!url || !title) return [];
        return [
          {
            url,
            sourceUrl,
            title,
            kind: "arxiv",
            year: entry.match(/<published>(\d{4})/)?.[1] || "",
            doi: plain(entry.match(/<arxiv:doi[^>]*>(.*?)<\/arxiv:doi>/)?.[1]),
            score: score(note.title, title),
          },
        ];
      });
    })(),
    (async () => {
      const r = await fetcher(
        doi
          ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
          : `https://api.crossref.org/works?query.title=${encodeURIComponent(note.title)}&rows=5`,
        options,
      );
      if (!r.ok) return [];
      const data = JSON.parse(await readMetadata(r));
      const items = doi ? [data.message] : data.message?.items;
      return (Array.isArray(items) ? items : []).flatMap(
        (item: any): Candidate[] => {
          const title = plain(item?.title?.[0]),
            id = plain(item?.DOI);
          if (!title || !/^10\.\d{4,9}\/\S+$/.test(id)) return [];
          // Crossref can list publisher links; retain only recognised direct academic PDFs.
          const url =
            (Array.isArray(item.link) ? item.link : [])
              .filter((l: any) => l["content-type"] === "application/pdf")
              .map((l: any) =>
                inferPdfUrl(String(l.URL || "").replace(/^http:/, "https:")),
              )
              .find(Boolean) || "";
          if (!url) return [];
          return [
            {
              url,
              sourceUrl: `https://doi.org/${encodeURI(id)}`,
              title,
              kind: "crossref",
              year: String(item.published?.["date-parts"]?.[0]?.[0] || ""),
              doi: id,
              score: score(note.title, title),
            },
          ];
        },
      );
    })(),
  ]);
  const all = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter(
      (c) =>
        c.score >= 0.92 &&
        (!note.year ||
          !c.year ||
          Math.abs(Number(c.year) - Number(note.year)) <= 1),
    );
  // An explicit DOI is stronger than title similarity.
  const exact = doi
    ? all.filter((c) => c.doi.toLowerCase() === doi.toLowerCase())
    : [];
  const candidates = [
    ...new Map(
      (exact.length ? exact : all)
        .sort((a, b) => b.score - a.score)
        .map((c) => [
          c.doi ? `doi:${c.doi.toLowerCase()}` : canonicalPaperUrl(c.url),
          c,
        ]),
    ).values(),
  ];
  if (!candidates.length) return null;
  const hit = candidates[0];
  if (candidates[1] && hit.score - candidates[1].score < 0.08) return null;
  return {
    url: hit.url,
    sourceUrl: hit.sourceUrl,
    title: hit.title,
    kind: hit.kind,
    year: hit.year,
  };
}
