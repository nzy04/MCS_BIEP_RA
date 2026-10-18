<script setup lang="ts">
import { X, Github, CheckCircle2, ExternalLink } from "lucide-vue-next";
defineEmits<{ close: [] }>();
</script>
<template>
  <div class="modal-backdrop" @click.self="$emit('close')">
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-title"
      class="setup-dialog"
    >
      <button
        class="icon-button close-button"
        aria-label="关闭"
        @click="$emit('close')"
      >
        <X :size="20" /></button
      ><span class="setup-icon"><Github :size="27" /></span>
      <h2 id="setup-title">连接课题组仓库</h2>
      <p>
        当前是本地体验版。文件解析、模板编辑和本机保存已可使用，GitHub
        登录还需要维护者完成首次配置。
      </p>
      <ol class="setup-checklist">
        <li>
          <CheckCircle2 :size="18" />
          <div>
            <strong>创建 MCS_BIEP_RA 仓库</strong
            ><span>将网站源码上传到公开仓库，邀请组员加入。</span>
          </div>
        </li>
        <li>
          <CheckCircle2 :size="18" />
          <div>
            <strong>配置 GitHub App</strong
            ><span>仅允许访问课题组仓库，并配置登录回调。</span>
          </div>
        </li>
        <li>
          <CheckCircle2 :size="18" />
          <div>
            <strong>部署免费托管与授权接口</strong
            ><span
              >将应用密钥设置到 Cloudflare
              服务端，网站不会要求成员粘贴密钥。</span
            >
          </div>
        </li>
      </ol>
      <div class="setup-bottom">
        <span>无需付费域名或常驻服务器。</span
        ><button class="button primary" @click="$emit('close')">
          先体验本地功能
        </button>
      </div>
    </section>
  </div>
</template>
