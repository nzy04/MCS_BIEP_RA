<script setup lang="ts">
import guide from "../content/guide.md?raw";
import { renderedMarkdown } from "../services/markdown";

const safeHtml = renderedMarkdown(guide);
</script>

<template>
  <main class="page-container guide-page">
    <article class="note-body" v-html="safeHtml"></article>
  </main>
</template>

<style scoped>
.guide-page {
  max-width: 940px;
  padding-top: 44px;
  padding-bottom: 72px;
}
</style>
