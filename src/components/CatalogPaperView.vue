<script setup lang="ts">
import { computed } from "vue";
import { ArrowLeft, FileText, Plus, ExternalLink } from "lucide-vue-next";
import type { PaperRecord } from "../../shared/catalog";
import type { NoteSummary, Session } from "../../shared/note";
import { paperDisplay } from "../../shared/papers";
import NoteOptions from "./NoteOptions.vue";
const props = defineProps<{
  paper: PaperRecord;
  notes: NoteSummary[];
  user: Session | null;
  assetBase: string;
}>();
const emit = defineEmits<{
  back: [];
  open: [id: string];
  contribute: [note: NoteSummary];
  login: [];
}>();
const pdf = computed(() =>
  props.paper.archivePath
    ? `${props.assetBase}/${props.paper.archivePath}`
    : props.paper.pdfUrl,
);
</script>
<template>
  <main class="page-container catalog-main">
    <button class="back-link" @click="emit('back')">
      <ArrowLeft :size="17" />返回论文库
    </button>
    <article class="catalog-paper">
      <div class="catalog-meta">
        {{ [paper.venue, paper.year].filter(Boolean).join(" · ") }}
        <span>{{ notes.length ? `${notes.length} 份笔记` : "待读" }}</span>
      </div>
      <h1>{{ paper.title }}</h1>
      <p v-if="paper.authors.length" class="catalog-authors">
        {{ paper.authors.join(", ") }}
      </p>
      <div class="card-tags">
        <span v-for="tag in paper.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
      <div class="catalog-actions">
        <a
          v-if="pdf"
          :href="pdf"
          class="button primary"
          target="_blank"
          rel="noopener"
          ><FileText :size="17" />{{
            paper.pdfStatus === "archived" ? "阅读 PDF · 仓库归档" : "阅读 PDF"
          }}</a
        ><a
          :href="paper.paperUrl"
          class="button secondary"
          target="_blank"
          rel="noopener"
          ><ExternalLink :size="16" />论文来源</a
        ><button
          v-if="user?.canWrite"
          class="button secondary"
          @click="emit('contribute', paperDisplay(paper))"
        >
          <Plus :size="17" />添加我的笔记</button
        ><button
          v-else-if="!user"
          class="button secondary"
          @click="emit('login')"
        >
          登录后添加笔记
        </button>
      </div>
      <p class="pdf-message">{{ paper.pdfMessage }}</p>
      <section v-if="paper.abstract" class="catalog-abstract">
        <h2>摘要</h2>
        <p>{{ paper.abstract }}</p>
      </section>
      <section class="catalog-notes">
        <h2>
          阅读笔记 <span>{{ notes.length }}</span>
        </h2>
        <NoteOptions
          v-if="notes.length"
          :notes="notes"
          @open="emit('open', $event)"
        />
        <p v-else>尚无阅读笔记。</p>
      </section>
    </article>
  </main>
</template>
<style scoped>
.catalog-main {
  max-width: 1020px;
  padding-top: 32px;
  padding-bottom: 80px;
}
.catalog-paper {
  margin-top: 30px;
  border-top: 2px solid var(--green);
  padding-top: 24px;
}
.catalog-meta {
  display: flex;
  align-items: center;
  gap: 20px;
  color: var(--green);
  font-size: 14px;
}
.catalog-meta span {
  padding: 4px 10px;
  background: #eef2f7;
}
h1 {
  font-family: var(--serif);
  font-size: 38px;
  line-height: 1.3;
  margin: 20px 0;
  overflow-wrap: anywhere;
}
.catalog-authors {
  color: var(--muted);
  margin-bottom: 20px;
  line-height: 1.8;
}
.catalog-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}
.pdf-message {
  font-size: 14px;
  color: var(--muted);
  line-height: 1.8;
  margin-top: 16px;
}
section {
  margin-top: 36px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}
h2 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 18px;
}
h2 span {
  font-size: 14px;
  color: var(--muted);
  margin-left: 8px;
}
.catalog-abstract p {
  line-height: 1.95;
  font-size: 17px;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.catalog-notes > p {
  color: var(--muted);
}
@media (max-width: 600px) {
  h1 {
    font-size: 29px;
  }
  .catalog-actions .button {
    flex-grow: 1;
    justify-content: center;
  }
}
</style>
