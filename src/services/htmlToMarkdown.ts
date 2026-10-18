import Turndown from "turndown";
import DOMPurify from "dompurify";
import type { NoteAsset } from "../../shared/note";

export function sanitizeNoteHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "strong",
      "b",
      "em",
      "i",
      "s",
      "del",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "a",
      "img",
      "table",
      "caption",
      "thead",
      "tbody",
      "tfoot",
      "tr",
      "th",
      "td",
      "colgroup",
      "col",
      "hr",
      "div",
      "span",
      "figure",
      "figcaption",
    ],
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "colspan",
      "rowspan",
      "align",
      "start",
      "class",
    ],
  });
}

export function htmlToMarkdown(
  html: string,
  assets: NoteAsset[] = [],
  assetBase = "",
): string {
  const document = new DOMParser().parseFromString(
    sanitizeNoteHtml(html),
    "text/html",
  );
  for (const img of document.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    const asset = assets.find(
      (a) =>
        a.path === src ||
        a.dataUrl === src ||
        (assetBase && `${assetBase}/${a.path}` === src),
    );
    if (asset) img.setAttribute("src", asset.path);
  }
  const converter = new Turndown({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  converter.addRule("note-table", {
    filter: "table",
    replacement: (_content, node) => {
      const table = node as HTMLTableElement;
      const rows = Array.from(table.rows);
      if (!rows.length) return "";
      const firstIsHeader = Array.from(rows[0].cells).every(
        (c) => c.tagName === "TH",
      );
      const merged = table.querySelector(
        '[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"]),table table',
      );
      const columns = Math.max(...rows.map((r) => r.cells.length));
      if (
        !firstIsHeader ||
        merged ||
        Array.from(table.querySelectorAll("td,th")).some((c) =>
          c.querySelector("p + p, ul, ol, table"),
        )
      )
        return `\n\n${sanitizeNoteHtml(table.outerHTML)}\n\n`;
      const content = rows.map((row) => {
        const cells = Array.from(row.cells).map((cell) =>
          converter
            .turndown(cell.innerHTML)
            .replace(/\n/g, "<br>")
            .replace(/\|/g, "\\|")
            .trim(),
        );
        while (cells.length < columns) cells.push("");
        return `| ${cells.join(" | ")} |`;
      });
      content.splice(1, 0, `| ${Array(columns).fill("---").join(" | ")} |`);
      return `\n\n${content.join("\n")}\n\n`;
    },
  });
  return converter.turndown(document.body.innerHTML).trim();
}
