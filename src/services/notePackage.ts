import { unzipSync, zipSync, strToU8 } from "fflate";
import type { Note } from "../../shared/note";
import { toMarkdown } from "../../shared/note";
import { replaceImageSource } from "./noteMedia";
export async function unpackNotePackage(file: File): Promise<File[]> {
  if (file.size > 15 * 1024 * 1024)
    throw new Error("笔记包请控制在 15 MB 以内。");
  let total = 0,
    count = 0;
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      if (
        /^(?:[\\/]|[a-z]:)/i.test(entry.name) ||
        entry.name.split(/[\\/]/).includes("..")
      )
        throw new Error("压缩包含不合法的文件路径。");
      if (
        entry.name.endsWith("/") ||
        entry.name.startsWith("__MACOSX/") ||
        entry.name.split("/").some((p) => p.startsWith("."))
      )
        return false;
      total += entry.originalSize;
      count++;
      if (
        total > 30 * 1024 * 1024 ||
        entry.originalSize > 15 * 1024 * 1024 ||
        count > 80
      )
        throw new Error("压缩包展开后过大，请仅保留一份笔记及其图片。");
      return /\.(md|markdown|txt|pdf|docx|png|jpe?g|webp|gif)$/i.test(
        entry.name,
      );
    },
  });
  const mimes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    pdf: "application/pdf",
  };
  return Object.entries(entries).map(
    ([name, bytes]) =>
      new File(
        [bytes.slice().buffer],
        name.replace(/\\/g, "/").split("/").pop()!,
        { type: mimes[name.split(".").pop()?.toLowerCase() || ""] || "" },
      ),
  );
}
export async function exportNotePackage(
  note: Note,
  assetBase: string,
): Promise<Blob> {
  let markdown = toMarkdown(note);
  const files: Record<string, Uint8Array> = {};
  for (const asset of note.assets) {
    const name = asset.path.split("/").pop()!;
    const response = await fetch(asset.dataUrl || `${assetBase}/${asset.path}`);
    if (!response.ok)
      throw new Error(`无法读取附件：${asset.name || name}。请稍后重试。`);
    files[name] = new Uint8Array(await response.arrayBuffer());
    markdown = replaceImageSource(markdown, `../${asset.path}`, name);
  }
  files["note.md"] = strToU8(markdown);
  return new Blob([zipSync(files, { level: 3 }).buffer as ArrayBuffer], {
    type: "application/zip",
  });
}
