<script setup lang="ts">
import { shallowRef } from "vue";
import { FolderPlus } from "lucide-vue-next";
const props = defineProps<{ create: (name: string) => Promise<string> }>();
const emit = defineEmits<{ created: [name: string] }>();
const open = shallowRef(false),
  name = shallowRef(""),
  busy = shallowRef(false),
  error = shallowRef("");
async function submit() {
  if (busy.value) return;
  error.value = "";
  busy.value = true;
  try {
    const created = await props.create(name.value);
    name.value = "";
    open.value = false;
    emit("created", created);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="direction-create">
    <button
      v-if="!open"
      type="button"
      class="text-link"
      :aria-expanded="false"
      @click="open = true"
    >
      <FolderPlus :size="15" />新建研究方向
    </button>
    <form v-else class="direction-form" @submit.prevent="submit">
      <label class="field"
        >新研究方向<input
          v-model="name"
          placeholder="自定义文件夹名称"
          maxlength="50"
          :disabled="busy"
          required
      /></label>
      <p v-if="error" class="direction-error" role="alert">{{ error }}</p>
      <div class="direction-actions">
        <button class="button primary small" type="submit" :disabled="busy">
          {{ busy ? "正在创建…" : "创建方向" }}
        </button>
        <button
          class="button ghost small"
          type="button"
          :disabled="busy"
          @click="
            open = false;
            error = '';
          "
        >
          取消
        </button>
      </div>
    </form>
  </div>
</template>
<style scoped>
.direction-create {
  margin: 14px 0;
  min-width: 0;
}
.direction-form {
  width: 100%;
  min-width: 0;
}
.direction-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.direction-error {
  color: #b42318;
  font-size: 12px;
  line-height: 1.5;
  margin-top: 8px;
}
.direction-create :deep(.field) {
  font-size: 13px;
}
.direction-create :deep(.field input) {
  min-width: 0;
  width: 100%;
}
</style>
