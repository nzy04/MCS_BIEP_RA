import { onUnmounted, shallowRef, watch, type Ref } from "vue";
import type { Session } from "../../shared/note";
import { reviewPending, type ReviewJobSummary } from "../../shared/review";
import { ApiError, deleteReview, reviewJobs } from "../services/api";
import { removeRecord } from "../services/storage";
export function useReviewJobs(
  user: Ref<Session | null>,
  expired: () => void,
  published?: (jobs: ReviewJobSummary[]) => Promise<void>,
) {
  const jobs = shallowRef<ReviewJobSummary[]>([]),
    loading = shallowRef(false),
    removing = shallowRef(""),
    error = shallowRef("");
  const removedIds = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined,
    generation = 0,
    inFlight = false,
    disposed = false;
  function schedule() {
    clearTimeout(timer);
    if (
      !disposed &&
      user.value &&
      jobs.value.some((j) => reviewPending(j.status))
    )
      timer = setTimeout(() => {
        if (document.hidden) schedule();
        else void refresh();
      }, 8000);
  }
  async function refresh() {
    if (!user.value || inFlight || disposed) return;
    const epoch = generation;
    inFlight = true;
    loading.value = true;
    try {
      const next = (await reviewJobs()).filter(
        (job) => !removedIds.has(job.id),
      );
      if (epoch !== generation || disposed) return;
      const completed = next.filter(
        (job) =>
          job.status === "published" &&
          jobs.value.find((j) => j.id === job.id)?.status !== "published",
      );
      for (const job of completed)
        await removeRecord(`review-draft:${job.id}`).catch(() => {});
      jobs.value = next.filter((job) => !removedIds.has(job.id));
      error.value = "";
      if (completed.length) await published?.(completed);
    } catch (e) {
      if (epoch === generation && !disposed) {
        error.value = (e as Error).message;
        if (e instanceof ApiError && e.status === 401) expired();
      }
    } finally {
      if (epoch === generation) {
        inFlight = false;
        loading.value = false;
        schedule();
      }
    }
  }
  async function remove(id: string) {
    if (!user.value || removing.value || disposed) return;
    const epoch = generation;
    removing.value = id;
    error.value = "";
    try {
      try {
        await deleteReview(id);
      } catch (e) {
        // Another tab may already have deleted the record.
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
      if (epoch !== generation || disposed) return;
      removedIds.add(id);
      jobs.value = jobs.value.filter((job) => job.id !== id);
      await removeRecord(`review-draft:${id}`).catch(() => {});
    } catch (e) {
      if (epoch === generation && !disposed) {
        error.value = (e as Error).message;
        if (e instanceof ApiError && e.status === 401) expired();
      }
    } finally {
      if (epoch === generation) {
        removing.value = "";
        schedule();
      }
    }
  }
  function upsert(job: ReviewJobSummary) {
    removedIds.delete(job.id);
    jobs.value = [job, ...jobs.value.filter((j) => j.id !== job.id)].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
    schedule();
  }
  function visible() {
    if (
      !document.hidden &&
      user.value &&
      jobs.value.some((j) => reviewPending(j.status))
    )
      void refresh();
  }
  watch(
    () => user.value?.login,
    () => {
      generation++;
      clearTimeout(timer);
      inFlight = false;
      removing.value = "";
      removedIds.clear();
      jobs.value = [];
      error.value = "";
      void refresh();
    },
    { immediate: true },
  );
  document.addEventListener("visibilitychange", visible);
  onUnmounted(() => {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visible);
  });
  return { jobs, loading, removing, error, refresh, remove, upsert };
}
