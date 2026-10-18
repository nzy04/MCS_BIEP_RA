<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
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
  if (!hasDraft.value && !draft.value.author && props.user)
    draft.value.author = props.user.name || props.user.login;
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
        <div class="eyebrow">CONTRIBUTE A READING NOTE</div>
        <h1>
          {{ existing ? "继续编辑这篇笔记" : "把你的阅读，分享给大家。" }}
        </h1>
        <p>上传已有笔记，确认整理结果，再发布到共同的论文库。</p>
      </div>
      <span class="private-pill">确认发布前，文件在你的浏览器中处理</span>
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
          <div class="panel-number">01 / YOUR NOTES</div>
          <h2>上传你的阅读笔记</h2>
          <p>Word、PDF、Markdown 或纯文本都可以。</p>
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
                  : "点击选择，或把文件拖到这里"
            }}</strong
            ><span>PDF / DOCX / MD / TXT · 最大 15 MB</span
            ><small v-if="noteFile"
              ><Check :size="13" />已解析，可继续整理</small
            ></label
          ><button class="text-link manual-note" @click="step = 2">
            <Plus :size="15" />也可以直接开始写笔记
          </button>
        </section>
        <section class="upload-panel optional-panel">
          <div class="panel-number">02 / PAPER · OPTIONAL</div>
          <h2>附上论文原文 <span>可选</span></h2>
          <p>阅读笔记和论文原文会分开处理，方便对照。</p>
          <label class="paper-upload"
            ><input
              data-testid="paper-file"
              type="file"
              accept=".pdf"
              :disabled="busy"
              @change="changed($event, 'paper')" /><BookOpen :size="25" />
            <div>
              <strong>{{ paperFile ? paperFile.name : "选择论文 PDF" }}</strong
              ><span>也可以在下一步填写论文链接</span>
            </div>
            <Plus :size="19"
          /></label>
          <div class="quiet-info">
            <span>如何整理？</span>
            <p>
              已有章节会对应到统一模板；没有匹配的内容会保留，不会自动编写你的个人思考。
            </p>
          </div>
        </section>
      </div>
      <div v-if="warnings.length" class="parse-notices">
        <p v-for="warning in warnings" :key="warning">
          <Check :size="14" />{{ warning }}
        </p>
      </div>
      <div class="workspace-actions">
        <span>文件只在本机解析，发布后才写入仓库。</span
        ><button
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
            <h2>整理你的笔记</h2>
            <span>{{ draftSaved || "修改会自动保存到本机" }}</span>
          </div>
          <TemplateEditor v-model="draft" @image="addImage" />
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
            {{
              originalText ||
              "你正在直接编写笔记，或编辑已有笔记。这里会展示新导入文档的原始文字。"
            }}
          </div>
          <template v-else-if="sourceTab === 'paper'"
            ><iframe
              v-if="paperPreview"
              :src="paperPreview"
              title="论文原文预览"
              class="pdf-frame"
            ></iframe>
            <div v-else class="original-text">
              尚未附加论文 PDF。可以返回导入步骤添加，或在左侧填写官方论文链接。
            </div></template
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
          <div class="panel-number">READY TO SHARE</div>
          <h2>确认这篇阅读记录</h2>
          <p>确认内容与署名准确，笔记中的图片都已正确显示。</p>
          <label v-if="paperFile" class="checkbox-field"
            ><input v-model="retainPdf" type="checkbox" />同时保存论文 PDF
            到仓库或本机<span
              >原文会占用存储空间；也可只保留官方链接。</span
            ></label
          >
          <div class="destination">
            <Github :size="20" />
            <div>
              <strong>{{
                remote ? config.repository : "保存在此浏览器"
              }}</strong
              ><span>{{
                remote
                  ? "将创建一次 GitHub 提交"
                  : config.configured
                    ? "登录并获得写权限后可发布"
                    : "GitHub 尚未连接，本次不会上传"
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
                ? "正在保存…"
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
