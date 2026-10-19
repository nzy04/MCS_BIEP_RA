import type { SiteConfig, Session, Note, NoteSummary } from "../../shared/note";
import type { ReviewJobSummary } from "../../shared/review";
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
  });
  const body = await response
    .json()
    .catch(() => ({ error: "服务暂时不可用，请稍后重试。" }));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.error || `请求失败 (${response.status})`,
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
export async function loadNote(id: string, connected: boolean): Promise<Note> {
  return api(
    connected
      ? `/api/notes/${encodeURIComponent(id)}`
      : `/data/notes/${encodeURIComponent(id)}.json`,
  );
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
export const reviewDetail = (id: string) =>
  api<{ job: ReviewJobSummary; note: Note | null }>(
    `/api/reviews/${encodeURIComponent(id)}`,
  );
export const retryReview = (id: string) =>
  api<{ job: ReviewJobSummary }>(
    `/api/reviews/${encodeURIComponent(id)}/retry`,
    { method: "POST" },
  );
