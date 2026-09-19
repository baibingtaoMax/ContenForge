<template>
  <div class="attachment-panel">
    <div class="panel-header">
      <span class="panel-title">
        <AppIcon name="paperclip" :size="14" :stroke-width="2" />
        {{ projectId ? '项目附件' : '对话附件' }}
      </span>
    </div>

    <div v-if="attachments.length === 0 && embedCount === 0" class="empty">
      暂无附件，点输入框上传需求文档、系统截图、表格、参考原型等材料
    </div>
    <div v-else-if="attachments.length === 0" class="empty">
      暂无项目材料（文档里贴的截图收在下方「内嵌图片」里）
    </div>

    <div v-else class="file-list">
      <div v-for="f in attachments" :key="f.id" class="file-item">
        <div class="file-icon" :class="f.category === 'webpage' ? 'fi-sky' : `fi-${fileKind(f.mimeType)}`">
          <AppIcon :name="f.category === 'webpage' ? 'external-link' : 'file'" :size="16" />
        </div>
        <div class="file-info">
          <div class="file-name" :title="f.filename">{{ f.filename }}</div>
          <div class="file-meta">
            <el-tag size="small" :type="categoryColor(f.category)" effect="light">
              {{ f.categoryLabel }}
            </el-tag>
            <span v-if="f.category === 'webpage' && f.sourceUrl" class="file-url" :title="f.sourceUrl">{{ shortUrl(f.sourceUrl) }}</span>
            <span v-else class="file-size">{{ formatSize(f.sizeBytes) }}</span>
          </div>
        </div>
        <div class="file-actions">
          <el-tooltip :content="f.category === 'webpage' ? '打开原链接' : '下载'">
            <button class="fact" @click="openItem(f)"><AppIcon :name="f.category === 'webpage' ? 'external-link' : 'download'" :size="14" /></button>
          </el-tooltip>
          <el-tooltip content="删除">
            <button class="fact danger" @click="remove(f)"><AppIcon name="trash" :size="14" /></button>
          </el-tooltip>
        </div>
      </div>
    </div>

    <!-- 文档内嵌图：默认折叠，可查看引用状态、清理孤儿图 -->
    <div v-if="projectId && embedCount > 0" class="embed-section">
      <button class="embed-toggle" @click="toggleEmbed">
        <AppIcon :name="embedOpen ? 'chevron-down' : 'chevron-right'" :size="13" :stroke-width="2.4" />
        文档内嵌图片（{{ embedCount }}）
        <span v-if="orphanCount > 0" class="orphan-badge">{{ orphanCount }} 张未引用</span>
      </button>
      <div v-if="embedOpen" class="embed-list">
        <div v-if="orphanCount > 0" class="orphan-bar">
          <span>{{ orphanCount }} 张图片已不在任何需求文档里引用</span>
          <el-button link type="danger" size="small" :loading="cleaning" @click="cleanOrphans">一键清理</el-button>
        </div>
        <div v-for="f in embedItems" :key="f.id" class="file-item" :class="{ orphan: !f.referenced }">
          <div class="file-icon fi-violet"><AppIcon name="file" :size="16" /></div>
          <div class="file-info">
            <div class="file-name" :title="f.filename">{{ f.filename }}</div>
            <div class="file-meta">
              <span class="file-size">{{ formatSize(f.sizeBytes) }}</span>
              <el-tag v-if="!f.referenced" size="small" type="info" effect="plain">未引用</el-tag>
            </div>
          </div>
          <div class="file-actions">
            <el-tooltip content="新窗口查看">
              <button class="fact" @click="windowOpen(f)"><AppIcon name="external-link" :size="14" /></button>
            </el-tooltip>
            <el-tooltip content="删除">
              <button class="fact danger" @click="removeEmbed(f)"><AppIcon name="trash" :size="14" /></button>
            </el-tooltip>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listAttachments, listEmbedAttachments, listConversationAttachments,
  downloadAttachmentUrl, deleteAttachment, type AttachmentMeta
} from '@/api'
import AppIcon from './AppIcon.vue'
import { useChatStore } from '@/stores/chat'

const props = defineProps<{ projectId?: string; conversationId?: string }>()
const store = useChatStore()

const attachments = ref<AttachmentMeta[]>([])
const embedItems = ref<AttachmentMeta[]>([])
const embedCount = ref(0)
const embedOpen = ref(false)
const cleaning = ref(false)
const orphanCount = computed(() => embedItems.value.filter((f) => !f.referenced).length)

async function load() {
  if (props.projectId) {
    const res = await listAttachments(props.projectId)
    attachments.value = res.attachments
    embedCount.value = res.embedCount || 0
    if (embedOpen.value) await loadEmbed()
  } else if (props.conversationId) {
    attachments.value = await listConversationAttachments(props.conversationId)
    embedCount.value = 0
  } else {
    attachments.value = []
    embedCount.value = 0
  }
}
async function loadEmbed() {
  if (!props.projectId) return
  const res = await listEmbedAttachments(props.projectId)
  embedItems.value = res.attachments.filter((f) => f.category === 'embed')
  embedCount.value = res.embedCount
}
async function toggleEmbed() {
  embedOpen.value = !embedOpen.value
  if (embedOpen.value) await loadEmbed()
}
async function cleanOrphans() {
  const orphans = embedItems.value.filter((f) => !f.referenced)
  try {
    await ElMessageBox.confirm(`确定清理 ${orphans.length} 张未被文档引用的图片？`, '清理未引用图片', { type: 'warning' })
  } catch { return }
  cleaning.value = true
  try {
    for (const f of orphans) await deleteAttachment(f.id)
    ElMessage.success('已清理')
    await loadEmbed()
  } finally {
    cleaning.value = false
  }
}
watch(() => [props.projectId, props.conversationId], load, { immediate: true })
// 文档编辑器里贴/删内嵌图后自动刷新角标
watch(() => store.attachmentNonce, load)

defineExpose({ reload: load })

function fileKind(mime: string) {
  if (mime.includes('pdf')) return 'rose'
  if (mime.includes('word')) return 'sky'
  if (mime.includes('sheet') || mime.includes('excel')) return 'emerald'
  if (mime.startsWith('image/')) return 'violet'
  return 'slate'
}

function categoryColor(cat: string) {
  const map: Record<string, string> = {
    doc: '', screenshot: 'warning', form: 'success', prototype: 'danger',
    contract: 'info', report: 'success', data: 'warning', webpage: '', other: 'info',
  }
  return map[cat] || 'info'
}

function shortUrl(url?: string | null) {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '')
  } catch {
    return url.slice(0, 40)
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function download(f: AttachmentMeta) {
  window.open(downloadAttachmentUrl(f.id), '_blank')
}

// 网页快照打开原链接，其余附件走下载
function openItem(f: AttachmentMeta) {
  if (f.category === 'webpage' && f.sourceUrl) {
    window.open(f.sourceUrl, '_blank', 'noopener')
  } else {
    download(f)
  }
}

async function remove(f: AttachmentMeta) {
  try {
    await ElMessageBox.confirm(`确定删除「${f.filename}」？`, '删除附件', { type: 'warning' })
    await deleteAttachment(f.id)
    ElMessage.success('已删除')
    await load()
  } catch { /* cancelled */ }
}

// 内嵌图：新窗口看原图 / 删除（删后刷新引用状态）
function windowOpen(f: AttachmentMeta) {
  window.open(downloadAttachmentUrl(f.id) + '?inline=1', '_blank')
}
async function removeEmbed(f: AttachmentMeta) {
  try {
    await ElMessageBox.confirm(`确定删除「${f.filename}」？引用它的文档里会裂图。`, '删除内嵌图片', {
      type: 'warning',
      confirmButtonText: '删除',
    })
    await deleteAttachment(f.id)
    ElMessage.success('已删除')
    await Promise.all([loadEmbed(), load()])
  } catch { /* cancelled */ }
}
</script>

<style scoped lang="scss">
.attachment-panel {
  padding: 14px 4px 4px;
  border-top: 1px solid var(--pf-border);
  margin-top: 10px;
  max-height: 300px;
  overflow-y: auto;

  .panel-header {
    margin-bottom: 10px;
    padding: 0 6px;
    .panel-title {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--pf-text-2);
      letter-spacing: 0.3px;
    }
  }

  .empty {
    text-align: center;
    color: var(--pf-text-3);
    font-size: 11.5px;
    padding: 14px 10px;
    line-height: 1.7;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 2px;
  }

  .file-item {
    display: flex;
    gap: 9px;
    padding: 8px 9px;
    background: var(--pf-bg-surface);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-r-lg);
    transition: box-shadow 0.15s;
    &:hover { box-shadow: var(--pf-shadow-xs); }

    .file-icon {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      &.fi-rose { background: var(--pf-tint-rose-bg); color: var(--pf-tint-rose); }
      &.fi-sky { background: var(--pf-tint-sky-bg); color: var(--pf-tint-sky); }
      &.fi-emerald { background: var(--pf-tint-emerald-bg); color: var(--pf-tint-emerald); }
      &.fi-violet { background: var(--pf-tint-violet-bg); color: var(--pf-tint-violet); }
      &.fi-slate { background: var(--pf-tint-slate-bg); color: var(--pf-tint-slate); }
    }
    .file-info { flex: 1; min-width: 0; }
    .file-name {
      font-size: 12.5px;
      font-weight: 500;
      color: var(--pf-text-1);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .file-meta {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-top: 3px;
      .file-size { font-size: 10.5px; color: var(--pf-text-3); }
      .file-url {
        font-size: 10.5px; color: var(--pf-tint-sky, #2f7de1);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;
      }
    }
    .file-actions {
      flex-shrink: 0;
      display: flex;
      align-items: flex-start;
      gap: 2px;
    }
    .fact {
      border: none;
      background: transparent;
      color: var(--pf-text-3);
      width: 26px;
      height: 26px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      &:hover { background: var(--pf-bg-hover); color: var(--pf-text-1); }
      &.danger:hover { color: var(--pf-danger); }
    }
  }

  // 文档内嵌图折叠区
  .embed-section {
    margin-top: 8px;
    padding: 0 2px;
  }
  .embed-toggle {
    display: inline-flex; align-items: center; gap: 5px;
    border: 0; background: none; cursor: pointer;
    font-size: 11.5px; color: var(--pf-text-3);
    padding: 4px 6px; border-radius: 6px;
    &:hover { background: var(--pf-bg-hover); color: var(--pf-text-2); }
    .orphan-badge {
      color: var(--pf-warning, #d97706); font-weight: 600; margin-left: 2px;
    }
  }
  .embed-list { margin-top: 4px; display: flex; flex-direction: column; gap: 6px; }
  .orphan-bar {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11px; color: var(--pf-warning, #d97706);
    background: var(--pf-tint-amber-bg, #fef3c733);
    border-radius: 6px; padding: 4px 8px;
  }
  .file-item.orphan { opacity: .72; }
}
</style>
