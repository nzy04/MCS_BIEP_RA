import MarkdownIt from "markdown-it";
import type { NoteAsset } from "../../shared/note";
const reader = new MarkdownIt({ html: true });
const mimeByExtension: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function replaceImageSource(
  text: string,
  source: string,
  replacement: string,
): string {
  const value = escape(source);
  return text
    .replace(
      new RegExp(`(\\]\\(<?)${value}(?=>?(?:[\\s)]))`, "g"),
      `$1${replacement}`,
    )
    .replace(
      new RegExp(`(\\bsrc=["'])${value}(["'])`, "g"),
      `$1${replacement}$2`,
    )
    .replace(
      new RegExp(
        `(^[ \\t]*\\[[^\\]]+\\]:[ \\t]*<?)${value}(?=>?(?:[ \\t]|$))`,
        "gm",
      ),
      `$1${replacement}`,
    );
}

export function imageSources(text: string): string[] {
  const sources = new Set<string>();
  const visit = (tokens: ReturnType<typeof reader.parse>) => {
    for (const token of tokens) {
      if (token.type === "image") sources.add(token.attrGet("src") || "");
      if (token.type === "html_block" || token.type === "html_inline") {
        const doc = new DOMParser().parseFromString(token.content, "text/html");
        doc
          .querySelectorAll("img")
          .forEach((img) => sources.add(img.getAttribute("src") || ""));
      }
      if (token.children) visit(token.children);
    }
  };
  visit(reader.parse(text, {}));
  return [...sources].filter(Boolean);
}

export async function makeImageAsset(
  file: File,
  noteId: string,
): Promise<NoteAsset> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const mime = file.type || mimeByExtension[extension];
  if (!Object.values(mimeByExtension).includes(mime))
    throw new Error("请选择 PNG、JPG、WebP 或 GIF 图片。");
  if (file.size > 2 * 1024 * 1024)
    throw new Error("单张插图请控制在 2 MB 以内。");
  const bytes = await file.arrayBuffer();
  const signature = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20);
  const ext = mime.split("/")[1].replace("jpeg", "jpg");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes], { type: mime }));
  });
  return {
    path: `assets/uploads/${noteId}/image-${signature}.${ext}`,
    name: file.name,
    mime,
    size: file.size,
    dataUrl,
  };
}

export async function bindMarkdownImages(
  text: string,
  files: File[],
  noteId: string,
) {
  const assets: NoteAsset[] = [];
  const warnings: string[] = [];
  for (const source of imageSources(text)) {
    if (/^https?:/i.test(source)) continue;
    if (/^data:image\//i.test(source)) {
      const blob = await (await fetch(source)).blob();
      const asset = await makeImageAsset(
        new File([blob], "pasted-image", { type: blob.type }),
        noteId,
      );
      if (!assets.some((a) => a.path === asset.path)) assets.push(asset);
      text = replaceImageSource(text, source, asset.path);
      continue;
    }
    let decoded = source;
    try {
      decoded = decodeURIComponent(source);
    } catch {
      /* Keep literal filenames. */
    }
    const basename = decoded
      .replace(/\\/g, "/")
      .split(/[?#]/)[0]
      .split("/")
      .pop();
    const candidates = files.filter((f) => f.name === basename);
    if (candidates.length !== 1) {
      warnings.push(
        `图片未绑定：${source}。请同时选择对应图片，或在编辑器中重新插入。`,
      );
      continue;
    }
    const asset = await makeImageAsset(candidates[0], noteId);
    if (!assets.some((a) => a.path === asset.path)) assets.push(asset);
    text = replaceImageSource(text, source, asset.path);
  }
  return { text, assets, warnings };
}
