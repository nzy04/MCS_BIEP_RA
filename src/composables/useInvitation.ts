import { shallowRef, watch, onUnmounted, type Ref } from "vue";
import type { Session } from "../../shared/note";
import type { InvitationPreview } from "../../shared/members";
import {
  previewInvitation,
  invitationLogin,
  joinInvitation,
} from "../services/api";
export function useInvitation(
  token: Ref<string>,
  user: Ref<Session | null>,
  joined: (user: Session) => void,
) {
  const preview = shallowRef<InvitationPreview | null>(null),
    loading = shallowRef(false),
    error = shallowRef("");
  let generation = 0;
  onUnmounted(() => generation++);
  async function load() {
    const epoch = ++generation;
    loading.value = true;
    error.value = "";
    preview.value = null;
    try {
      const value = await previewInvitation(token.value);
      if (epoch !== generation) return;
      preview.value = value;
      if (value.valid && user.value) {
        const result = await joinInvitation(token.value);
        if (epoch === generation) joined(result.user);
      }
    } catch (e) {
      if (epoch === generation) error.value = (e as Error).message;
    } finally {
      if (epoch === generation) loading.value = false;
    }
  }
  async function login() {
    if (loading.value) return;
    const epoch = generation;
    loading.value = true;
    error.value = "";
    try {
      const result = await invitationLogin(token.value);
      if (epoch === generation) location.assign(result.url);
    } catch (e) {
      if (epoch === generation) {
        error.value = (e as Error).message;
        loading.value = false;
      }
    }
  }
  watch([token, () => user.value?.login], load, { immediate: true });
  return { preview, loading, error, login, retry: load };
}
