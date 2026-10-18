<script setup lang="ts">
import { BookOpen, Plus, Github, LogOut, Pencil } from "lucide-vue-next";
import type { Session, SiteConfig } from "../../shared/note";
defineProps<{
  config: SiteConfig;
  user: Session | null;
  view: string;
  pendingReviews?: number;
}>();
defineEmits<{
  navigate: [view: string];
  create: [];
  login: [];
  logout: [];
  setup: [];
  profile: [];
}>();
</script>
<template>
  <header class="app-header">
    <div class="header-inner">
      <a href="#" class="brand" @click.prevent="$emit('navigate', 'library')"
        ><BookOpen :size="23" /><span>{{ config.title }}</span></a
      >
      <nav class="primary-nav" aria-label="主导航">
        <a
          href="#"
          :class="{ active: ['library', 'reader', 'catalog'].includes(view) }"
          @click.prevent="$emit('navigate', 'library')"
          >论文库</a
        ><a
          href="#collect"
          :class="{ active: view === 'collect' }"
          @click.prevent="$emit('navigate', 'collect')"
          >按标题收录</a
        ><a
          v-if="user"
          href="#reviews"
          :class="{ active: view === 'reviews' }"
          @click.prevent="$emit('navigate', 'reviews')"
          >我的提交<span v-if="pendingReviews" class="pending-count">{{
            pendingReviews
          }}</span></a
        ><a
          v-if="config.repository"
          :href="`https://github.com/${config.repository}`"
          target="_blank"
          rel="noopener"
          >转到 GitHub</a
        ><a
          href="#guide"
          :class="{ active: view === 'guide' }"
          @click.prevent="$emit('navigate', 'guide')"
          >使用指南</a
        >
      </nav>
      <div class="header-actions">
        <span v-if="!config.configured" class="demo-badge">本地体验版</span
        ><template v-if="user"
          ><button
            class="account"
            aria-label="设置昵称"
            :title="`设置昵称 · @${user.login}`"
            @click="$emit('profile')"
          >
            <img v-if="user.avatar" :src="user.avatar" alt="" /><span
              class="account-name"
              >{{ user.name || user.login }}</span
            ><Pencil :size="12" class="account-pencil" /></button
          ><button
            class="icon-button"
            aria-label="退出登录"
            @click="$emit('logout')"
          >
            <LogOut :size="17" /></button></template
        ><button
          v-else
          class="button ghost login-button"
          @click="$emit('login')"
        >
          <Github :size="17" /> GitHub 登录</button
        ><button class="button primary header-create" @click="$emit('create')">
          <Plus :size="16" />上传笔记
        </button>
      </div>
    </div>
  </header>
</template>
<style scoped>
.account {
  padding: 0;
  min-height: 32px;
}
.account-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-pencil {
  flex-shrink: 0;
}
.pending-count {
  margin-left: 6px;
  padding: 1px 5px;
  background: #eaf0f7;
  color: var(--green);
  border-radius: 2px;
  font-size: 13px;
}
@media (max-width: 1100px) {
  .header-inner {
    flex-wrap: wrap;
    padding-top: 12px;
    padding-bottom: 12px;
  }
  .primary-nav {
    order: 3;
    width: 100%;
    height: auto;
    min-height: 32px;
    flex-wrap: wrap;
    gap: 6px 20px;
  }
  .primary-nav a {
    height: auto;
    min-height: 32px;
    white-space: nowrap;
  }
}
</style>
