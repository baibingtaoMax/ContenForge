<template>
  <div class="diff-pane">
    <div class="diff-head">
      <span class="col-gutter"></span>
      <span class="col-title old">旧版</span>
      <span class="col-gutter"></span>
      <span class="col-title new">新版</span>
    </div>
    <div class="diff-body">
      <div v-if="collapseSame && !hasFoldable" class="fold-hint">
        <AppIcon name="info" :size="13" />
        没有连续 3 行及以上的相同内容可折叠
      </div>
      <template v-for="(seg, i) in segments" :key="i">
        <template v-if="seg.type === 'block'">
          <div v-if="!expanded.has(seg.key)" class="fold-row" @click="toggle(seg.key)">
            <AppIcon name="chevron-right" :size="12" class="fold-arrow" />
            <span>{{ seg.rows.length }} 行内容相同，点击展开</span>
          </div>
          <template v-else>
            <DiffSplitRow v-for="(r, j) in seg.rows" :key="`${seg.key}-${j}`" :row="r" />
            <div class="fold-row open" @click="toggle(seg.key)">
              <AppIcon name="chevron-down" :size="12" class="fold-arrow" />
              <span>收起 {{ seg.rows.length }} 行相同内容</span>
            </div>
          </template>
        </template>
        <DiffSplitRow v-else :row="seg.row" :key="`r${i}`" />
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
const hasFoldable = computed(() => {
  let run = 0
  for (const r of props.rows) {
    if (r.op === 'same') { run++; if (run >= 3) return true } else run = 0
  }
  return false
})

// 单侧单元格（render 函数：两栏几乎对称，模板写两遍啰嗦）
function cell(row: DiffRow, side: 'old' | 'new') {
  const isOld = side === 'old'
  const line = isOld ? row.oldLine : row.newLine
  const active = isOld ? row.op === 'del' || row.op === 'mod' : row.op === 'add' || row.op === 'mod'
  const sign =
    row.op === 'add' ? '+' : row.op === 'del' ? '−' : row.op === 'mod' ? (isOld ? '−' : '+') : ''
  const no = line ? String(isOld ? line.oldNo : line.newNo) ?? '' : ''
  return h('div', { class: ['diff-cell', isOld ? 'cell-old' : 'cell-new', { active, mod: row.op === 'mod' }] }, [
    h('span', { class: 'ln' }, no),
    h('span', { class: 'sign' }, active ? sign : ''),
    h(DiffSegs, { segs: isOld ? row.oldSegs : row.newSegs, text: line?.text ?? '', side }),
  ])
}

const DiffSplitRow = defineComponent({
  props: { row: { type: Object as () => DiffRow, required: true } },
  setup(p) {
    return () =>
      h('div', { class: ['diff-row', { 'is-mod': p.row.op === 'mod' }] }, [
        cell(p.row, 'old'),
        cell(p.row, 'new'),
      ])
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
  .col-title.old { color: #b91c1c; }
  .col-title.new { color: #047857; }
}
.diff-body { flex: 1; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.75; }
.fold-hint {
  display: flex; align-items: center; gap: 6px;
  font-family: var(--pf-font-sans, inherit); font-size: 12px; color: var(--pf-text-3);
  padding: 8px 14px; background: var(--pf-bg-subtle, #fafafe);
  border-bottom: 1px dashed var(--pf-border);
}
.diff-row { display: flex; }

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

:deep(.diff-cell) {
  flex: 1;
  min-width: 0;
  display: flex;
  white-space: pre-wrap;
  word-break: break-all;
  &.active { color: var(--pf-text-1); }
  &:not(.active) { color: var(--pf-text-2, #5b6172); }
  .ln {
    flex-shrink: 0; width: 40px; text-align: right; padding-right: 8px;
    color: #b3b8c6; user-select: none; background: #f6f7fb;
  }
  .sign { flex-shrink: 0; width: 16px; text-align: center; user-select: none; color: #b3b8c6; }
}
:deep(.cell-old.active) { background: #fef2f2; .sign, > span:last-child { color: #b91c1c; } .ln { background: #fee2e2; color: #dc2626; } }
:deep(.cell-old.mod.active) { background: #fff7f7; .ln { background: #fde8e8; } }
:deep(.cell-new.active) { background: #ecfdf5; .sign, > span:last-child { color: #047857; } .ln { background: #d1fae5; color: #059669; } }
:deep(.cell-new.mod.active) { background: #f7fdfb; .ln { background: #e2f7ee; } }
</style>
