<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";
import type { DirectionChange } from "../../shared/directions";
const props = defineProps<{
  action: { kind: "create" | "rename" | "delete"; name: string };
  count: number;
  create: (name: string) => Promise<string>;
  change: (value: DirectionChange) => Promise<void>;
}>();
const emit = defineEmits<{ close: []; created: [name: string] }>();
const name = shallowRef(
    props.action.kind === "create" ? "" : props.action.name,
  ),
  busy = shallowRef(false),
  error = shallowRef("");
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
onMounted(() => dialog.value?.showModal());
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    if (props.action.kind === "create")
      emit("created", await props.create(name.value));
    else
      await props.change({
        name: props.action.name,
        replacement: props.action.kind === "delete" ? null : name.value,
      });
    emit("close");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <dialog
    ref="dialog"
    class="action-dialog"
    aria-labelledby="direction-action-title"
    @cancel.prevent="!busy && $emit('close')"
    @click="$event.target === dialog && !busy && $emit('close')"
  >
    <h2 id="direction-action-title">
      {{
        action.kind === "create"
          ? "新建研究方向"
          : action.kind === "rename"
            ? "重命名研究方向"
            : "删除研究方向"
      }}
    </h2>
    <form @submit.prevent="submit">
      <p v-if="action.kind === 'delete'">
        删除“{{ action.name }}”？其中
        {{ count }} 份笔记全部保留，仍可在“全部文献”中找到。
      </p>
      <label v-else class="field"
        >{{ action.kind === "create" ? "新研究方向" : "新方向名称"
        }}<input
          v-model="name"
          maxlength="50"
          :disabled="busy"
          required
          autofocus
      /></label>
      <p v-if="error" class="action-error" role="alert">{{ error }}</p>
      <div class="action-buttons">
        <button
          type="button"
          class="button secondary"
          :disabled="busy"
          @click="$emit('close')"
        >
          取消</button
        ><button type="submit" class="button primary" :disabled="busy">
          {{
            busy
              ? "正在同步…"
              : action.kind === "create"
                ? "创建方向"
                : action.kind === "rename"
                  ? "保存名称"
                  : "确认删除方向"
          }}
        </button>
      </div>
    </form>
  </dialog>
</template>
<style scoped>
.action-dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(440px, calc(100vw - 32px));
  max-height: 85vh;
  overflow: auto;
  padding: 26px;
  background: white;
  color: inherit;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.action-dialog::backdrop {
  background: #142b456b;
}
h2 {
  font-size: 20px;
  margin: 0 0 22px;
}
p {
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.action-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
.action-error {
  color: #b42318;
  margin-top: 15px;
}
</style>
