<template>
  <!-- 用户消息 -->
  <div v-if="message.role === 'user'" class="chat-row user">
    <div class="user-col">
      <div v-if="message.attachments?.length" class="attach-cards">
        <template v-for="a in message.attachments" :key="a.id">
          <!-- 图片附件：缩略图 + 点击放大预览 -->
          <el-image
            v-if="isImage(a.filename)"
            :src="a.id !== 'pending' ? `/api/attachments/${a.id}/download` : ''"
            :preview-src-list="imagePreviewList"
            :initial-index="imagePreviewIndex(a.id)"
            fit="cover"
            class="attach-thumb"
            loading="lazy"
            preview-teleported
          >
            <template #placeholder>
              <div class="thumb-loading">加载中…</div>
            </template>
            <template #error>
              <div class="attach-card">
                <span class="attach-icon fi-violet"><AppIcon name="file" :size="16" /></span>
                <span class="attach-meta">
                  <span class="attach-name">{{ a.filename }}</span>
                  <span class="attach-sub">图片加载失败</span>
                </span>
              </div>
            </template>
          </el-image>
          <!-- 网页链接快照：链接卡片，点开原站 -->
          <a
            v-else-if="isWebLink(a)"
            class="attach-card web-card"
            :href="a.sourceUrl || (a.id !== 'pending' ? `/api/attachments/${a.id}/download` : undefined)"
            target="_blank"
            rel="noopener"
          >
            <span class="attach-icon fi-sky web-icon"><AppIcon name="external-link" :size="15" /></span>
            <span class="attach-meta">
              <span class="attach-name">{{ a.filename }}</span>
              <span class="attach-sub web-url">{{ shortUrl(a.sourceUrl) }}</span>
            </span>
          </a>
          <!-- 非图片附件：文件卡片 -->
          <a
            v-else
            class="attach-card"
            :href="a.id !== 'pending' ? `/api/attachments/${a.id}/download` : undefined"
            target="_blank"
            rel="noopener"
          >
            <span class="attach-icon" :class="`fi-${fileKind(a.filename)}`"><AppIcon name="file" :size="16" /></span>
            <span class="attach-meta">
              <span class="attach-name">{{ a.filename }}</span>
              <span class="attach-sub">{{ a.categoryLabel }}<template v-if="a.sizeBytes"> · {{ formatSize(a.sizeBytes) }}</template></span>
            </span>
          </a>
        </template>
      </div>

      <div v-if="message.content" class="bubble user-bubble">{{ message.content }}</div>
            <!-- 选中的选题：可点击跳到内容计划该文章 -->
            <div v-if="message.refArticles?.length" class="ref-cards">
              <button
                v-for="a in message.refArticles"
                :key="a.id"
                class="ref-card is-article"
                @click="chatStore.requestOpenArticle(a.id)"
              >
                <AppIcon name="bookmark" :size="13" />
                <span class="ref-card-name">{{ a.title }}</span>
              </button>
            </div>
      <span v-if="message.timestamp && !(isLast && streaming)" class="msg-time user-time">{{ formatTime(message.timestamp) }}</span>
    </div>
  </div>

  <!-- Agent 消息 -->
  <div v-else class="chat-row agent" :class="message.agentRole">
    <div class="avatar" :class="`av-${avatarKey}`">
      <AppIcon v-if="avatarKey === 'skill'" name="zap" :size="17" :stroke-width="2.2" />
      <BrandLogo v-else-if="avatarKey === 'brand'" variant="head" :size="24" bare />
      <svg v-else viewBox="0 0 24 24" fill="none" width="17" height="17">
        <path d="M12 2L13.8 9.2L21 11L13.8 12.8L12 22L10.2 12.8L3 11L10.2 9.2L12 2Z" fill="#fff"/>
      </svg>
    </div>
    <div class="agent-col">
      <div class="agent-name">
        {{ message.agentName }}
        <span v-if="message.skillMeta" class="skill-tag"><AppIcon name="zap" :size="11" :stroke-width="2.4" /> {{ message.skillMeta.skillName }}</span>
      </div>
      <div class="bubble agent-bubble" :class="message.agentRole">
        <div v-if="message.toolCalls.length" class="tool-calls">
          <ToolCallCard v-for="(t, i) in message.toolCalls" :key="i" :tool="t" />
        </div>
        <ReasoningBlock v-if="message.reasoningContent && !isWorker" :content="message.reasoningContent" :streaming="streaming && isLast && !message.content" />
        <div v-if="message.content" ref="contentRef" class="content" v-html="renderedContent"></div>
        <span v-if="message.content && isLast && streaming" class="typing-cursor">▍</span>
        <div v-if="!message.content && isLast && streaming" class="thinking-dots">
          <span></span><span></span><span></span>
        </div>

      </div>
      <!-- ContentForge：沉淀的文章/选题卡片（实时 + 历史） -->
      <div v-if="articleCards.length" class="req-cards">
        <ArticleCard
          v-for="c in articleCards"
          :key="c.id"
          :aid="c.id"
          :title="c.title"
          :status="c.status"
          :revised="c.revised"
          :published="c.published"
        />
      </div>
      <!-- ProtoForge：沉淀的需求卡片（实时 + 历史） -->
      <div v-if="reqCards.length" class="req-cards">
        <RequirementCard
          v-for="c in reqCards"
          :key="c.id"
          :rid="c.id"
          :title="c.title"
          :kind="c.kind"
        />
      </div>
      <!-- ProtoForge：设计决策记录卡片（实时 + 历史） -->
      <div v-if="ddCards.length" class="req-cards">
        <DesignDecisionCard
          v-for="c in ddCards"
          :key="c.id"
          :did="c.id"
          :topic="c.topic"
        />
      </div>
      <!-- ProtoForge：收入需求池卡片（实时 + 历史） -->
      <div v-if="poolCards.length" class="req-cards">
        <PoolItemCard
          v-for="c in poolCards"
          :key="c.id"
          :rid="c.id"
          :title="c.title"
          :status="c.status"
        />
      </div>
      <ReviewFeedbackCard v-if="message.reviewFeedback" :feedback="message.reviewFeedback" />
      <DecisionCard v-if="message.decision" :decision="message.decision" />
      <span v-if="message.timestamp && !(isLast && streaming)" class="msg-time">{{ formatTime(message.timestamp) }}</span>

    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import type { ChatMessage } from '@/types'
import ToolCallCard from './ToolCallCard.vue'
import ReviewFeedbackCard from './ReviewFeedbackCard.vue'
import DecisionCard from './DecisionCard.vue'
import RequirementCard from './RequirementCard.vue'
import ArticleCard from './ArticleCard.vue'
import PoolItemCard from './PoolItemCard.vue'
import DesignDecisionCard from './DesignDecisionCard.vue'
import ReasoningBlock from './ReasoningBlock.vue'
import AppIcon from './AppIcon.vue'
import BrandLogo from './BrandLogo.vue'
import { useChatStore } from '@/stores/chat'
import { renderMarkdown } from '@/utils/markdown'
import { renderMermaidBlocks } from '@/utils/mermaid'

const chatStore = useChatStore()

const props = defineProps<{
  message: ChatMessage
  isLast?: boolean
  streaming?: boolean
}>()

const isWorker = computed(() => /^worker_/.test(props.message.agentRole || ''))

// ContentForge：文章卡片（实时 SSE 带 title/status；历史只有 id，卡片自拉）
const articleCards = computed(() => {
  const map = new Map<string, { id: string; title?: string; status?: string; revised?: boolean; published?: boolean }>()
  for (const c of props.message.articles || []) {
    if (!map.has(c.id)) map.set(c.id, { id: c.id, title: c.title, status: c.status, revised: c.revised, published: c.published })
  }
  for (const id of props.message.articleIds || []) if (!map.has(id)) map.set(id, { id })
  return [...map.values()]
})
// ProtoForge：沉淀需求卡片（实时 SSE 有 title；历史只有 id，由卡片自身拉标题）
const reqCards = computed(() => {
  const map = new Map<string, { id: string; title?: string; kind?: string }>()
  for (const c of props.message.requirements || []) if (!map.has(c.id)) map.set(c.id, { id: c.id, title: c.title, kind: (c as any).kind })
  for (const id of props.message.requirementIds || []) if (!map.has(id)) map.set(id, { id })
  return [...map.values()]
})
// ProtoForge：设计决策卡片（实时 SSE 带 topic；历史只有 id）
const ddCards = computed(() => {
  const map = new Map<string, { id: string; topic?: string }>()
  for (const c of props.message.decisions || []) if (!map.has(c.id)) map.set(c.id, { id: c.id, topic: c.topic })
  for (const id of props.message.decisionIds || []) if (!map.has(id)) map.set(id, { id })
  return [...map.values()]
})
// ProtoForge：入池卡片（实时 SSE 带 title/status；历史只有 id）
const poolCards = computed(() => {
  const map = new Map<string, { id: string; title?: string; status?: string }>()
  for (const c of props.message.poolItems || []) if (!map.has(c.id)) map.set(c.id, { id: c.id, title: c.title, status: c.status })
  for (const id of props.message.poolIds || []) if (!map.has(id)) map.set(id, { id })
  return [...map.values()]
})
const avatarKey = computed(() => {
  const map: Record<string, string> = {
    receptionist: 'brand',
    skill_executor: 'skill',
    investigator: 'sky',
    reviewer: 'amber',
    decision_maker: 'emerald',
    worker_business: 'slate',
    worker_credit: 'indigo',
    worker_financial: 'emerald',
    worker_litigation: 'rose',
    worker_tax: 'amber',
  }
  return map[props.message.agentRole || ''] || 'brand'
})

const renderedContent = computed(() => renderMarkdown(props.message.content))

// mermaid 图：流式输出中源码不完整不渲染，结束（或历史消息）后扫描渲染
const contentRef = ref<HTMLElement | null>(null)
async function tryRenderMermaid() {
  // 流式进行中跳过，等结束
  if (props.streaming && props.isLast) return
  await nextTick()
  if (contentRef.value) await renderMermaidBlocks(contentRef.value)
}
watch(renderedContent, () => { void tryRenderMermaid() })
onMounted(() => { void tryRenderMermaid() })

function fileKind(name: string) {
  const n = name.toLowerCase()
  if (n.endsWith('.pdf')) return 'rose'
  if (n.endsWith('.doc') || n.endsWith('.docx')) return 'sky'
  if (n.endsWith('.xls') || n.endsWith('.xlsx') || n.endsWith('.csv')) return 'emerald'
  if (/\.(png|jpg|jpeg|gif|webp)$/.test(n)) return 'violet'
  return 'slate'
}

function isImage(name: string) {
  return /\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(name)
}

// 网页链接快照：带 sourceUrl 或 category=webpage 的附件
function isWebLink(a: { category?: string; sourceUrl?: string | null }) {
  return a.category === 'webpage' || !!a.sourceUrl
}

// 链接卡片上只显示域名+路径前缀，避免整串 URL 撑爆卡片
function shortUrl(url?: string | null) {
  if (!url) return '网页链接'
  try {
    const u = new URL(url)
    let path = u.pathname
    if (path.length > 18) path = path.slice(0, 18) + '…'
    return u.hostname + (path && path !== '/' ? path : '')
  } catch {
    return url.slice(0, 40)
  }
}

/** 图片预览列表：当前消息里所有已上传的图片 URL */
const imagePreviewList = computed(() =>
  (props.message.attachments || [])
    .filter((a) => a.id !== 'pending' && isImage(a.filename))
    .map((a) => `/api/attachments/${a.id}/download`)
)

function imagePreviewIndex(attId: string): number {
  return imagePreviewList.value.findIndex((url) => url.includes(attId))
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// 消息时间：今天只显示 时:分；今年内跨天显示 月-日 时:分；跨年带年份
function formatTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return hm
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}
</script>

<style scoped lang="scss">
.chat-row {
  display: flex;
  margin-bottom: 18px;
  animation: fadeInUp 0.3s ease-out;

  &.user {
    justify-content: flex-end;
    // user-col 给确定宽度（width:100% + max-width:75%），气泡才有换行边界；
    // pre-wrap 下“收缩到内容”的容器宽度=最长一行，会坍缩成一根条，必须给定宽
    .user-col { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; width: 100%; max-width: 75%; min-width: 0; }
    .bubble { max-width: 100%; }
  }

  &.agent {
    gap: 10px;
  }
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
  color: #fff;
  &.av-brand {
    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
  }
  &.av-skill { background: var(--pf-violet); box-shadow: 0 2px 6px rgba(139, 92, 246, 0.3); }
  &.av-sky { background: var(--pf-info); }
  &.av-amber { background: var(--pf-warning); }
  &.av-emerald { background: var(--pf-success); }
  &.av-indigo { background: var(--pf-primary); }
  &.av-rose { background: #f43f5e; }
  &.av-slate { background: var(--pf-tint-slate); }
}

.agent-col {
  min-width: 0;
  max-width: calc(100% - 46px);
}

.agent-name {
  font-size: 12px;
  color: var(--pf-text-3);
  margin-bottom: 4px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

// 消息时间：克制的小灰字，不抢注意力
.msg-time {
  font-size: 11px;
  font-weight: 400;
  color: var(--pf-text-3);
  opacity: 0.75;
  flex-shrink: 0;
}
.agent-name .msg-time {
  margin-left: auto;
}
.user-time {
  margin-top: 2px;
  margin-right: 2px;
}

.skill-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--pf-violet-bg);
  color: var(--pf-violet-text);
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 600;
}

.bubble {
  padding: 11px 15px;
  border-radius: var(--pf-r-lg);
  font-size: 13.5px;
  line-height: 1.7;
  word-break: break-word;
}

.user-bubble {
  background: var(--pf-primary);
  color: #fff;
  border-radius: var(--pf-r-lg) var(--pf-r-lg) 4px var(--pf-r-lg);
  white-space: pre-wrap;
  box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
}

// @ 引用需求卡片（用户气泡上方）
.ref-cards {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  width: 100%;
  margin-bottom: 6px;
}
.ref-card {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid #f5e0c0;
  background: #fffaf2;
  color: var(--pf-tint-amber, #d97706);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s;
  max-width: 260px;
  .ref-card-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  &:hover { background: #fef3e2; border-color: var(--pf-tint-amber, #d97706); }
  &.is-page {
    border-color: #c6e0ff;
    background: #f5faff;
    color: var(--pf-tint-sky, #2f7de1);
    &:hover { background: #eaf3ff; border-color: var(--pf-tint-sky, #2f7de1); }
  }
  &.is-article {
    border-color: #bfe6d2;
    background: #f3fbf6;
    color: #047857;
    &:hover { background: #e6f7ee; border-color: #047857; }
  }
}

.attach-cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.attach-thumb {
  width: 180px;
  height: 180px;
  border-radius: var(--pf-r-lg);
  overflow: hidden;
  border: 1px solid var(--pf-border);
  cursor: zoom-in;
  background: var(--pf-bg-hover);
  :deep(img) { width: 100%; height: 100%; object-fit: cover; }
  .thumb-loading {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: var(--pf-text-3); font-size: 12px;
  }
}

.attach-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  text-decoration: none;
  color: inherit;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;

  &:hover { border-color: var(--pf-primary-200); box-shadow: var(--pf-shadow-sm); }

  .attach-icon {
    width: 32px;
    height: 32px;
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
  .attach-meta { display: flex; flex-direction: column; min-width: 0; }
  .attach-name {
    font-size: 12.5px; font-weight: 500; color: var(--pf-text-1);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px;
  }
  .attach-sub { font-size: 11px; color: var(--pf-text-3); margin-top: 2px; }

  // 网页链接卡片：蓝色调强调，URL 行可省略
  &.web-card {
    border-color: #c6e0ff;
    background: #f5faff;
    &:hover { border-color: var(--pf-tint-sky); }
    .web-icon { flex-shrink: 0; }
    .web-url {
      color: var(--pf-tint-sky, #2f7de1);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px;
    }
  }
}

.agent-bubble {
  background: var(--pf-bg-surface);
  color: var(--pf-text-1);
  box-shadow: var(--pf-shadow-xs);
  border: 1px solid var(--pf-border);
  border-left: 3px solid var(--pf-border-strong);
  border-radius: 4px var(--pf-r-lg) var(--pf-r-lg) var(--pf-r-lg);

  .content {
    white-space: normal;
    word-break: break-word;

    // mermaid 渲染后的图容器
    pre.mermaid-rendered {
      background: var(--pf-bg-surface);
      border: 1px solid var(--pf-border);
      border-radius: var(--pf-r-md);
      padding: 12px;
      text-align: center;
      overflow-x: auto;
      // 图按自然尺寸渲染，超宽横向滚动，不缩放（否则字挤成一团）
      :deep(svg) { max-width: none; height: auto; min-width: 320px; }
    }
    pre.mermaid-error {
      border-color: #fbc4c4;
      .mermaid-err-msg {
        margin-top: 6px;
        font-size: 12px;
        color: var(--pf-danger);
        text-align: left;
        white-space: pre-wrap;
      }
    }
  }
  .content :deep(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 8px 0;
    font-size: 13px;
  }
  .content :deep(th),
  .content :deep(td) {
    border: 1px solid var(--pf-border);
    padding: 6px 10px;
    text-align: left;
  }
  .content :deep(th) {
    background: var(--pf-bg-hover);
    font-weight: 600;
  }
  .content :deep(em) {
    color: var(--pf-text-3);
  }
  .content :deep(strong) {
    font-weight: 600;
  }
  .content :deep(ul),
  .content :deep(ol) {
    padding-left: 20px;
    margin: 6px 0;
  }
  .content :deep(li) {
    margin: 2px 0;
  }
  .content :deep(p) {
    margin: 4px 0;
  }
  .content :deep(h1),
  .content :deep(h2),
  .content :deep(h3) {
    margin: 10px 0 6px;
    font-weight: 600;
  }
  .content :deep(h1) { font-size: 16px; }
  .content :deep(h2) { font-size: 15px; }
  .content :deep(h3) { font-size: 14px; }
  .content :deep(code) {
    background: var(--pf-bg-hover);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 13px;
  }
  .content :deep(pre) {
    background: var(--pf-bg-hover);
    padding: 10px 12px;
    border-radius: var(--pf-r-sm);
    overflow-x: auto;
    margin: 8px 0;
  }
  .content :deep(pre code) {
    background: none;
    padding: 0;
  }
  .tool-calls { margin-top: 10px; }

  &.receptionist { border-left-color: var(--pf-primary); }
  &.investigator { border-left-color: var(--pf-info); }
  &.reviewer { border-left-color: var(--pf-warning); }
  &.decision_maker { border-left-color: var(--pf-success); }
  &.skill_executor { border-left-color: var(--pf-violet); background: #fcfbff; }
  &[class*='worker_'] { border-left-color: var(--pf-text-3); background: var(--pf-bg-subtle); }
}

/* 打字机光标 */
.typing-cursor {
  display: inline-block;
  color: var(--pf-primary);
  font-weight: 300;
  animation: blink 1s step-end infinite;
  margin-left: 1px;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 思考中三点跳动 */
.thinking-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;

  span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--pf-primary-200);
    animation: bounce 1.4s ease-in-out infinite both;

    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
  }
}

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
