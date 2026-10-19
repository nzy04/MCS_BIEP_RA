import test from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, session } from "../src/services/api";

test("静态 HTML 响应不能被当成已登录会话，网络失败不自动重发写请求", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<html>fallback page</html>");
    assert.equal(await session(), null);
    await assert.rejects(
      api("/api/library"),
      (e) => e instanceof ApiError && e.status === 502,
    );
    let requests = 0;
    globalThis.fetch = async () => {
      requests++;
      throw new Error("network lost");
    };
    await assert.rejects(
      api("/api/publish", { method: "POST", body: "{}" }),
      /核对保存结果/,
    );
    assert.equal(requests, 1);
    globalThis.fetch = async () => Response.json(null);
    assert.equal(await session(), null);
  } finally {
    globalThis.fetch = original;
  }
});
