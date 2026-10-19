<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { Search } from "lucide-vue-next";
import type { NoteSummary, SiteConfig } from "../../shared/note";
import { groupPapers, countContributors } from "../../shared/papers";
import { directionKey, mergeDirections } from "../../shared/directions";
import type {
  MoveNotesRequest,
  DirectionChange,
} from "../../shared/directions";
import { useLibraryMoves } from "../composables/useLibraryMoves";
import PaperCard from "./PaperCard.vue";
import LibraryToolbar from "./LibraryToolbar.vue";
import ResearchSidebar from "./ResearchSidebar.vue";
import MoveNotesDialog from "./MoveNotesDialog.vue";
const props = defineProps<{
  notes: NoteSummary[];
  config: SiteConfig;
  loading: boolean;
  directions: string[];
  canCreateDirection: boolean;
  createDirection: (name: string) => Promise<string>;
  canMove: boolean;
  moveNotes: (request: MoveNotesRequest) => Promise<void>;
  lastDirectionChange: DirectionChange | null;
}>();
defineEmits<{
  open: [id: string];
  create: [direction?: string];
  refresh: [];
  setup: [];
  manageDirections: [];
}>();
const query = shallowRef("");
const selectedTag = shallowRef<string | null>(null);
const sort = shallowRef("recent");
const layout = shallowRef("list");
const moves = useLibraryMoves(props.moveNotes);
function movable(notes: NoteSummary[]) {
  return notes.every((n) => n.local || props.canMove);
}
const tags = computed(() =>
  mergeDirections(
    props.directions,
    props.notes.flatMap((n) => n.tags),
  ).sort((a, b) => a.localeCompare(b, "zh-CN")),
);
const papers = computed(() => groupPapers(props.notes));
const unclassified = computed(
  () => groupPapers(props.notes.filter((n) => !n.tags.length)).length,
);
const authors = computed(() => countContributors(props.notes));
const tagCounts = computed(
  () =>
    new Map(
      tags.value.map((tag) => [
        tag,
        papers.value.filter((p) =>
          p.tags.some((t) => directionKey(t) === directionKey(tag)),
        ).length,
      ]),
    ),
);
const filtered = computed(() =>
  groupPapers(
    props.notes.filter(
      (n) =>
        selectedTag.value === null ||
        (selectedTag.value === "" && !n.tags.length) ||
        n.tags.some(
          (t) => directionKey(t) === directionKey(selectedTag.value!),
        ),
    ),
  )
    .filter((n) =>
      n.notes
        .map(
          (note) =>
            `${note.title} ${note.subtitle} ${note.excerpt} ${note.author} ${note.authorLogin} ${note.tags.join(" ")}`,
        )
        .join(" ")
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    )
    .sort((a, b) =>
      sort.value === "year"
        ? b.note.year.localeCompare(a.note.year)
        : b.updatedAt.localeCompare(a.updatedAt),
    ),
);
watch(
  () => props.lastDirectionChange,
  (change) => {
    if (
      change &&
      selectedTag.value &&
      directionKey(selectedTag.value) === directionKey(change.name)
    )
      selectedTag.value = change.replacement;
  },
);
function resetFilters() {
  query.value = "";
  selectedTag.value = null;
}
</script>
<template>
  <main class="library-main page-container">
    <header class="library-heading">
      <h1>文献库</h1>
      <section class="library-stats" aria-label="文献库统计">
        <span
          ><strong>{{ papers.length }}</strong> 篇论文 ·
          {{ notes.length }} 份笔记</span
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
      <ResearchSidebar
        v-model="selectedTag"
        :directions="tags"
        :counts="tagCounts"
        :total="papers.length"
        :unclassified="unclassified"
        :can-create="canCreateDirection"
        :create="createDirection"
        :dragging="!!moves.dragging.value.length"
        :busy="moves.busy.value"
        @drop="moves.drop"
        @manage="$emit('manageDirections')"
      />
      <section class="library-results" aria-label="文献列表">
        <LibraryToolbar
          v-model:query="query"
          v-model:sort="sort"
          v-model:layout="layout"
          @refresh="$emit('refresh')"
        />
        <div class="library-title-row">
          <h2>
            {{ selectedTag === null ? "全部文献" : selectedTag || "未分类" }}
          </h2>
          <span class="result-count"
            >{{ filtered.length }} 篇<span v-if="query">
              · {{ query }}</span
            ></span
          >
        </div>
        <p
          v-if="moves.error.value && !moves.choosing.value.length"
          class="move-error"
          role="alert"
        >
          {{ moves.error.value }}
        </p>
        <p v-if="moves.busy.value" role="status">正在同步目录…</p>
        <div v-if="loading" class="empty-state">正在加载…</div>
        <div v-else-if="!filtered.length" class="empty-state">
          <Search :size="24" />
          <h3>
            {{
              selectedTag && !query
                ? "这个方向还没有笔记"
                : notes.length
                  ? "无匹配文献"
                  : "暂无笔记"
            }}
          </h3>
          <button
            v-if="selectedTag"
            class="button primary"
            @click="$emit('create', selectedTag)"
          >
            在此方向添加笔记
          </button>
          <button
            v-if="papers.length"
            class="button secondary"
            @click="resetFilters"
          >
            清除筛选
          </button>
          <button
            v-else-if="!selectedTag"
            class="button primary"
            @click="$emit('create')"
          >
            上传第一篇笔记
          </button>
        </div>
        <div
          v-else
          class="paper-grid"
          :class="{ 'paper-list': layout === 'list' }"
        >
          <PaperCard
            v-for="paper in filtered"
            :key="paper.id"
            :paper="paper"
            :can-move="movable(paper.notes) && !moves.busy.value"
            @drag-notes="
              (event, notes) => moves.start(event, notes, selectedTag || null)
            "
            @drag-end="moves.end"
            @move="moves.choose($event, selectedTag || null)"
            @open="$emit('open', $event)"
          />
        </div>
        <div v-if="!config.configured" class="demo-notice">
          <span>示例数据 · 仅本机保存</span
          ><button @click="$emit('setup')">连接仓库</button>
        </div>
      </section>
    </div>
    <MoveNotesDialog
      v-if="moves.choosing.value.length"
      :count="moves.choosing.value.length"
      :source="moves.pendingSource.value"
      :directions="tags"
      :busy="moves.busy.value"
      :error="moves.error.value"
      @move="moves.confirm"
      @close="moves.choosing.value = []"
    />
  </main>
</template>
<style scoped>
.move-error {
  color: #b42318;
  margin: 12px 0;
}
</style>
