import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { MemberRegistry } from "../worker/members";
import { installationToken } from "../worker/installation";
import {
  assertWriteAccess,
  github,
  handle,
  seal,
  unseal,
  type Env,
  type Identity,
} from "../worker/app";
import type { QueueState, QueueStorage } from "../worker/reviewQueue";

class Storage implements QueueStorage {
  data = new Map<string, any>();
  async get<T>(key: string) {
    return structuredClone(this.data.get(key)) as T | undefined;
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    if (typeof key === "string") this.data.set(key, structuredClone(value));
    else
      for (const [k, v] of Object.entries(key))
        this.data.set(k, structuredClone(v));
  }
  async delete(key: string | string[]) {
    for (const k of typeof key === "string" ? [key] : key) this.data.delete(k);
  }
  async list<T>({ prefix }: { prefix: string }) {
    return new Map(
      [...this.data]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => [k, structuredClone(v)]),
    ) as Map<string, T>;
  }
  async getAlarm() {
    return null;
  }
  async setAlarm() {}
  async transaction<T>(fn: (s: QueueStorage) => Promise<T>) {
    const snapshot = structuredClone(this.data);
    try {
      return await fn(this);
    } catch (e) {
      this.data = snapshot;
      throw e;
    }
  }
}
const base: Env = {
  ASSETS: { fetch: async () => new Response("site") },
  SITE_TITLE: "MCS",
  GITHUB_OWNER: "owner",
  GITHUB_REPO: "papers",
  GITHUB_BRANCH: "main",
  GITHUB_CLIENT_ID: "Iv1.test-client",
  GITHUB_CLIENT_SECRET: "only-a-test-client-secret",
  SESSION_SECRET: "test-only-session-key-with-at-least-32-characters",
};
const owner: Identity = {
  id: 1,
  login: "owner",
  name: "Owner",
  avatar: "",
  canWrite: true,
  token: "owner-oauth-test-token",
  expires: Date.now() + 3600000,
};
const guest: Identity = {
  ...owner,
  id: 2,
  login: "guest",
  name: "Guest",
  canWrite: false,
  token: "guest-oauth-test-token",
};
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1 = keyPair.privateKey
  .export({ type: "pkcs1", format: "pem" })
  .toString();
const pkcs8 = keyPair.privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();
function fixture() {
  const storage = new Storage();
  let pending = Promise.resolve();
  const state: QueueState = {
    storage,
    blockConcurrencyWhile: (fn) => {
      const result = pending.then(fn);
      pending = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
  const env = { ...base };
  const registry = new MemberRegistry(state, env);
  env.MEMBERS = { idFromName: (n) => n, get: () => registry };
  const call = async (
    action: string,
    value: Record<string, unknown> = {},
    user: Identity | undefined = owner,
  ) => {
    const response = await registry.fetch(
      new Request("https://internal/", {
        method: "POST",
        body: JSON.stringify({ action, user, ...value }),
      }),
    );
    return { status: response.status, body: (await response.json()) as any };
  };
  return { storage, state, env, call };
}
const response = (value: unknown, status = 200) =>
  Response.json(value, { status });
function network(env: Env) {
  const calls: { path: string; authorization: string }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const auth = new Headers(init?.headers).get("Authorization") || "";
    calls.push({ path, authorization: auth });
    if (path.endsWith("/installation")) {
      const jwt = auth.slice(7),
        parts = jwt.split(".");
      assert.equal(parts.length, 3);
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      assert.equal(claims.iss, env.GITHUB_CLIENT_ID);
      assert.ok(claims.exp - claims.iat <= 600);
      assert.ok(
        verify(
          "RSA-SHA256",
          Buffer.from(parts.slice(0, 2).join(".")),
          keyPair.publicKey,
          Buffer.from(parts[2], "base64url"),
        ),
      );
      return response({ id: 123 });
    }
    if (path === "/app/installations/123/access_tokens") {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        repositories: ["papers"],
        permissions: { contents: "write" },
      });
      return response({
        token: "scoped-installation-test-token",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        permissions: { contents: "write" },
      });
    }
    return response({ ok: true, permissions: { push: false } });
  };
  return { fetcher, calls };
}

test("邀请自动加入按 GitHub 稳定ID识别，重复和并发加入只占一个名额", async () => {
  const f = fixture();
  const invite = (await f.call("create")).body;
  assert.equal(invite.token.length, 43);
  assert.ok(!JSON.stringify([...f.storage.data]).includes(invite.token));
  assert.equal(
    (await f.call("preview", { token: invite.token }, undefined)).body.valid,
    true,
  );
  const results = await Promise.all([
    f.call("join", { token: invite.token }, guest),
    f.call("join", { token: invite.token }, guest),
  ]);
  assert.ok(results.every((r) => r.status === 200));
  assert.equal((await f.call("list")).body.invitation.uses, 1);
  assert.equal(
    (await f.call("status", {}, { ...guest, login: "new-name" })).body.active,
    true,
  );
  assert.equal((await f.call("list", {}, guest)).status, 403);
});

test("过期、停用、换新、满额邀请失效，成员名单不写入公共仓库", async () => {
  const f = fixture();
  const first = (await f.call("create")).body;
  const second = (await f.call("create")).body;
  assert.equal(
    (await f.call("join", { token: first.token }, guest)).status,
    410,
  );
  f.storage.data.get("invite:active").expiresAt = new Date(
    Date.now() - 1,
  ).toISOString();
  assert.equal(
    (await f.call("join", { token: second.token }, guest)).status,
    410,
  );
  const third = (await f.call("create")).body;
  f.storage.data.get("invite:active").uses = 50;
  assert.equal(
    (await f.call("join", { token: third.token }, guest)).status,
    410,
  );
  await f.call("revoke");
  assert.equal(
    (await f.call("preview", { token: third.token }, undefined)).body.valid,
    false,
  );
  assert.equal((await f.storage.list({ prefix: "member:" })).size, 0);
});

test("移除立即撤销旧登录和已排队写入资格，旧邀请不能绕过，维护者可恢复", async () => {
  const f = fixture();
  const invite = (await f.call("create")).body;
  await f.call("join", { token: invite.token }, guest);
  f.env.GITHUB_APP_PRIVATE_KEY = pkcs1;
  const net = network(f.env);
  await assertWriteAccess(f.env, guest, net.fetcher);
  assert.equal(
    (await f.call("update", { id: guest.id, active: false })).status,
    200,
  );
  await assert.rejects(
    assertWriteAccess(f.env, { ...guest, canWrite: true }, net.fetcher),
    /移除/,
  );
  assert.equal(
    (await f.call("join", { token: invite.token }, guest)).status,
    403,
  );
  assert.equal(
    (await f.call("update", { id: owner.id, active: false })).status,
    400,
  );
  assert.equal(
    (await f.call("update", { id: guest.id, active: true }, guest)).status,
    403,
  );
  await f.call("update", { id: guest.id, active: true });
  await assertWriteAccess(f.env, guest, net.fetcher);
});

test("加入写入失败回滚成员和邀请计数，重试可恢复", async () => {
  const f = fixture();
  const invite = (await f.call("create")).body;
  const put = f.storage.put.bind(f.storage);
  let fail = true;
  f.storage.put = async (key: any, value?: unknown) => {
    if (
      fail &&
      typeof key === "object" &&
      Object.keys(key).some((k) => k.startsWith("member:"))
    ) {
      fail = false;
      throw new Error("storage failure");
    }
    return put(key, value);
  };
  assert.equal(
    (await f.call("join", { token: invite.token }, guest)).status,
    500,
  );
  assert.equal((await f.call("status", {}, guest)).body.active, false);
  assert.equal((await f.call("list")).body.invitation.uses, 0);
  assert.equal(
    (await f.call("join", { token: invite.token }, guest)).status,
    200,
  );
});

test("安装凭据支持 GitHub PKCS1 与 PKCS8，限制单仓库且并发只换一次令牌", async () => {
  for (const key of [pkcs1, pkcs8]) {
    const f = fixture();
    f.env.GITHUB_APP_PRIVATE_KEY = key;
    const net = network(f.env);
    const tokens = await Promise.all([
      installationToken(f.env, net.fetcher),
      installationToken(f.env, net.fetcher),
    ]);
    assert.deepEqual(tokens, [
      "scoped-installation-test-token",
      "scoped-installation-test-token",
    ]);
    assert.equal(net.calls.length, 2);
    await github(
      f.env,
      "/repos/owner/papers/git/trees",
      guest.token,
      { method: "POST", body: "{}" },
      net.fetcher,
    );
    assert.equal(
      net.calls[2].authorization,
      "Bearer scoped-installation-test-token",
    );
    await github(f.env, "/user", guest.token, {}, net.fetcher);
    assert.equal(net.calls[3].authorization, `Bearer ${guest.token}`);
    assert.equal(guest.token, "guest-oauth-test-token");
  }
});

test("后台凭据失效清除缓存但不自动重放写入，下次操作重新授权", async () => {
  for (const status of [401, 403]) {
    const f = fixture();
    f.env.GITHUB_APP_PRIVATE_KEY = pkcs1;
    const net = network(f.env);
    let writes = 0;
    const fetcher: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname.endsWith("/git/trees")) {
        writes++;
        return response({ message: "Access revoked" }, status);
      }
      return net.fetcher(input, init);
    };
    await assert.rejects(
      github(
        f.env,
        "/repos/owner/papers/git/trees",
        guest.token,
        { method: "POST", body: "{}" },
        fetcher,
      ),
      (e: any) => e.status === 503 && /后台仓库授权/.test(e.message),
    );
    assert.equal(writes, 1);
    assert.equal(net.calls.length, 2);
    await installationToken(f.env, fetcher);
    assert.equal(net.calls.length, 4);
    await assert.rejects(
      github(f.env, "/user", guest.token, {}, async () => response({}, 401)),
      (e: any) => e.status === 401 && /重新登录/.test(e.message),
    );
  }
});

test("成员接口防匿名、越权、跨站与开放重定向，私钥不返回前端", async () => {
  const f = fixture();
  const cookie = async (u: Identity) =>
    `mcs_session=${await seal(u, f.env.SESSION_SECRET)}`;
  const request = async (
    path: string,
    method: string,
    user?: Identity,
    body?: unknown,
    origin = "https://site.test",
  ) =>
    handle(
      new Request(`https://site.test${path}`, {
        method,
        headers: {
          Origin: origin,
          ...(user ? { Cookie: await cookie(user) } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      f.env,
    );
  assert.equal((await request("/api/members", "GET")).status, 401);
  assert.equal((await request("/api/members", "GET", guest)).status, 403);
  assert.equal(
    (
      await request(
        "/api/members/invitation",
        "POST",
        owner,
        undefined,
        "https://evil.test",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/invitations/join", "POST", undefined, {
        token: "a".repeat(43),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/auth/login", "POST", undefined, {
        returnTo: "https://evil.test",
      })
    ).status,
    400,
  );
  const invite = (await f.call("create")).body;
  const login = await request("/api/auth/login", "POST", undefined, {
    returnTo: `/#join/${invite.token}`,
  });
  assert.equal(login.status, 200);
  const flowCookie = login.headers
    .get("Set-Cookie")!
    .match(/mcs_oauth=([^;]+)/)![1];
  const flow = await unseal<any>(flowCookie, f.env.SESSION_SECRET);
  assert.equal(flow.returnTo, `/#join/${invite.token}`);
  assert.ok(!(await login.text()).includes(invite.token));
  const original = globalThis.fetch;
  globalThis.fetch = async () => response({}, 404);
  try {
    const ownerSession = await request("/api/session", "GET", owner);
    assert.equal(((await ownerSession.json()) as any).isAdmin, true);
  } finally {
    globalThis.fetch = original;
  }
});
