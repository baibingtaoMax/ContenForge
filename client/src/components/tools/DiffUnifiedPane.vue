<template>
  <div class="diff-pane">
    <div class="diff-head">
      <span class="col-gutter"></span>
      <span class="col-title">变更（统一视图）</span>
    </div>
    <div class="diff-body">
      <template v-for="(seg, i) in segments" :key="i">
        <template v-if="seg.type === 'block'">
          <div v-if="!expanded.has(seg.key)" class="fold-row" @click="toggle(seg.key)">
            <AppIcon name="chevron-right" :size="12" class="fold-arrow" />
            <span>{{ seg.rows.length }} 行内容相同，点击展开</span>
          </div>
          <template v-else>
            <UnifiedRow v-for="(r, j) in seg.rows" :key="`${seg.key}-${j}`" :row="r" />
            <div class="fold-row open" @click="toggle(seg.key)">
              <AppIcon name="chevron-down" :size="12" class="fold-arrow" />
              <span>收起 {{ seg.rows.length }} 行相同内容</span>
            </div>
          </template>
        </template>
        <template v-else-if="seg.row.op === 'mod'">
          <UnifiedRow :row="seg.row" variant="del" :key="`d${i}`" />
          <UnifiedRow :row="seg.row" variant="add" :key="`a${i}`" />
        </template>
        <UnifiedRow v-else :row="seg.row" :key="`r${i}`" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { h, ref, computed, defineComponent } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import DiffSegs from '@/components/tools/DiffSegs.vue'
import { foldRows, type DiffRow } from '@/utils/charDiff'

const props = defineProps<{ rows: DiffRow[]; collapseSame: boolean }>()

const expanded = ref(new Set<number>())
function toggle(key: number) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

const segments = computed(() =>
  props.collapseSame ? foldRows(props.rows) : props.rows.map((row) => ({ type: 'row' as const, row }))
)

const UnifiedRow = defineComponent({
  components: { DiffSegs },
  props: {
    row: { type: Object as () => DiffRow, required: true },
    // mod 行渲染两次时指定本行角色；其余由 row.op 决定
    variant: { type: String as () => '' | 'del' | 'add', default: '' },
  },
  setup(p) {
    return () => {
      const role: 'del' | 'add' | 'same' =
        p.variant || (p.row.op === 'same' ? 'same' : p.row.op === 'add' ? 'add' : 'del')
      const line = role === 'del' ? p.row.oldLine : role === 'add' ? p.row.newLine : p.row.oldLine
      const sign = role === 'add' ? '+' : role === 'del' ? '−' : ''
      return h('div', { class: ['uni-row', `u-${role}`] }, [
        h('span', { class: 'ln old' }, role !== 'add' && p.row.oldLine ? String(p.row.oldLine.oldNo ?? '') : ''),
        h('span', { class: 'ln new' }, role !== 'del' && p.row.newLine ? String(p.row.newLine.newNo ?? '') : ''),
        h('span', { class: 'sign' }, sign),
        h(DiffSegs, {
          segs: role === 'del' ? p.row.oldSegs : p.row.newSegs,
          text: line?.text ?? '',
          side: role === 'del' ? 'old' : 'new',
        }),
      ])
    }
  },
})
</script>

<style scoped lang="scss">
.diff-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  overflow: hidden;
}
.diff-head {
  display: flex;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-text-3);
  border-bottom: 1px solid var(--pf-border);
  background: var(--pf-bg-subtle, #fafafe);
  .col-gutter { width: 64px; flex-shrink: 0; }
  .col-title { flex: 1; padding: 8px 10px; }
}
.diff-body { flex: 1; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.75; }

.fold-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  font-family: var(--pf-font-sans, inherit);
  font-size: 12px;
  color: var(--pf-text-3);
  background: var(--pf-bg-subtle, #fafafe);
  border-top: 1px dashed var(--pf-border);
  border-bottom: 1px dashed var(--pf-border);
  cursor: pointer;
  user-select: none;
  &:hover { color: var(--pf-primary, #6366f1); }
  .fold-arrow { flex-shrink: 0; }
}

:deep(.uni-row) {
  display: flex;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--pf-text-2, #5b6172);
  .ln {
    flex-shrink: 0; width: 40px; text-align: right; padding-right: 8px;
    color: #b3b8c6; user-select: none; background: #f6f7fb;
  }
  .sign { flex-shrink: 0; width: 16px; text-align: center; user-select: none; color: #b3b8c6; }
}
:deep(.u-del) { background: #fef2f2; .sign, > span:last-child { color: #b91c1c; } .ln.old { background: #fee2e2; color: #dc2626; } }
:deep(.u-add) { background: #ecfdf5; .sign, > span:last-child { color: #047857; } .ln.new { background: #d1fae5; color: #059669; } }
</style>
