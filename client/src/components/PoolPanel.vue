<template>
  <div class="pool-panel">
    <div class="pool-toolbar">
      <span class="pool-title">
        <AppIcon name="lightbulb" tint="amber" :size="20" />
        需求池 <small>还没成形的想法、反馈、待验证方向，聊成熟了一键转模块/页面</small>
      </span>
      <div class="pool-toolbar-btns">
        <el-button size="small" type="primary" @click="openCreate">
          <AppIcon name="plus" :size="14" :stroke-width="2.4" /> 记一条想法
        </el-button>
      </div>
    </div>

    <!-- 筛选行 -->
    <div class="pool-filters">
      <el-radio-group v-model="statusFilter" size="small">
        <el-radio-button value="active">在池（{{ counts.active }}）</el-radio-button>
        <el-radio-button value="raw">待澄清（{{ counts.raw }}）</el-radio-button>
        <el-radio-button value="ready">可转需求（{{ counts.ready }}）</el-radio-button>
        <el-radio-button value="shelved">搁置（{{ counts.shelved }}）</el-radio-button>
      </el-radio-group>
      <div class="filter-right">
        <el-checkbox v-model="onlyUrgent" size="small"><span class="flg flg-u">🔴 紧急</span></el-checkbox>
        <el-checkbox v-model="onlyImportant" size="small"><span class="flg flg-i">⭐ 重要</span></el-checkbox>
        <el-select v-model="moduleFilter" size="small" placeholder="全部模块" clearable filterable style="width: 150px">
          <el-option v-for="m in modules" :key="m.id" :label="m.title" :value="m.id" />
        </el-select>
        <el-input v-model="kw" size="small" placeholder="搜想法" clearable style="width: 150px" :prefix-icon="Search" />
      </div>
    </div>

    <el-table :data="filtered" class="pool-table" row-key="id" v-loading="loading" :empty-text="emptyText" @row-click="openDetail">
      <el-table-column label="想法" min-width="300">
        <template #default="{ row }">
          <div class="idea-cell" :class="{ shelved: row.pool_status === 'shelved' }">
            <span class="idea-title">{{ row.title }}</span>
            <span v-if="preview(row)" class="idea-summary">{{ preview(row) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="提出人" width="110">
        <template #default="{ row }">
          <span v-if="row.proposer" class="proposer-cell">
            <AppIcon name="user" :size="13" :stroke-width="2.2" />{{ row.proposer }}
          </span>
          <span v-else class="rel-none">—</span>
        </template>
      </el-table-column>
      <el-table-column label="相关模块" width="130">
        <template #default="{ row }">
          <span v-if="moduleName(row.related_module_id)" class="rel-mod">
            <AppIcon name="folder" tint="amber" :size="14" />{{ moduleName(row.related_module_id) }}
          </span>
          <span v-else class="rel-none">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag size="small" :type="statusType(row.pool_status)" effect="light" round>
            {{ statusLabel(row.pool_status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="旗标" width="84" align="center">
        <template #default="{ row }">
          <span class="flag-cell" @click.stop>
            <el-tooltip :content="row.urgent ? '取消紧急' : '标为紧急'" placement="top">
              <button class="flag-btn" :class="{ on: row.urgent }" @click="toggleFlag(row, 'urgent')">🔴</button>
            </el-tooltip>
            <el-tooltip :content="row.important ? '取消重要' : '标为重要'" placement="top">
              <button class="flag-btn" :class="{ on: row.important }" @click="toggleFlag(row, 'important')">⭐</button>
            </el-tooltip>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="入池时间" width="110">
        <template #default="{ row }">{{ fmt(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <span class="row-actions" @click.stop>
            <el-button link type="primary" size="small" @click="openPromote(row)">转成需求</el-button>
            <el-button v-if="row.pool_status !== 'shelved'" link size="small" @click="setStatus(row, 'shelved')">搁置</el-button>
            <el-button v-else link type="warning" size="small" @click="setStatus(row, 'raw')">恢复</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 手动新建 -->
    <el-dialog v-model="showCreate" title="记一条想法到需求池" width="640px" @closed="onCreateClosed">
      <el-form label-position="top">
        <div class="form-row">
          <el-form-item label="想法（一句话）" required style="flex:1">
            <el-input v-model="createForm.title" maxlength="60" show-word-limit placeholder="如：门户首页加 API 试用入口" />
          </el-form-item>
          <el-form-item label="提出人">
            <el-input v-model="createForm.proposer" maxlength="20" placeholder="客户王总 / 自己" style="width: 180px" />
          </el-form-item>
        </div>
        <el-form-item label="补充说明（Markdown，可粘贴截图）">
          <MdEditor v-model="createForm.docMd" :uploading="createUploading" @paste-image="onPasteImage($event, 'create')" @pick-image="onPickImage($event, 'create')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="createUploading" :disabled="!createForm.title.trim()" @click="doCreate">入池</el-button>
      </template>
    </el-dialog>

    <!-- 转正弹窗 -->
    <el-dialog v-model="promoteOpen" title="转成正式需求" width="460px">
      <el-form label-position="top" v-if="promoting">
        <el-form-item label="类型">
          <el-radio-group v-model="promoteForm.kind">
            <el-radio value="module"><AppIcon name="folder" tint="amber" :size="16" /> 模块</el-radio>
            <el-radio value="page"><AppIcon name="file" tint="sky" :size="16" /> 页面</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="需求名称" required>
          <el-input v-model="promoteForm.title" />
        </el-form-item>
        <el-form-item v-if="promoteForm.kind === 'page'" label="归属模块" required>
          <el-select v-model="promoteForm.moduleId" filterable placeholder="选已有模块" style="width: 100%">
            <el-option v-for="m in modules" :key="m.id" :label="m.title" :value="m.id" />
          </el-select>
          <div v-if="!modules.length" class="promote-hint">项目还没有模块，确认后会按名称自动建一个</div>
          <el-input v-if="!promoteForm.moduleId" v-model="promoteForm.moduleTitle" placeholder="或输入新模块名" style="margin-top: 8px" />
        </el-form-item>
        <el-alert type="info" :closable="false" show-icon style="margin-top: 4px">
          转正后这条想法从需求池消失、进需求清单；补充说明会作为需求文档初稿带过去，对话来源保留。
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="promoteOpen = false">取消</el-button>
        <el-button type="primary" :loading="promoting2" :disabled="!canPromote" @click="doPromote">确认转正</el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉（查看 / 编辑两态） -->
    <el-drawer v-model="detailOpen" size="620px" :with-header="false" direction="rtl">
      <div v-if="detail" class="pool-detail">
        <!-- 查看态 -->
        <template v-if="!editing">
          <div class="pd-head">
            <el-tag size="small" :type="statusType(detail.pool_status || '')" round>{{ statusLabel(detail.pool_status || '') }}</el-tag>
            <div class="pd-head-btns">
              <el-button link type="primary" size="small" @click="startEdit">
                <AppIcon name="edit" :size="14" :stroke-width="2.2" /> 编辑
              </el-button>
              <el-button link @click="detailOpen = false"><AppIcon name="x" :size="18" /></el-button>
            </div>
          </div>
          <h3 class="pd-title">{{ detail.title }}</h3>
          <div class="pd-meta">
            <span class="pd-meta-item">
              <span class="pd-meta-label">提出人</span>
              <span v-if="detail.proposer" class="pd-proposer"><AppIcon name="user" :size="13" :stroke-width="2.2" />{{ detail.proposer }}</span>
              <span v-else class="rel-none">未填</span>
            </span>
            <span class="pd-meta-item">
              <span class="pd-meta-label">相关模块</span>
              <span>{{ moduleName(detail.related_module_id) || '未关联，转正时再选' }}</span>
            </span>
            <span class="pd-meta-item">
              <span class="pd-meta-label">来源</span>
              <span>{{ detail.source_conversation_id ? '对话中收入' : '手动记入' }} · {{ fmt(detail.created_at) }}</span>
            </span>
          </div>
          <div class="pd-flags">
            <el-button size="small" :type="detail.urgent ? 'danger' : 'default'" round @click="toggleFlag(detail, 'urgent')">🔴 紧急</el-button>
            <el-button size="small" :type="detail.important ? 'warning' : 'default'" round @click="toggleFlag(detail, 'important')">⭐ 重要</el-button>
            <el-button size="small" round @click="cycleStatus(detail)">
              状态：{{ statusLabel(detail.pool_status || '') }} ↻
            </el-button>
          </div>
          <div v-if="detail.doc_md" class="pd-block">
            <div class="pd-label">补充说明</div>
            <div class="md-render" v-html="renderMarkdown(detail.doc_md)"></div>
          </div>
          <div v-else-if="detail.summary" class="pd-block">
            <div class="pd-label">补充说明</div>
            <div class="pd-summary">{{ detail.summary }}</div>
          </div>
          <div class="pd-actions">
            <el-button type="primary" @click="openPromote(detail)">转成需求</el-button>
            <el-button v-if="detail.pool_status !== 'shelved'" @click="setStatus(detail, 'shelved')">搁置</el-button>
            <el-button v-else type="warning" @click="setStatus(detail, 'raw')">恢复</el-button>
            <el-button type="danger" plain @click="remove(detail)">删除</el-button>
          </div>
        </template>

        <!-- 编辑态 -->
        <template v-else>
          <div class="pd-head">
            <span class="pd-edit-title">编辑想法</span>
            <el-button link @click="cancelEdit"><AppIcon name="x" :size="18" /></el-button>
          </div>
          <el-form label-position="top" class="pd-edit-form">
            <div class="form-row">
              <el-form-item label="想法（一句话）" required style="flex:1">
                <el-input v-model="editForm.title" maxlength="60" show-word-limit />
              </el-form-item>
              <el-form-item label="提出人">
                <el-input v-model="editForm.proposer" maxlength="20" placeholder="客户王总 / 自己" style="width: 180px" />
              </el-form-item>
            </div>
            <el-form-item label="相关模块">
              <el-select v-model="editForm.relatedModuleId" clearable filterable placeholder="未关联" style="width: 100%">
                <el-option v-for="m in modules" :key="m.id" :label="m.title" :value="m.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-radio-group v-model="editForm.poolStatus" size="small">
                <el-radio-button value="raw">待澄清</el-radio-button>
                <el-radio-button value="ready">可转需求</el-radio-button>
                <el-radio-button value="shelved">搁置</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="补充说明（Markdown，可粘贴截图）">
              <MdEditor v-model="editForm.docMd" :uploading="editUploading" @paste-image="onPasteImage($event, 'edit')" @pick-image="onPickImage($event, 'edit')" />
            </el-form-item>
          </el-form>
          <div class="pd-edit-actions">
            <el-button @click="cancelEdit">取消</el-button>
            <el-button type="primary" :loading="saving" :disabled="!editForm.title.trim()" @click="saveEdit">保存</el-button>
          </div>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listRequirements, createPoolItem, updateRequirement, deleteRequirement, promotePoolItem,
  uploadAttachment, downloadAttachmentUrl,
} from '@/api'
import type { Requirement } from '@/types'
import { renderMarkdown } from '@/utils/markdown'
import AppIcon from './AppIcon.vue'
import MdEditor from './MdEditor.vue'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{ projectId: string }>()
const store = useChatStore()

const PROPOSER_KEY = 'pf-pool-proposer'

const all = ref<Requirement[]>([])
const loading = ref(false)
const showCreate = ref(false)
const createUploading = ref(false)
const createForm = ref({ title: '', proposer: '', docMd: '' })

const statusFilter = ref<'active' | 'raw' | 'ready' | 'shelved'>('active')
const onlyUrgent = ref(false)
const onlyImportant = ref(false)
const moduleFilter = ref('')
const kw = ref('')

const promoteOpen = ref(false)
const promoting = ref<Requirement | null>(null)
const promoting2 = ref(false)
const promoteForm = ref({ kind: 'module' as 'module' | 'page', title: '', moduleId: '', moduleTitle: '' })

const detailOpen = ref(false)
const detail = ref<Requirement | null>(null)
const editing = ref(false)
const saving = ref(false)
const editUploading = ref(false)
const editForm = ref({ title: '', proposer: '', docMd: '', relatedModuleId: '', poolStatus: 'raw' as '' | 'raw' | 'ready' | 'shelved' })

async function load() {
  loading.value = true
  try {
    all.value = await listRequirements(props.projectId, true)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => store.poolPanelNonce, load)
// 抽屉关了同步一下列表（旗标/状态可能改过）
watch(detailOpen, (open) => { if (!open) load() })

const poolItems = computed(() => all.value.filter((r) => r.kind === 'idea'))
const modules = computed(() => all.value.filter((r) => r.kind === 'module'))
function moduleName(id?: string | null) {
  if (!id) return ''
  return modules.value.find((m) => m.id === id)?.title || ''
}

/** 列表行摘要：优先 markdown 说明，退旧 summary；去语法符号取纯文本 */
function preview(row: Requirement) {
  const raw = row.doc_md || row.summary || ''
  if (!raw) return ''
  const text = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return text.length > 80 ? text.slice(0, 80) + '…' : text
}

const counts = computed(() => {
  const p = poolItems.value
  return {
    active: p.filter((r) => r.pool_status !== 'shelved').length,
    raw: p.filter((r) => r.pool_status === 'raw').length,
    ready: p.filter((r) => r.pool_status === 'ready').length,
    shelved: p.filter((r) => r.pool_status === 'shelved').length,
  }
})

const filtered = computed(() => {
  let list = poolItems.value
  if (statusFilter.value === 'active') list = list.filter((r) => r.pool_status !== 'shelved')
  else list = list.filter((r) => r.pool_status === statusFilter.value)
  if (onlyUrgent.value) list = list.filter((r) => r.urgent)
  if (onlyImportant.value) list = list.filter((r) => r.important)
  if (moduleFilter.value) list = list.filter((r) => r.related_module_id === moduleFilter.value)
  if (kw.value.trim()) {
    const k = kw.value.trim().toLowerCase()
    list = list.filter((r) =>
      r.title.toLowerCase().includes(k) ||
      (r.doc_md || '').toLowerCase().includes(k) ||
      (r.summary || '').toLowerCase().includes(k) ||
      (r.proposer || '').toLowerCase().includes(k)
    )
  }
  // 排序：紧急/重要优先，再按更新时间
  return [...list].sort((a, b) => {
    const wa = (a.urgent ? 2 : 0) + (a.important ? 1 : 0)
    const wb = (b.urgent ? 2 : 0) + (b.important ? 1 : 0)
    if (wb !== wa) return wb - wa
    return (b.updated_at || '').localeCompare(a.updated_at || '')
  })
})
const emptyText = computed(() => (kw.value || moduleFilter.value ? '没有匹配的想法' : '需求池是空的——聊需求时冒出的点子会自动收进来，也可以手动记一条'))

function statusLabel(s: string) {
  return s === 'ready' ? '可转需求' : s === 'shelved' ? '已搁置' : '待澄清'
}
function statusType(s: string): 'info' | 'warning' | 'success' | 'primary' {
  return s === 'ready' ? 'success' : s === 'shelved' ? 'info' : 'warning'
}
function fmt(s: string) {
  const d = new Date(s)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- 新建 ----------
function openCreate() {
  createForm.value = { title: '', proposer: localStorage.getItem(PROPOSER_KEY) || '', docMd: '' }
  showCreate.value = true
}
function onCreateClosed() {
  createUploading.value = false
}
async function doCreate() {
  if (!createForm.value.title.trim()) return
  const proposer = createForm.value.proposer.trim()
  if (proposer) localStorage.setItem(PROPOSER_KEY, proposer)
  await createPoolItem(props.projectId, {
    title: createForm.value.title.trim(),
    proposer,
    docMd: createForm.value.docMd,
  })
  ElMessage.success('已入池')
  showCreate.value = false
  load()
  store.refreshPoolCount()
}

// ---------- 图片上传（粘贴 / 选择） ----------
async function insertImage(file: File, ta: HTMLTextAreaElement, target: 'create' | 'edit') {
  const holder = target === 'create' ? createForm.value : editForm.value
  const uploading = target === 'create' ? createUploading : editUploading
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('只能粘贴图片')
    return
  }
  uploading.value = true
  try {
    const att = await uploadAttachment(props.projectId, file, undefined, true)
    store.bumpAttachments()
    const snippet = `\n![${file.name.replace(/[\[\]]/g, '')}](${downloadAttachmentUrl(att.id)}?inline=1)\n`
    insertAtCursor(ta, holder, 'docMd', snippet)
  } catch {
    ElMessage.error('图片上传失败')
  } finally {
    uploading.value = false
  }
}
function insertAtCursor(ta: HTMLTextAreaElement, holder: { docMd: string }, key: 'docMd', snippet: string) {
  const text = holder[key]
  const start = ta.selectionStart ?? text.length
  const end = ta.selectionEnd ?? text.length
  holder[key] = text.slice(0, start) + snippet + text.slice(end)
  requestAnimationFrame(() => {
    ta.focus()
    const pos = start + snippet.length
    ta.setSelectionRange(pos, pos)
  })
}
function onPasteImage(payload: { file: File; ta: HTMLTextAreaElement }, target: 'create' | 'edit') {
  insertImage(payload.file, payload.ta, target)
}
function onPickImage(payload: { file: File; ta: HTMLTextAreaElement }, target: 'create' | 'edit') {
  insertImage(payload.file, payload.ta, target)
}

// ---------- 行内操作 ----------
async function toggleFlag(row: Requirement, flag: 'urgent' | 'important') {
  const next = !row[flag]
  await updateRequirement(row.id, { [flag]: next } as any)
  row[flag] = next as any
  if (detail.value?.id === row.id) detail.value = { ...row }
  load()
  store.refreshPoolCount()
}

async function setStatus(row: Requirement, s: 'raw' | 'ready' | 'shelved') {
  await updateRequirement(row.id, { pool_status: s })
  row.pool_status = s
  if (detail.value?.id === row.id) detail.value = { ...row }
  ElMessage.success(s === 'shelved' ? '已搁置' : s === 'ready' ? '已标记为可转需求' : '已恢复为待澄清')
  load()
  store.refreshPoolCount()
}

/** 查看态快捷轮换 raw → ready → raw */
async function cycleStatus(row: Requirement) {
  const next = row.pool_status === 'ready' ? 'raw' : 'ready'
  await setStatus(row, next)
}

async function remove(row: Requirement) {
  await ElMessageBox.confirm(`删除想法「${row.title}」？`, '确认', { type: 'warning' })
  await deleteRequirement(row.id)
  ElMessage.success('已删除')
  if (detail.value?.id === row.id) detailOpen.value = false
  load()
  store.refreshPoolCount()
}

// ---------- 转正 ----------
function openPromote(row: Requirement) {
  detailOpen.value = false
  promoting.value = row
  promoteForm.value = {
    kind: 'module',
    title: row.title,
    moduleId: row.related_module_id || '',
    moduleTitle: '',
  }
  promoteOpen.value = true
}
const canPromote = computed(() =>
  promoteForm.value.title.trim() &&
  (promoteForm.value.kind === 'module' || promoteForm.value.moduleId || promoteForm.value.moduleTitle.trim())
)
async function doPromote() {
  if (!promoting.value || !canPromote.value) return
  promoting2.value = true
  try {
    await promotePoolItem(promoting.value.id, {
      kind: promoteForm.value.kind,
      title: promoteForm.value.title.trim(),
      moduleId: promoteForm.value.moduleId || undefined,
      moduleTitle: promoteForm.value.moduleTitle.trim() || undefined,
    })
    ElMessage.success(`已转成${promoteForm.value.kind === 'page' ? '页面' : '模块'}，去需求清单补文档吧`)
    promoteOpen.value = false
    store.reqPanelNonce++
    load()
    store.refreshPoolCount()
  } finally {
    promoting2.value = false
  }
}

// ---------- 详情 / 编辑 ----------
function openDetail(row: Requirement) {
  detail.value = row
  editing.value = false
  detailOpen.value = true
}
function startEdit() {
  if (!detail.value) return
  editForm.value = {
    title: detail.value.title,
    proposer: detail.value.proposer || '',
    docMd: detail.value.doc_md || detail.value.summary || '',
    relatedModuleId: detail.value.related_module_id || '',
    poolStatus: (detail.value.pool_status || 'raw') as 'raw' | 'ready' | 'shelved',
  }
  editing.value = true
}
function cancelEdit() {
  editing.value = false
}
async function saveEdit() {
  if (!detail.value || !editForm.value.title.trim()) return
  saving.value = true
  try {
    const proposer = editForm.value.proposer.trim()
    if (proposer) localStorage.setItem(PROPOSER_KEY, proposer)
    const updated = await updateRequirement(detail.value.id, {
      title: editForm.value.title.trim(),
      proposer,
      doc_md: editForm.value.docMd,
      related_module_id: editForm.value.relatedModuleId || null,
      pool_status: editForm.value.poolStatus,
    })
    detail.value = updated
    editing.value = false
    ElMessage.success('已保存')
    load()
    store.refreshPoolCount()
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.pool-panel { display: flex; flex-direction: column; height: 100%; background: var(--pf-bg); }
.pool-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px 10px;
}
.pool-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700; color: var(--pf-text-1);
  small { font-size: 12px; font-weight: 400; color: var(--pf-text-3); margin-left: 4px; }
}
.pool-filters {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 0 20px 10px; flex-wrap: wrap;
}
.filter-right { display: flex; align-items: center; gap: 10px; }
.flg { font-size: 12px; }
.pool-table { flex: 1; margin: 0 20px 20px; border-radius: var(--pf-r-lg); overflow: hidden; }
.idea-cell { display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
.idea-title { font-size: 13.5px; font-weight: 600; color: var(--pf-text-1); }
.idea-summary { font-size: 12px; color: var(--pf-text-3); line-height: 1.5; white-space: pre-wrap; }
.shelved .idea-title { text-decoration: line-through; color: var(--pf-text-3); }
.proposer-cell { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--pf-text-2); }
.rel-mod { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--pf-text-2); }
.rel-none { color: var(--pf-text-3); }
.flag-cell { display: inline-flex; gap: 6px; }
.flag-btn {
  border: 0; background: none; cursor: pointer; padding: 2px;
  font-size: 14px; opacity: 0.35; transition: opacity .12s, transform .12s;
  filter: grayscale(1);
  &:hover { transform: scale(1.15); }
  &.on { opacity: 1; filter: none; }
}
.row-actions { display: inline-flex; gap: 2px; }
.promote-hint { font-size: 12px; color: var(--pf-text-3); margin-top: 4px; }
.form-row { display: flex; gap: 14px; align-items: flex-start; }

/* 详情抽屉 */
.pool-detail { padding: 20px 22px; display: flex; flex-direction: column; height: 100%; }
.pd-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.pd-head-btns { display: flex; align-items: center; gap: 6px; }
.pd-edit-title { font-size: 14px; font-weight: 700; color: var(--pf-text-1); }
.pd-title { font-size: 17px; margin: 0 0 12px; color: var(--pf-text-1); }
.pd-meta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-bottom: 14px; }
.pd-meta-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--pf-text-2); }
.pd-meta-label { font-size: 12px; color: var(--pf-text-3); }
.pd-proposer { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--pf-text-1); }
.pd-flags { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
.pd-block { margin-bottom: 16px; }
.pd-label { font-size: 12px; font-weight: 700; color: var(--pf-text-3); margin-bottom: 6px; }
.pd-summary { font-size: 13.5px; line-height: 1.7; color: var(--pf-text-2); white-space: pre-wrap;
  background: var(--pf-bg-hover); border-radius: 8px; padding: 10px 12px; }
.md-render {
  font-size: 13.5px; line-height: 1.75; color: var(--pf-text-2);
  background: var(--pf-bg-hover); border-radius: 10px; padding: 14px 16px;
  :deep(img) { max-width: 100%; border-radius: 8px; margin: 8px 0; display: block; }
  :deep(p) { margin: 8px 0; }
  :deep(h1), :deep(h2), :deep(h3) { color: var(--pf-text-1); margin: 16px 0 8px; }
  :deep(ul), :deep(ol) { padding-left: 22px; margin: 8px 0; }
  :deep(table) { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 12.5px; }
  :deep(th), :deep(td) { border: 1px solid var(--pf-border); padding: 6px 10px; }
  :deep(code) { background: var(--pf-border); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
  :deep(a) { color: var(--pf-primary); }
}
.pd-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 20px; }
.pd-edit-form { flex: 1; overflow-y: auto; }
.pd-edit-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid var(--pf-border); }
</style>
