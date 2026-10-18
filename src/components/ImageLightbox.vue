<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue";
const props = defineProps<{ image: { src: string; alt: string } | null }>();
const emit = defineEmits<{ close: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
watch(
  () => props.image,
  async (value) => {
    await nextTick();
    if (value && !dialog.value?.open) dialog.value?.showModal();
    else if (!value && dialog.value?.open) dialog.value?.close();
  },
);
</script>
<template>
  <dialog
    ref="dialog"
    class="image-lightbox"
    aria-label="查看原图"
    @close="emit('close')"
    @click="$event.target === dialog && dialog?.close()"
  >
    <template v-if="image"
      ><header>
        <span>{{ image.alt }}</span
        ><a :href="image.src" target="_blank" rel="noopener">打开原图</a
        ><button
          type="button"
          class="button secondary small"
          autofocus
          @click="dialog?.close()"
        >
          关闭
        </button>
      </header>
      <img :src="image.src" :alt="image.alt"
    /></template>
  </dialog>
</template>
