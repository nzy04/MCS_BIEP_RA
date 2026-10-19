import { ref, shallowRef, watch, onUnmounted } from "vue";
import {
  createNote,
  structureText,
  type Note,
  type NoteAsset,
} from "../../shared/note";
import { importBody, noteBody } from "../../shared/document";
import {
  bindMarkdownImages,
  makeImageAsset,
  imageSources,
} from "../services/noteMedia";
import { unpackNotePackage } from "../services/notePackage";
import { parseDocument, type ParsedDocument } from "../services/importer";
import { getRecord, setRecord, removeRecord } from "../services/storage";
import type { ReviewIssue } from "../../shared/review";
export function useImporter(
  existing?: Note | null,
  initialIssues: ReviewIssue[] = [],
) {
  const reviewIssues = ref<ReviewIssue[]>(initialIssues);
  const draft = ref<Note>(
    existing ? JSON.parse(JSON.stringify(existing)) : createNote(),
  );
  const baseRevision = shallowRef(existing?.revision ?? "");
  const step = shallowRef(existing?.title ? 2 : 1);
  const busy = shallowRef(false);
  const error = shallowRef("");
  const warnings = ref<string[]>([]);
  const originalText = shallowRef("");
  const noteFile = shallowRef<File | null>(null);
  const paperFile = shallowRef<File | null>(null);
  const paperPreview = shallowRef("");
  const draftSaved = shallowRef("");
  const recovered = shallowRef(false);
  let timer: ReturnType<typeof setTimeout>;
  let previousUrl = "";
  async function selectFile(
    file: File,
    role: "note" | "paper",
    companionImages: File[] = [],
  ) {
    error.value = "";
    warnings.value = [];
    busy.value = true;
    try {
      if (role === "paper" && !file.name.toLowerCase().endsWith(".pdf"))
        throw new Error("论文原文请选择 PDF 文件。");
      const parsed: ParsedDocument = await parseDocument(
        file,
        draft.value.id,
        role === "note",
      );
      if (role === "note") {
        noteFile.value = file;
        originalText.value = parsed.text;
        const bound = await bindMarkdownImages(
          parsed.text,
          companionImages,
          draft.value.id,
        );
        const document = importBody(bound.text);
        const structured = structureText(document.body);
        draft.value = {
          ...draft.value,
          title: document.title || file.name.replace(/\.[^.]+$/, ""),
          body: document.body,
          sections: structured.sections,
          assets: [...parsed.assets, ...bound.assets],
          sourceNames: [file.name, ...companionImages.map((f) => f.name)].slice(
            0,
            10,
          ),
        };
        warnings.value = [
          ...parsed.warnings,
          ...bound.warnings.filter(
            (w) => !parsed.assets.some((a) => w.includes(a.path)),
          ),
        ];
      } else {
        paperFile.value = file;
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        previousUrl = URL.createObjectURL(file);
        paperPreview.value = previousUrl;
        warnings.value = [
          "论文原文已读取。它不会自动替代你的阅读笔记。",
          ...parsed.warnings,
        ];
      }
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      busy.value = false;
    }
  }
  async function selectFiles(files: File[]) {
    try {
      if (files.length === 1 && /\.zip$/i.test(files[0].name))
        files = await unpackNotePackage(files[0]);
      const documents = files.filter(
        (f) => !/\.(png|jpe?g|webp|gif)$/i.test(f.name),
      );
      const notes = documents.filter((f) => !/\.pdf$/i.test(f.name));
      const pdfs = documents.filter((f) => /\.pdf$/i.test(f.name));
      const primary =
        notes.length === 1
          ? notes[0]
          : documents.length === 1
            ? documents[0]
            : null;
      if (!primary || notes.length > 1 || pdfs.length > 1)
        throw new Error("每次选择一份笔记及其图片，可额外带一份论文 PDF。");
      await selectFile(
        primary,
        "note",
        files.filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name)),
      );
      const notices = [...warnings.value];
      if (notes.length === 1 && pdfs.length === 1 && !error.value) {
        await selectFile(pdfs[0], "paper");
        warnings.value = [...notices, ...warnings.value];
      }
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  async function addImage(file: File): Promise<NoteAsset | null> {
    error.value = "";
    try {
      const asset = await makeImageAsset(file, draft.value.id);
      if (!draft.value.assets.some((a) => a.path === asset.path)) {
        if (draft.value.assets.length >= 25)
          throw new Error("最多附带 25 个文件。");
        draft.value.assets.push(asset);
      }
      return draft.value.assets.find((a) => a.path === asset.path)!;
    } catch (e) {
      error.value = (e as Error).message;
      return null;
    }
  }
  function removeAsset(path: string) {
    draft.value.assets = draft.value.assets.filter((a) => a.path !== path);
  }
  async function preparedNote(): Promise<Note> {
    const note: Note = JSON.parse(JSON.stringify(draft.value));
    const bound = await bindMarkdownImages(noteBody(note), [], note.id);
    if (bound.assets.length) {
      note.body = bound.text;
      note.assets.push(
        ...bound.assets.filter(
          (a) => !note.assets.some((b) => b.path === a.path),
        ),
      );
    }
    const sources = imageSources(noteBody(note));
    const missing = sources.filter(
      (s) =>
        !/^(https?:|data:)/i.test(s) && !note.assets.some((a) => a.path === s),
    );
    if (missing.length)
      throw new Error(
        `图片尚未绑定：${missing.join("、")}。请补充图片或删除失效引用。`,
      );
    note.assets = note.assets.filter(
      (a) => a.mime.startsWith("image/") && sources.includes(a.path),
    );
    note.sections = structureText(noteBody(note)).sections;
    if (note.assets.length > 25) throw new Error("最多附带 25 个文件。");
    if (
      note.assets.some(
        (a) => a.mime.startsWith("image/") && a.size > 2 * 1024 * 1024,
      )
    )
      throw new Error("单张插图请控制在 2 MB 以内。");
    if (note.assets.reduce((sum, a) => sum + a.size, 0) > 6 * 1024 * 1024)
      throw new Error("一次发布的附件总量请控制在 6 MB 内。");
    return note;
  }
  async function recover() {
    const saved = await getRecord<{
      draft: Note;
      originalText: string;
      issues?: ReviewIssue[];
    }>("draft");
    if (saved) {
      draft.value = saved.draft;
      baseRevision.value = saved.draft.revision;
      originalText.value = saved.originalText;
      reviewIssues.value = saved.issues || [];
      step.value = 2;
      recovered.value = true;
    }
  }
  async function clearDraft() {
    await removeRecord("draft");
    draftSaved.value = "";
  }
  watch(
    [draft, originalText, reviewIssues],
    () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await setRecord("draft", {
            draft: draft.value,
            originalText: originalText.value,
            issues: reviewIssues.value,
          });
          draftSaved.value = "草稿已保存在本机";
        } catch {
          draftSaved.value = "草稿保存失败，请及时导出";
        }
      }, 700);
    },
    { deep: true },
  );
  onUnmounted(() => {
    clearTimeout(timer);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
  });
  return {
    draft,
    reviewIssues,
    baseRevision,
    step,
    busy,
    error,
    warnings,
    originalText,
    noteFile,
    paperFile,
    paperPreview,
    draftSaved,
    recovered,
    selectFile,
    selectFiles,
    addImage,
    removeAsset,
    preparedNote,
    recover,
    clearDraft,
  };
}
