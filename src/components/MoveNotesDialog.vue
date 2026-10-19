<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";
defineProps<{
  count: number;
  directions: string[];
  source: string | null;
  busy: boolean;
  error: string;
}>();
defineEmits<{ move: [target: string]; close: [] }>();
const target = shallowRef("");
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
onMounted(() => dialog.value?.showModal());
</script>
<template>
  <dialog
    ref="dialog"
    class="move-dialog"
    aria-labelledby="move-title"
    @cancel.prevent="!busy && $emit('close')"
    @click="$event.target === dialog && !busy && $emit('close')"
  >
    <h2 id="move-title">移动 {{ count }} 份笔记</h2>
    <p class="move-description">
      {{
        source
          ? `从“${source}”移出，保留其他方向。`
          : "将这些笔记的研究方向设为目标方向。"
      }}
    </p>
    <div class="field">
      <label for="move-target">目标研究方向</label
      ><select id="move-target" v-model="target" :disabled="busy" autofocus>
        <option disabled value="">选择研究方向</option>
        <option
          v-for="name in directions"
          :key="name"
          :value="name"
          :disabled="name === source"
        >
          {{ name }}
        </option>
      </select>
    </div>
    <p v-if="error" role="alert" class="move-error">{{ error }}</p>
    <div class="move-buttons">
      <button class="button secondary" :disabled="busy" @click="$emit('close')">
        取消</button
      ><button
        class="button primary"
        :disabled="!target || busy"
        @click="$emit('move', target)"
      >
        {{ busy ? "正在同步…" : "确认移动" }}
      </button>
    </div>
  </dialog>
</template>
<style scoped>
.move-dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  color: inherit;
  background: white;
  width: min(460px, calc(100vw - 32px));
  max-height: 90vh;
  overflow: auto;
  padding: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.move-dialog::backdrop {
  background: #142b456b;
}
.move-dialog h2 {
  margin: 0 0 12px;
  font-size: 21px;
}
.move-description {
  font-size: 14px;
  color: var(--muted);
  line-height: 1.7;
  margin-bottom: 20px;
}
.move-buttons {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
.move-error {
  color: #b42318;
  margin-top: 12px;
}
</style>
