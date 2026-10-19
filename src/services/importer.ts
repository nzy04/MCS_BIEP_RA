import type { NoteAsset } from "../../shared/note";
import DOMPurify from "dompurify";
import { htmlToMarkdown } from "./htmlToMarkdown";
import { validateDocumentArchive } from "./archive";
export interface ParsedDocument {
  text: string;
  assets: NoteAsset[];
  warnings: string[];
  pages?: number;
}
const maxFileSize = 15 * 1024 * 1024;
export async function parseDocument(
  file: File,
  noteId: string,
  requireText = true,
): Promise<ParsedDocument> {
  if (file.size > maxFileSize)
    throw new Error("初版支持 15 MB 以内的文件，请先压缩或拆分。");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "doc")
    throw new Error("请先在 Word 中将 .doc 另存为 .docx，再导入。");
  if (["md", "txt", "markdown"].includes(extension ?? "")) {
    let text = await file.text();
    // Published Markdown can be imported without exposing YAML as note content.
    if (text.startsWith("---\n") || text.startsWith("---\r\n"))
      text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    return { text, assets: [], warnings: [] };
  }
  if (extension === "docx") {
    const buffer = await file.arrayBuffer();
    validateDocumentArchive(new Uint8Array(buffer));
    const { default: mammoth } = await import("mammoth/mammoth.browser");
    const assets: NoteAsset[] = [];
    const warnings: string[] = [];
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='标题'] => h1:fresh",
          "p.Heading1 => h2:fresh",
          "p.Heading2 => h3:fresh",
          "p.Heading3 => h4:fresh",
          "p[style-name='heading 1'] => h2:fresh",
          "p[style-name='heading 2'] => h3:fresh",
          "p[style-name='heading 3'] => h4:fresh",
        ],
        convertImage: mammoth.images.imgElement(
          async (image: {
            contentType: string;
            read: (type: string) => Promise<string>;
          }) => {
            if (
              !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
                image.contentType,
              )
            ) {
              warnings.push(
                "文档含不支持的图片格式，请在编辑时改用 PNG 或 JPG。",
              );
              return { src: "", alt: "需要重新插入的图片" };
            }
            const base64 = await image.read("base64");
            const ext = image.contentType.split("/")[1].replace("jpeg", "jpg");
            const path = `assets/uploads/${noteId}/image-${assets.length + 1}.${ext}`;
            assets.push({
              path,
              mime: image.contentType,
              size:
                (base64.length * 3) / 4 -
                (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0),
              dataUrl: `data:${image.contentType};base64,${base64}`,
            });
            return { src: path };
          },
        ),
      },
    );
    const text = htmlToMarkdown(DOMPurify.sanitize(result.value), assets);
    return {
      text,
      assets,
      warnings: [
        ...warnings,
        ...result.messages.map((m: { message: string }) => m.message),
      ],
    };
  }
  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const { default: workerUrl } = await import(
      "pdfjs-dist/build/pdf.worker.min.mjs?url"
    );
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      wasmUrl: import.meta.env.DEV
        ? "/node_modules/pdfjs-dist/wasm/"
        : "/pdf/wasm/",
      iccUrl: import.meta.env.DEV
        ? "/node_modules/pdfjs-dist/iccs/"
        : "/pdf/iccs/",
      cMapUrl: import.meta.env.DEV
        ? "/node_modules/pdfjs-dist/cmaps/"
        : "/pdf/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: import.meta.env.DEV
        ? "/node_modules/pdfjs-dist/standard_fonts/"
        : "/pdf/standard_fonts/",
    });
    try {
      const pdf = await loadingTask.promise;
      if (pdf.numPages > 100)
        throw new Error("初版支持 100 页以内的 PDF，请先拆分文件。");
      if (!requireText)
        return { text: "", assets: [], warnings: [], pages: pdf.numPages };
      const pages: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let previousY: number | undefined;
        let text = "";
        for (const item of content.items)
          if ("str" in item) {
            const y = item.transform[5];
            if (previousY !== undefined && Math.abs(y - previousY) > 4)
              text += "\n";
            text += item.str + (item.hasEOL ? "\n" : " ");
            previousY = y;
          }
        pages.push(`<!-- 原文第 ${i} 页 -->\n${text.trim()}`);
      }
      const text = pages.join("\n\n");
      if (text.replace(/<!--.*?-->/g, "").trim().length < 30)
        throw new Error(
          "这个 PDF 没有足够的可提取文字，可能是扫描件。初版尚未接入 OCR，请上传 Word 或文字版 PDF。",
        );
      return {
        text,
        assets: [],
        warnings: [
          "PDF 已提取文字；请对照原文件确认分栏顺序、公式和表格。PDF 中的插图可在下一步手动补充。",
        ],
        pages: pdf.numPages,
      };
    } finally {
      await loadingTask.destroy();
    }
  }
  throw new Error("暂支持 PDF、DOCX、Markdown 和 TXT。");
}
