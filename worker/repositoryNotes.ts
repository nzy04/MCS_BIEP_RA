import type { Note, NoteSummary } from "../shared/note";
import { github, HttpError, type Env, type Identity } from "./app";
import { readRepositoryJson } from "./profile";

/** Read and validate whole notes against one immutable index, batching large folders. */
export async function readIndexedNotes(
  env: Env,
  user: Identity,
  summaries: NoteSummary[],
  ref: string,
  fetcher: typeof fetch,
): Promise<Note[]> {
  const notes: Note[] = [];
  const accept = (note: Note | null, summary: NoteSummary) => {
    if (
      !note ||
      note.id !== summary.id ||
      note.revision !== summary.revision ||
      JSON.stringify(note.tags) !== JSON.stringify(summary.tags)
    )
      throw new HttpError(
        409,
        "笔记内容与目录不一致，本次修改未保存，请刷新后重试。",
      );
    notes.push(note);
  };
  if (summaries.length <= 20) {
    const values = await Promise.all(
      summaries.map((n) =>
        readRepositoryJson<Note | null>(
          env,
          user,
          `data/notes/${n.id}.json`,
          ref,
          null,
          fetcher,
        ),
      ),
    );
    values.forEach((note, i) => accept(note, summaries[i]));
  } else {
    for (let offset = 0; offset < summaries.length; offset += 25) {
      const batch = summaries.slice(offset, offset + 25);
      const fields = batch
        .map(
          (n, i) =>
            `n${i}: object(expression: ${JSON.stringify(`${ref}:data/notes/${n.id}.json`)}) { ... on Blob { text } }`,
        )
        .join("\n");
      const query = `{ repository(owner: ${JSON.stringify(env.GITHUB_OWNER)}, name: ${JSON.stringify(env.GITHUB_REPO)}) { ${fields} } }`;
      const result = await github<{
        data?: { repository?: Record<string, { text?: string }> };
        errors?: unknown[];
      }>(
        env,
        "/graphql",
        user.token,
        { method: "POST", body: JSON.stringify({ query }) },
        fetcher,
      );
      if (result.errors?.length || !result.data?.repository)
        throw new HttpError(
          409,
          "笔记批量读取失败，本次修改未保存，请稍后重试。",
        );
      batch.forEach((summary, i) => {
        const text = result.data!.repository![`n${i}`]?.text;
        if (!text) accept(null, summary);
        else {
          let note: Note;
          try {
            note = JSON.parse(text);
          } catch {
            throw new HttpError(409, "笔记数据无法解析，本次修改未保存。");
          }
          accept(note, summary);
        }
      });
    }
  }
  return notes;
}
