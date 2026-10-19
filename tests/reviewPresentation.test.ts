import test from "node:test";
import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { reviewDecorations } from "../src/services/reviewHighlights";
import { aiSupplement } from "../shared/ai";
import { createNote, toMarkdown } from "../shared/note";
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 2 } },
    },
    text: { group: "inline" },
  },
});
test("审核原句或章节可定位标红，批注不写入文档内容", () => {
  const doc = schema.node("doc", null, [
    schema.node("heading", { level: 2 }, schema.text("核心方法")),
    schema.node("paragraph", null, schema.text("这段说明需要补充依据。")),
  ]);
  const original = doc.toJSON();
  const marked = reviewDecorations(doc, [
    { field: "method", message: "说明状态如何预测", quote: "需要补充依据" },
    { field: "method", message: "补充关键模块" },
  ]).find();
  assert.ok(marked.some((d) => d.type.attrs.class === "review-mark"));
  assert.ok(marked.some((d) => d.type.attrs.class === "review-section-mark"));
  assert.deepEqual(doc.toJSON(), original);
  assert.equal(
    reviewDecorations(doc, [{ field: "year", message: "核对年份" }]).find()
      .length,
    0,
  );
});
test("AI 标记只属于仍与补充值一致的字段，手动改值后消失，导出无冗余补充措辞", () => {
  const note = createNote();
  note.year = "2018";
  note.review = {
    policyVersion: "test",
    model: "test",
    reviewedAt: "2026-10-19",
    directions: [],
    sources: [],
    supplements: [
      { field: "year", value: "2018", sourceUrl: "https://example.org/paper" },
    ],
  };
  assert.equal(aiSupplement(note, "year"), true);
  assert.equal(aiSupplement(note, "paperUrl"), false);
  assert.ok(toMarkdown(note).includes("<kbd>AI</kbd>"));
  assert.ok(!toMarkdown(note).includes("自动补充"));
  note.year = "2019";
  assert.equal(aiSupplement(note, "year"), false);
  assert.ok(!toMarkdown(note).includes("<kbd>AI</kbd>"));
});
