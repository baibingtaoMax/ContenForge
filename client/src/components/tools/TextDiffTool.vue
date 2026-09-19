<template>
  <div class="text-diff-tool">
    <!-- 工具条（两态共用） -->
    <div class="tool-bar">
      <div class="bar-left">
        <div class="sw"><el-switch v-model="ignoreTrim" size="small" /><span @click="ignoreTrim = !ignoreTrim">忽略首尾空格</span></div>
        <div class="sw"><el-switch v-model="collapseSame" size="small" /><span @click="collapseSame = !collapseSame">折叠相同行</span></div>
      </div>
      <div class="bar-right">
        <template v-if="mode === 'result'">
          <span class="diff-stat">
            <em class="n-add">+{{ stats.adds }}</em>
            <em class="n-del">−{{ stats.dels }}</em>
            <em v-if="changedLines" class="n-mod">改 {{ changedLines }}</em>
            <span v-if="isSame" class="same-tag">两版完全一致</span>
          </span>
        </template>
        <el-button size="small" :disabled="!hasInput" @click="swap">
          <AppIcon name="git-compare" :size="13" /> 交换
        </el-button>
        <el-button size="small" :disabled="!hasInput" @click="clearAll">清空</el-button>
        <el-button
          v-if="mode === 'edit'"
          size="small"
          type="primary"
          :disabled="!bothFilled"
          @click="enterResult"
        >开始比对</el-button>
        <el-button v-else size="small" type="primary" plain @click="backToEdit">
          <AppIcon name="edit" :size="13" /> 编辑文本
        </el-button>
      </div>
    </div>

    <!-- 编辑态：双栏粘贴框占满 -->
    <div v-if="mode === 'edit'" class="input-grid">
      <div class="input-col">
        <div class="input-label old">原文</div>
        <textarea
          v-model="oldText"
          class="diff-input"
          placeholder="粘贴原始版本（Word / 文档 / 聊天记录直接 ⌘V）"
          spellcheck="false"
          @paste="onPaste"
          @keydown.meta.enter="enterResult"
          @keydown.ctrl.enter="enterResult"
        ></textarea>
      </div>
      <div class="input-col">
        <div class="input-label new">新文</div>
        <textarea
          v-model="newText"
          class="diff-input"
          placeholder="粘贴修改后的版本，两栏都有内容自动出结果（也可 ⌘↵）"
          spellcheck="false"
          @paste="onPaste"
          @keydown.meta.enter="enterResult"
          @keydown.ctrl.enter="enterResult"
        ></textarea>
      </div>
    </div>

    <!-- 结果态：整区就是 diff -->
    <DiffResultPane v-else :rows="rows" :collapse-same="collapseSame" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import DiffResultPane from '@/components/tools/DiffResultPane.vue'
import { lineDiff } from '@/utils/lineDiff'
import { pairRows } from '@/utils/charDiff'

const oldText = ref('')
const newText = ref('')
const ignoreTrim = ref(true)
const collapseSame = ref(false)
const mode = ref<'edit' | 'result'>('edit')

function normalize(t: string): string {
  if (!ignoreTrim.value) return t
  return t.split('\n').map((l) => l.trim()).join('\n')
}

const rows = ref(pairRows(lineDiff('', '')))
function recompute() {
  rows.value = pairRows(lineDiff(normalize(oldText.value), normalize(newText.value)))
}

// 结果态下切换「忽略空格」即时重算；编辑态不用跟
watch(ignoreTrim, () => {
  if (mode.value === 'result') recompute()
})

const stats = computed(() => {
  let adds = 0
  let dels = 0
  for (const r of rows.value) {
    if (r.op === 'add') adds++
    else if (r.op === 'del') dels++
    else if (r.op === 'mod') { adds++; dels++ }
  }
  return { adds, dels }
})
const changedLines = computed(() => rows.value.filter((r) => r.op === 'mod').length)
const hasInput = computed(() => !!(oldText.value.trim() || newText.value.trim()))
const bothFilled = computed(() => !!(oldText.value.trim() && newText.value.trim()))
const isSame = computed(() => stats.value.adds === 0 && stats.value.dels === 0)

/** 粘贴后两栏都有内容 → 自动进入结果态（即用即走，无需点按钮） */
async function onPaste() {
  await nextTick()
  if (bothFilled.value) enterResult()
}
function enterResult() {
  if (!bothFilled.value) return
  recompute()
  mode.value = 'result'
}
function backToEdit() {
  mode.value = 'edit'
}
function swap() {
  const t = oldText.value
  oldText.value = newText.value
  newText.value = t
  if (mode.value === 'result') recompute()
}
function clearAll() {
  oldText.value = ''
  newText.value = ''
  mode.value = 'edit'
}
</script>

<style scoped lang="scss">
.text-diff-tool {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 12px;
}
.tool-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  .bar-left { display: flex; gap: 18px; align-items: center; }
  .bar-right { display: flex; gap: 8px; align-items: center; }
  .sw { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--pf-text-2); user-select: none;
    span { cursor: pointer; }
  }
}
.diff-stat {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 700;
  font-style: normal;
  margin-right: 4px;
  .n-add { color: #059669; font-style: normal; }
  .n-del { color: #dc2626; font-style: normal; }
  .n-mod { color: var(--pf-primary, #6366f1); font-style: normal; font-weight: 600; }
  .same-tag { color: var(--pf-text-3); font-weight: 500; }
}
.input-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.input-col { display: flex; flex-direction: column; min-width: 0; }
.input-label {
  font-size: 12px; font-weight: 600; padding: 0 2px 6px;
  &.old { color: #b91c1c; }
  &.new { color: #047857; }
}
.diff-input {
  flex: 1;
  resize: none;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--pf-text-1);
  outline: none;
  transition: border-color .15s;
  &:focus { border-color: var(--pf-primary, #6366f1); box-shadow: 0 0 0 3px rgba(99,102,241,.12); }
  &::placeholder { color: var(--pf-text-3); font-family: var(--pf-font-sans, inherit); }
}
</style>
