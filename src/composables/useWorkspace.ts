import { ref, shallowRef, onMounted, onUnmounted, computed } from "vue";
import type { Note, NoteSummary, Session, SiteConfig } from "../../shared/note";
import { summarize, createNote } from "../../shared/note";
import { groupPapers, ownsNote } from "../../shared/papers";
import type { PaperRecord, PaperSummary } from "../../shared/catalog";
import { reviewPending } from "../../shared/review";
import { useReviewJobs } from "./useReviewJobs";
import { useDirections } from "./useDirections";
import * as api from "../services/api";
import {
  localNotes,
  saveLocalNote,
  removeLocalNote,
  getRecord,
  setRecord,
} from "../services/storage";
export function useWorkspace() {
  const configuration = ref<SiteConfig>({
    title: "MCS_BIEP",
    configured: false,
    authConfigured: false,
    repository: "",
    branch: "main",
  });
  const user = ref<Session | null>(null);
  const reviews = useReviewJobs(
    user,
    () => {
      user.value = null;
    },
    async (completed) => {
      for (const job of completed) await removeLocalNote(job.noteId);
      await refresh();
    },
  );
  const pendingReviews = computed(
    () => reviews.jobs.value.filter((j) => reviewPending(j.status)).length,
  );
  const notes = ref<NoteSummary[]>([]);
  const catalog = ref<PaperSummary[]>([]);
  const selectedCatalog = ref<PaperRecord | null>(null);
  const catalogNotes = computed(() =>
    selectedCatalog.value
      ? groupPapers(notes.value, catalog.value).find(
          (p) => p.record?.id === selectedCatalog.value!.id,
        )?.notes || []
      : [],
  );
  const directions = useDirections(configuration, user, notes);
  const selectedNote = ref<Note | null>(null);
  const editingNote = ref<Note | null>(null);
  const view = shallowRef("library");
  const setupOpen = shallowRef(false);
  const profileOpen = shallowRef(false);
  const loading = shallowRef(true);
  const message = shallowRef("");
  const messageKind = shallowRef<"success" | "error">("success");
  const remoteNotes = ref<NoteSummary[]>([]);
  const selectedPaperNotes = computed(() => {
    if (!selectedNote.value) return [];
    const entries = notes.value.some((n) => n.id === selectedNote.value!.id)
      ? notes.value
      : [...notes.value, summarize(selectedNote.value)];
    return (
      groupPapers(entries).find((p) =>
        p.notes.some((n) => n.id === selectedNote.value!.id),
      )?.notes || []
    );
  });
  let openRequest = 0;
  let timer: ReturnType<typeof setTimeout>;
  const assetBase = computed(() =>
    configuration.value.configured
      ? `https://raw.githubusercontent.com/${configuration.value.repository}/${configuration.value.branch}`
      : "",
  );
  function notify(text: string, kind: "success" | "error" = "success") {
    message.value = text;
    messageKind.value = kind;
    clearTimeout(timer);
    timer = setTimeout(() => (message.value = ""), 6500);
  }
  async function refresh() {
    try {
      const [library, papers] = await Promise.all([
        api.library(configuration.value.configured),
        api.catalog(configuration.value.configured),
      ]);
      remoteNotes.value = library;
      catalog.value = papers;
      const local = await localNotes();
      const ids = new Set(local.map((n) => n.id));
      notes.value = [
        ...local.map(summarize),
        ...remoteNotes.value.filter((n) => !ids.has(n.id)),
      ];
      await directions.refresh();
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  function navigate(target: string) {
    location.hash = target === "library" ? "" : target;
    view.value = target;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function openNote(id: string) {
    const request = ++openRequest;
    loading.value = true;
    try {
      if (/^paper-[a-f0-9]{32}$/.test(id)) {
        const paper = await api.loadPaper(id);
        if (request !== openRequest) return;
        selectedCatalog.value = paper;
        view.value = "catalog";
        location.hash = `paper/${id}`;
        window.scrollTo(0, 0);
        return;
      }
      const note =
        (await localNotes()).find((n) => n.id === id) ??
        (await api.loadNote(id, configuration.value.configured));
      if (request !== openRequest) return;
      selectedNote.value = note;
      view.value = "reader";
      location.hash = `paper/${id}`;
      window.scrollTo(0, 0);
    } catch (error) {
      if (request === openRequest) notify((error as Error).message, "error");
    } finally {
      if (request === openRequest) loading.value = false;
    }
  }
  function beginImport(note?: Note, direction?: string) {
    if (!note && direction) note = { ...createNote(), tags: [direction] };
    editingNote.value = note ? JSON.parse(JSON.stringify(note)) : null;
    navigate("import");
  }
  function contribute(
    note: Pick<
      Note,
      "title" | "subtitle" | "paperUrl" | "codeUrl" | "venue" | "year" | "tags"
    >,
  ) {
    beginImport({
      ...createNote(),
      title: note.title,
      subtitle: note.subtitle,
      paperUrl: note.paperUrl,
      codeUrl: note.codeUrl,
      venue: note.venue,
      year: note.year,
      tags: [...note.tags],
      author: user.value?.name || "",
    });
  }
  async function collect(token: string, tags: string[]) {
    try {
      const { job } = await api.collectPaper(token, tags);
      reviews.upsert(job);
      navigate("reviews");
      notify(job.status === "published" ? "论文已收录。" : "论文收录中。");
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 401) user.value = null;
      throw e;
    }
  }
  async function saveProfile(nickname: string) {
    let result: Awaited<ReturnType<typeof api.updateProfile>>;
    try {
      result = await api.updateProfile(nickname);
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401)
        user.value = null;
      throw error;
    }
    user.value = result.user;
    remoteNotes.value = result.notes;
    const local = await localNotes();
    for (const note of local) {
      if (ownsNote(note, result.user)) {
        note.author = result.user.name;
        await saveLocalNote(note);
      }
    }
    const ids = new Set(local.map((n) => n.id));
    notes.value = [
      ...local.map(summarize),
      ...result.notes.filter((n) => !ids.has(n.id)),
    ];
    if (selectedNote.value && ownsNote(selectedNote.value, result.user)) {
      selectedNote.value = { ...selectedNote.value, author: result.user.name };
    }
    if (editingNote.value && ownsNote(editingNote.value, result.user))
      editingNote.value.author = result.user.name;
    notify("昵称已保存，历史笔记署名已同步。");
  }
  function login() {
    if (configuration.value.authConfigured) location.href = "/api/auth/login";
    else setupOpen.value = true;
  }
  async function logout() {
    try {
      await api.api("/api/logout", { method: "POST" });
      user.value = null;
      profileOpen.value = false;
      notify("已退出登录。");
    } catch (e) {
      notify((e as Error).message, "error");
    }
  }
  async function save(note: Note, toRepository: boolean, baseRevision: string) {
    if (toRepository) {
      let result: Awaited<ReturnType<typeof api.publishNote>>;
      try {
        result = await api.publishNote(note, baseRevision);
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 401) {
          user.value = null;
        }
        throw error;
      }
      let backedUp = true;
      try {
        await setRecord(`review-draft:${result.job.id}`, {
          owner: user.value?.login,
          note,
        });
      } catch {
        backedUp = false;
      }
      reviews.upsert(result.job);
      navigate("reviews");
      notify(
        reviewPending(result.job.status)
          ? backedUp
            ? "笔记审核中。"
            : "笔记审核中。本机备份未保存，可在“我的提交”查看。"
          : "已找到相同内容的审核结果。",
      );
      return result.job.commitUrl || "";
    }
    const saved = {
      ...JSON.parse(JSON.stringify(note)),
      local: true,
      demo: false,
      updatedAt: new Date().toISOString(),
    };
    await saveLocalNote(saved);
    await refresh();
    selectedNote.value = saved;
    view.value = "reader";
    location.hash = `paper/${note.id}`;
    notify("已保存在此浏览器，尚未上传到 GitHub。");
    return "";
  }
  async function editReview(id: string) {
    try {
      let note: Note | null = null;
      try {
        note = (await api.reviewDetail(id)).note;
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 401) {
          user.value = null;
          throw error;
        }
      }
      if (!note) {
        const saved = await getRecord<{ owner: string; note: Note }>(
          `review-draft:${id}`,
        );
        if (saved && saved.owner === user.value?.login) note = saved.note;
      }
      if (!note) throw new Error("服务器草稿已到期，请重新导入笔记文件。");
      beginImport(note);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  async function retryReview(id: string) {
    try {
      const { job } = await api.retryReview(id);
      reviews.upsert(job);
      notify(job.kind === "paper" ? "论文收录中。" : "笔记审核中。");
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401)
        user.value = null;
      notify((error as Error).message, "error");
    }
  }
  function hashChanged() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash.startsWith("paper/")) {
      if (selectedNote.value?.id === hash.slice(6)) view.value = "reader";
      else if (selectedCatalog.value?.id === hash.slice(6))
        view.value = "catalog";
      else void openNote(hash.slice(6));
    } else
      view.value = ["import", "reviews", "guide", "collect"].includes(hash)
        ? hash
        : "library";
  }
  onMounted(async () => {
    configuration.value = await api.config();
    user.value = await api.session();
    document.title = `${configuration.value.title} · 论文与阅读笔记`;
    await refresh();
    loading.value = false;
    hashChanged();
    window.addEventListener("hashchange", hashChanged);
    const error = new URLSearchParams(location.search).get("auth_error");
    if (error) {
      notify(error, "error");
      history.replaceState({}, "", location.pathname + location.hash);
    }
  });
  onUnmounted(() => {
    clearTimeout(timer);
    window.removeEventListener("hashchange", hashChanged);
  });
  return {
    configuration,
    user,
    reviews,
    pendingReviews,
    notes,
    catalog,
    selectedCatalog,
    catalogNotes,
    collect,
    directions,
    selectedNote,
    editingNote,
    view,
    setupOpen,
    profileOpen,
    selectedPaperNotes,
    loading,
    message,
    messageKind,
    assetBase,
    notify,
    refresh,
    navigate,
    openNote,
    beginImport,
    contribute,
    saveProfile,
    login,
    logout,
    save,
    editReview,
    retryReview,
  };
}
