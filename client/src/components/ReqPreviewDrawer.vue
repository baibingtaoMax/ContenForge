<template>
  <el-drawer
    v-model="visible"
    direction="rtl"
    size="520px"
    :with-header="false"
    :close-on-click-modal="true"
    class="req-preview-drawer"
    @closed="onClosed"
  >
    <div v-if="loading" class="rp-loading">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>加载需求文档…</span>
    </div>

    <div v-else-if="req" class="rp-body">
      <div class="rp-head">
        <div class="rp-head-row">
          <div class="rp-head-tags">
            <el-tag size="small" type="info" effect="plain">
              <span class="rp-kind">
                <AppIcon :name="req.kind === 'page' ? 'file' : 'folder'" :size="12" :stroke-width="2.2" />
                {{ req.kind === 'page' ? '页面需求' : '模块需求' }}
              </span>
            </el-tag>
            <el-tag v-if="req.kind === 'page' && parentTitle" size="small" type="warning" effect="plain">
              归属：{{ parentTitle }}
            </el-tag>
            <el-tag :type="req.status === 'confirmed' ? 'success' : 'warning'" size="small">
              {{ req.status === 'confirmed' ? '已确认' : '待确认' }}
            </el-tag>
          </div>
          <el-button size="small" type="primary" plain @click="goEdit">
            <AppIcon name="edit" :size="13" /> 去需求清单处理
          </el-button>
        </div>
        <h2 class="rp-title">{{ req.title }}</h2>
      </div>

      <div class="rp-doc">
        <div v-if="req.doc_md" ref="docRenderRef" class="doc-render" v-html="rendered" @click="onDocClick"></div>
        <el-empty v-else description="这条需求还没有文档" :image-size="70" />
        <DecisionTimeline
          v-if="req"
          readonly
          ref="timelineRef"
          :key="req.id"
          :project-id="req.project_id"
          :requirement-id="req.id"
          :doc-md="req.doc_md"
          :broken-ids="brokenAnchorIds"
          @loaded="onDecisionsLoaded"
        />
      </div>
      <DecisionAnchorPopover :state="anchorPopover" @view-timeline="onViewTimeline" />
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { useChatStore } from '@/stores/chat'
import { getRequirement, listRequirements } from '@/api'
import { renderMarkdown } from '@/utils/markdown'
import { useHeadingDecisionPills } from '@/composables/useHeadingDecisionPills'
import type { Requirement, DesignDecision } from '@/types'
import AppIcon from './AppIcon.vue'
import DecisionTimeline from './DecisionTimeline.vue'
import DecisionAnchorPopover from './DecisionAnchorPopover.vue'
import { useDecisionAnchors } from '@/composables/useDecisionAnchors'

const store = useChatStore()

const visible = ref(false)
const loading = ref(false)
const req = ref<Requirement | null>(null)
const parentTitle = ref('')

const rendered = computed(() => (req.value?.doc_md ? renderMarkdown(req.value.doc_md) : ''))

// 章节决策胶囊
const docRenderRef = ref<HTMLElement | null>(null)
const timelineRef = ref<InstanceType<typeof DecisionTimeline> | null>(null)
const loadedDecisions = ref<DesignDecision[]>([])
const docMdRef = computed(() => req.value?.doc_md || '')
const { onClick: onPillClick } = useHeadingDecisionPills({
  containerRef: docRenderRef,
  docMd: docMdRef,
  decisions: loadedDecisions,
  onFocusPoint: (p) => timelineRef.value?.focusPoint(p),
})
const { onClick: onAnchorClick, popover: anchorPopover, closePopover: closeAnchorPopover, brokenAnchorIds } = useDecisionAnchors({
  containerRef: docRenderRef,
  docMd: docMdRef,
  decisions: loadedDecisions,
})
function onViewTimeline(point: string) {
  closeAnchorPopover()
  nextTick(() => {
    timelineRef.value?.focusPoint(point)
    timelineRef.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
function onDocClick(e: MouseEvent) {
  onPillClick(e)
  onAnchorClick(e)
}
function onDecisionsLoaded(list: DesignDecision[]) {
  loadedDecisions.value = list
}

watch(
  () => store.reqPreviewNonce,
  async (n) => {
    if (!n || !store.reqPreviewId) return
    visible.value = true
    loading.value = true
    req.value = null
    parentTitle.value = ''
    loadedDecisions.value = []
    try {
      const r = await getRequirement(store.reqPreviewId)
      req.value = r
      if (r.kind === 'page' && r.parent_id) {
        try {
          const all = await listRequirements(r.project_id)
          parentTitle.value = all.find((x) => x.id === r.parent_id)?.title || ''
        } catch { /* 归属名拿不到就算了 */ }
      }
    } catch {
      req.value = null
    } finally {
      loading.value = false
    }
  }
)

function goEdit() {
  if (!req.value) return
  const rid = req.value.id
  visible.value = false
  // 整页跳到需求清单详情（会退出对话视图）；等抽屉收起动画起步后再切，避免浮层残留
  setTimeout(() => store.requestOpenRequirement(rid), 80)
}

function onClosed() {
  store.closeReqPreview()
  req.value = null
}
</script>

<style scoped lang="scss">
.rp-loading {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--pf-text-3, #9aa0b0);
  font-size: 13px;
}

.rp-body {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.rp-head {
  flex-shrink: 0;
  padding: 14px 20px 12px;
  border-bottom: 1px solid var(--pf-border);
  background: var(--pf-bg-surface);

  .rp-head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .rp-head-tags {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    .rp-kind {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
  }
  .rp-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: var(--pf-text-1);
    line-height: 1.4;
  }
}

.rp-doc {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 40px;
}

.doc-render {
  font-size: 13.5px;
  line-height: 1.75;
  color: var(--pf-text-1);
  word-break: break-word;

  :deep(h1), :deep(h2), :deep(h3) {
    margin: 20px 0 10px;
    font-weight: 700;
    line-height: 1.4;
  }
  :deep(h1) { font-size: 16px; }
  :deep(h2) {
    font-size: 14.5px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--pf-border);
  }
  :deep(h3) { font-size: 13.5px; }
  :deep(p) { margin: 8px 0; }
  :deep(ul), :deep(ol) { margin: 8px 0; padding-left: 22px; }
  :deep(li) { margin: 3px 0; }
  :deep(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 12.5px;
    display: block;
    overflow-x: auto;
  }
  :deep(th), :deep(td) {
    border: 1px solid var(--pf-border);
    padding: 6px 10px;
    text-align: left;
    white-space: nowrap;
  }
  :deep(th) { background: var(--pf-bg-hover); font-weight: 600; }
  :deep(blockquote) {
    margin: 10px 0;
    padding: 6px 12px;
    border-left: 3px solid var(--pf-primary);
    background: var(--pf-primary-50);
    color: var(--pf-text-2);
    border-radius: 0 6px 6px 0;
  }
  :deep(code) {
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 12px;
    background: var(--pf-bg-hover);
    padding: 1px 5px;
    border-radius: 4px;
  }
  :deep(pre) {
    background: var(--pf-bg-hover);
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    code { background: none; padding: 0; }
  }

  /* 章节决策胶囊 */
  :deep(.doc-decision-pill) {
    display: inline-flex; align-items: center; gap: 3px;
    vertical-align: middle; margin-left: 8px; position: relative; top: -1px;
    height: 20px; padding: 0 7px 0 5px;
    border: 1px solid #c7d2fe; background: #eef2ff; color: #4f46e5;
    border-radius: 999px; font-size: 11px; font-weight: 700; line-height: 1;
    cursor: pointer; transition: all 0.15s;
    svg { display: block; }
    &:hover { background: #4f46e5; border-color: #4f46e5; color: #fff; }
  }
}

  /* 决策锚文本：句内行内标记 */
  :deep(.dd-inline-anchor) {
    background: linear-gradient(180deg, transparent 55%, rgba(129, 140, 248, 0.32) 55%);
    border-bottom: 1px solid #818cf8;
    cursor: pointer;
    border-radius: 2px;
    transition: background 0.15s;
    &:hover {
      background: linear-gradient(180deg, transparent 30%, rgba(129, 140, 248, 0.5) 30%);
    }
  }
</style>
