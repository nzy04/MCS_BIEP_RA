import {
  sectionDefinitions,
  summarize,
  toMarkdown,
  validateNote,
  type Note,
  type NoteSummary,
  type Session,
  type UploadAsset,
} from "../shared/note";
export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SITE_TITLE: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}
interface Identity extends Session {
  token: string;
  id: number;
  expires: number;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const repository = (env: Env) => `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
const configured = (env: Env) => !!env.GITHUB_OWNER && !!env.GITHUB_REPO;
const authConfigured = (env: Env) =>
  configured(env) &&
  !!env.GITHUB_CLIENT_ID &&
  !!env.GITHUB_CLIENT_SECRET &&
  env.SESSION_SECRET?.length >= 32;
const encode = (data: Uint8Array) =>
  btoa(Array.from(data, (b) => String.fromCharCode(b)).join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const decode = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
export async function seal(value: unknown, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function unseal<T>(
  value: string,
  secret: string,
): Promise<T | null> {
  try {
    const [iv, data] = value.split(".");
    const key = await crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    return JSON.parse(
      new TextDecoder().decode(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: decode(iv) },
          key,
          decode(data),
        ),
      ),
    );
  } catch {
    return null;
  }
}
function cookie(request: Request, name: string) {
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}
function setCookie(request: Request, name: string, value: string, age: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function identity(request: Request, env: Env) {
  if (!authConfigured(env)) return null;
  const user = await unseal<Identity>(
    cookie(request, "mcs_session"),
    env.SESSION_SECRET,
  );
  return user && user.expires > Date.now() ? user : null;
}
function requireOrigin(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin)
    throw new HttpError(403, "请求来源不匹配，请从本网站重新提交。");
}
async function github<T = any>(
  env: Env,
  path: string,
  token: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "MCS-BIEP-RA",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ message: "" }))) as {
      message?: string;
    };
    throw new HttpError(
      response.status === 401
        ? 401
        : response.status === 403
          ? 403
          : response.status === 404
            ? 404
            : response.status === 422
              ? 409
              : 502,
      response.status === 401
        ? "GitHub 登录已失效，请重新登录。"
        : response.status === 403
          ? "当前账号或应用没有仓库写入权限。"
          : `GitHub 请求失败：${error.message || response.status}`,
    );
  }
  return response.json() as Promise<T>;
}
function validateIncoming(value: any): {
  note: Note;
  assets: UploadAsset[];
  baseRevision: string;
} {
  if (!value?.note || typeof value.note !== "object")
    throw new HttpError(400, "缺少笔记内容。");
  const input = value.note;
  if (
    typeof input.id !== "string" ||
    !/^note-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      input.id,
    )
  )
    throw new HttpError(400, "笔记 ID 不合法。");
  const text = (name: string, max: number) => {
    if (typeof input[name] !== "string" || input[name].length > max)
      throw new HttpError(400, `字段 ${name} 不合法或过长。`);
    return input[name];
  };
  if (!input.sections || typeof input.sections !== "object")
    throw new HttpError(400, "缺少模板章节。");
  const sections = Object.fromEntries(
    sectionDefinitions.map((s) => {
      const v = input.sections[s.key];
      if (typeof v !== "string" || v.length > 150000)
        throw new HttpError(400, "笔记章节内容过长或格式不正确。");
      return [s.key, v];
    }),
  ) as Note["sections"];
  if (
    !Array.isArray(input.tags) ||
    input.tags.length > 8 ||
    input.tags.some((t: unknown) => typeof t !== "string" || t.length > 50)
  )
    throw new HttpError(400, "最多填写 8 个标签，每个不超过 50 字。");
  if (!Array.isArray(input.assets) || input.assets.length > 25)
    throw new HttpError(400, "最多附带 25 个文件。");
  const prefix = `assets/uploads/${input.id}/`;
  const allowed: Record<string, RegExp> = {
    "image/png": /\.png$/,
    "image/jpeg": /\.jpe?g$/,
    "image/webp": /\.webp$/,
    "image/gif": /\.gif$/,
    "application/pdf": /\.pdf$/,
  };
  const metadata = input.assets.map((a: any) => {
    if (
      typeof a.path !== "string" ||
      !a.path.startsWith(prefix) ||
      !/^[-a-zA-Z0-9.]+$/.test(a.path.slice(prefix.length)) ||
      !allowed[a.mime]?.test(a.path) ||
      typeof a.size !== "number" ||
      a.size < 0 ||
      a.size > 4 * 1024 * 1024
    )
      throw new HttpError(400, "附件路径、格式或大小不合法。");
    return { path: a.path, mime: a.mime, size: a.size };
  });
  const assets = value.assets ?? [];
  if (!Array.isArray(assets) || assets.length > 25)
    throw new HttpError(400, "附件列表不合法。");
  let bytes = 0;
  for (const a of assets) {
    const m = metadata.find((m: any) => m.path === a.path);
    if (
      !m ||
      m.mime !== a.mime ||
      typeof a.base64 !== "string" ||
      a.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64)
    )
      throw new HttpError(400, "附件编码不合法。");
    bytes += a.base64.length * 0.75;
    if (bytes > 6 * 1024 * 1024)
      throw new HttpError(413, "一次发布的附件总量请控制在 6 MB 内。");
    const header = atob(a.base64.slice(0, 40));
    if (
      (a.mime === "application/pdf" && !header.startsWith("%PDF-")) ||
      (a.mime === "image/png" && !header.startsWith("\x89PNG\r\n\x1a\n")) ||
      (a.mime === "image/jpeg" && !header.startsWith("\xff\xd8\xff")) ||
      (a.mime === "image/gif" && !header.startsWith("GIF8")) ||
      (a.mime === "image/webp" &&
        !(header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"))
    )
      throw new HttpError(400, "附件内容与文件类型不匹配。");
  }
  const now = new Date().toISOString();
  const note: Note = {
    id: input.id,
    title: text("title", 250),
    subtitle: text("subtitle", 500),
    year: text("year", 4),
    venue: text("venue", 80),
    paperUrl: text("paperUrl", 1500),
    codeUrl: text("codeUrl", 1500),
    author: text("author", 100),
    authorLogin: "",
    tags: input.tags,
    readingDepth: text("readingDepth", 30),
    createdAt: now,
    updatedAt: now,
    revision: "",
    excerpt: "",
    sections,
    assets: metadata,
    sourceNames: Array.isArray(input.sourceNames)
      ? input.sourceNames
          .filter((s: unknown) => typeof s === "string")
          .map((s: string) => s.slice(0, 250))
          .slice(0, 10)
      : [],
  };
  const errors = validateNote(note);
  if (errors.length) throw new HttpError(400, errors.join(" "));
  return {
    note,
    assets,
    baseRevision:
      typeof value.baseRevision === "string" ? value.baseRevision : "",
  };
}
export async function commitNote(
  env: Env,
  user: Identity,
  value: unknown,
  fetcher: typeof fetch = fetch,
): Promise<{ note: Note; commitUrl: string }> {
  const { note, assets, baseRevision } = validateIncoming(value);
  const root = `/repos/${repository(env)}`;
  const branch = env.GITHUB_BRANCH || "main";
  const permissions = await github<any>(env, root, user.token, {}, fetcher);
  if (
    !permissions.permissions?.push &&
    !permissions.permissions?.admin &&
    !permissions.permissions?.maintain
  )
    throw new HttpError(403, "你还没有此仓库的写入权限，请联系课题组维护者。");
  note.authorLogin = user.login;
  note.author ||= user.name || user.login;
  const fingerprint = {
    ...note,
    createdAt: "",
    updatedAt: "",
    revision: "",
    excerpt: "",
    assets: note.assets,
    uploads: assets.map((a) => ({ path: a.path, base64: a.base64 })),
  };
  note.revision = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(fingerprint)),
      ),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  for (let attempt = 0; attempt < 3; attempt++) {
    let head: any;
    try {
      head = await github(
        env,
        `${root}/git/ref/heads/${encodeURIComponent(branch)}`,
        user.token,
        {},
        fetcher,
      );
    } catch (e) {
      if ((e as HttpError).status === 404)
        throw new HttpError(
          409,
          "请先在仓库创建 README，初始化主分支后再发布。",
        );
      throw e;
    }
    const headCommit = await github<any>(
      env,
      `${root}/git/commits/${head.object.sha}`,
      user.token,
      {},
      fetcher,
    );
    let index: { notes: NoteSummary[] } = { notes: [] };
    try {
      const file = await github<any>(
        env,
        `${root}/contents/data/library.json?ref=${head.object.sha}`,
        user.token,
        {},
        fetcher,
      );
      if (file.content)
        index = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(atob(file.content.replace(/\s/g, "")), (c) =>
              c.charCodeAt(0),
            ),
          ),
        );
      else throw new HttpError(413, "目录文件过大，需要升级目录读取方式。");
    } catch (e) {
      if ((e as HttpError).status !== 404) throw e;
    }
    const previous = index.notes.find((n) => n.id === note.id);
    if (previous?.revision === note.revision)
      return {
        note: {
          ...note,
          createdAt: previous.createdAt,
          updatedAt: previous.updatedAt,
        },
        commitUrl: `https://github.com/${repository(env)}/commit/${head.object.sha}`,
      };
    if (previous && previous.revision !== baseRevision)
      throw new HttpError(
        409,
        "这篇笔记已有更新。请保留当前草稿，重新打开最新版本后比较修改。",
      );
    if (!previous && baseRevision)
      throw new HttpError(409, "原笔记已被移除，请先刷新论文库。");
    if (previous) note.createdAt = previous.createdAt;
    const incomingPaths = new Set(assets.map((a) => a.path));
    const oldAssets = new Set<string>();
    if (previous) {
      try {
        const file = await github<any>(
          env,
          `${root}/contents/data/notes/${note.id}.json?ref=${head.object.sha}`,
          user.token,
          {},
          fetcher,
        );
        const old = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(atob(file.content.replace(/\s/g, "")), (c) =>
              c.charCodeAt(0),
            ),
          ),
        );
        for (const a of old.assets ?? []) oldAssets.add(a.path);
      } catch (e) {
        if ((e as HttpError).status !== 404) throw e;
      }
    }
    if (
      note.assets.some(
        (a) => !incomingPaths.has(a.path) && !oldAssets.has(a.path),
      )
    )
      throw new HttpError(400, "部分插图缺少文件内容，请重新添加后发布。");
    note.excerpt = summarize(note).excerpt;
    const indexNote = summarize(note);
    const next = {
      version: 1,
      notes: [indexNote, ...index.notes.filter((n) => n.id !== note.id)],
    };
    const files = [
      {
        path: `data/notes/${note.id}.json`,
        content: JSON.stringify(note, null, 2),
        encoding: "utf-8",
      },
      {
        path: `papers/${note.id}.md`,
        content: toMarkdown(note),
        encoding: "utf-8",
      },
      {
        path: "data/library.json",
        content: JSON.stringify(next, null, 2),
        encoding: "utf-8",
      },
      ...assets.map((a) => ({
        path: a.path,
        content: a.base64,
        encoding: "base64",
      })),
    ];
    const treeEntries = await Promise.all(
      files.map(async (file) => {
        const blob = await github<any>(
          env,
          `${root}/git/blobs`,
          user.token,
          {
            method: "POST",
            body: JSON.stringify({
              content: file.content,
              encoding: file.encoding,
            }),
          },
          fetcher,
        );
        return { path: file.path, mode: "100644", type: "blob", sha: blob.sha };
      }),
    );
    const tree = await github<any>(
      env,
      `${root}/git/trees`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({
          base_tree: headCommit.tree.sha,
          tree: treeEntries,
        }),
      },
      fetcher,
    );
    const commit = await github<any>(
      env,
      `${root}/git/commits`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({
          message: `docs: ${previous ? "update" : "add"} ${note.title}`,
          tree: tree.sha,
          parents: [head.object.sha],
        }),
      },
      fetcher,
    );
    try {
      await github(
        env,
        `${root}/git/refs/heads/${encodeURIComponent(branch)}`,
        user.token,
        {
          method: "PATCH",
          body: JSON.stringify({ sha: commit.sha, force: false }),
        },
        fetcher,
      );
      return {
        note,
        commitUrl: `https://github.com/${repository(env)}/commit/${commit.sha}`,
      };
    } catch (e) {
      if ((e as HttpError).status !== 409 || attempt === 2) throw e;
    }
  }
  throw new HttpError(409, "仓库正在更新，请稍后重试。你的草稿仍然保留。");
}
async function readPublic(env: Env, path: string) {
  const source = new URL(
    `https://raw.githubusercontent.com/${repository(env)}/${env.GITHUB_BRANCH || "main"}/${path}`,
  );
  // A member's explicit refresh should not reuse a pre-publication CDN response.
  source.searchParams.set("v", crypto.randomUUID());
  const response = await fetch(
    source.toString(),
    { headers: { "User-Agent": "MCS-BIEP-RA" } },
  );
  if (response.status === 404 && path === "data/library.json")
    return json({ version: 1, notes: [] });
  if (!response.ok)
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      "暂时无法读取仓库内容，请稍后刷新。",
    );
  return json(await response.json());
}
export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === "/api/config")
      return json({
        title: env.SITE_TITLE || "MCS_BIEP",
        configured: configured(env),
        authConfigured: authConfigured(env),
        repository: configured(env) ? repository(env) : "",
        branch: env.GITHUB_BRANCH || "main",
      });
    if (path === "/api/session") {
      const user = await identity(request, env);
      return json(
        user
          ? {
              login: user.login,
              name: user.name,
              avatar: user.avatar,
              canWrite: user.canWrite,
            }
          : null,
      );
    }
    if (path === "/api/logout" && request.method === "POST") {
      requireOrigin(request);
      const response = json({ ok: true });
      response.headers.set(
        "Set-Cookie",
        setCookie(request, "mcs_session", "", 0),
      );
      return response;
    }
    if (path === "/api/auth/login") {
      if (!authConfigured(env))
        throw new HttpError(503, "维护者尚未配置 GitHub 登录。");
      const state = encode(crypto.getRandomValues(new Uint8Array(24)));
      const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = encode(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          ),
        ),
      );
      const target = new URL("https://github.com/login/oauth/authorize");
      target.search = new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        redirect_uri: `${url.origin}/api/auth/callback`,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.toString(),
          "Set-Cookie": setCookie(
            request,
            "mcs_oauth",
            await seal(
              { state, verifier, expires: Date.now() + 600000 },
              env.SESSION_SECRET,
            ),
            600,
          ),
          "Cache-Control": "no-store",
        },
      });
    }
    if (path === "/api/auth/callback") {
      if (!authConfigured(env))
        throw new HttpError(503, "维护者尚未配置 GitHub 登录。");
      const flow = await unseal<{
        state: string;
        verifier: string;
        expires: number;
      }>(cookie(request, "mcs_oauth"), env.SESSION_SECRET);
      if (url.searchParams.has("error"))
        throw new HttpError(401, "GitHub 授权未完成，你可以重新登录。");
      if (
        !flow ||
        flow.expires < Date.now() ||
        flow.state !== url.searchParams.get("state") ||
        !url.searchParams.get("code")
      )
        throw new HttpError(401, "登录校验已失效，请重新登录。");
      const result = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code: url.searchParams.get("code"),
            code_verifier: flow.verifier,
            redirect_uri: `${url.origin}/api/auth/callback`,
          }),
        },
      );
      const token = (await result.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!token.access_token)
        throw new HttpError(
          401,
          "GitHub 未返回有效授权，请检查应用回调地址和配置。",
        );
      const profile = await github<any>(env, "/user", token.access_token);
      let canWrite = false;
      try {
        const repo = await github<any>(
          env,
          `/repos/${repository(env)}`,
          token.access_token,
        );
        canWrite = !!(
          repo.permissions?.push ||
          repo.permissions?.admin ||
          repo.permissions?.maintain
        );
      } catch {}
      const age = Math.min(token.expires_in || 28800, 28800);
      const user: Identity = {
        login: profile.login,
        name: profile.name || profile.login,
        avatar: profile.avatar_url,
        id: profile.id,
        canWrite,
        token: token.access_token,
        expires: Date.now() + age * 1000,
      };
      const response = new Response(null, {
        status: 302,
        headers: { Location: "/", "Cache-Control": "no-store" },
      });
      response.headers.append(
        "Set-Cookie",
        setCookie(
          request,
          "mcs_session",
          await seal(user, env.SESSION_SECRET),
          age,
        ),
      );
      response.headers.append(
        "Set-Cookie",
        setCookie(request, "mcs_oauth", "", 0),
      );
      return response;
    }
    if (path === "/api/library" && request.method === "GET") {
      if (!configured(env)) return json({ notes: [] });
      return await readPublic(env, "data/library.json");
    }
    const noteMatch = path.match(/^\/api\/notes\/(note-[a-f0-9-]{36})$/);
    if (noteMatch && request.method === "GET") {
      if (!configured(env)) throw new HttpError(404, "仓库尚未配置。");
      return await readPublic(env, `data/notes/${noteMatch[1]}.json`);
    }
    if (path === "/api/publish" && request.method === "POST") {
      requireOrigin(request);
      const user = await identity(request, env);
      if (!user) throw new HttpError(401, "请先登录 GitHub，再发布笔记。");
      if (Number(request.headers.get("Content-Length") || 0) > 9 * 1024 * 1024)
        throw new HttpError(413, "发布内容过大，请减少附件。");
      const raw = await request.text();
      if (raw.length > 9 * 1024 * 1024)
        throw new HttpError(413, "发布内容过大，请减少附件。");
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "提交内容不是有效 JSON。");
      }
      return json(await commitNote(env, user, value));
    }
    if (path.startsWith("/api/")) return json({ error: "接口不存在。" }, 404);
    return env.ASSETS.fetch(request);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message =
      e instanceof HttpError
        ? e.message
        : "服务暂时不可用，草稿仍保留，请稍后重试。";
    if (path === "/api/auth/callback")
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/?auth_error=${encodeURIComponent(message)}`,
          "Set-Cookie": setCookie(request, "mcs_oauth", "", 0),
        },
      });
    return json({ error: message }, status);
  }
}
export default { fetch: handle };
