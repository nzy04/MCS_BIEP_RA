import test from "node:test";
import assert from "node:assert/strict";
import { createNote, summarize, type Note } from "../shared/note";
import {
  canonicalPaperUrl,
  contributorKey,
  countContributors,
  groupPapers,
  ownsNote,
} from "../shared/papers";
import {
  commitNote,
  handle,
  seal,
  type Env,
  type Identity,
} from "../worker/app";
import { profileSession, updateProfile } from "../worker/profile";
import { moveNotes } from "../worker/move";
import { deleteNote } from "../worker/deleteNote";
import { changeDirection, createDirection } from "../worker/directions";
import {
  directionFolder,
  noteFolders,
  movedDirections,
} from "../shared/directions";
import { toMarkdown } from "../shared/note";

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
const alice: Identity = {
  id: 1,
  login: "alice",
  name: "Alice",
  avatar: "",
  canWrite: true,
  token: "test-token",
  expires: Date.now() + 600000,
};
const bob: Identity = { ...alice, id: 2, login: "bob", name: "Bob" };
function makeNote(user = alice): Note {
  return {
    ...createNote(),
    title: "Shared Paper",
    paperUrl: "https://arxiv.org/abs/2601.12345",
    author: user.name,
    authorLogin: user.login,
    sections: { ...createNote().sections, summary: `Notes by ${user.login}` },
    revision: `revision-${user.login}`,
  };
}

function repository(
  initial: Note[] = [],
  options: { conflict?: boolean; writable?: boolean; missing?: string } = {},
) {
  const files = new Map<string, string>([
    [
      "data/library.json",
      JSON.stringify({ version: 1, notes: initial.map(summarize) }),
    ],
  ]);
  initial.forEach((n) =>
    files.set(`data/notes/${n.id}.json`, JSON.stringify(n)),
  );
  initial.forEach((n) => files.set(`papers/${n.id}.md`, toMarkdown(n)));
  if (options.missing) files.delete(options.missing);
  let head = "head-0",
    patches = 0;
  const snapshots = new Map([[head, new Map(files)]]);
  const blobs = new Map<string, string>(),
    trees = new Map<string, any[]>(),
    commits = new Map<string, any>();
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "/graphql") {
      const repository: Record<string, { text: string } | null> = {};
      for (const match of body.query.matchAll(
        /n(\d+): object\(expression: ("(?:\\.|[^"])*")\)/g,
      )) {
        const expression = JSON.parse(match[2]);
        const separator = expression.indexOf(":");
        const snapshot = snapshots.get(expression.slice(0, separator)) || files;
        const text = snapshot.get(expression.slice(separator + 1));
        repository[`n${match[1]}`] = text ? { text } : null;
      }
      return reply({ data: { repository } });
    }
    if (path === "/repos/group/papers")
      return reply({ permissions: { push: options.writable !== false } });
    if (path.includes("/git/ref/heads/")) {
      snapshots.set(head, new Map(files));
      return reply({ object: { sha: head } });
    }
    if (path.includes("/git/commits/"))
      return reply({ tree: { sha: `tree-${path.split("/").pop()}` } });
    if (path.includes("/git/trees/"))
      return reply({ tree: [...files.keys()].map((path) => ({ path })) });
    if (path.includes("/contents/")) {
      const snapshot =
        snapshots.get(url.searchParams.get("ref") || "") || files;
      const content = snapshot.get(path.split("/contents/")[1]);
      return content === undefined
        ? reply({}, 404)
        : reply({ content: Buffer.from(content).toString("base64") });
    }
    if (path.endsWith("/git/blobs")) {
      const sha = `blob-${blobs.size}`;
      blobs.set(sha, body.content);
      return reply({ sha });
    }
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
      if (options.conflict && patches === 1) {
        // A different contributor publishes while the nickname transaction is being prepared.
        const newcomer = makeNote(bob);
        const index = JSON.parse(files.get("data/library.json")!);
        index.notes.push(summarize(newcomer));
        files.set("data/library.json", JSON.stringify(index));
        files.set(`data/notes/${newcomer.id}.json`, JSON.stringify(newcomer));
        head = "head-concurrent";
        snapshots.set(head, new Map(files));
        return reply({ message: "not fast forward" }, 422);
      }
      const commit = commits.get(body.sha);
      for (const entry of trees.get(commit.tree)!) {
        if (entry.sha === null) {
          assert.ok(
            files.has(entry.path),
            `Deleting missing file ${entry.path}`,
          );
          files.delete(entry.path);
        } else files.set(entry.path, entry.content ?? blobs.get(entry.sha)!);
      }
      head = body.sha;
      snapshots.set(head, new Map(files));
      return reply({ object: { sha: head } });
    }
    throw new Error(`Unexpected request ${path}`);
  };
  return {
    fetcher,
    files,
    patches: () => patches,
    index: () => JSON.parse(files.get("data/library.json")!).notes as Note[],
  };
}

test("同论文的不同 URL 形式、标题别名和无链接旧笔记合并，笔记 ID 均保留", () => {
  const a = makeNote(),
    b = makeNote(bob),
    legacy = makeNote(),
    other = makeNote();
  b.title = "另一种论文标题";
  b.paperUrl = "https://arxiv.org/pdf/2601.12345v3.pdf";
  legacy.paperUrl = "";
  legacy.title = " shared paper！ ";
  other.paperUrl = "https://doi.org/10.1000/different";
  other.title = "Different paper";
  const groups = groupPapers([a, b, legacy, other]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].notes.length, 3);
  assert.equal(new Set(groups[0].notes.map((n) => n.id)).size, 3);
  assert.equal(
    canonicalPaperUrl("https://doi.org/10.1000/ABC?utm_source=test"),
    "doi:10.1000/abc",
  );
  assert.notEqual(
    canonicalPaperUrl("https://openreview.net/forum?id=ABC"),
    canonicalPaperUrl("https://openreview.net/forum?id=XYZ"),
  );
  assert.equal(
    canonicalPaperUrl("https://arxiv.org/html/2601.12345v2"),
    canonicalPaperUrl(a.paperUrl),
  );
});

test("相同昵称仍是不同贡献者，改 GitHub 登录名后稳定 ID 仍能识别归属", () => {
  const a = { ...makeNote(), authorId: 1, author: "重名" },
    b = { ...makeNote(bob), authorId: 2, author: "重名" };
  assert.notEqual(contributorKey(a), contributorKey(b));
  assert.equal(ownsNote(a, { ...alice, login: "alice-renamed" }), true);
  assert.equal(ownsNote(a, bob), false);
  assert.equal(countContributors([a, b, makeNote(alice)]), 2);
});

test("两人上传同论文各自保存，署名来自账号，不能覆写他人笔记", async () => {
  const repo = repository(),
    a = makeNote(),
    b = makeNote(bob);
  a.author = "伪造他人署名";
  const first = await commitNote(env, alice, { note: a }, repo.fetcher);
  await commitNote(env, bob, { note: b }, repo.fetcher);
  assert.equal(repo.index().length, 2);
  assert.equal(first.note.author, "Alice");
  assert.equal(first.note.authorId, 1);
  await assert.rejects(
    commitNote(
      env,
      bob,
      { note: a, baseRevision: first.note.revision },
      repo.fetcher,
    ),
    /只能修改自己/,
  );
  assert.equal(repo.patches(), 2);
});

test("改名同时更新旧署名笔记、稳定 ID 笔记、目录和 Markdown，保留内容与版本", async () => {
  const a = makeNote(),
    a2 = { ...makeNote(), authorLogin: "old-login", authorId: 1 },
    b = { ...makeNote(bob), author: "Alice" };
  const repo = repository([a, a2, b]);
  const result = await updateProfile(env, alice, "  新昵称  ", repo.fetcher);
  assert.equal(result.user.name, "新昵称");
  assert.equal(result.notes.filter((n) => n.author === "新昵称").length, 2);
  for (const before of [a, a2]) {
    const after = JSON.parse(repo.files.get(`data/notes/${before.id}.json`)!);
    assert.equal(after.author, "新昵称");
    assert.equal(after.authorId, 1);
    assert.deepEqual(after.sections, before.sections);
    assert.equal(after.revision, before.revision);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.match(
      repo.files.get(`${noteFolders(before.tags)[0]}/${before.id}.md`)!,
      /author: "新昵称"/,
    );
    assert.equal(repo.files.has(`papers/${before.id}.md`), false);
  }
  assert.deepEqual(JSON.parse(repo.files.get(`data/notes/${b.id}.json`)!), b);
  assert.equal(
    (await profileSession(env, alice, "main", repo.fetcher)).name,
    "新昵称",
  );
  const later = await commitNote(
    env,
    alice,
    { note: makeNote() },
    repo.fetcher,
  );
  assert.equal(later.note.author, "新昵称");
  assert.equal(
    (await updateProfile(env, alice, "", repo.fetcher)).user.name,
    "Alice",
  );
  assert.equal(
    repo
      .index()
      .filter((n) => n.authorId === 1)
      .every((n) => n.author === "Alice"),
    true,
  );
});

test("昵称修改遇到并发发布会重读目录合并，保留新增笔记", async () => {
  const repo = repository([makeNote()], { conflict: true });
  await updateProfile(env, alice, "新名字", repo.fetcher);
  assert.equal(repo.patches(), 2);
  assert.equal(repo.index().length, 2);
  assert.equal(
    repo.index().find((n) => n.authorLogin === "bob")?.author,
    "Bob",
  );
});

test("历史笔记缺失、无写权限或非法昵称时不提交半套改名", async () => {
  const a = makeNote(),
    repo = repository([a], { missing: `data/notes/${a.id}.json` });
  await assert.rejects(
    updateProfile(env, alice, "新名字", repo.fetcher),
    /昵称尚未修改/,
  );
  assert.equal(repo.patches(), 0);
  await assert.rejects(
    updateProfile(
      env,
      alice,
      "昵称",
      repository([], { writable: false }).fetcher,
    ),
    /写入权限/,
  );
  for (const invalid of ["a".repeat(41), "昵称\n换行", "<script>", 123])
    await assert.rejects(updateProfile(env, alice, invalid, repo.fetcher));
});

test("昵称接口验证登录与来源，保存后重载会话仍使用昵称且不泄露令牌", async () => {
  const request = (
    headers: Record<string, string>,
    body = '{"nickname":"昵称"}',
  ) =>
    new Request("https://site.test/api/profile", {
      method: "PUT",
      headers,
      body,
    });
  assert.equal(
    (await handle(request({ Origin: "https://site.test" }), env)).status,
    401,
  );
  assert.equal(
    (await handle(request({ Origin: "https://evil.test" }), env)).status,
    403,
  );
  const repo = repository([makeNote()]);
  const previousFetch = globalThis.fetch;
  const cookie = `mcs_session=${await seal(alice, env.SESSION_SECRET)}`;
  globalThis.fetch = repo.fetcher;
  try {
    const headers = { Origin: "https://site.test", Cookie: cookie };
    assert.equal((await handle(request(headers, "bad json"), env)).status, 400);
    const saved = await handle(request(headers), env);
    assert.equal(saved.status, 200);
    assert.equal(((await saved.json()) as any).user.name, "昵称");
    const session = await handle(
      new Request("https://site.test/api/session", {
        headers: { Cookie: cookie },
      }),
      env,
    );
    const body = (await session.json()) as any;
    assert.equal(body.name, "昵称");
    assert.equal(body.githubName, "Alice");
    assert.equal(body.token, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("方向路径安全且稳定，多方向发布生成独立阅读版并正确引用附件", async () => {
  for (const name of [
    "A/B",
    "A\\B",
    "../CON",
    "世界模型: 方法?",
    "100% / Test",
  ]) {
    assert.equal(directionFolder(name).split("/").length, 2);
    assert.ok(!directionFolder(name).includes(".."));
  }
  assert.notEqual(directionFolder("A/B"), directionFolder("A%2FB"));
  assert.equal(
    directionFolder("Robotics"),
    directionFolder("ＲＯＢＯＴＩＣＳ"),
  );
  const a = makeNote();
  a.tags = ["方向甲", "方向乙"];
  a.body = `## 图示\n\n![方法](assets/uploads/${a.id}/figure.png)\n\n个人分析保留。`;
  a.assets = [
    { path: `assets/uploads/${a.id}/figure.png`, mime: "image/png", size: 3 },
  ];
  const repo = repository();
  a.assets[0].size = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
    "base64",
  ).length;
  const saved = await commitNote(
    env,
    alice,
    {
      note: a,
      assets: [
        {
          path: a.assets[0].path,
          mime: "image/png",
          base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        },
      ],
    },
    repo.fetcher,
  );
  for (const folder of noteFolders(a.tags)) {
    assert.match(
      repo.files.get(`${folder}/${a.id}.md`)!,
      /\.\.\/\.\.\/assets\/uploads\//,
    );
    assert.ok(repo.files.get(`${folder}/README.md`)!.includes(a.id));
  }
  assert.equal(repo.files.has(`papers/${a.id}.md`), false);
  const edited = { ...saved.note, tags: ["方向乙", "方向丙"] };
  await commitNote(
    env,
    alice,
    { note: edited, baseRevision: saved.note.revision },
    repo.fetcher,
  );
  assert.equal(
    repo.files.has(`${directionFolder("方向甲")}/${a.id}.md`),
    false,
  );
  assert.ok(repo.files.has(`${directionFolder("方向乙")}/${a.id}.md`));
  assert.ok(repo.files.has(`${directionFolder("方向丙")}/${a.id}.md`));
  assert.match(
    repo.files.get(`${directionFolder("方向甲")}/README.md`)!,
    /暂无/,
  );
  assert.ok(repo.files.has(a.assets[0].path));
});

test("移动多人笔记原子同步目录、JSON及Markdown，保留正文署名附件和其他方向", async () => {
  const a = makeNote(),
    b = makeNote(bob);
  a.tags = ["原方向", "保留方向"];
  b.tags = ["原方向"];
  a.body = "用户独立见解与原始正文";
  const repo = repository([a, b]);
  repo.files.set(
    "data/directions.json",
    JSON.stringify({ version: 1, directions: ["目标方向", "空目录"] }),
  );
  const result = await moveNotes(
    env,
    alice,
    {
      notes: [a, b].map((n) => ({ id: n.id, revision: n.revision })),
      source: "原方向",
      target: "目标方向",
    },
    repo.fetcher,
  );
  assert.equal(repo.patches(), 1);
  assert.deepEqual(result.notes.find((n) => n.id === a.id)!.tags, [
    "保留方向",
    "目标方向",
  ]);
  assert.deepEqual(result.notes.find((n) => n.id === b.id)!.tags, ["目标方向"]);
  for (const original of [a, b]) {
    const after = JSON.parse(repo.files.get(`data/notes/${original.id}.json`)!);
    assert.equal(after.author, original.author);
    assert.equal(after.authorLogin, original.authorLogin);
    assert.equal(after.body, original.body);
    assert.deepEqual(after.sections, original.sections);
    assert.deepEqual(after.assets, original.assets);
    assert.notEqual(after.revision, original.revision);
    assert.equal(repo.files.has(`papers/${original.id}.md`), false);
    assert.ok(
      repo.files.has(`${directionFolder("目标方向")}/${original.id}.md`),
    );
  }
  assert.ok(repo.files.has(`${directionFolder("保留方向")}/${a.id}.md`));
  assert.match(
    repo.files.get(`${directionFolder("原方向")}/README.md`)!,
    /暂无/,
  );
  assert.ok(
    JSON.parse(repo.files.get("data/directions.json")!).directions.includes(
      "空目录",
    ),
  );
  const moved = JSON.parse(repo.files.get(`data/notes/${b.id}.json`)!);
  await updateProfile(env, bob, "Bob新昵称", repo.fetcher);
  assert.match(
    repo.files.get(`${directionFolder("目标方向")}/${b.id}.md`)!,
    /Bob新昵称/,
  );
  assert.equal(
    JSON.parse(repo.files.get(`data/notes/${b.id}.json`)!).revision,
    moved.revision,
  );
  await assert.rejects(
    commitNote(env, alice, { note: a, baseRevision: a.revision }, repo.fetcher),
    /已有更新/,
  );
});

test("移动冲突和无权限不会部分写入，并发新增笔记仍保留", async () => {
  const a = makeNote();
  a.tags = ["原方向"];
  const input = {
    notes: [{ id: a.id, revision: a.revision }],
    source: "原方向",
    target: "目标方向",
  };
  const repo = repository([a], { conflict: true });
  repo.files.set(
    "data/directions.json",
    JSON.stringify({ directions: ["目标方向"] }),
  );
  await moveNotes(env, alice, input, repo.fetcher);
  assert.equal(repo.patches(), 2);
  assert.equal(repo.index().length, 2);
  assert.equal(
    repo.index().find((n) => n.authorLogin === "bob")!.tags.length,
    0,
  );
  const before = new Map(repo.files);
  await assert.rejects(moveNotes(env, alice, input, repo.fetcher), /已有更新/);
  assert.deepEqual(repo.files, before);
  const denied = repository([a], { writable: false });
  await assert.rejects(
    moveNotes(env, alice, input, denied.fetcher),
    /写入权限/,
  );
  assert.equal(denied.patches(), 0);
  const missing = repository([a]);
  await assert.rejects(
    moveNotes(env, alice, input, missing.fetcher),
    /目标方向不存在/,
  );
  assert.equal(missing.patches(), 0);
  assert.deepEqual(movedDirections(["A", "B"], "A", "C"), ["B", "C"]);
  assert.deepEqual(movedDirections(["A", "B"], null, "C"), ["C"]);
});

test("移动接口验证来源、会话、输入及目标方向", async () => {
  const request = (headers: Record<string, string>, body = "{}") =>
    new Request("https://site.test/api/notes/move", {
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
  globalThis.fetch = repo.fetcher;
  try {
    const headers = {
      Origin: "https://site.test",
      Cookie: `mcs_session=${await seal(alice, env.SESSION_SECRET)}`,
    };
    assert.equal(
      (await handle(request(headers, "invalid JSON"), env)).status,
      400,
    );
    assert.equal((await handle(request(headers), env)).status, 400);
    assert.equal(repo.patches(), 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("编辑正文保留可信 AI 字段标记，手动改字段后移除标记", async () => {
  const a = makeNote();
  a.year = "2018";
  const repo = repository();
  const receipt = {
    policyVersion: "test",
    reviewedAt: "2026-10-19",
    model: "test",
    directions: [],
    sources: [{ title: a.title, url: a.paperUrl, kind: "provided" as const }],
    supplements: [
      { field: "year" as const, value: "2018", sourceUrl: a.paperUrl },
    ],
  };
  const saved = await commitNote(
    env,
    alice,
    { note: a, assets: [] },
    repo.fetcher,
    receipt,
  );
  const edited = await commitNote(
    env,
    alice,
    {
      note: { ...saved.note, body: "这是新的个人理解。" },
      assets: [],
      baseRevision: saved.note.revision,
    },
    repo.fetcher,
    { ...receipt, supplements: [] },
  );
  assert.equal(edited.note.review?.supplements[0].field, "year");
  assert.deepEqual(repo.index()[0].aiFields, ["year"]);
  const manual = await commitNote(
    env,
    alice,
    {
      note: { ...edited.note, year: "2019" },
      assets: [],
      baseRevision: edited.note.revision,
    },
    repo.fetcher,
    { ...receipt, supplements: [] },
  );
  assert.deepEqual(manual.note.review?.supplements, []);
  assert.deepEqual(repo.index()[0].aiFields, []);
});

test("历史笔记增多后改名仍在免费请求预算内完成全部同步", async () => {
  const originals = Array.from({ length: 80 }, () => ({
    ...makeNote(),
    tags: ["共同方向"],
  }));
  const repo = repository(originals);
  let requests = 0;
  const bounded: typeof fetch = async (input, init) => {
    if (++requests > 50)
      throw new Error("free plan subrequest budget exceeded");
    return repo.fetcher(input, init);
  };
  const result = await updateProfile(env, alice, "长期署名", bounded);
  assert.equal(result.notes.length, 80);
  assert.ok(result.notes.every((n) => n.author === "长期署名"));
  assert.ok(requests < 30);
  for (const n of originals)
    assert.match(
      repo.files.get(`${directionFolder("共同方向")}/${n.id}.md`)!,
      /长期署名/,
    );
});

test("只有上传者能删除笔记，原子清理索引、阅读版及本人图片，保留同论文其他作者", async () => {
  const a = { ...makeNote(), tags: ["共同方向"] },
    b = { ...makeNote(bob), tags: ["共同方向"] };
  a.assets = [
    { path: `assets/uploads/${a.id}/image.png`, mime: "image/png", size: 3 },
  ];
  const repo = repository([a, b]);
  repo.files.set(a.assets[0].path, "IMG");
  repo.files.set(`${directionFolder("共同方向")}/${a.id}.md`, toMarkdown(a));
  repo.files.set(`${directionFolder("共同方向")}/${b.id}.md`, toMarkdown(b));
  const before = new Map(repo.files);
  await assert.rejects(
    () => deleteNote(env, bob, a.id, a.revision, repo.fetcher),
    /只有上传者/,
  );
  await assert.rejects(
    () => deleteNote(env, alice, a.id, "stale-version", repo.fetcher),
    /已有更新/,
  );
  assert.deepEqual(repo.files, before);
  assert.equal(repo.patches(), 0);
  const result = await deleteNote(env, alice, a.id, a.revision, repo.fetcher);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].id, b.id);
  assert.ok(!repo.files.has(`data/notes/${a.id}.json`));
  assert.ok(!repo.files.has(`papers/${a.id}.md`));
  assert.ok(!repo.files.has(`${directionFolder("共同方向")}/${a.id}.md`));
  assert.ok(!repo.files.has(a.assets[0].path));
  assert.equal(
    repo.files.get(`data/notes/${b.id}.json`),
    before.get(`data/notes/${b.id}.json`),
  );
  assert.ok(
    repo.files.get(`${directionFolder("共同方向")}/README.md`)!.includes(b.id),
  );
  assert.ok(
    !repo.files.get(`${directionFolder("共同方向")}/README.md`)!.includes(a.id),
  );
  await deleteNote(env, alice, a.id, a.revision, repo.fetcher);
  assert.equal(repo.patches(), 1);
});

test("删除笔记遇到并发发布会保留新增内容，缺失文件不提交半套删除", async () => {
  const a = makeNote(),
    repo = repository([a], { conflict: true });
  const result = await deleteNote(env, alice, a.id, a.revision, repo.fetcher);
  assert.equal(repo.patches(), 2);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].authorLogin, "bob");
  const broken = repository([a], { missing: `data/notes/${a.id}.json` });
  await assert.rejects(
    () => deleteNote(env, alice, a.id, a.revision, broken.fetcher),
    /不一致/,
  );
  assert.equal(broken.patches(), 0);
});

test("笔记删除接口拒绝未登录、跨站、伪造归属和缺少版本的请求", async () => {
  const a = makeNote(),
    repo = repository([a]),
    previous = globalThis.fetch;
  globalThis.fetch = repo.fetcher;
  const request = (origin: string, cookie: string, body: string) =>
    new Request(`https://site.test/api/notes/${a.id}`, {
      method: "DELETE",
      headers: { Origin: origin, Cookie: cookie },
      body,
    });
  try {
    const auth = `mcs_session=${await seal(alice, env.SESSION_SECRET)}`;
    const other = `mcs_session=${await seal(bob, env.SESSION_SECRET)}`;
    assert.equal(
      (await handle(request("https://evil.test", auth, "{}"), env)).status,
      403,
    );
    assert.equal(
      (await handle(request("https://site.test", "", "{}"), env)).status,
      401,
    );
    assert.equal(
      (await handle(request("https://site.test", auth, "bad json"), env))
        .status,
      400,
    );
    assert.equal(
      (await handle(request("https://site.test", auth, "{}"), env)).status,
      400,
    );
    assert.equal(
      (
        await handle(
          request(
            "https://site.test",
            other,
            JSON.stringify({
              revision: a.revision,
              authorLogin: "alice",
              authorId: 1,
            }),
          ),
          env,
        )
      ).status,
      403,
    );
    assert.equal(repo.patches(), 0);
    assert.equal(
      (
        await handle(
          request(
            "https://site.test",
            auth,
            JSON.stringify({ revision: a.revision }),
          ),
          env,
        )
      ).status,
      200,
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("重命名方向原子更新多人笔记、目录和阅读版，保留正文、其他方向、图片与 PDF 链接", async () => {
  const a = {
    ...makeNote(),
    tags: ["旧方向", "其他方向"],
    body: "我的原始图文内容",
    pdfUrl: "https://arxiv.org/pdf/2601.12345",
  };
  a.assets = [
    { path: `assets/uploads/${a.id}/figure.png`, mime: "image/png", size: 3 },
  ];
  const b = { ...makeNote(bob), tags: ["旧方向"] };
  const repo = repository([a, b]);
  repo.files.set(a.assets[0].path, "IMG");
  repo.files.set(
    "data/directions.json",
    JSON.stringify({
      version: 1,
      directions: ["旧方向", "其他方向", "空目录"],
    }),
  );
  repo.files.set(`${directionFolder("旧方向")}/README.md`, "old");
  for (const n of [a, b])
    repo.files.set(`${directionFolder("旧方向")}/${n.id}.md`, toMarkdown(n));
  const result = await changeDirection(
    env,
    bob,
    { name: "旧方向", replacement: "新方向 / A" },
    repo.fetcher,
  );
  assert.equal(repo.patches(), 1);
  assert.deepEqual(result.directions, ["新方向 / A", "其他方向", "空目录"]);
  assert.ok(
    ![...repo.files.keys()].some((p) =>
      p.startsWith(directionFolder("旧方向") + "/"),
    ),
  );
  for (const original of [a, b]) {
    const next = JSON.parse(repo.files.get(`data/notes/${original.id}.json`)!);
    assert.equal(next.body, original.body);
    assert.equal(next.author, original.author);
    assert.deepEqual(next.assets, original.assets);
    assert.equal(next.pdfUrl, original.pdfUrl);
    assert.notEqual(next.revision, original.revision);
    assert.ok(
      repo.files
        .get(`${directionFolder("新方向 / A")}/${original.id}.md`)!
        .includes(original.author),
    );
  }
  assert.deepEqual(result.notes[0].tags, ["新方向 / A", "其他方向"]);
  assert.equal(repo.files.get(a.assets[0].path), "IMG");
  assert.deepEqual(
    JSON.parse(repo.files.get("data/directions.json")!).retired,
    ["旧方向"],
  );
});

test("删除非空方向保留全部笔记及图片，单方向笔记移入未分类，重复删除幂等", async () => {
  const a = { ...makeNote(), tags: ["待删除", "保留方向"] };
  const b = { ...makeNote(bob), tags: ["待删除"] };
  const repo = repository([a, b]);
  repo.files.set(
    "data/directions.json",
    JSON.stringify({ version: 1, directions: ["待删除", "保留方向"] }),
  );
  repo.files.set(`${directionFolder("待删除")}/README.md`, "old");
  const result = await changeDirection(
    env,
    alice,
    { name: "待删除", replacement: null },
    repo.fetcher,
  );
  assert.deepEqual(result.directions, ["保留方向"]);
  assert.equal(result.notes.length, 2);
  assert.deepEqual(result.notes[0].tags, ["保留方向"]);
  assert.deepEqual(result.notes[1].tags, []);
  assert.ok(repo.files.has(`papers/_未分类/${b.id}.md`));
  assert.ok(repo.files.get("papers/_未分类/README.md")!.includes(b.id));
  assert.ok(!repo.files.has(`${directionFolder("待删除")}/README.md`));
  assert.equal(
    JSON.parse(repo.files.get(`data/notes/${b.id}.json`)!).author,
    "Bob",
  );
  await changeDirection(
    env,
    alice,
    { name: "待删除", replacement: null },
    repo.fetcher,
  );
  assert.equal(repo.patches(), 1);
});

test("空方向可重命名和删除，冲突名称与无权限操作不修改仓库", async () => {
  const repo = repository();
  await createDirection(env, alice, "空方向", repo.fetcher);
  await createDirection(env, alice, "已有方向", repo.fetcher);
  const before = new Map(repo.files);
  for (const replacement of ["已有方向", "<bad>", ""]) {
    await assert.rejects(() =>
      changeDirection(
        env,
        alice,
        { name: "空方向", replacement },
        repo.fetcher,
      ),
    );
    assert.deepEqual(repo.files, before);
  }
  await assert.rejects(
    () =>
      changeDirection(
        env,
        alice,
        { name: "空方向", replacement: null },
        repository([], { writable: false }).fetcher,
      ),
    /写入权限/,
  );
  await changeDirection(
    env,
    alice,
    { name: "空方向", replacement: "重命名后" },
    repo.fetcher,
  );
  assert.ok(repo.files.has(`${directionFolder("重命名后")}/README.md`));
  assert.ok(!repo.files.has(`${directionFolder("空方向")}/README.md`));
  await changeDirection(
    env,
    alice,
    { name: "重命名后", replacement: null },
    repo.fetcher,
  );
  assert.ok(!repo.files.has(`${directionFolder("重命名后")}/README.md`));
  await createDirection(env, alice, "重命名后", repo.fetcher);
  assert.ok(
    !JSON.parse(repo.files.get("data/directions.json")!).retired.includes(
      "重命名后",
    ),
  );
});

test("整理方向遇到并发发布会重读合并，缺失笔记时不部分改名", async () => {
  const a = { ...makeNote(), tags: ["原方向"] };
  const repo = repository([a], { conflict: true });
  const result = await changeDirection(
    env,
    alice,
    { name: "原方向", replacement: "新方向" },
    repo.fetcher,
  );
  assert.equal(repo.patches(), 2);
  assert.equal(result.notes.length, 2);
  assert.ok(result.notes.some((n) => n.authorLogin === "bob"));
  const broken = repository([a], { missing: `data/notes/${a.id}.json` });
  const before = new Map(broken.files);
  await assert.rejects(
    () =>
      changeDirection(
        env,
        alice,
        { name: "原方向", replacement: null },
        broken.fetcher,
      ),
    /目录不一致/,
  );
  assert.equal(broken.patches(), 0);
  assert.deepEqual(broken.files, before);
});

test("历史草稿不能恢复已删除方向，其他写操作保留删除记录", async () => {
  const a = { ...makeNote(), tags: ["已删除"] };
  const repo = repository([a]);
  await changeDirection(
    env,
    alice,
    { name: "已删除", replacement: null },
    repo.fetcher,
  );
  await updateProfile(env, alice, "新昵称", repo.fetcher);
  const stale = { ...makeNote(), tags: ["已删除"] };
  const before = repo.patches();
  await assert.rejects(
    () => commitNote(env, alice, { note: stale, assets: [] }, repo.fetcher),
    /方向已重命名或删除/,
  );
  assert.equal(repo.patches(), before);
  assert.deepEqual(
    JSON.parse(repo.files.get("data/directions.json")!).retired,
    ["已删除"],
  );
});

test("大方向批量重命名在免费请求预算内同步全部笔记，超限不提交", async () => {
  const originals = Array.from({ length: 80 }, () => ({
    ...makeNote(),
    tags: ["旧方向"],
  }));
  const repo = repository(originals);
  let requests = 0;
  const bounded: typeof fetch = async (input, init) => {
    if (++requests > 50)
      throw new Error("free plan subrequest budget exceeded");
    return repo.fetcher(input, init);
  };
  const result = await changeDirection(
    env,
    alice,
    { name: "旧方向", replacement: "新方向" },
    bounded,
  );
  assert.equal(result.notes.length, 80);
  assert.ok(result.notes.every((n) => n.tags[0] === "新方向"));
  assert.ok(requests < 30);
  const large = repository(
    Array.from({ length: 251 }, () => ({ ...makeNote(), tags: ["太大"] })),
  );
  await assert.rejects(
    () =>
      changeDirection(
        env,
        alice,
        { name: "太大", replacement: null },
        large.fetcher,
      ),
    /250/,
  );
  assert.equal(large.patches(), 0);
});

test("方向修改和删除接口防跨站及未登录，权限不足或畸形输入不修改目录", async () => {
  const repo = repository();
  const previous = globalThis.fetch;
  globalThis.fetch = repo.fetcher;
  try {
    const cookie = `mcs_session=${await seal(alice, env.SESSION_SECRET)}`;
    for (const method of ["PATCH", "DELETE"]) {
      const request = (origin: string, auth: string, body: string) =>
        new Request("https://site.test/api/directions", {
          method,
          headers: { Origin: origin, Cookie: auth },
          body,
        });
      assert.equal(
        (await handle(request("https://evil.test", cookie, "{}"), env)).status,
        403,
      );
      assert.equal(
        (await handle(request("https://site.test", "", "{}"), env)).status,
        401,
      );
      assert.equal(
        (await handle(request("https://site.test", cookie, "bad json"), env))
          .status,
        400,
      );
      assert.equal(
        (await handle(request("https://site.test", cookie, "{}"), env)).status,
        400,
      );
    }
    assert.equal(repo.patches(), 0);
  } finally {
    globalThis.fetch = previous;
  }
});
