import { HttpError, type Env } from "./app";

const cache = new WeakMap<Env, { token: string; expires: number }>();
const pending = new WeakMap<Env, Promise<string>>();
export function invalidateInstallationToken(env: Env, token: string) {
  if (cache.get(env)?.token === token) cache.delete(env);
}
export const installationConfigured = (env: Env) =>
  !!env.GITHUB_APP_PRIVATE_KEY && !!env.GITHUB_CLIENT_ID;
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const encoded = (value: unknown) =>
  base64url(new TextEncoder().encode(JSON.stringify(value)));
function der(tag: number, data: Uint8Array): Uint8Array {
  const length: number[] = [];
  let n = data.length;
  if (n < 128) length.push(n);
  else {
    const parts: number[] = [];
    while (n) {
      parts.unshift(n & 255);
      n >>>= 8;
    }
    length.push(128 | parts.length, ...parts);
  }
  return new Uint8Array([tag, ...length, ...data]);
}
function keyBytes(pem: string) {
  const text = pem.replace(/\\n/g, "\n");
  const bytes = Uint8Array.from(
    atob(text.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  if (text.includes("BEGIN PRIVATE KEY")) return bytes;
  if (!text.includes("BEGIN RSA PRIVATE KEY"))
    throw new Error("Unsupported key");
  // GitHub downloads PKCS#1 keys. WebCrypto imports the PKCS#8 wrapper.
  return der(
    0x30,
    new Uint8Array([
      0x02,
      0x01,
      0x00,
      0x30,
      0x0d,
      0x06,
      0x09,
      0x2a,
      0x86,
      0x48,
      0x86,
      0xf7,
      0x0d,
      0x01,
      0x01,
      0x01,
      0x05,
      0x00,
      ...der(0x04, bytes),
    ]),
  );
}
async function mint(env: Env, fetcher: typeof fetch) {
  if (!installationConfigured(env))
    throw new HttpError(
      503,
      "邀请功能尚未完成配置，请维护者配置 GitHub App 私钥。",
    );
  let stage = "私钥签名";
  try {
    const now = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array(keyBytes(env.GITHUB_APP_PRIVATE_KEY!)).buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const unsigned = `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({ iat: now - 60, exp: now + 540, iss: env.GITHUB_CLIENT_ID })}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsigned),
    );
    const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": "MCS-BIEP-RA",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${jwt}`,
    };
    stage = "读取仓库安装";
    const installation = await fetcher(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/installation`,
      {
        headers,
        signal: AbortSignal.timeout(20_000),
        redirect: "manual",
      },
    );
    if (!installation.ok) throw new Error("Installation unavailable");
    const info = (await installation.json()) as { id?: number };
    if (!Number.isSafeInteger(info.id)) throw new Error("Invalid installation");
    stage = "获取仓库令牌";
    const response = await fetcher(
      `https://api.github.com/app/installations/${info.id}/access_tokens`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          repositories: [env.GITHUB_REPO],
          permissions: { contents: "write" },
        }),
        signal: AbortSignal.timeout(20_000),
        redirect: "manual",
      },
    );
    if (!response.ok) throw new Error("Token unavailable");
    const result = (await response.json()) as {
      token?: string;
      expires_at?: string;
      permissions?: { contents?: string };
    };
    const expires = Date.parse(result.expires_at || "");
    if (
      !result.token ||
      result.permissions?.contents !== "write" ||
      !Number.isFinite(expires) ||
      expires < Date.now() + 60_000
    )
      throw new Error("Invalid token");
    cache.set(env, {
      token: result.token,
      expires: Math.min(expires - 60_000, Date.now() + 50 * 60_000),
    });
    return result.token;
  } catch {
    throw new HttpError(
      503,
      `后台仓库授权暂时不可用（${stage}失败），请维护者检查 GitHub App 私钥与该仓库的安装权限。`,
    );
  }
}
export async function installationToken(
  env: Env,
  fetcher: typeof fetch = fetch,
) {
  const entry = cache.get(env);
  if (entry && entry.expires > Date.now()) return entry.token;
  let task = pending.get(env);
  if (!task) {
    task = mint(env, fetcher).finally(() => pending.delete(env));
    pending.set(env, task);
  }
  return task;
}
