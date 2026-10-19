import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { validateDocumentArchive } from "../src/services/archive";

test("Word ZIP 展开检查接受正常文档，拒绝压缩炸弹和过多条目", () => {
  assert.doesNotThrow(() =>
    validateDocumentArchive(
      zipSync({
        "word/document.xml": strToU8("<document>笔记内容</document>"),
      }),
    ),
  );
  const large = zipSync({
    "word/document.xml": new Uint8Array(31 * 1024 * 1024),
  });
  assert.ok(large.length < 15 * 1024 * 1024);
  assert.throws(() => validateDocumentArchive(large), /展开后超过 30 MB/);
  assert.throws(
    () =>
      validateDocumentArchive(
        zipSync(
          Object.fromEntries(
            Array.from({ length: 1001 }, (_, i) => [
              `word/${i}.xml`,
              new Uint8Array(),
            ]),
          ),
        ),
      ),
    /文件过多/,
  );
});
