<template>
  <div ref="paneEl" class="map-table" @scroll="onScroll">
    <div class="mt-head">
      <div class="col-cn">中文名</div>
      <div class="col-key">字段名</div>
      <div class="col-val">值</div>
    </div>
    <div class="mt-body">
      <template v-for="(r, i) in visibleRows" :key="i">
        <!-- 对象 / 数组：可折叠分组行 -->
        <div v-if="r.kind !== 'leaf'" class="mt-row is-group" :style="{ paddingLeft: 8 + r.depth * 18 + 'px' }" @click="toggle(r)">
          <span class="col-cn">
            <AppIcon :name="isCollapsed(r) ? 'chevron-right' : 'chevron-down'" :size="13" class="caret" />
            <span v-if="r.cn" class="cn-text">{{ r.cn }}</span>
            <span v-else-if="!r.isArrayItem" class="cn-missing">{{ r.key }}</span>
            <span v-else class="cn-array-item">数组项</span>
          </span>
          <span class="col-key key-text">{{ r.key || '（根）' }}</span>
          <span class="col-val group-sum">
            <span class="type-badge" :class="r.kind">{{ r.kind === 'array' ? '[]' : '{}' }}</span>
            {{ r.text }}
          </span>
        </div>
        <!-- 叶子 -->
        <div v-else class="mt-row is-leaf" :class="{ 'is-missing-row': !r.cn && !r.isArrayItem }" :style="{ paddingLeft: 8 + r.depth * 18 + 'px' }">
          <span class="col-cn">
            <span class="leaf-dot" />
            <span v-if="r.cn" class="cn-text">{{ r.cn }}</span>
            <span v-else-if="!r.isArrayItem" class="cn-tag-missing">未配置</span>
            <span v-else class="cn-array-item">·</span>
          </span>
          <span class="col-key key-text" :title="r.key">{{ r.key }}</span>
          <span class="col-val">
            <span v-if="r.value === null" class="v-null">null</span>
            <span v-else :class="valClass(r)">{{ display(r) }}</span>
          </span>
        </div>
      </template>
      <div v-if="!visibleRows.length" class="mt-empty">没有未配置中文名的字段 🎉</div>
    </div>

    <Transition name="bt-fade">
      <button v-if="showTop" type="button" class="back-top" title="回到顶部" @click="toTop">
        <el-icon :size="16"><Top /></el-icon>
      </button>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Top } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import type { MapRow } from '@/utils/jsonMapping'

const props = defineProps<{ rows: MapRow[]; onlyMissing: boolean }>()

const collapsed = ref(new Set<string>())
const keyOf = (r: MapRow) => JSON.stringify(r.path)
const isCollapsed = (r: MapRow) => collapsed.value.has(keyOf(r))
function toggle(r: MapRow) {
  const next = new Set(collapsed.value)
  const k = keyOf(r)
  next.has(k) ? next.delete(k) : next.add(k)
  collapsed.value = next
}
watch(
  () => props.rows,
  () => (collapsed.value = new Set())
)

// 未配筛选：保留「缺失叶子 + 其所有容器祖先」，强制展开
const visibleRows = computed<MapRow[]>(() => {
  const rows = props.rows
  if (!props.onlyMissing) {
    const out: MapRow[] = []
    let collapsedDepth = -1
    for (const r of rows) {
      if (collapsedDepth >= 0 && r.depth > collapsedDepth) continue
      collapsedDepth = -1
      out.push(r)
      if (r.kind !== 'leaf' && collapsed.value.has(keyOf(r))) collapsedDepth = r.depth
    }
    return out
  }
  const idxByPath = new Map<string, number>()
  rows.forEach((r, i) => idxByPath.set(JSON.stringify(r.path), i))
  const keep = new Set<number>()
  rows.forEach((r, i) => {
    if (r.kind === 'leaf' && !r.cn && !r.isArrayItem) {
      keep.add(i)
      for (let len = 1; len < r.path.length; len++) {
        const a = idxByPath.get(JSON.stringify(r.path.slice(0, len)))
        if (a !== undefined) keep.add(a)
      }
    }
  })
  return rows.filter((_, i) => keep.has(i))
})

function display(r: MapRow): string {
  if (typeof r.value === 'string') return r.value.length > 120 ? r.value.slice(0, 120) + '…' : r.value
  return String(r.value)
}
function valClass(r: MapRow): string {
  if (typeof r.value === 'boolean') return 'v-bool'
  if (typeof r.value === 'number') return 'v-num'
  return 'v-str'
}

// 悬浮回顶
const paneEl = ref<HTMLElement | null>(null)
const showTop = ref(false)
function onScroll() {
  const el = paneEl.value
  if (el) showTop.value = el.scrollTop > el.clientHeight * 0.8
}
function toTop() {
  paneEl.value?.scrollTo({ top: 0, behavior: 'smooth' })
}
</script>

<style scoped lang="scss">
.map-table {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: auto;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
}
.mt-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, .9fr) minmax(0, 1fr) minmax(0, 1.35fr);
  background: #f8fafc;
  border-bottom: 1px solid var(--pf-border);
  font-size: 12px;
  font-weight: 700;
  color: var(--pf-text-2);;
  > div { padding: 9px 12px; }
}
.mt-body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.mt-row {
  display: grid;
  grid-template-columns: minmax(0, .9fr) minmax(0, 1fr) minmax(0, 1.35fr);
  align-items: baseline;
  border-bottom: 1px solid #f1f3f8;
  min-height: 33px;
  line-height: 1.6;
  &:hover { background: #fafbff; }
}
.col-cn {
  padding: 5px 8px 5px 0;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-family: var(--pf-font-sans, inherit);
  font-size: 12.5px;
}
.col-key { padding: 5px 12px; min-width: 0; }
.col-val { padding: 5px 12px 5px 0; word-break: break-all; min-width: 0; }
.is-group {
  cursor: pointer;
  background: #fcfdff;
  .caret { color: var(--pf-text-3); flex-shrink: 0; }
  &:hover .caret { color: var(--pf-primary, #6366f1); }
}
.leaf-dot { width: 5px; height: 5px; border-radius: 50%; background: #cbd5e1; flex-shrink: 0; margin-left: 4px; }
.cn-text { color: var(--pf-text-1); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cn-missing { color: var(--pf-text-3); font-weight: 500; }
.cn-array-item { color: #cbd5e1; font-size: 11.5px; }
.cn-tag-missing {
  font-size: 11px;
  color: #b45309;
  background: #fef3c7;
  border-radius: 5px;
  padding: 1px 7px;
  font-weight: 600;
}
.key-text { color: #4f46e5; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-sum { color: var(--pf-text-2); display: flex; align-items: center; gap: 6px; }
.type-badge {
  font-size: 10px;
  font-weight: 700;
  border-radius: 4px;
  padding: 0 5px;
  line-height: 17px;
  &.object { background: #eef2ff; color: #4f46e5; }
  &.array { background: #f0fdf4; color: #047857; }
}
.v-str { color: #047857; }
.v-num { color: #b45309; }
.v-bool { color: #7c3aed; font-weight: 600; }
.v-null { color: #9ca3af; font-style: italic; }
.is-missing-row { background: #fffdf5; }
.mt-empty { padding: 40px; text-align: center; color: var(--pf-text-3); font-size: 13px; }
.back-top {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  width: 34px; height: 34px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--pf-border);
  border-radius: 50%;
  background: rgba(255,255,255,.92);
  color: var(--pf-text-2);
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(15,23,42,.14);
  transition: color .15s, border-color .15s, transform .15s;
  &:hover { color: var(--pf-primary, #6366f1); border-color: var(--pf-primary, #6366f1); transform: translateY(-2px); }
}
.bt-fade-enter-active, .bt-fade-leave-active { transition: opacity .2s, transform .2s; }
.bt-fade-enter-from, .bt-fade-leave-to { opacity: 0; transform: translateY(6px); }
</style>
