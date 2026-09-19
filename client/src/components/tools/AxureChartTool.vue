<template>
  <div class="ax-chart-tool">
    <!-- 左：配置 -->
    <div class="cfg-pane">
      <div class="tool-bar">
        <el-radio-group v-model="mode" size="small">
          <el-radio-button value="wizard">向导模式</el-radio-button>
          <el-radio-button value="custom">自定义 option</el-radio-button>
        </el-radio-group>
        <el-button size="small" @click="resetAll">重置</el-button>
      </div>

      <div class="cfg-scroll">
      <!-- ========== 向导模式 ========== -->
      <template v-if="mode === 'wizard'">
        <div class="cfg-section picker-sec">
          <div class="sec-title picker-bar" @click="pickerOpen = !pickerOpen">
            图型
            <span class="picker-current">
              <i class="picker-glyph" v-html="activeGlyph"></i>{{ activeCard?.name }}
              <span class="picker-switch">{{ pickerOpen ? '收起 ▲' : '换图型 ▼' }}</span>
            </span>
          </div>
          <el-collapse-transition>
            <div v-show="pickerOpen" class="picker-wrap">
              <ChartTypePicker v-model="cardId" />
            </div>
          </el-collapse-transition>
          <p class="kind-desc">{{ activeCard?.desc }}</p>
        </div>

        <div class="cfg-section grow form-sec">
          <component :is="familyForm" :model="cfg" />
        </div>
      </template>

      <!-- ========== 自定义 option 模式 ========== -->
      <template v-else>
        <div class="cfg-section">
          <div class="sec-title">AI 生成图表 <span class="ai-badge">Beta</span></div>
          <el-input
            v-model="aiPrompt"
            type="textarea"
            :rows="2"
            size="small"
            placeholder="说要什么图，如：环形饼图展示担保公司收入构成 / 近三年担保发生额和在保余额的柱线组合图"
          />
          <el-input
            v-model="aiData"
            type="textarea"
            :rows="3"
            size="small"
            class="ai-data"
            placeholder="贴数据（选填）：Excel 表格、数字、JSON 都行，如：&#10;担保费收入 4680&#10;评审费收入 1280"
          />
          <div class="ai-actions">
            <el-button type="primary" size="small" :loading="aiLoading" @click="aiGenerate">
              {{ hasOption ? '按描述生成新图' : 'AI 生成' }}
            </el-button>
            <el-button size="small" :disabled="!hasOption || aiLoading" @click="aiAdjust">
              在当前图上调整
            </el-button>
            <span v-if="aiError" class="ai-err">{{ aiError }}</span>
          </div>
          <p v-if="hasOption" class="ai-hint">「在当前图上调整」= 拿着编辑器里的 option + 上面的指令改；你手改的内容也会一起带上。</p>
        </div>

        <div class="cfg-section grow">
          <div class="sec-title">自定义 ECharts option</div>
          <p class="kind-desc">
            写 ECharts option：可直接粘官网示例的完整代码（含数据生成、setInterval 动态刷新），也可以只写带 formatter 函数的对象字面量（纯 JSON 也行）。尺寸跟随 Axure 矩形，不用写 width/height。
          </p>
          <label class="field custom-label">
            <span>Axure 元件名（data-label）</span>
            <el-input v-model="customLabel" size="small" placeholder="如 chart_pie" />
          </label>
          <div class="json-bar">
            <el-button size="small" @click="loadCustomExample">填入饼图示例</el-button>
            <span class="json-status" :class="customError ? 'bad' : 'ok'">
              {{ customError ? '✗ ' + customError : '✓ 合法（对象 / 完整示例代码都行）' }}
            </span>
          </div>
          <textarea v-model="customJson" class="json-editor" spellcheck="false" placeholder="({ xAxis: { type: 'category', data: [...] }, tooltip: { formatter: (p) => ... } })"></textarea>
        </div>
      </template>
      </div>
    </div>

    <!-- 右：预览 + 导出 -->
    <div class="preview-pane">
      <div class="preview-head">
        <span>预览（等同 Axure 里的渲染效果）</span>
        <div class="preview-head-right">
          <el-tag size="small" type="info" effect="plain">{{ previewLabel || '未命名元件' }}</el-tag>
          <el-button size="small" text type="primary" :icon="FullScreen" @click="openLarge">放大预览</el-button>
        </div>
      </div>
      <div class="preview-card">
        <div ref="chartEl" class="chart-box"></div>
        <div v-if="echartsError" class="echarts-err">{{ echartsError }}</div>
      </div>

      <div class="export-box">
        <div class="export-title">贴进 Axure</div>
        <ol class="steps">
          <li>画一个矩形（图会自动铺满，尺寸你在 Axure 里随便调），在元件名称里命名为 <b>{{ previewLabel || '元件名' }}</b></li>
          <li>加交互「页面载入时 → 打开链接 → javascript:」，粘贴下面整段代码</li>
          <li>前提：发布页已引入 echarts（全局引入一次即可）</li>
        </ol>
        <div class="code-actions">
          <el-button type="primary" size="small" :icon="CopyDocument" :disabled="mode === 'custom' && !!customError" @click="copyCode">
            复制 javascript: 注入码
          </el-button>
          <span class="code-meta">{{ codeLength }} 字符</span>
        </div>
      </div>
    </div>

    <!-- 大尺寸预览弹框：真实像素验收 + 交互测试（不能编辑配置） -->
    <el-dialog
      v-model="largeVisible"
      :title="'放大预览 · ' + (previewLabel || '未命名元件')"
      width="88%" top="6vh"
      class="large-preview-dialog"
      destroy-on-close
      fullscreen
      @opened="onLargeOpened"
      @close="onLargeClosed"
    >
      <div class="lp-toolbar">
        <div class="lp-size">
          <el-input-number v-model="lpW" :min="200" :max="4000" :step="10" :controls="false" size="small" class="lp-num" @change="applyLargeSize" />
          <span class="lp-x">×</span>
          <el-input-number v-model="lpH" :min="120" :max="3000" :step="10" :controls="false" size="small" class="lp-num" @change="applyLargeSize" />
          <span class="lp-unit">px（与 Axure 矩形属性一致）</span>
        </div>
        <el-radio-group v-model="lpRatio" size="small" @change="applyRatio">
          <el-radio-button label="free">自由</el-radio-button>
          <el-radio-button label="16:9">16:9</el-radio-button>
          <el-radio-button label="4:3">4:3</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="lpPresetW" size="small" @change="applyPresetW">
          <el-radio-button :label="780">780</el-radio-button>
          <el-radio-button :label="900">900</el-radio-button>
          <el-radio-button :label="1200">1200</el-radio-button>
        </el-radio-group>
        <div class="lp-spacer"></div>
        <el-button size="small" type="primary" plain :icon="CopyDocument" :disabled="mode === 'custom' && !!customError" @click="copyCode">复制注入码</el-button>
      </div>
      <div class="lp-canvas" ref="lpCanvasEl">
        <div class="lp-rect" :style="{ width: (lpW || 900) + 'px', height: (lpH || 460) + 'px' }">
          <div class="lp-name">{{ previewLabel }} · {{ lpW || 900 }}×{{ lpH || 460 }}</div>
          <div ref="lpChartEl" class="lp-chart"></div>
          <div v-if="mode === 'custom' && customError" class="lp-err">option 有错误，修好左侧编辑器后这里会自动刷新</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component } from 'vue'
import { CopyDocument, FullScreen } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  migrateWizardCfg, type WizardCfg, type Family,
} from './axure-chart/chartTypes'
import { CHART_CATALOG, getCard } from './axure-chart/chartCatalog'
import { buildBookmarklet, buildCustomBookmarklet } from './axure-chart/chartInject'
import { mountChart, mountCustomSource, crCheckSource } from './axure-chart/chartRuntime.js'
import ChartTypePicker from './axure-chart/ChartTypePicker.vue'
import CartesianForm from './axure-chart/forms/CartesianForm.vue'
import WaterfallForm from './axure-chart/forms/WaterfallForm.vue'
import PieForm from './axure-chart/forms/PieForm.vue'
import FunnelForm from './axure-chart/forms/FunnelForm.vue'
import RadarForm from './axure-chart/forms/RadarForm.vue'
import ScatterForm from './axure-chart/forms/ScatterForm.vue'
import GaugeForm from './axure-chart/forms/GaugeForm.vue'
import TreemapForm from './axure-chart/forms/TreemapForm.vue'
import HeatmapForm from './axure-chart/forms/HeatmapForm.vue'
import SankeyForm from './axure-chart/forms/SankeyForm.vue'

/* ---------- 族 → 表单组件 ---------- */
const FAMILY_FORMS: Record<Family, Component> = {
  cartesian: CartesianForm,
  waterfall: WaterfallForm,
  pie: PieForm,
  funnel: FunnelForm,
  radar: RadarForm,
  scatter: ScatterForm,
  gauge: GaugeForm,
  treemap: TreemapForm,
  heatmap: HeatmapForm,
  sankey: SankeyForm,
}

/* ---------- 持久化（v3：按图型卡片分槽，切来切去不丢配置） ---------- */
const CUSTOM_EXAMPLE_SOURCE = `({
  color: ['#2b5cff', '#19c4c4', '#ff8f1f', '#aecbff'],
  tooltip: {
    trigger: 'item',
    // 函数随便写：params 是 ECharts 回调参数
    formatter: function (p) {
      return p.name + '<br/>金额：' + p.value.toLocaleString() + ' 万元（' + p.percent + '%）'
    }
  },
  legend: { bottom: 0, textStyle: { fontSize: 12 } },
  series: [{
    name: '收入构成', type: 'pie', radius: ['42%', '68%'], center: ['50%', '46%'],
    label: {
      fontSize: 11,
      formatter: function (p) { return p.name + '\\n' + p.percent + '%' }
    },
    data: [
      { value: 4680, name: '担保费收入' },
      { value: 1280, name: '评审费收入' },
      { value: 620, name: '咨询服务收入' },
      { value: 340, name: '其他收入' }
    ]
  }]
})`
const STORE_KEY = 'pf-axure-chart-v3'
const OLD_STORE_KEY = 'pf-axure-chart-v2'

interface StoreV3 {
  mode: 'wizard' | 'custom'
  cardId: string
  slots: Record<string, WizardCfg>
  customLabel: string
  customJson: string
}

/** 旧版 v2 柱线配置 → 最接近的卡片 */
function matchCardId(cfg: WizardCfg): string {
  if (cfg.family !== 'cartesian') { return CHART_CATALOG.find((c) => c.family === cfg.family)?.id ?? 'single-line' }
  if (cfg.yearQuarter) { return 'bar-rate' }
  if (cfg.horizontal) { return cfg.series.some((s) => s.values.some((v) => v < 0)) ? 'diverging-bar' : 'rank-bar' }
  if (cfg.stack === 'percent') { return 'pct-stack' }
  if (cfg.stack === 'normal') { return 'stacked-bar' }
  if (cfg.series.some((s) => s.axis === 'right')) { return cfg.series.filter((s) => s.type === 'bar').length >= 2 ? 'dual-mix' : 'bar-rate' }
  if (cfg.series.some((s) => s.type === 'bar')) { return cfg.series.some((s) => s.values.some((v) => v < 0)) ? 'posneg-bar' : 'grouped-bar' }
  return cfg.series.length > 1 ? 'multi-line' : 'single-line'
}

function defaultStore(): StoreV3 {
  const cardId = CHART_CATALOG[0].id
  return {
    mode: 'wizard',
    cardId,
    slots: { [cardId]: getCard(cardId)!.factory() },
    customLabel: 'chart_custom',
    customJson: CUSTOM_EXAMPLE_SOURCE,
  }
}

function loadStore(): StoreV3 {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as Partial<StoreV3>
      return { ...defaultStore(), ...s, slots: s.slots ?? {} }
    }
    /* 首次进 v3：迁一次旧 v2 数据 */
    const oldRaw = localStorage.getItem(OLD_STORE_KEY)
    if (oldRaw) {
      const old = JSON.parse(oldRaw) as { mode?: string; wizard?: unknown; customLabel?: string; customJson?: string }
      const migrated = migrateWizardCfg(old.wizard)
      const d = defaultStore()
      if (migrated) {
        const id = matchCardId(migrated)
        d.cardId = id
        d.slots = { [id]: migrated }
      }
      if (old.customLabel) { d.customLabel = old.customLabel }
      if (old.customJson) { d.customJson = old.customJson }
      if (old.mode === 'custom') { d.mode = 'custom' }
      return d
    }
  } catch {
    /* 损坏缓存走默认 */
  }
  return defaultStore()
}

const initial = loadStore()
const mode = ref<StoreV3['mode']>(initial.mode)
const cardId = ref<string>(initial.cardId)
const slots = ref<Record<string, WizardCfg>>(initial.slots)
const customLabel = ref(initial.customLabel)
const customJson = ref(initial.customJson)
const pickerOpen = ref(false)

const activeCard = computed(() => getCard(cardId.value))
const familyForm = computed<Component>(() => FAMILY_FORMS[activeCard.value?.family ?? 'cartesian'])
const activeGlyph = computed(() => {
  /* 复用选择器里的迷你图：直接渲染当前卡片 glyph */
  return glyphSvg(cardId.value)
})

/* 当前卡片配置：没有槽位时用 factory 补一个（不同设备/新版本首次打开新卡片） */
const cfg = computed<WizardCfg>(() => {
  const card = activeCard.value
  if (!card) { return slots.value[CHART_CATALOG[0].id] }
  if (!slots.value[card.id]) { slots.value[card.id] = card.factory() }
  return slots.value[card.id]
})

watch(cardId, () => { pickerOpen.value = false; scheduleRender() })

function resetAll() {
  const d = defaultStore()
  mode.value = d.mode
  cardId.value = d.cardId
  slots.value = d.slots
  customLabel.value = d.customLabel
  customJson.value = d.customJson
  ElMessage.success('已重置为演示数据')
}

/* 选择器 glyph（与 ChartTypePicker 保持一致的轻量复刻，供头部当前图型用） */
function glyphSvg(id: string): string {
  const picker = document.querySelector('.picker-wrap svg') as SVGElement | null
  if (picker) { return picker.outerHTML }
  return ''
}

/* ---------- 自定义 option ---------- */
function loadCustomExample() {
  customJson.value = CUSTOM_EXAMPLE_SOURCE
}

/* ---------- AI 生成 / 调整 ---------- */
const aiPrompt = ref('')
const aiData = ref('')
const aiLoading = ref(false)
const aiError = ref('')
const hasOption = computed(() => !!customParsed.value)

async function callAi(adjust: boolean) {
  const prompt = aiPrompt.value.trim()
  if (!prompt) { aiError.value = '先描述要什么图'; return }
  aiLoading.value = true; aiError.value = ''
  try {
    const resp = await fetch('/api/chart-ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        data: aiData.value.trim() || undefined,
        currentSource: adjust ? customJson.value : null,
      }),
    })
    const json = await resp.json()
    if (!resp.ok) { throw new Error(json.error || 'AI 生成失败') }
    customJson.value = json.source
    ElMessage.success(adjust ? '已按指令调整' : '已生成，可在下面继续手改')
  } catch (e) {
    aiError.value = (e as Error).message
  } finally {
    aiLoading.value = false
  }
}
function aiGenerate() { return callAi(false) }
function aiAdjust() { return callAi(true) }
const customParsed = computed(() => {
  if (mode.value !== 'custom') { return null }
  try { return crCheckSource(customJson.value) as unknown as Record<string, unknown> } catch { return null }
})
const customError = computed(() => {
  if (mode.value !== 'custom') { return '' }
  try {
    crCheckSource(customJson.value)
    return ''
  } catch (e) { return (e as Error).message }
})

/* ---------- ECharts ---------- */
const chartEl = ref<HTMLElement | null>(null)
const echartsError = ref('')
let echartsLib: any = null
let echartsPromise: Promise<any> | null = null
function loadECharts(): Promise<any> {
  if ((window as any).echarts) { return Promise.resolve((window as any).echarts) }
  if (echartsPromise) { return echartsPromise }
  echartsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = '/proto/echarts.min.js'
    s.onload = () => ((window as any).echarts ? resolve((window as any).echarts) : reject(new Error('图表库加载失败')))
    s.onerror = () => reject(new Error('图表库加载失败：请确认 ProtoForge 服务（:3100）已启动'))
    document.head.appendChild(s)
  })
  return echartsPromise
}

let renderQueued = false
function scheduleRender() {
  if (renderQueued) { return }
  renderQueued = true
  nextTick(() => { renderQueued = false; render() })
}
function render() {
  if (!echartsLib || !chartEl.value) { return }
  if (mode.value === 'custom') {
    if (!customError.value) {
      echartsError.value = ''
      mountCustomSource(chartEl.value, echartsLib, customJson.value)
    } else {
      echartsError.value = 'option 有错误，修好在左侧看预览'
    }
    return
  }
  echartsError.value = ''
  mountChart(chartEl.value, echartsLib, JSON.parse(JSON.stringify(cfg.value)))
}

/* ---------- 导出 ---------- */
const previewLabel = computed(() => mode.value === 'custom' ? customLabel.value : cfg.value.label)
const bookmarklet = computed(() => {
  if (mode.value === 'custom' && !customError.value) {
    return buildCustomBookmarklet({ label: customLabel.value, source: customJson.value })
  }
  return buildBookmarklet(cfg.value)
})
const codeLength = computed(() => bookmarklet.value.length)
async function copyCode() {
  try {
    await navigator.clipboard.writeText(bookmarklet.value)
    ElMessage.success('已复制，贴进 Axure 的 javascript: 动作里即可')
  } catch {
    ElMessage.error('复制失败，请手动选择代码复制')
  }
}

/* ---------- 大尺寸预览弹框 ---------- */
const largeVisible = ref(false)
const lpW = ref(900)
const lpH = ref(460)
const lpRatio = ref<'free' | '16:9' | '4:3'>('free')
const lpPresetW = ref(900)
const lpCanvasEl = ref<HTMLElement | null>(null)
const lpChartEl = ref<HTMLElement | null>(null)

function sizeStoreKey() {
  return 'pf-axure-lpsize:' + (previewLabel.value || 'chart')
}
function loadLpSize() {
  try {
    const raw = localStorage.getItem(sizeStoreKey())
    if (raw) {
      const s = JSON.parse(raw)
      if (s.w >= 200 && s.h >= 120) {
        lpW.value = s.w; lpH.value = s.h
        lpPresetW.value = [780, 900, 1200].includes(s.w) ? s.w : s.w
      }
    }
  } catch { /* 忽略损坏缓存 */ }
}
function saveLpSize() {
  localStorage.setItem(sizeStoreKey(), JSON.stringify({ w: lpW.value, h: lpH.value }))
}
function openLarge() {
  loadLpSize()
  largeVisible.value = true
}
function onLargeOpened() {
  nextTick(() => {
    renderLarge()
    if (lpCanvasEl.value) { lpCanvasEl.value.scrollLeft = 0; lpCanvasEl.value.scrollTop = 0 }
  })
}
function onLargeClosed() {
  if (lpChartEl.value && echartsLib) {
    const inst = echartsLib.getInstanceByDom(lpChartEl.value)
    if (inst) { inst.dispose() }
  }
}
function renderLarge() {
  if (!largeVisible.value || !lpChartEl.value || !echartsLib) { return }
  if (mode.value === 'custom') {
    if (!customError.value) {
      mountCustomSource(lpChartEl.value, echartsLib, customJson.value)
    }
    return
  }
  mountChart(lpChartEl.value, echartsLib, JSON.parse(JSON.stringify(cfg.value)))
}
function applyLargeSize() {
  if (!lpW.value || !lpH.value) { return }
  if (lpRatio.value !== 'free') { applyRatioH() }
  saveLpSize()
}
function applyRatioH() {
  if (lpRatio.value === '16:9') { lpH.value = Math.round(lpW.value * 9 / 16) }
  else if (lpRatio.value === '4:3') { lpH.value = Math.round(lpW.value * 3 / 4) }
}
function applyRatio() {
  applyRatioH()
  applyLargeSize()
}
function applyPresetW(w: number) {
  lpW.value = w
  applyRatioH()
  applyLargeSize()
}

watch([mode, cfg, customJson, customLabel], () => { persist(); scheduleRender(); renderLarge() }, { deep: true })

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    mode: mode.value, cardId: cardId.value, slots: slots.value,
    customLabel: customLabel.value, customJson: customJson.value,
  } satisfies StoreV3))
}

onMounted(async () => {
  try {
    echartsLib = await loadECharts()
    render()
    window.addEventListener('resize', scheduleRender)
  } catch (e) {
    echartsError.value = (e as Error).message
  }
})
</script>

<style scoped lang="scss">
.ax-chart-tool {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(460px, 1fr) 520px;
  gap: 14px;
  min-height: 0;
  padding: 14px 18px 18px;
}
.cfg-pane {
  display: flex; flex-direction: column; min-height: 0;
  background: #fff; border: 1px solid var(--pf-border, #e8eaf0); border-radius: 10px; overflow: hidden;
}
.cfg-scroll { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
.tool-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid #f0f1f5; flex: 0 0 auto; }

.cfg-section { padding: 12px 14px; border-bottom: 1px solid #f5f6f9;
  &.grow { flex: 1; display: flex; flex-direction: column; min-height: 0; border-bottom: 0; overflow: auto; } }
.sec-title { font-size: 13px; font-weight: 600; color: #1d2129; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }
.kind-desc { margin: 8px 0 0; font-size: 12px; color: #869099; line-height: 1.5; }

.picker-sec { flex: 0 0 auto; }
.picker-bar { cursor: pointer; user-select: none; margin-bottom: 0; }
.picker-current { margin-left: auto; font-size: 12px; font-weight: 500; color: #4e5969; display: inline-flex; align-items: center; gap: 6px;
  .picker-glyph { width: 30px; height: 20px; color: #6366f1; display: inline-flex; }
  .picker-switch { font-size: 11px; color: #a9b0bc; font-weight: 400; } }
.picker-wrap { margin-top: 10px; }
.form-sec { padding-top: 12px; }

.custom-label { margin-bottom: 10px; display: flex; flex-direction: column; gap: 4px;
  span { font-size: 11px; color: #869099; } }
.ai-badge { font-size: 10px; font-weight: 500; color: #7c5cff; background: #f0edff; border-radius: 4px; padding: 1px 6px; }
:deep(.el-textarea__inner) { font-size: 12px; }
.ai-data { margin-top: 8px; }
.ai-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.ai-err { font-size: 12px; color: #f53f3f; }
.ai-hint { margin: 8px 0 0; font-size: 11px; color: #a9b0bc; line-height: 1.5; }
.json-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.json-status { font-size: 12px; &.ok { color: #18a058; } &.bad { color: #f53f3f; } }
.json-editor {
  width: 100%; min-height: 500px; resize: vertical;  border: 1px solid #e5e6eb; border-radius: 8px;
  height: auto;
  overflow: auto;
  padding: 10px; font: 12px/1.6 ui-monospace, Menlo, Consolas, monospace; color: #1d2129; outline: none;
  background: #fcfcfd; box-sizing: border-box;
  &:focus { border-color: #2b5cff; background: #fff; }
}

.preview-pane { display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.preview-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 600; color: #1d2129; }
.preview-head-right { display: flex; align-items: center; gap: 4px; }
.preview-card { background: #fff; border: 1px solid var(--pf-border, #e8eaf0); border-radius: 10px; padding: 10px; position: relative; }
.chart-box { width: 496px; height: 300px; }
.echarts-err { position: absolute; inset: 10px; display: flex; align-items: center; justify-content: center;
  background: #fff8e8; color: #b87a00; font-size: 12px; border-radius: 8px; padding: 16px; text-align: center; }
.export-box { background: #fff; border: 1px solid var(--pf-border, #e8eaf0); border-radius: 10px; padding: 12px 14px; }
.export-title { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.steps { margin: 0 0 10px; padding-left: 18px; font-size: 12px; color: #4e5969; line-height: 1.8; b { color: #2b5cff; } }
.code-actions { display: flex; align-items: center; gap: 10px; }
.code-meta { font-size: 11px; color: #a9b0bc; }

.lp-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex: 0 0 auto; padding-bottom: 10px; }
.lp-size { display: flex; align-items: center; gap: 6px; }
.lp-num { width: 92px; }
.lp-x { color: #a9b0bc; font-size: 13px; }
.lp-unit { font-size: 11px; color: #a9b0bc; margin-left: 2px; }
.lp-spacer { flex: 1; }
.lp-canvas {
  height: calc(88vh); min-height: 240px;
  overflow: auto; background: #eef0f4; border-radius: 8px; padding: 28px; box-sizing: border-box;
}
.lp-rect {
  position: relative; margin: 0 auto; background: #fff; flex: none;
  border: 1px dashed #9db0d0; box-shadow: 0 4px 20px rgba(29, 33, 41, .10); border-radius: 2px;
}
.lp-name {
  position: absolute; left: 8px; top: -20px; font-size: 11px; color: #8a94a6;
  white-space: nowrap; pointer-events: none;
}
.lp-chart { position: absolute; inset: 0; }
.lp-err { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: #fff8e8; color: #b87a00; font-size: 13px; }

@media (max-width: 1100px) {
  .ax-chart-tool { grid-template-columns: 1fr; overflow: auto; }
  .chart-box { width: 100%; }
}
</style>
