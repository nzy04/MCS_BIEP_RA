<script setup lang="ts">
import {
  ArrowLeft,
  Pencil,
  ExternalLink,
  Download,
  Github,
} from "lucide-vue-next";
import { computed } from "vue";
import type { Note, NoteSummary, Session } from "../../shared/note";
import { ownsNote } from "../../shared/papers";
import NotePreview from "./NotePreview.vue";

import { exportNotePackage } from "../services/notePackage";
import { shallowRef } from "vue";
const exportError = shallowRef("");
const exporting = shallowRef(false);
import NoteOptions from "./NoteOptions.vue";
const props = defineProps<{
  note: Note;
  notes: NoteSummary[];
  user: Session | null;
  assetBase: string;
}>();
const canEdit = computed(
  () =>
    props.note.local ||
    props.note.demo ||
    (!!props.user && ownsNote(props.note, props.user)),
);
defineEmits<{
  back: [];
  edit: [note: Note];
  open: [id: string];
  contribute: [note: Note];
  context: [event: MouseEvent, note: NoteSummary];
}>();

async function downloadPackage() {
  exporting.value = true;
  exportError.value = "";
  try {
    const blob = await exportNotePackage(props.note, props.assetBase);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${props.note.title}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    exportError.value = (e as Error).message;
  } finally {
    exporting.value = false;
  }
}
</script>
<template>
  <main class="page-container reader-main">
    <div class="reader-toolbar">
      <button class="text-link" @click="$emit('back')">
        <ArrowLeft :size="16" />返回论文库
      </button>
      <div class="action-group">
        <button
          class="button ghost small"
          :disabled="exporting"
          @click="downloadPackage"
        >
          <Download :size="15" />{{
            exporting ? "正在导出…" : "导出笔记包"
          }}</button
        ><button
          v-if="canEdit"
          class="button secondary small"
          @click="$emit('edit', note)"
        >
          <Pencil :size="15" />编辑笔记
        </button>
        <button
          class="button secondary small"
          @click="$emit('contribute', note)"
        >
          添加我的笔记
        </button>
      </div>
    </div>
    <p v-if="exportError" class="alert error" role="alert">{{ exportError }}</p>
    <div v-if="note.local" class="reader-state">
      这篇笔记仅保存在此浏览器，尚未上传 GitHub。
    </div>
    <div v-else-if="note.demo" class="reader-state">
      示例笔记，用于体验阅读与编辑流程，内容可替换。
    </div>
    <div class="reader-layout">
      <section
        class="reader-paper"
        @contextmenu="$emit('context', $event, note)"
      >
        <NotePreview :note="note" :asset-base="assetBase" />
      </section>
      <aside class="reader-aside">
        <h3>这篇论文的笔记</h3>
        <NoteOptions
          :notes="notes"
          :current-id="note.id"
          @open="$emit('open', $event)"
          @context="(event, note) => $emit('context', event, note)"
        />
        <h3>论文资源</h3>
        <a
          v-if="note.paperUrl"
          class="resource-link"
          :href="note.paperUrl"
          target="_blank"
          rel="noopener"
          ><ExternalLink :size="17" />论文原文 <span>↗</span></a
        ><a
          v-if="note.pdfUrl"
          class="resource-link"
          :href="note.pdfUrl"
          target="_blank"
          rel="noopener"
          ><Download :size="17" />论文 PDF <span>↗</span></a
        ><a
          v-if="note.codeUrl"
          class="resource-link"
          :href="note.codeUrl"
          target="_blank"
          rel="noopener"
          ><Github :size="17" />代码 / 项目 <span>↗</span></a
        >
        <div class="reader-detail">
          <span>最后更新</span><strong>{{ note.updatedAt.slice(0, 10) }}</strong
          ><span>阅读深度</span><strong>{{ note.readingDepth }}</strong>
        </div>
      </aside>
    </div>
  </main>
</template>
<style scoped>
.reader-aside .note-options {
  margin: 0 0 28px;
}
.reader-toolbar {
  flex-wrap: wrap;
  gap: 12px;
}
.action-group {
  flex-wrap: wrap;
}
</style>
