<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";
import { X } from "lucide-vue-next";
import type { Session } from "../../shared/note";
const props = defineProps<{ user: Session; save: (nickname: string) => Promise<void> }>();
const emit = defineEmits<{ close: [] }>();
const nickname = shallowRef(props.user.nickname || "");
const saving = shallowRef(false);
const error = shallowRef("");
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
onMounted(() => dialog.value?.showModal());
function close() { if (!saving.value) emit("close"); }
async function submit() {
  error.value = "";
  saving.value = true;
  try {
    await props.save(nickname.value);
    emit("close");
  } catch (e) { error.value = (e as Error).message; }
  finally { saving.value = false; }
}
</script>
<template>
  <dialog ref="dialog" class="profile-dialog" aria-labelledby="profile-title" @cancel.prevent="close" @click="($event.target === dialog) && close()">
    <form @submit.prevent="submit">
      <button type="button" class="icon-button close-button" aria-label="关闭昵称设置" :disabled="saving" @click="close"><X :size="20" /></button>
      <h2 id="profile-title">设置昵称</h2>
      <p class="profile-account">GitHub：@{{ user.login }}</p>
      <label class="field">昵称<input v-model="nickname" maxlength="40" autofocus :disabled="saving" :placeholder="user.githubName || user.login" /></label>
      <p class="profile-help">留空时使用 GitHub 名称。保存后，你之前上传的所有笔记也会使用这个名字。</p>
      <p v-if="error" class="profile-error" role="alert">{{ error }}</p>
      <div class="profile-actions">
        <button type="button" class="button ghost" :disabled="saving" @click="nickname = ''">使用 GitHub 名称</button>
        <button class="button primary" type="submit" :disabled="saving">{{ saving ? "正在同步署名…" : "保存昵称" }}</button>
      </div>
    </form>
  </dialog>
</template>
<style scoped>
.profile-dialog { position: fixed; inset: 0; margin: auto; width: min(480px, calc(100% - 32px)); max-height: 90vh; overflow: auto; border: 1px solid var(--border); border-radius: 6px; padding: 32px; color: inherit; background: white; }
.profile-dialog::backdrop { background: #142b456b; }
.profile-dialog h2 { margin: 0 0 10px; font-size: 22px; }
.profile-account, .profile-help { color: var(--muted); font-size: 13px; line-height: 1.7; margin-bottom: 20px; overflow-wrap: anywhere; }
.profile-help { margin-top: 12px; }
.profile-error { color: #b42318; font-size: 14px; margin-bottom: 16px; }
.profile-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; }
</style>
