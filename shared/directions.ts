export const MAX_NOTE_DIRECTIONS = 8;

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
