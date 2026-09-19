<template>
  <Teleport to="body">
    <Transition name="dd-pop">
      <div
        v-if="state.visible"
        class="dd-anchor-pop"
        :class="state.placement"
        :style="{ left: state.left + 'px', top: state.top + 'px', maxHeight: state.maxHeight + 'px', zIndex: state.zIndex }"
        @click.stop
      >
        <div class="pop-head">
          <span class="pop-badge"><AppIcon name="flag" :size="12" :stroke-width="2.4" /> 设计决策</span>
          <span v-if="state.decisions.length > 1" class="pop-count">同句 {{ state.decisions.length }} 条演进</span>
        </div>
        <div v-for="(d, i) in state.decisions" :key="d.id" class="pop-item" :class="{ 'pop-more': i > 0 }">
          <div class="pop-topic">
            <span class="pop-date">{{ fmt(d.createdAt) }}</span>
            <el-tag size="small" effect="plain" :type="tagType(d.sourceType)">{{ tagText(d) }}</el-tag>
          </div>
          <div class="pop-topic-title">{{ d.topic }}</div>
          <div class="pop-row"><span class="p-lbl p-con">结论</span><span>{{ d.conclusion }}</span></div>
          <div class="pop-row"><span class="p-lbl p-why">理由</span><span>{{ d.rationale }}</span></div>
          <div v-for="(r, j) in d.rejected" :key="j" class="pop-row">
            <span class="p-lbl p-no">被否</span>
            <span><strong>{{ r.option }}</strong>——{{ r.reason }}</span>
          </div>
        </div>
        <div class="pop-foot">
          <button class="pop-more-link" @click.stop="$emit('view-timeline', state.point)">
            看完整脉络 <AppIcon name="chevron-right" :size="11" :stroke-width="2.6" />
          </button>
          <span class="pop-hint">点页面空白处关闭</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { AnchorPopoverState } from '@/composables/useDecisionAnchors'
import AppIcon from './AppIcon.vue'

defineProps<{ state: AnchorPopoverState }>()
defineEmits<{ (e: 'view-timeline', point: string): void }>()

function fmt(s: string) {
  const d = new Date(s)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`
}
function tagType(t: string): 'success' | 'primary' | 'info' {
  if (t === 'meeting') return 'success'
  if (t === 'chat') return 'primary'
  return 'info'
}
function tagText(d: { sourceType: string; sourceLabel: string }) {
  if (d.sourceType === 'meeting') return d.sourceLabel || '会议'
  if (d.sourceType === 'chat') return '对话'
  return '手动'
}
</script>

<style scoped lang="scss">
.dd-anchor-pop {
  position: fixed;
  width: 340px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: #fff;
  border: 1px solid #c7d2fe;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(30, 27, 75, 0.18);
  padding: 12px 14px 8px;
}
.pop-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.pop-badge {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 700; color: #4f46e5;
}
.pop-count { font-size: 11px; color: #6366f1; background: #eef2ff; border-radius: 999px; padding: 1px 8px; }
.pop-item { padding-bottom: 8px; }
.pop-item.pop-more { border-top: 1px dashed var(--pf-border, #e5e7eb); padding-top: 8px; margin-top: 2px; }
.pop-topic { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.pop-date { font-size: 11px; color: #9aa0b0; font-variant-numeric: tabular-nums; }
.pop-topic-title { font-size: 13px; font-weight: 700; color: #1e1b4b; margin-bottom: 5px; line-height: 1.5; }
.pop-row {
  display: flex; gap: 8px; align-items: flex-start;
  font-size: 12.5px; line-height: 1.65; color: #4b5563;
  margin: 3px 0;
}
.p-lbl {
  flex: 0 0 auto; font-size: 10.5px; font-weight: 700; padding: 1px 6px;
  border-radius: 5px; margin-top: 2px; white-space: nowrap;
}
.p-con { background: #eef2ff; color: #4f46e5; }
.p-why { background: #f0fdf4; color: #16a34a; }
.p-no { background: #fef2f2; color: #dc2626; }
.pop-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0 3px; border-top: 1px solid #f1f2f7; margin-top: 2px; }
.pop-more-link {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: 11.5px; font-weight: 600; color: #4f46e5;
  background: none; border: 0; padding: 0; cursor: pointer;
  :deep(svg) { transition: transform .15s; }
  &:hover { text-decoration: underline; }
}
.pop-hint { font-size: 10.5px; color: #b6bccb; }

/* 朝上/朝下位置都由 JS 直接给绝对 top；class 仅留作语义标记 */

.dd-pop-enter-active, .dd-pop-leave-active { transition: opacity 0.14s; }
.dd-pop-enter-from, .dd-pop-leave-to { opacity: 0; }
</style>
