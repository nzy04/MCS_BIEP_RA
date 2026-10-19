import type { Note } from "./note";
import type { ReviewSupplement } from "./review";
export function aiSupplement(
  note: Pick<Note, "review" | "paperUrl" | "pdfUrl" | "year" | "venue">,
  field: ReviewSupplement["field"],
): boolean {
  return !!note.review?.supplements.some(
    (s) => s.field === field && s.value === note[field],
  );
}
