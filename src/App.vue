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
import ContextMenu from "./components/ContextMenu.vue";
import DirectionActionDialog from "./components/DirectionActionDialog.vue";
import DeleteNoteDialog from "./components/DeleteNoteDialog.vue";
import MembersView from "./components/MembersView.vue";
import JoinView from "./components/JoinView.vue";
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
    :config="app.configuration.value"
    :loading="app.loading.value"
    :directions="app.directions.options.value"
    :can-create-direction="app.directions.canCreate.value"
    :can-move="!!app.user.value?.canWrite"
    :move-notes="app.moveNotes"
    :last-direction-change="app.lastDirectionChange.value"
    :new-direction="app.newDirection.value"
    @open="app.openNote"
    @create="app.beginImport(undefined, $event)"
    @refresh="app.refresh"
    @setup="app.setupOpen.value = true"
    @direction-context="app.directionContext"
    @note-context="app.noteContext"
  /><MembersView
    v-else-if="app.view.value === 'members' && app.user.value?.isAdmin"
  />
  <JoinView
    v-else-if="app.view.value === 'join'"
    :token="app.invitationToken.value"
    :user="app.user.value"
    :title="app.configuration.value.title"
    @joined="app.joined"
    @back="app.navigate('library')"
  />
  <GuideView v-else-if="app.view.value === 'guide'" /><ReviewJobsView
    v-else-if="app.view.value === 'reviews'"
    :jobs="app.reviews.jobs.value"
    :loading="app.reviews.loading.value"
    :removing="app.reviews.removing.value"
    :error="app.reviews.error.value"
    :signed-in="!!app.user.value"
    @refresh="app.reviews.refresh"
    @edit="app.editReview"
    @retry="app.retryReview"
    @remove="app.reviews.remove"
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
    :issues="app.editingIssues.value"
    :new-direction="app.newDirection.value"
    :last-direction-change="app.lastDirectionChange.value"
    @back="app.navigate('library')"
    @login="app.login"
    @direction-context="app.directionContext"
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
    @context="app.noteContext"
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
  <ContextMenu
    v-if="app.contextMenu.value"
    :key="`${app.contextMenu.value.x}-${app.contextMenu.value.y}`"
    v-bind="app.contextMenu.value"
    @close="app.contextMenu.value = null"
  />
  <DirectionActionDialog
    v-if="app.directionAction.value && app.directions.canCreate.value"
    :action="app.directionAction.value"
    :count="
      app.notes.value.filter((n) =>
        n.tags.includes(app.directionAction.value!.name),
      ).length
    "
    :create="app.directions.create"
    :change="app.changeDirection"
    @close="app.directionAction.value = null"
    @created="app.newDirection.value = { name: $event }"
  />
  <DeleteNoteDialog
    v-if="app.noteToDelete.value"
    :note="app.noteToDelete.value"
    :remove="app.deleteOwnNote"
    @close="app.noteToDelete.value = null"
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
