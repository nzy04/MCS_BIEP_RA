import test from "node:test";
import assert from "node:assert/strict";
import {
  arxivCandidates,
  crossrefCandidates,
  lookupPapers,
  safePdfUrl,
  acquirePaper,
  redistributable,
} from "../worker/paperLookup";
import {
  collectPaper,
  commitPaper,
  samePaper,
  paperId,
} from "../worker/paperCatalog";
import { groupPapers } from "../shared/papers";
import { createNote, summarize } from "../shared/note";
import {
  summarizePaper,
  type PaperCandidate,
  type PaperRecord,
} from "../shared/catalog";
import { handle, seal, unseal, type Env, type Identity } from "../worker/app";
import {
  ReviewQueue,
  type QueueStorage,
  type QueueState,
} from "../worker/reviewQueue";

const env: Env = {
  ASSETS: { fetch: async () => new Response("site") },
  SITE_TITLE: "MCS_BIEP",
  GITHUB_OWNER: "group",
  GITHUB_REPO: "repo",
  GITHUB_BRANCH: "main",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
};
const user: Identity = {
  id: 7,
  login: "member",
  name: "成员",
  avatar: "",
  canWrite: true,
  token: "test-github-token",
  expires: Date.now() + 3600000,
};
const candidate: PaperCandidate = {
  title: "World Models",
  authors: ["David Ha", "Jürgen Schmidhuber"],
  year: "2018",
  venue: "arXiv",
  abstract: "A learned model of the environment.",
  paperUrl: "https://arxiv.org/abs/1803.10122",
  pdfUrl: "https://arxiv.org/pdf/1803.10122",
  doi: "",
  source: "arxiv",
  tags: ["世界模型"],
  license: "https://creativecommons.org/licenses/by/4.0/",
  score: 1,
};
const record: PaperRecord = {
  ...candidate,
  id: `paper-${"a".repeat(32)}`,
  createdAt: "2026-10-18T00:00:00Z",
  updatedAt: "2026-10-18T00:00:00Z",
  addedBy: "member",
  pdfStatus: "archived",
  pdfMessage: "PDF 已归档到仓库。",
  pdfVerified: true,
  archivePath: `assets/papers/paper-${"a".repeat(32)}/paper.pdf`,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const encoded = (value: unknown) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const xml = `<feed><entry><id>http://arxiv.org/abs/1803.10122v1</id><title>World\n Models</title><published>2018-03-27</published><summary>A &amp; B</summary><author><name>David Ha</name></author><category term="cs.LG"/></entry></feed>`;
test("公开接口解析标题、作者、年份和来源，拒绝伪造 arXiv ID", () => {
  const papers = arxivCandidates(xml, "World Models");
  assert.equal(papers[0].title, "World Models");
  assert.equal(papers[0].score, 1);
  assert.equal(papers[0].authors[0], "David Ha");
  assert.equal(papers[0].abstract, "A & B");
  assert.equal(
    arxivCandidates(
      xml.replace("1803.10122v1", "../../private"),
      "World Models",
    ).length,
    0,
  );
  const cross = crossrefCandidates(
    {
      message: {
        items: [
          {
            title: ["World Models"],
            DOI: "10.1000/test",
            author: [{ given: "David", family: "Ha" }],
            published: { "date-parts": [[2018]] },
            link: [
              {
                "content-type": "application/pdf",
                URL: "https://127.0.0.1/private.pdf",
              },
            ],
          },
        ],
      },
    },
    "World Models",
  );
  assert.equal(cross[0].doi, "10.1000/test");
  assert.equal(cross[0].pdfUrl, "");
  assert.equal(cross[0].year, "2018");
});
test("免费接口已有可靠 PDF 时不调用兜底；缺少 PDF 才搜索且最多一次", async () => {
  const calls: string[] = [];
  const free = await lookupPapers(
    "World Models",
    { DEEPSEEK_API_KEY: "test-key" },
    async (u) => {
      calls.push(String(u));
      return String(u).includes("arxiv")
        ? new Response(xml)
        : json({ message: { items: [] } });
    },
  );
  assert.equal(free.candidates.length, 1);
  assert.equal(free.fallback, false);
  assert.equal(calls.length, 2);
  calls.length = 0;
  const fallback = await lookupPapers(
    "World Models",
    { DEEPSEEK_API_KEY: "test-key" },
    async (u, init) => {
      calls.push(String(u));
      if (String(u).includes("deepseek")) {
        assert.equal(init?.redirect, "manual");
        return json({
          results: [
            { title: "World Models", url: candidate.paperUrl, rerank_score: 2 },
            {
              title: "World Models",
              url: "https://evil.test/paper",
              rerank_score: 10,
            },
          ],
        });
      }
      return new Response("failed", { status: 503 });
    },
  );
  assert.equal(fallback.candidates.length, 1);
  assert.equal(fallback.fallback, true);
  assert.equal(calls.filter((u) => u.includes("deepseek")).length, 1);
});
test("PDF 仅允许学术来源，拒绝本机、凭据、伪域名和任意代理参数", () => {
  for (const url of [
    candidate.pdfUrl,
    "https://openreview.net/pdf?id=abc-123",
    "https://proceedings.mlr.press/v1/a/a.pdf",
  ])
    assert.equal(safePdfUrl(url), true, url);
  for (const url of [
    "http://arxiv.org/pdf/1803.10122",
    "https://arxiv.org.evil.test/pdf/1803.10122",
    "https://user@arxiv.org/pdf/1803.10122",
    "https://arxiv.org:8888/pdf/1803.10122",
    "https://arxiv.org/pdf/../../secret",
    "https://openreview.net/pdf?id=ok&url=http://localhost",
    "https://localhost/paper.pdf",
  ])
    assert.equal(safePdfUrl(url), false, url);
});
test("验证完整 PDF；CC 许可允许归档，未知许可只保留来源，HTML 和残缺文件不归档", async () => {
  const bytes = new TextEncoder().encode(
    "%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n",
  );
  const archived = await acquirePaper(
    candidate,
    record.id,
    user.login,
    async () => new Response(bytes),
  );
  assert.deepEqual(archived.pdf, bytes);
  assert.equal(archived.paper.pdfStatus, "archived");
  const unknown = await acquirePaper(
    { ...candidate, license: "" },
    record.id,
    user.login,
    async (u) =>
      String(u).includes("/abs/")
        ? new Response(
            `<div class="abstract">mentions https://creativecommons.org/licenses/by/4.0/</div>`,
          )
        : new Response(bytes),
  );
  assert.equal(unknown.paper.pdfStatus, "external");
  assert.equal(unknown.paper.pdfVerified, true);
  assert.equal(unknown.pdf, undefined);
  const cc = await acquirePaper(
    { ...candidate, license: "" },
    record.id,
    user.login,
    async (u) =>
      String(u).includes("/abs/")
        ? new Response(
            `<div class="abs-license"><a href="https://creativecommons.org/licenses/by/4.0/">License</a></div>`,
          )
        : new Response(bytes),
  );
  assert.equal(cc.paper.pdfStatus, "archived");
  for (const body of ["<html>Sign in</html>", "%PDF-1.7\nincomplete"]) {
    const bad = await acquirePaper(
      candidate,
      record.id,
      user.login,
      async () => new Response(body),
    );
    assert.equal(bad.pdf, undefined);
    assert.equal(bad.paper.pdfStatus, "unavailable");
  }
  const big = await acquirePaper(
    candidate,
    record.id,
    user.login,
    async () =>
      new Response(bytes, {
        headers: { "Content-Length": String(5 * 1024 * 1024) },
      }),
  );
  assert.equal(big.pdf, undefined);
  assert.match(big.paper.pdfMessage, /4 MB/);
  const streamed = await acquirePaper(
    candidate,
    record.id,
    user.login,
    async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1)),
  );
  assert.equal(streamed.pdf, undefined);
  const redirect = await acquirePaper(
    candidate,
    record.id,
    user.login,
    async () =>
      new Response(null, {
        status: 302,
        headers: { Location: "http://localhost/private" },
      }),
  );
  assert.equal(redirect.pdf, undefined);
  assert.equal(redirect.paper.pdfStatus, "external");
  assert.equal(
    redistributable("https://creativecommons.org/licenses/by-nc/4.0/"),
    false,
  );
});
test("论文独立计数为零笔记，后续多人笔记合并到同一论文", () => {
  const alone = groupPapers([], [summarizePaper(record)]);
  assert.equal(alone.length, 1);
  assert.equal(alone[0].notes.length, 0);
  assert.equal(alone[0].note.readingDepth, "待读");
  const n = {
    ...createNote(),
    title: candidate.title,
    paperUrl: candidate.pdfUrl,
  };
  const both = groupPapers(
    [summarize(n), summarize({ ...n, id: "another", authorLogin: "bob" })],
    [summarizePaper(record)],
  );
  assert.equal(both.length, 1);
  assert.equal(both[0].id, record.id);
  assert.equal(both[0].notes.length, 2);
  assert.equal(
    samePaper(candidate, {
      ...candidate,
      paperUrl: "https://arxiv.org/pdf/1803.10122v2.pdf",
    }),
    true,
  );
  assert.equal(
    samePaper(candidate, {
      ...candidate,
      year: "2026",
      authors: ["Other"],
      paperUrl: "https://doi.org/10.1000/different",
    }),
    false,
  );
});
test("论文和 PDF 原子写入，并发时读取最新目录合并，重复收录不再下载", async () => {
  let heads = 0;
  const blobs: any[] = [];
  const trees: any[] = [];
  const other = {
    ...record,
    id: `paper-${"b".repeat(32)}`,
    title: "Other",
    paperUrl: "https://doi.org/10.1000/other",
    authors: ["Other"],
  };
  const fetcher: typeof fetch = async (u, init) => {
    const path = new URL(String(u)).pathname;
    if (path === "/repos/group/repo")
      return json({ permissions: { push: true } });
    if (path.includes("/git/ref/")) {
      heads++;
      return json({ object: { sha: `head${heads}` } });
    }
    if (path.includes("/git/commits/") && !init?.method)
      return json({ tree: { sha: `base${heads}` } });
    if (path.includes("/contents/")) {
      const papers = heads > 1 ? [summarizePaper(other)] : [];
      return json({ content: encoded({ papers }) });
    }
    const body = JSON.parse(String(init?.body || "{}"));
    if (path.endsWith("/blobs")) {
      blobs.push(body);
      return json({ sha: `blob${blobs.length}` });
    }
    if (path.endsWith("/trees")) {
      trees.push(body);
      return json({ sha: "tree" });
    }
    if (path.endsWith("/commits")) return json({ sha: "new" });
    if (path.includes("/git/refs/"))
      return heads === 1 ? json({ message: "conflict" }, 422) : json({});
    throw Error(path);
  };
  await commitPaper(env, user, record, new Uint8Array([1, 2, 3]), fetcher);
  assert.equal(trees.length, 2);
  assert.equal(trees[1].base_tree, "base2");
  assert.equal(trees[1].tree.length, 3);
  const index = JSON.parse(
    blobs.filter((b) => b.encoding === "utf-8").at(-1).content,
  );
  assert.equal(index.papers.length, 2);
  assert.equal(index.papers[1].id, other.id);
  const reuse = await collectPaper(env, user, candidate, async (u) => {
    const path = new URL(String(u)).pathname;
    if (path === "/repos/group/repo")
      return json({ permissions: { push: true } });
    if (path.includes("/contents/"))
      return json({ content: encoded({ papers: [summarizePaper(record)] }) });
    throw Error("must not download or write: " + u);
  });
  assert.equal(reuse.reused, true);
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
    return fn(this);
  }
}
test("收录任务持久保存、重启恢复、幂等复用，不触发笔记审核；检索缓存仍签发当前成员令牌", async () => {
  const storage = new MemoryStorage();
  let tail = Promise.resolve();
  const state: QueueState = {
    storage,
    blockConcurrencyWhile: (fn) => {
      const r = tail.then(fn);
      tail = r.then(
        () => {},
        () => {},
      );
      return r;
    },
  };
  let collected = 0,
    lookups = 0;
  const deps = {
    collect: async () => {
      collected++;
      return {
        paper: summarizePaper(record),
        commitUrl: "https://github.com/group/repo/commit/test",
        reused: false,
      };
    },
    lookup: async () => {
      lookups++;
      return { candidates: [candidate], fallback: false, message: "" };
    },
    review: async () => {
      throw Error("must not review empty notes");
    },
  };
  let queue = new ReviewQueue(state, env, deps);
  const call = async (
    action: string,
    extra: Record<string, unknown> = {},
    who = user,
  ) =>
    queue.fetch(
      new Request("https://internal", {
        method: "POST",
        body: JSON.stringify({ action, user: who, ...extra }),
      }),
    );
  const first = (await (
    await call("paper-search", { query: "World Models" })
  ).json()) as any;
  const second = (await (
    await call("paper-search", { query: "World Models" }, { ...user, id: 8 })
  ).json()) as any;
  assert.equal(lookups, 1);
  assert.equal(
    (await unseal<any>(first.candidates[0].token, env.SESSION_SECRET))?.owner,
    7,
  );
  assert.equal(
    (await unseal<any>(second.candidates[0].token, env.SESSION_SECRET))?.owner,
    8,
  );
  const submit = (await (
    await call("paper-submit", { paper: candidate })
  ).json()) as any;
  assert.equal(submit.job.kind, "paper");
  assert.equal(collected, 0);
  assert.equal(storage.data.has("payload:" + submit.job.id + ":count"), true);
  queue = new ReviewQueue(state, env, deps);
  await queue.alarm();
  assert.equal(collected, 1);
  const duplicate = (await (
    await call("paper-submit", { paper: candidate })
  ).json()) as any;
  assert.equal(duplicate.job.status, "published");
  assert.equal(duplicate.job.noteId, record.id);
  assert.equal(collected, 1);
  assert.equal(
    (await call("detail", { id: submit.job.id }, { ...user, id: 8 })).status,
    404,
  );
  assert.ok(storage.alarm);
  assert.equal(
    await paperId(candidate),
    await paperId({ ...candidate, paperUrl: candidate.pdfUrl }),
  );
});
test("收录接口拒绝匿名、跨站、伪造、过期和跨成员候选，只允许修改方向", async () => {
  const original = globalThis.fetch;
  let sent: any;
  globalThis.fetch = async () => json({ permissions: { push: true } });
  const settings = {
    ...env,
    REVIEW_QUEUE: {
      idFromName: () => "queue",
      get: () => ({
        fetch: async (r: Request) => {
          sent = await r.json();
          return json({ job: {} });
        },
      }),
    },
  };
  const cookie = `mcs_session=${await seal(user, env.SESSION_SECRET)}`;
  const post = (
    body: unknown,
    headers: Record<string, string> = {
      Cookie: cookie,
      Origin: "https://site.test",
    },
  ) =>
    handle(
      new Request("https://site.test/api/paper-collect", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      settings,
    );
  try {
    assert.equal((await post({}, {})).status, 403);
    assert.equal((await post({}, { Origin: "https://site.test" })).status, 401);
    for (const choice of [
      { owner: 8, expires: Date.now() + 10000 },
      { owner: 7, expires: Date.now() - 1 },
    ])
      assert.equal(
        (
          await post({
            token: await seal({ ...choice, candidate }, env.SESSION_SECRET),
          })
        ).status,
        400,
      );
    assert.equal((await post({ token: "forged" })).status, 400);
    const token = await seal(
      { candidate, owner: 7, expires: Date.now() + 10000 },
      env.SESSION_SECRET,
    );
    assert.equal(
      (
        await post({
          token,
          tags: ["自定义方向"],
          paper: { pdfUrl: "http://localhost" },
        })
      ).status,
      200,
    );
    assert.equal(sent.paper.pdfUrl, candidate.pdfUrl);
    assert.deepEqual(sent.paper.tags, ["自定义方向"]);
    assert.equal((await post({ token, tags: ["<script>"] })).status, 400);
  } finally {
    globalThis.fetch = original;
  }
});
