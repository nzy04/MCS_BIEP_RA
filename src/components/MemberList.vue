<script setup lang="ts">
import { shallowRef } from "vue";
import type { SiteMember } from "../../shared/members";
defineProps<{ members: SiteMember[]; busy: boolean }>();
defineEmits<{ change: [id: number, active: boolean] }>();
const confirming = shallowRef<number | null>(null);
</script>
<template>
  <section class="member-list">
    <h2>组员</h2>
    <p v-if="!members.length" class="empty-members">
      暂无组员，将邀请链接发给组员即可加入。
    </p>
    <article v-for="member in members" :key="member.id" class="member-row">
      <div>
        <strong>{{ member.name || member.login }}</strong
        ><span class="member-login">@{{ member.login }}</span
        ><span v-if="!member.active" class="member-inactive">已移除</span>
      </div>
      <div class="member-actions">
        <template v-if="confirming === member.id && member.active">
          <span>移除后不能再上传，已发布笔记保留。</span>
          <button
            class="button secondary small"
            :disabled="busy"
            @click="confirming = null"
          >
            取消
          </button>
          <button
            class="button secondary small member-remove"
            :disabled="busy"
            @click="
              $emit('change', member.id, false);
              confirming = null;
            "
          >
            确认移除
          </button>
        </template>
        <button
          v-else-if="member.active"
          class="text-link member-remove"
          :disabled="busy"
          @click="confirming = member.id"
        >
          移除
        </button>
        <button
          v-else
          class="text-link"
          :disabled="busy"
          @click="$emit('change', member.id, true)"
        >
          恢复资格
        </button>
      </div>
    </article>
  </section>
</template>
<style scoped>
.member-list {
  padding-top: 28px;
}
h2 {
  font-size: 21px;
  margin-bottom: 18px;
}
.member-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  padding: 19px 0;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.member-login,
.member-inactive {
  margin-left: 12px;
  color: var(--muted);
  font-size: 14px;
}
.member-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 14px;
}
.member-remove {
  color: #b42318;
}
.empty-members {
  color: var(--muted);
  line-height: 1.8;
}
</style>
