import { onMounted, shallowRef } from "vue";
import type { MembersData } from "../../shared/members";
import * as api from "../services/api";
export function useMembers() {
  const data = shallowRef<MembersData>({
    members: [],
    invitation: null,
    configured: false,
  });
  const loading = shallowRef(true),
    busy = shallowRef(false),
    error = shallowRef("");
  async function refresh() {
    try {
      data.value = await api.members();
      error.value = "";
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }
  async function run(action: () => Promise<unknown>) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      await action();
      await refresh();
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      busy.value = false;
    }
  }
  onMounted(refresh);
  return {
    data,
    loading,
    busy,
    error,
    refresh,
    create: () => run(api.createInvitation),
    revoke: () => run(api.revokeInvitation),
    change: (id: number, active: boolean) =>
      run(() => api.changeMember(id, active)),
  };
}
