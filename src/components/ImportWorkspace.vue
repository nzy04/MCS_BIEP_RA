<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from "vue";
import {
  ArrowLeft,
  ArrowRight,
  UploadCloud,
  FileText,
  Check,
  Download,
  Github,
  Save,
  AlertCircle,
  Plus,
  BookOpen,
  Eye,
} from "lucide-vue-next";
import {
  toMarkdown,
  validateNote,
  type Note,
  type SiteConfig,
  type Session,
} from "../../shared/note";
import { useImporter } from "../composables/useImporter";
import { getRecord } from "../services/storage";
import TemplateEditor from "./TemplateEditor.vue";
import NotePreview from "./NotePreview.vue";
const props = defineProps<{
  existing: Note | null;
  config: SiteConfig;
  user: Session | null;
  assetBase: string;
  save: (note: Note, remote: boolean, baseRevision: string) => Promise<string>;
}>();
const emit = defineEmits<{ back: []; login: [] }>();
const {
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
} = useImporter(props.existing);
const hasDraft = shallowRef(false);
const initialized = shallowRef(false);
function syncAuthor() {
  // An untouched import screen must not autosave a blank draft over a recoverable one.
  if (!initialized.value || (hasDraft.value && !props.existing && !recovered.value && step.value === 1)) return;
  const user = props.user;
  if (user) {
    draft.value.author = user.name || user.login;
    draft.value.authorLogin = user.login;
    draft.value.authorId = user.id;
  }
}
watch([() => props.user, () => draft.value, step], syncAuthor);
const publishing = shallowRef(false);
const sourceTab = shallowRef("note");
const commitUrl = shallowRef("");
const remote = computed(
  () => props.config.configured && !!props.user?.canWrite,
);
const canContinue = computed(
  () => !!noteFile.value || Object.values(draft.value.sections).some(Boolean),
);
onMounted(async () => {
  hasDraft.value = !!(await getRecord("draft"));
  initialized.value = true;
  syncAuthor();
});
function changed(event: Event, role: "note" | "paper") {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void selectFile(file, role);
}
function dropped(event: DragEvent) {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) void selectFile(file, "note");
}
function next() {
  error.value = "";
  if (step.value === 2) {
    const errors = validateNote(draft.value);
    if (errors.length) {
      error.value = errors.join(" ");
      return;
    }
  }
  step.value++;
  window.scrollTo(0, 0);
}
async function publish() {
  error.value = "";
  const errors = validateNote(draft.value);
  if (errors.length) {
    error.value = errors.join(" ");
    return;
  }
  publishing.value = true;
  try {
    const note = await preparedNote();
    commitUrl.value = await props.save(note, remote.value, baseRevision.value);
    await clearDraft();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    publishing.value = false;
  }
}
function download() {
  const blob = new Blob([toMarkdown(draft.value)], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${draft.value.title.replace(/[\\/:*?"<>|]/g, "-") || "阅读笔记"}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <main class="page-container import-main">
    <button class="text-link back-link" @click="emit('back')">
      <ArrowLeft :size="16" />返回论文库
    </button>
    <div class="workspace-heading">
      <div>
        <h1>
          {{ existing ? "编辑笔记" : "上传与整理笔记" }}
        </h1>
      </div>
    </div>
    <ol class="stepper">
      <li
        v-for="(label, index) in ['导入文件', '整理与修改', '预览并发布']"
        :key="label"
        :class="{ current: step === index + 1, done: step > index + 1 }"
      >
        <span
          ><Check v-if="step > index + 1" :size="15" /><template v-else>{{
            index + 1
          }}</template></span
        >{{ label }}
      </li>
    </ol>
    <div v-if="error" class="alert error" role="alert">
      <AlertCircle :size="18" />{{ error }}
    </div>
    <template v-if="step === 1"
      ><div v-if="hasDraft && !recovered" class="draft-recovery">
        发现一份本机草稿。<button class="text-link" @click="recover">
          恢复继续编辑 <ArrowRight :size="15" />
        </button>
      </div>
      <div class="upload-columns">
        <section class="upload-panel">
          <h2>笔记文件</h2>
          <label
            class="dropzone"
            :class="{ busy }"
            @dragover.prevent
            @drop="dropped"
            ><input
              data-testid="note-file"
              type="file"
              accept=".pdf,.docx,.md,.markdown,.txt,.doc"
              :disabled="busy"
              @change="changed($event, 'note')"
            /><span class="upload-icon"><UploadCloud :size="28" /></span
            ><strong>{{
              busy
                ? "正在提取文件内容…"
                : noteFile
                  ? noteFile.name
                  : "选择或拖入文件"
            }}</strong
            ><span>PDF / DOCX / MD / TXT · 最大 15 MB</span
            ><small v-if="noteFile"
              ><Check :size="13" />已解析，可继续整理</small
            ></label
          ><button class="text-link manual-note" @click="step = 2">
            <Plus :size="15" />在线写笔记
          </button>
        </section>
        <section class="upload-panel optional-panel">
          <h2>论文 PDF <span>可选</span></h2>
          <label class="paper-upload"
            ><input
              data-testid="paper-file"
              type="file"
              accept=".pdf"
              :disabled="busy"
              @change="changed($event, 'paper')" /><BookOpen :size="25" />
            <div>
              <strong>{{ paperFile ? paperFile.name : "选择论文 PDF" }}</strong
              ><span>或在模板中填写论文链接</span>
            </div>
            <Plus :size="19"
          /></label>
        </section>
      </div>
      <div v-if="warnings.length" class="parse-notices">
        <p v-for="warning in warnings" :key="warning">
          <Check :size="14" />{{ warning }}
        </p>
      </div>
      <div class="workspace-actions">
        <button
          class="button primary"
          :disabled="!canContinue || busy"
          @click="next"
        >
          继续整理 <ArrowRight :size="17" />
        </button></div
    ></template>
    <template v-else-if="step === 2"
      ><div class="editor-columns">
        <section class="editor-panel">
          <div class="panel-heading">
            <h2>笔记模板</h2>
            <span>{{ draftSaved || "自动保存草稿" }}</span>
          </div>
          <TemplateEditor v-model="draft" :author-locked="!!user" @image="addImage" />
        </section>
        <aside class="source-panel">
          <div class="source-tabs">
            <button
              :class="{ active: sourceTab === 'note' }"
              @click="sourceTab = 'note'"
            >
              <FileText :size="15" />原始笔记</button
            ><button
              :class="{ active: sourceTab === 'paper' }"
              @click="sourceTab = 'paper'"
            >
              <BookOpen :size="15" />论文原文</button
            ><button
              :class="{ active: sourceTab === 'preview' }"
              @click="sourceTab = 'preview'"
            >
              <Eye :size="15" />预览
            </button>
          </div>
          <div v-if="sourceTab === 'note'" class="original-text">
            {{ originalText || "暂无原文" }}
          </div>
          <template v-else-if="sourceTab === 'paper'"
            ><iframe
              v-if="paperPreview"
              :src="paperPreview"
              title="论文原文预览"
              class="pdf-frame"
            ></iframe>
            <div v-else class="original-text">未添加 PDF</div></template
          ><NotePreview v-else :note="draft" :asset-base="assetBase" />
        </aside>
      </div>
      <div class="workspace-actions">
        <button class="button secondary" @click="step = 1">
          <ArrowLeft :size="15" />返回导入
        </button>
        <div class="action-group">
          <button class="button ghost" @click="download">
            <Download :size="16" />导出 Markdown</button
          ><button class="button primary" @click="next">
            查看发布预览 <ArrowRight :size="16" />
          </button>
        </div></div
    ></template>
    <template v-else
      ><div class="publish-columns">
        <section class="preview-panel">
          <NotePreview :note="draft" :asset-base="assetBase" />
        </section>
        <aside class="publish-panel">
          <h2>发布笔记</h2>
          <label v-if="paperFile" class="checkbox-field"
            ><input v-model="retainPdf" type="checkbox" />保存 PDF 附件（≤4
            MB）</label
          >
          <div class="destination">
            <Github :size="20" />
            <div>
              <strong>{{
                remote ? config.repository : "保存在此浏览器"
              }}</strong
              ><span>{{
                remote
                  ? "通过审核后公开"
                  : config.configured
                    ? "登录后可发布到仓库"
                    : "仅本机保存"
              }}</span>
            </div>
          </div>
          <button
            v-if="config.authConfigured && !user"
            class="button secondary full"
            @click="emit('login')"
          >
            <Github :size="16" />登录 GitHub</button
          ><button
            class="button primary full"
            :disabled="publishing"
            @click="publish"
          >
            <Save :size="17" />{{
              publishing
                ? remote
                  ? "正在提交审核…"
                  : "正在保存…"
                : remote
                  ? "确认发布到仓库"
                  : "确认保存到本机"
            }}</button
          ><button class="button ghost full" @click="download">
            <Download :size="16" />下载 Markdown</button
          ><button class="text-link" @click="step = 2">
            <ArrowLeft :size="14" />返回修改</button
          ><a v-if="commitUrl" :href="commitUrl" target="_blank" rel="noopener"
            >查看 GitHub 提交</a
          >
        </aside>
      </div></template
    >
  </main>
</template>
