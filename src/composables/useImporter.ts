import { ref, shallowRef, watch, onUnmounted } from "vue";
import { createNote, structureText, type Note } from "../../shared/note";
import { parseDocument, type ParsedDocument } from "../services/importer";
import { getRecord, setRecord, removeRecord } from "../services/storage";
export function useImporter(existing?: Note | null) {
  const draft = ref<Note>(
    existing ? JSON.parse(JSON.stringify(existing)) : createNote(),
  );
  const baseRevision = shallowRef(existing?.revision ?? "");
  const step = shallowRef(existing ? 2 : 1);
  const busy = shallowRef(false);
  const error = shallowRef("");
  const warnings = ref<string[]>([]);
  const originalText = shallowRef("");
  const noteFile = shallowRef<File | null>(null);
  const paperFile = shallowRef<File | null>(null);
  const paperPreview = shallowRef("");
  const paperText = shallowRef("");
  const retainPdf = shallowRef(false);
  const draftSaved = shallowRef("");
  const recovered = shallowRef(false);
  let timer: ReturnType<typeof setTimeout>;
  let previousUrl = "";
  async function selectFile(file: File, role: "note" | "paper") {
    error.value = "";
    warnings.value = [];
    busy.value = true;
    try {
      if (role === "paper" && !file.name.toLowerCase().endsWith(".pdf"))
        throw new Error("论文原文请选择 PDF 文件。");
      const parsed: ParsedDocument = await parseDocument(file, draft.value.id);
      if (role === "note") {
        noteFile.value = file;
        originalText.value = parsed.text;
        const structured = structureText(parsed.text);
        draft.value = {
          ...draft.value,
          title: structured.title || file.name.replace(/\.[^.]+$/, ""),
          sections: structured.sections,
          assets: parsed.assets,
          sourceNames: [file.name],
        };
        warnings.value = [
          ...parsed.warnings,
          ...(structured.matched
            ? [`已匹配 ${structured.matched} 个章节；请确认归类。`]
            : ["已完整保留原始笔记，尚未识别模板章节。可在下一步自行整理。"]),
        ];
      } else {
        paperFile.value = file;
        paperText.value = parsed.text;
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
  async function addImage(file: File) {
    if (
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
        file.type,
      )
    ) {
      error.value = "请选择 PNG、JPG、WebP 或 GIF 图片。";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      error.value = "单张插图请控制在 2 MB 以内。";
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const path = `assets/uploads/${draft.value.id}/image-${crypto.randomUUID().slice(0, 8)}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
    draft.value.assets.push({
      path,
      mime: file.type,
      size: file.size,
      dataUrl,
    });
    draft.value.sections.method += `\n\n![${file.name}](${path})`;
  }
  async function preparedNote(): Promise<Note> {
    const note: Note = JSON.parse(JSON.stringify(draft.value));
    if (retainPdf.value && paperFile.value) {
      if (paperFile.value.size > 4 * 1024 * 1024)
        throw new Error(
          "初版随笔记发布的 PDF 请控制在 4 MB 内；也可以填写官方论文链接。",
        );
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(paperFile.value!);
      });
      const path = `assets/uploads/${note.id}/paper.pdf`;
      note.assets = note.assets.filter((a) => a.path !== path);
      note.assets.push({
        path,
        mime: "application/pdf",
        size: paperFile.value.size,
        dataUrl,
      });
      note.sourceNames.push(paperFile.value.name);
    }
    return note;
  }
  async function recover() {
    const saved = await getRecord<{ draft: Note; originalText: string }>(
      "draft",
    );
    if (saved) {
      draft.value = saved.draft;
      baseRevision.value = saved.draft.revision;
      originalText.value = saved.originalText;
      step.value = 2;
      recovered.value = true;
    }
  }
  async function clearDraft() {
    await removeRecord("draft");
    draftSaved.value = "";
  }
  watch(
    [draft, originalText],
    () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          await setRecord("draft", {
            draft: draft.value,
            originalText: originalText.value,
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
    baseRevision,
    step,
    busy,
    error,
    warnings,
    originalText,
    noteFile,
    paperFile,
    paperPreview,
    paperText,
    retainPdf,
    draftSaved,
    recovered,
    selectFile,
    addImage,
    preparedNote,
    recover,
    clearDraft,
  };
}
