<template>
  <div class="jt-node">
    <div ref="rowEl" class="jt-row" :class="{ 'is-root': depth === 0, 'is-active': isActiveRow }" @click="toggle">
      <span class="jt-toggle" :class="{ collapsed: !effectiveOpen && isContainer }">
        <svg v-if="isContainer" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
        <span v-else class="jt-dot"></span>
      </span>

      <span v-if="showKey" class="jt-key"><template v-for="(seg, i) in keySegs" :key="i"><mark v-if="seg.hit" class="j-find">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template><span class="jt-colon">：</span></span>

      <!-- 容器收起态：给一眼摘要 -->
      <template v-if="isContainer">
        <span class="jt-bracket">{{ info.type === 'array' ? '[' : '{' }}</span>
        <span v-if="!effectiveOpen" class="jt-collapsed-preview">
          {{ info.type === 'array' ? `${info.count} 项` : `${info.count} 个字段` }}
        </span>
        <span v-else class="jt-hint">{{ openerLabel }}</span>
      </template>

      <!-- 标量值 -->
      <span v-else class="jt-val" :class="`v-${info.type}`"><template v-for="(seg, i) in valueSegs" :key="i"><mark v-if="seg.hit" class="j-find">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>

      <!-- 复制这一节 -->
      <span class="jt-copy" title="复制此项" @click.stop="copyNode">
        <AppIcon name="copy" :size="12" />
      </span>
    </div>

    <!-- 子项 -->
    <div v-if="isContainer && effectiveOpen" class="jt-children">
      <JsonTreeNode
        v-for="child in childEntries"
        :key="child.pathSeg"
        :label="child.pathSeg"
        :show-key="true"
        :value="child.value"
        :depth="depth + 1"
        :path-prefix="ownPath"
        :global-signal="globalSignal"
        :global-open="globalOpen"
        :search="search"
      />
      <div class="jt-closing-row">
        <span class="jt-bracket">{{ info.type === 'array' ? ']' : '}' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import { describeValue, type JsonValue, type JsonTreeSearch } from '@/utils/jsonTool'

const props = withDefaults(
  defineProps<{
    label?: string | number
    showKey?: boolean
    value: JsonValue
    depth?: number
    /** 父级到本节点的路径（不含自身键） */
    pathPrefix?: (string | number)[]
    /** 父级点「全部展开/折叠」时自增信号 */
    globalSignal?: number
    globalOpen?: boolean
    search?: JsonTreeSearch | null
  }>(),
  { label: '', showKey: false, depth: 0, pathPrefix: () => [], globalSignal: 0, globalOpen: true, search: null }
)

const info = computed(() => describeValue(props.value))
const isContainer = computed(() => info.value.type === 'object' || info.value.type === 'array')
const open = ref(props.depth < 2) // 默认展开前两层

/** 本节点完整路径（根为 []） */
const ownPath = computed<(string | number)[]>(() =>
  props.showKey ? [...props.pathPrefix, props.label as string | number] : props.pathPrefix
)
const ownKey = computed(() => JSON.stringify(ownPath.value))

/** 搜索激活时：保持用户原有展开态，命中节点及其祖先额外强制展开；清空搜索自然恢复 */
const searching = computed(() => !!props.search?.active)
const effectiveOpen = computed(() => {
  if (!searching.value) return open.value
  return open.value || props.search!.expand.has(ownKey.value)
})

const isKeyHit = computed(() => searching.value && props.search!.keyHits.has(ownKey.value))
const isValueHit = computed(() => searching.value && props.search!.valueHits.has(ownKey.value))
const isActiveRow = computed(() => searching.value && props.search!.activeKey === ownKey.value)

watch(
  () => props.globalSignal,
  () => {
    if (isContainer.value) open.value = props.globalOpen
  }
)

// 当前命中节点滚动到可视区
const rowEl = ref<HTMLElement | null>(null)
watch(
  () => props.search?.activeTick,
  () => {
    if (isActiveRow.value) rowEl.value?.scrollIntoView({ block: 'nearest' })
  }
)

function toggle() {
  if (isContainer.value) open.value = !open.value
}

const openerLabel = computed(() => (info.value.type === 'array' ? `数组 · ${info.value.count} 项` : `对象 · ${info.value.count} 个字段`))

const rawScalarText = computed(() => {
  if (info.value.type === 'string') return `"${info.value.preview}"`
  return info.value.preview
})

interface Seg { text: string; hit: boolean }

/** 按关键词把文本切成 命中/普通 段，忽略大小写 */
function splitByKeyword(text: string): Seg[] {
  const kw = props.search?.keyword.trim()
  if (!kw || !searching.value) return [{ text, hit: false }]
  const lower = text.toLowerCase()
  const needle = kw.toLowerCase()
  const segs: Seg[] = []
  let i = 0
  let idx = lower.indexOf(needle, i)
  while (idx >= 0) {
    if (idx > i) segs.push({ text: text.slice(i, idx), hit: false })
    segs.push({ text: text.slice(idx, idx + needle.length), hit: true })
    i = idx + needle.length
    idx = lower.indexOf(needle, i)
  }
  if (i < text.length) segs.push({ text: text.slice(i), hit: false })
  return segs.length ? segs : [{ text, hit: false }]
}

const keySegs = computed<Seg[]>(() => (isKeyHit.value ? splitByKeyword(String(props.label)) : [{ text: String(props.label), hit: false }]))
const valueSegs = computed<Seg[]>(() => (isValueHit.value ? splitByKeyword(rawScalarText.value) : [{ text: rawScalarText.value, hit: false }]))

interface ChildEntry {
  key: string
  pathSeg: string | number
  value: JsonValue
}
const childEntries = computed<ChildEntry[]>(() => {
  const v = props.value
  if (Array.isArray(v)) return v.map((item, i) => ({ key: String(i), pathSeg: i, value: item }))
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, JsonValue>).map(([key, value]) => ({ key, pathSeg: key, value }))
  }
  return []
})

async function copyNode() {
  const text = isContainer.value ? JSON.stringify(props.value, null, 2) : String(props.value)
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，浏览器不允许剪贴板访问')
  }
}
</script>

<style scoped lang="scss">
.jt-node {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.9;
}
.jt-row {
  position: relative;
  padding: 0 26px 0 20px;
  border-radius: 5px;
  cursor: default;
  overflow-wrap: anywhere;
  &:hover { background: rgba(99,102,241,.07); .jt-copy { opacity: 1; } }
  &.is-active {
    background: rgba(99,102,241,.14);
    box-shadow: inset 2px 0 0 var(--pf-primary, #6366f1);
  }
}
.jt-row.is-root { font-weight: 600; }
.jt-toggle {
  position: absolute;
  left: 2px;
  top: 1px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--pf-text-3);
  &.collapsed svg { transform: rotate(-90deg); }
  .jt-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--pf-border-strong, #d6d9e2); }
}
.jt-key { color: #4f46e5; font-weight: 600; }
.jt-colon { color: var(--pf-text-3); }
.jt-bracket { color: var(--pf-text-3); font-weight: 700; }
.jt-hint { color: var(--pf-text-3); font-size: 11.5px; font-family: var(--pf-font-sans, inherit); }
.jt-collapsed-preview {
  color: var(--pf-text-3);
  font-size: 11.5px;
  font-family: var(--pf-font-sans, inherit);
  background: var(--pf-bg-subtle, #f3f4fa);
  border-radius: 4px;
  padding: 0 6px;
}
.jt-val {
  &.v-string { color: #047857; }
  &.v-number { color: #b45309; }
  &.v-boolean { color: #7c3aed; font-weight: 600; }
  &.v-null { color: #9ca3af; font-style: italic; }
}
:deep(mark.j-find) {
  background: #fde68a;
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
}
.is-active :deep(mark.j-find) {
  background: #f59e0b;
  color: #1f2937;
}
.jt-copy {
  position: absolute;
  right: 5px;
  top: 50%;
  transform: translateY(-50%);
  padding: 2px 4px;
  background: var(--pf-bg-surface, #fff);
  color: var(--pf-text-3);
  cursor: pointer;
  opacity: 0;
  transition: opacity .15s;
  border-radius: 4px;
  .el-icon { font-size: 13px; }
  &:hover { color: var(--pf-primary, #6366f1); }
}
.jt-children {
  margin-left: 12px;
  padding-left: 8px;
  border-left: 1px dashed var(--pf-border, #e7e8ee);
}
.jt-closing-row {
  padding: 0 8px;
  color: var(--pf-text-3);
  font-weight: 700;
  font-size: 12px;
}
</style>
