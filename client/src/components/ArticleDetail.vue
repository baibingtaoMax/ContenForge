<template>
  <div class="article-detail" v-if="article">
    <div class="ad-head">
      <button class="back-btn" @click="$emit('back')">
        <AppIcon name="chevron-right" :size="14" class="back-ic" /> 返回内容计划
      </button>
      <div class="ad-actions">
        <el-select
          v-if="contentLines.length"
          v-model="lineVal"
          size="small"
          style="width: 150px"
          clearable
          placeholder="内容线"
          @change="onLineChange"
        >
          <el-option v-for="l in contentLines" :key="l.key" :value="l.key" :label="l.label" />
        </el-select>
        <el-select v-model="statusVal" size="small" style="width: 110px" @change="onStatus">
          <el-option v-for="s in STATUS_OPTS" :key="s.value" :label="s.label" :value="s.value" />
        </el-select>
        <el-button size="small" @click="adaptAll" :loading="adapting">
          <AppIcon name="sparkle" :size="13" /> 一键生成三渠道版本
        </el-button>
      </div>
    </div>

    <el-input v-model="titleVal" class="ad-title" placeholder="文章标题" @blur="saveMeta" />
    <el-input v-model="angleVal" class="ad-angle" placeholder="切入角度（一两句话：讲什么、打谁的什么点）" @blur="saveMeta" />

    <el-tabs v-model="tab" class="ad-tabs">
      <el-tab-pane label="主稿 (Markdown)" name="main">
        <div class="main-toolbar">
          <span class="mt-hint">主稿是源头，渠道版本都从它适配。也可以直接让内容搭档在对话里写。</span>
          <el-button size="small" type="primary" :loading="savingMain" @click="saveMain">保存主稿</el-button>
        </div>
        <MdEditor v-model="docVal" placeholder="# 标题&#10;&#10;在这里写主稿……" />
      </el-tab-pane>
      <el-tab-pane v-for="c in CHANNELS" :key="c.key" :name="c.key">
        <template #label>
          <span class="ch-label">{{ c.label }}<i v-if="hasChannel(c.key)" class="ch-dot" /></span>
        </template>
        <ChannelVersionPane
          v-if="tab === c.key"
          :article-id="article.id"
          :channel="c.key"
          :adapt-nonce="adaptNonce"
          @adapted="onAdapted"
        />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import AppIcon from './AppIcon.vue'
import MdEditor from './MdEditor.vue'
import ChannelVersionPane from './ChannelVersionPane.vue'
import { getArticle, updateArticle, adaptArticle, getSubject, listWritingKits } from '@/api'
import type { ArticleDetail as ArticleDetailT, ArticleStatus, ChannelKey, ContentLine } from '@/types'

const props = defineProps<{ articleId: string; projectId?: string }>()
defineEmits<{ (e: 'back'): void; (e: 'changed'): void }>()

const STATUS_OPTS: Array<{ value: ArticleStatus; label: string }> = [
  { value: 'topic', label: '选题' },
  { value: 'writing', label: '写作中' },
  { value: 'final', label: '定稿' },
  { value: 'published', label: '已发' },
]
const CHANNELS: Array<{ key: ChannelKey; label: string }> = [
  { key: 'wechat', label: '公众号' },
  { key: 'xhs', label: '小红书' },
  { key: 'markdown', label: '掘金/知乎' },
]

const article = ref<ArticleDetailT | null>(null)
const tab = ref('main')
const titleVal = ref('')
const angleVal = ref('')
const docVal = ref('')
const statusVal = ref<ArticleStatus>('topic')
const lineVal = ref('')
const contentLines = ref<ContentLine[]>([])
const savingMain = ref(false)
const adapting = ref(false)
const adaptNonce = ref(0)

async function load() {
  article.value = await getArticle(props.articleId)
  titleVal.value = article.value.title
  angleVal.value = article.value.angle
  docVal.value = article.value.doc_md
  statusVal.value = article.value.status
  lineVal.value = article.value.content_line || ''
  // 加载主体挂载规范包的内容线
  if (props.projectId) {
    try {
      const info = await getSubject(props.projectId)
      if (info.kitId) {
        const kits = await listWritingKits()
        contentLines.value = kits.find((k) => k.id === info.kitId)?.contentLines || []
      } else {
        contentLines.value = []
      }
    } catch { /* ignore */ }
  }
}
onMounted(load)
watch(() => props.articleId, load)

function hasChannel(key: ChannelKey) {
  return (article.value?.channelVersions || []).some((v) => v.channel === key)
}

async function saveMeta() {
  if (!article.value) return
  if (titleVal.value.trim() === article.value.title && angleVal.value === article.value.angle) return
  await updateArticle(article.value.id, { title: titleVal.value.trim(), angle: angleVal.value })
  article.value.title = titleVal.value.trim()
}

async function saveMain() {
  if (!article.value) return
  savingMain.value = true
  try {
    await updateArticle(article.value.id, { docMd: docVal.value })
    ElMessage.success('主稿已保存')
  } finally { savingMain.value = false }
}

async function onStatus(s: ArticleStatus) {
  if (!article.value) return
  await updateArticle(article.value.id, { status: s })
  article.value.status = s
}

async function onLineChange(v: string | undefined) {
  if (!article.value) return
  const line = v || ''
  await updateArticle(article.value.id, { contentLine: line })
  article.value.content_line = line
}

async function adaptAll() {
  if (!article.value) return
  if (!docVal.value.trim()) { ElMessage.warning('主稿还是空的，先写主稿或让搭档写'); return }
  adapting.value = true
  try {
    ElMessage.info('正在一次生成三个渠道版本，大约需要 1 分钟…')
    const r = await adaptArticle(article.value.id, { channels: ['wechat', 'xhs', 'markdown'] })
    if (r.ok) {
      ElMessage.success('三个渠道版本已生成，切到各 tab 检查复制')
      await load(); adaptNonce.value++
    } else ElMessage.error(r.error || '生成失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '生成失败，可重试')
  } finally { adapting.value = false }
}

function onAdapted() {
  load()
}
</script>

<style scoped lang="scss">
.article-detail { height: 100%; overflow-y: auto; padding: 18px 26px 60px; max-width: 900px; margin: 0 auto; }
.ad-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; gap: 8px; flex-wrap: wrap; }
.back-btn {
  display: inline-flex; align-items: center; gap: 2px; border: none; background: transparent;
  font-size: 12.5px; color: var(--pf-text-2); cursor: pointer; padding: 4px 6px; border-radius: 6px;
  white-space: nowrap; flex-shrink: 0;
  &:hover { color: var(--pf-primary); background: var(--pf-primary-50); }
  .back-ic { transform: rotate(180deg); }
}
.ad-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.ad-title :deep(input) { font-size: 19px; font-weight: 700; height: 40px; }
.ad-angle { margin-top: 8px; }
.ad-angle :deep(textarea) { font-size: 12.5px; color: var(--pf-text-2); }
.ad-tabs { margin-top: 10px; }
.main-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.mt-hint { font-size: 12px; color: var(--pf-text-3); }
.ch-label { display: inline-flex; align-items: center; gap: 5px; }
.ch-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--pf-success, #22c55e); font-style: normal; }
</style>
