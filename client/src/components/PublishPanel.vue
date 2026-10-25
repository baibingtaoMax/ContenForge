<template>
  <div class="publish-panel">
    <div class="head">
      <div>
        <div class="title">发布台账</div>
        <div class="hint">平台不做自动群发——在文章详情里复制各渠道版本，手动发布后回来登记链接和数据。</div>
      </div>
      <el-button size="small" type="primary" @click="openAdd">+ 登记发布</el-button>
    </div>

    <div v-if="records.length === 0" class="empty">还没有发布记录。文章发出去后，在这里登记，内容搭档会结合数据给后续选题建议。</div>

    <div v-else class="table-wrap">
      <table class="pub-table">
        <thead>
          <tr><th>文章</th><th>渠道</th><th>链接</th><th>数据</th><th>备注</th><th class="th-ops"></th></tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id">
            <td class="t-title">{{ articleTitle(r.article_id) }}</td>
            <td><span class="ch-badge" :class="r.channel">{{ channelLabel(r.channel) }}</span></td>
            <td>
              <a v-if="r.url" :href="r.url" target="_blank" rel="noopener" class="pub-link">查看 ↗</a>
              <span v-else class="muted">—</span>
            </td>
            <td class="metrics">{{ formatMetrics(r.metrics_json) }}</td>
            <td class="t-note">{{ r.note || '—' }}</td>
            <td class="t-ops">
              <AppIcon name="edit" :size="14" class="edit" title="编辑" @click="openEdit(r)" />
              <AppIcon name="trash" :size="13" class="del" title="删除" @click="remove(r.id)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <el-dialog v-model="dialog" :title="editingId ? '编辑发布记录' : '登记发布'" width="520px" @closed="editingId = null">
      <el-select v-model="form.articleId" filterable placeholder="选择文章" style="width:100%" :disabled="!!editingId">
        <el-option v-for="a in articles" :key="a.id" :label="a.title" :value="a.id" />
      </el-select>
      <el-select v-model="form.channel" placeholder="发布渠道" style="width:100%;margin-top:10px" :disabled="!!editingId">
        <el-option label="公众号" value="wechat" />
        <el-option label="小红书" value="xhs" />
        <el-option label="掘金/知乎" value="markdown" />
      </el-select>
      <el-input v-model="form.url" placeholder="发布链接（可选）" style="margin-top:10px" />
      <div class="m-row">
        <div class="m-item"><span class="m-label">阅读</span><el-input-number v-model="form.views" :min="0" controls-position="right" size="small" /></div>
        <div class="m-item"><span class="m-label">赞</span><el-input-number v-model="form.likes" :min="0" controls-position="right" size="small" /></div>
        <div class="m-item"><span class="m-label">评论</span><el-input-number v-model="form.comments" :min="0" controls-position="right" size="small" /></div>
        <div class="m-item"><span class="m-label">收藏</span><el-input-number v-model="form.collects" :min="0" controls-position="right" size="small" /></div>
        <div class="m-item"><span class="m-label">转发</span><el-input-number v-model="form.shares" :min="0" controls-position="right" size="small" /></div>
      </div>
      <el-input v-model="form.note" type="textarea" :rows="2" placeholder="备注（可选）" style="margin-top:10px" />
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="submit">{{ editingId ? '保存' : '登记' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppIcon from './AppIcon.vue'
import { listPublishes, createPublish, updatePublish, deletePublish, listArticles, updateArticle } from '@/api'
import type { PublishRecord, Article, ChannelKey } from '@/types'

const props = defineProps<{ projectId: string }>()
const records = ref<PublishRecord[]>([])
const articles = ref<Article[]>([])
const dialog = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({ articleId: '', channel: 'wechat' as ChannelKey, url: '', views: 0, likes: 0, comments: 0, collects: 0, shares: 0, note: '' })

async function reload() {
  [records.value, articles.value] = await Promise.all([listPublishes(props.projectId), listArticles(props.projectId)])
}
onMounted(reload)

function articleTitle(id: string) { return articles.value.find((a) => a.id === id)?.title || '（已删除文章）' }
function channelLabel(c: string) { return ({ wechat: '公众号', xhs: '小红书', markdown: '掘金/知乎' } as Record<string, string>)[c] || c }
function formatMetrics(json: string) {
  try {
    const m = JSON.parse(json || '{}')
    const parts: string[] = []
    if (m.views != null) parts.push(`阅读 ${m.views}`)
    if (m.likes != null) parts.push(`赞 ${m.likes}`)
    if (m.comments != null) parts.push(`评 ${m.comments}`)
    if (m.collects != null) parts.push(`藏 ${m.collects}`)
    if (m.shares != null) parts.push(`转 ${m.shares}`)
    return parts.join(' · ') || '—'
  } catch { return '—' }
}

function resetForm(articleId = '') {
  Object.assign(form, { articleId, channel: 'wechat' as ChannelKey, url: '', views: 0, likes: 0, comments: 0, collects: 0, shares: 0, note: '' })
}
function openAdd() {
  editingId.value = null
  resetForm(articles.value[0]?.id || '')
  dialog.value = true
}
function openEdit(r: PublishRecord) {
  editingId.value = r.id
  let m: Record<string, number> = {}
  try { m = JSON.parse(r.metrics_json || '{}') } catch { m = {} }
  Object.assign(form, {
    articleId: r.article_id,
    channel: r.channel,
    url: r.url || '',
    views: m.views || 0,
    likes: m.likes || 0,
    comments: m.comments || 0,
    collects: m.collects || 0,
    shares: m.shares || 0,
    note: r.note || '',
  })
  dialog.value = true
}
function collectMetrics(): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const [k, v] of Object.entries({ views: form.views, likes: form.likes, comments: form.comments, collects: form.collects, shares: form.shares })) {
    if (v > 0) metrics[k] = v
  }
  return metrics
}
async function submit() {
  if (!form.articleId) return ElMessage.warning('请选择文章')
  const metrics = collectMetrics()
  // 编辑模式：只更新链接 / 数据 / 备注（文章、渠道不可改）
  if (editingId.value) {
    await updatePublish(editingId.value, { url: form.url, metrics, note: form.note })
    dialog.value = false
    ElMessage.success('已更新发布数据')
    reload()
    return
  }
  await createPublish(props.projectId, {
    articleId: form.articleId, channel: form.channel, url: form.url, metrics, note: form.note,
  })
  await updateArticle(form.articleId, { status: 'published' })
  dialog.value = false
  ElMessage.success('已登记，文章状态置为「已发」')
  reload()
}
async function remove(id: string) {
  try {
    await ElMessageBox.confirm('删除这条发布记录？', '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
    await deletePublish(id)
    reload()
  } catch { /* cancel */ }
}
</script>

<style scoped lang="scss">
.publish-panel { height: 100%; overflow-y: auto; }
.head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 26px 14px; border-bottom: 1px solid var(--pf-border);
}
.title { font-size: 17px; font-weight: 700; color: var(--pf-text-1); margin-bottom: 5px; }
.hint { font-size: 12.5px; color: var(--pf-text-3); }
.empty { text-align: center; color: var(--pf-text-3); font-size: 13px; padding: 70px 20px; line-height: 2; }
.table-wrap { padding: 16px 26px 60px; max-width: 1000px; margin: 0 auto; }
.pub-table { width: 100%; border-collapse: collapse; font-size: 12.5px;
  th { text-align: left; color: var(--pf-text-3); font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--pf-border); }
  td { padding: 9px 10px; border-bottom: 1px solid var(--pf-border); color: var(--pf-text-2); vertical-align: middle; }
}
.t-title { font-weight: 600; color: var(--pf-text-1); max-width: 220px; }
.t-note { max-width: 160px; font-size: 12px; }
.ch-badge { font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 10px;
  &.wechat { background: #dcfce7; color: #15803d; }
  &.xhs { background: #ffe4e6; color: #be123c; }
  &.markdown { background: #e0e7ff; color: #4338ca; }
}
.pub-link { color: var(--pf-primary); text-decoration: none; font-size: 12px; }
.metrics { font-size: 12px; white-space: nowrap; }
.muted { color: var(--pf-text-3); }
.th-ops, .t-ops { text-align: right; white-space: nowrap; }
.t-ops { display: flex; gap: 10px; justify-content: flex-end; align-items: center; }
.edit { color: var(--pf-text-3); cursor: pointer; &:hover { color: var(--pf-primary); } }
.del { color: var(--pf-text-3); cursor: pointer; &:hover { color: var(--pf-danger); } }
.m-row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
.m-item { flex: 1; min-width: 80px; display: flex; flex-direction: column; gap: 4px; }
.m-label { font-size: 12px; color: var(--pf-text-3); }
.m-item :deep(.el-input-number) { width: 100%; }
</style>
