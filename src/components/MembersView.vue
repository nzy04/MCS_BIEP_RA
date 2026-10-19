<script setup lang="ts">
import { useMembers } from "../composables/useMembers";
import InvitationPanel from "./InvitationPanel.vue";
import MemberList from "./MemberList.vue";
const members = useMembers();
</script>
<template>
  <main class="page-container members-main">
    <div class="members-heading">
      <h1>组员管理</h1>
      <button
        class="button secondary"
        :disabled="members.loading.value || members.busy.value"
        @click="members.refresh"
      >
        刷新
      </button>
    </div>
    <p v-if="members.error.value" class="alert error" role="alert">
      {{ members.error.value }}
    </p>
    <p v-if="members.loading.value" class="empty-state">正在加载…</p>
    <template v-else>
      <InvitationPanel
        :invitation="members.data.value.invitation"
        :configured="members.data.value.configured"
        :busy="members.busy.value"
        @create="members.create"
        @revoke="members.revoke"
      />
      <MemberList
        :members="members.data.value.members"
        :busy="members.busy.value"
        @change="members.change"
      />
    </template>
  </main>
</template>
<style scoped>
.members-main {
  max-width: 1060px;
}
.members-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 2px solid var(--green);
  padding-bottom: 22px;
}
h1 {
  font-size: 28px;
}
</style>
