import { computed, shallowRef, type Ref } from "vue";
import type { NoteSummary, Session, SiteConfig } from "../../shared/note";
import {
  directionKey,
  directionName,
  mergeDirections,
} from "../../shared/directions";
import * as api from "../services/api";
import { getRecord, setRecord } from "../services/storage";

export function useDirections(
  config: Ref<SiteConfig>,
  user: Ref<Session | null>,
  notes: Ref<NoteSummary[]>,
) {
  const folders = shallowRef<string[]>([]);
  const options = computed(() =>
    mergeDirections(
      folders.value,
      notes.value.flatMap((n) => n.tags),
    ),
  );
  const canCreate = computed(
    () => !config.value.configured || !!user.value?.canWrite,
  );
  async function refresh() {
    folders.value = config.value.configured
      ? await api.directions()
      : (await getRecord<string[]>("directions")) || [];
  }
  async function create(value: string): Promise<string> {
    const name = directionName(value);
    if (config.value.configured) {
      try {
        const result = await api.createDirection(name);
        folders.value = mergeDirections(folders.value, result.directions);
        return result.name;
      } catch (error) {
        if (error instanceof api.ApiError && error.status === 401)
          user.value = null;
        throw error;
      }
    }
    const existing = options.value.find(
      (n) => directionKey(n) === directionKey(name),
    );
    const canonical = existing || name;
    folders.value = mergeDirections(folders.value, [canonical]);
    await setRecord("directions", folders.value);
    return canonical;
  }
  return { options, canCreate, refresh, create };
}
