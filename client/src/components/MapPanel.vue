<template>
  <div v-loading="loading" class="map-panel">
    <!-- 统计带 -->
    <div v-if="model" class="stats-band">
      <div class="stat-card">
        <AppIcon name="folder" tint="amber" :size="32" class="stat-ico" />
        <div><div class="stat-num">{{ model.stats.moduleCount }}<em>个模块</em></div><div class="stat-lab">功能域</div></div>
      </div>
      <div class="stat-card">
        <AppIcon name="file" tint="indigo" :size="32" class="stat-ico" />
        <div><div class="stat-num">{{ model.stats.pageCount }}<em>个页面</em></div><div class="stat-lab">需求页面</div></div>
      </div>
      <div class="stat-card progress-card">
        <div class="progress-row">
          <span>需求确认进度</span>
          <span><b>{{ model.stats.confirmedPages }}</b> 已确认 · {{ model.stats.pageCount - model.stats.confirmedPages }} 待确认</span>
        </div>
        <div class="progress-track">
          <div class="seg-confirmed" :style="{ width: confirmedPct + '%' }"></div>
          <div class="seg-proposed" :style="{ width: 100 - confirmedPct + '%' }"></div>
        </div>
      </div>
      <div class="stat-card">
        <AppIcon name="monitor" tint="violet" :size="32" class="stat-ico" />
        <div><div class="stat-num">{{ model.stats.protoCount }}<em>/{{ model.stats.pageCount }}</em></div><div class="stat-lab">已进原型</div></div>
      </div>
      <div class="stat-card" :class="{ 'is-alert': model.stats.openCount > 0 }">
        <AppIcon name="chat" tint="rose" :size="32" class="stat-ico" />
        <div><div class="stat-num">{{ model.stats.openCount }}</div><div class="stat-lab">待处理原型意见</div></div>
      </div>
    </div>

    <div v-if="model" class="sub-row">
      <div
        v-if="model.stats.poolCount > 0"
        class="idea-strip"
        @click="store.selectProjectFixed('pool')"
      >
        <AppIcon name="lightbulb" :size="15" :stroke-width="2" />
        需求池有 <span class="n">{{ model.stats.poolCount }}</span> 条想法待澄清 / 转正
        <span class="go">→</span>
      </div>
      <div class="legend-inline">
        <span class="li-item"><span class="lg-dot confirmed"></span>已确认</span>
        <span class="li-item"><span class="lg-dot proposed"></span>待确认</span>
        <span class="li-item"><AppIcon name="monitor" :size="13" :stroke-width="2" />已进原型</span>
        <span class="li-item"><span class="lg-dot open"></span>未处理意见</span>
      </div>
    </div>

    <!-- 画布 -->
    <div v-if="model && model.modules.length" class="canvas-host">
      <VueFlow
        :id="FLOW_ID"
        :nodes="graph.nodes"
        :edges="graph.edges"
        :node-types="nodeTypes"
        :min-zoom="0.2"
        :max-zoom="1.6"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="false"
        :pan-on-scroll="true"
        :zoom-on-scroll="false"
        @pane-ready="onPaneReadyEvent"
        @node-click="onNodeClick"
      >
        <Background :gap="22" :size="1.4" pattern-color="#dfe1ea" />
      </VueFlow>

      <div class="zoom-ctl">
        <button title="放大" @click="zoomIn()">＋</button>
        <button class="fit" title="适应画布" @click="doFit">适应</button>
        <button title="缩小" @click="zoomOut()">－</button>
        <button class="dir" title="切换纵向/横向布局" @click="toggleDir">
          {{ dir === 'TB' ? '横排' : '纵排' }}
        </button>
      </div>
    </div>

    <el-empty
      v-else-if="!loading"
      class="map-empty"
      description="还没有需求。去对话里聊，聊清楚一个模块/页面 AI 会自动沉淀，全景图就会长出来。"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import dagre from '@dagrejs/dagre'
import axios from 'axios'
import { listRequirements, listAnnotations, type Annotation } from '@/api'
import {
  buildMapModel,
  mapOpenAnnotationsToReqs,
  ORPHAN_MODULE_ID,
  type MapModel,
} from '@/utils/requirementMap'
import { useChatStore } from '@/stores/chat'
import AppIcon from './AppIcon.vue'
import MapModuleNode from './map/MapModuleNode.vue'
import MapPageNode from './map/MapPageNode.vue'

const props = defineProps<{ projectId: string }>()
const store = useChatStore()

// vue-flow 要求节点组件 props 为 NodeProps；自定义 data 结构用断言兼容
const nodeTypes: Record<string, any> = {
  module: markRaw(MapModuleNode),
  page: markRaw(MapPageNode),
}
const FLOW_ID = `pf-map-${props.projectId}`
const dir = ref<'LR' | 'TB'>('LR')

const { fitView, zoomIn, zoomOut, getViewport, setViewport } = useVueFlow(FLOW_ID)

const loading = ref(true)
const model = ref<MapModel | null>(null)

async function load() {
  loading.value = true
  try {
    const [reqs, protoRes, annotations] = await Promise.all([
      listRequirements(props.projectId, true),
      axios.get(`/api/projects/${props.projectId}/prototype`).catch(() => ({ data: {} })),
      listAnnotations(props.projectId, true).catch(() => [] as Annotation[]),
    ])

    // 原型里已关联的需求 id（pages + nav）
    const protoReqIds = new Set<string>()
    const spec = protoRes.data?.spec
    const protoPages: Array<{ id?: string; requirementId?: string | null }> = spec?.pages || []
    for (const pg of protoPages) if (pg.requirementId) protoReqIds.add(pg.requirementId)
    for (const n of spec?.nav || []) if (n.requirementId) protoReqIds.add(n.requirementId)

    const openByReqId = mapOpenAnnotationsToReqs(annotations, protoPages)
    model.value = buildMapModel(reqs, { protoReqIds, openByReqId })
  } finally {
    loading.value = false
  }
}

const confirmedPct = computed(() => {
  const s = model.value?.stats
  if (!s || !s.pageCount) return 0
  return Math.round((s.confirmedPages / s.pageCount) * 100)
})

// ---- dagre 自动布局 ----
const graph = computed(() => {
  const mods = model.value?.modules || []
  const LR = dir.value === 'LR'
  const g = new dagre.graphlib.Graph()
  g.setGraph(LR
    ? { rankdir: 'LR', nodesep: 10, ranksep: 52, edgesep: 0, marginx: 24, marginy: 16 }
    : { rankdir: 'TB', nodesep: 22, ranksep: 54, edgesep: 0, marginx: 24, marginy: 16 })
  g.setDefaultEdgeLabel(() => ({}))

  const rawNodes: any[] = []
  const rawEdges: any[] = []
  for (const m of mods) {
    const openCount = m.pages.reduce((s, p) => s + p.open, 0)
    rawNodes.push({
      id: m.id,
      type: 'module',
      width: 200,
      height: 92,
      data: {
        title: m.title,
        tone: m.tone,
        icon: m.icon,
        total: m.total,
        confirmed: m.confirmed,
        openCount,
        dir: dir.value,
      },
    })
    if (m.id === ORPHAN_MODULE_ID) continue // 合成分组不画连线
    for (const p of m.pages) {
      rawNodes.push({
        id: p.id,
        type: 'page',
        width: 176,
        height: 50,
        data: { title: p.title, status: p.status, inProto: p.inProto, open: p.open, dir: dir.value },
      })
      rawEdges.push({ id: `${m.id}-${p.id}`, source: m.id, target: p.id })
    }
  }
  rawNodes.forEach((n) => g.setNode(n.id, { width: n.width, height: n.height }))
  rawEdges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)

  const nodes = rawNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: g.node(n.id).x - n.width / 2, y: g.node(n.id).y - n.height / 2 },
    data: n.data,
  }))
  const edges = rawEdges.map((e) => ({ ...e, type: LR ? 'simplebezier' : 'smoothstep' }))
  return { nodes, edges }
})

async function doFit() {
  await nextTick()
  await fitView({ padding: 0.08, minZoom: dir.value === 'TB' ? 0.55 : 0.62, maxZoom: 1 })
  const vp = getViewport()
  if (vp.y > 30) setViewport({ x: vp.x, y: 24, zoom: vp.zoom })
}
let fitTimer: ReturnType<typeof setTimeout> | null = null
let paneReady = false
function scheduleFit(delay = 120) {
  if (fitTimer) clearTimeout(fitTimer)
  fitTimer = setTimeout(doFit, delay)
}
function onPaneReadyEvent() {
  paneReady = true
  if (model.value?.modules.length) scheduleFit()
}
// 数据异步到达后（pane 可能早已 ready）再适应；加一次兑底防尺寸未稳定
watch(model, (m) => {
  if (m?.modules.length) {
    scheduleFit()
    scheduleFit(420)
  }
})
watch(dir, () => scheduleFit())
function toggleDir() {
  dir.value = dir.value === 'TB' ? 'LR' : 'TB'
}

function onNodeClick(e: { node?: { id?: string } }) {
  const id = e.node?.id
  if (!id || id === ORPHAN_MODULE_ID) return
  store.requestOpenRequirement(id)
}

onMounted(load)
</script>

<style scoped lang="scss">
.map-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--pf-bg-app);
  position: relative;
}

/* ===== 统计带 ===== */
.stats-band {
  display: flex;
  gap: 12px;
  padding: 14px 22px 4px;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.stat-card {
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  padding: 10px 16px;
  min-width: 120px;
  display: flex;
  align-items: center;
  gap: 11px;
  transition: box-shadow 0.18s, transform 0.18s, border-color 0.18s;
  &:hover {
    box-shadow: var(--pf-shadow-md);
    border-color: var(--pf-primary-200);
    transform: translateY(-1px);
  }
  &.is-alert {
    border-color: #f3c9c9;
  }
}
.stat-ico {
  flex-shrink: 0;
}
.stat-num {
  font-size: 19px;
  font-weight: 800;
  line-height: 1.1;
  white-space: nowrap;
  color: var(--pf-text-1);
  em {
    font-style: normal;
    font-size: 12px;
    font-weight: 600;
    color: var(--pf-text-3);
    margin-left: 3px;
  }
}
.stat-card .stat-ico + div {
  min-width: 74px;
}
.stat-lab {
  font-size: 11px;
  color: var(--pf-text-3);
  margin-top: 2px;
}
.progress-card {
  flex: 1 1 220px;
  min-width: 200px;
  display: block;
}
.progress-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--pf-text-3);
  margin-bottom: 6px;
  b {
    font-weight: 600;
  }
}
.progress-track {
  height: 7px;
  border-radius: 99px;
  background: var(--pf-bg-hover);
  overflow: hidden;
  display: flex;
}
.seg-confirmed {
  background: var(--pf-success);
}
.seg-proposed {
  background: #e6e8ee;
}

/* ===== 次行：需求池条 + 行内图例 ===== */
.sub-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 12px 22px 0;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.legend-inline {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11.5px;
  color: var(--pf-text-3);
  margin-left: auto;
}
.li-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  svg {
    color: var(--pf-text-3);
  }
}

/* ===== 需求池条 ===== */
.idea-strip {
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--pf-bg-surface);
  border: 1px dashed var(--pf-border);
  border-radius: var(--pf-r-lg);
  padding: 9px 14px;
  font-size: 12.5px;
  color: var(--pf-text-2);
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s;
  svg {
    color: var(--pf-text-3);
  }
  .n {
    font-weight: 800;
    color: var(--pf-text-1);
  }
  .go {
    margin-left: 6px;
    opacity: 0.6;
    transition: transform 0.18s, opacity 0.18s;
  }
  &:hover {
    border-color: var(--pf-primary-200);
    background: var(--pf-primary-50);
    svg {
      color: var(--pf-primary);
    }
    .go {
      opacity: 1;
      transform: translateX(3px);
    }
  }
}

/* ===== 画布 ===== */
.canvas-host {
  flex: 1;
  position: relative;
  min-height: 0;
}
.lg-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  &.confirmed {
    background: var(--pf-success);
  }
  &.proposed {
    background: var(--pf-warning);
  }
  &.open {
    background: var(--pf-danger);
  }
}

.zoom-ctl {
  position: absolute;
  right: 18px;
  bottom: 16px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  border: 1px solid var(--pf-border);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--pf-shadow-xs);
  button {
    border: 0;
    background: transparent;
    width: 42px;
    height: 34px;
    font-size: 15px;
    color: var(--pf-text-2);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
    &:hover {
      background: var(--pf-bg-hover);
      color: var(--pf-primary);
    }
    &.fit {
      font-size: 11px;
      border-top: 1px solid var(--pf-border);
      border-bottom: 1px solid var(--pf-border);
      font-weight: 600;
    }
    &.dir {
      font-size: 11px;
      border-top: 1px solid var(--pf-border);
      font-weight: 600;
      color: var(--pf-text-2);
    }
  }
}

.map-empty {
  flex: 1;
}

:deep(.vue-flow__edge-path) {
  stroke: #d4d8e4;
  stroke-width: 1.5;
}
:deep(.vue-flow__edge:hover .vue-flow__edge-path) {
  stroke: var(--pf-primary-200);
}
:deep(.vue-flow__handle) {
  opacity: 0;
}
</style>
