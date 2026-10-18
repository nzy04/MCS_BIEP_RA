<script setup lang="ts">
import { Search, RefreshCw, LayoutGrid, List } from "lucide-vue-next";
const query = defineModel<string>("query", { required: true });
const sort = defineModel<string>("sort", { required: true });
const layout = defineModel<string>("layout", { required: true });
defineEmits<{ refresh: [] }>();
</script>
<template>
  <div class="search-toolbar">
    <label class="search-field"
      ><Search :size="18" /><input
        v-model="query"
        placeholder="搜索标题、标签或作者"
        aria-label="搜索论文"
    /></label>
    <select v-model="sort" aria-label="排序方式">
      <option value="recent">最近更新</option>
      <option value="year">发表年份</option>
    </select>
    <div class="view-toggle" aria-label="显示方式">
      <button
        :class="{ chosen: layout === 'list' }"
        :aria-pressed="layout === 'list'"
        aria-label="列表视图"
        title="列表视图"
        @click="layout = 'list'"
      >
        <List :size="18" />
      </button>
      <button
        :class="{ chosen: layout === 'grid' }"
        :aria-pressed="layout === 'grid'"
        aria-label="卡片视图"
        title="卡片视图"
        @click="layout = 'grid'"
      >
        <LayoutGrid :size="17" />
      </button>
    </div>
    <button
      class="button secondary refresh-button"
      aria-label="刷新论文库"
      @click="$emit('refresh')"
    >
      <RefreshCw :size="16" />刷新
    </button>
  </div>
</template>
