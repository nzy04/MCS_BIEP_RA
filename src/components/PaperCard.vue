<script setup lang="ts">
import { computed } from "vue";
import type { PaperGroup } from "../../shared/papers";
import type { NoteSummary } from "../../shared/note";
import NoteOptions from "./NoteOptions.vue";
const props = defineProps<{ paper: PaperGroup; canMove?: boolean }>();
const note = computed(() => props.paper.note);
defineEmits<{
  open: [id: string];
  move: [notes: NoteSummary[]];
  dragNotes: [event: DragEvent, notes: NoteSummary[]];
  dragEnd: [];
  context: [event: MouseEvent, note: NoteSummary];
}>();
</script>
<template>
  <article
    class="paper-card"
    :class="{ movable: canMove }"
    :draggable="!!canMove"
    @dragstart="canMove && $emit('dragNotes', $event, paper.notes)"
    @dragend="$emit('dragEnd')"
    @contextmenu="$emit('context', $event, note)"
  >
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
      <div v-if="paper.tags.length" class="card-tags">
        <span v-for="tag in paper.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
      <NoteOptions
        :notes="paper.notes"
        :can-move="canMove"
        @open="$emit('open', $event)"
        @move="$emit('move', [$event])"
        @drag-note="(event, note) => $emit('dragNotes', event, [note])"
        @drag-end="$emit('dragEnd')"
        @context="(event, note) => $emit('context', event, note)"
      />
    </div>
    <div class="card-side">
      <div class="card-footer">
        <span class="card-person">{{
          paper.notes.length > 1
            ? `${paper.notes.length} 份阅读笔记`
            : note.author || "未署名"
        }}</span
        ><time :datetime="note.updatedAt">{{
          note.updatedAt.slice(0, 10)
        }}</time>
      </div>
      <div class="paper-actions">
        <button
          v-if="canMove"
          class="text-link move-paper"
          @click="$emit('move', paper.notes)"
        >
          移动{{ paper.notes.length > 1 ? "全部笔记" : "笔记" }}
        </button>
        <a :href="`#paper/${note.id}`" @click.prevent="$emit('open', note.id)"
          >阅读笔记</a
        ><a
          v-if="note.paperUrl"
          :href="note.paperUrl"
          target="_blank"
          rel="noopener"
          >论文</a
        ><a
          v-if="note.pdfUrl"
          :href="note.pdfUrl"
          target="_blank"
          rel="noopener"
          >PDF</a
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
<style scoped>
.paper-card.movable {
  cursor: grab;
}
.paper-card.movable:active {
  cursor: grabbing;
}
.move-paper {
  font-size: inherit;
}
</style>
