import type { PaperCandidate, PaperRecord } from "../shared/catalog";
import { canonicalPaperUrl } from "../shared/papers";
import { titleScore, type ReviewEnv } from "./review";

const text = (v: unknown, max = 500) =>
  typeof v === "string"
    ? v
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
const url = (v: unknown) => {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && !u.username && !u.password && !u.port
      ? u.href
      : "";
  } catch {
    return "";
  }
};
const https = (s: string) => s.replace(/^http:/, "https:");
export async function limitedBody(
  response: Response,
  max: number,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("来源没有返回文件内容。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) throw new Error("来源文件超过大小限制。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
async function getText(target: string, fetcher: typeof fetch, max = 600_000) {
  const response = await fetcher(target, {
    redirect: "manual",
    signal: AbortSignal.timeout(9000),
    headers: { "User-Agent": "MCS-BIEP-RA/1.0" },
  });
  if (!response.ok) throw new Error("来源暂时不可用。");
  return new TextDecoder().decode(await limitedBody(response, max));
}
const tagNames: Record<string, string> = {
  "cs.CV": "计算机视觉",
  "cs.LG": "机器学习",
  "cs.AI": "人工智能",
  "cs.RO": "机器人",
  "cs.MA": "多智能体",
  "cs.CL": "自然语言处理",
  "stat.ML": "机器学习",
};
function tags(title: string, categories: string[] = []) {
  const result: string[] = [];
  if (/world models?|世界模型/i.test(title)) result.push("世界模型");
  if (/multi.agent|多智能体/i.test(title)) result.push("多智能体");
  return [
    ...new Set([
      ...result,
      ...categories.map((c) => tagNames[c]).filter(Boolean),
    ]),
  ].slice(0, 3);
}
function base(
  title: string,
  paperUrl: string,
  source: PaperCandidate["source"],
): PaperCandidate {
  return {
    title,
    authors: [],
    year: "",
    venue: "",
    abstract: "",
    paperUrl,
    pdfUrl: "",
    doi: "",
    source,
    tags: tags(title),
    license: "",
    score: 0,
  };
}
export function arxivCandidates(xml: string, query: string): PaperCandidate[] {
  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)].flatMap(
    ([, entry]) => {
      const title = text(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1], 250);
      const id = text(entry.match(/<id>(.*?)<\/id>/)?.[1]);
      const match = id.match(
        /^https?:\/\/(?:export\.)?arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)$/i,
      );
      if (!title || !match || /^(error|not found)$/i.test(title)) return [];
      const paper = base(title, `https://arxiv.org/abs/${match[1]}`, "arxiv");
      paper.pdfUrl = `https://arxiv.org/pdf/${match[1]}`;
      paper.venue = "arXiv";
      paper.authors = [
        ...entry.matchAll(
          /<author\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g,
        ),
      ]
        .map(([, n]) => text(n, 120))
        .slice(0, 100);
      paper.year = entry.match(/<published>(\d{4})/)?.[1] || "";
      paper.abstract = text(
        entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1],
        6000,
      );
      paper.doi = text(
        entry.match(/<arxiv:doi[^>]*>(.*?)<\/arxiv:doi>/)?.[1],
        200,
      );
      paper.tags = tags(
        title,
        [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map(([, c]) => c),
      );
      paper.score = titleScore(query, title);
      return [paper];
    },
  );
}
export function crossrefCandidates(data: any, query: string): PaperCandidate[] {
  return (
    Array.isArray(data?.message?.items) ? data.message.items : []
  ).flatMap((item: any) => {
    const title = text(item.title?.[0], 250),
      doi = text(item.DOI, 200);
    if (!title || !/^10\.\d{4,9}\/\S+$/.test(doi)) return [];
    const paper = base(title, `https://doi.org/${encodeURI(doi)}`, "crossref");
    paper.doi = doi;
    paper.authors = (Array.isArray(item.author) ? item.author : [])
      .map((a: any) =>
        text(`${a.given || ""} ${a.family || a.name || ""}`, 120),
      )
      .filter(Boolean)
      .slice(0, 100);
    paper.year = String(item.published?.["date-parts"]?.[0]?.[0] || "");
    if (!/^(19|20)\d{2}$/.test(paper.year)) paper.year = "";
    paper.venue = text(item["container-title"]?.[0], 150);
    paper.abstract = text(item.abstract, 6000);
    paper.pdfUrl =
      (item.link || [])
        .filter((l: any) => l["content-type"] === "application/pdf")
        .map((l: any) => url(https(String(l.URL || ""))))
        .find((u: string) => safePdfUrl(u)) || "";
    paper.license =
      (item.license || [])
        .map((l: any) => url(https(String(l.URL || ""))))
        .find(Boolean) || "";
    paper.score = titleScore(query, title);
    return [paper];
  });
}
export function safePdfUrl(value: string) {
  const valid = url(value);
  if (!valid) return false;
  const u = new URL(valid);
  if (u.hostname === "arxiv.org" || u.hostname === "export.arxiv.org")
    return (
      /^\/pdf\/(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)(?:\.pdf)?$/i.test(
        u.pathname,
      ) && !u.search
    );
  if (u.hostname === "openreview.net")
    return (
      u.pathname === "/pdf" &&
      /^[\w-]{1,100}$/.test(u.searchParams.get("id") || "") &&
      [...u.searchParams.keys()].every((k) => k === "id")
    );
  return (
    [
      "proceedings.mlr.press",
      "openaccess.thecvf.com",
      "aclanthology.org",
      "www.jmlr.org",
      "jmlr.org",
    ].includes(u.hostname) && u.pathname.toLowerCase().endsWith(".pdf")
  );
}
function inferredPdf(paperUrl: string) {
  const u = new URL(paperUrl);
  if (safePdfUrl(paperUrl)) return paperUrl;
  if (u.hostname === "arxiv.org" && /^\/abs\//.test(u.pathname)) {
    const p = `https://arxiv.org${u.pathname.replace(/^\/abs\//, "/pdf/")}`;
    return safePdfUrl(p) ? p : "";
  }
  if (u.hostname === "openreview.net" && u.pathname === "/forum") {
    const p = `https://openreview.net/pdf?id=${encodeURIComponent(u.searchParams.get("id") || "")}`;
    return safePdfUrl(p) ? p : "";
  }
  if (u.hostname === "proceedings.mlr.press" && u.pathname.endsWith(".html")) {
    const p = `https://${u.hostname}${u.pathname.replace(/\/([^/]+)\.html$/, "/$1/$1.pdf")}`;
    return safePdfUrl(p) ? p : "";
  }
  return "";
}
export async function lookupPapers(
  query: string,
  env: ReviewEnv,
  fetcher: typeof fetch = fetch,
) {
  const settled = await Promise.allSettled([
    getText(
      `https://export.arxiv.org/api/query?search_query=ti:${encodeURIComponent('"' + query.replace(/["\r\n]/g, " ") + '"')}&start=0&max_results=5`,
      fetcher,
    ).then((xml) => arxivCandidates(xml, query)),
    getText(
      `https://api.crossref.org/works?query.title=${encodeURIComponent(query)}&rows=5`,
      fetcher,
    ).then((raw) => crossrefCandidates(JSON.parse(raw), query)),
  ]);
  let candidates = settled
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((p) => p.score >= 0.55);
  let fallback = false;
  if (
    !candidates.some((p) => p.score >= 0.85 && p.pdfUrl) &&
    env.DEEPSEEK_API_KEY
  ) {
    fallback = true;
    try {
      const response = await fetcher(
        "https://api.deepseek.com/v1/tools/search",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `${query.slice(0, 100)} paper pdf`,
            count: 5,
            need_content: false,
          }),
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (response.ok) {
        const data = JSON.parse(
          new TextDecoder().decode(await limitedBody(response, 180000)),
        );
        const found = (Array.isArray(data.results) ? data.results : []).flatMap(
          (r: any) => {
            const landing = url(https(String(r.url || ""))),
              title = text(r.title, 250);
            if (!landing || !title || Number(r.rerank_score) < 1.5) return [];
            const host = new URL(landing).hostname;
            if (
              ![
                "arxiv.org",
                "openreview.net",
                "proceedings.mlr.press",
                "openaccess.thecvf.com",
                "aclanthology.org",
                "jmlr.org",
                "www.jmlr.org",
                "doi.org",
              ].includes(host)
            )
              return [];
            const p = base(title, landing, "search");
            p.pdfUrl = inferredPdf(landing);
            p.score = titleScore(query, title);
            return p.score >= 0.6 ? [p] : [];
          },
        );
        candidates.push(...found);
      }
    } catch {
      /* Preserve free-source matches and return a clear empty state. */
    }
  }
  const unique = new Map<string, PaperCandidate>();
  for (const p of candidates.sort(
    (a, b) => b.score - a.score || (a.source === "arxiv" ? -1 : 1),
  )) {
    const key = canonicalPaperUrl(p.paperUrl);
    if (!unique.has(key)) unique.set(key, p);
  }
  candidates = [...unique.values()].slice(0, 8);
  return {
    candidates,
    fallback,
    message: candidates.length
      ? ""
      : "未找到可靠匹配。请补充完整英文标题、作者或年份后重试。",
  };
}
export function redistributable(license: string) {
  return /^https?:\/\/creativecommons\.org\/(?:licenses\/(?:by|by-sa)\/|publicdomain\/zero\/)/i.test(
    license,
  );
}
export async function acquirePaper(
  candidate: PaperCandidate,
  id: string,
  userLogin: string,
  fetcher: typeof fetch = fetch,
): Promise<{ paper: PaperRecord; pdf?: Uint8Array }> {
  const now = new Date().toISOString();
  const paper: PaperRecord = {
    ...candidate,
    id,
    addedBy: userLogin,
    createdAt: now,
    updatedAt: now,
    pdfStatus: candidate.pdfUrl ? "external" : "unavailable",
    pdfMessage: candidate.pdfUrl
      ? "保留原站 PDF 链接。"
      : "未找到公开 PDF，已收录论文信息。",
    pdfVerified: false,
  };
  if (!candidate.pdfUrl || !safePdfUrl(candidate.pdfUrl)) {
    paper.pdfUrl = "";
    return { paper };
  }
  try {
    if (!paper.license && new URL(paper.paperUrl).hostname === "arxiv.org") {
      try {
        const html = await getText(paper.paperUrl, fetcher, 400000);
        const licenseBlock =
          html.match(
            /<div[^>]*class=["'][^"']*\babs-license\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
          )?.[1] || "";
        paper.license =
          licenseBlock.match(
            /href=["'](https?:\/\/creativecommons\.org\/(?:licenses|publicdomain)\/[^"'<>\s]+)["']/i,
          )?.[1] || "";
      } catch {
        /* Missing license means no repository mirror. */
      }
    }
    const response = await fetcher(paper.pdfUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "MCS-BIEP-RA/1.0" },
    });
    if (!response.ok) {
      paper.pdfMessage = "暂时无法下载 PDF，保留原站链接。";
      return { paper };
    }
    if (Number(response.headers.get("Content-Length") || 0) > 4 * 1024 * 1024) {
      await response.body?.cancel();
      paper.pdfMessage = "PDF 超过 4 MB，保留原站链接。";
      return { paper };
    }
    let bytes: Uint8Array;
    try {
      bytes = await limitedBody(response, 4 * 1024 * 1024);
    } catch {
      paper.pdfMessage = "PDF 超过大小限制或下载中断，保留原站链接。";
      return { paper };
    }
    if (
      !new TextDecoder().decode(bytes.slice(0, 5)).startsWith("%PDF-") ||
      !/%%EOF[\s\S]{0,1024}$/.test(new TextDecoder().decode(bytes.slice(-1100)))
    ) {
      paper.pdfStatus = "unavailable";
      paper.pdfUrl = "";
      paper.pdfMessage = "来源未返回完整 PDF，已保留论文信息。";
      return { paper };
    }
    paper.pdfVerified = true;
    paper.pdfBytes = bytes.length;
    if (!redistributable(paper.license)) {
      paper.pdfMessage = "PDF 已验证；未确认可再分发许可，保留原站链接。";
      return { paper };
    }
    paper.archivePath = `assets/papers/${id}/paper.pdf`;
    paper.pdfStatus = "archived";
    paper.pdfMessage = "PDF 已归档到仓库。";
    return { paper, pdf: bytes };
  } catch {
    paper.pdfMessage = "PDF 获取暂时失败，保留原站链接。";
    return { paper };
  }
}
