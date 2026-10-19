<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { Copy, Plus, Link2Off } from "lucide-vue-next";
import type { SiteInvitation } from "../../shared/members";
const props = defineProps<{
  invitation: SiteInvitation | null;
  configured: boolean;
  busy: boolean;
}>();
defineEmits<{ create: []; revoke: [] }>();
const copied = shallowRef(false),
  copyError = shallowRef("");
const valid = computed(
  () =>
    !!props.invitation &&
    Date.parse(props.invitation.expiresAt) > Date.now() &&
    props.invitation.uses < props.invitation.maxUses,
);
watch(
  () => props.invitation?.url,
  () => {
    copied.value = false;
    copyError.value = "";
  },
);
async function copy() {
  if (!props.invitation || !valid.value) return;
  try {
    await navigator.clipboard.writeText(props.invitation.url);
    copied.value = true;
    copyError.value = "";
  } catch {
    copyError.value = "复制失败，请选中上面的链接手动复制。";
  }
}
</script>
<template>
  <section class="invitation-panel">
    <h2>邀请组员</h2>
    <p v-if="!configured" class="alert error" role="alert">
      邀请功能尚未启用，需要维护者完成后台 GitHub 授权配置。
    </p>
    <template v-if="invitation">
      <label class="field"
        >邀请链接<input
          :value="invitation.url"
          readonly
          aria-label="邀请链接"
          @focus="($event.target as HTMLInputElement).select()"
      /></label>
      <p class="invitation-details">
        {{
          new Date(invitation.expiresAt).toLocaleString("zh-CN", {
            hour12: false,
          })
        }}
        到期 · 已加入 {{ invitation.uses }} / {{ invitation.maxUses }} 人
      </p>
      <div class="invitation-actions">
        <button class="button primary" :disabled="!valid" @click="copy">
          <Copy :size="16" />{{
            !valid ? "链接已失效" : copied ? "已复制" : "复制邀请链接"
          }}
        </button>
        <button
          class="button secondary"
          :disabled="busy || !configured"
          title="生成新链接后，旧链接立即失效"
          @click="$emit('create')"
        >
          更换链接
        </button>
        <button class="button ghost" :disabled="busy" @click="$emit('revoke')">
          <Link2Off :size="16" />停用链接
        </button>
      </div>
    </template>
    <button
      v-else
      class="button primary"
      :disabled="busy || !configured"
      @click="$emit('create')"
    >
      <Plus :size="16" />生成邀请链接
    </button>
    <p v-if="copyError" class="alert error" role="alert">{{ copyError }}</p>
    <p class="invitation-details">
      发给组员，使用 GitHub 登录后自动加入。新链接有效期7天，最多加入50人。
    </p>
  </section>
</template>
<style scoped>
.invitation-panel {
  padding: 24px 0 30px;
  border-bottom: 1px solid var(--border);
}
h2 {
  font-size: 21px;
  margin-bottom: 18px;
}
.invitation-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.invitation-details {
  color: var(--muted);
  line-height: 1.7;
  margin: 12px 0;
  font-size: 14px;
}
</style>
