import { ref, shallowRef, onMounted, onUnmounted, computed } from "vue";
import type { Note, NoteSummary, Session, SiteConfig } from "../../shared/note";
import { summarize } from "../../shared/note";
import * as api from "../services/api";
import {
  localNotes,
  saveLocalNote,
  removeLocalNote,
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
  const notes = ref<NoteSummary[]>([]);
  const selectedNote = ref<Note | null>(null);
  const editingNote = ref<Note | null>(null);
  const view = shallowRef("library");
  const setupOpen = shallowRef(false);
  const loading = shallowRef(true);
  const message = shallowRef("");
  const messageKind = shallowRef<"success" | "error">("success");
  const remoteNotes = ref<NoteSummary[]>([]);
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
      remoteNotes.value = await api.library(configuration.value.configured);
      const local = await localNotes();
      const ids = new Set(local.map((n) => n.id));
      notes.value = [
        ...local.map(summarize),
        ...remoteNotes.value.filter((n) => !ids.has(n.id)),
      ];
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
    loading.value = true;
    try {
      selectedNote.value =
        (await localNotes()).find((n) => n.id === id) ??
        (await api.loadNote(id, configuration.value.configured));
      view.value = "reader";
      location.hash = `paper/${id}`;
      window.scrollTo(0, 0);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      loading.value = false;
    }
  }
  function beginImport(note?: Note) {
    editingNote.value = note ? JSON.parse(JSON.stringify(note)) : null;
    navigate("import");
  }
  function login() {
    if (configuration.value.authConfigured) location.href = "/api/auth/login";
    else setupOpen.value = true;
  }
  async function logout() {
    try {
      await api.api("/api/logout", { method: "POST" });
      user.value = null;
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
      await removeLocalNote(note.id);
      selectedNote.value = result.note;
      await refresh();
      notes.value = [
        summarize(result.note),
        ...notes.value.filter((n) => n.id !== note.id),
      ];
      notify("笔记已提交到 GitHub 仓库。");
      view.value = "reader";
      location.hash = `paper/${note.id}`;
      return result.commitUrl;
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
  function hashChanged() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash.startsWith("paper/")) {
      if (selectedNote.value?.id === hash.slice(6)) view.value = "reader";
      else void openNote(hash.slice(6));
    } else view.value = hash === "import" ? "import" : "library";
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
    notes,
    selectedNote,
    editingNote,
    view,
    setupOpen,
    loading,
    message,
    messageKind,
    assetBase,
    notify,
    refresh,
    navigate,
    openNote,
    beginImport,
    login,
    logout,
    save,
  };
}
