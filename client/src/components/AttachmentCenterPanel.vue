<template>
  <div class="att-panel">
    <div class="att-toolbar">
      <span class="att-title">
        <AppIcon name="paperclip" tint="sky" :size="20" />
        项目附件 <small>需求文档、截图、表格、参考原型——项目的全部材料都在这</small>
      </span>
      <div class="att-toolbar-btns">
        <el-upload
          :show-file-list="false" multiple :http-request="doUpload" accept="*/*"
        >
          <el-button size="small" type="primary" :loading="uploading">
            <AppIcon name="plus" :size="14" :stroke-width="2.4" /> 上传材料
          </el-button>
        </el-upload>
      </div>
    </div>

    <!-- 分类筛选 -->
    <div class="att-filters">
      <el-radio-group v-model="catFilter" size="small">
        <el-radio-button value="all">全部（{{ rows.length }}）</el-radio-button>
        <el-radio-button v-for="g in activeGroups" :key="g.key" :value="g.key">
          {{ g.label }}（{{ countOf(g) }}）
        </el-radio-button>
      </el-radio-group>
    </div>
    <div class="att-filters second">
      <el-select v-model="convFilter" size="small" placeholder="全部来源" clearable style="width: 190px">
        <el-option label="项目直接上传" value="__direct__" />
        <el-option v-for="c in convOptions" :key="c.id" :label="'来自对话：' + c.title" :value="c.id" />
      </el-select>
      <el-input v-model="kw" size="small" placeholder="搜文件名 / 摘要 / 链接" clearable style="width: 220px" :prefix-icon="Search" />
      <el-checkbox v-model="onlyOrphan" size="small" :disabled="orphanCount === 0">
        只看未引用内嵌图（{{ orphanCount }}）
      </el-checkbox>
    </div>

    <!-- 孤儿图清理条 -->
    <div v-if="orphanCount > 0 && !onlyOrphan" class="orphan-bar">
      <span>📎 有 {{ orphanCount }} 张文档内嵌图已不被任何需求文档引用</span>
      <el-button link type="warning" size="small" :loading="cleaning" @click="cleanOrphans">一键清理</el-button>
    </div>

    <div class="att-table-wrap">
      <el-table :data="filtered" class="att-table" row-key="id" v-loading="loading" :empty-text="emptyText" @row-click="openDetail">
      <el-table-column label="文件" min-width="240">
        <template #default="{ row }">
          <div class="file-cell">
            <div class="file-thumb" :class="kindClass(row)">
              <AppIcon :name="row.category === 'webpage' ? 'external-link' : 'file'" :size="16" />
            </div>
            <div class="file-text">
              <span class="file-name">{{ row.filename }}</span>
              <span v-if="row.category === 'webpage' && row.sourceUrl" class="file-sub url">{{ shortUrl(row.sourceUrl) }}</span>
              <span v-else-if="row.summary" class="file-sub">{{ row.summary }}</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="分类" width="112">
        <template #default="{ row }">
          <el-tag size="small" :type="catTagType(row.category)" effect="light">{{ row.categoryLabel }}</el-tag>
          <el-tag v-if="row.category === 'embed' && row.referenced === false" size="small" type="info" effect="plain">未引用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="150">
        <template #default="{ row }">
          <span v-if="row.conversationTitle" class="src-conv" :title="row.conversationTitle">
            <AppIcon name="chat" :size="13" :stroke-width="2.2" />{{ row.conversationTitle }}
          </span>
          <span v-else class="src-direct">项目上传</span>
        </template>
      </el-table-column>
      <el-table-column label="大小" width="80">
        <template #default="{ row }"><span class="muted">{{ row.category === 'webpage' ? '—' : formatSize(row.sizeBytes) }}</span></template>
      </el-table-column>
      <el-table-column label="上传时间" width="142">
        <template #default="{ row }"><span class="muted">{{ fmtTime(row.createdAt) }}</span></template>
      </el-table-column>
      <el-table-column label="操作" width="84" align="right" fixed="right">
        <template #default="{ row }">
          <el-tooltip :content="row.category === 'webpage' ? '打开原链接' : '下载'">
            <button class="fact" @click.stop="openItem(row)"><AppIcon :name="row.category === 'webpage' ? 'external-link' : 'download'" :size="14" /></button>
          </el-tooltip>
          <el-tooltip content="删除">
            <button class="fact danger" @click.stop="remove(row)"><AppIcon name="trash" :size="14" /></button>
          </el-tooltip>
        </template>
      </el-table-column>
      </el-table>
    </div>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailOpen" :title="detail?.filename || '附件详情'" size="440px" direction="rtl">
      <div v-if="detail" class="detail-body" v-loading="detailLoading">
        <!-- 预览区 -->
        <div class="preview-box">
          <template v-if="isImage(detail)">
            <a :href="downloadAttachmentUrl(detail.id) + '?inline=1'" target="_blank" rel="noopener">
              <img :src="downloadAttachmentUrl(detail.id) + '?inline=1'" :alt="detail.filename" />
            </a>
          </template>
          <template v-else-if="detail.category === 'webpage'">
            <div class="preview-web">
              <AppIcon name="external-link" :size="30" />
              <a v-if="detail.sourceUrl" :href="detail.sourceUrl" target="_blank" rel="noopener">{{ shortUrl(detail.sourceUrl || '', 60) }}</a>
            </div>
          </template>
          <template v-else>
            <div class="preview-file" :class="kindClass(detail)">
              <AppIcon name="file" :size="34" />
              <span>{{ detail.mimeType.split('/').pop()?.toUpperCase() || 'FILE' }}</span>
            </div>
          </template>
        </div>

        <div class="d-meta">
          <div class="d-meta-row">
            <span class="d-label">分类</span>
            <el-select v-model="detail.category" size="small" style="width: 170px" @change="changeCategory">
              <el-option v-for="c in CATEGORY_OPTIONS" :key="c.value" :label="c.label" :value="c.value" />
            </el-select>
          </div>
          <div class="d-meta-row"><span class="d-label">大小</span>{{ detail.category === 'webpage' ? '—' : formatSize(detail.sizeBytes) }}</div>
          <div class="d-meta-row"><span class="d-label">来源</span>{{ detail.conversationTitle ? '对话「' + detail.conversationTitle + '」' : '项目直接上传' }}</div>
          <div class="d-meta-row"><span class="d-label">时间</span>{{ fmtTime(detail.createdAt) }}</div>
        </div>

        <div v-if="detail.referencedBy && detail.referencedBy.length" class="d-block">
          <div class="d-block-label">被需求文档引用（{{ detail.referencedBy.length }}）</div>
          <div class="ref-tags">
            <el-tag
              v-for="r in detail.referencedBy" :key="r.id" size="small" effect="plain"
              class="ref-tag" @click="goRequirement(r.id)"
            >
              {{ r.kind === 'page' ? '📄' : '📁' }} {{ r.title }}
            </el-tag>
          </div>
        </div>
        <div v-else-if="detail.category === 'embed'" class="d-block">
          <div class="d-warn">未被任何需求文档引用，删除不会导致文档裂图</div>
        </div>

        <div v-if="detail.extractedText" class="d-block">
          <div class="d-block-label">提取内容 / 网页正文</div>
          <div class="extracted">{{ detail.extractedText }}</div>
        </div>

        <div class="d-actions">
          <el-button v-if="detail.category === 'webpage' && detail.sourceUrl" type="primary" @click="openItem(detail)">
            <AppIcon name="external-link" :size="14" /> 打开原链接
          </el-button>
          <el-button v-else type="primary" @click="openItem(detail)">
            <AppIcon name="download" :size="14" /> 下载
          </el-button>
          <el-button type="danger" plain @click="remove(detail)">删除</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import {
  listAttachments, getAttachmentDetail, uploadAttachment, deleteAttachment,
  updateAttachmentMeta, downloadAttachmentUrl,
  type AttachmentMeta, type AttachmentDetail,
} from '@/api'
import { useChatStore } from '@/stores/chat'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ projectId: string }>()
const store = useChatStore()

const loading = ref(false)
const uploading = ref(false)
const cleaning = ref(false)
const rows = ref<AttachmentMeta[]>([])

// 分类分组（兼容 RAP 遗留 key）
const GROUPS: Array<{ key: string; label: string; cats: string[] }> = [
  { key: 'doc', label: '需求/参考文档', cats: ['doc', 'financial', 'credit', 'business_license', 'litigation', 'tax'] },
  { key: 'screenshot', label: '截图/图片', cats: ['screenshot'] },
  { key: 'form', label: '表格/清单', cats: ['form'] },
  { key: 'prototype', label: '原型/设计稿', cats: ['prototype'] },
  { key: 'contract', label: '合同/协议', cats: ['contract'] },
  { key: 'report', label: '报告', cats: ['report'] },
  { key: 'data', label: '数据样例', cats: ['data'] },
  { key: 'webpage', label: '网页链接', cats: ['webpage'] },
  { key: 'embed', label: '文档内嵌图', cats: ['embed'] },
  { key: 'other', label: '其他', cats: ['other', 'id_document'] },
]
const CATEGORY_OPTIONS = [
  { value: 'doc', label: '需求/参考文档' },
  { value: 'screenshot', label: '截图/图片' },
  { value: 'form', label: '表格/清单' },
  { value: 'prototype', label: '原型/设计稿' },
  { value: 'contract', label: '合同/协议' },
  { value: 'report', label: '报告' },
  { value: 'data', label: '数据样例' },
  { value: 'webpage', label: '网页链接' },
  { value: 'other', label: '其他' },
]

const catFilter = ref('all')
const convFilter = ref('')
const onlyOrphan = ref(false)
const kw = ref('')

const activeGroups = computed(() =>
  GROUPS.filter((g) => rows.value.some((r) => g.cats.includes(r.category)))
)
function countOf(g: { cats: string[] }) {
  return rows.value.filter((r) => g.cats.includes(r.category)).length
}
const convOptions = computed(() => {
  const map = new Map<string, string>()
  for (const r of rows.value) {
    if (r.conversationId && r.conversationTitle) map.set(r.conversationId, r.conversationTitle)
  }
  return [...map.entries()].map(([id, title]) => ({ id, title }))
})
const orphanCount = computed(() =>
  rows.value.filter((r) => r.category === 'embed' && r.referenced === false).length
)
const filtered = computed(() => {
  let list = rows.value
  if (catFilter.value !== 'all') {
    const g = GROUPS.find((x) => x.key === catFilter.value)
    if (g) list = list.filter((r) => g.cats.includes(r.category))
  }
  if (convFilter.value === '__direct__') list = list.filter((r) => !r.conversationId)
  else if (convFilter.value) list = list.filter((r) => r.conversationId === convFilter.value)
  if (onlyOrphan.value) list = list.filter((r) => r.category === 'embed' && r.referenced === false)
  const k = kw.value.trim().toLowerCase()
  if (k) {
    list = list.filter((r) =>
      r.filename.toLowerCase().includes(k) ||
      (r.summary || '').toLowerCase().includes(k) ||
      (r.sourceUrl || '').toLowerCase().includes(k)
    )
  }
  return list
})
const emptyText = computed(() => {
  if (rows.value.length === 0) return '还没有材料，点右上角「上传材料」，或在对话里直接发文件'
  return '没有符合筛选条件的附件'
})

async function load() {
  loading.value = true
  try {
    const res = await listAttachments(props.projectId)
    rows.value = res.attachments
  } finally {
    loading.value = false
  }
}
watch(() => props.projectId, load, { immediate: true })
// 文档编辑器贴/删内嵌图后实时刷新
watch(() => store.attachmentNonce, load)

async function doUpload(opt: any) {
  uploading.value = true
  try {
    await uploadAttachment(props.projectId, opt.file, undefined, false)
    ElMessage.success('已上传：' + opt.file.name)
    await load()
    store.bumpAttachments()
  } catch {
    ElMessage.error('上传失败')
  } finally {
    uploading.value = false
  }
}

async function cleanOrphans() {
  const orphans = rows.value.filter((r) => r.category === 'embed' && r.referenced === false)
  try {
    await ElMessageBox.confirm(`确定清理 ${orphans.length} 张未被文档引用的图片？`, '清理未引用图片', { type: 'warning' })
  } catch { return }
  cleaning.value = true
  try {
    for (const f of orphans) await deleteAttachment(f.id)
    ElMessage.success('已清理')
    await load()
    store.bumpAttachments()
  } finally {
    cleaning.value = false
  }
}

// 详情抽屉
const detailOpen = ref(false)
const detailLoading = ref(false)
const detail = ref<AttachmentDetail | null>(null)
async function openDetail(row: AttachmentMeta) {
  detailOpen.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await getAttachmentDetail(row.id)
  } finally {
    detailLoading.value = false
  }
}
async function changeCategory(cat: string) {
  if (!detail.value) return
  await updateAttachmentMeta(detail.value.id, cat)
  ElMessage.success('分类已更新')
  detail.value.categoryLabel = CATEGORY_OPTIONS.find((c) => c.value === cat)?.label || cat
  await load()
}
function goRequirement(rid: string) {
  detailOpen.value = false
  store.requestOpenRequirement(rid)
}

function openItem(f: AttachmentMeta | AttachmentDetail) {
  if (f.category === 'webpage' && f.sourceUrl) {
    window.open(f.sourceUrl, '_blank', 'noopener')
  } else {
    window.open(downloadAttachmentUrl(f.id), '_blank')
  }
}
async function remove(f: AttachmentMeta | AttachmentDetail) {
  const warn = f.category === 'embed'
    ? '引用它的文档里会裂图。'
    : ''
  try {
    await ElMessageBox.confirm(`确定删除「${f.filename}」？${warn}`, '删除附件', {
      type: 'warning', confirmButtonText: '删除',
    })
    await deleteAttachment(f.id)
    ElMessage.success('已删除')
    detailOpen.value = false
    await load()
    store.bumpAttachments()
  } catch { /* cancelled */ }
}

function isImage(f: AttachmentDetail | AttachmentMeta) {
  return f.mimeType.startsWith('image/') && f.category !== 'webpage'
}
function kindClass(f: AttachmentMeta | AttachmentDetail) {
  if (f.category === 'webpage') return 'fi-sky'
  if (f.mimeType.includes('pdf')) return 'fi-rose'
  if (f.mimeType.includes('word')) return 'fi-sky'
  if (f.mimeType.includes('sheet') || f.mimeType.includes('excel')) return 'fi-emerald'
  if (f.mimeType.startsWith('image/')) return 'fi-violet'
  return 'fi-slate'
}
function catTagType(cat: string) {
  const map: Record<string, string> = {
    doc: '', screenshot: 'warning', form: 'success', prototype: 'danger',
    contract: 'info', report: 'success', data: 'warning', webpage: '', embed: 'info', other: 'info',
  }
  return map[cat] || 'info'
}
function shortUrl(url: string, n = 46) {
  try {
    const u = new URL(url)
    const s = u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '')
    return s.length > n ? s.slice(0, n) + '…' : s
  } catch {
    return url.slice(0, n)
  }
}
function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function fmtTime(iso: string) {
  const d = new Date(iso)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<style scoped lang="scss">
.att-panel { display: flex; flex-direction: column; height: 100%; background: var(--pf-bg); }
.att-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px 10px;
}
.att-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700; color: var(--pf-text-1);
  white-space: nowrap; flex-shrink: 0;
  small { font-size: 12px; font-weight: 400; color: var(--pf-text-3); margin-left:4px; white-space: nowrap; }
}
.att-filters {
  display: flex; align-items: center; gap: 10px;
  padding: 0 20px 10px; flex-wrap: wrap;
  &.second { padding-top: 0; }
}
.orphan-bar {
  display: flex; align-items: center; justify-content: space-between;
  margin: 0 20px 8px; padding: 6px 12px;
  font-size: 12px; color: var(--pf-warning, #d97706);
  background: var(--pf-tint-amber-bg, #fef3c733);
  border-radius: 8px;
}
.att-table-wrap { flex: 1; margin: 0 20px 20px; border-radius: var(--pf-r-lg); overflow: hidden; min-height: 0; display: flex; }
.att-table { flex: 1; width: 100%; }
.file-cell { display: flex; gap: 10px; align-items: center; cursor: pointer; min-width: 0; }
.file-thumb {
  width: 34px; height: 34px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  &.fi-rose { background: var(--pf-tint-rose-bg); color: var(--pf-tint-rose); }
  &.fi-sky { background: var(--pf-tint-sky-bg); color: var(--pf-tint-sky); }
  &.fi-emerald { background: var(--pf-tint-emerald-bg); color: var(--pf-tint-emerald); }
  &.fi-violet { background: var(--pf-tint-violet-bg); color: var(--pf-tint-violet); }
  &.fi-slate { background: var(--pf-tint-slate-bg); color: var(--pf-tint-slate); }
}
.file-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.file-name {
  font-size: 13.5px; font-weight: 600; color: var(--pf-text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.file-sub {
  font-size: 11.5px; color: var(--pf-text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  &.url { color: var(--pf-tint-sky, #2f7de1); }
}
.src-conv {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12.5px; color: var(--pf-text-2);
  max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.src-direct { font-size: 12.5px; color: var(--pf-text-3); }
.muted { font-size: 12px; color: var(--pf-text-3); }
.fact {
  border: none; background: transparent; color: var(--pf-text-3);
  width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .15s;
  &:hover { background: var(--pf-bg-hover); color: var(--pf-text-1); }
  &.danger:hover { color: var(--pf-danger); }
}

/* 详情抽屉 */
.detail-body { padding: 0 20px 20px; }
.preview-box {
  border: 1px solid var(--pf-border); border-radius: 12px; overflow: hidden;
  background: var(--pf-bg-surface); margin-bottom: 16px;
  display: flex; align-items: center; justify-content: center;
  min-height: 180px; max-height: 340px;
  img { max-width: 100%; max-height: 340px; object-fit: contain; display: block; cursor: zoom-in; }
}
.preview-web { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px; color: var(--pf-tint-sky);
  a { font-size: 12.5px; color: var(--pf-primary); word-break: break-all; text-align: center; }
}
.preview-file {
  display: flex; flex-direction: column; gap: 8px; align-items: center;
  width: 84px; height: 84px; border-radius: 14px; justify-content: center;
  font-size: 11px; font-weight: 700; letter-spacing: .5px;
  &.fi-rose { background: var(--pf-tint-rose-bg); color: var(--pf-tint-rose); }
  &.fi-sky { background: var(--pf-tint-sky-bg); color: var(--pf-tint-sky); }
  &.fi-emerald { background: var(--pf-tint-emerald-bg); color: var(--pf-tint-emerald); }
  &.fi-violet { background: var(--pf-tint-violet-bg); color: var(--pf-tint-violet); }
  &.fi-slate { background: var(--pf-tint-slate-bg); color: var(--pf-tint-slate); }
}
.d-meta { display: flex; flex-direction: column; gap: 9px; margin-bottom: 18px; }
.d-meta-row { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--pf-text-2); }
.d-label { width: 42px; flex-shrink: 0; font-size: 12px; color: var(--pf-text-3); }
.d-block { margin-bottom: 16px; }
.d-block-label { font-size: 12px; font-weight: 700; color: var(--pf-text-3); margin-bottom: 8px; }
.ref-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.ref-tag { cursor: pointer; }
.d-warn { font-size: 12.5px; color: var(--pf-warning, #d97706); }
.extracted {
  max-height: 280px; overflow-y: auto;
  white-space: pre-wrap; word-break: break-word;
  font-size: 12.5px; line-height: 1.75; color: var(--pf-text-2);
  background: var(--pf-bg-hover); border-radius: 10px; padding: 10px 14px;
}
.d-actions { display: flex; gap: 8px; margin-top: 20px; }
</style>
