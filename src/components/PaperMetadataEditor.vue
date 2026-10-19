<script setup lang="ts">
import type { Note } from "../../shared/note";
import type { ReviewIssue } from "../../shared/review";
import { aiSupplement } from "../../shared/ai";
import AiBadge from "./AiBadge.vue";
const props = withDefaults(
  defineProps<{ authorLocked?: boolean; issues?: ReviewIssue[] }>(),
  { issues: () => [] },
);
const invalid = (field: string) =>
  props.issues.some((i) => i.field === field) || undefined;
const note = defineModel<Note>({ required: true });
</script>
<template>
  <div class="metadata-fields">
    <label class="field"
      >中文说明<input v-model="note.subtitle" placeholder="中文标题或简述"
    /></label>
    <div class="field-grid">
      <label class="field"
        >分享人<input
          v-model="note.author"
          :readonly="authorLocked"
          :title="authorLocked ? '在右上角账号中设置昵称' : undefined" /></label
      ><label class="field"
        >阅读深度<select v-model="note.readingDepth">
          <option>阅读笔记</option>
          <option>概览</option>
          <option>精读</option>
          <option>已复现</option>
        </select></label
      ><label class="field"
        >会议 / 期刊<input
          v-model="note.venue"
          aria-label="会议 / 期刊"
          data-review-field="venue"
          :aria-invalid="invalid('venue')"
          placeholder="如 ICLR / arXiv" /><AiBadge
          v-if="aiSupplement(note, 'venue')" /></label
      ><label class="field"
        >发表年份<input
          v-model="note.year"
          aria-label="发表年份"
          data-review-field="year"
          :aria-invalid="invalid('year')"
          inputmode="numeric"
          maxlength="4" /><AiBadge v-if="aiSupplement(note, 'year')"
      /></label>
    </div>
    <label class="field"
      >论文链接<input
        v-model="note.paperUrl"
        aria-label="论文链接"
        data-review-field="paperUrl"
        :aria-invalid="invalid('paperUrl')"
        type="url"
        placeholder="https://…" /><AiBadge
        v-if="aiSupplement(note, 'paperUrl')" /></label
    ><label class="field"
      >PDF 下载链接<input
        v-model="note.pdfUrl"
        aria-label="PDF 下载链接"
        data-review-field="pdfUrl"
        :aria-invalid="invalid('pdfUrl')"
        type="url"
        placeholder="留空：提交后自动检索补充" /><AiBadge
        v-if="aiSupplement(note, 'pdfUrl')" /></label
    ><label class="field"
      >代码链接<input
        v-model="note.codeUrl"
        type="url"
        placeholder="https://…（可选）"
    /></label>
  </div>
</template>
<style scoped>
.field {
  position: relative;
}
.field > .ai-badge {
  position: absolute;
  top: 0;
  right: 0;
}
</style>
