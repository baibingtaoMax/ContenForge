<template>
  <div class="md-editor">
    <div class="md-toolbar">
      <button type="button" class="md-tb-btn" title="标题" @click="wrapLine('## ', '')">H</button>
      <button type="button" class="md-tb-btn" title="加粗" @click="wrapSelection('**', '**')"><b>B</b></button>
      <button type="button" class="md-tb-btn" title="斜体" @click="wrapSelection('*', '*')"><i>I</i></button>
      <button type="button" class="md-tb-btn" title="无序列表" @click="wrapLine('- ', '')">• 列表</button>
      <button type="button" class="md-tb-btn" title="有序列表" @click="wrapLine('1. ', '')">1.</button>
      <button type="button" class="md-tb-btn" title="引用" @click="wrapLine('> ', '')">”</button>
      <button type="button" class="md-tb-btn" title="链接" @click="insertLink()">链接</button>
      <button type="button" class="md-tb-btn" title="插入图片（也可直接粘贴截图）" @click="pickFile()">
        <AppIcon name="upload" :size="13" :stroke-width="2.2" /> 图片
      </button>
      <span v-if="uploading" class="md-uploading">⏳ 图片上传中…</span>
      <span v-else class="md-hint">支持 Markdown，可直接 ⌘V 粘贴截图</span>
      <input ref="fileInput" type="file" accept="image/*" style="display:none" @change="onFileChange" />
    </div>
    <textarea
      ref="taRefInner"
      class="md-textarea"
      :value="modelValue"
      rows="10"
      :placeholder="placeholder"
      @input="onInput"
      @paste="onPaste"
    ></textarea>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(defineProps<{
  modelValue: string
  uploading?: boolean
  placeholder?: string
}>(), {
  placeholder: '背景、原话反馈、具体场景、待澄清的问题……可以多写，能贴截图',
})
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'paste-image', payload: { file: File; ta: HTMLTextAreaElement }): void
  (e: 'pick-image', payload: { file: File; ta: HTMLTextAreaElement }): void
}>()

const taRefInner = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

function wrapSelection(left: string, right: string) {
  const ta = taRefInner.value
  if (!ta) return
  const start = ta.selectionStart ?? props.modelValue.length
  const end = ta.selectionEnd ?? start
  const selected = props.modelValue.slice(start, end) || '文字'
  const next = props.modelValue.slice(0, start) + left + selected + right + props.modelValue.slice(end)
  emit('update:modelValue', next)
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(start + left.length, start + left.length + selected.length)
  })
}

/** 行首插入前缀（作用于选区覆盖的每一行） */
function wrapLine(prefix: string, _suffix: string) {
  const ta = taRefInner.value
  if (!ta) return
  const start = ta.selectionStart ?? props.modelValue.length
  const end = ta.selectionEnd ?? start
  const lineStart = props.modelValue.lastIndexOf('\n', start - 1) + 1
  const block = props.modelValue.slice(lineStart, end)
  const replaced = block.split('\n').map((l) => prefix + l).join('\n')
  const next = props.modelValue.slice(0, lineStart) + replaced + props.modelValue.slice(end)
  emit('update:modelValue', next)
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(lineStart + prefix.length, lineStart + replaced.length)
  })
}

function insertLink() {
  const ta = taRefInner.value
  const start = ta?.selectionStart ?? props.modelValue.length
  const snippet = '[链接文字](https://)'
  const next = props.modelValue.slice(0, start) + snippet + props.modelValue.slice(start)
  emit('update:modelValue', next)
  requestAnimationFrame(() => {
    ta?.focus()
    // 选中 url 部分方便直接替换
    ta?.setSelectionRange(start + snippet.length - 9, start + snippet.length - 1)
  })
}

function pickFile() {
  fileInput.value?.click()
}
function onFileChange() {
  const file = fileInput.value?.files?.[0]
  if (file && taRefInner.value) emit('pick-image', { file, ta: taRefInner.value })
  if (fileInput.value) fileInput.value.value = ''
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file && taRefInner.value) {
        e.preventDefault()
        emit('paste-image', { file, ta: taRefInner.value })
      }
      return
    }
  }
}
</script>

<style scoped lang="scss">
.md-editor {
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-md, 8px);
  overflow: hidden;
  background: #fff;
  &:focus-within { border-color: var(--pf-primary); box-shadow: 0 0 0 2px rgba(99, 102, 241, .12); }
}
.md-toolbar {
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 6px 10px;
  border-bottom: 1px solid var(--pf-border);
  background: var(--pf-bg);
}
.md-tb-btn {
  border: 0; background: none; cursor: pointer;
  font-size: 12px; color: var(--pf-text-2);
  padding: 3px 8px; border-radius: 5px;
  display: inline-flex; align-items: center; gap: 3px;
  transition: background .12s, color .12s;
  &:hover { background: var(--pf-bg-hover); color: var(--pf-primary); }
}
.md-uploading { margin-left: auto; font-size: 12px; color: var(--pf-warning, #d97706); }
.md-hint { margin-left: auto; font-size: 11.5px; color: var(--pf-text-3); }
.md-textarea {
  display: block; width: 100%; box-sizing: border-box;
  border: 0; outline: none; resize: vertical;
  padding: 10px 12px; min-height: 220px;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 13px; line-height: 1.7; color: var(--pf-text-1);
  background: #fff;
}
</style>
