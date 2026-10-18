<script setup lang="ts">
import { computed } from "vue";
import {
  directionKey,
  mergeDirections,
  MAX_NOTE_DIRECTIONS,
} from "../../shared/directions";
import DirectionCreateForm from "./DirectionCreateForm.vue";
const selected = defineModel<string[]>({ required: true });
const props = defineProps<{
  options: string[];
  canCreate: boolean;
  create: (name: string) => Promise<string>;
}>();
const options = computed(() => mergeDirections(props.options, selected.value));
function isSelected(name: string) {
  return selected.value.some((n) => directionKey(n) === directionKey(name));
}
function toggle(name: string, checked: boolean) {
  if (checked && selected.value.length < MAX_NOTE_DIRECTIONS)
    selected.value = [...selected.value, name];
  else if (!checked)
    selected.value = selected.value.filter(
      (n) => directionKey(n) !== directionKey(name),
    );
}
function created(name: string) {
  if (!isSelected(name) && selected.value.length < MAX_NOTE_DIRECTIONS)
    selected.value = [...selected.value, name];
}
</script>
<template>
  <fieldset class="direction-picker">
    <legend>研究方向（可多选）</legend>
    <p class="direction-hint">
      选择已有方向，或新建自己的文件夹。最多选 {{ MAX_NOTE_DIRECTIONS }} 个。
    </p>
    <div v-if="options.length" class="direction-choices">
      <label v-for="name in options" :key="name" class="direction-choice">
        <input
          type="checkbox"
          :checked="isSelected(name)"
          :disabled="
            !isSelected(name) && selected.length >= MAX_NOTE_DIRECTIONS
          "
          @change="toggle(name, ($event.target as HTMLInputElement).checked)"
        />
        <span>{{ name }}</span>
      </label>
    </div>
    <p v-else class="direction-hint">
      还没有研究方向，可以新建，也可以留空自动归类。
    </p>
    <DirectionCreateForm v-if="canCreate" :create="create" @created="created" />
    <div class="direction-mode" role="status">
      <template v-if="selected.length"
        >已手动选择 {{ selected.length }} 个方向，发布时保留你的选择。</template
      >
      <template v-else
        >未选择方向：提交后由大模型自动归类，优先使用已有方向。</template
      >
      <button
        v-if="selected.length"
        type="button"
        class="text-link"
        @click="selected = []"
      >
        清空，改为自动归类
      </button>
    </div>
  </fieldset>
</template>
<style scoped>
.direction-picker {
  min-width: 0;
  padding: 16px;
  margin: 0 0 22px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.direction-picker legend {
  font-weight: 600;
  padding: 0 5px;
}
.direction-hint {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
  margin: 0 0 12px;
}
.direction-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  max-height: 240px;
  overflow: auto;
}
.direction-choice {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-size: 13px;
  max-width: 100%;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.direction-choice input {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin: 1px 0 0;
  accent-color: var(--green);
}
.direction-mode {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  margin-top: 12px;
}
</style>
