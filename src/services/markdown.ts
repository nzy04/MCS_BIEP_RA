import MarkdownIt from "markdown-it";
import type { NoteAsset, Note } from "../../shared/note";
import { noteBody } from "../../shared/document";
import { sanitizeNoteHtml } from "./htmlToMarkdown";
import { useMath, renderMath } from "./math";
const renderer = new MarkdownIt({ html: true, linkify: true, breaks: true });
useMath(renderer);

export function renderedMarkdown(
  markdown: string,
  assets: NoteAsset[] = [],
  assetBase = "",
): string {
  const document = new DOMParser().parseFromString(
    sanitizeNoteHtml(renderer.render(markdown)),
    "text/html",
  );
  for (const image of document.querySelectorAll("img")) {
    const src = image.getAttribute("src") || "";
    const asset = assets.find((a) => a.path === src || `/${a.path}` === src);
    if (asset?.dataUrl) image.src = asset.dataUrl;
    else if (assetBase && src.startsWith("assets/uploads/"))
      image.src = `${assetBase}/${src}`;
    image.loading = "lazy";
    image.alt ||= "笔记插图";
  }
  // Recheck URLs after resolving the note's attachment metadata, before trusted math markup.
  const safe = new DOMParser().parseFromString(
    sanitizeNoteHtml(document.body.innerHTML),
    "text/html",
  );
  for (const link of safe.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  renderMath(safe);
  return safe.body.innerHTML;
}
export function renderedNote(note: Note, assetBase = ""): string {
  return renderedMarkdown(noteBody(note), note.assets, assetBase);
}
