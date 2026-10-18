<script setup lang="ts">
import { computed } from "vue";
import type { Note } from "../../shared/note";
defineProps<{ authorLocked?: boolean }>();
const note = defineModel<Note>({ required: true });
const tags = computed({
  get: () => note.value.tags.join("，"),
  set: (value: string) => {
    note.value.tags = value
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
  },
});
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
          placeholder="如 ICLR / arXiv" /></label
      ><label class="field"
        >发表年份<input v-model="note.year" inputmode="numeric" maxlength="4"
      /></label>
    </div>
    <label class="field"
      >方向标签<input v-model="tags" placeholder="用逗号分隔" /></label
    ><label class="field"
      >论文链接<input
        v-model="note.paperUrl"
        type="url"
        placeholder="https://…" /></label
    ><label class="field"
      >代码链接<input
        v-model="note.codeUrl"
        type="url"
        placeholder="https://…（可选）"
    /></label>
  </div>
</template>
