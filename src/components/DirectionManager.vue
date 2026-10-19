<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef } from "vue";
import type { NoteSummary } from "../../shared/note";
import { directionKey, type DirectionChange } from "../../shared/directions";
import DirectionCreateForm from "./DirectionCreateForm.vue";
import DirectionManageRow from "./DirectionManageRow.vue";
const props = defineProps<{
  directions: string[];
  notes: NoteSummary[];
  create: (name: string) => Promise<string>;
  change: (change: DirectionChange) => Promise<void>;
}>();
defineEmits<{ close: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const query = shallowRef("");
const action = shallowRef<DirectionChange | null>(null);
const replacement = shallowRef("");
const busy = shallowRef(false),
  error = shallowRef("");
const filtered = computed(() =>
  props.directions
    .filter((n) => directionKey(n).includes(directionKey(query.value)))
    .sort((a, b) => a.localeCompare(b, "zh-CN")),
);
const counts = computed(
  () =>
    new Map(
      props.directions.map((name) => [
        name,
        props.notes.filter((n) =>
          n.tags.some((t) => directionKey(t) === directionKey(name)),
        ).length,
      ]),
    ),
);
function choose(name: string, remove: boolean) {
  action.value = { name, replacement: remove ? null : name };
  replacement.value = name;
  error.value = "";
}
async function submit() {
  if (!action.value || busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await props.change({
      ...action.value,
      replacement: action.value.replacement === null ? null : replacement.value,
    });
    action.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog
    ref="dialog"
    class="direction-manager"
    aria-labelledby="direction-manager-title"
    @cancel.prevent="!busy && $emit('close')"
    @click="$event.target === dialog && !busy && $emit('close')"
  >
    <header class="manager-header">
      <h2 id="direction-manager-title">管理研究方向</h2>
      <button
        type="button"
        class="button ghost small"
        :disabled="busy"
        @click="$emit('close')"
      >
        关闭
      </button>
    </header>
    <form v-if="action" @submit.prevent="submit">
      <h3>
        {{ action.replacement === null ? "删除" : "重命名" }}研究方向“{{
          action.name
        }}”
      </h3>
      <p v-if="action.replacement === null" class="delete-description">
        影响
        {{
          counts.get(action.name) || 0
        }}
        份笔记。笔记和图片全部保留；没有其他方向的笔记归入“未分类”。
      </p>
      <label v-else class="field"
        >新方向名称<input
          v-model="replacement"
          maxlength="50"
          :disabled="busy"
          required
      /></label>
      <p v-if="error" role="alert" class="direction-error">{{ error }}</p>
      <div class="manager-actions">
        <button
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="action = null"
        >
          取消</button
        ><button type="submit" class="button primary" :disabled="busy">
          {{
            busy
              ? "正在同步…"
              : action.replacement === null
                ? "确认删除方向"
                : "保存名称"
          }}
        </button>
      </div>
    </form>
    <template v-else>
      <label class="field"
        >搜索研究方向<input
          v-model="query"
          type="search"
          placeholder="输入方向名称"
      /></label>
      <DirectionCreateForm :create="create" />
      <ul class="direction-manage-list">
        <DirectionManageRow
          v-for="name in filtered"
          :key="name"
          :name="name"
          :count="counts.get(name) || 0"
          :disabled="busy"
          @rename="choose(name, false)"
          @remove="choose(name, true)"
        />
      </ul>
      <p v-if="!filtered.length" class="empty-directions">
        {{ directions.length ? "没有匹配的研究方向" : "暂无研究方向" }}
      </p>
    </template>
  </dialog>
</template>
<style scoped>
.direction-manager {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(600px, calc(100vw - 32px));
  max-height: 85vh;
  overflow: auto;
  background: white;
  color: inherit;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 24px;
}
.direction-manager::backdrop {
  background: #142b456b;
}
.manager-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 22px;
}
.manager-header h2 {
  margin: 0;
  font-size: 21px;
}
.direction-manager h3 {
  font-size: 16px;
  margin: 0 0 18px;
  overflow-wrap: anywhere;
}
.direction-manage-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.manager-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
.delete-description {
  font-size: 14px;
  line-height: 1.8;
  color: var(--muted);
}
.direction-error {
  color: #b42318;
  margin-top: 12px;
}
.empty-directions {
  color: var(--muted);
  padding: 24px 0;
  text-align: center;
}
</style>
