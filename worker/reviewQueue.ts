import type { Note } from "../shared/note";
import { reviewPending, type ReviewJobSummary } from "../shared/review";
import {
  assertWriteAccess,
  commitNote,
  HttpError,
  repositoryTags,
  seal,
  unseal,
  type Env,
  type Identity,
  validateIncoming,
} from "./app";
import { reviewSubmission, POLICY_VERSION, type ReviewStage } from "./review";

export interface QueueStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string | string[]): Promise<unknown>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number): Promise<void>;
  transaction<T>(fn: (storage: QueueStorage) => Promise<T>): Promise<T>;
}
export interface QueueState {
  storage: QueueStorage;
  blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
}
interface Job extends ReviewJobSummary {
  owner: number;
  payloadExpires: number;
  expires: number;
  stage?: ReviewStage;
  approved: boolean;
}
type Submission = ReturnType<typeof validateIncoming>;
interface Payload {
  user: Identity;
  value: Submission;
}
interface Usage {
  total: number;
  members: Record<string, number>;
}
interface Dependencies {
  authorize: typeof assertWriteAccess;
  tags: typeof repositoryTags;
  review: typeof reviewSubmission;
  commit: typeof commitNote;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const DAY = 86_400_000;
const limit = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 500) : fallback;
};
const summary = ({
  owner,
  payloadExpires,
  expires,
  stage,
  approved,
  ...value
}: Job): ReviewJobSummary => value;
export class ReviewQueue {
  private deps: Dependencies;
  constructor(
    private state: QueueState,
    private env: Env,
    deps?: Partial<Dependencies>,
  ) {
    this.deps = {
      authorize: assertWriteAccess,
      tags: repositoryTags,
      review: reviewSubmission,
      commit: commitNote,
      ...deps,
    };
  }
  private async jobs() {
    return [
      ...(await this.state.storage.list<Job>({ prefix: "job:" })).values(),
    ];
  }
  private async writeEncrypted(prefix: string, value: unknown) {
    const text = JSON.stringify(value),
      entries: Record<string, unknown> = {};
    const count = Math.ceil(text.length / 20_000);
    if (count > 700) throw new HttpError(413, "提交内容过大，请减少附件。");
    for (let i = 0; i < count; i++) {
      entries[`${prefix}:part:${String(i).padStart(4, "0")}`] = await seal(
        text.slice(i * 20_000, (i + 1) * 20_000),
        this.env.SESSION_SECRET,
      );
      if (Object.keys(entries).length === 32) {
        await this.state.storage.put(entries);
        for (const key of Object.keys(entries)) delete entries[key];
      }
    }
    if (Object.keys(entries).length) await this.state.storage.put(entries);
    await this.state.storage.put(`${prefix}:count`, count);
  }
  private async readEncrypted<T>(prefix: string): Promise<T | null> {
    const count = await this.state.storage.get<number>(`${prefix}:count`);
    if (!count || count > 700) return null;
    let text = "";
    for (let i = 0; i < count; i++) {
      const value = await this.state.storage.get<string>(
        `${prefix}:part:${String(i).padStart(4, "0")}`,
      );
      const part =
        value && (await unseal<string>(value, this.env.SESSION_SECRET));
      if (typeof part !== "string") return null;
      text += part;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
  private async deleteEncrypted(prefix: string) {
    const keys = [
      ...(await this.state.storage.list({ prefix: `${prefix}:` })).keys(),
    ];
    for (let i = 0; i < keys.length; i += 128)
      await this.state.storage.delete(keys.slice(i, i + 128));
  }
  private async schedule() {
    const now = Date.now(),
      jobs = await this.jobs();
    const time = jobs.some((j) => reviewPending(j.status))
      ? now + 1000
      : Math.min(
          ...jobs
            .flatMap((j) => [j.expires, j.payloadExpires])
            .filter((t) => t > now),
        );
    if (Number.isFinite(time)) {
      const alarm = await this.state.storage.getAlarm();
      if (alarm === null || alarm > time)
        await this.state.storage.setAlarm(time);
    }
  }
  private async countSubmission(user: Identity) {
    const key = `usage:${new Date().toISOString().slice(0, 10)}`;
    const usage = (await this.state.storage.get<Usage>(key)) || {
      total: 0,
      members: {},
    };
    if (
      usage.total >= limit(this.env.REVIEW_DAILY_LIMIT, 50) ||
      (usage.members[String(user.id)] || 0) >=
        limit(this.env.REVIEW_USER_DAILY_LIMIT, 10)
    )
      throw new HttpError(429, "今日审核额度已用完，请明天再提交。");
    usage.total++;
    usage.members[String(user.id)] = (usage.members[String(user.id)] || 0) + 1;
    return { key, usage };
  }
  private async enqueue(user: Identity, value: Submission) {
    const fingerprint = JSON.stringify({
      owner: user.id,
      policy: POLICY_VERSION,
      value: {
        ...value,
        note: {
          ...value.note,
          createdAt: "",
          updatedAt: "",
          revision: "",
          excerpt: "",
        },
      },
    });
    const bytes = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(fingerprint),
      ),
    );
    const id = `review-${[...bytes]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 48)}`;
    const previous = await this.state.storage.get<Job>(`job:${id}`);
    if (previous && previous.expires > Date.now()) {
      await this.schedule();
      return json(
        { job: summary(previous) },
        reviewPending(previous.status) ? 202 : 200,
      );
    }
    const jobs = await this.jobs();
    if (
      jobs.some(
        (j) =>
          j.owner === user.id &&
          j.noteId === value.note.id &&
          reviewPending(j.status),
      )
    )
      throw new HttpError(409, "这篇笔记正在审核，请等待结果后再提交修改。");
    const usage = await this.countSubmission(user),
      now = Date.now();
    const job: Job = {
      id,
      owner: user.id,
      noteId: value.note.id,
      title: value.note.title,
      status: "queued",
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      payloadExpires: now + DAY,
      expires: now + 7 * DAY,
      issues: [],
      message: "",
      approved: false,
    };
    await this.state.storage.transaction(async (storage) => {
      await storage.put({ [`job:${id}`]: job, [usage.key]: usage.usage });
      const alarm = await storage.getAlarm();
      if (alarm === null || alarm > now + 1000)
        await storage.setAlarm(now + 1000);
    });
    await this.writeEncrypted(`payload:${id}`, {
      user,
      value,
    } satisfies Payload);
    return json({ job: summary(job) }, 202);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const { action, user, id, value } = (await request.json()) as {
        action: string;
        user: Identity;
        id?: string;
        value?: Submission;
      };
      // This object is reachable only through the authenticated Worker binding.
      if (
        !user ||
        !Number.isInteger(user.id) ||
        !user.token ||
        user.expires <= Date.now()
      )
        throw new HttpError(401, "请重新登录 GitHub。");
      if (action === "list") {
        await this.schedule();
        return json({
          jobs: (await this.jobs())
            .filter((j) => j.owner === user.id && j.expires > Date.now())
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map(summary),
        });
      }
      if (action === "submit") {
        if (!user.canWrite || !this.env.DEEPSEEK_API_KEY)
          throw new HttpError(403, "审核尚未启用或没有写入权限。");
        const validated = validateIncoming(value);
        return await this.state.blockConcurrencyWhile(async () => {
          try {
            return await this.enqueue(user, validated);
          } catch (error) {
            return json(
              {
                error:
                  error instanceof HttpError
                    ? error.message
                    : "提交暂时不可用，请稍后重试。",
              },
              error instanceof HttpError ? error.status : 500,
            );
          }
        });
      }
      const job = id && (await this.state.storage.get<Job>(`job:${id}`));
      if (!job || job.owner !== user.id || job.expires <= Date.now())
        throw new HttpError(404, "审核任务不存在。");
      if (action === "detail") {
        const payload =
          job.payloadExpires > Date.now()
            ? await this.readEncrypted<Payload>(`payload:${job.id}`)
            : null;
        const candidate =
          payload && (await this.readEncrypted<Note>(`candidate:${job.id}`));
        const note = payload ? candidate || payload.value.note : null;
        if (note && payload) {
          note.revision = payload.value.baseRevision;
          note.assets = note.assets.map((asset) => {
            const upload = payload.value.assets.find(
              (a) => a.path === asset.path,
            );
            return upload
              ? {
                  ...asset,
                  dataUrl: `data:${asset.mime};base64,${upload.base64}`,
                }
              : asset;
          });
        }
        return json({ job: summary(job), note });
      }
      if (action === "retry")
        return await this.state.blockConcurrencyWhile(async () => {
          try {
            const current = await this.state.storage.get<Job>(`job:${job.id}`);
            if (!current || current.status !== "failed")
              throw new HttpError(
                409,
                "此任务无需重试；未通过的笔记请修改后重新提交。",
              );
            if (!user.canWrite || !this.env.DEEPSEEK_API_KEY)
              throw new HttpError(403, "当前账号不能提交审核。");
            const payload =
              current.payloadExpires > Date.now() &&
              (await this.readEncrypted<Payload>(`payload:${current.id}`));
            if (!payload)
              throw new HttpError(
                410,
                "服务器草稿已到期，请从本机草稿重新提交。",
              );
            const usage = await this.countSubmission(user);
            await this.writeEncrypted(`payload:${current.id}`, {
              ...payload,
              user,
            });
            current.status = current.approved ? "publishing" : "queued";
            current.message = "";
            current.updatedAt = new Date().toISOString();
            await this.state.storage.transaction(async (storage) => {
              await storage.put({
                [`job:${current.id}`]: current,
                [usage.key]: usage.usage,
              });
              const alarm = await storage.getAlarm();
              if (alarm === null || alarm > Date.now() + 1000)
                await storage.setAlarm(Date.now() + 1000);
            });
            return json({ job: summary(current) }, 202);
          } catch (error) {
            return json(
              {
                error:
                  error instanceof HttpError
                    ? error.message
                    : "重试暂时不可用。",
              },
              error instanceof HttpError ? error.status : 500,
            );
          }
        });
      throw new HttpError(400, "不支持的审核操作。");
    } catch (error) {
      return json(
        {
          error:
            error instanceof HttpError
              ? error.message
              : "审核队列暂时不可用，请稍后重试。",
        },
        error instanceof HttpError ? error.status : 500,
      );
    }
  }
  async alarm() {
    await this.cleanup();
    const job = (await this.jobs())
      .filter((j) => reviewPending(j.status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!job) {
      await this.schedule();
      return;
    }
    const persist = async () => {
      job.updatedAt = new Date().toISOString();
      await this.state.storage.put(`job:${job.id}`, job);
    };
    try {
      const payload = await this.readEncrypted<Payload>(`payload:${job.id}`);
      if (!payload)
        throw new HttpError(
          410,
          "审核草稿已到期或不可恢复，请从本机草稿重新提交。",
        );
      if (job.status === "reviewing")
        throw new HttpError(
          503,
          "审核执行曾中断，为避免重复计费未自动重试。请点击重试。",
        );
      await this.deps.authorize(this.env, payload.user);
      if (!job.approved) {
        job.status = "reviewing";
        await persist();
        const tags = await this.deps.tags(this.env, payload.user);
        const outcome = await this.deps.review(
          payload.value.note,
          this.env,
          tags,
          fetch,
          async (stage) => {
            job.stage = stage;
            await persist();
          },
        );
        job.issues = outcome.issues;
        job.receipt = outcome.receipt;
        await this.writeEncrypted(`candidate:${job.id}`, outcome.note);
        if (!outcome.approved) {
          job.status = "needs_changes";
          await persist();
          await this.schedule();
          return;
        }
        if (!outcome.receipt) throw new Error("审核凭据缺失，未发布笔记。");
        job.approved = true;
        job.status = "publishing";
        await persist();
      }
      const candidate = await this.readEncrypted<Note>(`candidate:${job.id}`);
      if (!candidate || !job.receipt)
        throw new Error("审核凭据缺失，未发布笔记。");
      const result = await this.deps.commit(
        this.env,
        payload.user,
        { ...payload.value, note: candidate },
        fetch,
        job.receipt,
      );
      job.status = "published";
      job.commitUrl = result.commitUrl;
      job.message = "";
      await persist();
      await this.deleteEncrypted(`payload:${job.id}`);
      await this.deleteEncrypted(`candidate:${job.id}`);
    } catch (error) {
      job.status = "failed";
      job.message =
        error instanceof HttpError
          ? error.message
          : error instanceof Error && /^[\u3400-\u9fff]/.test(error.message)
            ? error.message.slice(0, 300)
            : "审核服务暂时不可用，未发布笔记。请稍后重试或联系维护者。";
      await persist();
    }
    await this.schedule();
  }
  private async cleanup() {
    const now = Date.now();
    for (const job of await this.jobs()) {
      if (job.payloadExpires <= now) {
        await this.deleteEncrypted(`payload:${job.id}`);
        await this.deleteEncrypted(`candidate:${job.id}`);
        if (reviewPending(job.status)) {
          job.status = "failed";
          job.message = "审核草稿已到期，请从本机草稿重新提交。";
          job.updatedAt = new Date(now).toISOString();
          await this.state.storage.put(`job:${job.id}`, job);
        }
      }
      if (job.expires <= now) await this.state.storage.delete(`job:${job.id}`);
    }
    for (const key of (
      await this.state.storage.list({ prefix: "usage:" })
    ).keys())
      if (key.slice(6) < new Date(now - DAY).toISOString().slice(0, 10))
        await this.state.storage.delete(key);
  }
}
