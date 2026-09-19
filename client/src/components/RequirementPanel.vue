<template>
  <div class="req-panel">
    <!-- 列表：按模块分组 -->
    <div v-if="!current" class="req-list-view">
      <div class="req-toolbar">
        <span class="req-title">需求清单 <small>模块 = 业务功能域（讲干什么/谁用/业务流程），页面挂在模块下（讲字段/交互）</small></span>
        <div class="req-toolbar-btns">
          <el-dropdown trigger="click" @command="onExportPrd">
            <el-button size="small"><AppIcon name="download" :size="14" :stroke-width="2.2" /> 导出 PRD<el-icon class="el-icon--right"><arrow-down /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="pdf" :disabled="exportingPdf">{{ exportingPdf ? 'PDF 生成中…' : '导出 PDF' }}</el-dropdown-item>
                <el-dropdown-item command="md">导出 Markdown</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button size="small" @click="weeklyDialogVisible = true"><AppIcon name="clock" :size="14" :stroke-width="2.2" /> 导出周报</el-button>
          <el-button type="primary" size="small" @click="openCreate"><AppIcon name="plus" :size="14" :stroke-width="2.6" /> 新建需求</el-button>
        </div>
      </div>

      <template v-if="groups.length">
        <div v-for="g in groups" :key="g.module ? g.module.id : 'orphan'" class="req-group">
          <!-- 模块行 -->
          <div v-if="g.module" class="req-row mod-row" @click="open(g.module)">
            <AppIcon name="folder" tint="amber" :size="22" class="row-icon" />
            <strong class="row-name">{{ g.module.title }}</strong>
            <el-tag type="info" size="small" effect="plain">模块</el-tag>
            <el-tag :type="g.module.status === 'confirmed' ? 'success' : 'warning'" size="small">
              {{ g.module.status === 'confirmed' ? '已确认' : '待确认' }}
            </el-tag>
            <span class="row-meta">更新于 {{ fmt(g.module.updated_at) }}</span>
            <span class="row-actions" @click.stop>
              <el-tooltip :content="protoStatus !== 'ready' ? '先在「原型」tab 生成整套主原型，才能按模块增量补充' : (moduleInProto(g.module) ? '只重做这个模块的页面，其他模块和已调整内容不动' : '把这个模块的页面增量加到主原型上')" placement="top">
                <span>
                  <el-button link type="primary" size="small"
                    :disabled="protoStatus !== 'ready'"
                    :loading="genModuleLoading === g.module.id"
                    @click="genModule(g.module)">
                    <AppIcon :name="moduleInProto(g.module) ? 'refresh' : 'monitor'" :size="13" />
                    {{ moduleInProto(g.module) ? '重做原型' : '生成原型' }}
                  </el-button>
                </span>
              </el-tooltip>
              <el-button link size="small" :type="g.module.status === 'confirmed' ? 'warning' : 'success'" @click="toggle(g.module)">
                {{ g.module.status === 'confirmed' ? '取消确认' : '确认' }}
              </el-button>
              <el-button link type="danger" size="small" @click="remove(g.module)">删除</el-button>
            </span>
          </div>
          <!-- 页面行 -->
          <div v-for="p in g.pages" :key="p.id" class="req-row page-row" @click="open(p)">
            <AppIcon name="file" tint="sky" :size="20" class="row-icon" />
            <span class="row-name">{{ p.title }}</span>
            <el-tag :type="p.status === 'confirmed' ? 'success' : 'warning'" size="small">
              {{ p.status === 'confirmed' ? '已确认' : '待确认' }}
            </el-tag>
            <span class="row-meta">更新于 {{ fmt(p.updated_at) }}</span>
            <span class="row-actions" @click.stop>
              <el-tooltip v-if="pageInProto(p)" :content="p.status !== 'confirmed' ? '需求待确认，确认后才能重做原型' : '只重做这一个页面，其他页面不动'" placement="top">
                <span>
                  <el-button link size="small" type="primary" :loading="genPageLoading === p.id"
                    :disabled="protoStatus !== 'ready' || p.status !== 'confirmed'" @click="genPage(p)"><AppIcon name="refresh" :size="13" /> 重做本页</el-button>
                </span>
              </el-tooltip>
              <el-button link size="small" :type="p.status === 'confirmed' ? 'warning' : 'success'" @click="toggle(p)">
                {{ p.status === 'confirmed' ? '取消确认' : '确认' }}
              </el-button>
              <el-button link type="danger" size="small" @click="remove(p)">删除</el-button>
            </span>
          </div>
          <div v-if="g.module && !g.pages.length" class="grp-empty">模块下还没有页面——去对话里聊，AI 会自动把页面沉淀挂上来</div>
        </div>
      </template>
      <el-empty v-else description="还没有需求。去「对话」里聊，聊清楚一个模块/页面 AI 会自动沉淀；也可以点「新建需求」。" />

      <!-- 原型意见收件箱：原型已改、待同步需求文档的业务类意见 -->
      <div v-if="needsReqAnnotations.length" class="annot-inbox">
        <div class="inbox-head">
          <span class="inbox-title"><AppIcon name="inbox" :size="15" :stroke-width="2" /> 原型已改、待同步需求文档（{{ needsReqAnnotations.length }}）</span>
          <el-button type="primary" size="small" :loading="dispatching" @click="dispatchAnnotations">
            同步进需求文档
          </el-button>
        </div>
        <div v-for="a in needsReqAnnotations" :key="a.id" class="inbox-item">
          <div class="inbox-item-head">
            <el-tag size="small" type="info">{{ a.page_title }}</el-tag>
            <el-tag v-if="a.target_label" size="small" type="warning">{{ a.target_label }}</el-tag>
            <span class="inbox-meta">{{ a.author || '匿名' }} · {{ fmt(a.created_at) }}</span>
          </div>
          <p class="inbox-content">{{ a.content }}</p>
        </div>
      </div>
    </div>

    <!-- 详情 -->
    <div v-else class="req-detail-view">
      <div class="detail-toolbar">
        <el-button link @click="current = null"><AppIcon name="arrow-left" :size="14" /> 返回清单</el-button>
        <el-tag size="small" type="info" effect="plain">
          <span class="kind-tag"><AppIcon :name="current.kind === 'page' ? 'file' : 'folder'" :size="12" :stroke-width="2.2" />{{ current.kind === 'page' ? '页面' : '模块' }}</span>
        </el-tag>
        <el-tag v-if="current.kind === 'page' && parentModule" size="small" type="warning" effect="plain">归属：{{ parentModule.title }}</el-tag>
        <strong v-if="!editing" class="title-text">{{ current.title }}</strong>
        <el-input v-else v-model="current.title" class="title-input" />
        <el-tag :type="current.status === 'confirmed' ? 'success' : 'warning'" size="small">
          {{ current.status === 'confirmed' ? '已确认' : '待确认' }}
        </el-tag>
        <div class="spacer" />
        <el-tooltip v-if="current.kind !== 'page'" :content="protoStatus !== 'ready' ? '先在「原型」tab 生成整套主原型' : '只重做这个模块，其他模块和已调整内容不动'" placement="top">
          <span>
            <el-button size="small" type="primary" plain
              :disabled="protoStatus !== 'ready'"
              :loading="genModuleLoading === current.id"
              @click="genModule(current)">
              <AppIcon :name="moduleInProto(current) ? 'refresh' : 'monitor'" :size="13" />
              {{ moduleInProto(current) ? '重做这个模块原型' : '生成这个模块原型' }}
            </el-button>
          </span>
        </el-tooltip>
        <el-tooltip v-else :content="protoStatus !== 'ready' ? '先在「原型」tab 生成整套主原型' : (pageInProto(current) ? '只重做这一个页面，其他页面不动' : '这个页面还没进原型，先用模块生成')" placement="top">
          <span>
            <el-button size="small" type="primary" plain
              :disabled="protoStatus !== 'ready' || !pageInProto(current)"
              :loading="genPageLoading === current.id"
              @click="genPage(current)">
              <AppIcon name="refresh" :size="13" /> 重做这个页面原型
            </el-button>
          </span>
        </el-tooltip>
        <el-button v-if="!editing" size="small" @click="startEdit"><AppIcon name="edit" :size="13" /> 编辑</el-button>
        <template v-else>
          <el-button size="small" @click="cancelEdit">取消</el-button>
          <el-button size="small" type="primary" :loading="saving" @click="saveEdit">保存</el-button>
        </template>
        <el-button v-if="!editing" size="small" :loading="savingVersion" @click="manualSnapshot">
          <AppIcon name="save" :size="13" /> 存一版
        </el-button>
        <el-button v-if="!editing" size="small" @click="versionDrawer = true">
          <AppIcon name="history" :size="13" /> 历史版本
        </el-button>
        <el-button size="small" :type="current.status === 'confirmed' ? 'warning' : 'success'" @click="toggle(current)">
          <template v-if="current.status !== 'confirmed'"><AppIcon name="check" :size="13" :stroke-width="2.6" /> 确认</template>
          <template v-else>取消确认</template>
        </el-button>
      </div>
      <div class="doc-area">
        <template v-if="!editing">
          <div v-if="current.doc_md" ref="docRenderRef" class="doc-render" v-html="renderMarkdown(current.doc_md)" @click="onDocClick"></div>
          <el-empty v-else description="还没有文档，点「编辑」补一份，或去对话里让 AI 沉淀" />
          <DecisionTimeline ref="timelineRef" :key="current.id" :project-id="projectId" :requirement-id="current.id" :doc-md="current.doc_md" :broken-ids="brokenAnchorIds" @loaded="onDecisionsLoaded" />
        </template>
        <MdEditor v-else v-model="editDoc" class="doc-edit" :uploading="docUploading"
          :placeholder="current.kind === 'page' ? pagePlaceholder : modulePlaceholder"
          @paste-image="onDocPasteImage" @pick-image="onDocPasteImage" />
        <DecisionAnchorPopover :state="anchorPopover" @view-timeline="onViewTimeline" />
      </div>
    </div>

    <!-- 新建需求弹窗 -->
    <el-dialog v-model="createDlg" title="新建需求" width="440px">
      <el-form label-width="88px" @submit.prevent>
        <el-form-item label="类型">
          <el-radio-group v-model="createForm.kind">
            <el-radio value="module"><span class="radio-lab"><AppIcon name="folder" tint="amber" :size="18" /> 模块（功能域）</span></el-radio>
            <el-radio value="page"><span class="radio-lab"><AppIcon name="file" tint="sky" :size="18" /> 页面</span></el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名称">
          <el-input v-model="createForm.title" placeholder="模块如「客户管理」，页面如「客户列表页」" @keyup.enter="doCreate" />
        </el-form-item>
        <el-form-item v-if="createForm.kind === 'page'" label="所属模块">
          <el-select v-model="createForm.parentId" placeholder="选择归属模块" style="width: 100%">
            <el-option v-for="m in moduleOptions" :key="m.id" :label="m.title" :value="m.id" />
          </el-select>
          <div v-if="!moduleOptions.length" class="create-hint">还没有模块，请先建模块（或直接去对话里聊，AI 会自动建模块挂页面）</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDlg = false">取消</el-button>
        <el-button type="primary" :disabled="!canCreate" @click="doCreate">创建并补文档</el-button>
      </template>
    </el-dialog>

    <VersionHistoryDrawer
      v-if="current"
      v-model="versionDrawer"
      :requirement-id="current.id"
      :req-title="current.title"
      @restored="onVersionRestored"
    />

    <WeeklyExportDialog v-model="weeklyDialogVisible" :project-id="projectId" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown } from '@element-plus/icons-vue'
import { toConfirmedGroups, buildPrdMarkdown, downloadMarkdown, exportPrdPdf, prdStats } from '@/utils/prdExport'
import axios from 'axios'
import { listRequirements, createRequirement, updateRequirement, deleteRequirement, getRequirement, listAnnotations, syncRequirementsApi, uploadAttachment, downloadAttachmentUrl, saveReqVersion, type Annotation } from '@/api'
import MdEditor from './MdEditor.vue'
import VersionHistoryDrawer from './VersionHistoryDrawer.vue'
import type { Requirement } from '@/types'
import { renderMarkdown } from '@/utils/markdown'
import { useChatStore } from '@/stores/chat'
import AppIcon from './AppIcon.vue'
import DecisionTimeline from './DecisionTimeline.vue'
import DecisionAnchorPopover from './DecisionAnchorPopover.vue'
import WeeklyExportDialog from './WeeklyExportDialog.vue'
import { useHeadingDecisionPills } from '@/composables/useHeadingDecisionPills'
import { useDecisionAnchors } from '@/composables/useDecisionAnchors'
import type { DesignDecision } from '@/types'

const props = defineProps<{ projectId: string }>()

const weeklyDialogVisible = ref(false)
const store = useChatStore()
const annotations = ref<Annotation[]>([])
const dispatching = ref(false)
const needsReqAnnotations = ref<Annotation[]>([])

// 原型状态（模块增量生成依赖主原型已存在）
const protoStatus = ref<'empty' | 'generating' | 'ready' | 'error'>('empty')
const protoReqIds = ref<Set<string>>(new Set()) // 原型里已关联的需求 id（判断模块是否已生成）
let protoPoll: ReturnType<typeof setInterval> | null = null

async function loadProtoStatus() {
  try {
    const { data } = await axios.get(`/api/projects/${props.projectId}/prototype`)
    protoStatus.value = data.status
    const ids = new Set<string>()
    const spec = data.spec
    if (spec) {
      for (const pg of spec.pages || []) if (pg.requirementId) ids.add(pg.requirementId)
      for (const n of spec.nav || []) if (n.requirementId) ids.add(n.requirementId)
    }
    protoReqIds.value = ids
    if (data.status === 'generating') {
      if (!protoPoll) protoPoll = setInterval(loadProtoStatus, 2500)
    } else if (protoPoll) {
      clearInterval(protoPoll); protoPoll = null
    }
  } catch { /* 忽略 */ }
}

function moduleInProto(mod: Requirement): boolean {
  if (protoReqIds.value.has(mod.id)) return true
  return reqs.value.some((r) => r.parent_id === mod.id && protoReqIds.value.has(r.id))
}

const genModuleLoading = ref<string | null>(null)
async function genModule(mod: Requirement) {
  if (protoStatus.value !== 'ready') {
    ElMessage.warning('请先在「原型」tab 生成整套主原型，之后才能按模块增量补充')
    return
  }
  try {
    genModuleLoading.value = mod.id
    await axios.post(`/api/projects/${props.projectId}/prototype/generate-module`, { moduleReqId: mod.id })
    ElMessage.success(`正在生成「${mod.title}」模块，约 20 秒，可切到原型 tab 看页面逐页长出`)
    loadProtoStatus()
    // 切到原型 tab 观看增量生成
    store.mainTab = 'prototype'
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '模块生成触发失败')
  } finally {
    genModuleLoading.value = null
  }
}

function pageInProto(page: Requirement): boolean {
  return protoReqIds.value.has(page.id)
}

const genPageLoading = ref<string | null>(null)
async function genPage(page: Requirement) {
  if (protoStatus.value !== 'ready') {
    ElMessage.warning('请先在「原型」tab 生成整套主原型')
    return
  }
  if (page.status !== 'confirmed') {
    ElMessage.warning('需求还没确认，先确认再重做原型')
    return
  }
  if (!pageInProto(page)) {
    ElMessage.warning('这个页面还没进原型，请先用所属模块的「生成原型」')
    return
  }
  try {
    genPageLoading.value = page.id
    await axios.post(`/api/projects/${props.projectId}/prototype/regenerate-page`, { requirementId: page.id })
    ElMessage.success(`正在重做「${page.title}」页面，约 20 秒，可切到原型 tab 看效果`)
    loadProtoStatus()
    store.mainTab = 'prototype'
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '页面重生成触发失败')
  } finally {
    genPageLoading.value = null
  }
}

// 从沉淀卡片跳转过来：打开指定需求
watch(() => store.openReqNonce, async (n) => {
  if (!n || !store.openReqId) return
  await load()
  const found = reqs.value.find((r) => r.id === store.openReqId)
  if (found) open(found)
  else {
    try { open(await getRequirement(store.openReqId)) } catch { /* ignore */ }
  }
})

const exportingPdf = ref(false)
async function onExportPrd(cmd: string) {
  const confirmed = toConfirmedGroups(groups.value)
  const stats = prdStats(confirmed)
  if (!stats.modules && !stats.pages) {
    ElMessage.warning('还没有已确认的需求——先在清单里确认要导出的模块/页面')
    return
  }
  const projectName = store.currentProject?.name || 'PRD'
  if (cmd === 'md') {
    downloadMarkdown(projectName, buildPrdMarkdown(projectName, confirmed))
    ElMessage.success(`已导出 Markdown（${stats.modules} 模块 / ${stats.pages} 页面）`)
  } else {
    if (exportingPdf.value) return
    exportingPdf.value = true
    try {
      await exportPrdPdf(projectName, confirmed)
      ElMessage.success(`PDF 已生成（${stats.modules} 模块 / ${stats.pages} 页面）`)
    } catch (e) {
      ElMessage.error((e as Error).message || 'PDF 生成失败')
    } finally {
      exportingPdf.value = false
    }
  }
}

const reqs = ref<Requirement[]>([])
const current = ref<Requirement | null>(null)
const editing = ref(false)
const editDoc = ref('')
const saving = ref(false)
const docUploading = ref(false)
const versionDrawer = ref(false)
const savingVersion = ref(false)

/** 手动存一版（内容没变会被后端拒，正常提示） */
async function manualSnapshot() {
  savingVersion.value = true
  try {
    await saveReqVersion(current.value!.id)
    ElMessage.success('已存为新版本')
  } catch (e: any) {
    if (e?.response?.status === 409) ElMessage.info('与上一版完全相同，无需重复存版')
    else ElMessage.error('存版失败')
  } finally {
    savingVersion.value = false
  }
}

/** 从历史抽屉回滚后刷新当前文档 */
async function onVersionRestored() {
  const r = await getRequirement(current.value!.id)
  current.value = r
  load()
}

/** 需求文档编辑器插图（粘贴/选择） */
async function onDocPasteImage(payload: { file: File; ta: HTMLTextAreaElement }) {
  const { file, ta } = payload
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('只能粘贴图片')
    return
  }
  docUploading.value = true
  try {
    const att = await uploadAttachment(props.projectId, file, undefined, true)
    store.bumpAttachments()
    const snippet = `\n![](${downloadAttachmentUrl(att.id)}?inline=1)\n`
    const start = ta.selectionStart ?? editDoc.value.length
    const end = ta.selectionEnd ?? start
    editDoc.value = editDoc.value.slice(0, start) + snippet + editDoc.value.slice(end)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + snippet.length
      ta.setSelectionRange(pos, pos)
    })
  } catch {
    ElMessage.error('图片上传失败')
  } finally {
    docUploading.value = false
  }
}

// 决策章节胶囊：读哪段、看哪段为什么这么定
const docRenderRef = ref<HTMLElement | null>(null)
const timelineRef = ref<InstanceType<typeof DecisionTimeline> | null>(null)
const loadedDecisions = ref<DesignDecision[]>([])
const docMdRef = computed(() => current.value?.doc_md || '')
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
function onDocClick(e: MouseEvent) {
  onPillClick(e)
  onAnchorClick(e)
}
function onViewTimeline(point: string) {
  closeAnchorPopover()
  nextTick(() => {
    timelineRef.value?.focusPoint(point)
    timelineRef.value?.$el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
function onDecisionsLoaded(list: DesignDecision[]) {
  loadedDecisions.value = list
}

const modulePlaceholder = '## 业务背景与目标\n（为什么做这个模块：什么业务场景、谁的什么痛点、做成后达到什么目标，2-4 句）\n## 功能概述\n（这个模块干什么，一两句话）\n## 使用角色\n（谁用、干什么）\n## 业务流程\n（主要业务怎么转，页面之间怎么串）\n## 业务规则\n（模块级规则、权限差异）'
const pagePlaceholder = '## 功能概述\n## 使用角色\n## 页面内容\n（区块/列表/表单/字段，字段用表格）\n## 操作与状态流转\n## 业务规则'

// 模块分组：模块在前（按更新时间），页面缩进挂所属模块下；parent 丢失的页面进「未分组」
const groups = computed(() => {
  const mods = reqs.value
    .filter((r) => r.kind !== 'page')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const pages = reqs.value.filter((r) => r.kind === 'page')
  const gs: Array<{ module: Requirement | null; pages: Requirement[] }> = mods.map((m) => ({
    module: m,
    pages: pages
      .filter((p) => p.parent_id === m.id)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  }))
  const orphans = pages.filter((p) => !p.parent_id || !mods.some((m) => m.id === p.parent_id))
  if (orphans.length) gs.push({ module: null as Requirement | null, pages: orphans })
  return gs
})

const moduleOptions = computed(() =>
  reqs.value.filter((r) => r.kind !== 'page').map((m) => ({ id: m.id, title: m.title }))
)
const parentModule = computed(() =>
  current.value?.parent_id ? reqs.value.find((r) => r.id === current.value!.parent_id) : null
)

// 新建弹窗
const createDlg = ref(false)
const createForm = ref<{ kind: 'module' | 'page'; title: string; parentId: string | null }>({
  kind: 'module', title: '', parentId: null,
})
const canCreate = computed(() => {
  if (!createForm.value.title.trim()) return false
  if (createForm.value.kind === 'page' && !moduleOptions.value.some((m) => m.id === createForm.value.parentId)) return false
  return true
})
function openCreate() {
  createForm.value = { kind: 'module', title: '', parentId: moduleOptions.value[0]?.id || null }
  createDlg.value = true
}
async function doCreate() {
  if (!canCreate.value) return
  const { title, kind, parentId } = createForm.value
  const r = await createRequirement(props.projectId, title.trim(), '', kind, kind === 'page' ? parentId : null)
  createDlg.value = false
  ElMessage.success('已创建，去补文档')
  await load()
  open(r)
  editing.value = true
}

async function loadAnnotations() {
  try {
    annotations.value = await listAnnotations(props.projectId)
    // 收件箱只收：原型已按意见改完、但需同步需求文档的业务类意见（needs_req=1，仍 open）
    needsReqAnnotations.value = annotations.value.filter((a) => a.needs_req && a.status === 'open')
  } catch { /* 静默 */ }
}

/** 把“原型已改、待同步需求”的业务类意见同步进需求文档（无头：不开对话，后台跑完打回待确认） */
async function dispatchAnnotations() {
  if (!needsReqAnnotations.value.length) return
  dispatching.value = true
  const ids = needsReqAnnotations.value.map((a) => a.id)
  try {
    const r = await syncRequirementsApi(props.projectId, ids)
    const names = [...r.revised.map((x) => x.title), ...r.created.map((x) => x.title)]
    ElMessage.success(`需求文档已同步${names.length ? '：' + names.join('、') : ''}，已打回待确认，请复核`)
    await load()
  } catch (e: any) {
    ElMessage.error('同步失败：' + (e?.message || e))
  } finally {
    dispatching.value = false
  }
}

async function load() {
  reqs.value = await listRequirements(props.projectId)
  loadAnnotations()
}

function open(row: Requirement) {
  current.value = row
  editing.value = false
  editDoc.value = row.doc_md || ''
  loadedDecisions.value = []
}

async function toggle(row: Requirement) {
  const next = row.status === 'confirmed' ? 'proposed' : 'confirmed'
  await updateRequirement(row.id, { status: next })
  if (current.value?.id === row.id) current.value = { ...row, status: next }
  ElMessage.success(next === 'confirmed' ? '已确认' : '已改为待确认')
  load()
}

async function remove(row: Requirement) {
  const isModule = row.kind !== 'page'
  const childCount = isModule ? reqs.value.filter((r) => r.kind === 'page' && r.parent_id === row.id).length : 0
  await ElMessageBox.confirm(
    `删除${isModule ? '模块' : '页面'}「${row.title}」？` + (childCount ? `该模块下 ${childCount} 个页面会一起删除。` : ''),
    '提示', { type: 'warning' }
  )
  await deleteRequirement(row.id)
  ElMessage.success('已删除')
  if (current.value?.id === row.id) current.value = null
  load()
}

function startEdit() {
  editDoc.value = current.value?.doc_md || ''
  editing.value = true
}
function cancelEdit() {
  editing.value = false
  editDoc.value = current.value?.doc_md || ''
}
async function saveEdit() {
  saving.value = true
  try {
    const r = await updateRequirement(current.value!.id, {
      title: current.value!.title,
      doc_md: editDoc.value,
    })
    current.value = r
    editing.value = false
    ElMessage.success('已保存')
    load()
  } finally {
    saving.value = false
  }
}

function fmt(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false }).slice(0, 16)
}

onMounted(async () => {
  await load()
  loadProtoStatus()
  // 挂载时若带跳转信号（从对话沉淀卡片点过来），直接打开该需求
  if (store.openReqNonce > 0 && store.openReqId) {
    const found = reqs.value.find((r) => r.id === store.openReqId)
    if (found) open(found)
  }
})
defineExpose({ reload: load })
</script>

<style scoped lang="scss">
.req-panel { height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.req-list-view { height: 100%; overflow: auto; padding: 22px 26px; }
.req-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; gap: 16px; }
.req-toolbar-btns { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.req-title { font-size: 16px; font-weight: 700; color: var(--pf-text-1); }
.req-title small { font-weight: 400; color: var(--pf-text-3); font-size: 12px; margin-left: 10px; }
.empty { color: var(--pf-text-3); line-height: 2; padding: 20px; }

/* 模块/页面分组列表 */
.req-group { margin-bottom: 10px; }
.req-row {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: var(--pf-r-lg); cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
}
.req-row:hover { background: var(--pf-bg-hover); }
.req-row .row-actions { opacity: 0; transition: opacity 0.15s; }
.req-row:hover .row-actions { opacity: 1; }
.mod-row {
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  box-shadow: var(--pf-shadow-xs);
  &:hover { box-shadow: var(--pf-shadow-sm); }
}
.page-row {
  margin: 4px 0 4px 24px;
  border: 1px solid transparent;
  &:hover { border-color: var(--pf-border); background: var(--pf-bg-surface); }
}
.row-icon { flex: 0 0 auto; display: inline-flex; }
.row-name {
  flex: 1 1 auto; min-width: 140px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mod-row .row-name { font-size: 13.5px; font-weight: 600; color: var(--pf-text-1); }
.page-row .row-name { font-size: 13px; color: var(--pf-text-2); font-weight: 500; }
.req-row :deep(.el-tag) { flex: 0 0 auto; }
.row-meta { flex: 0 0 auto; font-size: 11.5px; color: var(--pf-text-3); white-space: nowrap; }
.row-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; white-space: nowrap; }
.grp-empty { margin: 2px 0 6px 38px; font-size: 12px; color: var(--pf-text-3); }
.create-hint { font-size: 12px; color: var(--pf-warning-text); line-height: 1.5; margin-top: 4px; }
.kind-tag { display: inline-flex; align-items: center; gap: 4px; }

/* 原型意见收件箱 */
.annot-inbox {
  margin-top: 24px;
  border-top: 1px dashed var(--pf-border-strong);
  padding-top: 18px;
}
.inbox-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.inbox-title { font-size: 13.5px; font-weight: 700; color: var(--pf-warning-text); display: inline-flex; align-items: center; gap: 6px; }
.inbox-item {
  background: var(--pf-warning-bg);
  border: 1px solid #fde68a;
  border-radius: var(--pf-r-lg);
  padding: 10px 14px;
  margin-bottom: 10px;
}
.inbox-item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.inbox-meta { margin-left: auto; font-size: 11.5px; color: var(--pf-text-3); }
.inbox-content { margin: 0; font-size: 13px; line-height: 1.7; color: var(--pf-text-1); }

.req-detail-view { height: 100%; display: flex; flex-direction: column; overflow: hidden; background: var(--pf-bg-app); }
.detail-toolbar {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 24px; background: var(--pf-bg-surface); border-bottom: 1px solid var(--pf-border); flex-shrink: 0;
}
.title-text {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--pf-text-1);
  white-space: nowrap;
}
.title-input { width: 260px; font-weight: 600; }
.spacer { flex: 1; }
.doc-area { flex: 1; overflow: auto; padding: 24px; }
.doc-render {
  max-width: 820px; margin: 0 auto; background: var(--pf-bg-surface); padding: 32px 40px;
  border-radius: var(--pf-r-xl); box-shadow: var(--pf-shadow-sm); border: 1px solid var(--pf-border); min-height: 300px;
}
.doc-edit { max-width: 900px; margin: 0 auto; display: block; }
.doc-edit :deep(.md-textarea) { min-height: 480px; }

.doc-render :deep(h1) { font-size: 22px; margin: 0 0 16px; }
.doc-render :deep(h2) { font-size: 17px; margin: 24px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--pf-border); }
.doc-render :deep(h3) { font-size: 15px; margin: 16px 0 8px; }
.doc-render :deep(p) { margin: 8px 0; line-height: 1.8; }
.doc-render :deep(ul), .doc-render :deep(ol) { padding-left: 22px; margin: 8px 0; line-height: 1.9; }
.doc-render :deep(table) { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
.doc-render :deep(th), .doc-render :deep(td) { border: 1px solid var(--pf-border); padding: 8px 12px; text-align: left; }
.doc-render :deep(th) { background: var(--pf-bg-hover); font-weight: 600; }
.doc-render :deep(img) { max-width: 100%; border-radius: 8px; margin: 10px 0; display: block; }

/* 章节决策胶囊 */
.doc-render :deep(.doc-decision-pill) {
  display: inline-flex; align-items: center; gap: 3px;
  vertical-align: middle; margin-left: 8px; position: relative; top: -1px;
  height: 20px; padding: 0 7px 0 5px;
  border: 1px solid #c7d2fe; background: #eef2ff; color: #4f46e5;
  border-radius: 999px; font-size: 11px; font-weight: 700; line-height: 1;
  cursor: pointer; transition: all 0.15s;
  svg { display: block; }
  &:hover { background: #4f46e5; border-color: #4f46e5; color: #fff; }
}

/* 决策锚文本：句内行内标记（像超链接） */
.doc-render :deep(.dd-inline-anchor) {
  background: linear-gradient(180deg, transparent 55%, rgba(129, 140, 248, 0.32) 55%);
  border-bottom: 1px solid #818cf8;
  cursor: pointer;
  border-radius: 2px;
  transition: background 0.15s;
  &:hover {
    background: linear-gradient(180deg, transparent 30%, rgba(129, 140, 248, 0.5) 30%);
  }
}

.radio-lab { display: inline-flex; align-items: center; gap: 6px; }
</style>
