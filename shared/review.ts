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
}
export interface ReviewSource {
  title: string;
  url: string;
  kind: "provided" | "crossref" | "arxiv" | "search";
}
export interface ReviewSupplement {
  field: "paperUrl" | "year" | "venue";
  value: string;
  sourceUrl: string;
}
export interface ReviewReceipt {
  policyVersion: string;
  reviewedAt: string;
  model: string;
  directions: string[];
  sources: ReviewSource[];
  supplements: ReviewSupplement[];
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
