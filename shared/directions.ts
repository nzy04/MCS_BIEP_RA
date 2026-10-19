export const MAX_NOTE_DIRECTIONS = 8;

export interface MoveNotesRequest {
  notes: { id: string; revision: string }[];
  source: string | null;
  target: string;
}

/** One safe path segment; canonical case keeps folder names stable across aliases. */
export function directionFolder(name: string): string {
  return `papers/方向-${directionKey(directionName(name)).replace(/[%/\\:*?"<>|.]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)}`;
}

export function noteFolders(tags: string[]): string[] {
  const names = mergeDirections(tags);
  return names.length ? names.map(directionFolder) : ["papers/_未分类"];
}

export function movedDirections(
  tags: string[],
  source: string | null,
  target: string,
): string[] {
  const next = mergeDirections(
    source === null
      ? []
      : tags.filter((t) => directionKey(t) !== directionKey(source)),
    [target],
  );
  if (next.length > MAX_NOTE_DIRECTIONS)
    throw new Error(`每份笔记最多选择 ${MAX_NOTE_DIRECTIONS} 个研究方向。`);
  return next;
}

export function directionKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function directionName(value: unknown): string {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}<>]/u.test(value))
    throw new Error("研究方向名称不能包含换行、控制字符或尖括号。");
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name || name.length > 50)
    throw new Error("研究方向名称请填写 1–50 个字。");
  return name;
}

/** Merge persisted folders, legacy note tags and newly classified directions. */
export function mergeDirections(...sources: string[][]): string[] {
  const names = new Map<string, string>();
  for (const value of sources.flat()) {
    try {
      const name = directionName(value),
        key = directionKey(name);
      if (!names.has(key)) names.set(key, name);
    } catch {
      /* Invalid legacy labels are not offered as folder names. */
    }
  }
  return [...names.values()];
}
