<script setup lang="ts">
import { computed } from "vue";
import type { NoteAsset } from "../../shared/note";
const props = defineProps<{ assets: NoteAsset[]; assetBase: string }>();
defineEmits<{ insert: [asset: NoteAsset]; remove: [asset: NoteAsset] }>();
const images = computed(() =>
  props.assets.filter((a) => a.mime.startsWith("image/")),
);
const name = (a: NoteAsset) => a.name || a.path.split("/").pop() || "插图";
</script>
<template>
  <details v-if="images.length" class="note-assets">
    <summary>笔记图片 · {{ images.length }}</summary>
    <div class="note-asset-grid">
      <div v-for="asset in images" :key="asset.path" class="note-asset">
        <img
          :src="asset.dataUrl || `${assetBase}/${asset.path}`"
          :alt="name(asset)"
        />
        <span :title="name(asset)">{{ name(asset) }}</span>
        <div>
          <button
            type="button"
            class="text-link"
            :aria-label="`插入图片 ${name(asset)}`"
            @click="$emit('insert', asset)"
          >
            插入</button
          ><button
            type="button"
            class="text-link"
            :aria-label="`删除图片 ${name(asset)}`"
            @click="$emit('remove', asset)"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </details>
</template>
