import { unzipSync } from "fflate";

/** Inspect ZIP headers without expanding file contents (DOCX is a ZIP container). */
export function validateDocumentArchive(bytes: Uint8Array) {
  let total = 0,
    count = 0;
  unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize;
      count++;
      if (total > 30 * 1024 * 1024 || count > 1000)
        throw new Error(
          "Word 文档展开后超过 30 MB 或文件过多，请压缩图片后重新导入。",
        );
      return false;
    },
  });
}
