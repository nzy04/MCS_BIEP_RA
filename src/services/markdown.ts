import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { sectionDefinitions, type Note } from "../../shared/note";
const renderer = new MarkdownIt({ html: false, linkify: true, breaks: true });
export function renderedNote(note: Note, assetBase = ""): string {
  const markdown = sectionDefinitions
    .filter((s) => note.sections[s.key])
    .map((s) => `## ${s.label}\n\n${note.sections[s.key]}`)
    .join("\n\n");
  let html = DOMPurify.sanitize(renderer.render(markdown));
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const image of document.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    const asset = note.assets.find(
      (a) => a.path === src || `/${a.path}` === src,
    );
    if (asset?.dataUrl) image.src = asset.dataUrl;
    else if (assetBase && src.startsWith("assets/uploads/"))
      image.src = `${assetBase}/${src}`;
    image.loading = "lazy";
    image.alt ||= "笔记插图";
  }
  for (const link of document.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  html = DOMPurify.sanitize(document.body.innerHTML);
  return html;
}
