<script setup lang="ts">
import type { NoteSummary } from "../../shared/note";
defineProps<{ note: NoteSummary }>();
defineEmits<{ open: [id: string] }>();
</script>
<template>
  <article class="paper-card">
    <div class="paper-entry">
      <div class="card-top">
        <span v-if="note.venue || note.year" class="venue-label"
          >{{ note.venue
          }}<span v-if="note.year"
            >{{ note.venue ? " · " : "" }}{{ note.year }}</span
          ></span
        >
        <span v-if="note.local" class="local-label">仅本机</span
        ><span v-else-if="note.demo" class="sample-label">示例</span
        ><span v-else class="reading-label">{{ note.readingDepth }}</span>
      </div>
      <a
        :href="`#paper/${note.id}`"
        class="card-title"
        @click.prevent="$emit('open', note.id)"
        >{{ note.title }}</a
      >
      <p v-if="note.subtitle" class="card-subtitle">{{ note.subtitle }}</p>
      <p v-if="note.excerpt" class="card-excerpt">{{ note.excerpt }}</p>
      <div v-if="note.tags.length" class="card-tags">
        <span v-for="tag in note.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
    </div>
    <div class="card-side">
      <div class="card-footer">
        <span class="card-person">{{ note.author || "未署名" }}</span
        ><time :datetime="note.updatedAt">{{
          note.updatedAt.slice(0, 10)
        }}</time>
      </div>
      <div class="paper-actions">
        <a :href="`#paper/${note.id}`" @click.prevent="$emit('open', note.id)"
          >阅读笔记</a
        ><a
          v-if="note.paperUrl"
          :href="note.paperUrl"
          target="_blank"
          rel="noopener"
          >论文</a
        ><a
          v-if="note.codeUrl"
          :href="note.codeUrl"
          target="_blank"
          rel="noopener"
          >代码</a
        >
      </div>
    </div>
  </article>
</template>
