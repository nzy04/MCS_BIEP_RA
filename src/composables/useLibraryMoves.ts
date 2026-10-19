import { shallowRef } from "vue";
import type { NoteSummary } from "../../shared/note";
import { directionKey, type MoveNotesRequest } from "../../shared/directions";

export function useLibraryMoves(
  move: (request: MoveNotesRequest) => Promise<void>,
) {
  const dragging = shallowRef<NoteSummary[]>([]),
    source = shallowRef<string | null>(null);
  const choosing = shallowRef<NoteSummary[]>([]),
    busy = shallowRef(false),
    error = shallowRef("");
  const pendingSource = shallowRef<string | null>(null);
  function inDirection(notes: NoteSummary[], direction: string | null) {
    return notes.filter(
      (n) =>
        direction === null ||
        n.tags.some((t) => directionKey(t) === directionKey(direction)),
    );
  }
  function start(
    event: DragEvent,
    notes: NoteSummary[],
    direction: string | null,
  ) {
    if (busy.value || !event.dataTransfer) return;
    dragging.value = inDirection(notes, direction);
    source.value = direction;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(
      "application/x-mcs-notes",
      dragging.value.map((n) => n.id).join(","),
    );
  }
  function end() {
    dragging.value = [];
  }
  function choose(notes: NoteSummary[], direction: string | null) {
    choosing.value = inDirection(notes, direction);
    pendingSource.value = direction;
    error.value = "";
  }
  async function perform(
    notes: NoteSummary[],
    from: string | null,
    target: string,
  ) {
    if (busy.value || !notes.length) return;
    busy.value = true;
    error.value = "";
    try {
      await move({
        notes: notes.map((n) => ({ id: n.id, revision: n.revision })),
        source: from,
        target,
      });
      choosing.value = [];
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      busy.value = false;
      end();
    }
  }
  async function drop(target: string) {
    const notes = dragging.value,
      from = source.value;
    end();
    await perform(notes, from, target);
  }
  return {
    dragging,
    choosing,
    pendingSource,
    busy,
    error,
    start,
    end,
    choose,
    drop,
    confirm: (target: string) =>
      perform(choosing.value, pendingSource.value, target),
  };
}
