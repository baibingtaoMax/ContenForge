<template>
  <div class="json-tool">
    <!-- 工具条 -->
    <div class="tool-bar">
      <div class="bar-left">
        <el-radio-group v-if="parsed.ok" v-model="view" size="small">
          <el-radio-button value="tree">树状视图</el-radio-button>
          <el-radio-button value="code">格式化代码</el-radio-button>
        </el-radio-group>
        <span v-if="parsed.ok" class="struct-hint">
          <AppIcon name="check" :size="13" /> {{ summaryText }}
        </span>
        <div v-if="parsed.ok" class="search-box">
          <el-input
            v-model="keyword"
            size="small"
            placeholder="搜索键名 / 值"
            clearable
            class="search-input"
            @keyup.enter="gotoHit($event.shiftKey ? -1 : 1)"
            @clear="resetSearch"
          >
            <template #prefix><AppIcon name="search" :size="13" /></template>
          </el-input>
          <template v-if="keyword.trim()">
            <span class="hit-count" :class="{ zero: hitTotal === 0 }">{{ hitTotal ? `${hitIndex + 1}/${hitTotal}` : '0/0' }}</span>
            <el-button size="small" class="nav-btn" :disabled="hitTotal === 0" @click="gotoHit(-1)">
              <el-icon><ArrowUp /></el-icon>
            </el-button>
            <el-button size="small" class="nav-btn" :disabled="hitTotal === 0" @click="gotoHit(1)">
              <el-icon><ArrowDown /></el-icon>
            </el-button>
          </template>
        </div>
      </div>
      <div class="bar-right">
        <template v-if="parsed.ok">
          <el-button-group v-if="view === 'tree'" size="small" class="tree-toggle-group">
            <el-button @click="expandAll(true)">全部展开</el-button>
            <el-button @click="expandAll(false)">全部折叠</el-button>
          </el-button-group>
          <el-button size="small" @click="doMinify">
            <AppIcon name="minimize" :size="13" /> 压成一行
          </el-button>
          <el-button size="small" @click="copyOutput">
            <AppIcon name="copy" :size="13" /> 复制结果
          </el-button>
        </template>
        <el-button size="small" @click="stripEscape">去转义</el-button>
        <el-button size="small" @click="loadSample">示例</el-button>
        <el-button size="small" :disabled="!raw" @click="clearAll">清空</el-button>
      </div>
    </div>

    <div class="json-grid">
      <!-- 左：输入 -->
      <div class="input-col">
        <div class="col-label">粘贴 JSON</div>
        <div class="input-shell">
          <div ref="gutterEl" class="line-gutter" aria-hidden="true">
            <span
              v-for="n in lineCount"
              :key="n"
              class="ln"
              :class="{ 'is-err': n === errLine }"
            >{{ n }}</span>
          </div>
          <textarea
            ref="inputEl"
            v-model="raw"
            class="json-input"
            spellcheck="false"
            placeholder="把接口返回、日志、mock 数据里的 JSON 粘进来，自动解析&#10;被转义裹了一层的（{&quot;a&quot;:...}）点「去转义」"
            @scroll="onInputScroll"
          ></textarea>
          <Transition name="bt-fade">
            <button v-if="showInputTop" type="button" class="back-top" title="回到顶部" @click="scrollToTop('input')">
              <el-icon :size="16"><Top /></el-icon>
            </button>
          </Transition>
        </div>
      </div>

      <!-- 右：结果 -->
      <div class="output-col">
        <div class="col-label">解析结果</div>
        <div ref="outputEl" class="json-output" @scroll="onOutputScroll">
          <!-- 空态 -->
          <div v-if="!raw.trim()" class="state-pane empty">
            <el-icon :size="30"><Document /></el-icon>
            <p>粘贴后自动出结果</p>
          </div>

          <!-- 错误态 -->
          <div v-else-if="!parsed.ok" class="state-pane error">
            <div class="err-head">
              <el-icon :size="18"><WarningFilled /></el-icon>
              <strong>JSON 格式有误</strong>
            </div>
            <button
              v-if="parsed.error && parsed.error.pos >= 0"
              type="button"
              class="err-loc"
              title="点击定位到输入框中的错误行"
              @click="gotoErrorLine"
            >
              <el-icon :size="13"><Aim /></el-icon>
              第 {{ parsed.error.line }} 行，第 {{ parsed.error.col }} 列 · 点击定位
            </button>
            <div class="err-msg">{{ parsed.error?.message }}</div>
            <div class="err-hint">
              <el-icon :size="14"><InfoFilled /></el-icon>
              {{ parsed.error?.hint }}
            </div>
          </div>

          <!-- 树状视图 -->
          <div v-else-if="view === 'tree'" class="tree-pane">
            <JsonTreeNode
              :value="parsed.value as JsonValue"
              :depth="0"
              :global-signal="globalSignal"
              :global-open="globalOpen"
              :search="treeSearch"
            />
          </div>

          <!-- 代码视图 -->
          <pre ref="codePaneEl" v-else class="code-pane" v-html="marked.html"></pre>
        </div>
        <Transition name="bt-fade">
          <button v-if="showOutputTop" type="button" class="back-top" title="回到顶部" @click="scrollToTop('output')">
            <el-icon :size="16"><Top /></el-icon>
          </button>
        </Transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { Document, WarningFilled, InfoFilled, ArrowUp, ArrowDown, Aim, Top } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import JsonTreeNode from './JsonTreeNode.vue'
import {
  parseJsonText,
  stripEscapes,
  minifyJson,
  highlightJson,
  summarize,
  searchJson,
  markKeywordInHtml,
  type JsonTreeSearch,
  type JsonValue,
} from '@/utils/jsonTool'

const raw = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const gutterEl = ref<HTMLElement | null>(null)
const outputEl = ref<HTMLElement | null>(null)
const showInputTop = ref(false)
const showOutputTop = ref(false)
const view = ref<'tree' | 'code'>('tree')
const globalSignal = ref(0)
const globalOpen = ref(true)

const SAMPLE = `{
  "企业名称": "石家庄示例科技有限公司",
  "统一社会信用代码": "91130100MA07X1234B",
  "担保金额_万元": 500,
  "审批状态": "pending",
  "审批记录": [
    { "环节": "受理", "通过": true, "意见": "材料齐全" },
    { "环节": "风控审查", "通过": null, "意见": null }
  ],
  "创建时间": "2026-09-12T10:30:00+08:00"
}`

const parsed = computed(() => parseJsonText(raw.value))

// ── 行号列 ────────────────────────────────────────────
const lineCount = computed(() => Math.max(raw.value.split('\n').length, 1))
const errLine = computed(() => (parsed.value.error && parsed.value.error.pos >= 0 ? parsed.value.error.line : 0))

function syncGutter() {
  if (gutterEl.value && inputEl.value) gutterEl.value.scrollTop = inputEl.value.scrollTop
}

// 滚过约一屏才显示悬浮回顶按钮
function onInputScroll() {
  syncGutter()
  if (inputEl.value) showInputTop.value = inputEl.value.scrollTop > inputEl.value.clientHeight * 0.8
}
function onOutputScroll() {
  const el = outputEl.value
  if (el) showOutputTop.value = el.scrollTop > el.clientHeight * 0.8
}
function scrollToTop(which: 'input' | 'output') {
  const el = which === 'input' ? inputEl.value : outputEl.value
  el?.scrollTo({ top: 0, behavior: 'smooth' })
}

function gotoErrorLine() {
  const line = errLine.value
  const ta = inputEl.value
  if (!line || !ta) return
  const lines = raw.value.split('\n')
  const start = lines.slice(0, line - 1).reduce((s, l) => s + l.length + 1, 0)
  ta.focus()
  ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
  // 把错误行滚到输入框约 1/3 处
  const block = ta.clientHeight / 1.75 / parseFloat(getComputedStyle(ta).lineHeight || '22')
  ta.scrollTop = Math.max(0, (line - 1 - block) * parseFloat(getComputedStyle(ta).lineHeight || '22'))
  syncGutter()
}
const highlighted = computed(() => (parsed.value.pretty ? highlightJson(parsed.value.pretty) : ''))
const summaryText = computed(() => (parsed.value.value !== undefined ? summarize(parsed.value.value) : ''))

// ── 搜索 ──────────────────────────────────────────────
const keyword = ref('')
const activeIndex = ref(-1) // 树视图当前命中
const codeIdx = ref(-1) // 代码视图当前 mark 序号
const activeTick = ref(0)

const hits = computed(() =>
  parsed.value.ok && parsed.value.value !== undefined ? searchJson(parsed.value.value, keyword.value) : []
)

// 搜索词/数据变化后，树视图选中序号回到第一个
watch(hits, (list) => {
  activeIndex.value = list.length ? 0 : -1
  activeTick.value++
})

const treeSearch = computed<JsonTreeSearch | null>(() => {
  const kw = keyword.value.trim()
  if (!parsed.value.ok || !kw) return null
  const keyHits = new Set<string>()
  const valueHits = new Set<string>()
  const expand = new Set<string>()
  for (const h of hits.value) {
    ;(h.inKey ? keyHits : valueHits).add(JSON.stringify(h.path))
    // 命中节点 + 所有祖先都强制展开
    for (let len = 0; len <= h.path.length; len++) expand.add(JSON.stringify(h.path.slice(0, len)))
  }
  const active = hits.value[activeIndex.value]
  return {
    active: true,
    keyword: kw,
    keyHits,
    valueHits,
    expand,
    activeKey: active ? JSON.stringify(active.path) : null,
    activeTick: activeTick.value,
  }
})

// 代码视图：高亮后的 HTML 里套 mark
const marked = computed(() =>
  parsed.value.pretty ? markKeywordInHtml(highlightJson(parsed.value.pretty), keyword.value) : { html: '', count: 0 }
)

// 搜索词/数据变化后，代码视图选中序号回到第一个
watch(
  () => marked.value.count,
  (n) => {
    codeIdx.value = n ? 0 : -1
    if (n && view.value === 'code') scrollCodeMark()
  }
)

// 当前视图下的命中总数与序号
const hitTotal = computed(() => (view.value === 'code' ? marked.value.count : hits.value.length))
const hitIndex = computed(() => (view.value === 'code' ? codeIdx.value : activeIndex.value))

const codePaneEl = ref<HTMLElement | null>(null)

function scrollCodeMark() {
  nextTick(() => {
    const marks = codePaneEl.value?.querySelectorAll('mark.j-find')
    marks?.forEach((m) => m.classList.remove('is-active'))
    const el = marks?.[codeIdx.value] as HTMLElement | undefined
    el?.classList.add('is-active')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function gotoHit(delta: number) {
  // 代码视图按 mark 跳转
  if (view.value === 'code') {
    const n = marked.value.count
    if (!n) return
    if (codeIdx.value < 0) codeIdx.value = 0
    else codeIdx.value = (codeIdx.value + delta + n) % n
    scrollCodeMark()
    return
  }
  // 树视图按命中节点跳转（自动展开祖先由 treeSearch.expand 负责）
  const n = hits.value.length
  if (!n) return
  activeIndex.value = (activeIndex.value < 0 ? 0 : activeIndex.value + delta + n) % n
  activeTick.value++
}

// 切到代码视图且有搜索词时，定位当前命中
watch(view, (v) => {
  if (v === 'code' && keyword.value.trim() && marked.value.count) scrollCodeMark()
})

function resetSearch() {
  keyword.value = ''
  activeIndex.value = -1
  codeIdx.value = -1
}

function expandAll(open: boolean) {
  globalOpen.value = open
  globalSignal.value++
}

async function copyText(text: string, okMsg = '已复制') {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(okMsg)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      ElMessage.success(okMsg)
    } catch {
      ElMessage.error('复制失败，浏览器不允许剪贴板访问')
    }
    document.body.removeChild(ta)
  }
}

function copyOutput() {
  if (parsed.value.pretty) copyText(parsed.value.pretty)
}

function doMinify() {
  if (parsed.value.value !== undefined) {
    raw.value = minifyJson(parsed.value.value)
    view.value = 'code'
    ElMessage.success('已压成一行，可直接复制')
  }
}

function stripEscape() {
  const inner = stripEscapes(raw.value)
  if (inner === null) {
    ElMessage.info('没有可剥的转义外层（当前内容不是被字符串包着的 JSON）')
    return
  }
  raw.value = inner
  ElMessage.success('已剥掉一层转义')
}

function loadSample() {
  raw.value = SAMPLE
}

function clearAll() {
  raw.value = ''
}
</script>

<style scoped lang="scss">
.json-tool {
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
  .bar-left { display: flex; gap: 12px; align-items: center; }
  .bar-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .struct-hint {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: #059669;
    font-weight: 600;
  }
  .search-box {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .search-input { width: 190px; }
  .hit-count {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12px;
    font-weight: 600;
    color: var(--pf-text-2);
    min-width: 34px;
    text-align: center;
    &.zero { color: #b42318; }
  }
  .nav-btn { padding: 5px 7px; }
}
.json-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.input-col, .output-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; position: relative; }
.col-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-text-2);
  padding: 0 2px 6px;
}
.input-shell {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
  overflow: hidden;
  transition: border-color .15s;
  &:focus-within { border-color: var(--pf-primary, #6366f1); box-shadow: 0 0 0 3px rgba(99,102,241,.12); }
}
.line-gutter {
  flex-shrink: 0;
  height: 100%;
  overflow: hidden;
  padding: 12px 8px 12px 12px;
  min-width: 42px;
  text-align: right;
  background: #f8fafc;
  border-right: 1px solid var(--pf-border);
  user-select: none;
  .ln {
    display: block;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    line-height: 1.75;
    color: #9aa4b2;
    &.is-err { color: #b42318; font-weight: 700; }
  }
}
.json-input {
  flex: 1 1 auto;
  align-self: stretch;
  min-width: 0;
  height: 100%;
  resize: none;
  border: none;
  background: transparent;
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--pf-text-1);
  outline: none;
  &::placeholder { color: var(--pf-text-3); font-family: var(--pf-font-sans, inherit); }
}
.back-top {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--pf-border);
  border-radius: 50%;
  background: rgba(255,255,255,.92);
  color: var(--pf-text-2);
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(15,23,42,.14);
  backdrop-filter: blur(4px);
  transition: color .15s, border-color .15s, transform .15s;
  &:hover {
    color: var(--pf-primary, #6366f1);
    border-color: var(--pf-primary, #6366f1);
    transform: translateY(-2px);
  }
}
.bt-fade-enter-active, .bt-fade-leave-active { transition: opacity .2s, transform .2s; }
.bt-fade-enter-from, .bt-fade-leave-to { opacity: 0; transform: translateY(6px); }
.json-output {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
}
.state-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  text-align: center;
  &.empty {
    color: var(--pf-text-3);
    p { margin: 0; font-size: 13px; }
  }
  &.error {
    justify-content: flex-start;
    align-items: stretch;
    background: #fef3f2;
    .err-head {
      display: flex; align-items: center; gap: 8px;
      color: #b42318; font-size: 15px;
    }
    .err-loc {
      font-family: ui-monospace, Menlo, monospace;
      font-size: 13px;
      font-weight: 700;
      color: #b42318;
      background: #fee4e2;
      border: 1px solid #fecdca;
      border-radius: 6px;
      padding: 6px 10px;
      width: fit-content;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: background .15s;
      &:hover { background: #fecdca; }
    }
    .err-msg {
      font-family: ui-monospace, Menlo, monospace;
      font-size: 12.5px;
      color: #7a271a;
      word-break: break-all;
    }
    .err-hint {
      margin-top: 4px;
      display: flex;
      align-items: flex-start;
      gap: 6px;
      font-size: 13px;
      line-height: 1.6;
      color: #5b3a32;
      background: #fff;
      border: 1px solid #fecdca;
      border-radius: 8px;
      padding: 10px 12px;
      .el-icon { flex-shrink: 0; margin-top: 3px; color: #b42318; }
    }
  }
}
.tree-pane {
  padding: 10px 12px;
}
.code-pane {
  margin: 0;
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--pf-text-1);
  white-space: pre;
  // v-html 高亮内容拿不到 scoped 属性，用 :deep
  :deep(.jk) { color: #4f46e5; font-weight: 600; }
  :deep(.js) { color: #047857; }
  :deep(.jn) { color: #b45309; }
  :deep(.jb) { color: #7c3aed; font-weight: 600; }
  :deep(.jl) { color: #9ca3af; font-style: italic; }
  :deep(mark.j-find) {
    background: #fde68a;
    color: inherit;
    border-radius: 3px;
    padding: 0 1px;
  }
  :deep(mark.j-find.is-active) {
    background: #f59e0b;
    color: #1f2937;
    box-shadow: 0 0 0 2px rgba(245,158,11,.35);
  }
}
</style>
