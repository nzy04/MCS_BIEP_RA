import test from "node:test";
import assert from "node:assert/strict";
import {
  createNote,
  structureText,
  toMarkdown,
  emptySections,
} from "../shared/note";
import { handle, seal, unseal, commitNote, type Env } from "../worker/index";
const env: Env = {
  ASSETS: { fetch: async () => new Response("site") },
  SITE_TITLE: "MCS_BIEP",
  GITHUB_OWNER: "test-group",
  GITHUB_REPO: "test-repo",
  GITHUB_BRANCH: "main",
  GITHUB_CLIENT_ID: "client",
  GITHUB_CLIENT_SECRET: "secret",
  SESSION_SECRET: "test-session-key-that-has-at-least-32-characters",
};
const user = {
  login: "member",
  name: "成员",
  avatar: "",
  canWrite: true,
  token: "not-a-real-token",
  id: 1,
  expires: Date.now() + 60000,
};
function note() {
  const n = createNote();
  n.title = "测试笔记";
  n.sections.summary = "测试摘要";
  n.author = "成员";
  return n;
}
test("章节映射保留未分类内容，不生成不存在的观点", () => {
  const parsed = structureText(
    "# 测试标题\n\n未分类的原文\n## 研究背景\n背景内容\n## 核心方法\n方法内容",
  );
  assert.equal(parsed.title, "测试标题");
  assert.equal(parsed.sections.problem, "背景内容");
  assert.equal(parsed.sections.method, "方法内容");
  assert.equal(parsed.sections.insights, "");
  assert.match(parsed.sections.original, /未分类的原文/);
  assert.equal(parsed.matched, 2);
});
test("Markdown 元信息中的特殊字符不会破坏 frontmatter", () => {
  const n = note();
  n.title = '标题: "引号"\n下一行';
  const md = toMarkdown(n);
  assert.ok(md.includes('title: "标题: \\"引号\\"\\n下一行"'));
  assert.match(md, /## 一句话总结/);
});
test("会话加密，篡改或密钥错误时拒绝", async () => {
  const encrypted = await seal(user, env.SESSION_SECRET);
  assert.ok(!encrypted.includes(user.token));
  assert.deepEqual(await unseal(encrypted, env.SESSION_SECRET), user);
  assert.equal(await unseal(encrypted, "wrong-secret"), null);
  assert.equal(await unseal(encrypted + "x", env.SESSION_SECRET), null);
});
test("未登录和跨站发布均被拒绝", async () => {
  let r = await handle(
    new Request("https://site.test/api/publish", {
      method: "POST",
      headers: { Origin: "https://evil.test" },
      body: "{}",
    }),
    env,
  );
  assert.equal(r.status, 403);
  r = await handle(
    new Request("https://site.test/api/publish", {
      method: "POST",
      headers: { Origin: "https://site.test" },
      body: "{}",
    }),
    env,
  );
  assert.equal(r.status, 401);
});
test("登录跳转包含随机 state 与 PKCE，不暴露应用密钥", async () => {
  const r = await handle(new Request("https://site.test/api/auth/login"), env);
  assert.equal(r.status, 302);
  const location = new URL(r.headers.get("Location")!);
  assert.equal(location.hostname, "github.com");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.ok(location.searchParams.get("state"));
  assert.ok(!r.headers.get("Location")!.includes(env.GITHUB_CLIENT_SECRET));
  assert.match(r.headers.get("Set-Cookie")!, /HttpOnly/);
  const bad = await handle(
    new Request("https://site.test/api/auth/callback?code=fake&state=wrong"),
    env,
  );
  assert.match(bad.headers.get("Location")!, /auth_error=/);
});
function fakeGit(options: { conflict?: boolean; writable?: boolean } = {}) {
  let sha = 1;
  let index: any = { version: 1, notes: [] };
  let oldNote: any;
  let pendingFiles: any;
  let patchCount = 0;
  let treeCount = 0;
  const blobs = new Map<string, string>();
  const trees = new Map<string, any>();
  const commits = new Map<string, any>();
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith("/test-repo"))
      return reply({ permissions: { push: options.writable !== false } });
    if (path.includes("/git/ref/heads/"))
      return reply({ object: { sha: String(sha) } });
    if (
      path.includes("/git/commits/") &&
      (!init?.method || init.method === "GET")
    )
      return reply({ tree: { sha: "base-tree" } });
    if (path.includes("/contents/data/library.json"))
      return reply({
        content: Buffer.from(JSON.stringify(index)).toString("base64"),
      });
    if (path.includes("/contents/data/notes/"))
      return oldNote
        ? reply({
            content: Buffer.from(JSON.stringify(oldNote)).toString("base64"),
          })
        : reply({}, 404);
    if (path.endsWith("/git/blobs")) {
      const id = `blob${blobs.size}`;
      blobs.set(
        id,
        body.encoding === "base64"
          ? Buffer.from(body.content, "base64").toString()
          : body.content,
      );
      return reply({ sha: id });
    }
    if (path.endsWith("/git/trees")) {
      const id = `tree${++treeCount}`;
      trees.set(id, body.tree);
      return reply({ sha: id });
    }
    if (path.endsWith("/git/commits")) {
      const id = `commit${commits.size}`;
      commits.set(id, body);
      return reply({ sha: id });
    }
    if (path.includes("/git/refs/heads/")) {
      patchCount++;
      assert.equal(body.force, false);
      if (options.conflict && patchCount === 1) {
        sha++;
        return reply({ message: "not fast forward" }, 422);
      }
      const commit = commits.get(body.sha);
      pendingFiles = trees.get(commit.tree);
      for (const file of pendingFiles) {
        if (file.path === "data/library.json")
          index = JSON.parse(blobs.get(file.sha)!);
        if (file.path.startsWith("data/notes/"))
          oldNote = JSON.parse(blobs.get(file.sha)!);
      }
      sha++;
      return reply({ object: { sha: body.sha } });
    }
    throw new Error(`Unexpected GitHub request: ${path}`);
  };
  return {
    fetcher,
    read: () => ({ index, oldNote, pendingFiles, patchCount, treeCount }),
  };
}
test("一次提交包含笔记、Markdown 和索引，身份来自会话且不强制覆盖", async () => {
  const git = fakeGit();
  const n = note();
  n.authorLogin = "forged-user";
  const result = await commitNote(
    env,
    user,
    { note: n, assets: [], baseRevision: "" },
    git.fetcher,
  );
  assert.equal(result.note.authorLogin, "member");
  assert.ok(result.commitUrl.includes("/commit/"));
  assert.equal(git.read().pendingFiles.length, 3);
  assert.equal(git.read().index.notes[0].title, n.title);
  assert.equal(git.read().oldNote.sections.summary, n.sections.summary);
});
test("分支前进时重新合并提交，旧版本不能覆盖新笔记", async () => {
  const git = fakeGit({ conflict: true });
  const n = note();
  await commitNote(
    env,
    user,
    { note: n, assets: [], baseRevision: "" },
    git.fetcher,
  );
  assert.equal(git.read().patchCount, 2);
  n.sections.summary = "新的内容";
  await assert.rejects(
    () =>
      commitNote(
        env,
        user,
        { note: n, assets: [], baseRevision: "" },
        git.fetcher,
      ),
    /已有更新/,
  );
});
test("重试相同提交不会生成重复版本", async () => {
  const git = fakeGit();
  const n = note();
  await commitNote(
    env,
    user,
    { note: n, assets: [], baseRevision: "" },
    git.fetcher,
  );
  await commitNote(
    env,
    user,
    { note: n, assets: [], baseRevision: "" },
    git.fetcher,
  );
  assert.equal(git.read().patchCount, 1);
});
test("拒绝无写权限和越界附件路径", async () => {
  const n = note();
  await assert.rejects(
    () =>
      commitNote(
        env,
        user,
        { note: n, assets: [], baseRevision: "" },
        fakeGit({ writable: false }).fetcher,
      ),
    /写入权限/,
  );
  n.assets = [
    { path: ".github/workflows/evil.yml", mime: "image/png", size: 4 },
  ];
  await assert.rejects(
    () =>
      commitNote(
        env,
        user,
        { note: n, assets: [], baseRevision: "" },
        fakeGit().fetcher,
      ),
    /路径/,
  );
});

test("真实附件大小的 base64 不会使校验正则溢出", async () => {
  const n = note();
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    Buffer.alloc(180000),
  ]);
  const path = `assets/uploads/${n.id}/figure.png`;
  n.assets = [{ path, mime: "image/png", size: bytes.length }];
  const git = fakeGit();
  await commitNote(
    env,
    user,
    {
      note: n,
      baseRevision: "",
      assets: [{ path, mime: "image/png", base64: bytes.toString("base64") }],
    },
    git.fetcher,
  );
  assert.equal(git.read().pendingFiles.length, 4);
});
