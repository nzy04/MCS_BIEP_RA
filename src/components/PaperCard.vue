<script setup lang="ts">
import { computed } from "vue";
import type { PaperGroup } from "../../shared/papers";
import NoteOptions from "./NoteOptions.vue";
const props = defineProps<{ paper: PaperGroup }>();
const note = computed(() => props.paper.note);
const entryId = computed(() => props.paper.record?.id || note.value.id);
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
        ><span v-else class="reading-label">{{
          paper.notes.length ? note.readingDepth : "待读"
        }}</span>
      </div>
      <a
        :href="`#paper/${entryId}`"
        class="card-title"
        @click.prevent="$emit('open', entryId)"
        >{{ note.title }}</a
      >
      <p v-if="note.subtitle" class="card-subtitle">{{ note.subtitle }}</p>
      <p v-if="note.excerpt" class="card-excerpt">{{ note.excerpt }}</p>
      <div v-if="paper.tags.length" class="card-tags">
        <span v-for="tag in paper.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
      <NoteOptions
        v-if="paper.notes.length"
        :notes="paper.notes"
        @open="$emit('open', $event)"
      />
    </div>
    <div class="card-side">
      <div class="card-footer">
        <span class="card-person">{{
          !paper.notes.length
            ? "尚无阅读笔记"
            : paper.notes.length > 1
              ? `${paper.notes.length} 份阅读笔记`
              : note.author || "未署名"
        }}</span
        ><time :datetime="note.updatedAt">{{
          note.updatedAt.slice(0, 10)
        }}</time>
      </div>
      <div class="paper-actions">
        <a
          :href="`#paper/${entryId}`"
          @click.prevent="$emit('open', entryId)"
          >{{ paper.record ? "查看论文" : "阅读笔记" }}</a
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
