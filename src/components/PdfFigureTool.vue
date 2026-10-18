<script setup lang="ts">
import { shallowRef } from "vue";
import { pdfPageImage } from "../services/pdfPage";
const props = defineProps<{ file: File; busy: boolean }>();
defineEmits<{ image: [value: { file: File; caption: string }]; close: [] }>();
const pageNumber = shallowRef(1);
const renderedPage = shallowRef(0);
const result = shallowRef<Awaited<ReturnType<typeof pdfPageImage>> | null>(
  null,
);
const error = shallowRef("");
const loading = shallowRef(false);
const caption = shallowRef("");
async function preview() {
  loading.value = true;
  error.value = "";
  result.value = null;
  try {
    result.value = await pdfPageImage(props.file, pageNumber.value);
    renderedPage.value = pageNumber.value;
    caption.value = `原文第 ${pageNumber.value} 页，来源：${props.file.name}`;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
</script>
<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <section
      class="pdf-figure-dialog"
      role="dialog"
      aria-label="PDF 选页插图"
      aria-modal="true"
    >
      <h2>PDF 选页插图</h2>
      <div class="pdf-page-controls">
        <label
          >页码
          <input
            v-model.number="pageNumber"
            type="number"
            min="1"
            :max="result?.pages || 100"
            aria-label="PDF 页码" /></label
        ><button
          type="button"
          class="button secondary"
          :disabled="loading"
          @click="preview"
        >
          {{ loading ? "正在生成…" : "预览页面" }}</button
        ><span v-if="result">共 {{ result.pages }} 页</span>
      </div>
      <p v-if="error" class="alert error">{{ error }}</p>
      <img
        v-if="result"
        :src="result.url"
        :alt="`原文第 ${renderedPage} 页`"
        class="pdf-page-image"
      /><label v-if="result" class="field"
        >图注<input v-model="caption"
      /></label>
      <div class="action-group">
        <button class="button secondary" type="button" @click="$emit('close')">
          取消</button
        ><button
          class="button primary"
          type="button"
          :disabled="!result || busy || loading"
          @click="result && $emit('image', { file: result.file, caption })"
        >
          {{ busy ? "正在插入…" : "插入本页图片" }}
        </button>
      </div>
    </section>
  </div>
</template>
