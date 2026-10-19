import test from "node:test";
import assert from "node:assert/strict";
import { createDirection, repositoryDirections } from "../worker/directions";
import {
  handle,
  seal,
  validateIncoming,
  type Env,
  type Identity,
} from "../worker/app";
import { createNote } from "../shared/note";
import {
  directionName,
  directionFolder,
  mergeDirections,
} from "../shared/directions";

const env: Env = {
  ASSETS: { fetch: async () => new Response("site") },
  SITE_TITLE: "Test",
  GITHUB_OWNER: "group",
  GITHUB_REPO: "papers",
  GITHUB_BRANCH: "main",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "secret",
  SESSION_SECRET: "a-session-key-of-more-than-32-characters",
};
const user: Identity = {
  id: 1,
  login: "member",
  name: "Member",
  avatar: "",
  canWrite: true,
  token: "test-token",
  expires: Date.now() + 600000,
};
function repository(conflict = false, writable = true) {
  const files = new Map<string, string>([
    [
      "data/library.json",
      JSON.stringify({ notes: [{ tags: ["旧笔记方向"] }] }),
    ],
  ]);
  const trees = new Map<string, any[]>(),
    commits = new Map<string, any>(),
    snapshots = new Map<string, Map<string, string>>();
  let head = "head-0",
    patches = 0;
  const reply = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname,
      body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "/repos/group/papers")
      return reply({ permissions: { push: writable } });
    if (path.includes("/git/ref/heads/")) {
      snapshots.set(head, new Map(files));
      return reply({ object: { sha: head } });
    }
    if (path.includes("/contents/")) {
      const snapshot =
        snapshots.get(url.searchParams.get("ref") || "") || files;
      const value = snapshot.get(path.split("/contents/")[1]);
      return value === undefined
        ? reply({}, 404)
        : reply({ content: Buffer.from(value).toString("base64") });
    }
    if (path.includes("/git/commits/"))
      return reply({ tree: { sha: "base-tree" } });
    if (path.endsWith("/git/trees")) {
      const sha = `tree-${trees.size}`;
      trees.set(sha, body.tree);
      return reply({ sha });
    }
    if (path.endsWith("/git/commits")) {
      const sha = `commit-${commits.size}`;
      commits.set(sha, body);
      return reply({ sha });
    }
    if (path.includes("/git/refs/heads/")) {
      patches++;
      assert.equal(body.force, false);
      if (conflict && patches === 1) {
        files.set(
          "data/directions.json",
          JSON.stringify({ version: 1, directions: ["另一位成员的空文件夹"] }),
        );
        head = "concurrent-head";
        return reply({}, 422);
      }
      for (const entry of trees.get(commits.get(body.sha).tree)!) {
        assert.ok(
          entry.path === "data/directions.json" ||
            entry.path.startsWith("papers/方向-"),
        );
        files.set(entry.path, entry.content);
      }
      head = body.sha;
      return reply({ object: { sha: head } });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  return { files, fetcher, patches: () => patches };
}

test("自定义空方向独立保存，兼容旧笔记方向，重复创建幂等", async () => {
  const repo = repository(),
    originalIndex = repo.files.get("data/library.json");
  const created = await createDirection(
    env,
    user,
    "  我自己的课题 / 2027  ",
    repo.fetcher,
  );
  assert.equal(created.name, "我自己的课题 / 2027");
  assert.deepEqual(await repositoryDirections(env, user, repo.fetcher), [
    "我自己的课题 / 2027",
    "旧笔记方向",
  ]);
  assert.equal(repo.files.get("data/library.json"), originalIndex);
  assert.match(
    repo.files.get(`${directionFolder(created.name)}/README.md`)!,
    /暂无阅读笔记/,
  );
  await createDirection(env, user, created.name, repo.fetcher);
  assert.equal(repo.patches(), 1);
});

test("并发创建不丢失另一位成员的空目录", async () => {
  const repo = repository(true);
  await createDirection(env, user, "我的新方向", repo.fetcher);
  assert.equal(repo.patches(), 2);
  assert.deepEqual(
    JSON.parse(repo.files.get("data/directions.json")!).directions,
    ["另一位成员的空文件夹", "我的新方向"],
  );
});

test("方向命名不绑定学科列表，校验权限和非法输入，并规范化大小写重复", async () => {
  assert.equal(directionName("A"), "A");
  assert.deepEqual(
    mergeDirections(["Robotics", "Ｒｏｂｏｔｉｃｓ", "robotics"]),
    ["Robotics"],
  );
  for (const value of ["", "x".repeat(51), "a\nb", "<script>"])
    await assert.rejects(
      createDirection(env, user, value, repository().fetcher),
    );
  await assert.rejects(
    createDirection(env, user, "自定义", repository(false, false).fetcher),
    /写入权限/,
  );
  const n = createNote();
  n.title = "A paper";
  n.sections.summary = "A summary";
  n.tags = ["<bad>"];
  assert.throws(() => validateIncoming({ note: n }), /研究方向/);
});

test("方向接口防未登录和跨站写入，公开目录兼容不存在的目录文件", async () => {
  const request = (
    headers: Record<string, string>,
    body = '{"name":"自定义方向"}',
  ) =>
    new Request("https://site.test/api/directions", {
      method: "POST",
      headers,
      body,
    });
  assert.equal(
    (await handle(request({ Origin: "https://evil.test" }), env)).status,
    403,
  );
  assert.equal(
    (await handle(request({ Origin: "https://site.test" }), env)).status,
    401,
  );
  const repo = repository(),
    original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.host === "raw.githubusercontent.com")
      return url.pathname.endsWith("data/library.json")
        ? new Response(JSON.stringify({ notes: [{ tags: ["旧笔记方向"] }] }))
        : new Response("", { status: 404 });
    return repo.fetcher(input, init);
  };
  try {
    const cookie = `mcs_session=${await seal(user, env.SESSION_SECRET)}`;
    assert.equal(
      (
        await handle(
          request({ Origin: "https://site.test", Cookie: cookie }),
          env,
        )
      ).status,
      200,
    );
    const response = await handle(
      new Request("https://site.test/api/directions"),
      env,
    );
    assert.deepEqual(await response.json(), { directions: ["旧笔记方向"] });
  } finally {
    globalThis.fetch = original;
  }
});
