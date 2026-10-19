<script setup lang="ts">
import { computed, shallowRef, nextTick, useTemplateRef } from "vue";
import { structureText, type Note, type NoteAsset } from "../../shared/note";
import { noteBody } from "../../shared/document";
import PaperMetadataEditor from "./PaperMetadataEditor.vue";
import NoteBodyEditor from "./NoteBodyEditor.vue";
import DirectionPicker from "./DirectionPicker.vue";
import ReviewFeedback from "./ReviewFeedback.vue";
import type { ReviewIssue } from "../../shared/review";
const note = defineModel<Note>({ required: true });

const props = defineProps<{
  authorLocked?: boolean;
  assetBase: string;
  paperFile: File | null;
  addImage: (file: File) => Promise<NoteAsset | null>;
  directions: string[];
  canCreateDirection: boolean;
  issues: ReviewIssue[];
}>();
defineEmits<{
  removeAsset: [path: string];
  directionContext: [event: MouseEvent, name: string | null];
}>();
const metadataOpen = shallowRef(
  !note.value.title ||
    props.issues.some((i) =>
      ["paperUrl", "pdfUrl", "year", "venue"].includes(i.field),
    ),
);
const root = useTemplateRef<HTMLElement>("root");
const bodyEditor = useTemplateRef<{
  focusIssue: (index: number) => Promise<void>;
}>("bodyEditor");
async function locate(issue: ReviewIssue, index: number) {
  if (
    ["title", "paperUrl", "pdfUrl", "year", "venue", "tags"].includes(
      issue.field,
    )
  ) {
    metadataOpen.value = true;
    await nextTick();
    const target = root.value?.querySelector<HTMLElement>(
      `[data-review-field="${CSS.escape(issue.field)}"]`,
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.focus();
  } else await bodyEditor.value?.focusIssue(index);
}
const body = computed({
  get: () => noteBody(note.value),
  set: (value: string) => {
    note.value.body = value;
    note.value.sections = structureText(value).sections;
  },
});
</script>
<template>
  <div ref="root" class="template-editor document-template">
    <ReviewFeedback :issues="issues" @locate="locate" />
    <label class="field note-title-field"
      >笔记标题<input
        v-model="note.title"
        aria-label="笔记标题"
        data-review-field="title"
        :aria-invalid="issues.some((i) => i.field === 'title') || undefined"
        maxlength="250"
        placeholder="论文标题或阅读主题"
        required
    /></label>
    <DirectionPicker
      v-model="note.tags"
      :options="directions"
      :can-create="canCreateDirection"
      :aria-invalid="issues.some((i) => i.field === 'tags') || undefined"
      data-review-field="tags"
      @context="(event, name) => $emit('directionContext', event, name)"
    />
    <details
      :open="metadataOpen"
      class="metadata-panel"
      @toggle="metadataOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary>论文信息</summary>
      <PaperMetadataEditor
        v-model="note"
        :author-locked="authorLocked"
        :issues="issues"
      />
    </details>
    <NoteBodyEditor
      ref="bodyEditor"
      v-model="body"
      :assets="note.assets"
      :asset-base="assetBase"
      :paper-file="paperFile"
      :add-image="addImage"
      :issues="issues"
      @remove-asset="$emit('removeAsset', $event)"
    />
  </div>
</template>
