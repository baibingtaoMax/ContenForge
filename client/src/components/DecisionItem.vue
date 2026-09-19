<template>
  <div class="dd-item">
    <div class="dd-rail">
      <span class="dd-dot" :class="`dot-${d.sourceType}`" />
      <span v-if="!last" class="dd-line" />
    </div>
    <div class="dd-body">
      <div class="dd-item-head">
        <span class="dd-date">{{ fmt(d.createdAt) }}</span>
        <el-tag size="small" effect="plain" :type="sourceTagType(d.sourceType)">
          {{ sourceLabel(d) }}
        </el-tag>
        <span v-if="!readonly" class="dd-item-actions">
          <el-button link size="small" @click="$emit('edit', d)"><AppIcon name="edit" :size="13" /> 编辑</el-button>
          <el-button link size="small" type="danger" @click="$emit('remove', d)">删除</el-button>
        </span>
      </div>
      <div v-if="showTopic" class="dd-topic">{{ d.topic }}</div>
      <div class="dd-section">
        <span class="dd-label lbl-conclusion">结论</span>
        <div class="dd-text">{{ d.conclusion }}</div>
      </div>
      <div class="dd-section">
        <span class="dd-label lbl-rationale">理由</span>
        <div class="dd-text">{{ d.rationale }}</div>
      </div>
      <div v-if="d.rejected.length" class="dd-section">
        <span class="dd-label lbl-rejected">被否方案</span>
        <div class="dd-rejected">
          <div v-for="(r, i) in d.rejected" :key="i" class="dd-rej-item">
            <span class="rej-x"><AppIcon name="x" :size="12" :stroke-width="2.6" /></span>
            <span><strong>{{ r.option }}</strong>——{{ r.reason }}</span>
          </div>
        </div>
      </div>
      <el-collapse v-if="d.sourceExcerpt" class="dd-excerpt">
        <el-collapse-item title="原文片段">
          <div class="excerpt-text">{{ d.sourceExcerpt }}</div>
        </el-collapse-item>
      </el-collapse>
      <div v-if="brokenAnchor" class="dd-anchor-broken">
        <AppIcon name="alert-triangle" :size="12" :stroke-width="2.4" />
        钉的原文在当前文档里找不到了（文档可能重写过），编辑可重新指认
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { DesignDecision } from '@/types'
import AppIcon from './AppIcon.vue'

withDefaults(defineProps<{
  d: DesignDecision
  last?: boolean
  readonly?: boolean
  showTopic?: boolean
  brokenAnchor?: boolean
}>(), { last: false, readonly: false, showTopic: true, brokenAnchor: false })

defineEmits<{
  edit: [d: DesignDecision]
  remove: [d: DesignDecision]
}>()

function fmt(s: string) {
  const d = new Date(s)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function sourceLabel(d: DesignDecision) {
  if (d.sourceType === 'meeting') return d.sourceLabel || '会议'
  if (d.sourceType === 'chat') return '对话'
  return '手动'
}
function sourceTagType(t: string): 'success' | 'primary' | 'info' {
  if (t === 'meeting') return 'success'
  if (t === 'chat') return 'primary'
  return 'info'
}
</script>

<style scoped lang="scss">
.dd-item { display: flex; gap: 12px; }
.dd-rail { display: flex; flex-direction: column; align-items: center; flex: 0 0 16px; padding-top: 4px; }
.dd-dot {
  width: 10px; height: 10px; border-radius: 50%; flex: 0 0 auto;
  border: 2px solid #fff; box-shadow: 0 0 0 1px var(--pf-border-strong);
}
.dot-meeting { background: #10b981; }
.dot-chat { background: #6366f1; }
.dot-manual { background: #94a3b8; }
.dd-line { width: 2px; flex: 1 1 auto; min-height: 28px; background: var(--pf-border); margin: 2px 0; }

.dd-body { flex: 1 1 auto; padding-bottom: 22px; min-width: 0; }
.dd-item-head { display: flex; align-items: center; gap: 8px; }
.dd-date { font-size: 11.5px; color: var(--pf-text-3); font-variant-numeric: tabular-nums; }
.dd-item-actions { margin-left: auto; opacity: 0; transition: opacity 0.15s; display: flex; gap: 2px; }
.dd-item:hover .dd-item-actions { opacity: 1; }
.dd-topic { font-size: 14px; font-weight: 700; color: var(--pf-text-1); margin: 6px 0 8px; }
.dd-section { display: flex; gap: 10px; margin: 6px 0; align-items: flex-start; }
.dd-label {
  flex: 0 0 auto; white-space: nowrap; align-self: flex-start;
  font-size: 11.5px; font-weight: 700; padding: 2px 7px;
  border-radius: 6px; margin-top: 1px;
}
.lbl-conclusion { background: #eef2ff; color: #4f46e5; }
.lbl-rationale { background: #f0fdf4; color: #16a34a; }
.lbl-rejected { background: #fef2f2; color: #dc2626; }
.dd-text { font-size: 13px; line-height: 1.75; color: var(--pf-text-2); white-space: pre-wrap; }
.dd-rejected { display: flex; flex-direction: column; gap: 4px; }
.dd-rej-item {
  display: flex; gap: 7px; align-items: baseline;
  font-size: 12.5px; line-height: 1.7; color: var(--pf-text-2);
  background: #fef9f9; border: 1px solid #fee2e2; border-radius: 8px; padding: 5px 10px;
}
.rej-x { color: #ef4444; display: inline-flex; flex: 0 0 auto; }
.dd-excerpt { margin-top: 6px; border: none; }
.dd-excerpt :deep(.el-collapse-item__header) { border: none; font-size: 12px; color: var(--pf-text-3); height: 30px; }
.dd-excerpt :deep(.el-collapse-item__wrap) { border: none; }
.excerpt-text {
  font-size: 12.5px; line-height: 1.7; color: var(--pf-text-3);
  background: var(--pf-bg-hover); border-radius: 8px; padding: 8px 12px;
  border-left: 3px solid var(--pf-border-strong); white-space: pre-wrap;
}
.dd-anchor-broken {
  display: flex; align-items: center; gap: 5px;
  margin-top: 6px; padding: 4px 10px;
  font-size: 11.5px; color: #b45309;
  background: #fffbeb; border: 1px solid #fde68a; border-radius: 7px;
}
</style>
