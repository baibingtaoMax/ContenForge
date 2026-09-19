<template>
  <div class="diff-view">
    <header class="page-header">
      <div class="header-left">
        <el-button text :icon="ArrowLeft" @click="goBack">返回</el-button>
        <div class="header-title">
          <AppIcon name="git-compare" tint="violet" :size="38" />
          <div>
            <h1>{{ reqTitle }}</h1>
            <p class="cmp-flow">
              版本比对：<strong :class="{ cur: oldSide?.ep === 'current' }">{{ oldLabel }}</strong>
              <AppIcon name="arrow-right" :size="12" />
              <strong :class="{ cur: newSide?.ep === 'current' }">{{ newLabel }}</strong>
              <span v-if="ready" class="cmp-stat">
                <em class="n-add">+{{ stats.adds }}</em>
                <em class="n-del">−{{ stats.dels }}</em>
                <em v-if="changedLines" class="n-mod">改 {{ changedLines }}</em>
                <span v-if="isSame" class="same-tag">两版完全一致</span>
              </span>
            </p>
          </div>
        </div>
      </div>
      <div class="header-right">
        <div class="sw"><el-switch v-model="collapseSame" size="small" /><span @click="collapseSame = !collapseSame">折叠相同行</span></div>
        <el-radio-group v-model="mode" size="small">
          <el-radio-button value="split">双栏对照</el-radio-button>
          <el-radio-button value="unified">统一视图</el-radio-button>
          <el-radio-button value="old">旧版全文</el-radio-button>
          <el-radio-button value="new">新版全文</el-radio-button>
        </el-radio-group>
      </div>
    </header>

    <div v-loading="loading" class="diff-main">
      <div v-if="error" class="state-box">
        <AppIcon name="alert-triangle" :size="28" tint="rose" />
        <p>{{ error }}</p>
      </div>
      <template v-else-if="ready">
        <DiffResultPane v-if="mode === 'split'" :rows="rows" :collapse-same="collapseSame" />
        <DiffUnifiedPane v-else-if="mode === 'unified'" :rows="rows" :collapse-same="collapseSame" />
        <div v-else-if="mode === 'old'" class="full-text-scroll">
          <article class="md-doc" v-html="renderMarkdown(oldDoc)"></article>
        </div>
        <div v-else class="full-text-scroll">
          <article class="md-doc" v-html="renderMarkdown(newDoc)"></article>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import DiffResultPane from '@/components/tools/DiffResultPane.vue'
import DiffUnifiedPane from '@/components/tools/DiffUnifiedPane.vue'
import { listReqVersions, getRequirement } from '@/api'
import type { RequirementVersion, Requirement } from '@/types'
import { lineDiff } from '@/utils/lineDiff'
import { pairRows } from '@/utils/charDiff'
import { renderMarkdown } from '@/utils/markdown'

const route = useRoute()
const router = useRouter()
const CURRENT = 'current'

const loading = ref(true)
const error = ref('')
const requirement = ref<Requirement | null>(null)
const versions = ref<RequirementVersion[]>([])
const mode = ref<'split' | 'unified' | 'old' | 'new'>('split')
const collapseSame = ref(false)

interface Side {
  ep: string
  label: string
  doc: string
  /** 排序权重：current 永远最新；存档版按 version_no */
  order: number
}
const oldSide = ref<Side | null>(null)
const newSide = ref<Side | null>(null)

onMounted(load)
// 同一标签内 hash query 变化（边界场景，正常流程是 window.open 新标签）也要重算
watch(
  () => [route.query.rid, route.query.from, route.query.to],
  () => load()
)

async function load() {
  const ridv = String(route.query.rid || '')
  const fromEp = String(route.query.from || '')
  const toEp = String(route.query.to || '')
  loading.value = true
  error.value = ''
  oldSide.value = null
  newSide.value = null
  if (!ridv || !fromEp || !toEp || fromEp === toEp) {
    error.value = '比对链接无效：缺少需求或版本参数。'
    loading.value = false
    return
  }
  try {
    const [vers, req] = await Promise.all([
      listReqVersions(ridv),
      fromEp === CURRENT || toEp === CURRENT ? getRequirement(ridv) : Promise.resolve(null),
    ])
    versions.value = vers
    requirement.value = req
    const resolve = (ep: string): Side => {
      if (ep === CURRENT) {
        if (!req) throw new Error('no-current')
        return { ep: CURRENT, label: '当前内容', doc: req.doc_md, order: Number.MAX_SAFE_INTEGER }
      }
      const v = vers.find((x) => x.id === ep)
      if (!v) throw new Error('no-version')
      return { ep, label: `v${v.version_no}`, doc: v.doc_md, order: v.version_no }
    }
    const a = resolve(fromEp)
    const b = resolve(toEp)
    // 按版本方向归位（旧 → 新）
    const [lo, hi] = a.order <= b.order ? [a, b] : [b, a]
    oldSide.value = lo
    newSide.value = hi
  } catch {
    error.value = '找不到指定的需求或版本，可能已被删除，请回版本历史重新发起比对。'
  } finally {
    loading.value = false
  }
}

const rows = computed(() =>
  oldSide.value && newSide.value ? pairRows(lineDiff(oldSide.value.doc, newSide.value.doc)) : []
)
const stats = computed(() => {
  let adds = 0
  let dels = 0
  for (const r of rows.value) {
    if (r.op === 'add') adds++
    else if (r.op === 'del') dels++
    else if (r.op === 'mod') { adds++; dels++ }
  }
  return { adds, dels }
})
const changedLines = computed(() => rows.value.filter((r) => r.op === 'mod').length)
const reqTitle = computed(() => requirement.value?.title || '版本比对')
const isSame = computed(() => stats.value.adds === 0 && stats.value.dels === 0)
const ready = computed(() => !!(oldSide.value && newSide.value))
const oldLabel = computed(() => oldSide.value?.label || '')
const newLabel = computed(() => newSide.value?.label || '')
const oldDoc = computed(() => oldSide.value?.doc || '')
const newDoc = computed(() => newSide.value?.doc || '')

function goBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}
</script>

<style scoped lang="scss">
.diff-view { height: 100%; display: flex; flex-direction: column; background: var(--pf-bg-page, #f6f7fb); }
.page-header {
  height: 72px; flex-shrink: 0; background: var(--pf-bg-surface);
  border-bottom: 1px solid var(--pf-border);
  display: flex; align-items: center; justify-content: space-between; padding: 0 28px; gap: 16px;
  .header-left { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .header-title { display: flex; align-items: center; gap: 12px; min-width: 0;
    h1 { font-size: 18px; font-weight: 700; margin: 0; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cmp-flow { font-size: 12.5px; color: var(--pf-text-3); margin: 3px 0 0; display: flex; align-items: center; gap: 6px;
      strong { color: var(--pf-text-1); font-weight: 700; }
      strong.cur { color: #6d28d9; }
    }
  }
  .header-right { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
  .sw { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--pf-text-2); white-space: nowrap; user-select: none;
    span { cursor: pointer; }
  }
  .cmp-stat { display: inline-flex; align-items: center; gap: 8px; margin-left: 6px; font-style: normal;
    em { font-style: normal; font-weight: 700; } .n-add { color: #059669; } .n-del { color: #dc2626; }
    .n-mod { color: var(--pf-primary, #6366f1); font-weight: 600; } .same-tag { color: var(--pf-text-3); font-weight: 500; }
  }
}
.diff-main { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px 28px 20px; }
.state-box { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
  color: var(--pf-text-3); font-size: 13px;
  p { margin: 0; }
}
.full-text-scroll {
  flex: 1; min-height: 0; overflow: auto;
  padding: 20px 24px 32px;
  background: var(--pf-bg-page, #f6f7fb);
}
</style>
