<script setup lang="ts">
import {
  nextTick,
  onMounted,
  onUnmounted,
  shallowRef,
  useTemplateRef,
} from "vue";
export interface ContextAction {
  label: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
}
const props = defineProps<{ x: number; y: number; items: ContextAction[] }>();
const emit = defineEmits<{ close: [] }>();
const menu = useTemplateRef<HTMLElement>("menu");
const left = shallowRef(props.x),
  top = shallowRef(props.y);
function outside(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node)) emit("close");
}
function key(event: KeyboardEvent) {
  if (event.key === "Escape" || event.key === "Tab") {
    emit("close");
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(
    menu.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ||
      [],
  );
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length
  ]?.focus();
}
onMounted(async () => {
  await nextTick();
  const box = menu.value?.getBoundingClientRect();
  if (box) {
    left.value = Math.max(8, Math.min(props.x, innerWidth - box.width - 8));
    top.value = Math.max(8, Math.min(props.y, innerHeight - box.height - 8));
  }
  menu.value
    ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
    ?.focus();
  document.addEventListener("pointerdown", outside);
});
onUnmounted(() => document.removeEventListener("pointerdown", outside));
</script>
<template>
  <Teleport to="body"
    ><div
      ref="menu"
      class="context-menu"
      role="menu"
      aria-label="快捷操作"
      :style="{ left: `${left}px`, top: `${top}px` }"
      @keydown="key"
      @contextmenu.prevent
    >
      <button
        v-for="(item, i) in items"
        :key="i"
        role="menuitem"
        type="button"
        :disabled="item.disabled"
        :class="{ danger: item.danger }"
        @click="
          item.run();
          $emit('close');
        "
      >
        {{ item.label }}
      </button>
    </div></Teleport
  >
</template>
<style scoped>
.context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 170px;
  max-width: calc(100vw - 16px);
  padding: 5px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 4px;
  box-shadow: 0 6px 22px #132d4524;
}
.context-menu button {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 2px;
  padding: 9px 13px;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
}
.context-menu button:hover,
.context-menu button:focus-visible {
  background: #edf3f7;
  outline: 0;
}
.context-menu button.danger {
  color: #b42318;
}
.context-menu button:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
