<script setup lang="ts">
import { X, CheckCircle2, AlertCircle } from "lucide-vue-next";
import { useWorkspace } from "./composables/useWorkspace";
import AppHeader from "./components/AppHeader.vue";
import LibraryView from "./components/LibraryView.vue";
import ImportWorkspace from "./components/ImportWorkspace.vue";
import PaperReader from "./components/PaperReader.vue";
import SetupDialog from "./components/SetupDialog.vue";
import ProfileDialog from "./components/ProfileDialog.vue";
import ReviewJobsView from "./components/ReviewJobsView.vue";
import GuideView from "./components/GuideView.vue";
import PaperIntakeView from "./components/PaperIntakeView.vue";
import CatalogPaperView from "./components/CatalogPaperView.vue";
const app = useWorkspace();
</script>
<template>
  <AppHeader
    :config="app.configuration.value"
    :user="app.user.value"
    :view="app.view.value"
    :pending-reviews="app.pendingReviews.value"
    @navigate="app.navigate"
    @create="app.beginImport()"
    @login="app.login"
    @logout="app.logout"
    @setup="app.setupOpen.value = true"
    @profile="app.profileOpen.value = true"
  /><LibraryView
    v-if="app.view.value === 'library'"
    :notes="app.notes.value"
    :catalog="app.catalog.value"
    :config="app.configuration.value"
    :loading="app.loading.value"
    :directions="app.directions.options.value"
    :can-create-direction="app.directions.canCreate.value"
    :create-direction="app.directions.create"
    @open="app.openNote"
    @create="app.beginImport(undefined, $event)"
    @refresh="app.refresh"
    @setup="app.setupOpen.value = true"
  /><PaperIntakeView
    v-else-if="app.view.value === 'collect'"
    :user="app.user.value"
    :directions="app.directions.options.value"
    :collect="app.collect"
    @back="app.navigate('library')"
    @login="app.login"
    @expired="app.user.value = null"
  /><CatalogPaperView
    v-else-if="app.view.value === 'catalog' && app.selectedCatalog.value"
    :paper="app.selectedCatalog.value"
    :notes="app.catalogNotes.value"
    :user="app.user.value"
    :asset-base="app.assetBase.value"
    @back="app.navigate('library')"
    @open="app.openNote"
    @contribute="app.contribute"
    @login="app.login"
  /><GuideView v-else-if="app.view.value === 'guide'" /><ReviewJobsView
    v-else-if="app.view.value === 'reviews'"
    :jobs="app.reviews.jobs.value"
    :loading="app.reviews.loading.value"
    :error="app.reviews.error.value"
    :signed-in="!!app.user.value"
    @refresh="app.reviews.refresh"
    @edit="app.editReview"
    @retry="app.retryReview"
    @open="app.openNote"
    @create="app.beginImport()"
    @login="app.login"
  /><ImportWorkspace
    v-else-if="app.view.value === 'import'"
    :key="app.editingNote.value?.id || 'new'"
    :existing="app.editingNote.value"
    :config="app.configuration.value"
    :user="app.user.value"
    :asset-base="app.assetBase.value"
    :save="app.save"
    :directions="app.directions.options.value"
    :can-create-direction="app.directions.canCreate.value"
    :create-direction="app.directions.create"
    @back="app.navigate('library')"
    @login="app.login"
  /><PaperReader
    v-else-if="app.selectedNote.value"
    :note="app.selectedNote.value"
    :notes="app.selectedPaperNotes.value"
    :user="app.user.value"
    :asset-base="app.assetBase.value"
    @back="app.navigate('library')"
    @edit="app.beginImport"
    @open="app.openNote"
    @contribute="app.contribute"
  />
  <div v-else class="page-container empty-state">正在读取笔记…</div>
  <SetupDialog
    v-if="app.setupOpen.value"
    @close="app.setupOpen.value = false"
  />
  <ProfileDialog
    v-if="app.profileOpen.value && app.user.value"
    :user="app.user.value"
    :save="app.saveProfile"
    @close="app.profileOpen.value = false"
  />
  <div
    v-if="app.message.value"
    class="toast"
    :class="app.messageKind.value"
    role="status"
  >
    <CheckCircle2
      v-if="app.messageKind.value === 'success'"
      :size="19"
    /><AlertCircle v-else :size="19" />{{ app.message.value
    }}<button
      class="icon-button"
      aria-label="关闭通知"
      @click="app.message.value = ''"
    >
      <X :size="16" />
    </button>
  </div>
</template>
