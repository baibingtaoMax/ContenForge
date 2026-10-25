<template>
  <div class="plan-panel">
    <!-- 列表视图 -->
    <template v-if="!selectedId">
      <div class="head">
        <div>
          <div class="title">内容计划</div>
          <div class="stats">
            <span v-for="s in STATUS_OPTS" :key="s.value" class="stat" :class="s.value">
              {{ s.label }} <b>{{ counts[s.value] || 0 }}</b>
            </span>
            <span class="stat total">共 <b>{{ articles.length }}</b> 篇 · {{ series.length }} 个系列</span>
          </div>
        </div>
        <div class="head-actions">
          <el-button size="small" @click="openSeriesDialog">+ 新建系列</el-button>
          <el-button size="small" @click="openArticleDialog(null)">+ 新文章</el-button>
          <el-button size="small" type="primary" @click="openBatchDialog">批量铺选题</el-button>
        </div>
      </div>

      <div v-if="articles.length === 0" class="empty">
        还没有选题。点右上角「批量铺选题」，让内容搭档一次铺一个系列；<br />
        也可以直接在对话里聊，聊定的选题会自动沉淀到这里。
      </div>

      <div class="groups">
        <section v-for="s in series" :key="s.id" class="group">
          <div class="group-head collapsible" @click="toggleCollapse(s.id)">
            <AppIcon name="chevron-right" :size="13" class="group-caret" :class="{ collapsed: isCollapsed(s.id) }" />
            <AppIcon name="layers" tint="indigo" :size="16" />
            <span class="group-name">{{ s.title }}</span>
            <span class="group-count">{{ bySeries(s.id).length }} 篇</span>
            <span class="group-spacer" />
            <el-button text size="small" @click.stop="openArticleDialog(s.id)">+ 加文章</el-button>
            <el-button text size="small" @click.stop="openEditSeries(s)">编辑</el-button>
            <el-button text size="small" class="del-series-btn" @click.stop="removeSeries(s)">删除</el-button>
          </div>
          <template v-if="!isCollapsed(s.id)">
            <div class="group-desc" v-if="s.description">{{ s.description }}</div>
            <ArticleRow v-for="a in bySeries(s.id)" :key="a.id" :article="a" @open="openDetail" @status="changeStatus" @del="removeArticle" />
          </template>
        </section>

        <section v-if="loose.length" class="group">
          <div class="group-head collapsible" @click="toggleCollapse(LOOSE_KEY)">
            <AppIcon name="chevron-right" :size="13" class="group-caret" :class="{ collapsed: isCollapsed(LOOSE_KEY) }" />
            <AppIcon name="bookmark" tint="amber" :size="16" />
            <span class="group-name">未归系列</span>
            <span class="group-count">{{ loose.length }} 篇</span>
          </div>
          <template v-if="!isCollapsed(LOOSE_KEY)">
            <ArticleRow v-for="a in loose" :key="a.id" :article="a" @open="openDetail" @status="changeStatus" @del="removeArticle" />
          </template>
        </section>
      </div>
    </template>

    <!-- 详情视图 -->
    <ArticleDetail v-else :article-id="selectedId" :project-id="props.projectId" @back="selectedId = null" @changed="reload" />

    <!-- 新建/编辑系列 -->
    <el-dialog v-model="seriesDialog" :title="seriesForm.id ? '编辑系列' : '新建系列'" width="460px">
      <el-input v-model="seriesForm.title" placeholder="系列名，如「30篇冷启动系列」" />
      <el-input v-model="seriesForm.description" type="textarea" :rows="2" placeholder="这个系列讲什么（可选）" style="margin-top:10px" />
      <template #footer>
        <el-button @click="seriesDialog = false">取消</el-button>
        <el-button type="primary" @click="submitSeries">{{ seriesForm.id ? '保存' : '创建' }}</el-button>
      </template>
    </el-dialog>

    <!-- 新建文章 -->
    <el-dialog v-model="articleDialog" title="新建文章/选题" width="480px">
      <el-input v-model="articleForm.title" placeholder="标题或选题名" />
      <el-input v-model="articleForm.angle" type="textarea" :rows="2" placeholder="切入角度（可选）" style="margin-top:10px" />
      <el-select v-model="articleForm.seriesId" clearable placeholder="归属系列（可不选）" style="margin-top:10px;width:100%">
        <el-option v-for="s in series" :key="s.id" :label="s.title" :value="s.id" />
      </el-select>
      <template #footer>
        <el-button @click="articleDialog = false">取消</el-button>
        <el-button type="primary" @click="submitArticle">创建</el-button>
      </template>
    </el-dialog>

    <!-- 批量铺选题 -->
    <el-dialog v-model="batchDialog" title="批量铺选题" width="600px">
      <el-radio-group v-model="batchForm.target" size="small" style="margin-bottom:10px">
        <el-radio-button label="new">新建系列</el-radio-button>
        <el-radio-button label="existing" :disabled="series.length === 0">归入已有系列</el-radio-button>
      </el-radio-group>
      <el-input v-if="batchForm.target === 'new'" v-model="batchForm.newSeriesTitle" placeholder="新系列名，如「30篇冷启动系列」" />
      <el-select v-else v-model="batchForm.seriesId" placeholder="选择系列" style="width:100%">
        <el-option v-for="s in series" :key="s.id" :label="s.title" :value="s.id" />
      </el-select>
      <el-input
        v-model="batchForm.text" type="textarea" :rows="10" style="margin-top:10px"
        placeholder="每行一个选题，格式：标题 | 切入角度（角度可省略）&#10;例：&#10;PM 别再手画原型了 | 从痛点场景切入，对比手画和自动生成&#10;需求文档怎么写才不被研发怼"
      />
      <div class="batch-hint">只是登记选题台账；想让 AI 出选题，在对话里跟内容搭档说「给这个系列铺 30 个选题」。</div>
      <template #footer>
        <el-button @click="batchDialog = false">取消</el-button>
        <el-button type="primary" @click="submitBatch">铺入台账</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppIcon from './AppIcon.vue'
import ArticleDetail from './ArticleDetail.vue'
import ArticleRow from './ArticleRow.vue'
import { useChatStore } from '@/stores/chat'
import {
  listSeries, createSeries as apiCreateSeries, updateSeries as apiUpdateSeries,
  deleteSeries as apiDeleteSeries,
  listArticles, createArticle, batchCreateArticles, updateArticle, deleteArticleApi,
} from '@/api'
import type { Series, Article, ArticleStatus } from '@/types'

const props = defineProps<{ projectId: string }>()
const store = useChatStore()

const STATUS_OPTS: Array<{ value: ArticleStatus; label: string }> = [
  { value: 'topic', label: '选题' },
  { value: 'writing', label: '写作中' },
  { value: 'final', label: '定稿' },
  { value: 'published', label: '已发' },
]

const series = ref<Series[]>([])
const articles = ref<Article[]>([])
const selectedId = ref<string | null>(null)

// 折叠状态（仅本会话记忆）
const LOOSE_KEY = '__loose__'
const collapsed = ref<Set<string>>(new Set())
function isCollapsed(id: string) { return collapsed.value.has(id) }
function toggleCollapse(id: string) {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  collapsed.value = next
}

const counts = computed(() => {
  const c: Record<string, number> = {}
  for (const a of articles.value) c[a.status] = (c[a.status] || 0) + 1
  return c
})
const bySeries = (id: string) => articles.value.filter((a) => a.series_id === id)
const loose = computed(() => articles.value.filter((a) => !a.series_id))

async function reload() {
  [series.value, articles.value] = await Promise.all([listSeries(props.projectId), listArticles(props.projectId)])
}
onMounted(async () => {
  await reload()
  // 从对话沉淀卡片跳进来时组件刚挂载，watch 会错过 nonce，挂载时直接检查
  if (store.openArticleId) selectedId.value = store.openArticleId
})
watch(() => props.projectId, reload)
// 从对话沉淀卡片跳进来
watch(() => store.openArticleNonce, (n) => {
  if (n > 0 && store.openArticleId) { selectedId.value = store.openArticleId; reload() }
})
watch(() => store.planPanelNonce, (n) => { if (n > 0 && !selectedId.value) reload() })

function openDetail(id: string) { selectedId.value = id }

async function changeStatus(a: Article, s: ArticleStatus) {
  await updateArticle(a.id, { status: s })
  ElMessage.success('状态已更新')
  reload()
}
async function removeArticle(a: Article) {
  try {
    await ElMessageBox.confirm(`删除文章「${a.title}」及其渠道版本？`, '删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
    await deleteArticleApi(a.id)
    ElMessage.success('已删除')
    reload()
  } catch { /* cancel */ }
}

// ---- 新建/编辑系列 ----
const seriesDialog = ref(false)
const seriesForm = reactive<{ id: string | null; title: string; description: string }>({ id: null, title: '', description: '' })
function openSeriesDialog() { seriesForm.id = null; seriesForm.title = ''; seriesForm.description = ''; seriesDialog.value = true }
function openEditSeries(s: Series) { seriesForm.id = s.id; seriesForm.title = s.title; seriesForm.description = s.description || ''; seriesDialog.value = true }
async function submitSeries() {
  if (!seriesForm.title.trim()) return ElMessage.warning('系列名必填')
  if (seriesForm.id) {
    await apiUpdateSeries(seriesForm.id, { title: seriesForm.title.trim(), description: seriesForm.description })
    ElMessage.success('系列已更新')
  } else {
    await apiCreateSeries(props.projectId, seriesForm.title.trim(), seriesForm.description)
    ElMessage.success('系列已创建')
  }
  seriesDialog.value = false
  reload()
}
async function removeSeries(s: Series) {
  const n = bySeries(s.id).length
  const tip = n > 0
    ? `删除系列「${s.title}」？\n系列下 ${n} 篇文章不会被删除，会移到「未归系列」。`
    : `删除空系列「${s.title}」？`
  try {
    await ElMessageBox.confirm(tip, '删除系列', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch { return }
  await apiDeleteSeries(s.id)
  ElMessage.success(n > 0 ? `系列已删除，${n} 篇文章移到未归系列` : '系列已删除')
  reload()
}

// ---- 新建文章 ----
const articleDialog = ref(false)
const articleForm = reactive({ title: '', angle: '', seriesId: '' as string | null })
function openArticleDialog(seriesId: string | null) {
  articleForm.title = ''; articleForm.angle = ''; articleForm.seriesId = seriesId
  articleDialog.value = true
}
async function submitArticle() {
  if (!articleForm.title.trim()) return ElMessage.warning('标题必填')
  await createArticle(props.projectId, {
    title: articleForm.title.trim(), angle: articleForm.angle, seriesId: articleForm.seriesId || null,
  })
  articleDialog.value = false
  ElMessage.success('已创建')
  reload()
}

// ---- 批量铺选题 ----
const batchDialog = ref(false)
const batchForm = reactive({ target: 'new' as 'new' | 'existing', seriesId: '', newSeriesTitle: '', text: '' })
function openBatchDialog() {
  batchForm.target = series.value.length ? 'existing' : 'new'
  batchForm.seriesId = series.value[0]?.id || ''
  batchForm.newSeriesTitle = ''
  batchForm.text = ''
  batchDialog.value = true
}
async function submitBatch() {
  const items = batchForm.text.split('\n').map((line) => {
    const [title, angle] = line.split('|').map((x) => x.trim())
    return title ? { title, angle: angle || '', seriesId: '' as string | null } : null
  }).filter(Boolean) as Array<{ title: string; angle: string; seriesId: string | null }>
  if (items.length === 0) return ElMessage.warning('没有解析到选题')
  let seriesId: string
  if (batchForm.target === 'new') {
    const name = batchForm.newSeriesTitle.trim()
    if (!name) return ElMessage.warning('请填新系列名')
    seriesId = (await apiCreateSeries(props.projectId, name)).id
  } else {
    if (!batchForm.seriesId) return ElMessage.warning('请选择系列')
    seriesId = batchForm.seriesId
  }
  items.forEach((it) => (it.seriesId = seriesId))
  await batchCreateArticles(props.projectId, items)
  batchDialog.value = false
  ElMessage.success(`已铺入 ${items.length} 个选题`)
  reload()
}
</script>

<script lang="ts">
export default { name: 'ContentPlanPanel' }
</script>

<style scoped lang="scss">
.plan-panel { height: 100%; overflow-y: auto; }
.head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  padding: 20px 26px 14px; border-bottom: 1px solid var(--pf-border); position: sticky; top: 0;
  background: var(--pf-bg-surface); z-index: 2;
  > div:first-child { min-width: 220px; flex: 1; }
}
.title { font-size: 17px; font-weight: 700; color: var(--pf-text-1); margin-bottom: 7px; white-space: nowrap; }
.stats { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.stat {
  font-size: 11.5px; color: var(--pf-text-2); background: var(--pf-bg-hover);
  padding: 2px 10px; border-radius: 11px;
  b { color: var(--pf-text-1); margin-left: 2px; }
  &.topic b { color: #6366f1; } &.writing b { color: #b45309; }
  &.final b { color: #047857; } &.published b { color: #15803d; }
  &.total { background: transparent; padding-left: 4px; }
}
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
.empty { text-align: center; color: var(--pf-text-3); font-size: 13px; line-height: 2; padding: 70px 20px; }
.groups { padding: 14px 26px 60px; max-width: 900px; margin: 0 auto; }
.group { margin-bottom: 22px; }
.group-head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.group-head.collapsible { cursor: pointer; user-select: none; }
.group-caret { color: var(--pf-text-3); transition: transform .15s; flex-shrink: 0; }
.group-caret:not(.collapsed) { transform: rotate(90deg); }
.group-name { font-size: 14px; font-weight: 700; color: var(--pf-text-1); }
.group-count { font-size: 11.5px; color: var(--pf-text-3); }
.group-spacer { flex: 1; }
.del-series-btn { color: var(--pf-danger, #dc2626) !important; }
.del-series-btn:hover { background: rgba(220,38,38,.08) !important; }
.group-desc { font-size: 12px; color: var(--pf-text-3); margin: -4px 0 8px 24px; }
.batch-hint { font-size: 12px; color: var(--pf-text-3); margin-top: 8px; line-height: 1.6; }
</style>
