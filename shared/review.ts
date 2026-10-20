export type ReviewStatus =
  | "queued"
  | "reviewing"
  | "publishing"
  | "published"
  | "needs_changes"
  | "failed";
export interface ReviewIssue {
  field: string;
  message: string;
  quote?: string;
}
export const reviewFieldLabel = (field: string) =>
  (
    ({
      title: "标题",
      paperUrl: "论文链接",
      pdfUrl: "PDF 下载链接",
      year: "发表年份",
      venue: "会议 / 期刊",
      tags: "研究方向",
      summary: "总结",
      problem: "研究问题",
      method: "方法与贡献",
      evidence: "实验与证据",
      limitations: "局限与疑问",
      insights: "个人理解",
      original: "笔记正文",
    }) as Record<string, string>
  )[field] || "笔记正文";
export interface ReviewSource {
  title: string;
  url: string;
  kind: "provided" | "crossref" | "arxiv" | "search";
}
export interface ReviewSupplement {
  field: "paperUrl" | "pdfUrl" | "year" | "venue";
  value: string;
  sourceUrl: string;
}
export interface ReviewReceipt {
  policyVersion: string;
  reviewedAt: string;
  model: string;
  directions: string[];
  directionSource?: "manual" | "model";
  sources: ReviewSource[];
  supplements: ReviewSupplement[];
  pdfNotice?: string;
  enrichmentNotice?: string;
  suggestions?: ReviewIssue[];
  formatted?: boolean;
}
export interface ReviewJobSummary {
  id: string;
  noteId: string;
  title: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  issues: ReviewIssue[];
  message: string;
  receipt?: ReviewReceipt;
  commitUrl?: string;
}
export const reviewPending = (status: ReviewStatus) =>
  ["queued", "reviewing", "publishing"].includes(status);
export interface ReviewQueueNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
