<script setup lang="ts">
import { computed, shallowRef } from "vue";
import {
  Search,
  ArrowRight,
  Plus,
  SlidersHorizontal,
  LayoutGrid,
  List,
  BookOpen,
  Users,
  Tags,
  RefreshCw,
  ArrowUpRight,
} from "lucide-vue-next";
import type { NoteSummary, SiteConfig } from "../../shared/note";
import PaperCard from "./PaperCard.vue";
const props = defineProps<{
  notes: NoteSummary[];
  config: SiteConfig;
  loading: boolean;
}>();
defineEmits<{ open: [id: string]; create: []; refresh: []; setup: [] }>();
const query = shallowRef("");
const selectedTag = shallowRef("全部论文");
const sort = shallowRef("recent");
const layout = shallowRef("grid");
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
</script>
<template>
  <main class="library-main page-container">
    <section class="hero">
      <div class="hero-copy">
        <div class="eyebrow">
          <span class="status-dot"></span> A SHARED SPACE FOR RESEARCH
        </div>
        <h1>读过的论文，<br /><span>一起留下来。</span></h1>
        <p>记录理解，交流疑问，让每一次阅读成为课题组共同积累的知识。</p>
        <button class="text-link" @click="$emit('create')">
          分享我的阅读笔记 <ArrowRight :size="17" />
        </button>
      </div>
      <div class="hero-visual" aria-hidden="true">
        <div class="orb orb-one"></div>
        <div class="orb orb-two"></div>
        <div class="visual-grid"></div>
        <div class="floating-note">
          <span class="floating-index">READ · THINK · CONNECT</span>
          <div class="note-drawing">
            <span></span><span></span><span></span><i></i><i></i>
          </div>
          <div class="floating-bottom">
            <BookOpen :size="17" /><span>让理解发生连接</span
            ><span class="tiny-circle">↗</span>
          </div>
        </div>
        <span class="visual-caption">KNOWLEDGE GROWS WHEN SHARED.</span>
      </div>
    </section>
    <section class="stats-row" aria-label="文献库统计">
      <div>
        <BookOpen :size="18" /><strong>{{ notes.length }}</strong
        ><span>篇阅读笔记</span>
      </div>
      <div>
        <Tags :size="18" /><strong>{{ tags.length }}</strong
        ><span>个研究方向</span>
      </div>
      <div>
        <Users :size="18" /><strong>{{ authors }}</strong
        ><span>位笔记贡献者</span>
      </div>
      <div class="stats-status">
        <span class="status-dot"></span
        >{{ config.configured ? "与 GitHub 仓库连接" : "示例内容 + 本机保存"
        }}<button
          class="icon-button"
          aria-label="刷新论文库"
          @click="$emit('refresh')"
        >
          <RefreshCw :size="15" />
        </button>
      </div>
    </section>
    <section class="library-content">
      <aside class="topics">
        <div class="sidebar-heading">
          研究方向 <SlidersHorizontal :size="14" />
        </div>
        <button
          :class="{ selected: selectedTag === '全部论文' }"
          @click="selectedTag = '全部论文'"
        >
          全部论文 <span>{{ notes.length }}</span></button
        ><button
          v-for="tag in tags"
          :key="tag"
          :class="{ selected: selectedTag === tag }"
          @click="selectedTag = tag"
        >
          {{ tag
          }}<span>{{ notes.filter((n) => n.tags.includes(tag)).length }}</span>
        </button>
        <div class="sidebar-callout">
          <span class="eyebrow">YOUR NEXT CONTRIBUTION</span>
          <h3>好笔记，值得被看见。</h3>
          <p>上传已有文档，确认整理结果，再分享给大家。</p>
          <button class="text-link" @click="$emit('create')">
            开始整理 <ArrowUpRight :size="15" />
          </button>
        </div>
      </aside>
      <div class="library-results">
        <div class="library-title-row">
          <div>
            <h2>
              {{
                selectedTag === "全部论文" ? "最近的阅读与思考" : selectedTag
              }}
            </h2>
            <p>从一篇笔记，发现下一个研究线索。</p>
          </div>
          <button class="button secondary small" @click="$emit('create')">
            <Plus :size="15" /> 新增笔记
          </button>
        </div>
        <div class="search-toolbar">
          <label class="search-field"
            ><Search :size="18" /><input
              v-model="query"
              placeholder="搜索论文、关键词或笔记作者…"
              aria-label="搜索论文"
            /><kbd>/</kbd></label
          ><select v-model="sort" aria-label="排序方式">
            <option value="recent">最近更新</option>
            <option value="year">发表年份</option>
          </select>
          <div class="view-toggle">
            <button
              :class="{ chosen: layout === 'grid' }"
              aria-label="卡片视图"
              @click="layout = 'grid'"
            >
              <LayoutGrid :size="17" /></button
            ><button
              :class="{ chosen: layout === 'list' }"
              aria-label="列表视图"
              @click="layout = 'list'"
            >
              <List :size="18" />
            </button>
          </div>
        </div>
        <div class="result-count">
          共 {{ filtered.length }} 篇笔记<span v-if="query">
            · “{{ query }}”</span
          >
        </div>
        <div v-if="loading" class="empty-state">正在读取论文库…</div>
        <div v-else-if="!filtered.length" class="empty-state">
          <Search :size="28" />
          <h3>这里还没有找到笔记</h3>
          <p>换个关键词，或上传你读过的第一篇论文。</p>
          <button
            class="button secondary"
            @click="
              query = '';
              selectedTag = '全部论文';
            "
          >
            清除筛选
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
          当前展示的是示例笔记。你导入的内容会保存在此浏览器；连接仓库后可发布给组员。<button
            @click="$emit('setup')"
          >
            查看连接说明 <ArrowRight :size="13" />
          </button>
        </div>
      </div>
    </section>
  </main>
</template>
