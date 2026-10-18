<script setup lang="ts">
import {
  ArrowLeft,
  Pencil,
  ExternalLink,
  Download,
  Github,
} from "lucide-vue-next";
import type { Note } from "../../shared/note";
import { toMarkdown } from "../../shared/note";
import NotePreview from "./NotePreview.vue";
const props = defineProps<{ note: Note; assetBase: string }>();
defineEmits<{ back: []; edit: [note: Note] }>();
function download() {
  const a = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([toMarkdown(props.note)], { type: "text/markdown;charset=utf-8" }),
  );
  a.href = url;
  a.download = `${props.note.id}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <main class="page-container reader-main">
    <div class="reader-toolbar">
      <button class="text-link" @click="$emit('back')">
        <ArrowLeft :size="16" />返回论文库
      </button>
      <div class="action-group">
        <button class="button ghost small" @click="download">
          <Download :size="15" />导出笔记</button
        ><button class="button secondary small" @click="$emit('edit', note)">
          <Pencil :size="15" />编辑笔记
        </button>
      </div>
    </div>
    <div v-if="note.local" class="reader-state">
      这篇笔记仅保存在此浏览器，尚未上传 GitHub。
    </div>
    <div v-else-if="note.demo" class="reader-state">
      示例笔记，用于体验阅读与编辑流程，内容可替换。
    </div>
    <div class="reader-layout">
      <section class="reader-paper">
        <NotePreview :note="note" :asset-base="assetBase" />
      </section>
      <aside class="reader-aside">
        <div class="eyebrow">PAPER RESOURCES</div>
        <h3>继续阅读</h3>
        <a
          v-if="note.paperUrl"
          class="resource-link"
          :href="note.paperUrl"
          target="_blank"
          rel="noopener"
          ><ExternalLink :size="17" />论文原文 <span>↗</span></a
        ><a
          v-if="note.codeUrl"
          class="resource-link"
          :href="note.codeUrl"
          target="_blank"
          rel="noopener"
          ><Github :size="17" />代码 / 项目 <span>↗</span></a
        ><template v-for="asset in note.assets" :key="asset.path"
          ><a
            v-if="asset.mime === 'application/pdf'"
            class="resource-link"
            :href="asset.dataUrl || `${assetBase}/${asset.path}`"
            target="_blank"
            rel="noopener"
            >附带 PDF <span>↗</span></a
          ></template
        >
        <div class="reader-detail">
          <span>最后更新</span><strong>{{ note.updatedAt.slice(0, 10) }}</strong
          ><span>阅读深度</span><strong>{{ note.readingDepth }}</strong>
        </div>
        <p class="reader-footnote">好的笔记，也可以保留尚未解决的问题。</p>
      </aside>
    </div>
  </main>
</template>
