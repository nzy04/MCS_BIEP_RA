import { ref, shallowRef, onMounted, onUnmounted, computed } from "vue";
import type { Note, NoteSummary, Session, SiteConfig } from "../../shared/note";
import { summarize, createNote } from "../../shared/note";
import { groupPapers, ownsNote } from "../../shared/papers";
import { reviewPending } from "../../shared/review";
import type { ReviewIssue } from "../../shared/review";
import type { ContextAction } from "../components/ContextMenu.vue";
import { useReviewJobs } from "./useReviewJobs";
import { useDirections } from "./useDirections";
import {
  movedDirections,
  changedDirections,
  directionKey,
  directionName,
  type DirectionChange,
  type MoveNotesRequest,
} from "../../shared/directions";
import * as api from "../services/api";
import {
  localNotes,
  saveLocalNote,
  removeLocalNote,
  getRecord,
  setRecord,
  setRecords,
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
  const directions = useDirections(configuration, user, notes);
  const contextMenu = shallowRef<{
    x: number;
    y: number;
    items: ContextAction[];
  } | null>(null);
  const directionAction = shallowRef<{
    kind: "create" | "rename" | "delete";
    name: string;
  } | null>(null);
  const noteToDelete = shallowRef<NoteSummary | null>(null);
  const editingIssues = shallowRef<ReviewIssue[]>([]);
  const newDirection = shallowRef<{ name: string } | null>(null);
  const lastDirectionChange = shallowRef<DirectionChange | null>(null);
  const selectedNote = ref<Note | null>(null);
  const editingNote = ref<Note | null>(null);
  const view = shallowRef("library");
  const invitationToken = shallowRef("");
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
      remoteNotes.value = await api.library(configuration.value.configured);
      const local = await localNotes().catch(() => []);
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
      const note =
        (await localNotes().catch(() => [])).find((n) => n.id === id) ??
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
    editingIssues.value = [];
    if (!note && direction) note = { ...createNote(), tags: [direction] };
    editingNote.value = note ? JSON.parse(JSON.stringify(note)) : null;
    navigate("import");
  }
  function menuPosition(event: MouseEvent) {
    const box = (
      event.currentTarget as HTMLElement | null
    )?.getBoundingClientRect();
    return {
      x: event.clientX || box?.left || 12,
      y: event.clientY || box?.bottom || 12,
    };
  }
  function directionContext(event: MouseEvent, name: string | null) {
    if (!directions.canCreate.value) return;
    event.preventDefault();
    const items: ContextAction[] = [
      {
        label: "新建研究方向",
        run: () => (directionAction.value = { kind: "create", name: "" }),
      },
    ];
    if (name)
      items.push(
        {
          label: "重命名",
          run: () => (directionAction.value = { kind: "rename", name }),
        },
        {
          label: "删除研究方向",
          danger: true,
          run: () => (directionAction.value = { kind: "delete", name }),
        },
      );
    contextMenu.value = { ...menuPosition(event), items };
  }
  function noteContext(event: MouseEvent, note: NoteSummary) {
    event.preventDefault();
    const items: ContextAction[] = [
      { label: "阅读笔记", run: () => void openNote(note.id) },
    ];
    if (note.local || (!!user.value?.canWrite && ownsNote(note, user.value)))
      items.push({
        label: "删除我的笔记",
        danger: true,
        run: () => (noteToDelete.value = note),
      });
    contextMenu.value = { ...menuPosition(event), items };
  }
  async function deleteOwnNote(note: NoteSummary) {
    if (note.local) await removeLocalNote(note.id);
    else {
      if (!user.value?.canWrite || !ownsNote(note, user.value))
        throw new Error("只有上传者本人可以删除这份笔记。");
      try {
        const result = await api.deleteNote(note);
        remoteNotes.value = result.notes;
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 401)
          user.value = null;
        throw error;
      }
    }
    const local = await localNotes().catch(() => []),
      ids = new Set(local.map((n) => n.id));
    notes.value = [
      ...local.map(summarize),
      ...remoteNotes.value.filter((n) => !ids.has(n.id)),
    ];
    if (selectedNote.value?.id === note.id) {
      selectedNote.value = null;
      navigate("library");
    }
    if (editingNote.value?.id === note.id) editingNote.value = null;
    notify("已删除你的笔记。");
  }
  function contribute(
    note: Pick<
      Note,
      | "title"
      | "subtitle"
      | "paperUrl"
      | "pdfUrl"
      | "codeUrl"
      | "venue"
      | "year"
      | "tags"
    >,
  ) {
    beginImport({
      ...createNote(),
      title: note.title,
      subtitle: note.subtitle,
      paperUrl: note.paperUrl,
      pdfUrl: note.pdfUrl || "",
      codeUrl: note.codeUrl,
      venue: note.venue,
      year: note.year,
      tags: [...note.tags],
      author: user.value?.name || "",
    });
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
  async function moveNotes(input: MoveNotesRequest) {
    const local = await localNotes();
    const localIds = new Set(local.map((n) => n.id));
    const remote = input.notes.filter((n) => !localIds.has(n.id));
    if (remote.length) {
      try {
        const result = await api.moveNotes({ ...input, notes: remote });
        remoteNotes.value = result.notes;
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 401)
          user.value = null;
        throw error;
      }
    }
    for (const note of local) {
      if (input.notes.some((n) => n.id === note.id)) {
        note.tags = movedDirections(note.tags, input.source, input.target);
        note.updatedAt = new Date().toISOString();
      }
    }
    if (input.notes.some((n) => localIds.has(n.id)))
      await setRecord("local-notes", local);
    notes.value = [
      ...local.map(summarize),
      ...remoteNotes.value.filter((n) => !localIds.has(n.id)),
    ];
    notify(
      `已移动到“${input.target}”${remote.length ? "，GitHub 目录已同步。" : "（仅本机）。"}`,
    );
  }
  async function changeDirection(input: DirectionChange) {
    const change = {
      name: directionName(input.name),
      replacement:
        input.replacement === null ? null : directionName(input.replacement),
    };
    if (!directions.canCreate.value)
      throw new Error("请先登录并加入论文库，再整理研究方向。");
    let local = await localNotes().catch(() => []);
    let nextDirections: string[];
    let nextRemote = remoteNotes.value;
    if (configuration.value.configured) {
      try {
        const result = await api.changeDirection(change);
        nextDirections = result.directions;
        nextRemote = result.notes;
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 401)
          user.value = null;
        throw error;
      }
    } else {
      if (
        change.replacement &&
        directionKey(change.replacement) !== directionKey(change.name) &&
        directions.options.value.some(
          (n) => directionKey(n) === directionKey(change.replacement!),
        )
      )
        throw new Error("该研究方向已存在，请使用其他名称。");
      nextDirections = changedDirections(directions.options.value, change);
    }
    local = local.map((note) =>
      note.tags.some((tag) => directionKey(tag) === directionKey(change.name))
        ? {
            ...note,
            tags: changedDirections(note.tags, change),
            revision: crypto.randomUUID(),
            updatedAt: new Date().toISOString(),
          }
        : note,
    );
    if (!configuration.value.configured || local.length) {
      try {
        await setRecords({ "local-notes": local, directions: nextDirections });
      } catch (error) {
        if (!configuration.value.configured) throw error;
        notify(
          "GitHub 已同步；本机草稿更新失败，请保留草稿后重新选择方向。",
          "error",
        );
      }
    }
    remoteNotes.value = nextRemote;
    const localIds = new Set(local.map((n) => n.id));
    notes.value = [
      ...local.map(summarize),
      ...nextRemote.filter((n) => !localIds.has(n.id)),
    ];
    directions.replace(nextDirections);
    lastDirectionChange.value = change;
    if (selectedNote.value) {
      const latest = notes.value.find((n) => n.id === selectedNote.value!.id);
      if (latest)
        selectedNote.value = {
          ...selectedNote.value,
          tags: latest.tags,
          revision: latest.revision,
          updatedAt: latest.updatedAt,
        };
    }
    notify(
      change.replacement
        ? "研究方向已重命名，笔记分类和目录已同步。"
        : "研究方向已删除，所有笔记均已保留。",
    );
  }
  async function login() {
    if (!configuration.value.authConfigured) {
      setupOpen.value = true;
      return;
    }
    if (view.value === "join" && invitationToken.value) {
      try {
        location.assign((await api.invitationLogin(invitationToken.value)).url);
      } catch (e) {
        notify((e as Error).message, "error");
      }
    } else location.href = "/api/auth/login";
  }
  function joined(userSession: Session) {
    user.value = userSession;
    invitationToken.value = "";
    navigate("library");
    notify("已加入论文库，可以上传笔记了。");
  }
  async function logout() {
    try {
      await api.api("/api/logout", { method: "POST" });
      user.value = null;
      profileOpen.value = false;
      if (view.value === "members") navigate("library");
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
      let issues = reviews.jobs.value.find((j) => j.id === id)?.issues || [];
      let receipt = reviews.jobs.value.find((j) => j.id === id)?.receipt;
      try {
        const detail = await api.reviewDetail(id);
        note = detail.note;
        issues = detail.job.issues;
        receipt = detail.job.receipt;
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
      if (receipt) note.review = receipt;
      beginImport(note);
      editingIssues.value = issues;
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }
  async function retryReview(id: string) {
    try {
      const { job } = await api.retryReview(id);
      reviews.upsert(job);
      notify("笔记审核中。");
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401)
        user.value = null;
      notify((error as Error).message, "error");
    }
  }
  function hashChanged() {
    let hash: string;
    try {
      hash = decodeURIComponent(location.hash.slice(1));
    } catch {
      hash = "";
    }
    if (hash.startsWith("join/")) {
      invitationToken.value = hash.slice(5);
      view.value = "join";
    } else if (hash === "members") {
      view.value = user.value?.isAdmin ? "members" : "library";
      if (!user.value?.isAdmin) notify("只有维护者可以管理组员。", "error");
    } else if (hash.startsWith("paper/")) {
      if (selectedNote.value?.id === hash.slice(6)) view.value = "reader";
      else void openNote(hash.slice(6));
    } else
      view.value = ["import", "reviews", "guide"].includes(hash)
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
    directions,
    contextMenu,
    directionAction,
    noteToDelete,
    editingIssues,
    directionContext,
    noteContext,
    deleteOwnNote,
    newDirection,
    lastDirectionChange,
    changeDirection,
    selectedNote,
    editingNote,
    view,
    invitationToken,
    joined,
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
    moveNotes,
    login,
    logout,
    save,
    editReview,
    retryReview,
  };
}
