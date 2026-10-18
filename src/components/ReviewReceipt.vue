<script setup lang="ts">
import type { ReviewReceipt } from "../../shared/review";
defineProps<{ receipt: ReviewReceipt }>();
const labels = { paperUrl: "论文链接", year: "发表年份", venue: "会议 / 期刊" };
</script>
<template>
  <details class="review-receipt">
    <summary>归类与补充来源</summary>
    <p>研究方向：{{ receipt.directions.join("、") }}</p>
    <ul v-if="receipt.supplements.length">
      <li v-for="(item, i) in receipt.supplements" :key="i">
        自动补充{{ labels[item.field] }}：<a
          :href="item.sourceUrl"
          target="_blank"
          rel="noopener"
          >{{ item.value }}</a
        >
      </li>
    </ul>
    <ul>
      <li v-for="(source, i) in receipt.sources" :key="i">
        <a :href="source.url" target="_blank" rel="noopener">{{
          source.title
        }}</a>
      </li>
    </ul>
  </details>
</template>
<style scoped>
.review-receipt {
  border-top: 1px solid var(--border);
  margin-top: 32px;
  padding-top: 20px;
  line-height: 1.8;
  color: var(--muted);
  overflow-wrap: anywhere;
}
summary {
  cursor: pointer;
  color: var(--green);
  font-weight: 500;
}
p {
  margin: 16px 0;
}
ul {
  padding-left: 20px;
}
a {
  color: var(--green);
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
