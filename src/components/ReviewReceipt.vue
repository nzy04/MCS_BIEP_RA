<script setup lang="ts">
import type { ReviewReceipt } from "../../shared/review";
defineProps<{ receipt: ReviewReceipt }>();
</script>
<template>
  <details class="review-receipt">
    <summary>参考来源</summary>
    <p v-if="receipt.pdfNotice">{{ receipt.pdfNotice }}</p>
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
