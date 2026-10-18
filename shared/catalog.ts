export interface PaperCandidate {
  title: string;
  authors: string[];
  year: string;
  venue: string;
  abstract: string;
  paperUrl: string;
  pdfUrl: string;
  doi: string;
  source: "arxiv" | "crossref" | "search";
  tags: string[];
  license: string;
  score: number;
}
export interface PaperChoice extends PaperCandidate {
  token: string;
}
export interface PaperRecord extends PaperCandidate {
  id: string;
  createdAt: string;
  updatedAt: string;
  addedBy: string;
  pdfStatus: "archived" | "external" | "unavailable";
  pdfMessage: string;
  pdfVerified: boolean;
  pdfBytes?: number;
  archivePath?: string;
}
export type PaperSummary = Omit<PaperRecord, "abstract">;
export const summarizePaper = ({
  abstract,
  ...summary
}: PaperRecord): PaperSummary => summary;
