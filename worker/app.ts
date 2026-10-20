import {
  sectionDefinitions,
  structureText,
  summarize,
  validateNote,
  type Note,
  type NoteSummary,
  type Session,
  type UploadAsset,
} from "../shared/note";
import type { ReviewQueueNamespace, ReviewReceipt } from "../shared/review";
import { ownsNote } from "../shared/papers";
import { profileSession, updateProfile, readRepositoryJson } from "./profile";
import {
  createDirection,
  changeDirection,
  repositoryDirections,
} from "./directions";
import { layoutEntries } from "./layout";
import { moveNotes } from "./move";
import { deleteNote } from "./deleteNote";
import {
  directionName,
  directionKey,
  mergeDirections,
  type DirectionCatalog,
} from "../shared/directions";
import { checkDeepseek } from "./review";
export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  SITE_TITLE: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_MODEL?: string;
  REVIEW_QUEUE?: ReviewQueueNamespace;
}
export interface Identity extends Session {
  token: string;
  id: number;
  expires: number;
}
export class HttpError extends Error {
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
const encode = (data: Uint8Array) => {
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += 8192)
    chunks.push(String.fromCharCode(...data.subarray(i, i + 8192)));
  return btoa(chunks.join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};
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
export async function github<T = any>(
  _env: Env,
  path: string,
  token: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(`https://api.github.com${path}`, {
      ...init,
      signal: init.signal || AbortSignal.timeout(20_000),
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "MCS-BIEP-RA",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new HttpError(
      504,
      "GitHub 响应超时或连接失败。请刷新核对是否已保存，再重试。",
    );
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ message: "" }))) as {
      message?: string;
    };
    throw new HttpError(
      response.status === 401
        ? 401
        : response.status === 429 ||
            (response.status === 403 &&
              response.headers.get("x-ratelimit-remaining") === "0")
          ? 429
          : response.status === 403
            ? 403
            : response.status === 404
              ? 404
              : response.status === 422 || response.status === 409
                ? 409
                : 502,
      response.status === 401
        ? "GitHub 登录已失效，请重新登录。"
        : response.status === 429 ||
            (response.status === 403 &&
              response.headers.get("x-ratelimit-remaining") === "0")
          ? "GitHub 请求额度暂时用完，请稍后重试。草稿仍保留。"
          : response.status === 403
            ? "当前账号或应用没有仓库写入权限。"
            : `GitHub 请求失败：${error.message || response.status}`,
    );
  }
  return response.json() as Promise<T>;
}
export function validateIncoming(value: any): {
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
    input.body !== undefined &&
    (typeof input.body !== "string" || input.body.length > 150000)
  )
    throw new HttpError(400, "笔记正文过长或格式不正确。");
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
  };
  const metadata = input.assets.map((a: any) => {
    if (a?.mime === "application/pdf" || /\.pdf$/i.test(a?.path || ""))
      throw new HttpError(400, "论文库只保存 PDF 下载链接，不接收 PDF 附件。");
    if (
      !a ||
      typeof a.path !== "string" ||
      !a.path.startsWith(prefix) ||
      !/^[-a-zA-Z0-9.]+$/.test(a.path.slice(prefix.length)) ||
      !allowed[a.mime]?.test(a.path) ||
      !Number.isSafeInteger(a.size) ||
      a.size < 0 ||
      a.size > 2 * 1024 * 1024
    )
      throw new HttpError(400, "附件路径、格式或大小不合法。");
    return {
      path: a.path,
      mime: a.mime,
      size: a.size,
      ...(typeof a.name === "string" ? { name: a.name.slice(0, 250) } : {}),
    };
  });
  if (new Set(metadata.map((a: any) => a.path)).size !== metadata.length)
    throw new HttpError(400, "附件路径不能重复。");
  if (
    metadata.reduce((sum: number, a: any) => sum + a.size, 0) >
    6 * 1024 * 1024
  )
    throw new HttpError(413, "附件总量请控制在 6 MB 内。");
  const assets = value.assets ?? [];
  if (!Array.isArray(assets) || assets.length > 25)
    throw new HttpError(400, "附件列表不合法。");
  if (
    assets.some((a: any) => !a || typeof a.path !== "string") ||
    new Set(assets.map((a: any) => a.path)).size !== assets.length
  )
    throw new HttpError(400, "附件列表不合法或路径重复。");
  let bytes = 0;
  for (const a of assets) {
    const m = metadata.find((m: any) => m.path === a.path);
    if (
      !m ||
      m.mime !== a.mime ||
      typeof a.base64 !== "string" ||
      a.base64.length % 4 !== 0 ||
      a.base64.length > 6 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64)
    )
      throw new HttpError(400, "附件编码不合法。");
    const decodedSize =
      (a.base64.length * 3) / 4 -
      (a.base64.endsWith("==") ? 2 : a.base64.endsWith("=") ? 1 : 0);
    if (decodedSize !== m.size)
      throw new HttpError(400, "附件实际大小与声明不一致，请重新添加。");
    bytes += a.base64.length * 0.75;
    if (bytes > 6 * 1024 * 1024)
      throw new HttpError(413, "一次发布的附件总量请控制在 6 MB 内。");
    const header = atob(a.base64.slice(0, 40));
    if (
      (a.mime === "image/png" && !header.startsWith("\x89PNG\r\n\x1a\n")) ||
      (a.mime === "image/jpeg" && !header.startsWith("\xff\xd8\xff")) ||
      (a.mime === "image/gif" && !header.startsWith("GIF8")) ||
      (a.mime === "image/webp" &&
        !(header.startsWith("RIFF") && header.slice(8, 12) === "WEBP"))
    )
      throw new HttpError(400, "附件内容与文件类型不匹配。");
  }
  const now = new Date().toISOString();
  let tags: string[];
  try {
    tags = mergeDirections(input.tags.map(directionName));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const note: Note = {
    id: input.id,
    title: text("title", 250),
    subtitle: text("subtitle", 500),
    year: text("year", 4),
    venue: text("venue", 80),
    paperUrl: text("paperUrl", 1500),
    pdfUrl: input.pdfUrl === undefined ? "" : text("pdfUrl", 1500),
    codeUrl: text("codeUrl", 1500),
    author: text("author", 100),
    authorLogin: "",
    tags,
    readingDepth: text("readingDepth", 30),
    createdAt: now,
    updatedAt: now,
    revision: "",
    excerpt: "",
    sections:
      typeof input.body === "string"
        ? structureText(input.body).sections
        : sections,
    ...(typeof input.body === "string" ? { body: input.body } : {}),
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
  receipt?: ReviewReceipt,
): Promise<{ note: Note; commitUrl: string }> {
  const { note, assets, baseRevision } = validateIncoming(value);
  const root = `/repos/${repository(env)}`;
  const branch = env.GITHUB_BRANCH || "main";
  await assertWriteAccess(env, user, fetcher);
  note.authorLogin = user.login;
  note.authorId = user.id;
  if (receipt) note.review = receipt;
  const fingerprint = {
    ...note,
    author: "",
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
    const index = await readRepositoryJson<{ notes: NoteSummary[] }>(
      env,
      user,
      "data/library.json",
      head.object.sha,
      { notes: [] },
      fetcher,
    );
    const previous = index.notes.find((n) => n.id === note.id);
    if (previous && !ownsNote(previous, user))
      throw new HttpError(
        403,
        "只能修改自己上传的笔记。请为这篇论文新增自己的笔记。",
      );
    const profile = await profileSession(env, user, head.object.sha, fetcher);
    note.author = profile.name;
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
    const catalog = await readRepositoryJson<DirectionCatalog>(
      env,
      user,
      "data/directions.json",
      head.object.sha,
      { directions: [] },
      fetcher,
    );
    if (
      note.tags.some((tag) =>
        (catalog.retired || []).some(
          (n) => directionKey(n) === directionKey(tag),
        ),
      )
    )
      throw new HttpError(
        409,
        "研究方向已重命名或删除，请刷新方向并重新选择后提交。",
      );
    if (previous) note.createdAt = previous.createdAt;
    const incomingPaths = new Set(assets.map((a) => a.path));
    const oldAssets = new Set<string>();
    if (previous) {
      try {
        const old = await readRepositoryJson<Note | null>(
          env,
          user,
          `data/notes/${note.id}.json`,
          head.object.sha,
          null,
          fetcher,
        );
        if (!old)
          throw new HttpError(
            409,
            "原笔记内容缺失，本次修改未保存，请联系维护者。",
          );
        if (note.review && old.review) {
          const inherited = old.review.supplements.filter(
            (s) =>
              s.value === note[s.field] &&
              !note.review!.supplements.some((n) => n.field === s.field),
          );
          note.review = {
            ...note.review,
            supplements: [...note.review.supplements, ...inherited],
            sources: [
              ...note.review.sources,
              ...old.review.sources.filter(
                (s) =>
                  inherited.some((i) => i.sourceUrl === s.url) &&
                  !note.review!.sources.some((n) => n.url === s.url),
              ),
            ],
          };
        }
        for (const a of old.assets ?? []) {
          if (
            typeof a.path === "string" &&
            a.path.startsWith(`assets/uploads/${note.id}/`) &&
            /^[-a-zA-Z0-9.]+$/.test(
              a.path.slice(`assets/uploads/${note.id}/`.length),
            )
          )
            oldAssets.add(a.path);
        }
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
    const categorized = await layoutEntries(
      env,
      user,
      head.object.sha,
      headCommit.tree.sha,
      index.notes,
      next.notes,
      [note],
      fetcher,
    );
    const tree = await github<any>(
      env,
      `${root}/git/trees`,
      user.token,
      {
        method: "POST",
        body: JSON.stringify({
          base_tree: headCommit.tree.sha,
          tree: [
            ...treeEntries,
            ...categorized,
            ...[...oldAssets]
              .filter((path) => !note.assets.some((a) => a.path === path))
              .map((path) => ({
                path,
                mode: "100644",
                type: "blob",
                sha: null,
              })),
          ],
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
  const response = await fetch(source.toString(), {
    headers: { "User-Agent": "MCS-BIEP-RA" },
    signal: AbortSignal.timeout(15_000),
  });
  if (
    response.status === 404 &&
    ["data/library.json", "data/directions.json"].includes(path)
  )
    return json({ version: 1, notes: [], directions: [] });
  if (!response.ok)
    throw new HttpError(
      response.status === 404 ? 404 : 502,
      "暂时无法读取仓库内容，请稍后刷新。",
    );
  return json(await response.json());
}
export async function assertWriteAccess(
  env: Env,
  user: Identity,
  fetcher: typeof fetch = fetch,
) {
  if (user.expires <= Date.now())
    throw new HttpError(401, "GitHub 登录已失效，请重新登录后重试。");
  const permissions = await github<any>(
    env,
    `/repos/${repository(env)}`,
    user.token,
    {},
    fetcher,
  );
  if (
    !permissions.permissions?.push &&
    !permissions.permissions?.admin &&
    !permissions.permissions?.maintain
  )
    throw new HttpError(403, "你还没有此仓库的写入权限，请联系课题组维护者。");
}
export async function repositoryTags(
  env: Env,
  user: Identity,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  return repositoryDirections(env, user, fetcher);
}
function reviewService(env: Env) {
  if (!env.REVIEW_QUEUE)
    throw new HttpError(503, "后台审核尚未完成部署，请联系维护者。");
  return env.REVIEW_QUEUE.get(
    env.REVIEW_QUEUE.idFromName("mcs-biep-reviews-v1"),
  );
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
        reviewConfigured: !!env.REVIEW_QUEUE,
        repository: configured(env) ? repository(env) : "",
        branch: env.GITHUB_BRANCH || "main",
      });
    if (path === "/api/session") {
      const user = await identity(request, env);
      return json(user ? await profileSession(env, user) : null);
    }
    if (path === "/api/profile" && request.method === "PUT") {
      requireOrigin(request);
      const user = await identity(request, env);
      if (!user) throw new HttpError(401, "请先登录 GitHub，再设置昵称。");
      const raw = await request.text();
      if (raw.length > 1024) throw new HttpError(413, "昵称请求过长。");
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "昵称格式不正确。");
      }
      return json(await updateProfile(env, user, value?.nickname));
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
          signal: AbortSignal.timeout(20_000),
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
        githubName: profile.name || profile.login,
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
    if (path === "/api/directions" && request.method === "GET") {
      if (!configured(env)) return json({ directions: [] });
      const [catalog, index] = await Promise.all([
        readPublic(env, "data/directions.json").then((r) =>
          r.json(),
        ) as Promise<{ directions?: string[] }>,
        readPublic(env, "data/library.json").then((r) => r.json()) as Promise<{
          notes: NoteSummary[];
        }>,
      ]);
      return json({
        directions: mergeDirections(
          catalog.directions || [],
          index.notes.flatMap((n) => n.tags || []),
        ),
      });
    }
    if (path === "/api/directions" && request.method === "POST") {
      requireOrigin(request);
      const user = await identity(request, env);
      if (!user) throw new HttpError(401, "请先登录 GitHub，再新建研究方向。");
      const raw = await request.text();
      if (raw.length > 1024) throw new HttpError(413, "研究方向名称过长。");
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "研究方向格式不正确。");
      }
      return json(await createDirection(env, user, value?.name));
    }
    if (
      path === "/api/directions" &&
      ["PATCH", "DELETE"].includes(request.method)
    ) {
      requireOrigin(request);
      const user = await identity(request, env);
      if (!user) throw new HttpError(401, "请先登录 GitHub，再管理研究方向。");
      const raw = await request.text();
      if (raw.length > 1024) throw new HttpError(413, "研究方向名称过长。");
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "研究方向格式不正确。");
      }
      return json(
        await changeDirection(env, user, {
          name: value?.name,
          replacement: request.method === "DELETE" ? null : value?.replacement,
        }),
      );
    }
    if (path === "/api/notes/move" && request.method === "POST") {
      requireOrigin(request);
      const user = await identity(request, env);
      if (!user) throw new HttpError(401, "请先登录 GitHub，再移动笔记。");
      const raw = await request.text();
      if (raw.length > 12000)
        throw new HttpError(413, "每次最多移动 30 份笔记。");
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "移动请求格式不正确。");
      }
      return json(await moveNotes(env, user, value));
    }
    const noteMatch = path.match(/^\/api\/notes\/(note-[a-f0-9-]{36})$/);
    if (noteMatch && request.method === "DELETE") {
      requireOrigin(request);
      const user = await identity(request, env);
      if (!user) throw new HttpError(401, "请先登录 GitHub。");
      const raw = await request.text();
      if (raw.length > 1024) throw new HttpError(413, "删除请求过长。");
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "删除请求格式不正确。");
      }
      return json(await deleteNote(env, user, noteMatch[1], value?.revision));
    }
    if (noteMatch && request.method === "GET") {
      if (!configured(env)) throw new HttpError(404, "仓库尚未配置。");
      return await readPublic(env, `data/notes/${noteMatch[1]}.json`);
    }
    if (path === "/api/reviews/connection" && request.method === "GET") {
      const user = await identity(request, env);
      if (!user) throw new HttpError(401, "请先登录 GitHub。");
      if (user.login.toLowerCase() !== env.GITHUB_OWNER.toLowerCase())
        throw new HttpError(403, "仅仓库维护者可检查共享密钥连接。");
      await assertWriteAccess(env, user);
      try {
        return json(await checkDeepseek(env));
      } catch (error) {
        throw new HttpError(
          503,
          error instanceof Error && /^[\u3400-\u9fff]/.test(error.message)
            ? error.message
            : "DeepSeek 连通性检查失败，请稍后重试。",
        );
      }
    }
    const reviewMatch = path.match(
      /^\/api\/reviews\/(review-[a-f0-9]{48})(\/retry)?$/,
    );
    if (
      (path === "/api/reviews" || reviewMatch) &&
      ["GET", "POST", "DELETE"].includes(request.method)
    ) {
      const user = await identity(request, env);
      if (!user)
        throw new HttpError(401, "请先登录 GitHub，查看自己的审核任务。");
      if (request.method === "POST") {
        requireOrigin(request);
        if (!reviewMatch?.[2]) throw new HttpError(405, "请求方式不支持。");
        await assertWriteAccess(env, user);
      } else if (request.method === "DELETE") {
        requireOrigin(request);
        if (!reviewMatch || reviewMatch[2])
          throw new HttpError(405, "请求方式不支持。");
      } else if (reviewMatch?.[2]) throw new HttpError(405, "请求方式不支持。");
      return await reviewService(env).fetch(
        new Request(`https://review.internal${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action:
              request.method === "DELETE"
                ? "delete"
                : request.method === "POST"
                  ? "retry"
                  : reviewMatch
                    ? "detail"
                    : "list",
            id: reviewMatch?.[1],
            user,
          }),
        }),
      );
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
      const validated = validateIncoming(value);
      await assertWriteAccess(env, user);
      return await reviewService(env).fetch(
        new Request("https://review.internal/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "submit", user, value: validated }),
        }),
      );
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
