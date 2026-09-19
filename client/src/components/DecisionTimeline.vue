<template>
  <div class="dd-timeline" :class="{ 'is-readonly': readonly }">
    <div class="dd-head">
      <span class="dd-head-title"><AppIcon name="flag" :size="15" :stroke-width="2.2" /> 决策脉络</span>
      <span class="dd-head-sub">按需求点归类，回答「这个设计当时为什么这么定」</span>
      <el-button v-if="!readonly" link type="primary" size="small" class="dd-add" @click="add()">
        <AppIcon name="plus" :size="13" :stroke-width="2.6" /> 补记决策
      </el-button>
    </div>

    <div v-if="loading" class="dd-state">加载中…</div>
    <template v-else-if="decisions.length">
      <!-- 正常归位的需求点分组 -->
      <div v-for="g in anchoredGroups" :key="g.point || '__general__'" :ref="el => setGroupRef(el, g.point)" class="dd-group">
        <div class="dd-group-head">
          <AppIcon name="flag" :size="13" :stroke-width="2.4" class="grp-flag" />
          <span class="grp-name">{{ g.point || '整条需求的通用决策' }}</span>
          <el-tag size="small" effect="plain" round>{{ g.items.length }} 条</el-tag>
          <el-button v-if="!readonly" link type="primary" size="small" class="grp-add" @click="add(g.point)">
            <AppIcon name="plus" :size="12" :stroke-width="2.6" /> 补一条
          </el-button>
        </div>
        <DecisionItem
          v-for="(d, i) in g.items"
          :key="d.id"
          :d="d"
          :last="i === g.items.length - 1"
          :readonly="readonly"
          :broken-anchor="brokenIds.has(d.id)"
          @edit="edit"
          @remove="remove"
        />
      </div>

      <!-- 未归位：point 在当前文档章节里找不到（文档重写过） -->
      <div v-if="orphanGroups.length" class="dd-orphans">
        <div class="orphan-tip">
          <AppIcon name="alert-triangle" :size="14" />
          {{ orphanGroups.length }} 个需求点在当前文档章节里找不到对应标题（文档可能重写过），决策没丢，可编辑重新指认章节：
        </div>
        <div v-for="g in orphanGroups" :key="g.point" :ref="el => setGroupRef(el, g.point)" class="dd-group is-orphan">
          <div class="dd-group-head">
            <AppIcon name="alert-triangle" :size="13" class="grp-warn" />
            <span class="grp-name">{{ g.point }}</span>
            <el-tag size="small" type="warning" effect="plain" round>{{ g.items.length }} 条</el-tag>
            <el-button v-if="!readonly" link type="warning" size="small" class="grp-add" @click="edit(g.items[0])">
              重新指认
            </el-button>
          </div>
          <DecisionItem
            v-for="(d, i) in g.items"
            :key="d.id"
            :d="d"
            :last="i === g.items.length - 1"
            :readonly="readonly"
            :broken-anchor="brokenIds.has(d.id)"
            @edit="edit"
            @remove="remove"
          />
        </div>
      </div>
    </template>
    <div v-else class="dd-state">
      <template v-if="readonly">还没有决策记录</template>
      <template v-else>还没有决策记录。对话里拍板会自动沉淀，也可以
        <el-button link type="primary" size="small" @click="add()">手动补记一条</el-button>
      </template>
    </div>

    <DecisionEditDialog
      v-if="!readonly"
      v-model="dialogOpen"
      :project-id="projectId"
      :requirement-id="requirementId"
      :headings="headings"
      :decision="editing"
      :preset-point="presetPoint"
      @saved="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { DesignDecision } from '@/types'
import { listDecisionsByRequirement, deleteDecision } from '@/api'
import { useChatStore } from '@/stores/chat'
import { extractHeadings, matchHeading, groupByPoint } from '@/utils/decisionPoints'
import AppIcon from './AppIcon.vue'
import DecisionItem from './DecisionItem.vue'
import DecisionEditDialog from './DecisionEditDialog.vue'

const props = withDefaults(defineProps<{
  projectId: string
  requirementId: string
  /** 需求文档原文，用于提取章节标题做需求点选项和归位判断 */
  docMd?: string
  readonly?: boolean
  /** 锁了原文但当前文档匹配不上的决策 id（文档重写后失效） */
  brokenIds?: Set<string>
}>(), { readonly: false, docMd: '', brokenIds: () => new Set<string>() })

const emit = defineEmits<{ loaded: [decisions: DesignDecision[]] }>()

const store = useChatStore()
const decisions = ref<DesignDecision[]>([])
const loading = ref(false)
const dialogOpen = ref(false)
const editing = ref<DesignDecision | null>(null)
const presetPoint = ref('')
const groupRefs = new Map<string, HTMLElement>()

function setGroupRef(el: unknown, point: string) {
  if (el) groupRefs.set(point, el as HTMLElement)
  else groupRefs.delete(point)
}

const headings = computed(() => extractHeadings(props.docMd))

const groups = computed(() => groupByPoint(decisions.value))

const anchoredGroups = computed(() =>
  groups.value.filter((g) => !g.point || matchHeading(g.point, headings.value) !== null)
)
const orphanGroups = computed(() =>
  groups.value.filter((g) => g.point && matchHeading(g.point, headings.value) === null)
)

/** 章节胶囊点击：滚动到对应需求点分组并闪烁 */
function focusPoint(rawPoint: string) {
  // 文档标题可能是「搜索交互」，point 也是它；未匹配的自拟点直接按原 key
  const matched = matchHeading(rawPoint, headings.value)
  const key = matched || rawPoint
  const el = groupRefs.get(key) || groupRefs.get(rawPoint)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove('flash')
    void (el as HTMLElement).offsetWidth
    el.classList.add('flash')
  }
}
defineExpose({ focusPoint })

async function load() {
  loading.value = true
  try {
    decisions.value = await listDecisionsByRequirement(props.requirementId)
    emit('loaded', decisions.value)
  } finally {
    loading.value = false
  }
}

function add(point = '') {
  editing.value = null
  presetPoint.value = point
  dialogOpen.value = true
}
function edit(d: DesignDecision) {
  editing.value = d
  presetPoint.value = ''
  dialogOpen.value = true
}
async function remove(d: DesignDecision) {
  await ElMessageBox.confirm(`删除决策「${d.topic}」？`, '提示', { type: 'warning' })
  await deleteDecision(d.id)
  ElMessage.success('已删除')
  load()
}

watch(() => props.requirementId, load, { immediate: true })
watch(() => props.docMd, () => { /* headings 是 computed，自动响应；无额外动作 */ })
// 对话中刚记录决策 → 刷新
watch(() => store.decisionPanelNonce, load)
</script>

<style scoped lang="scss">
.dd-timeline {
  max-width: 820px;
  margin: 20px auto 0;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-xl);
  box-shadow: var(--pf-shadow-sm);
  padding: 20px 24px 8px;
}
.dd-timeline.is-readonly {
  max-width: none;
  margin: 16px 0 0;
  border: none;
  box-shadow: none;
  border-top: 1px solid var(--pf-border);
  border-radius: 0;
  padding: 16px 0 0;
}
.dd-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
.dd-head-title { font-size: 14.5px; font-weight: 700; color: var(--pf-text-1); display: inline-flex; align-items: center; gap: 6px; }
.dd-head-sub { font-size: 12px; color: var(--pf-text-3); }
.dd-add { margin-left: auto; }
.dd-state { padding: 18px 4px 24px; font-size: 13px; color: var(--pf-text-3); }

.dd-group {
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  padding: 10px 14px 0;
  margin-bottom: 12px;
  background: var(--pf-bg-app);
  scroll-margin-top: 80px;
  transition: box-shadow 0.4s, border-color 0.4s;
}
.dd-group.flash {
  border-color: #818cf8;
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.25);
}
.dd-group-head {
  display: flex; align-items: center; gap: 8px;
  padding: 2px 0 8px;
}
.grp-flag { color: #4f46e5; flex: 0 0 auto; }
.grp-warn { color: #d97706; flex: 0 0 auto; }
.grp-name { font-size: 13px; font-weight: 700; color: var(--pf-text-1); }
.grp-add { margin-left: auto; }
.dd-group.is-orphan { border-color: #fde68a; background: #fffdf5; }

.dd-orphans { margin-top: 4px; }
.orphan-tip {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 12px; line-height: 1.6; color: #b45309;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
  padding: 8px 12px; margin-bottom: 10px;
}
</style>
