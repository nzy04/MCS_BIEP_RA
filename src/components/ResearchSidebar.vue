<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { directionKey } from "../../shared/directions";
import { Folder } from "lucide-vue-next";
const selected = defineModel<string | null>({ required: true });
const props = defineProps<{
  directions: string[];
  counts: Map<string, number>;
  total: number;
  unclassified: number;
  canCreate: boolean;
  dragging: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  drop: [target: string];
  context: [event: MouseEvent, name: string | null];
}>();
const over = shallowRef<string | null>(null);
const query = shallowRef("");
const filtered = computed(() =>
  props.directions.filter((n) =>
    directionKey(n).includes(directionKey(query.value)),
  ),
);
function drop(event: DragEvent, tag: string) {
  event.preventDefault();
  over.value = null;
  emit("drop", tag);
}
</script>
<template>
  <aside
    class="topics"
    aria-label="研究方向"
    @contextmenu="$emit('context', $event, null)"
  >
    <h2 class="sidebar-heading">
      研究方向
      <button
        v-if="canCreate"
        class="touch-menu"
        type="button"
        aria-label="研究方向操作"
        @click="$emit('context', $event, null)"
      >
        ⋯
      </button>
    </h2>
    <input
      v-model="query"
      class="direction-search"
      type="search"
      aria-label="筛选研究方向"
      placeholder="搜索方向"
    />
    <button
      :class="{ selected: selected === null }"
      :aria-pressed="selected === null"
      @click="selected = null"
    >
      全部文献 <span>{{ total }}</span>
    </button>
    <button
      :class="{ selected: selected === '' }"
      :aria-pressed="selected === ''"
      @click="selected = ''"
    >
      未分类 <span>{{ unclassified }}</span>
    </button>
    <button
      v-for="tag in filtered"
      :key="tag"
      :class="{
        selected: selected === tag,
        'drop-target': dragging,
        'drag-over': over === tag && dragging,
      }"
      :aria-pressed="selected === tag"
      :disabled="busy"
      @click="selected = tag"
      @contextmenu.stop="$emit('context', $event, tag)"
      @dragover="dragging && ($event.preventDefault(), (over = tag))"
      @dragleave="over = null"
      @drop="dragging && drop($event, tag)"
    >
      <span class="direction-name"><Folder :size="14" />{{ tag }}</span
      ><span>{{ counts.get(tag) || 0 }}</span>
    </button>
    <p v-if="dragging || busy" class="move-hint" role="status">
      {{ busy ? "正在同步目录…" : "拖到目标方向以移动" }}
    </p>
  </aside>
</template>
<style scoped>
.touch-menu {
  display: none;
}
.sidebar-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
@media (max-width: 720px), (hover: none) {
  .touch-menu {
    display: inline-flex;
  }
}
.direction-search {
  width: 100%;
  min-width: 0;
  margin-bottom: 12px;
}
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
