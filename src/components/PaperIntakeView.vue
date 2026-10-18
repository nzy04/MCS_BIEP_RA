<script setup lang="ts">
import { computed, ref } from "vue";
import { ArrowLeft, Search, Check, LoaderCircle } from "lucide-vue-next";
import type { PaperChoice } from "../../shared/catalog";
import type { Session } from "../../shared/note";
import { searchPapers, ApiError } from "../services/api";
const props = defineProps<{
  user: Session | null;
  directions: string[];
  collect: (token: string, tags: string[]) => Promise<void>;
}>();
const emit = defineEmits<{ back: []; login: []; expired: [] }>();
const query = ref("");
const candidates = ref<PaperChoice[]>([]);
const selected = ref(-1);
const selectedTags = ref<string[]>([]);
const searching = ref(false);
const submitting = ref(false);
const error = ref("");
const searched = ref(false);
const candidate = computed(() => candidates.value[selected.value]);
const options = computed(() => [
  ...new Set([...props.directions, ...(candidate.value?.tags || [])]),
]);
function choose(index: number) {
  selected.value = index;
  selectedTags.value = [...candidates.value[index].tags];
}
async function search() {
  if (searching.value || submitting.value) return;
  searching.value = true;
  error.value = "";
  candidates.value = [];
  selected.value = -1;
  searched.value = false;
  try {
    const result = await searchPapers(query.value.trim());
    candidates.value = result.candidates;
    searched.value = true;
    if (!result.candidates.length) error.value = result.message;
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 401) emit("expired");
  } finally {
    searching.value = false;
  }
}
async function confirm() {
  if (!candidate.value || submitting.value) return;
  submitting.value = true;
  error.value = "";
  try {
    await props.collect(candidate.value.token, selectedTags.value);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submitting.value = false;
  }
}
</script>
<template>
  <main class="page-container intake-main">
    <button class="back-link" @click="emit('back')">
      <ArrowLeft :size="17" />返回论文库
    </button>
    <h1>按标题收录</h1>
    <div v-if="!user" class="empty-state">
      <h3>登录后收录论文</h3>
      <button class="button primary" @click="emit('login')">GitHub 登录</button>
    </div>
    <p v-else-if="!user.canWrite" class="alert error">
      此账号没有仓库写入权限，请联系维护者加入课题组。
    </p>
    <template v-else>
      <form class="title-search" @submit.prevent="search">
        <label for="paper-title">论文标题</label>
        <div class="search-row">
          <input
            id="paper-title"
            v-model="query"
            required
            minlength="3"
            maxlength="250"
            placeholder="输入完整论文标题"
            :disabled="searching || submitting"
          /><button class="button primary" :disabled="searching || submitting">
            <LoaderCircle v-if="searching" class="spin" :size="17" /><Search
              v-else
              :size="17"
            />{{ searching ? "检索中" : "检索论文" }}
          </button>
        </div>
      </form>
      <p v-if="error" class="alert error" role="alert">{{ error }}</p>
      <section
        v-if="candidates.length"
        class="candidates"
        aria-label="检索候选"
      >
        <h2>选择要收录的论文</h2>
        <label
          v-for="(paper, index) in candidates"
          :key="paper.token"
          class="candidate"
          :class="{ selected: selected === index }"
        >
          <input
            type="radio"
            name="candidate"
            :checked="selected === index"
            :disabled="submitting"
            @change="choose(index)"
          />
          <div>
            <h3>{{ paper.title }}</h3>
            <p class="candidate-meta">
              {{
                [
                  paper.authors.join(", "),
                  paper.year,
                  paper.venue,
                  paper.source === "arxiv"
                    ? "arXiv"
                    : paper.source === "crossref"
                      ? "Crossref"
                      : "学术搜索",
                ]
                  .filter(Boolean)
                  .join(" · ")
              }}
            </p>
            <p v-if="paper.abstract" class="candidate-abstract">
              {{ paper.abstract }}
            </p>
            <a
              :href="paper.paperUrl"
              class="text-link"
              target="_blank"
              rel="noopener"
              >查看来源</a
            ><span class="pdf-availability">{{
              paper.pdfUrl ? "有公开 PDF 来源" : "暂未找到公开 PDF"
            }}</span>
          </div>
        </label>
      </section>
      <section v-if="candidate" class="confirm-intake" aria-label="确认收录">
        <fieldset v-if="options.length">
          <legend>研究方向</legend>
          <div class="intake-directions">
            <label v-for="name in options" :key="name"
              ><input
                v-model="selectedTags"
                type="checkbox"
                :value="name"
                :disabled="
                  submitting ||
                  (!selectedTags.includes(name) && selectedTags.length >= 8)
                "
              />{{ name }}</label
            >
          </div>
        </fieldset>
        <button class="button primary" :disabled="submitting" @click="confirm">
          <LoaderCircle v-if="submitting" class="spin" :size="17" /><Check
            v-else
            :size="17"
          />{{ submitting ? "正在提交" : "确认收录" }}
        </button>
        <p>确认后在后台获取 PDF，可在“我的提交”查看结果。</p>
      </section>
      <p v-else-if="searched && candidates.length" class="selection-hint">
        请核对标题、作者和年份，再选择论文。
      </p>
    </template>
  </main>
</template>
<style scoped>
.intake-main {
  max-width: 1020px;
  padding-top: 32px;
  padding-bottom: 80px;
}
h1 {
  font-size: 30px;
  margin: 28px 0;
  font-weight: 600;
}
.title-search {
  border-top: 2px solid var(--green);
  padding-top: 24px;
  margin-bottom: 24px;
}
.title-search > label {
  display: block;
  font-weight: 600;
  margin-bottom: 12px;
}
.search-row {
  display: flex;
  gap: 12px;
}
.search-row input {
  min-width: 0;
  flex: 1;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 16px;
  background: var(--paper, #fff);
}
.search-row button {
  flex-shrink: 0;
}
.candidates h2 {
  font-size: 18px;
  margin: 32px 0 14px;
}
.candidate {
  display: flex;
  gap: 16px;
  border: 1px solid var(--border);
  padding: 22px;
  margin-bottom: 14px;
  cursor: pointer;
  border-radius: 3px;
}
.candidate.selected {
  border-color: var(--green);
  background: #f5f7fa;
}
.candidate > input {
  margin-top: 7px;
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  accent-color: var(--green);
}
.candidate > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.candidate h3 {
  font-family: var(--serif);
  font-size: 23px;
  line-height: 1.4;
}
.candidate-meta {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
  margin: 10px 0;
}
.candidate-abstract {
  line-height: 1.8;
  margin-bottom: 16px;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pdf-availability {
  display: inline-block;
  margin-left: 18px;
  color: var(--muted);
  font-size: 13px;
}
.confirm-intake {
  margin-top: 26px;
  border-top: 1px solid var(--border);
  padding-top: 24px;
}
.confirm-intake fieldset {
  padding: 0;
  border: 0;
  margin-bottom: 24px;
}
.confirm-intake legend {
  font-weight: 600;
  margin-bottom: 14px;
}
.intake-directions {
  display: flex;
  gap: 12px 24px;
  flex-wrap: wrap;
}
.intake-directions label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  overflow-wrap: anywhere;
  max-width: 100%;
}
.intake-directions input {
  accent-color: var(--green);
}
.confirm-intake p,
.selection-hint {
  color: var(--muted);
  line-height: 1.7;
  margin-top: 16px;
  font-size: 14px;
}
.spin {
  animation: rotate 1s linear infinite;
}
@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 600px) {
  h1 {
    font-size: 25px;
  }
  .search-row {
    flex-wrap: wrap;
  }
  .search-row input {
    flex-basis: 100%;
  }
  .candidate {
    padding: 16px 12px;
    gap: 10px;
  }
  .candidate h3 {
    font-size: 20px;
  }
}
</style>
