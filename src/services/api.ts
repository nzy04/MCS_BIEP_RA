import type { SiteConfig, Session, Note, NoteSummary } from "../../shared/note";
import type { ReviewJobSummary } from "../../shared/review";
import type {
  MembersData,
  SiteInvitation,
  InvitationPreview,
} from "../../shared/members";
export const members = () => api<MembersData>("/api/members");
export const createInvitation = () =>
  api<SiteInvitation>("/api/members/invitation", { method: "POST" });
export const revokeInvitation = () =>
  api("/api/members/invitation", { method: "DELETE" });
export const changeMember = (id: number, active: boolean) =>
  api(`/api/members/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
export const previewInvitation = (token: string) =>
  api<InvitationPreview>("/api/invitations/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
export const joinInvitation = (token: string) =>
  api<{ user: Session }>("/api/invitations/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
export const invitationLogin = (token: string) =>
  api<{ url: string }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnTo: `/#join/${token}` }),
  });
import type {
  MoveNotesRequest,
  DirectionChange,
} from "../../shared/directions";
export function moveNotes(
  input: MoveNotesRequest,
): Promise<{ notes: NoteSummary[]; commitUrl: string }> {
  return api("/api/notes/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    signal:
      options?.signal ||
      AbortSignal.timeout(
        options?.method && options.method !== "GET" ? 60_000 : 20_000,
      ),
  }).catch(() => {
    throw new ApiError(
      503,
      "连接中断，请刷新核对保存结果后重试。正在编辑的草稿仍保留。",
    );
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      response.ok ? 502 : response.status,
      "服务返回了无效数据，请稍后重试。",
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      (typeof body?.error === "string" && body.error) ||
        `请求失败 (${response.status})`,
    );
  return body;
}
export async function config(): Promise<SiteConfig> {
  try {
    return await api("/api/config");
  } catch {
    return {
      title: "MCS_BIEP",
      configured: false,
      authConfigured: false,
      repository: "",
      branch: "main",
    };
  }
}
export async function session(): Promise<Session | null> {
  try {
    return await api("/api/session");
  } catch {
    return null;
  }
}
export function updateProfile(
  nickname: string,
): Promise<{ user: Session; notes: NoteSummary[] }> {
  return api("/api/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname }),
  });
}
export async function library(connected: boolean): Promise<NoteSummary[]> {
  const data = await api<{ notes: NoteSummary[] }>(
    connected ? "/api/library" : "/data/library.json",
  );
  return data.notes;
}
export async function directions(): Promise<string[]> {
  return (await api<{ directions: string[] }>("/api/directions")).directions;
}
export function createDirection(
  name: string,
): Promise<{ name: string; directions: string[] }> {
  return api("/api/directions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}
export function changeDirection(change: DirectionChange): Promise<{
  name: string | null;
  directions: string[];
  notes: NoteSummary[];
  commitUrl: string;
}> {
  return api("/api/directions", {
    method: change.replacement === null ? "DELETE" : "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
}
export async function loadNote(id: string, connected: boolean): Promise<Note> {
  return api(
    connected
      ? `/api/notes/${encodeURIComponent(id)}`
      : `/data/notes/${encodeURIComponent(id)}.json`,
  );
}
export function deleteNote(
  note: Pick<NoteSummary, "id" | "revision">,
): Promise<{ notes: NoteSummary[]; commitUrl: string }> {
  return api(`/api/notes/${encodeURIComponent(note.id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: note.revision }),
  });
}
export async function publishNote(
  note: Note,
  baseRevision: string,
): Promise<{ job: ReviewJobSummary }> {
  const assets = note.assets
    .filter((a) => a.dataUrl)
    .map((a) => ({
      path: a.path,
      mime: a.mime,
      base64: a.dataUrl!.split(",")[1],
    }));
  const cleanNote: Note = {
    ...note,
    assets: note.assets.map(({ dataUrl, ...asset }) => asset),
  };
  return api("/api/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: cleanNote, assets, baseRevision }),
  });
}
export async function reviewJobs(): Promise<ReviewJobSummary[]> {
  return (await api<{ jobs: ReviewJobSummary[] }>("/api/reviews")).jobs;
}
export const deleteReview = (id: string) =>
  api<{ deleted: true }>(`/api/reviews/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
export const reviewDetail = (id: string) =>
  api<{ job: ReviewJobSummary; note: Note | null }>(
    `/api/reviews/${encodeURIComponent(id)}`,
  );
export const retryReview = (id: string) =>
  api<{ job: ReviewJobSummary }>(
    `/api/reviews/${encodeURIComponent(id)}/retry`,
    { method: "POST" },
  );
