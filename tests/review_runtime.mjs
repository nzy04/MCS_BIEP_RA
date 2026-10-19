import path from "node:path";
import assert from "node:assert/strict";
import {
  Miniflare,
  Response,
  runtimeOptions,
} from "./support/workerRuntime.mjs";
const persist = path.resolve(`test-results/review-runtime-${Date.now()}`);
let modelCalls = 0,
  gitWrites = 0;
const settings = {
  bindings: {
    SITE_TITLE: "MCS_BIEP",
    GITHUB_OWNER: "test-group",
    GITHUB_REPO: "test-repo",
    GITHUB_BRANCH: "main",
    SESSION_SECRET: "only-a-test-session-key-with-32-characters",
    DEEPSEEK_API_KEY: "only-a-test-api-key",
    // Existing dashboard variables must no longer impose daily quotas.
    REVIEW_DAILY_LIMIT: "1",
    REVIEW_USER_DAILY_LIMIT: "1",
  },
  outboundService: async (request) => {
    const url = new URL(request.url);
    if (
      url.host === "api.github.com" &&
      url.pathname === "/repos/test-group/test-repo"
    )
      return Response.json({ permissions: { push: true } });
    if (url.host === "api.github.com" && url.pathname.includes("/contents/"))
      return Response.json({ message: "not found" }, { status: 404 });
    if (url.host === "api.github.com") {
      gitWrites++;
      return Response.json(
        { message: "No writes allowed in rejection test" },
        { status: 500 },
      );
    }
    if (
      url.host === "api.deepseek.com" &&
      url.pathname === "/chat/completions"
    ) {
      modelCalls++;
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                approved: false,
                issues: [
                  {
                    field: "insights",
                    message: "请给出可检验的个人判断和理由。",
                  },
                ],
                directions: ["世界模型"],
                extractions: [],
              }),
            },
          },
        ],
      });
    }
    return new Response("Unexpected outbound request", { status: 500 });
  },
};
const runtimeSettings = runtimeOptions(
  "review-runtime-test",
  persist,
  settings.bindings,
  settings.outboundService,
);
const person = {
  id: 7,
  login: "runtime-member",
  name: "测试成员",
  avatar: "",
  canWrite: true,
  token: "test-token",
  expires: Date.now() + 3600_000,
};
const sections = {
  summary:
    "研究用学习的环境模型支持策略训练，从视觉表示、动态预测和控制三个层面组织整个方法。",
  problem:
    "主要问题是直接训练需要较多真实交互，同时高维输入增加学习负担，需要减少环境采样成本。",
  method:
    "该方案利用潜在表示压缩视觉输入，随后学习时序变化，并在该表示中训练一个轻量控制器进行决策。",
  evidence: "",
  limitations: "",
  insights:
    "我认为需要测试更长预测过程中的误差积累对最终决策的影响，不能只比较模型训练损失或任务奖励。",
  original: "",
};
const note = {
  id: `note-${crypto.randomUUID()}`,
  title: "World Models",
  subtitle: "",
  year: "2018",
  venue: "arXiv",
  tags: [],
  paperUrl: "https://arxiv.org/abs/1803.10122",
  codeUrl: "",
  author: "测试成员",
  authorLogin: "",
  createdAt: "",
  updatedAt: "",
  revision: "",
  excerpt: "",
  readingDepth: "阅读笔记",
  body: "待补充",
  sections,
  assets: [],
  sourceNames: [],
};
let mf;
async function stub(instance) {
  const ns = await instance.getDurableObjectNamespace("REVIEW_QUEUE");
  return ns.get(ns.idFromName("runtime-review"));
}
async function call(target, action, submission = note) {
  return target.fetch("https://review.internal/", {
    method: "POST",
    body: JSON.stringify({
      action,
      user: person,
      ...(action === "submit"
        ? { value: { note: submission, assets: [], baseRevision: "" } }
        : {}),
    }),
  });
}
try {
  mf = new Miniflare(runtimeSettings);
  let target = await stub(mf);
  const accepted = await call(target, "submit");
  assert.equal(accepted.status, 202);
  const submitted = await accepted.json();
  assert.equal(submitted.job.status, "queued");
  assert.equal(modelCalls, 0);
  await mf.dispose();
  mf = new Miniflare(runtimeSettings);
  target = await stub(mf);
  let job;
  for (let i = 0; i < 40; i++) {
    job = (await (await call(target, "list")).json()).jobs[0];
    if (job.status === "needs_changes") break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(
    job.status,
    "needs_changes",
    JSON.stringify({ job, modelCalls, gitWrites }),
  );
  assert.equal(modelCalls, 0);
  assert.equal(gitWrites, 0);
  assert.equal(job.issues[0].field, "summary");
  const detail = await target.fetch("https://review.internal/", {
    method: "POST",
    body: JSON.stringify({ action: "detail", user: person, id: job.id }),
  });
  assert.equal((await detail.json()).note.body, "待补充");
  for (let i = 0; i < 51; i++) {
    const extra = await call(target, "submit", {
      ...note,
      id: `note-${crypto.randomUUID()}`,
    });
    assert.equal(
      extra.status,
      202,
      `Submission ${i + 2}: ${await extra.text()}`,
    );
  }
  await mf.dispose();
  mf = new Miniflare(runtimeSettings);
  target = await stub(mf);
  assert.equal((await (await call(target, "list")).json()).jobs.length, 52);
  assert.equal((await call(target, "submit")).status, 200);
  assert.equal(modelCalls, 0);
  assert.equal(gitWrites, 0);
  console.log(
    JSON.stringify({
      sqlitePersistence: true,
      alarmAfterRestart: true,
      modelCalls,
      gitWrites,
      status: job.status,
      placeholderFeedbackWithoutModelCharge: true,
      dailySubmissionQuotaRemoved: true,
      submissionsPersisted: 52,
      duplicateSubmissionReused: true,
    }),
  );
} finally {
  await mf?.dispose();
}
