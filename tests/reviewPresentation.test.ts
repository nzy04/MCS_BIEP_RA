import test from "node:test";
import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { reviewDecorations } from "../src/services/reviewHighlights";
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
test("导出保留补充内容和参考来源，不插入 AI 标志或冗余说明", () => {
  const note = createNote();
  note.year = "2018";
  note.review = {
    policyVersion: "test",
    model: "test",
    reviewedAt: "2026-10-19",
    directions: [],
    sources: [
      { title: "论文原文", url: "https://example.org/paper", kind: "provided" },
    ],
    supplements: [
      { field: "year", value: "2018", sourceUrl: "https://example.org/paper" },
    ],
  };
  assert.ok(toMarkdown(note).includes("- 2018"));
  assert.ok(toMarkdown(note).includes("https://example.org/paper"));
  assert.ok(!toMarkdown(note).includes("<kbd>AI</kbd>"));
  assert.ok(!toMarkdown(note).includes("自动补充"));
  note.year = "2019";
  assert.ok(!toMarkdown(note).includes("- 2018"));
  assert.ok(!toMarkdown(note).includes("<kbd>AI</kbd>"));
});
