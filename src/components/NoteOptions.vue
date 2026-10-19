<script setup lang="ts">
import type { NoteSummary } from "../../shared/note";
defineProps<{ notes: NoteSummary[]; currentId?: string; canMove?: boolean }>();
defineEmits<{
  open: [id: string];
  move: [note: NoteSummary];
  dragNote: [event: DragEvent, note: NoteSummary];
  dragEnd: [];
}>();
</script>
<template>
  <nav class="note-options" aria-label="选择阅读笔记">
    <span class="options-label">阅读笔记 · {{ notes.length }} 份</span>
    <div class="options-list">
      <div
        v-for="note in notes"
        :key="note.id"
        class="note-option"
        :class="{ selected: note.id === currentId }"
        :draggable="!!canMove"
        @dragstart.stop="canMove && $emit('dragNote', $event, note)"
        @dragend.stop="$emit('dragEnd')"
      >
        <a
          :href="`#paper/${note.id}`"
          class="note-option-link"
          :draggable="false"
          :aria-current="note.id === currentId ? 'page' : undefined"
          @click.prevent="$emit('open', note.id)"
        >
          <strong>{{ note.author || note.authorLogin || "未署名" }}</strong>
          <span v-if="note.authorLogin" class="option-login"
            >@{{ note.authorLogin }}</span
          >
          <span class="option-detail"
            >{{ note.readingDepth }} · {{ note.updatedAt.slice(0, 10)
            }}{{ note.local ? " · 仅本机" : "" }}</span
          >
        </a>
        <button
          v-if="canMove"
          class="text-link option-move"
          :aria-label="`移动 ${note.author || note.authorLogin} 的笔记`"
          @click="$emit('move', note)"
        >
          移动
        </button>
      </div>
    </div>
  </nav>
</template>
<style scoped>
.note-options {
  margin-top: 16px;
  min-width: 0;
}
.options-label {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 8px;
}
.options-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.note-option {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 11px;
  font-size: 13px;
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.note-option:hover,
.note-option.selected {
  border-color: var(--green);
  background: #f0f7f3;
}
.option-login,
.option-detail {
  color: var(--muted);
  font-size: 12px;
}
.option-detail {
  flex-basis: 100%;
}
.note-option-link {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
}
.option-move {
  font-size: 12px;
  margin-left: auto;
}
</style>
