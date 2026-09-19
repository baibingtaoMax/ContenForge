<template>
  <div class="jlv-tool">
    <!-- 工具条 -->
    <div class="tool-bar">
      <div class="bar-left">
        <template v-if="parsed.ok && arrays.length">
          <span class="bar-label">选择数组</span>
          <el-select v-model="selectedIndex" size="small" class="path-select">
            <el-option
              v-for="(a, i) in arrays"
              :key="i"
              :label="`${a.label}（${a.count} 条）`"
              :value="i"
            />
          </el-select>
        </template>
        <span v-else-if="parsed.ok" class="warn-hint">
          <AppIcon name="info" :size="13" /> 没找到对象数组（数组元素得是对象，标量数组如 [1,2,3] 不成表）
        </span>
      </div>
      <div class="bar-right">
        <el-button size="small" :disabled="!rows.length" @click="copyToExcel">
          <AppIcon name="copy" :size="13" /> 复制到 Excel
        </el-button>
        <el-button size="small" @click="inputCollapsed = !inputCollapsed">
          <AppIcon :name="inputCollapsed ? 'eye' : 'minimize'" :size="13" />
          {{ inputCollapsed ? '展开 JSON' : '收起输入' }}
        </el-button>
        <el-button size="small" @click="showMapping = !showMapping">
          <AppIcon name="map" :size="13" /> 列名映射<span v-if="mapCount"> · {{ mapCount }}</span>
        </el-button>
        <el-button size="small" @click="loadSample">示例</el-button>
        <el-button size="small" :disabled="!raw" @click="raw = ''">清空</el-button>
      </div>
    </div>

    <!-- 列名映射（折叠） -->
    <el-collapse-transition>
      <div v-show="showMapping" class="mapping-box">
        <div class="mapping-head">
          <span>粘字段对照表，表头自动显示中文（关页面即失效，不保存）</span>
          <div class="mapping-head-right">
            <el-radio-group v-model="mapMode" size="small">
              <el-radio-button value="mixed">整段粘贴</el-radio-button>
              <el-radio-button value="columns">左右分栏</el-radio-button>
            </el-radio-group>
            <span class="mapping-count" :class="{ zero: mapCount === 0 }">已识别 {{ mapCount }} 条</span>
          </div>
        </div>
        <div v-if="hasMappingInput" class="match-hint" :class="{ miss: unmatchedCols.length }">
          <template v-if="matchedCols.length">
            匹配到本表 {{ matchedCols.length }} / {{ columns.length }} 列
            <span v-if="unmatchedCols.length" class="miss-cols">· 未匹配：{{ unmatchedCols.join('、') }}</span>
          </template>
          <span v-else>没匹配到本表任何列，检查字段名 / key 是否对应</span>
        </div>
        <textarea
          v-if="mapMode === 'mixed'"
          v-model="mappingRaw"
          class="mapping-input"
          spellcheck="false"
          placeholder="支持三种贴法：&#10;entName&#9;企业名称&#10;creditCode: 统一社会信用代码&#10;{&quot;status&quot;:&quot;审批状态&quot;}"
        ></textarea>
        <div v-else class="mapping-columns">
          <textarea
            v-model="keysRaw"
            class="mapping-input"
            spellcheck="false"
            placeholder="每行一个 key&#10;entName&#10;creditCode&#10;status"
          ></textarea>
          <textarea
            v-model="namesRaw"
            class="mapping-input"
            spellcheck="false"
            placeholder="每行一个中文名（与左侧同行对应）&#10;企业名称&#10;统一社会信用代码&#10;审批状态"
          ></textarea>
        </div>
        <div v-if="mapMode === 'columns'" class="mapping-hint" :class="{ mismatch: colMismatch }">
          左 {{ colParse.leftCount ?? 0 }} 行 · 右 {{ colParse.rightCount ?? 0 }} 行<span v-if="colMismatch"> · 行数不一致，只有同一行两侧都有内容才会配对</span>
        </div>
      </div>
    </el-collapse-transition>

    <div class="jlv-grid" :class="{ collapsed: inputCollapsed }">
      <!-- 左：输入 -->
      <div v-show="!inputCollapsed" class="input-col">
        <div class="col-label">粘贴 JSON</div>
        <div class="input-shell" :class="{ 'has-err': !parsed.ok && raw.trim() }">
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
            placeholder="把接口返回、日志、mock 数据里的 JSON 粘进来，自动找出里面的列表摊成表格"
            @scroll="syncGutter"
          ></textarea>
        </div>
        <div v-if="!parsed.ok && raw.trim()" class="err-pane">
          <div class="err-head"><AppIcon name="info" :size="15" /> JSON 格式有误</div>
          <button
            v-if="parsed.error && parsed.error.pos >= 0"
            type="button"
            class="err-loc"
            title="点击定位到输入框中的错误行"
            @click="gotoErrorLine"
          >
            第 {{ parsed.error.line }} 行，第 {{ parsed.error.col }} 列 · 点击定位
          </button>
          <div class="err-msg">{{ parsed.error?.message }}</div>
          <div class="err-hint">{{ parsed.error?.hint }}</div>
        </div>
      </div>

      <!-- 右：表格 -->
      <div class="table-col">
        <div class="col-label">
          列表预览
          <span v-if="current" class="col-sub">共 {{ rows.length }} 条 · {{ columns.length }} 个字段</span>
        </div>
        <div class="table-shell">
          <el-table
            v-if="current"
            :data="pagedRows"
            size="small"
            border
            stripe
            class="jlv-table"
          >
            <el-table-column label="#" width="56" fixed align="center" :resizable="false">
              <template #default="{ $index }">{{ (page - 1) * PAGE_SIZE + $index + 1 }}</template>
            </el-table-column>
            <el-table-column
              v-for="col in columns"
              :key="col"
              :prop="col"
              :min-width="columnWidth(col)"
              resizable
              show-overflow-tooltip
            >
              <template #header>
                <span class="th-main">{{ cnOf(col) || col }}</span>
                <span v-if="cnOf(col)" class="th-sub">{{ col }}</span>
              </template>
              <template #default="{ row, $index }">
                <span
                  class="cell-v"
                  :class="cellClass(row[col])"
                  :data-complex="cellOf(row[col]).complex"
                  @click="openDetail(row[col], col, $index)"
                >{{ cellOf(row[col]).text || '—' }}</span>
              </template>
            </el-table-column>
          </el-table>
          <div v-else-if="!raw.trim()" class="state-pane">
            <AppIcon name="list" :size="30" />
            <p>粘贴后自动出表</p>
          </div>
          <div v-else-if="parsed.ok && !arrays.length" class="state-pane">
            <AppIcon name="info" :size="26" />
            <p>这段 JSON 里没有元素为对象的数组</p>
          </div>
        </div>
        <div v-if="rows.length > PAGE_SIZE" class="pager-bar">
          <el-pagination
            v-model:current-page="page"
            :page-size="PAGE_SIZE"
            :total="rows.length"
            layout="prev, pager, next, total"
            small
            background
          />
        </div>
      </div>
    </div>

    <!-- 嵌套值详情 -->
    <el-dialog v-model="detailVisible" :title="detailTitle" width="560px" append-to-body>
      <pre class="detail-pre">{{ detailText }}</pre>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { parseJsonText, type JsonValue } from '@/utils/jsonTool'
import {
  findObjectArrays,
  getStructRows,
  inferColumns,
  cellView,
  buildLabelMap,
  rowsToExcelTsv,
  lookupCn,
} from '@/utils/jsonListView'
import { parseMappingColumns } from '@/utils/jsonMapping'
import { ElMessage } from 'element-plus'

const PAGE_SIZE = 100

const raw = ref('')
const showMapping = ref(false)
const inputCollapsed = ref(false)
const selectedIndex = ref(0)
const page = ref(1)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const gutterEl = ref<HTMLElement | null>(null)

const SAMPLE = `{
  "code": 0,
  "message": "ok",
  "data": {
    "page": 1,
    "list": [
      {
        "id": 1001,
        "entName": "石家庄示例科技有限公司",
        "creditCode": "91130100MA07X1234B",
        "amount": 500,
        "status": "pending",
        "ext": { "industry": "制造业", "level": "A" },
        "approvals": [
          { "node": "受理", "pass": true, "opinion": "材料齐全" },
          { "node": "风控审查", "pass": null, "opinion": null }
        ]
      },
      {
        "id": 1002,
        "entName": "河北示例贸易有限公司",
        "creditCode": "91130100MA09Y5678C",
        "amount": 1200,
        "status": "approved",
        "ext": { "industry": "批发零售", "level": "B" },
        "approvals": [
          { "node": "受理", "pass": true, "opinion": "同意上报" }
        ]
      },
      {
        "id": 1003,
        "entName": "正定示例建材有限公司",
        "creditCode": "91130100MA08Z9012D",
        "amount": null,
        "status": "rejected",
        "ext": null,
        "approvals": []
      }
    ]
  }
}`

const parsed = computed(() => parseJsonText(raw.value))

// ── 行号列 / 错误定位 ───────────────────────────────────
const lineCount = computed(() => Math.max(raw.value.split('\n').length, 1))
const errLine = computed(() => (parsed.value.error && parsed.value.error.pos >= 0 ? parsed.value.error.line : 0))

function syncGutter() {
  if (gutterEl.value && inputEl.value) gutterEl.value.scrollTop = inputEl.value.scrollTop
}

function gotoErrorLine() {
  const line = errLine.value
  const ta = inputEl.value
  if (!line || !ta) return
  const lines = raw.value.split('\n')
  const start = lines.slice(0, line - 1).reduce((s, l) => s + l.length + 1, 0)
  ta.focus()
  ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0))
  const lh = parseFloat(getComputedStyle(ta).lineHeight || '22')
  const block = ta.clientHeight / 1.75 / lh
  ta.scrollTop = Math.max(0, (line - 1 - block) * lh)
  syncGutter()
}

const arrays = computed(() =>
  parsed.value.ok && parsed.value.value !== undefined ? findObjectArrays(parsed.value.value) : []
)

// 数据换了：选中下标越界就回第一条
watch(
  arrays,
  (list) => {
    if (selectedIndex.value >= list.length) {
      selectedIndex.value = 0
      page.value = 1
    }
  },
  { immediate: true }
)

const current = computed(() => arrays.value[selectedIndex.value] || null)

const rows = computed<Record<string, JsonValue>[]>(() => {
  if (!parsed.value.ok || parsed.value.value === undefined || !current.value) return []
  return getStructRows(parsed.value.value, current.value.struct).filter(
    (v): v is Record<string, JsonValue> => v !== null && typeof v === 'object' && !Array.isArray(v)
  )
})

const columns = computed(() => inferColumns(rows.value))

const pagedRows = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

watch(rows, () => {
  const maxPage = Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE))
  if (page.value > maxPage) page.value = maxPage
})

// 切数组回到第一页
watch(selectedIndex, () => {
  page.value = 1
})

// ── 列名映射 ───────────────────────────────────────────
const mapMode = ref<'mixed' | 'columns'>('mixed')
const mappingRaw = ref('')
const keysRaw = ref('')
const namesRaw = ref('')

const mixedParse = computed(() => buildLabelMap(mappingRaw.value))
const colParse = computed(() => parseMappingColumns(keysRaw.value, namesRaw.value))
const labelMap = computed(() => (mapMode.value === 'columns' ? colParse.value.map : mixedParse.value.map))
const mapCount = computed(() => {
  if (mapMode.value === 'columns') return colParse.value.count
  return mappingRaw.value.trim() ? mixedParse.value.count : 0
})
const colMismatch = computed(
  () => (colParse.value.leftCount ?? 0) !== (colParse.value.rightCount ?? 0)
)

// 当前表的列，有多少被映射命中（归一化后算命中）
const matchedCols = computed(() => columns.value.filter((c) => lookupCn(labelMap.value, c) !== undefined))
const unmatchedCols = computed(() => columns.value.filter((c) => lookupCn(labelMap.value, c) === undefined))
const hasMappingInput = computed(() =>
  mapMode.value === 'columns' ? keysRaw.value.trim() || namesRaw.value.trim() : mappingRaw.value.trim()
)

function cellOf(v: JsonValue | undefined) {
  return cellView(v)
}
function cellClass(v: JsonValue | undefined) {
  return `kind-${cellView(v).kind}`
}
function cnOf(col: string) {
  return lookupCn(labelMap.value, col)
}
function columnWidth(col: string) {
  return cnOf(col) ? 150 : 130
}

// ── 嵌套值详情弹窗 ──────────────────────────────────────
const detailVisible = ref(false)
const detailTitle = ref('')
const detailText = ref('')

function openDetail(v: JsonValue | undefined, col: string, indexInPage: number) {
  const c = cellView(v)
  if (!c.complex) return
  detailTitle.value = `${cnOf(col) || col} · 第 ${(page.value - 1) * PAGE_SIZE + indexInPage + 1} 行`
  detailText.value = c.detail
  detailVisible.value = true
}

function loadSample() {
  raw.value = SAMPLE
}

async function copyToExcel() {
  const tsv = rowsToExcelTsv(rows.value, columns.value, labelMap.value)
  try {
    await navigator.clipboard.writeText(tsv)
    ElMessage.success(`已复制 ${rows.value.length} 行 × ${columns.value.length} 列，粘到 Excel / 飞书表格即可成表`)
  } catch {
    // 剪贴板权限被拒时的兜底
    const ta = document.createElement('textarea')
    ta.value = tsv
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      ElMessage.success(`已复制 ${rows.value.length} 行 × ${columns.value.length} 列，粘到 Excel / 飞书表格即可成表`)
    } catch {
      ElMessage.error('复制失败，浏览器不允许剪贴板访问')
    }
    document.body.removeChild(ta)
  }
}
</script>

<style scoped lang="scss">
.jlv-tool {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
}
.tool-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  .bar-left, .bar-right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .bar-label { font-size: 12.5px; font-weight: 600; color: var(--pf-text-2); }
  .path-select { width: 300px; }
  .warn-hint { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: #b45309; }
}
.mapping-box {
  flex-shrink: 0;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-subtle, #f8fafc);
  padding: 10px 12px;
  .mapping-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--pf-text-2);
    margin-bottom: 6px;
    .mapping-head-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .mapping-count { font-weight: 700; color: #059669; &.zero { color: var(--pf-text-3); } }
  }
  .mapping-columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .mapping-hint {
    margin-top: 6px;
    font-size: 11.5px;
    color: var(--pf-text-3);
    &.mismatch { color: #b45309; }
  }
  .match-hint {
    margin-bottom: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: #059669;
    word-break: break-all;
    .miss-cols { font-weight: 400; color: #b45309; }
    &.miss { color: #b45309; }
  }
  .mapping-input {
    width: 100%;
    min-height: 74px;
    resize: vertical;
    border: 1px solid var(--pf-border);
    border-radius: 8px;
    background: var(--pf-bg-surface);
    padding: 8px 10px;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--pf-text-1);
    outline: none;
    &:focus { border-color: var(--pf-primary, #6366f1); }
  }
}
.jlv-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: 12px;
  &.collapsed { grid-template-columns: minmax(0, 1fr); }
}
.input-col, .table-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.col-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-text-2);
  padding: 0 2px 6px;
  display: flex;
  gap: 10px;
  align-items: baseline;
  .col-sub { font-weight: 400; color: var(--pf-text-3); }
}
.input-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
  overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
  &:focus-within { border-color: var(--pf-primary, #6366f1); box-shadow: 0 0 0 3px rgba(99,102,241,.12); }
  &.has-err { border-color: #fecdca; }
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
  border: none;
  background: transparent;
  padding: 12px 14px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--pf-text-1);
  outline: none;
  resize: none;
  &::placeholder { color: var(--pf-text-3); font-family: var(--pf-font-sans, inherit); }
}
.err-pane {
  flex-shrink: 0;
  margin-top: 8px;
  background: #fef3f2;
  border: 1px solid #fecdca;
  border-radius: 8px;
  padding: 10px 12px;
  .err-head { display: flex; align-items: center; gap: 6px; color: #b42318; font-weight: 700; font-size: 13px; }
  .err-loc {
    margin-top: 6px;
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12.5px;
    font-weight: 700;
    color: #b42318;
    background: #fee4e2;
    border: 1px solid #fecdca;
    border-radius: 6px;
    padding: 5px 10px;
    width: fit-content;
    cursor: pointer;
    transition: background .15s;
    &:hover { background: #fecdca; }
  }
  .err-msg { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: #7a271a; margin-top: 6px; word-break: break-all; }
  .err-hint { font-size: 12.5px; color: #5b3a32; margin-top: 4px; }
}
.table-shell {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
}
.state-pane {
  height: 100%;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--pf-text-3);
  p { margin: 0; font-size: 13px; }
}
.jlv-table {
  width: 100%;
  cursor: default;
  :deep(.th-main) { font-weight: 700; }
  :deep(.th-sub) {
    display: block;
    font-size: 10.5px;
    font-weight: 400;
    color: var(--pf-text-3);
    font-family: ui-monospace, Menlo, monospace;
  }
  :deep(.cell-v) {
    font-size: 12.5px;
    word-break: break-all;
    &[data-complex='true'] {
      color: var(--pf-primary, #6366f1);
      cursor: pointer;
      text-decoration: underline dotted;
      text-underline-offset: 3px;
    }
    &.kind-null, &.kind-empty { color: var(--pf-text-3); }
    &.kind-number { font-family: ui-monospace, Menlo, monospace; }
    &.kind-boolean { color: #7c3aed; }
  }
}
.pager-bar {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
.detail-pre {
  margin: 0;
  max-height: 52vh;
  overflow: auto;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 10px;
  padding: 14px 16px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.7;
}
</style>
