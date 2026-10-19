<script setup lang="ts">
import { toRef } from "vue";
import { Github } from "lucide-vue-next";
import type { Session } from "../../shared/note";
import { useInvitation } from "../composables/useInvitation";
const props = defineProps<{
  token: string;
  user: Session | null;
  title: string;
}>();
const emit = defineEmits<{ joined: [user: Session]; back: [] }>();
const invite = useInvitation(
  toRef(props, "token"),
  toRef(props, "user"),
  (user) => emit("joined", user),
);
</script>
<template>
  <main class="page-container join-main">
    <h1>加入 {{ title }}</h1>
    <p class="join-intro">使用 GitHub 登录，加入后即可上传和分享阅读笔记。</p>
    <p v-if="invite.loading.value" role="status">
      {{ user ? "正在加入论文库…" : "正在验证邀请…" }}
    </p>
    <p v-if="invite.error.value" class="alert error" role="alert">
      {{ invite.error.value }}
    </p>
    <p
      v-else-if="invite.preview.value && !invite.preview.value.valid"
      class="alert error"
      role="alert"
    >
      {{ invite.preview.value.message }}
    </p>
    <div class="join-actions">
      <button
        v-if="!user && invite.preview.value?.valid"
        class="button primary"
        :disabled="invite.loading.value"
        @click="invite.login"
      >
        <Github :size="18" />使用 GitHub 加入
      </button>
      <button
        v-else-if="user && invite.error.value"
        class="button secondary"
        :disabled="invite.loading.value"
        @click="invite.retry"
      >
        重试加入
      </button>
      <button class="button secondary" @click="$emit('back')">
        浏览论文库
      </button>
    </div>
  </main>
</template>
<style scoped>
.join-main {
  max-width: 760px;
  padding-top: 64px;
}
h1 {
  font-size: 30px;
  overflow-wrap: anywhere;
}
.join-intro {
  margin: 24px 0;
  color: var(--muted);
  line-height: 1.8;
}
.join-actions {
  display: flex;
  gap: 12px;
  margin-top: 28px;
  flex-wrap: wrap;
}
</style>
