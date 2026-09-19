<template>
  <el-drawer v-model="visible" :size="780" :with-header="false" direction="rtl">
    <div class="ver-drawer">
      <!-- ========== 阅读态 ========== -->
      <VersionReader
        v-if="view === 'reader' && readerTarget"
        :label="readerLabel"
        :trigger="readerTrigger"
        :actor="readerActor"
        :time="readerTime"
        :doc="readerDoc"
        :position="`${readerIndex + 1} / ${navList.length}`"
        :has-prev="readerIndex > 0"
        :has-next="readerIndex < navList.length - 1"
        :can-restore="readerTarget.kind === 'version'"
        :restoring="restoring"
        @back="view = 'list'"
        @prev="readerNav(-1)"
        @next="readerNav(1)"
        @restore="restore(readerVersion!)"
      />

      <!-- ========== 列表态 ========== -->
      <template v-else>
        <header class="ver-header">
          <div class="ver-title">
            <AppIcon name="history" tint="indigo" :size="22" />
            <div>
              <div class="t1">历史版本</div>
              <div class="t2">{{ reqTitle }}</div>
            </div>
          </div>
          <button class="close-btn" @click="visible = false"><AppIcon name="x" :size="16" /></button>
        </header>

        <div class="ver-toolbar">
          <template v-if="!picking">
            <el-button size="small" plain type="primary" @click="picking = true">
              <AppIcon name="git-compare" :size="13" /> 选择版本比对
            </el-button>
            <span class="tip">单击任意版本阅读正文</span>
          </template>
          <template v-else>
            <el-button size="small" @click="picking = false; picked = []">取消</el-button>
            <span class="tip pick-tip">
              {{ picked.length === 0 ? '点选第一个版本（含「当前内容」）' : `已选 1 个，再点一个版本开始比对` }}
            </span>
          </template>
        </div>

        <div v-loading="loading" class="ver-body">
          <div v-if="!loading" class="ver-list">
            <!-- 虚拟卡：当前内容 -->
            <button
              class="ver-item current-card"
              :class="{ picked: picked.includes(CUR) }"
              @click="onCardClick({ kind: 'current' })"
            >
              <div class="ver-no cur-no">当前</div>
              <div class="ver-meta">
                <div class="ver-line1">
                  <span class="ver-trigger tr-current">未存版的实时内容</span>
                  <span class="ver-note">可与任意历史版本比对</span>
                </div>
              </div>
              <span v-if="picking" class="pick-dot" :class="{ on: picked.includes(CUR) }"></span>
            </button>

            <button
              v-for="(v, idx) in versions" :key="v.id"
              class="ver-item"
              :class="{ picked: picked.includes(v.id) }"
              @click="onCardClick({ kind: 'version', id: v.id })"
            >
              <div class="ver-no">v{{ v.version_no }}</div>
              <div class="ver-meta">
                <div class="ver-line1">
                  <span class="ver-trigger" :class="`tr-${v.trigger}`">{{ triggerLabel(v.trigger) }}</span>
                  <span v-if="v.note" class="ver-note">{{ v.note }}</span>
                  <span v-if="v.actor" class="ver-actor">{{ actorLabel(v.actor) }}</span>
                </div>
                <div class="ver-line2">
                  <span class="ver-time">{{ formatTime(v.created_at) }}</span>
                  <span v-if="stats(v, idx).total > 0" class="ver-stat">
                    <em class="add">+{{ stats(v, idx).adds }}</em>
                    <em class="del">−{{ stats(v, idx).dels }}</em>
                  </span>
                  <el-tag size="small" :type="v.status === 'confirmed' ? 'success' : 'warning'" effect="plain" class="ver-status">
                    {{ v.status === 'confirmed' ? '已确认' : '待确认' }}
                  </el-tag>
                </div>
              </div>
              <div v-if="!picking && v.id !== versions[0]?.id" class="ver-actions" @click.stop>
                <el-tooltip content="恢复此版本内容（自动再存一版）" placement="top">
                  <button class="vact" :disabled="restoring" @click="restore(v)"><AppIcon name="rotate-ccw" :size="14" /></button>
                </el-tooltip>
              </div>
              <span v-else-if="picking" class="pick-dot" :class="{ on: picked.includes(v.id) }"></span>
            </button>
          </div>
        </div>
      </template>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppIcon from './AppIcon.vue'
import VersionReader from './VersionReader.vue'
import { listReqVersions, restoreReqVersion, getRequirement } from '@/api'
import type { RequirementVersion, Requirement } from '@/types'
import { lineDiff, diffStats } from '@/utils/lineDiff'

const props = defineProps<{ modelValue: boolean; requirementId: string; reqTitle: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; restored: [] }>()
const visible = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) })

const CUR = 'current'
type Target = { kind: 'current' } | { kind: 'version'; id: string }

const versions = ref<RequirementVersion[]>([])
const requirement = ref<Requirement | null>(null)
const loading = ref(false)
const restoring = ref(false)
const view = ref<'list' | 'reader'>('list')
const readerTarget = ref<Target | null>(null)
const picking = ref(false)
const picked = ref<string[]>([])

async function load() {
  loading.value = true
  try {
    const [vers, req] = await Promise.all([listReqVersions(props.requirementId), getRequirement(props.requirementId)])
    versions.value = vers
    requirement.value = req
  } finally {
    loading.value = false
  }
}
watch(() => [props.modelValue, props.requirementId], ([open]) => {
  if (!open) return
  view.value = 'list'
  picking.value = false
  picked.value = []
  load()
}, { immediate: true })

// ---- 卡片点击：多选模式=选端；普通模式=进阅读态 ----
function onCardClick(t: Target) {
  if (!picking.value) {
    readerTarget.value = t
    view.value = 'reader'
    return
  }
  const key = t.kind === 'current' ? CUR : t.id
  const i = picked.value.indexOf(key)
  if (i >= 0) picked.value.splice(i, 1)
  else if (picked.value.length < 2) picked.value.push(key)
  if (picked.value.length === 2) startCompare()
}
function startCompare() {
  const [a, b] = picked.value
  // 点击事件内同步 window.open，避免被弹窗拦截；方向由比对页按版本排序
  const url = `#/versions/diff?rid=${encodeURIComponent(props.requirementId)}&from=${encodeURIComponent(a)}&to=${encodeURIComponent(b)}`
  window.open(url, '_blank')
  picking.value = false
  picked.value = []
}

// ---- 阅读态导航：current 在最新位，其后按 version_no DESC ----
const navList = computed<Target[]>(() => [
  { kind: 'current' },
  ...versions.value.map((v) => ({ kind: 'version' as const, id: v.id })),
])
const readerIndex = computed(() => {
  if (!readerTarget.value) return -1
  return navList.value.findIndex(
    (t) => t.kind === readerTarget.value!.kind && (t.kind === 'current' || t.id === (readerTarget.value as { id: string }).id)
  )
})
function readerNav(dir: -1 | 1) {
  const idx = readerIndex.value + dir
  const t = navList.value[idx]
  if (t) readerTarget.value = t
}
const readerVersion = computed(() =>
  readerTarget.value?.kind === 'version'
    ? versions.value.find((v) => v.id === (readerTarget.value as { id: string }).id) || null
    : null
)
const readerDoc = computed(() =>
  readerTarget.value?.kind === 'current' ? requirement.value?.doc_md || '' : readerVersion.value?.doc_md || ''
)
const readerLabel = computed(() => (readerTarget.value?.kind === 'current' ? '当前内容' : `v${readerVersion.value?.version_no ?? ''}`))
const readerTrigger = computed(() => (readerTarget.value?.kind === 'current' ? '' : triggerLabel(readerVersion.value?.trigger || '')))
const readerActor = computed(() => (readerTarget.value?.kind === 'current' ? '' : actorLabel(readerVersion.value?.actor || '')))
const readerTime = computed(() => (readerTarget.value?.kind === 'current' ? '实时' : formatTime(readerVersion.value?.created_at || '')))

const _statsCache = new Map<string, { adds: number; dels: number; total: number }>()
function stats(v: RequirementVersion, idx: number): { adds: number; dels: number; total: number } {
  const zero = { adds: 0, dels: 0, total: 0 }
  const prev = versions.value[idx + 1]
  if (!prev || v.doc_md === prev.doc_md) return zero
  if (!_statsCache.has(v.id)) {
    const s = diffStats(lineDiff(prev.doc_md, v.doc_md))
    _statsCache.set(v.id, { ...s, total: s.adds + s.dels })
  }
  return _statsCache.get(v.id)!
}

function triggerLabel(t: string) {
  return ({ create: '创建', status: '状态变更', manual: '手动存版', restore: '回滚', ai: 'AI 修订' } as Record<string, string>)[t] || t
}
function actorLabel(a: string) {
  if (a === 'user') return '你'
  if (a.startsWith('ai:')) return 'AI'
  if (a.startsWith('proposer:')) return a.slice(9)
  return a
}
function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === now.toDateString() ? `今天 ${hm}` : `${d.getMonth() + 1}-${pad(d.getDate())} ${hm}`
}

async function restore(v: RequirementVersion) {
  try {
    await ElMessageBox.confirm(`确定把文档恢复到 v${v.version_no} 的内容？当前内容会先自动存一版，可随时找回。`, '恢复版本', {
      type: 'warning', confirmButtonText: '恢复',
    })
  } catch { return }
  restoring.value = true
  try {
    await restoreReqVersion(props.requirementId, v.id)
    ElMessage.success(`已恢复到 v${v.version_no}`)
    await load()
    emit('restored')
    if (view.value === 'reader') readerTarget.value = { kind: 'current' }
  } finally {
    restoring.value = false
  }
}
</script>

<style scoped lang="scss">
.ver-drawer { display: flex; flex-direction: column; height: 100%; background: var(--pf-bg, #f6f7f9); }
.ver-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #fff; border-bottom: 1px solid var(--pf-border, #e7e8ee);
  .ver-title { display: flex; align-items: center; gap: 10px; }
  .t1 { font-size: 15px; font-weight: 700; color: var(--pf-text-1); }
  .t2 { font-size: 11.5px; color: var(--pf-text-3); margin-top: 1px; }
}
.close-btn { border: none; background: transparent; color: var(--pf-text-3); width: 30px; height: 30px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  &:hover { background: var(--pf-bg-hover, #f0f1f5); color: var(--pf-text-1); }
}
.ver-toolbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px 0; }
.tip { font-size: 12px; color: var(--pf-text-3); }
.pick-tip { color: var(--pf-primary, #6366f1); font-weight: 600; }
.ver-body { flex: 1; overflow-y: auto; padding: 14px 20px 24px; }
.ver-list { display: flex; flex-direction: column; gap: 7px; }
.ver-item { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid var(--pf-border, #e7e8ee); border-radius: 10px; padding: 10px 12px; cursor: pointer; text-align: left; transition: box-shadow .15s, border-color .15s;
  &:hover { box-shadow: var(--pf-shadow-xs, 0 1px 3px rgba(20,23,40,.06)); border-color: var(--pf-primary-200, #c7d2fe); }
  &.picked { border-color: var(--pf-primary, #6366f1); box-shadow: 0 0 0 2px rgba(99,102,241,.15); }
}
.ver-no { flex-shrink: 0; font-size: 12.5px; font-weight: 700; color: var(--pf-primary, #6366f1); background: rgba(99,102,241,.08); border-radius: 7px; padding: 4px 8px; }
.cur-no { color: #6d28d9; background: #f3eefe; }
.ver-meta { flex: 1; min-width: 0; }
.ver-line1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ver-trigger { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 20px;
  &.tr-create { background: #ecfdf5; color: #059669; } &.tr-status { background: #eff6ff; color: #2563eb; }
  &.tr-manual { background: #f5f3ff; color: #7c3aed; } &.tr-restore { background: #fff7ed; color: #ea580c; }
  &.tr-ai { background: #fef2f2; color: #dc2626; } &.tr-current { background: #f3eefe; color: #6d28d9; }
}
.ver-note { font-size: 12px; color: var(--pf-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ver-actor { font-size: 11px; color: var(--pf-text-3); }
.ver-line2 { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.ver-time { font-size: 11px; color: var(--pf-text-3); }
.ver-stat { font-style: normal; font-size: 11px; display: inline-flex; gap: 6px; .add { color: #059669; font-style: normal; } .del { color: #dc2626; font-style: normal; } }
.ver-status { margin-left: auto; }
.ver-actions { flex-shrink: 0; }
.vact { border: 1px solid var(--pf-border, #e7e8ee); background: #fff; color: var(--pf-text-2); width: 28px; height: 28px; border-radius: 7px; cursor: pointer; display: flex; align-items: center; justify-content: center;
  &:hover:not(:disabled) { border-color: var(--pf-primary, #6366f1); color: var(--pf-primary, #6366f1); }
  &:disabled { opacity: .4; cursor: not-allowed; }
}
.pick-dot { flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--pf-border, #d4d7e0); box-sizing: border-box;
  &.on { border-color: var(--pf-primary, #6366f1); border-width: 5px; }
}
</style>
