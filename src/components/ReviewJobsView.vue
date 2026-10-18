<script setup lang="ts">
import { RefreshCw, FileText } from "lucide-vue-next";
import { sectionDefinitions } from "../../shared/note";
import {
  reviewPending,
  type ReviewJobSummary,
  type ReviewStatus,
} from "../../shared/review";
defineProps<{
  jobs: ReviewJobSummary[];
  loading: boolean;
  error: string;
  signedIn: boolean;
}>();
defineEmits<{
  refresh: [];
  edit: [id: string];
  retry: [id: string];
  open: [noteId: string];
  create: [];
  login: [];
}>();
const labels: Record<ReviewStatus, string> = {
  queued: "审核中",
  reviewing: "审核中",
  publishing: "审核中",
  published: "已发布",
  needs_changes: "待修改",
  failed: "处理失败",
};
const fieldLabel = (field: string) =>
  sectionDefinitions.find((s) => s.key === field)?.label ||
  (
    {
      title: "标题",
      paperUrl: "论文来源",
      tags: "研究方向",
      year: "年份",
      venue: "会议 / 期刊",
    } as Record<string, string>
  )[field] ||
  field;
</script>
<template>
  <main class="page-container reviews-main">
    <div class="review-heading">
      <h1>我的提交</h1>
      <button
        class="button secondary"
        :disabled="loading"
        @click="$emit('refresh')"
      >
        <RefreshCw :size="16" />刷新
      </button>
    </div>
    <p v-if="error" class="alert error" role="alert">{{ error }}</p>
    <div v-if="!signedIn" class="empty-state">
      <h3>登录后查看审核结果</h3>
      <button class="button primary" @click="$emit('login')">
        GitHub 登录
      </button>
    </div>
    <div v-else-if="loading && !jobs.length" class="empty-state">正在加载…</div>
    <div v-else-if="!jobs.length" class="empty-state">
      <FileText :size="26" />
      <h3>暂无提交</h3>
      <button class="button primary" @click="$emit('create')">上传笔记</button>
    </div>
    <div v-else class="review-list">
      <article
        v-for="job in jobs"
        :key="job.id"
        class="review-item"
        :data-status="job.status"
      >
        <div class="review-item-heading">
          <h2>{{ job.title }}</h2>
          <span
            class="review-status"
            :class="{
              pending: reviewPending(job.status),
              passed: job.status === 'published',
              rejected:
                job.status === 'needs_changes' || job.status === 'failed',
            }"
            >{{
              job.kind === "paper"
                ? reviewPending(job.status)
                  ? "收录中"
                  : job.status === "published"
                    ? "已收录"
                    : labels[job.status]
                : labels[job.status]
            }}</span
          >
        </div>
        <time :datetime="job.createdAt">{{
          new Date(job.createdAt).toLocaleString("zh-CN", { hour12: false })
        }}</time>
        <p v-if="job.message" class="review-message">{{ job.message }}</p>
        <ul v-if="job.issues.length" class="review-issues">
          <li v-for="(issue, i) in job.issues" :key="i">
            <strong>{{ fieldLabel(issue.field) }}</strong
            >：{{ issue.message }}
          </li>
        </ul>
        <div v-if="job.receipt" class="review-result">
          <div class="card-tags">
            <span
              v-for="direction in job.receipt.directions"
              :key="direction"
              class="tag"
              >{{ direction }}</span
            >
          </div>
          <ul v-if="job.receipt.supplements.length" class="review-supplements">
            <li v-for="(item, i) in job.receipt.supplements" :key="i">
              补充{{ fieldLabel(item.field) }}：<a
                :href="item.sourceUrl"
                target="_blank"
                rel="noopener"
                >{{ item.value }}</a
              >
            </li>
          </ul>
        </div>
        <div class="review-item-actions">
          <button
            v-if="
              job.kind !== 'paper' &&
              (job.status === 'needs_changes' || job.status === 'failed')
            "
            class="button secondary"
            @click="$emit('edit', job.id)"
          >
            修改笔记</button
          ><button
            v-if="job.status === 'failed'"
            class="button primary"
            @click="$emit('retry', job.id)"
          >
            重试</button
          ><button
            v-if="job.status === 'published'"
            class="text-link"
            @click="$emit('open', job.noteId)"
          >
            {{ job.kind === "paper" ? "查看论文" : "阅读笔记" }}</button
          ><a
            v-if="job.commitUrl"
            :href="job.commitUrl"
            target="_blank"
            rel="noopener"
            class="text-link"
            >GitHub 提交</a
          >
        </div>
      </article>
    </div>
  </main>
</template>
<style scoped>
.review-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 27px;
}
.review-heading h1 {
  font-size: 28px;
  font-weight: 600;
}
.review-list {
  border-top: 2px solid var(--green);
}
.review-item {
  padding: 26px 0;
  border-bottom: 1px solid var(--border);
}
.review-item-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  margin-bottom: 12px;
}
.review-item h2 {
  font-family: var(--serif);
  font-size: 23px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.review-status {
  flex-shrink: 0;
  padding: 5px 11px;
  border-radius: 3px;
  background: var(--soft);
  font-size: 14px;
}
.pending {
  color: var(--green);
  background: #eaf0f7;
}
.passed {
  color: #256246;
  background: #eef7f0;
}
.rejected {
  color: #943d36;
  background: #fff2ee;
}
time {
  color: var(--muted);
  font-size: 13px;
}
.review-issues,
.review-supplements {
  margin: 18px 0 0;
  padding-left: 22px;
  line-height: 1.9;
  overflow-wrap: anywhere;
}
.review-issues strong {
  font-weight: 500;
}
.review-message {
  margin-top: 18px;
  line-height: 1.8;
}
.review-supplements a {
  color: var(--green);
  text-decoration: underline;
}
.review-item-actions {
  display: flex;
  gap: 18px;
  align-items: center;
  margin-top: 20px;
  flex-wrap: wrap;
}
.review-item-actions:empty {
  display: none;
}
@media (max-width: 720px) {
  .review-heading h1 {
    font-size: 25px;
  }
  .review-item h2 {
    font-size: 21px;
  }
  .review-item-heading {
    gap: 12px;
  }
}
</style>
