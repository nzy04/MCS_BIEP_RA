<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { Search } from "lucide-vue-next";
import type { NoteSummary, SiteConfig } from "../../shared/note";
import PaperCard from "./PaperCard.vue";
import LibraryToolbar from "./LibraryToolbar.vue";
const props = defineProps<{
  notes: NoteSummary[];
  config: SiteConfig;
  loading: boolean;
}>();
defineEmits<{ open: [id: string]; create: []; refresh: []; setup: [] }>();
const query = shallowRef("");
const selectedTag = shallowRef("全部论文");
const sort = shallowRef("recent");
const layout = shallowRef("list");
const tags = computed(() =>
  [...new Set(props.notes.flatMap((n) => n.tags))].sort(),
);
const authors = computed(() => new Set(props.notes.map((n) => n.author)).size);
const filtered = computed(() =>
  props.notes
    .filter(
      (n) =>
        (selectedTag.value === "全部论文" ||
          n.tags.includes(selectedTag.value)) &&
        `${n.title} ${n.subtitle} ${n.excerpt} ${n.author} ${n.tags.join(" ")}`
          .toLowerCase()
          .includes(query.value.toLowerCase()),
    )
    .sort((a, b) =>
      sort.value === "year"
        ? b.year.localeCompare(a.year)
        : b.updatedAt.localeCompare(a.updatedAt),
    ),
);
function resetFilters() {
  query.value = "";
  selectedTag.value = "全部论文";
}
</script>
<template>
  <main class="library-main page-container">
    <header class="library-heading">
      <h1>文献库</h1>
      <section class="library-stats" aria-label="文献库统计">
        <span
          ><strong>{{ notes.length }}</strong> 篇笔记</span
        >
        <span
          ><strong>{{ tags.length }}</strong> 个方向</span
        >
        <span
          ><strong>{{ authors }}</strong> 位贡献者</span
        >
      </section>
    </header>
    <div class="library-content">
      <aside class="topics" aria-label="研究方向">
        <h2 class="sidebar-heading">研究方向</h2>
        <button
          :class="{ selected: selectedTag === '全部论文' }"
          :aria-pressed="selectedTag === '全部论文'"
          @click="selectedTag = '全部论文'"
        >
          全部文献 <span>{{ notes.length }}</span>
        </button>
        <button
          v-for="tag in tags"
          :key="tag"
          :class="{ selected: selectedTag === tag }"
          :aria-pressed="selectedTag === tag"
          @click="selectedTag = tag"
        >
          {{ tag
          }}<span>{{ notes.filter((n) => n.tags.includes(tag)).length }}</span>
        </button>
      </aside>
      <section class="library-results" aria-label="文献列表">
        <LibraryToolbar
          v-model:query="query"
          v-model:sort="sort"
          v-model:layout="layout"
          @refresh="$emit('refresh')"
        />
        <div class="library-title-row">
          <h2>{{ selectedTag === "全部论文" ? "全部文献" : selectedTag }}</h2>
          <span class="result-count"
            >{{ filtered.length }} 篇<span v-if="query">
              · {{ query }}</span
            ></span
          >
        </div>
        <div v-if="loading" class="empty-state">正在加载…</div>
        <div v-else-if="!filtered.length" class="empty-state">
          <Search :size="24" />
          <h3>{{ notes.length ? "无匹配文献" : "暂无笔记" }}</h3>
          <button
            v-if="notes.length"
            class="button secondary"
            @click="resetFilters"
          >
            清除筛选
          </button>
          <button v-else class="button primary" @click="$emit('create')">
            上传第一篇笔记
          </button>
        </div>
        <div
          v-else
          class="paper-grid"
          :class="{ 'paper-list': layout === 'list' }"
        >
          <PaperCard
            v-for="note in filtered"
            :key="note.id"
            :note="note"
            @open="$emit('open', $event)"
          />
        </div>
        <div v-if="!config.configured" class="demo-notice">
          <span>示例数据 · 仅本机保存</span
          ><button @click="$emit('setup')">连接仓库</button>
        </div>
      </section>
    </div>
  </main>
</template>
