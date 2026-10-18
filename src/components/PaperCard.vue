<script setup lang="ts">
import { ArrowUpRight, FileText, Clock3 } from "lucide-vue-next";
import type { NoteSummary } from "../../shared/note";
defineProps<{ note: NoteSummary }>();
defineEmits<{ open: [id: string] }>();
</script>
<template>
  <article class="paper-card">
    <div class="card-top">
      <span class="venue-label"
        >{{ note.venue || "阅读笔记" }}
        <span v-if="note.year">· {{ note.year }}</span></span
      ><span v-if="note.local" class="local-label">仅本机</span
      ><span v-else-if="note.demo" class="sample-label">示例</span
      ><span v-else class="reading-label">{{ note.readingDepth }}</span>
    </div>
    <a
      :href="`#paper/${note.id}`"
      class="card-title"
      @click.prevent="$emit('open', note.id)"
      >{{ note.title }}<ArrowUpRight :size="18"
    /></a>
    <p v-if="note.subtitle" class="card-subtitle">{{ note.subtitle }}</p>
    <p class="card-excerpt">
      {{ note.excerpt || "打开阅读这篇论文的详细笔记。" }}
    </p>
    <div class="card-tags">
      <span v-for="tag in note.tags" :key="tag" class="tag">{{ tag }}</span>
    </div>
    <div class="card-footer">
      <span class="card-person"
        ><span class="avatar-initial">{{ note.author.slice(0, 1) || "M" }}</span
        >{{ note.author || "组内成员" }}</span
      ><span
        ><Clock3 :size="13" />{{
          note.updatedAt.slice(0, 10).replaceAll("-", ".")
        }}</span
      ><FileText :size="15" class="footer-note-icon" />
    </div>
  </article>
</template>
