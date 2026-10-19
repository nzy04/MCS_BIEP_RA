import test from "node:test";
import assert from "node:assert/strict";
import { createNote, toMarkdown, type Note } from "../shared/note";
import {
  academicUrl,
  checkDeepseek,
  reviewSubmission,
  type ReviewOutcome,
} from "../worker/review";
import {
  ReviewQueue,
  type QueueState,
  type QueueStorage,
} from "../worker/reviewQueue";
import { handle, seal, type Env, type Identity } from "../worker/app";

const env: Env = {
  ASSETS: { fetch: async () => new Response("site") },
  SITE_TITLE: "MCS_BIEP",
  GITHUB_OWNER: "group",
  GITHUB_REPO: "repo",
  GITHUB_BRANCH: "main",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "private-client-secret",
  SESSION_SECRET: "private-session-secret-at-least-32-characters",
  DEEPSEEK_API_KEY: "private-deepseek-secret",
};
const user: Identity = {
  login: "member",
  name: "成员",
  avatar: "",
  canWrite: true,
  token: "private-github-token",
  id: 7,
  expires: Date.now() + 3600_000,
};
function note() {
  const n = createNote();
  n.title = "World Models";
  n.paperUrl = "https://arxiv.org/abs/1803.10122";
  n.year = "2018";
  n.sections.summary =
    "这篇论文通过学习环境的压缩表示、时序演化与控制策略，研究如何在想象环境中完成策略训练。";
  n.sections.problem =
    "直接从高维像素学习控制通常需要大量真实交互；作者研究能否用学习得到的模型减少与实际环境的交互。";
  n.sections.method =
    "方法将视觉编码、循环动态预测和控制器分开训练，并比较在真实环境与模型生成环境中得到的控制效果。";
  n.sections.insights =
    "我认为模型误差积累是迁移到真实场景的关键限制，需要结合更复杂环境检验，而不能只凭训练奖励判断有效性。";
  return n;
}
function model(overrides: Record<string, unknown> = {}) {
  return {
    approved: true,
    issues: [],
    directions: ["世界模型", "规划控制"],
    extractions: [],
    ...overrides,
  };
}

test("退回反馈保留可定位的真实原句，丢弃模型编造的引文", async () => {
  const n = note();
  const quote = n.sections.insights.slice(0, 16);
  const result = await reviewSubmission(n, env, [], async () =>
    chat(
      model({
        approved: false,
        issues: [
          { field: "insights", message: "请补充判断依据与适用条件", quote },
          {
            field: "method",
            message: "补充状态预测模块",
            quote: "这句话不在原文中",
          },
        ],
      }),
    ),
  );
  assert.equal(result.approved, false);
  assert.equal(result.issues[0].quote, quote);
  assert.equal(result.issues[1].quote, undefined);
});

test("手动选择的自定义文件夹完全保留，模型不能追加或改写", async () => {
  const n = note();
  n.tags = ["我的课题 / 子方向", "A"];
  const outcome = await reviewSubmission(n, env, [], async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const payload = JSON.parse(request.messages[1].content);
    assert.equal(payload.directionMode, "manual");
    assert.deepEqual(payload.selectedDirections, n.tags);
    return chat(model({ directions: ["模型想追加的方向"] }));
  });
  assert.equal(outcome.approved, true);
  assert.deepEqual(outcome.note.tags, n.tags);
  assert.deepEqual(outcome.receipt?.directions, n.tags);
  assert.equal(outcome.receipt?.directionSource, "manual");
});

test("未选择时复用空目录名称，支持模型创建全新学科方向且不额外增加请求", async () => {
  let calls = 0;
  const n = note();
  const outcome = await reviewSubmission(
    n,
    env,
    ["我的空文件夹"],
    async (_url, init) => {
      calls++;
      const payload = JSON.parse(
        JSON.parse(String(init?.body)).messages[1].content,
      );
      assert.equal(payload.directionMode, "automatic");
      assert.deepEqual(payload.existingDirections, ["我的空文件夹"]);
      assert.deepEqual(payload.selectedDirections, []);
      return chat(model({ directions: ["我的空文件夹", "全新的自定义学科"] }));
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(outcome.note.tags, ["我的空文件夹", "全新的自定义学科"]);
  assert.equal(outcome.receipt?.directionSource, "model");
  await assert.rejects(
    reviewSubmission(n, env, [], async () => chat(model({ directions: [] }))),
    /格式校验/,
  );
});
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const chat = (value = model(), finish = "stop") =>
  reply({
    choices: [
      { finish_reason: finish, message: { content: JSON.stringify(value) } },
    ],
  });
test("维护者连通检查只读取模型清单，不调用分析或泄露密钥", async () => {
  let calls = 0;
  assert.deepEqual(
    await checkDeepseek(env, async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.deepseek.com/models");
      assert.equal(init?.redirect, "manual");
      return reply({ data: [{ id: "deepseek-flash" }] });
    }),
    { ok: true, model: "deepseek-flash" },
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () => checkDeepseek(env, async () => reply({}, 401)),
    /校验失败/,
  );
  const cookie = `mcs_session=${await seal(user, env.SESSION_SECRET)}`;
  assert.equal(
    (await handle(new Request("https://site.test/api/reviews/connection"), env))
      .status,
    401,
  );
  assert.equal(
    (
      await handle(
        new Request("https://site.test/api/reviews/connection", {
          headers: { Cookie: cookie },
        }),
        env,
      )
    ).status,
    403,
  );
});
test("明显缺少个人理解时直接反馈，不调用任何付费或检索服务", async () => {
  const n = note();
  n.sections.insights = "";
  let calls = 0;
  const result = await reviewSubmission(n, env, [], async () => {
    calls++;
    throw new Error("must not call");
  });
  assert.equal(result.approved, false);
  assert.equal(calls, 0);
  assert.ok(result.issues.some((i) => i.field === "insights"));
});
test("资料完整只调用一次审核，正文不携带成员凭据，个人思考保持原文", async () => {
  const n = note(),
    requests: any[] = [];
  n.pdfUrl = "https://arxiv.org/pdf/1803.10122";
  const result = await reviewSubmission(
    n,
    env,
    ["世界模型"],
    async (url, init) => {
      requests.push({ url, ...init });
      assert.equal(String(url), "https://api.deepseek.com/chat/completions");
      const data = JSON.parse(String(init?.body));
      assert.equal(data.thinking.type, "disabled");
      assert.equal(data.max_tokens, 3000);
      assert.equal(data.response_format.type, "json_object");
      assert.ok(!String(init?.body).includes(user.token));
      assert.ok(!String(init?.body).includes(env.DEEPSEEK_API_KEY!));
      return chat();
    },
  );
  assert.equal(requests.length, 1);
  assert.equal(result.approved, true);
  assert.equal(result.note.sections.insights, n.sections.insights);
  assert.deepEqual(result.note.tags, ["世界模型", "规划控制"]);
  assert.equal(result.receipt?.supplements.length, 0);
});
test("先用免费元数据准确匹配，成功时不触发搜索兜底", async () => {
  const n = note();
  n.paperUrl = "";
  n.year = "";
  n.pdfUrl = "https://arxiv.org/pdf/1803.10122";
  const calls: string[] = [];
  const result = await reviewSubmission(n, env, [], async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://api.crossref.org/works?"))
      return reply({
        message: {
          items: [
            {
              DOI: "10.1000/world-models",
              title: [n.title],
              published: { "date-parts": [[2018]] },
              "container-title": ["Example proceedings"],
            },
          ],
        },
      });
    return chat();
  });
  assert.equal(result.approved, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((u) => !u.includes("tools/search")));
  assert.equal(result.note.paperUrl, "https://doi.org/10.1000/world-models");
  assert.equal(result.note.year, "2018");
  assert.equal(result.receipt?.supplements.length, 3);
  assert.equal(result.receipt?.sources[0]?.kind, "crossref");
});

test("完整图文笔记按实际内容审核，保留自定义章节和图表，语义退回仍有效", async () => {
  const n = note();
  n.body = `## 框架图与工作流\n\n${n.sections.problem}\n\n![框架图](assets/uploads/${n.id}/framework.png)\n\n图1 模型训练与控制流程。\n\n## 我的判断与关联\n\n${n.sections.method}\n\n${n.sections.insights}\n\n| 条件 | 观察 |\n| --- | --- |\n| 长期预测 | 误差累积需要检验 |`;
  let calls = 0;
  const approved = await reviewSubmission(n, env, [], async (_url, init) => {
    calls++;
    const payload = JSON.parse(String(init?.body));
    const content = JSON.parse(payload.messages[1].content);
    assert.equal(content.body, n.body);
    assert.ok(!("sections" in content));
    return chat();
  });
  assert.equal(calls, 1);
  assert.equal(approved.approved, true);
  assert.equal(approved.note.body, n.body);
  const rejected = await reviewSubmission(n, env, [], async () =>
    chat(
      model({
        approved: false,
        issues: [{ field: "insights", message: "请补充判断的具体依据。" }],
      }),
    ),
  );
  assert.equal(rejected.approved, false);
  assert.equal(rejected.note.body, n.body);
  assert.equal(rejected.issues[0]?.field, "insights");
});
test("免费定位失败才调用一次搜索，找不到唯一来源时不再花费聊天额度", async () => {
  const n = note();
  n.paperUrl = "";
  const calls: string[] = [];
  const result = await reviewSubmission(n, env, [], async (url) => {
    calls.push(String(url));
    if (String(url).includes("crossref"))
      return reply({ message: { items: [] } });
    if (String(url).endsWith("/v1/tools/search"))
      return reply({
        results: [
          {
            title: n.title,
            url: "https://untrusted.example/paper",
            rerank_score: 3,
          },
        ],
      });
    throw new Error("unexpected chat request");
  });
  assert.equal(result.approved, false);
  assert.equal(calls.filter((u) => u.includes("api.crossref.org")).length, 2);
  assert.equal(calls.filter((u) => u.includes("export.arxiv.org")).length, 1);
  assert.equal(calls.filter((u) => u.includes("tools/search")).length, 1);
  assert.equal(result.issues[0]?.field, "paperUrl");
  assert.equal(academicUrl("https://arxiv.org.evil.test/abs/123"), false);
  assert.equal(academicUrl("https://arxiv.org@evil.test/abs/123"), false);
});
test("搜索找到官方来源才补充，并记录来源后进行一次审核", async () => {
  const n = note();
  n.paperUrl = "";
  let searches = 0,
    chats = 0;
  const result = await reviewSubmission(n, env, [], async (url) => {
    if (String(url).includes("crossref"))
      return reply({ message: { items: [] } });
    if (String(url).includes("export.arxiv.org"))
      return new Response("<feed></feed>", { status: 503 });
    if (String(url).endsWith("/v1/tools/search")) {
      searches++;
      return reply({
        results: [
          {
            title: n.title,
            url: "https://arxiv.org/abs/1803.10122",
            rerank_score: 2.8,
          },
        ],
      });
    }
    chats++;
    return chat();
  });
  assert.equal(result.approved, true);
  assert.equal(searches, 1);
  assert.equal(chats, 1);
  assert.equal(
    result.receipt?.supplements[0]?.sourceUrl,
    "https://arxiv.org/abs/1803.10122",
  );
});
test("不接受模型编造个人思考，也不接受未完整返回的通过结果", async () => {
  await assert.rejects(
    () =>
      reviewSubmission(note(), env, [], async () =>
        chat(
          model({
            extractions: [
              { section: "insights", text: "模型自己编造的新观点" },
            ],
          }),
        ),
      ),
    /无法在原笔记中核对/,
  );
  await assert.rejects(
    () =>
      reviewSubmission(note(), env, [], async () => chat(model(), "length")),
    /未完整返回/,
  );
  await assert.rejects(
    () =>
      reviewSubmission(note(), env, [], async () =>
        chat(model({ approved: "true" })),
      ),
    /格式校验/,
  );
});
test("原始文字可以逐字分配到空模板，最终仍执行必填规则", async () => {
  const n = note(),
    originalInsights = n.sections.insights;
  n.sections.insights = "";
  n.sections.original = originalInsights;
  const result = await reviewSubmission(n, env, [], async () =>
    chat(
      model({ extractions: [{ section: "insights", text: originalInsights }] }),
    ),
  );
  assert.equal(result.approved, true);
  assert.equal(result.note.sections.insights, originalInsights);
  assert.equal(result.note.sections.original, originalInsights);
  const rejected = await reviewSubmission(n, env, [], async () => chat());
  assert.equal(rejected.approved, false);
  assert.ok(rejected.issues.some((i) => i.field === "insights"));
});

class MemoryStorage implements QueueStorage {
  data = new Map<string, any>();
  alarm: number | null = null;
  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key));
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    if (typeof key === "string") this.data.set(key, structuredClone(value));
    else
      for (const [k, v] of Object.entries(key))
        this.data.set(k, structuredClone(v));
  }
  async delete(key: string | string[]) {
    for (const k of Array.isArray(key) ? key : [key]) this.data.delete(k);
  }
  async list<T>({ prefix }: { prefix: string }): Promise<Map<string, T>> {
    return new Map(
      [...this.data]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => [k, structuredClone(v)]),
    );
  }
  async getAlarm() {
    return this.alarm;
  }
  async setAlarm(time: number) {
    this.alarm = time;
  }
  async transaction<T>(fn: (s: QueueStorage) => Promise<T>) {
    const snapshot = structuredClone(this.data),
      alarm = this.alarm;
    try {
      return await fn(this);
    } catch (error) {
      this.data = snapshot;
      this.alarm = alarm;
      throw error;
    }
  }
}
function fixture(
  overrides: Partial<ConstructorParameters<typeof ReviewQueue>[2]> = {},
) {
  const storage = new MemoryStorage();
  let mutation = Promise.resolve();
  const state: QueueState = {
    storage,
    blockConcurrencyWhile: (fn) => {
      const result = mutation.then(fn);
      mutation = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
  let reviews = 0,
    commits = 0;
  const outcome: ReviewOutcome = {
    approved: true,
    issues: [],
    note: note(),
    receipt: {
      model: "test",
      policyVersion: "test",
      reviewedAt: new Date().toISOString(),
      directions: ["世界模型"],
      sources: [],
      supplements: [],
    },
  };
  const deps = {
    authorize: async () => {},
    tags: async () => [],
    review: async (n: Note) => {
      reviews++;
      return { ...outcome, note: n };
    },
    commit: async (_env: Env, _user: Identity, value: any) => {
      commits++;
      return {
        note: value.note,
        commitUrl: "https://github.com/group/repo/commit/test",
      };
    },
    ...overrides,
  };
  const queue = new ReviewQueue(state, env, deps);
  const call = async (
    action: string,
    data: Record<string, unknown> = {},
    person = user,
  ) =>
    queue.fetch(
      new Request("https://internal/", {
        method: "POST",
        body: JSON.stringify({ action, user: person, ...data }),
      }),
    );
  const submit = (n = note()) =>
    call("submit", { value: { note: n, assets: [], baseRevision: "" } });
  return {
    storage,
    state,
    queue,
    deps,
    call,
    submit,
    counts: () => ({ reviews, commits }),
  };
}
test("提交只入队，关闭页面后由持久任务审核；相同请求不重复计费", async () => {
  const f = fixture(),
    n = note();
  const first = await f.submit(n);
  assert.equal(first.status, 202);
  const { job } = (await first.json()) as any;
  const duplicate = (await (
    await f.submit({
      ...n,
      updatedAt: new Date(Date.now() + 1000).toISOString(),
    })
  ).json()) as any;
  assert.equal(duplicate.job.id, job.id);
  assert.deepEqual(f.counts(), { reviews: 0, commits: 0 });
  const serialized = JSON.stringify([...f.storage.data]);
  assert.ok(!serialized.includes(user.token));
  assert.ok(!serialized.includes(n.sections.insights));
  assert.ok(!serialized.includes(env.DEEPSEEK_API_KEY!));
  const restored = new ReviewQueue(f.state, env, f.deps);
  await restored.alarm();
  const result = (await (await f.call("list")).json()) as any;
  assert.equal(result.jobs[0].status, "published");
  assert.deepEqual(f.counts(), { reviews: 1, commits: 1 });
  await restored.alarm();
  assert.deepEqual(f.counts(), { reviews: 1, commits: 1 });
  assert.equal(
    [...f.storage.data.keys()].filter((k) => k.startsWith("payload:")).length,
    0,
  );
});
test("未通过不会写仓库，其他成员无法查看任务或原文", async () => {
  let commits = 0;
  const f = fixture({
    review: async (n) => ({
      approved: false,
      note: n,
      issues: [{ field: "insights", message: "补充具体判断理由" }],
    }),
    commit: async () => {
      commits++;
      throw new Error("must not publish");
    },
  });
  const { job } = (await (await f.submit()).json()) as any;
  await f.queue.alarm();
  const detail = (await (await f.call("detail", { id: job.id })).json()) as any;
  assert.equal(detail.job.status, "needs_changes");
  assert.ok(detail.note.sections.insights);
  assert.equal(commits, 0);
  const other = { ...user, id: 99, login: "other" };
  assert.equal((await f.call("detail", { id: job.id }, other)).status, 404);
  assert.deepEqual(
    ((await (await f.call("list", {}, other)).json()) as any).jobs,
    [],
  );
});
test("待修改提交仅本人可删除，草稿与候选内容清理且已用额度保留", async () => {
  const f = fixture({
    review: async (n) => ({ approved: false, note: n, issues: [] }),
  });
  const n = note();
  const { job } = (await (await f.submit(n)).json()) as any;
  await f.queue.alarm();
  const usage = [...(await f.storage.list({ prefix: "usage:" }))];
  assert.ok((await f.storage.list({ prefix: `payload:${job.id}:` })).size);
  assert.ok((await f.storage.list({ prefix: `candidate:${job.id}:` })).size);
  assert.equal(
    (await f.call("delete", { id: job.id }, { ...user, id: 99 })).status,
    404,
  );
  assert.equal(
    (await f.call("delete", { id: job.id }, { ...user, canWrite: false }))
      .status,
    200,
  );
  assert.deepEqual(((await (await f.call("list")).json()) as any).jobs, []);
  assert.equal((await f.call("detail", { id: job.id })).status, 404);
  assert.equal(
    (await f.storage.list({ prefix: `payload:${job.id}:` })).size,
    0,
  );
  assert.equal(
    (await f.storage.list({ prefix: `candidate:${job.id}:` })).size,
    0,
  );
  assert.deepEqual([...(await f.storage.list({ prefix: "usage:" }))], usage);
  assert.equal(f.counts().commits, 0);
  // A new explicit submission can reuse the content hash, but consumes a new quota.
  assert.equal((await f.submit(n)).status, 202);
  assert.equal(
    [...(await f.storage.list<any>({ prefix: "usage:" }))][0][1].total,
    2,
  );
});

test("审核中提交禁止删除，已发布或失败的提交可删除且不改仓库", async () => {
  const f = fixture();
  const { job } = (await (await f.submit()).json()) as any;
  for (const status of ["queued", "reviewing", "publishing"]) {
    f.storage.data.get(`job:${job.id}`).status = status;
    assert.equal((await f.call("delete", { id: job.id })).status, 409);
    assert.ok(f.storage.data.has(`job:${job.id}`));
  }
  f.storage.data.get(`job:${job.id}`).status = "queued";
  await f.queue.alarm();
  assert.equal((await f.call("delete", { id: job.id })).status, 200);
  await f.queue.alarm();
  assert.deepEqual(f.counts(), { reviews: 1, commits: 1 });
  const failed = (await (await f.submit()).json()) as any;
  f.storage.data.get(`job:${failed.job.id}`).status = "failed";
  assert.equal((await f.call("delete", { id: failed.job.id })).status, 200);
  assert.deepEqual(f.counts(), { reviews: 1, commits: 1 });
});

test("删除存储失败会完整回滚，允许稍后重试", async () => {
  const f = fixture({
    review: async (n) => ({ approved: false, note: n, issues: [] }),
  });
  const { job } = (await (await f.submit()).json()) as any;
  await f.queue.alarm();
  const before = [...f.storage.data];
  const original = f.storage.delete.bind(f.storage);
  f.storage.delete = async (key) => {
    if (key === `job:${job.id}`) throw new Error("simulated deletion failure");
    return original(key);
  };
  assert.equal((await f.call("delete", { id: job.id })).status, 500);
  assert.deepEqual([...f.storage.data], before);
  f.storage.delete = original;
  assert.equal((await f.call("delete", { id: job.id })).status, 200);
});

test("删除提交接口拒绝匿名和跨站请求", async () => {
  const cookie = `mcs_session=${await seal(user, env.SESSION_SECRET)}`;
  const url = `https://site.test/api/reviews/review-${"a".repeat(48)}`;
  assert.equal(
    (await handle(new Request(url, { method: "DELETE" }), env)).status,
    401,
  );
  assert.equal(
    (
      await handle(
        new Request(url, {
          method: "DELETE",
          headers: { Cookie: cookie, Origin: "https://evil.test" },
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handle(
        new Request(`${url}/retry`, {
          method: "DELETE",
          headers: { Cookie: cookie, Origin: "https://site.test" },
        }),
        env,
      )
    ).status,
    405,
  );
});

test("发布失败的明确重试复用已通过审核，服务重启不重复调用模型", async () => {
  let attempts = 0;
  const f = fixture({
    commit: async (_e, _u, value: any) => {
      attempts++;
      if (attempts === 1) throw new Error("connection lost");
      return {
        note: value.note,
        commitUrl: "https://github.com/group/repo/commit/ok",
      };
    },
  });
  const { job } = (await (await f.submit()).json()) as any;
  await f.queue.alarm();
  assert.equal(
    ((await (await f.call("list")).json()) as any).jobs[0].status,
    "failed",
  );
  assert.equal(f.counts().reviews, 1);
  assert.equal((await f.call("retry", { id: job.id })).status, 202);
  await new ReviewQueue(f.state, env, f.deps).alarm();
  assert.equal(f.counts().reviews, 1);
  assert.equal(attempts, 2);
  assert.equal(
    ((await (await f.call("list")).json()) as any).jobs[0].status,
    "published",
  );
});
test("不确定是否已付费的中断任务不会自动重复请求，过期内容会清理", async () => {
  const f = fixture();
  const { job } = (await (await f.submit()).json()) as any;
  const row = f.storage.data.get(`job:${job.id}`);
  row.status = "reviewing";
  row.stage = "model";
  await new ReviewQueue(f.state, env, f.deps).alarm();
  assert.equal(f.counts().reviews, 0);
  assert.equal(f.storage.data.get(`job:${job.id}`).status, "failed");
  f.storage.data.get(`job:${job.id}`).payloadExpires = Date.now() - 1;
  await f.queue.alarm();
  assert.equal(
    [...f.storage.data.keys()].filter((k) => k.startsWith("payload:")).length,
    0,
  );
});
test("并发重复提交只占一个额度，每日限额不能被重试绕过", async () => {
  const f = fixture(),
    n = note();
  const results = await Promise.all([f.submit(n), f.submit(n)]);
  assert.equal(results[0].status, 202);
  assert.equal(results[1].status, 202);
  assert.equal((await f.storage.list({ prefix: "job:" })).size, 1);
  const usage = [...f.storage.data.values()].find((v) => v?.total === 1);
  usage.total = 50;
  const denied = await f.submit(note());
  assert.equal(denied.status, 429);
  assert.equal(f.counts().reviews, 0);
});
test("共享密钥缺失时旧发布入口不能绕过审核，匿名任务查询受保护", async () => {
  const cookie = `mcs_session=${await seal(user, env.SESSION_SECRET)}`;
  const response = await handle(
    new Request("https://site.test/api/publish", {
      method: "POST",
      headers: { Origin: "https://site.test", Cookie: cookie },
      body: JSON.stringify({ note: note(), assets: [], baseRevision: "" }),
    }),
    { ...env, DEEPSEEK_API_KEY: undefined },
  );
  assert.equal(response.status, 503);
  assert.match(await response.text(), /共享 DeepSeek/);
  assert.equal(
    (await handle(new Request("https://site.test/api/reviews"), env)).status,
    401,
  );
});

test("入队存储失败不会留下孤立审核任务或消耗额度，同内容可以恢复提交", async () => {
  const f = fixture(),
    n = note(),
    original = f.storage.put.bind(f.storage);
  let failed = false;
  f.storage.put = async (key: any, value?: any) => {
    if (
      !failed &&
      typeof key === "object" &&
      Object.keys(key).some((k) => k.startsWith("payload:"))
    ) {
      failed = true;
      throw new Error("simulated storage failure");
    }
    return original(key, value);
  };
  assert.equal((await f.submit(n)).status, 500);
  assert.equal((await f.storage.list({ prefix: "job:" })).size, 0);
  assert.equal((await f.storage.list({ prefix: "usage:" })).size, 0);
  assert.equal((await f.submit(n)).status, 202);
  await f.queue.alarm();
  assert.equal(
    ((await (await f.call("list")).json()) as any).jobs[0].status,
    "published",
  );
});
