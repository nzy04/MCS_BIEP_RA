<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import {
  Table,
  TableRow,
  TableCell,
  TableHeader,
} from "@tiptap/extension-table";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  ImagePlus,
  Table2,
  Undo2,
  Redo2,
  Quote,
  Code2,
} from "lucide-vue-next";
import type { NoteAsset } from "../../shared/note";
import { readingTemplate } from "../../shared/document";
import { htmlToMarkdown } from "../services/htmlToMarkdown";
import { renderedMarkdown } from "../services/markdown";
import NoteAssetPanel from "./NoteAssetPanel.vue";
import PdfFigureTool from "./PdfFigureTool.vue";

const body = defineModel<string>({ required: true });
const props = defineProps<{
  assets: NoteAsset[];
  assetBase: string;
  paperFile: File | null;
  addImage: (file: File) => Promise<NoteAsset | null>;
}>();
const emit = defineEmits<{ removeAsset: [path: string] }>();
const sourceMode = shallowRef(false);
const imageOpen = shallowRef(false);
const pdfOpen = shallowRef(false);
const selectedFile = shallowRef<File | null>(null);
const imageCaption = shallowRef("");
const uploading = shallowRef(false);
const localError = shallowRef("");
let insertPosition: number | undefined;
let emitted = body.value;

const editor = useEditor({
  extensions: [
    StarterKit.configure({ link: false }),
    Image.configure({ allowBase64: true }),
    Link.configure({ openOnClick: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ],
  content: renderedMarkdown(body.value, props.assets, props.assetBase),
  editorProps: {
    attributes: {
      role: "textbox",
      "aria-label": "笔记正文",
      "aria-multiline": "true",
      class: "note-body rich-document",
    },
    handlePaste: (_view, event) => {
      const file = Array.from(event.clipboardData?.files || []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (!file) return false;
      event.preventDefault();
      rememberPosition();
      void insertFile(file);
      return true;
    },
  },
  onUpdate: ({ editor }) => {
    emitted = htmlToMarkdown(editor.getHTML(), props.assets, props.assetBase);
    body.value = emitted;
  },
});
watch(body, (value) => {
  if (value !== emitted) {
    emitted = value;
    editor.value?.commands.setContent(
      renderedMarkdown(value, props.assets, props.assetBase),
      { emitUpdate: false },
    );
  }
});
watch(sourceMode, (value) => {
  if (!value)
    editor.value?.commands.setContent(
      renderedMarkdown(body.value, props.assets, props.assetBase),
      { emitUpdate: false },
    );
});
const inTable = computed(() => editor.value?.isActive("table") || false);
const blockStyle = computed(
  () =>
    [2, 3, 4]
      .find((level) => editor.value?.isActive("heading", { level }))
      ?.toString() || "paragraph",
);
function setBlock(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  const chain = editor.value?.chain().focus();
  if (value === "paragraph") chain?.setParagraph().run();
  else chain?.setHeading({ level: Number(value) as 2 | 3 | 4 }).run();
}
function rememberPosition() {
  insertPosition = editor.value?.state.selection.from;
}
function showImage() {
  rememberPosition();
  imageOpen.value = true;
  selectedFile.value = null;
  imageCaption.value = "";
  localError.value = "";
}
function insertAsset(asset: NoteAsset, caption = "") {
  if (!editor.value) return;
  const src = asset.dataUrl || `${props.assetBase}/${asset.path}`;
  const position = Math.min(
    insertPosition ?? editor.value.state.selection.from,
    editor.value.state.doc.content.size,
  );
  editor.value
    .chain()
    .focus()
    .insertContentAt(position, [
      {
        type: "image",
        attrs: { src, alt: caption || asset.name || "笔记插图" },
      },
      {
        type: "paragraph",
        ...(caption ? { content: [{ type: "text", text: caption }] } : {}),
      },
    ])
    .run();
  insertPosition = undefined;
}
async function insertFile(file: File, caption = "") {
  uploading.value = true;
  localError.value = "";
  try {
    const asset = await props.addImage(file);
    if (asset) {
      await nextTick();
      insertAsset(asset, caption);
      imageOpen.value = false;
      pdfOpen.value = false;
    }
  } catch (e) {
    localError.value = (e as Error).message;
  } finally {
    uploading.value = false;
  }
}
function removeAsset(asset: NoteAsset) {
  const document = new DOMParser().parseFromString(
    editor.value?.getHTML() || "",
    "text/html",
  );
  for (const image of document.querySelectorAll("img")) {
    const src = image.getAttribute("src");
    if (
      src === asset.path ||
      src === asset.dataUrl ||
      src === `${props.assetBase}/${asset.path}`
    )
      image.remove();
  }
  editor.value?.commands.setContent(document.body.innerHTML, {
    emitUpdate: true,
  });
  emit("removeAsset", asset.path);
}
function insertTemplate() {
  editor.value
    ?.chain()
    .focus()
    .insertContent(renderedMarkdown(readingTemplate))
    .run();
}
</script>
<template>
  <section class="body-editor" aria-label="正文编辑">
    <div class="body-editor-heading">
      <h2>阅读笔记</h2>
      <div>
        <button type="button" class="text-link" @click="insertTemplate">
          插入参考模板</button
        ><button
          type="button"
          class="text-link"
          :aria-pressed="sourceMode"
          @click="sourceMode = !sourceMode"
        >
          {{ sourceMode ? "图文编辑" : "Markdown" }}
        </button>
      </div>
    </div>
    <div
      v-if="editor && !sourceMode"
      class="editor-toolbar"
      role="toolbar"
      aria-label="正文工具"
    >
      <select :value="blockStyle" aria-label="段落格式" @change="setBlock">
        <option value="paragraph">正文</option>
        <option value="2">一级标题</option>
        <option value="3">二级标题</option>
        <option value="4">三级标题</option>
      </select>
      <button
        type="button"
        aria-label="加粗"
        :aria-pressed="editor.isActive('bold')"
        @click="editor.chain().focus().toggleBold().run()"
      >
        <Bold :size="17" />
      </button>
      <button
        type="button"
        aria-label="斜体"
        :aria-pressed="editor.isActive('italic')"
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <Italic :size="17" />
      </button>
      <button
        type="button"
        aria-label="无序列表"
        :aria-pressed="editor.isActive('bulletList')"
        @click="editor.chain().focus().toggleBulletList().run()"
      >
        <List :size="18" />
      </button>
      <button
        type="button"
        aria-label="有序列表"
        :aria-pressed="editor.isActive('orderedList')"
        @click="editor.chain().focus().toggleOrderedList().run()"
      >
        <ListOrdered :size="18" />
      </button>
      <button
        type="button"
        aria-label="引用"
        :aria-pressed="editor.isActive('blockquote')"
        @click="editor.chain().focus().toggleBlockquote().run()"
      >
        <Quote :size="16" />
      </button>
      <button
        type="button"
        aria-label="代码块"
        :aria-pressed="editor.isActive('codeBlock')"
        @click="editor.chain().focus().toggleCodeBlock().run()"
      >
        <Code2 :size="18" />
      </button>
      <button type="button" aria-label="插入图片" @click="showImage">
        <ImagePlus :size="17" />图片
      </button>
      <button
        type="button"
        aria-label="插入表格"
        @click="
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        "
      >
        <Table2 :size="17" />表格
      </button>
      <button
        v-if="paperFile"
        type="button"
        @click="
          rememberPosition();
          pdfOpen = true;
        "
      >
        PDF 选页插图
      </button>
      <button
        type="button"
        aria-label="撤销"
        :disabled="!editor.can().undo()"
        @click="editor.chain().focus().undo().run()"
      >
        <Undo2 :size="16" />
      </button>
      <button
        type="button"
        aria-label="重做"
        :disabled="!editor.can().redo()"
        @click="editor.chain().focus().redo().run()"
      >
        <Redo2 :size="16" />
      </button>
    </div>
    <div v-if="inTable && editor && !sourceMode" class="table-tools">
      <button
        type="button"
        @click="editor.chain().focus().toggleHeaderRow().run()"
      >
        切换表头</button
      ><button
        type="button"
        @click="editor.chain().focus().addRowAfter().run()"
      >
        添加行</button
      ><button
        type="button"
        @click="editor.chain().focus().addColumnAfter().run()"
      >
        添加列</button
      ><button type="button" @click="editor.chain().focus().mergeCells().run()">
        合并单元格</button
      ><button type="button" @click="editor.chain().focus().splitCell().run()">
        拆分单元格</button
      ><button type="button" @click="editor.chain().focus().deleteRow().run()">
        删除行</button
      ><button
        type="button"
        @click="editor.chain().focus().deleteColumn().run()"
      >
        删除列</button
      ><button
        type="button"
        @click="editor.chain().focus().deleteTable().run()"
      >
        删除表格
      </button>
    </div>
    <textarea
      v-if="sourceMode"
      v-model="body"
      aria-label="Markdown 正文"
      class="markdown-source"
      spellcheck="false"
    />
    <EditorContent v-else :editor="editor" />
    <NoteAssetPanel
      :assets="assets"
      :asset-base="assetBase"
      @insert="insertAsset($event)"
      @remove="removeAsset"
    />
    <div
      v-if="imageOpen"
      class="modal-backdrop"
      @click.self="imageOpen = false"
    >
      <section
        class="image-insert-dialog"
        role="dialog"
        aria-label="插入图片"
        aria-modal="true"
      >
        <h2>插入图片</h2>
        <label class="field"
          >图片文件<input
            data-testid="editor-image-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            @change="
              selectedFile =
                ($event.target as HTMLInputElement).files?.[0] || null
            " /></label
        ><label class="field"
          >图注<input
            v-model="imageCaption"
            placeholder="图号、说明及原文页码（可选）"
        /></label>
        <p v-if="localError" class="alert error">{{ localError }}</p>
        <div class="action-group">
          <button
            class="button secondary"
            type="button"
            @click="imageOpen = false"
          >
            取消</button
          ><button
            class="button primary"
            type="button"
            :disabled="!selectedFile || uploading"
            @click="selectedFile && insertFile(selectedFile, imageCaption)"
          >
            {{ uploading ? "正在处理…" : "插入正文" }}
          </button>
        </div>
      </section>
    </div>
    <PdfFigureTool
      v-if="pdfOpen && paperFile"
      :file="paperFile"
      :busy="uploading"
      @image="insertFile($event.file, $event.caption)"
      @close="pdfOpen = false"
    />
  </section>
</template>
