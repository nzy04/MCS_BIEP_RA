import MarkdownIt from "markdown-it";
import { tex } from "@mdit/plugin-tex";
import katex, { type KatexOptions } from "katex";

export const mathOptions: KatexOptions = {
  trust: false,
  throwOnError: false,
  strict: "ignore",
  maxExpand: 500,
  maxSize: 20,
};
export const mathSelector =
  'span[data-type="inline-math"],div[data-type="block-math"]';

/** Parse math before Markdown consumes backslashes, underscores and asterisks. */
export function useMath(renderer: MarkdownIt): void {
  renderer.use(tex, {
    delimiters: "all",
    mathFence: true,
    render: (source: string, display: boolean) => {
      const tag = display ? "div" : "span";
      const latex = renderer.utils.escapeHtml(source.trim());
      return `<${tag} data-type="${display ? "block" : "inline"}-math" data-latex="${latex}">${latex}</${tag}>${display ? "\n" : ""}`;
    },
  });
}

/** Only KaTeX-generated markup is added after sanitizing user HTML. */
export function renderMath(document: Document): void {
  for (const host of document.querySelectorAll<HTMLElement>(mathSelector)) {
    const source = host.getAttribute("data-latex") || "";
    host.replaceChildren();
    host.className = "note-math";
    try {
      if (source.length > 10_000) throw new Error("Formula too long");
      host.innerHTML = katex.renderToString(source, {
        ...mathOptions,
        displayMode: host.getAttribute("data-type") === "block-math",
      });
    } catch {
      host.textContent = source;
      host.classList.add("math-error");
    }
  }
}
