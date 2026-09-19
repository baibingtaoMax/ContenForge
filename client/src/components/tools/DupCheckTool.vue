<template>
  <div class="dup-tool">
    <!-- 工具条 -->
    <div class="tool-bar">
      <div class="bar-left">
        <span class="bar-tip">一行一条数据（企业名称、信用代码、手机号…），自动忽略首尾空格和空行</span>
      </div>
      <div class="bar-right">
        <el-button size="small" @click="loadSample">示例</el-button>
        <el-button size="small" :disabled="!rawA && !rawB" @click="clearAll">清空</el-button>
      </div>
    </div>

    <!-- 双输入 -->
    <div class="input-grid">
      <div class="input-col">
        <div class="col-label">
          A 名单
          <span class="line-count">{{ result.a.total }} 行 · {{ result.a.unique }} 个不同</span>
        </div>
        <textarea
          v-model="rawA"
          class="data-input"
          spellcheck="false"
          placeholder="从 Excel 复制一列粘进来&#10;石家庄甲有限公司&#10;河北乙有限公司"
        ></textarea>
      </div>
      <div class="input-col">
        <div class="col-label">
          B 名单
          <span class="line-count">{{ result.b.total }} 行 · {{ result.b.unique }} 个不同</span>
        </div>
        <textarea
          v-model="rawB"
          class="data-input"
          spellcheck="false"
          placeholder="第二批数据，留空则只查 A 名单内部重复&#10;河北乙有限公司&#10;石家庄丙有限公司"
        ></textarea>
      </div>
    </div>

    <!-- 结果 -->
    <div class="result-shell">
      <div v-if="!hasAny" class="state-pane">
        <AppIcon name="layers" :size="30" />
        <p>粘入数据后自动查重，无需点按钮</p>
      </div>
      <template v-else>
        <!-- 概览 -->
        <div class="stat-row">
          <div class="stat-card both" :class="{ dim: !hasBoth }">
            <div class="stat-num">{{ hasBoth ? result.both.length : '—' }}</div>
            <div class="stat-label">两边都有</div>
          </div>
          <div class="stat-card onlya" :class="{ dim: !hasBoth }">
            <div class="stat-num">{{ hasBoth ? result.onlyA.length : '—' }}</div>
            <div class="stat-label">仅 A 有</div>
          </div>
          <div class="stat-card onlyb" :class="{ dim: !hasBoth }">
            <div class="stat-num">{{ hasBoth ? result.onlyB.length : '—' }}</div>
            <div class="stat-label">仅 B 有</div>
          </div>
          <div class="stat-card dup" :class="{ dim: result.a.dups.length === 0 }">
            <div class="stat-num">{{ result.a.dups.length }}</div>
            <div class="stat-label">A 内部重复<span v-if="result.a.extraCount">（多 {{ result.a.extraCount }} 行）</span></div>
          </div>
          <div class="stat-card dup" :class="{ dim: result.b.dups.length === 0 }">
            <div class="stat-num">{{ result.b.dups.length }}</div>
            <div class="stat-label">B 内部重复<span v-if="result.b.extraCount">（多 {{ result.b.extraCount }} 行）</span></div>
          </div>
        </div>

        <!-- 明细 -->
        <el-tabs v-model="activeTab" class="dup-tabs">
          <el-tab-pane name="both">
            <template #label>
              <span class="tab-label">两边都有<em class="tab-badge">{{ result.both.length }}</em></span>
            </template>
          </el-tab-pane>
          <el-tab-pane name="onlyA">
            <template #label>
              <span class="tab-label">仅 A 有<em class="tab-badge">{{ result.onlyA.length }}</em></span>
            </template>
          </el-tab-pane>
          <el-tab-pane name="onlyB">
            <template #label>
              <span class="tab-label">仅 B 有<em class="tab-badge">{{ result.onlyB.length }}</em></span>
            </template>
          </el-tab-pane>
          <el-tab-pane name="dupA">
            <template #label>
              <span class="tab-label">A 内部重复<em class="tab-badge" :class="{ zero: !result.a.dups.length }">{{ result.a.dups.length }}</em></span>
            </template>
          </el-tab-pane>
          <el-tab-pane name="dupB">
            <template #label>
              <span class="tab-label">B 内部重复<em class="tab-badge" :class="{ zero: !result.b.dups.length }">{{ result.b.dups.length }}</em></span>
            </template>
          </el-tab-pane>
        </el-tabs>

        <!-- 当前 tab 明细列表 -->
        <div class="list-panel">
          <div class="list-bar">
            <span class="list-count">{{ currentRows.length }} 条</span>
            <button
              type="button"
              class="copy-btn"
              :disabled="!currentRows.length || currentEmpty"
              @click="copyCurrent"
            >复制本列表</button>
          </div>
          <div v-if="currentEmpty" class="list-zero">
            {{ hasBoth ? '没有这类数据，干净 ✅' : '需要 A、B 两边都粘数据才能比对' }}
          </div>
          <div v-else class="list-body">
            <div v-for="(it, i) in currentRows" :key="i" class="dup-row" :class="`tone-${it.tone}`">
              <span class="dup-value" :title="it.value">{{ it.value }}</span>
              <span class="dup-tags">
                <em v-for="(t, j) in it.tags" :key="j" class="dup-tag" :class="`tag-${t.tone}`">{{ t.text }}</em>
              </span>
              <span class="dup-meta">{{ it.meta }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { checkDup, itemsToText, type CommonItem, type LineItem } from '@/utils/dupCheck'

const rawA = ref('')
const rawB = ref('')
const activeTab = ref<'both' | 'onlyA' | 'onlyB' | 'dupA' | 'dupB'>('both')

const SAMPLE_A = `石家庄甲有限公司
河北乙有限公司
石家庄丙有限公司
河北乙有限公司
91130100MA0000011X
91130100MA0000022Y
正定丁商贸有限公司
石家庄甲有限公司`

const SAMPLE_B = `河北乙有限公司
邯郸戊科技有限公司
91130100MA0000011X
91130100MA0000011X
邢台己建材有限公司
石家庄丙有限公司`

const result = computed(() => checkDup(rawA.value, rawB.value))
const hasAny = computed(() => result.value.a.total > 0 || result.value.b.total > 0)
const hasBoth = computed(() => result.value.a.total > 0 && result.value.b.total > 0)

type Tone = 'both' | 'only' | 'dup'
interface DupRow {
  value: string
  tags: { text: string; tone: Tone }[]
  meta: string
  tone: Tone
}

const bothRows = computed<DupRow[]>(() =>
  result.value.both.map((x: CommonItem) => ({
    value: x.value,
    tone: 'both',
    tags: [
      { text: `A ×${x.countA}`, tone: 'both' as Tone },
      { text: `B ×${x.countB}`, tone: 'both' as Tone },
    ],
    meta: `A 第 ${x.firstLineA} 行 · B 第 ${x.firstLineB} 行`,
  }))
)
function onlyRows(items: LineItem[]): DupRow[] {
  return items.map((x) => ({
    value: x.value,
    tone: 'only',
    tags: [{ text: `×${x.count}`, tone: 'only' as Tone }],
    meta: `第 ${x.firstLine} 行`,
  }))
}
function dupRows(items: LineItem[]): DupRow[] {
  return items.map((x) => ({
    value: x.value,
    tone: 'dup',
    tags: [{ text: `重复 ${x.count} 次`, tone: 'dup' as Tone }],
    meta: `第 ${x.lines.join('、')} 行`,
  }))
}

const currentRows = computed<DupRow[]>(() => {
  const r = result.value
  switch (activeTab.value) {
    case 'both':
      return bothRows.value
    case 'onlyA':
      return onlyRows(r.onlyA)
    case 'onlyB':
      return onlyRows(r.onlyB)
    case 'dupA':
      return dupRows(r.a.dups)
    case 'dupB':
      return dupRows(r.b.dups)
  }
})
// 交集/差集类 tab 在只粘了一边时无意义
const currentEmpty = computed(
  () => !hasBoth.value && (activeTab.value === 'both' || activeTab.value === 'onlyA' || activeTab.value === 'onlyB')
)

async function copyCurrent() {
  const items = currentRows.value
  if (!items.length || currentEmpty.value) return
  const labelMap: Record<string, string> = {
    both: '两边都有',
    onlyA: '仅 A 有',
    onlyB: '仅 B 有',
    dupA: 'A 内部重复',
    dupB: 'B 内部重复',
  }
  const text = itemsToText(items)
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制「${labelMap[activeTab.value]}」${items.length} 条`)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      ElMessage.success(`已复制「${labelMap[activeTab.value]}」${items.length} 条`)
    } catch {
      ElMessage.error('复制失败，浏览器不允许剪贴板访问')
    }
    document.body.removeChild(ta)
  }
}

function loadSample() {
  rawA.value = SAMPLE_A
  rawB.value = SAMPLE_B
}
function clearAll() {
  rawA.value = ''
  rawB.value = ''
}
</script>

<style scoped lang="scss">
.dup-tool {
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
  .bar-left, .bar-right { display: flex; gap: 8px; align-items: center; }
  .bar-tip { font-size: 12.5px; color: var(--pf-text-3); }
}
.input-grid {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  height: 190px;
}
.input-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.col-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-text-2);
  padding: 0 2px 6px;
  display: flex;
  gap: 10px;
  align-items: baseline;
  .line-count { font-weight: 400; color: var(--pf-text-3); }
}
.data-input {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
  padding: 10px 12px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--pf-text-1);
  outline: none;
  resize: none;
  &:focus { border-color: var(--pf-primary, #6366f1); box-shadow: 0 0 0 3px rgba(99,102,241,.12); }
  &::placeholder { color: var(--pf-text-3); font-family: var(--pf-font-sans, inherit); }
}
.result-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
  padding: 14px 16px 12px;
}
.state-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--pf-text-3);
  p { margin: 0; font-size: 13px; }
}
.stat-row {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
  padding-bottom: 4px;
}
.stat-card {
  border: 1px solid var(--pf-border);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--pf-bg-subtle, #f8fafc);
  &.both { border-color: #a7f3d0; background: #ecfdf5; }
  &.onlya, &.onlyb { border-color: #c7d2fe; background: #eef2ff; }
  &.dup { border-color: #fde68a; background: #fffbeb; }
  &.dim { opacity: .45; }
  .stat-num { font-size: 22px; font-weight: 800; line-height: 1.2; color: var(--pf-text-1); font-variant-numeric: tabular-nums; }
  .stat-label { font-size: 11.5px; color: var(--pf-text-2); margin-top: 2px; white-space: nowrap; }
}
.dup-tabs {
  flex-shrink: 0;
  :deep(.el-tabs__header) { margin: 8px 0 0; }
  :deep(.el-tabs__content) { display: none; }
}
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  .tab-badge {
    font-style: normal;
    font-size: 11px;
    font-weight: 700;
    background: var(--pf-bg-subtle, #eef2f7);
    color: var(--pf-text-2);
    border-radius: 999px;
    padding: 0 7px;
    line-height: 17px;
    &.zero { color: var(--pf-text-3); }
  }
}
.list-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 10px;
  border-top: 1px solid var(--pf-border);
}
.list-bar {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2px 8px;
  .list-count { font-size: 12px; color: var(--pf-text-3); font-weight: 600; }
  .copy-btn {
    border: 1px solid var(--pf-border);
    background: var(--pf-bg-surface);
    border-radius: 7px;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--pf-text-2);
    cursor: pointer;
    transition: all .15s;
    &:hover:not(:disabled) { border-color: var(--pf-primary, #6366f1); color: var(--pf-primary, #6366f1); }
    &:disabled { opacity: .5; cursor: default; }
  }
}
.list-zero {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--pf-text-3);
  font-size: 13px;
}
.list-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.dup-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--pf-border);
  border-radius: 8px;
  padding: 7px 12px;
  background: var(--pf-bg-surface);
  &.tone-both { border-left: 3px solid #10b981; }
  &.tone-only { border-left: 3px solid #6366f1; }
  &.tone-dup { border-left: 3px solid #f59e0b; }
}
.dup-value {
  font-size: 13px;
  color: var(--pf-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, Menlo, monospace;
}
.dup-tags { display: inline-flex; gap: 5px; }
.dup-tag {
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  border-radius: 5px;
  padding: 1px 7px;
  white-space: nowrap;
  &.tag-both { background: #d1fae5; color: #047857; }
  &.tag-only { background: #e0e7ff; color: #4338ca; }
  &.tag-dup { background: #fef3c7; color: #b45309; }
}
.dup-meta { font-size: 11.5px; color: var(--pf-text-3); white-space: nowrap; }
</style>
