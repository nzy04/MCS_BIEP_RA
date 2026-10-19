<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";
import type { NoteSummary } from "../../shared/note";
const props = defineProps<{
  note: NoteSummary;
  remove: (note: NoteSummary) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const busy = shallowRef(false),
  error = shallowRef("");
onMounted(() => dialog.value?.showModal());
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await props.remove(props.note);
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
    class="delete-note-dialog"
    aria-labelledby="delete-note-title"
    @cancel.prevent="!busy && $emit('close')"
  >
    <h2 id="delete-note-title">删除我的笔记</h2>
    <p>确定删除“{{ note.title }}”？同篇论文的其他成员笔记会保留。</p>
    <p v-if="error" class="delete-error" role="alert">{{ error }}</p>
    <div class="delete-buttons">
      <button
        type="button"
        class="button secondary"
        :disabled="busy"
        @click="$emit('close')"
      >
        取消</button
      ><button
        type="button"
        class="button primary"
        :disabled="busy"
        @click="submit"
      >
        {{ busy ? "正在删除…" : "确认删除笔记" }}
      </button>
    </div>
  </dialog>
</template>
<style scoped>
.delete-note-dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(440px, calc(100vw - 32px));
  padding: 26px;
  background: white;
  color: inherit;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.delete-note-dialog::backdrop {
  background: #142b456b;
}
h2 {
  font-size: 20px;
  margin-bottom: 20px;
}
p {
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.delete-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
.delete-error {
  color: #b42318;
}
</style>
