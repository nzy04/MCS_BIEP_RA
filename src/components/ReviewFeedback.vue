<script setup lang="ts">
import { reviewFieldLabel, type ReviewIssue } from "../../shared/review";
defineProps<{ issues: ReviewIssue[] }>();
defineEmits<{ locate: [issue: ReviewIssue, index: number] }>();
</script>
<template>
  <section
    v-if="issues.length"
    class="review-feedback"
    aria-label="需要修改的内容"
  >
    <h2>需要修改</h2>
    <ol>
      <li v-for="(issue, index) in issues" :key="index">
        <button type="button" @click="$emit('locate', issue, index)">
          <strong>{{ reviewFieldLabel(issue.field) }}</strong
          >：{{ issue.message }}
        </button>
        <blockquote v-if="issue.quote">{{ issue.quote }}</blockquote>
      </li>
    </ol>
  </section>
</template>
<style scoped>
.review-feedback {
  border: 1px solid #e6ada8;
  border-left: 3px solid #b42318;
  background: #fff6f5;
  padding: 16px 18px;
  margin-bottom: 22px;
  color: #a1251b;
}
h2 {
  font-size: 16px;
  margin: 0 0 8px;
}
ol {
  padding-left: 22px;
  margin: 0;
}
li {
  margin: 7px 0;
  line-height: 1.8;
}
button {
  text-align: left;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
button:hover {
  text-decoration: underline;
}
blockquote {
  margin: 6px 0 0;
  border-left: 2px solid #d88780;
  padding-left: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
