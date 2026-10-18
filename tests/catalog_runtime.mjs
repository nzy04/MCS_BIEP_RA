import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { Miniflare, Response } = require(
  require.resolve("miniflare", { paths: [require.resolve("wrangler")] }),
);
const persist = path.resolve(`test-results/catalog-runtime-${Date.now()}`);
let downloads = 0,
  models = 0,
  refWrites = 0;
const blobs = new Map();
const settings = {
  resourcePersistencePath: persist,
  telemetry: { enabled: false },
  workers: [
    {
      config: {
        name: "catalog-runtime",
        compatibilityDate: "2026-10-18",
        manifest: {
          mainModule: "index.js",
          modules: {
            "index.js": {
              type: "esm",
              contents: readFileSync(
                "test-results/review-bundle/index.js",
                "utf8",
              ),
            },
          },
        },
        env: {
          ...Object.fromEntries(
            Object.entries({
              SITE_TITLE: "MCS_BIEP",
              GITHUB_OWNER: "group",
              GITHUB_REPO: "repo",
              GITHUB_BRANCH: "main",
              SESSION_SECRET:
                "test-runtime-session-secret-at-least-32-characters",
            }).map(([k, value]) => [k, { type: "text", value }]),
          ),
          REVIEW_QUEUE: {
            type: "durable-object",
            worker: "catalog-runtime",
            exportName: "ReviewQueue",
          },
        },
        exports: { ReviewQueue: { type: "durable-object", storage: "sqlite" } },
      },
      dev: {
        outboundService: {
          type: "fetcher",
          handler: async (request) => {
            const u = new URL(request.url);
            if (u.hostname.includes("deepseek")) {
              models++;
              return new Response("not allowed", { status: 500 });
            }
            if (u.hostname === "arxiv.org") {
              downloads++;
              return new Response("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
            }
            if (u.hostname === "api.github.com") {
              const p = u.pathname;
              if (p === "/repos/group/repo")
                return Response.json({ permissions: { push: true } });
              if (p.includes("/contents/"))
                return Response.json({ message: "not found" }, { status: 404 });
              if (p.includes("/git/ref/"))
                return Response.json({ object: { sha: "head" } });
              if (p === "/repos/group/repo/git/commits/head")
                return Response.json({ tree: { sha: "base" } });
              if (p.endsWith("/blobs")) {
                const body = await request.json();
                const sha = `blob${blobs.size}`;
                blobs.set(sha, body);
                return Response.json({ sha });
              }
              if (p.endsWith("/trees")) {
                const body = await request.json();
                assert.equal(body.base_tree, "base");
                assert.equal(body.tree.length, 3);
                return Response.json({ sha: "tree" });
              }
              if (p.endsWith("/commits")) return Response.json({ sha: "new" });
              if (p.includes("/git/refs/")) {
                refWrites++;
                return Response.json({});
              }
            }
            return new Response("unexpected", { status: 500 });
          },
        },
      },
    },
  ],
};
const user = {
  id: 7,
  login: "member",
  name: "成员",
  avatar: "",
  canWrite: true,
  token: "test-token",
  expires: Date.now() + 3600000,
};
const paper = {
  title: "World Models",
  authors: ["David Ha"],
  year: "2018",
  venue: "arXiv",
  abstract: "Test",
  paperUrl: "https://arxiv.org/abs/1803.10122",
  pdfUrl: "https://arxiv.org/pdf/1803.10122",
  doi: "",
  source: "arxiv",
  tags: ["世界模型"],
  license: "https://creativecommons.org/licenses/by/4.0/",
  score: 1,
};
let mf;
async function target() {
  const ns = await mf.getDurableObjectNamespace("REVIEW_QUEUE");
  return ns.get(ns.idFromName("catalog-persistence"));
}
async function call(action) {
  return (await target()).fetch("https://internal/", {
    method: "POST",
    body: JSON.stringify({
      action,
      user,
      ...(action === "paper-submit" ? { paper } : {}),
    }),
  });
}
try {
  mf = new Miniflare(settings);
  const submitted = await (await call("paper-submit")).json();
  assert.equal(submitted.job.status, "queued");
  assert.equal(downloads, 0);
  await mf.dispose();
  mf = new Miniflare(settings);
  let job;
  for (let i = 0; i < 50; i++) {
    job = (await (await call("list")).json()).jobs[0];
    if (job.status === "published" || job.status === "failed") break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(job.status, "published", JSON.stringify(job));
  assert.equal(job.kind, "paper");
  assert.equal(downloads, 1);
  assert.equal(refWrites, 1);
  assert.equal(models, 0);
  const repeated = await (await call("paper-submit")).json();
  assert.equal(repeated.job.id, submitted.job.id);
  assert.equal(refWrites, 1);
  const detail = [...blobs.values()]
    .filter((b) => b.encoding === "utf-8")
    .map((b) => JSON.parse(b.content))
    .find((b) => b.pdfStatus);
  assert.equal(detail.pdfStatus, "archived");
  assert.equal(detail.pdfVerified, true);
  console.log(
    JSON.stringify({
      sqlitePersistence: true,
      alarmAfterRestart: true,
      status: job.status,
      pdfStatus: detail.pdfStatus,
      downloads,
      refWrites,
      models,
    }),
  );
} finally {
  await mf?.dispose();
}
