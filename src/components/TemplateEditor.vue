<script setup lang="ts">
import { computed } from "vue";
import { ImagePlus } from "lucide-vue-next";
import { sectionDefinitions, type Note } from "../../shared/note";
const note = defineModel<Note>({ required: true });
defineEmits<{ image: [file: File] }>();
const tags = computed({
  get: () => note.value.tags.join("，"),
  set: (v: string) =>
    (note.value.tags = v
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8)),
});
</script>
<template>
  <div class="template-editor">
    <div class="editor-section-label">基本信息</div>
    <label class="field"
      >笔记标题 <span>*</span
      ><input
        v-model="note.title"
        placeholder="论文标题，或你的阅读主题"
        maxlength="250" /></label
    ><label class="field"
      >中文说明<input
        v-model="note.subtitle"
        placeholder="用一句话说明这篇论文与你的研究有什么关系"
    /></label>
    <div class="field-grid">
      <label class="field"
        >分享人<input v-model="note.author" placeholder="你的名字" /></label
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
        >发表年份<input
          v-model="note.year"
          placeholder="如 2026"
          inputmode="numeric"
          maxlength="4"
      /></label>
    </div>
    <label class="field"
      >方向标签<input
        v-model="tags"
        placeholder="用逗号分隔，如 世界模型，具身智能" /></label
    ><label class="field"
      >论文链接<input
        v-model="note.paperUrl"
        placeholder="https://arxiv.org/abs/…"
        type="url" /></label
    ><label class="field"
      >代码链接<input
        v-model="note.codeUrl"
        placeholder="https://github.com/…（可选）"
        type="url"
    /></label>
    <div class="editor-section-label section-divider">
      阅读笔记
      <label class="text-link image-upload"
        ><ImagePlus :size="16" />添加插图<input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          @change="
            ($event.target as HTMLInputElement).files?.[0] &&
            $emit('image', ($event.target as HTMLInputElement).files![0])
          "
      /></label>
    </div>
    <p class="field-hint">
      支持 Markdown。没有写到的部分可以留空；其他原始内容会完整保留。
    </p>
    <label
      v-for="section in sectionDefinitions"
      :key="section.key"
      class="field section-field"
      >{{ section.label
      }}<textarea
        v-model="note.sections[section.key]"
        :rows="section.key === 'original' ? 8 : 4"
        :placeholder="
          section.key === 'original'
            ? '尚未归入模板的笔记会出现在这里，可保留或移动到上方章节。'
            : '写下你已经确认的理解、证据或问题…'
        "
      />
    </label>
  </div>
</template>
