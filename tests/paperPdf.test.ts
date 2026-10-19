import test from "node:test";
import assert from "node:assert/strict";
import { createNote, toMarkdown } from "../shared/note";
import { inferPdfUrl, findFreePdf } from "../worker/paperPdf";
import { reviewSubmission, titleScore } from "../worker/review";
import { validateIncoming } from "../worker/app";
const settings = { DEEPSEEK_API_KEY: "test-key" };
const reply = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const chat = () =>
  reply({
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            approved: true,
            issues: [],
            directions: ["世界模型"],
            extractions: [],
          }),
        },
      },
    ],
  });
function note() {
  return {
    ...createNote(),
    title: "World Models",
    paperUrl: "https://doi.org/10.1000/world",
    year: "2018",
    body:
      "## 研究问题与方法\n" +
      "这篇论文研究学习环境动态并在模型中优化策略，通过视觉编码器压缩观测、循环模型预测状态、控制器生成动作。".repeat(
        3,
      ) +
      "\n## 我的思考\n我认为需要检验长期预测时模型误差累积是否导致策略失效，同时控制真实交互预算比较基线，不能单凭奖励判断有效性。",
  };
}
const entry = (id = "1803.10122v4", title = "World Models", year = "2018") =>
  `<entry><id>http://arxiv.org/abs/${id}</id><title>${title}</title><published>${year}-03-27</published><author><name>David Ha</name></author></entry>`;

test("已提供 PDF 链接或附件只审核一次，不检索也不覆盖已有资源", async () => {
  for (const type of ["url", "asset"]) {
    const n = note();
    if (type === "url") n.pdfUrl = "https://example.edu/paper.pdf";
    else
      n.assets = [
        {
          path: `assets/uploads/${n.id}/paper.pdf`,
          mime: "application/pdf",
          size: 20,
        },
      ];
    let calls = 0;
    const result = await reviewSubmission(n, settings, [], async (u) => {
      assert.equal(String(u), "https://api.deepseek.com/chat/completions");
      calls++;
      return chat();
    });
    assert.equal(result.approved, true);
    assert.equal(calls, 1);
    assert.equal(result.note.pdfUrl, n.pdfUrl);
    assert.equal(result.receipt?.supplements.length, 0);
  }
});
test("arXiv、OpenReview 等已知来源规则补充 PDF，无需检索或额外模型调用", async () => {
  const n = note();
  n.paperUrl = "https://arxiv.org/abs/1803.10122v4";
  let calls = 0;
  const result = await reviewSubmission(n, settings, [], async (u) => {
    calls++;
    assert.equal(String(u), "https://api.deepseek.com/chat/completions");
    return chat();
  });
  assert.equal(calls, 1);
  assert.equal(result.note.pdfUrl, "https://arxiv.org/pdf/1803.10122v4");
  assert.equal(result.receipt?.supplements[0].field, "pdfUrl");
  assert.equal(n.pdfUrl, "");
  assert.equal(
    inferPdfUrl("https://openreview.net/forum?id=abc-123"),
    "https://openreview.net/pdf?id=abc-123",
  );
  assert.equal(
    inferPdfUrl("https://proceedings.mlr.press/v202/author23a.html"),
    "https://proceedings.mlr.press/v202/author23a/author23a.pdf",
  );
  for (const url of [
    "https://arxiv.org.evil.test/abs/1803.10122",
    "https://user@arxiv.org/abs/1803.10122",
    "http://arxiv.org/abs/1803.10122",
    "https://arxiv.org:8888/abs/1803.10122",
    "https://127.0.0.1/a.pdf",
  ])
    assert.equal(inferPdfUrl(url), "");
});
test("仅提供标题时先免费定位论文和 PDF，不提前进入付费搜索", async () => {
  const n = note();
  n.paperUrl = "";
  n.year = "";
  let searches = 0;
  const result = await reviewSubmission(n, settings, [], async (u) => {
    if (String(u).includes("arxiv"))
      return new Response(`<feed>${entry()}</feed>`);
    if (String(u).includes("crossref"))
      return reply({ message: { items: [] } });
    if (String(u).includes("tools/search")) {
      searches++;
      throw new Error("should not search");
    }
    return chat();
  });
  assert.equal(searches, 0);
  assert.equal(result.approved, true);
  assert.equal(result.note.paperUrl, "https://arxiv.org/abs/1803.10122v4");
  assert.equal(result.note.pdfUrl, "https://arxiv.org/pdf/1803.10122v4");
  assert.equal(result.note.year, "2018");
});
test("上传笔记后缺失 PDF 时免费 API 唯一匹配后补充，成功不调用搜索兜底", async () => {
  const calls: string[] = [];
  const n = note();
  const result = await reviewSubmission(n, settings, [], async (u) => {
    calls.push(String(u));
    if (String(u).includes("arxiv"))
      return new Response(`<feed>${entry()}</feed>`);
    if (String(u).includes("crossref"))
      return reply({
        message: { DOI: "10.1000/world", title: ["World Models"] },
      });
    return chat();
  });
  assert.equal(result.approved, true);
  assert.equal(calls.length, 3);
  assert.equal(calls.filter((u) => u.includes("tools/search")).length, 0);
  assert.equal(result.note.pdfUrl, "https://arxiv.org/pdf/1803.10122v4");
  assert.equal(
    result.receipt?.supplements[0].sourceUrl,
    "https://arxiv.org/abs/1803.10122v4",
  );
  const persisted = validateIncoming({ note: result.note, assets: [] }).note;
  assert.equal(persisted.pdfUrl, result.note.pdfUrl);
  assert.match(
    toMarkdown(persisted),
    /pdf_url: "https:\/\/arxiv.org\/pdf\/1803.10122v4"/,
  );
});
test("免费机制失败才调用一次共享搜索，模型只能审核，不能编造下载链接", async () => {
  const calls: string[] = [];
  const result = await reviewSubmission(
    note(),
    settings,
    [],
    async (u, init) => {
      calls.push(String(u));
      if (String(u).includes("arxiv")) return new Response("<feed/>");
      if (String(u).includes("crossref")) return reply({ message: {} });
      if (String(u).includes("tools/search")) {
        assert.match(JSON.parse(String(init?.body)).query, /paper pdf$/);
        return reply({
          results: [
            {
              title: "World Models",
              url: "https://arxiv.org/abs/1803.10122",
              rerank_score: 2,
            },
          ],
        });
      }
      return chat();
    },
  );
  assert.equal(result.note.pdfUrl, "https://arxiv.org/pdf/1803.10122");
  assert.equal(calls.filter((u) => u.includes("tools/search")).length, 1);
  assert.equal(calls.filter((u) => u.includes("chat/completions")).length, 1);
  assert.equal(result.receipt?.sources.at(-1)?.kind, "search");
});
test("同名歧义、年份不符或伪造来源不补充，失败提示保留且不丢失有效笔记", async () => {
  for (const xml of [
    `<feed>${entry()}${entry("1901.12345")}</feed>`,
    `<feed>${entry("2501.12345", "World Models", "2025")}</feed>`,
  ])
    assert.equal(
      await findFreePdf(note(), titleScore, async (u) =>
        String(u).includes("arxiv")
          ? new Response(xml)
          : reply({ message: {} }),
      ),
      null,
    );
  let searches = 0;
  const n = note();
  const result = await reviewSubmission(n, settings, [], async (u) => {
    if (String(u).includes("arxiv"))
      return new Response(`<feed>${entry()}${entry("1901.12345")}</feed>`);
    if (String(u).includes("crossref")) return reply({ message: {} });
    if (String(u).includes("tools/search")) {
      searches++;
      return reply({
        results: [
          {
            title: "World Models",
            url: "https://arxiv.org.evil.test/pdf/1803.10122",
            rerank_score: 20,
          },
        ],
      });
    }
    return chat();
  });
  assert.equal(result.approved, true);
  assert.equal(result.note.pdfUrl, "");
  assert.match(result.receipt?.pdfNotice || "", /未找到可确认/);
  assert.equal(result.note.body, n.body);
  assert.equal(searches, 1);
});
test("补充论文来源已使用搜索时，不为 PDF 再次调用付费兜底", async () => {
  const n = note();
  n.paperUrl = "";
  let searches = 0;
  const result = await reviewSubmission(n, settings, [], async (u) => {
    if (String(u).includes("arxiv")) return new Response("<feed/>");
    if (String(u).includes("crossref"))
      return reply({ message: { items: [] } });
    if (String(u).includes("tools/search")) {
      searches++;
      return reply({
        results: [
          {
            title: "World Models",
            url: "https://doi.org/10.1000/world",
            rerank_score: 2,
          },
        ],
      });
    }
    return chat();
  });
  assert.equal(result.approved, true);
  assert.equal(searches, 1);
  assert.equal(result.note.pdfUrl, "");
  assert.ok(result.receipt?.pdfNotice);
});
test("Crossref 明确 DOI 和安全 PDF 元数据可补充，非法链接或过长 PDF 字段拒绝", async () => {
  const n = note();
  const result = await findFreePdf(n, titleScore, async (u) =>
    String(u).includes("arxiv")
      ? new Response("<feed/>")
      : reply({
          message: {
            DOI: "10.1000/world",
            title: ["World Models"],
            published: { "date-parts": [[2018]] },
            link: [
              {
                "content-type": "application/pdf",
                URL: "https://proceedings.mlr.press/v202/author23a/author23a.pdf",
              },
            ],
          },
        }),
  );
  assert.equal(
    result?.url,
    "https://proceedings.mlr.press/v202/author23a/author23a.pdf",
  );
  assert.throws(
    () => validateIncoming({ note: { ...n, pdfUrl: "javascript:alert(1)" } }),
    /完整的 http/,
  );
  assert.throws(
    () => validateIncoming({ note: { ...n, pdfUrl: "x".repeat(1501) } }),
    /pdfUrl/,
  );
});
