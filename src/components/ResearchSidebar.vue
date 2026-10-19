<script setup lang="ts">
import { shallowRef } from "vue";
import { Folder } from "lucide-vue-next";
import DirectionCreateForm from "./DirectionCreateForm.vue";
const selected = defineModel<string | null>({ required: true });
defineProps<{
  directions: string[];
  counts: Map<string, number>;
  total: number;
  canCreate: boolean;
  create: (name: string) => Promise<string>;
  dragging: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{ drop: [target: string] }>();
const over = shallowRef<string | null>(null);
function drop(event: DragEvent, tag: string) {
  event.preventDefault();
  over.value = null;
  emit("drop", tag);
}
</script>
<template>
  <aside class="topics" aria-label="研究方向">
    <h2 class="sidebar-heading">研究方向</h2>
    <button
      :class="{ selected: selected === null }"
      :aria-pressed="selected === null"
      @click="selected = null"
    >
      全部文献 <span>{{ total }}</span>
    </button>
    <button
      v-for="tag in directions"
      :key="tag"
      :class="{
        selected: selected === tag,
        'drop-target': dragging,
        'drag-over': over === tag && dragging,
      }"
      :aria-pressed="selected === tag"
      :disabled="busy"
      @click="selected = tag"
      @dragover="dragging && ($event.preventDefault(), (over = tag))"
      @dragleave="over = null"
      @drop="dragging && drop($event, tag)"
    >
      <span class="direction-name"><Folder :size="14" />{{ tag }}</span
      ><span>{{ counts.get(tag) || 0 }}</span>
    </button>
    <DirectionCreateForm
      :create="create"
      :can-create="canCreate"
      @created="selected = $event"
    />
    <p v-if="dragging || busy" class="move-hint" role="status">
      {{ busy ? "正在同步目录…" : "拖到目标方向以移动" }}
    </p>
  </aside>
</template>
<style scoped>
.direction-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.direction-name svg {
  flex-shrink: 0;
}
.topics button.drop-target {
  outline: 1px dashed #8fae9e;
  outline-offset: -2px;
}
.topics button.drag-over {
  background: #deeee5;
  outline: 2px solid var(--green);
}
.move-hint {
  color: var(--green);
  font-size: 13px;
  line-height: 1.6;
  margin: 12px 0;
}
</style>
