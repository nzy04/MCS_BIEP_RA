<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { structureText, type Note, type NoteAsset } from "../../shared/note";
import { noteBody } from "../../shared/document";
import PaperMetadataEditor from "./PaperMetadataEditor.vue";
import NoteBodyEditor from "./NoteBodyEditor.vue";
import DirectionPicker from "./DirectionPicker.vue";
const note = defineModel<Note>({ required: true });

defineProps<{
  authorLocked?: boolean;
  assetBase: string;
  paperFile: File | null;
  addImage: (file: File) => Promise<NoteAsset | null>;
  directions: string[];
  canCreateDirection: boolean;
  createDirection: (name: string) => Promise<string>;
}>();
defineEmits<{ removeAsset: [path: string] }>();
const metadataOpen = shallowRef(!note.value.title);
const body = computed({
  get: () => noteBody(note.value),
  set: (value: string) => {
    note.value.body = value;
    note.value.sections = structureText(value).sections;
  },
});
</script>
<template>
  <div class="template-editor document-template">
    <label class="field note-title-field"
      >笔记标题<input
        v-model="note.title"
        maxlength="250"
        placeholder="论文标题或阅读主题"
        required
    /></label>
    <DirectionPicker
      v-model="note.tags"
      :options="directions"
      :can-create="canCreateDirection"
      :create="createDirection"
    />
    <details
      :open="metadataOpen"
      class="metadata-panel"
      @toggle="metadataOpen = ($event.target as HTMLDetailsElement).open"
    >
      <summary>论文信息</summary>
      <PaperMetadataEditor v-model="note" :author-locked="authorLocked" />
    </details>
    <NoteBodyEditor
      v-model="body"
      :assets="note.assets"
      :asset-base="assetBase"
      :paper-file="paperFile"
      :add-image="addImage"
      @remove-asset="$emit('removeAsset', $event)"
    />
  </div>
</template>
