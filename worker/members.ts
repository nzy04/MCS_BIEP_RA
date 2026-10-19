import { HttpError, seal, unseal, type Env, type Identity } from "./app";
import type { QueueState } from "./reviewQueue";
import type { SiteMember, InvitationPreview } from "../shared/members";

interface Invitation {
  hash: string;
  encryptedToken: string;
  expiresAt: string;
  uses: number;
  maxUses: number;
}
export const isOwner = (env: Env, user: Pick<Identity, "login">) =>
  !!env.GITHUB_OWNER &&
  user.login.toLowerCase() === env.GITHUB_OWNER.toLowerCase();
const validToken = (token: unknown): token is string =>
  typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
const hash = async (token: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
export async function memberService<T>(
  env: Env,
  action: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  if (!env.MEMBERS) throw new HttpError(503, "成员服务尚未完成部署。");
  const response = await env.MEMBERS.get(
    env.MEMBERS.idFromName("mcs-biep-members-v1"),
  ).fetch(
    new Request("https://members.internal/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...data }),
    }),
  );
  const result = (await response.json()) as any;
  if (!response.ok)
    throw new HttpError(
      response.status,
      result.error || "成员服务暂时不可用。",
    );
  return result as T;
}
export async function siteRole(env: Env, user: Identity) {
  if (isOwner(env, user)) return { active: true, isAdmin: true };
  return memberService<{ active: boolean; isAdmin: boolean }>(env, "status", {
    user,
  });
}
export class MemberRegistry {
  constructor(
    private state: QueueState,
    private env: Env,
  ) {}
  async fetch(request: Request): Promise<Response> {
    try {
      const { action, user, token, id, active } = (await request.json()) as {
        action: string;
        user?: Identity;
        token?: unknown;
        id?: number;
        active?: boolean;
      };
      if (
        action !== "preview" &&
        (!user || !Number.isSafeInteger(user.id) || user.expires <= Date.now())
      )
        throw new HttpError(401, "请先登录 GitHub。");
      if (action === "status") {
        const member = await this.state.storage.get<SiteMember>(
          `member:${user!.id}`,
        );
        return json({
          active: isOwner(this.env, user!) || !!member?.active,
          isAdmin: isOwner(this.env, user!),
        });
      }
      if (action === "preview" || action === "join") {
        if (!validToken(token)) throw new HttpError(400, "邀请链接无效。");
        const digest = await hash(token);
        const check = async (): Promise<InvitationPreview> => {
          const invite =
            await this.state.storage.get<Invitation>("invite:active");
          if (!invite || invite.hash !== digest)
            return {
              valid: false,
              message: "邀请链接已停用，请向维护者获取新链接。",
            };
          if (Date.parse(invite.expiresAt) <= Date.now())
            return {
              valid: false,
              message: "邀请链接已到期，请向维护者获取新链接。",
            };
          if (invite.uses >= invite.maxUses)
            return {
              valid: false,
              message: "邀请名额已用完，请向维护者获取新链接。",
            };
          return { valid: true, message: "", expiresAt: invite.expiresAt };
        };
        if (action === "preview") return json(await check());
        return await this.state.blockConcurrencyWhile(async () => {
          try {
            const member = await this.state.storage.get<SiteMember>(
              `member:${user!.id}`,
            );
            if (isOwner(this.env, user!) || member?.active)
              return json({ joined: true });
            if (member && !member.active)
              throw new HttpError(
                403,
                "此账号已被移出论文库，请联系维护者恢复资格。",
              );
            const preview = await check();
            if (!preview.valid) throw new HttpError(410, preview.message);
            if (
              (await this.state.storage.list({ prefix: "member:" })).size >= 500
            )
              throw new HttpError(409, "成员数量已达500人，请联系维护者。");
            await this.state.storage.transaction(async (storage) => {
              const invite = (await storage.get<Invitation>("invite:active"))!;
              if (
                !invite ||
                invite.hash !== digest ||
                Date.parse(invite.expiresAt) <= Date.now() ||
                invite.uses >= invite.maxUses
              )
                throw new HttpError(
                  410,
                  "邀请链接已失效，请向维护者获取新链接。",
                );
              await storage.put({
                [`member:${user!.id}`]: {
                  id: user!.id,
                  login: user!.login,
                  name: user!.name,
                  joinedAt: new Date().toISOString(),
                  active: true,
                } satisfies SiteMember,
                "invite:active": { ...invite, uses: invite.uses + 1 },
              });
            });
            return json({ joined: true });
          } catch (e) {
            return json(
              {
                error:
                  e instanceof HttpError
                    ? e.message
                    : "加入暂时失败，请稍后重试。",
              },
              e instanceof HttpError ? e.status : 500,
            );
          }
        });
      }
      if (!isOwner(this.env, user!))
        throw new HttpError(403, "只有维护者可以管理成员。");
      if (action === "list") {
        const invitation =
          await this.state.storage.get<Invitation>("invite:active");
        const raw =
          invitation &&
          (await unseal<string>(
            invitation.encryptedToken,
            this.env.SESSION_SECRET,
          ));
        return json({
          members: [
            ...(
              await this.state.storage.list<SiteMember>({ prefix: "member:" })
            ).values(),
          ].sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)),
          invitation:
            invitation && raw
              ? {
                  token: raw,
                  expiresAt: invitation.expiresAt,
                  uses: invitation.uses,
                  maxUses: invitation.maxUses,
                }
              : null,
        });
      }
      if (action === "create") {
        const token = btoa(
          String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
        )
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        const invitation: Invitation = {
          hash: await hash(token),
          encryptedToken: await seal(token, this.env.SESSION_SECRET),
          expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
          uses: 0,
          maxUses: 50,
        };
        await this.state.storage.put("invite:active", invitation);
        return json({
          token,
          expiresAt: invitation.expiresAt,
          uses: 0,
          maxUses: 50,
        });
      }
      if (action === "revoke") {
        await this.state.storage.delete("invite:active");
        return json({ ok: true });
      }
      if (action === "update") {
        if (
          !Number.isSafeInteger(id) ||
          typeof active !== "boolean" ||
          id === user!.id
        )
          throw new HttpError(400, "成员修改请求不正确。");
        const member = await this.state.storage.get<SiteMember>(`member:${id}`);
        if (!member) throw new HttpError(404, "成员不存在。");
        await this.state.storage.put(`member:${id}`, { ...member, active });
        return json({ ok: true });
      }
      throw new HttpError(400, "不支持的成员操作。");
    } catch (e) {
      return json(
        { error: e instanceof HttpError ? e.message : "成员服务暂时不可用。" },
        e instanceof HttpError ? e.status : 500,
      );
    }
  }
}
