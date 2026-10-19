<script setup lang="ts">
defineProps<{ name: string; count: number; disabled: boolean }>();
defineEmits<{ rename: []; remove: [] }>();
</script>
<template>
  <li class="direction-manage-row">
    <span class="direction-label"
      >{{ name }} <span class="direction-count">{{ count }} 份笔记</span></span
    >
    <div class="direction-row-actions">
      <button
        type="button"
        class="text-link"
        :disabled="disabled"
        :aria-label="`重命名“${name}”`"
        @click="$emit('rename')"
      >
        重命名
      </button>
      <button
        type="button"
        class="text-link danger"
        :disabled="disabled"
        :aria-label="`删除“${name}”`"
        @click="$emit('remove')"
      >
        删除
      </button>
    </div>
  </li>
</template>
<style scoped>
.direction-manage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}
.direction-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.direction-count {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-top: 5px;
}
.direction-row-actions {
  display: flex;
  gap: 14px;
  flex-shrink: 0;
}
.danger {
  color: #b42318;
}
</style>
