<script setup lang="ts">
import { BookOpen, Plus, Github, ArrowUpRight, LogOut } from "lucide-vue-next";
import type { Session, SiteConfig } from "../../shared/note";
defineProps<{ config: SiteConfig; user: Session | null; view: string }>();
defineEmits<{
  navigate: [view: string];
  create: [];
  login: [];
  logout: [];
  setup: [];
}>();
</script>
<template>
  <header class="app-header">
    <div class="header-inner">
      <a href="#" class="brand" @click.prevent="$emit('navigate', 'library')"
        ><span class="brand-mark"><BookOpen :size="23" /></span
        ><span>{{ config.title }}<small>PAPER COMMONS</small></span></a
      >
      <nav class="primary-nav" aria-label="主导航">
        <a
          href="#"
          :class="{ active: view === 'library' || view === 'reader' }"
          @click.prevent="$emit('navigate', 'library')"
          >论文库</a
        ><a
          href="#import"
          :class="{ active: view === 'import' }"
          @click.prevent="$emit('create')"
          >贡献笔记</a
        ><a
          v-if="config.repository"
          :href="`https://github.com/${config.repository}`"
          target="_blank"
          rel="noopener"
          >GitHub <ArrowUpRight :size="13"
        /></a>
      </nav>
      <div class="header-actions">
        <span v-if="!config.configured" class="demo-badge">本地体验版</span
        ><template v-if="user"
          ><span class="account"
            ><img :src="user.avatar" alt="" />{{
              user.name || user.login
            }}</span
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
