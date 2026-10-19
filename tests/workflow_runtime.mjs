import assert from "node:assert/strict";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  Miniflare,
  Response,
  runtimeOptions,
} from "./support/workerRuntime.mjs";

// Exercise the real Worker routes, SQLite queue, alarms and Git transaction code.
// Only external GitHub/DeepSeek network boundaries are replaced with deterministic services.
const bindings = {
  SITE_TITLE: "MCS_BIEP",
  GITHUB_OWNER: "group",
  GITHUB_REPO: "papers",
  GITHUB_BRANCH: "main",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  SESSION_SECRET: "only-a-test-session-key-with-32-characters",
  DEEPSEEK_API_KEY: "test-key",
};
const files = new Map([
  ["data/library.json", JSON.stringify({ version: 1, notes: [] })],
  [
    "data/directions.json",
    JSON.stringify({ version: 1, directions: ["方向甲", "方向乙"] }),
  ],
]);
const blobs = new Map(),
  trees = new Map(),
  commits = new Map(),
  snapshots = new Map();
let head = "head-0",
  modelCalls = 0,
  refWrites = 0,
  approved = true,
  ambiguousNext = false,
  restarts = 0;
const result = (body, status = 200) => Response.json(body, { status });
const outbound = async (request) => {
  const url = new URL(request.url),
    pathname = decodeURIComponent(url.pathname);
  if (url.host === "raw.githubusercontent.com") {
    const content = files.get(pathname.split("/main/")[1]);
    return content === undefined ? result({}, 404) : new Response(content);
  }
  if (url.host === "api.deepseek.com" && pathname === "/chat/completions") {
    modelCalls++;
    const body = await request.json();
    assert.ok(!JSON.stringify(body).includes("test-token"));
    return result({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              approved,
              issues: approved
                ? []
                : [{ field: "insights", message: "请补充具体的个人判断。" }],
              directions: ["方向甲"],
              extractions: [],
            }),
          },
        },
      ],
    });
  }
  assert.equal(url.host, "api.github.com");
  const body = request.method === "GET" ? {} : await request.json();
  if (pathname === "/repos/group/papers")
    return result({ permissions: { push: true } });
  if (pathname.includes("/git/ref/heads/")) {
    snapshots.set(head, new Map(files));
    return result({ object: { sha: head } });
  }
  if (pathname.includes("/contents/")) {
    const snapshot = snapshots.get(url.searchParams.get("ref")) || files;
    const content = snapshot.get(pathname.split("/contents/")[1]);
    return content === undefined
      ? result({}, 404)
      : result({ content: Buffer.from(content).toString("base64") });
  }
  if (pathname.includes("/git/commits/"))
    return result({ tree: { sha: "base-tree" } });
  if (pathname.includes("/git/trees/"))
    return result({ tree: [...files.keys()].map((path) => ({ path })) });
  if (pathname.endsWith("/git/blobs")) {
    const sha = `blob-${blobs.size}`;
    blobs.set(
      sha,
      body.encoding === "base64"
        ? Buffer.from(body.content, "base64")
        : body.content,
    );
    return result({ sha });
  }
  if (pathname.endsWith("/git/trees")) {
    const sha = `tree-${trees.size}`;
    trees.set(sha, body.tree);
    return result({ sha });
  }
  if (pathname.endsWith("/git/commits")) {
    const sha = `commit-${commits.size}`;
    commits.set(sha, body);
    return result({ sha });
  }
  if (pathname.includes("/git/refs/heads/")) {
    assert.equal(body.force, false);
    refWrites++;
    for (const entry of trees.get(commits.get(body.sha).tree)) {
      if (entry.sha === null) {
        assert.ok(files.has(entry.path));
        files.delete(entry.path);
      } else files.set(entry.path, entry.content ?? blobs.get(entry.sha));
    }
    head = body.sha;
    snapshots.set(head, new Map(files));
    if (ambiguousNext) {
      ambiguousNext = false;
      return result(
        { message: "simulated response loss after successful write" },
        503,
      );
    }
    return result({ object: { sha: head } });
  }
  throw new Error(`Unexpected network call ${pathname}`);
};
async function cookie(user) {
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(bindings.SESSION_SECRET),
    ),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(user)),
  );
  return `mcs_session=${Buffer.from(iv).toString("base64url")}.${Buffer.from(bytes).toString("base64url")}`;
}
const alice = {
  id: 1,
  login: "alice",
  name: "Alice",
  avatar: "",
  canWrite: true,
  token: "test-token",
  expires: Date.now() + 3600000,
};
const bob = { ...alice, id: 2, login: "bob", name: "Bob" };
const aliceCookie = await cookie(alice),
  bobCookie = await cookie(bob);
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1kAAAAASUVORK5CYII=",
  "base64",
);
const first = {
  id: `note-${crypto.randomUUID()}`,
  title: "World Models",
  subtitle: "",
  year: "2018",
  venue: "arXiv",
  tags: ["方向甲"],
  paperUrl: "https://arxiv.org/abs/1803.10122",
  pdfUrl: "",
  codeUrl: "",
  author: "不可采信的署名",
  authorLogin: "",
  createdAt: "",
  updatedAt: "",
  revision: "",
  excerpt: "",
  readingDepth: "阅读笔记",
  sections: Object.fromEntries(
    [
      "summary",
      "problem",
      "method",
      "evidence",
      "limitations",
      "insights",
      "original",
    ].map((k) => [k, ""]),
  ),
  assets: [],
  sourceNames: [],
};
const imagePath = `assets/uploads/${first.id}/figure.png`;
first.assets = [{ path: imagePath, mime: "image/png", size: image.length }];
first.body = `## 阅读理解\n\n${"该论文将视觉编码、潜在动力学预测和控制策略分开训练，以减少真实环境交互成本。我认为长期预测误差可能影响规划质量，需要通过预测长度消融、分布外场景和控制成功率共同验证，不能仅凭重构误差判断模型优劣。".repeat(3)}\n\n![方法图](${imagePath})`;
const persist = path.resolve(`test-results/workflow-runtime-${Date.now()}`);
const options = runtimeOptions("workflow-runtime", persist, bindings, outbound);
let mf = new Miniflare(options);
async function restart() {
  await mf.dispose();
  mf = new Miniflare(options);
  restarts++;
}
async function call(
  route,
  body,
  auth = aliceCookie,
  origin = "https://site.test",
  method = body === undefined ? "GET" : "POST",
) {
  const response = await mf.dispatchFetch(`https://site.test${route}`, {
    method,
    headers: {
      Cookie: auth,
      Origin: origin,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
async function waitJob(id, status, auth = aliceCookie) {
  for (let i = 0; i < 80; i++) {
    const value = await call("/api/reviews", undefined, auth);
    const job = value.body.jobs?.find((j) => j.id === id);
    if (job?.status === status) return job;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(
    `Job ${id} did not reach ${status}: ${JSON.stringify((await call("/api/reviews", undefined, auth)).body)}`,
  );
}
const started = Date.now();
try {
  assert.equal((await call("/api/notes/move", {}, "")).status, 401);
  assert.equal(
    (
      await call(
        "/api/directions",
        { name: "方向丙" },
        aliceCookie,
        "https://evil.test",
      )
    ).status,
    403,
  );
  assert.equal((await call("/api/directions", { name: "方向丙" })).status, 200);
  assert.ok(files.has("papers/方向-方向丙/README.md"));
  const payload = {
    note: first,
    assets: [
      { path: imagePath, mime: "image/png", base64: image.toString("base64") },
    ],
    baseRevision: "",
  };
  ambiguousNext = true;
  const submitted = await call("/api/publish", payload);
  assert.equal(submitted.status, 202);
  assert.equal(modelCalls, 0);
  await restart();
  const failed = await waitJob(submitted.body.job.id, "failed");
  assert.ok(failed.message.includes("GitHub"));
  assert.equal(modelCalls, 1);
  assert.equal(refWrites, 2); // direction creation and the successfully written publication
  assert.equal(JSON.parse(files.get("data/library.json")).notes.length, 1);
  await restart();
  assert.equal((await call(`/api/reviews/${failed.id}/retry`, {})).status, 202);
  await waitJob(failed.id, "published");
  assert.equal(modelCalls, 1);
  assert.equal(refWrites, 2);
  const saved = JSON.parse(files.get(`data/notes/${first.id}.json`));
  assert.equal(saved.author, "Alice");
  assert.equal(saved.pdfUrl, "https://arxiv.org/pdf/1803.10122");
  assert.ok(
    files
      .get(`papers/方向-方向甲/${first.id}.md`)
      .includes("../../assets/uploads/"),
  );
  assert.ok(Buffer.from(files.get(imagePath)).equals(image));
  assert.equal(
    (
      await call("/api/notes/move", {
        notes: [{ id: first.id, revision: saved.revision }],
        source: "方向甲",
        target: "方向乙",
      })
    ).status,
    200,
  );
  assert.ok(!files.has(`papers/方向-方向甲/${first.id}.md`));
  assert.ok(files.has(`papers/方向-方向乙/${first.id}.md`));
  assert.equal(
    (
      await call("/api/notes/move", {
        notes: [{ id: first.id, revision: saved.revision }],
        source: "方向甲",
        target: "方向丙",
      })
    ).status,
    409,
  );
  const moved = (await call(`/api/notes/${first.id}`)).body;
  assert.equal(moved.body, first.body);
  assert.equal(moved.author, "Alice");
  const renamed = await mf.dispatchFetch("https://site.test/api/profile", {
    method: "PUT",
    headers: {
      Cookie: aliceCookie,
      Origin: "https://site.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ nickname: "新昵称" }),
  });
  assert.equal(renamed.status, 200);
  assert.ok(files.get(`papers/方向-方向乙/${first.id}.md`).includes("新昵称"));
  const second = {
    ...first,
    id: `note-${crypto.randomUUID()}`,
    assets: [],
    body: first.body.split("\n\n!")[0],
    author: "伪造Alice",
  };
  const other = await call(
    "/api/publish",
    { note: second, assets: [], baseRevision: "" },
    bobCookie,
  );
  assert.equal(other.status, 202);
  await waitJob(other.body.job.id, "published", bobCookie);
  assert.equal(
    JSON.parse(files.get(`data/notes/${second.id}.json`)).author,
    "Bob",
  );
  const before = files.size;
  approved = false;
  const rejected = { ...second, id: `note-${crypto.randomUUID()}` };
  const rejection = await call("/api/publish", {
    note: rejected,
    assets: [],
    baseRevision: "",
  });
  await waitJob(rejection.body.job.id, "needs_changes");
  assert.equal(files.size, before);
  assert.equal(
    (await call(`/api/reviews/${rejection.body.job.id}`, undefined, bobCookie))
      .status,
    404,
  );
  const originalBody = files.get(`data/notes/${first.id}.json`);
  assert.equal(
    (
      await call(
        "/api/directions",
        { name: "方向乙", replacement: "重命名方向" },
        aliceCookie,
        "https://site.test",
        "PATCH",
      )
    ).status,
    200,
  );
  assert.ok(!files.has(`papers/方向-方向乙/${first.id}.md`));
  assert.ok(files.has(`papers/方向-重命名方向/${first.id}.md`));
  await restart();
  assert.equal(
    (
      await call(
        "/api/directions",
        { name: "重命名方向" },
        aliceCookie,
        "https://site.test",
        "DELETE",
      )
    ).status,
    200,
  );
  const afterDelete = JSON.parse(files.get(`data/notes/${first.id}.json`));
  assert.equal(afterDelete.body, JSON.parse(originalBody).body);
  assert.deepEqual(afterDelete.tags, []);
  assert.ok(files.has(`papers/_未分类/${first.id}.md`));
  assert.ok(!files.has("papers/方向-重命名方向/README.md"));
  assert.ok(Buffer.from(files.get(imagePath)).equals(image));
  assert.equal(
    (
      await call(
        `/api/notes/${first.id}`,
        { revision: afterDelete.revision },
        bobCookie,
        "https://site.test",
        "DELETE",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/api/notes/${first.id}`,
        { revision: "stale" },
        aliceCookie,
        "https://site.test",
        "DELETE",
      )
    ).status,
    409,
  );
  const otherNoteBytes = files.get(`data/notes/${second.id}.json`);
  assert.equal(
    (
      await call(
        `/api/notes/${first.id}`,
        { revision: afterDelete.revision },
        aliceCookie,
        "https://site.test",
        "DELETE",
      )
    ).status,
    200,
  );
  assert.ok(!files.has(`data/notes/${first.id}.json`));
  assert.ok(!files.has(imagePath));
  assert.equal(files.get(`data/notes/${second.id}.json`), otherNoteBytes);
  const baseline = JSON.stringify((await call("/api/library")).body);
  const soakSeconds = Math.min(
    600,
    Math.max(0, Number(process.env.SOAK_SECONDS || 0)),
  );
  let samples = 0;
  const deadline = Date.now() + soakSeconds * 1000;
  do {
    assert.equal(JSON.stringify((await call("/api/library")).body), baseline);
    assert.equal((await call("/api/session")).body.name, "新昵称");
    assert.equal((await call("/api/reviews")).status, 200);
    samples++;
    if (samples % 3 === 0) await restart();
    if (Date.now() < deadline) await new Promise((r) => setTimeout(r, 10000));
  } while (Date.now() < deadline);
  assert.equal(modelCalls, 3);
  assert.equal(JSON.parse(files.get("data/library.json")).notes.length, 1);
  const snapshot = path.join(persist, "repository-snapshot");
  for (const [relative, content] of files) {
    const target = path.resolve(snapshot, relative);
    assert.ok(target.startsWith(snapshot + path.sep));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  execFileSync(process.execPath, ["scripts/check-repository.mjs", snapshot]);
  const report = {
    sqlitePersistence: true,
    authenticatedRoutes: true,
    publishAfterRestart: true,
    ambiguousWriteRetryWithoutDuplicate: true,
    modelCalls,
    directionsAndMoves: true,
    directionRenameAndDelete: true,
    authorOnlyNoteDeletion: true,
    nickname: true,
    multipleContributors: true,
    rejectionNoWrite: true,
    assetsUnchanged: true,
    repositoryIntegrity: true,
    soakSeconds: Math.round((Date.now() - started) / 1000),
    samples,
    restarts,
    externalServices: "simulated",
  };
  writeFileSync(
    "test-results/workflow-runtime-results.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await mf.dispose();
}
