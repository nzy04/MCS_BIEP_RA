<script setup lang="ts">
import { computed } from "vue";
import type { Note } from "../../shared/note";
import { renderedNote } from "../services/markdown";
const props = defineProps<{ note: Note; assetBase?: string }>();
// Only the sanitized output of the controlled Markdown renderer is inserted.
const safeHtml = computed(() => renderedNote(props.note, props.assetBase));
</script>
<template>
  <article class="note-preview">
    <div v-if="note.venue || note.year" class="preview-kicker">
      {{ note.venue }}
      <span v-if="note.year">/ {{ note.year }}</span>
    </div>
    <h1>{{ note.title || "还没有填写标题" }}</h1>
    <p v-if="note.subtitle" class="note-subtitle">{{ note.subtitle }}</p>
    <div class="note-meta">
      <span>{{ note.author || "尚未填写分享人" }}</span
      ><span>·</span><span>{{ note.readingDepth }}</span
      ><span v-for="tag in note.tags" :key="tag" class="tag">{{ tag }}</span>
    </div>
    <div class="note-body" v-html="safeHtml"></div>
  </article>
</template>
