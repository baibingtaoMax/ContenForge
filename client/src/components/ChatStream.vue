<template>
  <div class="chat-stream" ref="containerRef" @scroll="onScroll">
    <!-- 欢迎语 -->
    <div v-if="store.messages.length === 0" class="welcome">
      <BrandLogo variant="full" :size="64" class="welcome-icon" />
      <div class="welcome-title">ContentForge 内容搭档</div>
      <div class="welcome-desc">
        <template v-if="store.currentProject">
          当前推广主体：<strong>{{ store.currentProject.name }}</strong>，聊聊选题、稿子和渠道
        </template>
        <template v-else>新建或选择一个推广主体，开始做内容</template>
      </div>

      <div class="suggestions">
        <div class="suggestion" @click="store.send('我想做一个 30 篇的冷启动系列，先帮我铺选题')">
          <span class="sug-icon"><AppIcon name="list" tint="indigo" :size="30" /></span>
          <span class="sug-text">
            <span class="sug-title">铺一个系列选题</span>
            <span class="sug-desc">告诉它主体和方向，一次铺 30 个选题进台账</span>
          </span>
        </div>
        <div class="suggestion" @click="store.send('帮我把这个选题写成一篇公众号主稿')">
          <span class="sug-icon"><AppIcon name="edit" tint="violet" :size="30" /></span>
          <span class="sug-text">
            <span class="sug-title">从选题写成稿</span>
            <span class="sug-desc">聊清角度后出主稿，定稿一键适配三渠道</span>
          </span>
        </div>
        <div class="suggestion" @click="store.send('这篇发了，公众号阅读 1200、赞 86，帮我分析下一篇怎么调')">
          <span class="sug-icon"><AppIcon name="check" tint="emerald" :size="30" /></span>
          <span class="sug-text">
            <span class="sug-title">发完回填数据</span>
            <span class="sug-desc">登记链接和数据，让它给后续选题建议</span>
          </span>
        </div>
      </div>
    </div>

    <div v-else class="messages">
      <template v-for="(item, i) in groupedMessages" :key="item.key">
        <AssessmentCard
          v-if="item.type === 'assessment'"
          :messages="item.messages"
          :enterprise-name="item.enterpriseName"
          :streaming="store.isStreaming"
        />
        <MessageBubble
          v-else
          :message="item.message"
          :is-last="i === groupedMessages.length - 1"
          :streaming="store.isStreaming"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import MessageBubble from './MessageBubble.vue'
import AssessmentCard from './AssessmentCard.vue'
import AppIcon from './AppIcon.vue'
import BrandLogo from './BrandLogo.vue'
import type { ChatMessage } from '@/types'

const store = useChatStore()
const containerRef = ref<HTMLElement | null>(null)

type GroupedItem =
  | { type: 'bubble'; key: string; message: ChatMessage }
  | { type: 'assessment'; key: string; messages: ChatMessage[]; enterpriseName: string }

/** 将连续且同 assessmentId 的 agent 消息归为一张评估卡 */
const workerRoles = new Set([
  'worker_business', 'worker_credit', 'worker_financial',
  'worker_litigation', 'worker_tax',
])

const groupedMessages = computed<GroupedItem[]>(() => {
  const result: GroupedItem[] = []
  const msgs = store.messages
  let i = 0
  while (i < msgs.length) {
    const m = msgs[i]
    const aid = m.assessmentId
    if (aid) {
      const group: ChatMessage[] = []
      let enterpriseName = '企业'
      while (i < msgs.length && msgs[i].assessmentId === aid) {
        const cur = msgs[i]
        if (cur.decision && (cur.decision as any).enterpriseName) enterpriseName = (cur.decision as any).enterpriseName
        group.push(cur)
        i++
      }
      result.push({ type: 'assessment', key: `a-${aid}`, messages: group, enterpriseName })
    } else {
      // 五个领域专员的气泡不单独展示——评估卡内的 WorkerChips 已聚合呈现
      if (!(m.role === 'agent' && m.agentRole && workerRoles.has(m.agentRole))) {
        result.push({ type: 'bubble', key: `b-${m.id}`, message: m })
      }
      i++
    }
  }
  return result
})

// ===== 自动滚动 =====
// 刷新回放/切对话时，历史消息一次性渲染，但沉淀卡标题（历史只有 id，要异步拉）、
// mermaid、图片等是异步撑开高度的；若只 nextTick 滚一次，scrollHeight 偏小，
// 内容渲染完往下撑后滚动条就停在半截，看起来像“上面少了一段”。
// 这里：贴底才自动滚，滚底后用 rAF + 延时补滚几帧直到高度稳定；用户上滑查看时不强行拽回。
const stickToBottom = ref(true) // 是否保持贴底（用户主动上滑后置 false，切对话/新消息重置）

function onScroll() {
  const el = containerRef.value
  if (!el) return
  const dist = el.scrollHeight - el.scrollTop - el.clientHeight
  stickToBottom.value = dist < 80 // 距底 80px 内视为贴底
}

function scrollToBottom(smooth = false) {
  const el = containerRef.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}

// 落底后多补几帧：等异步内容（沉淀卡标题、mermaid、图片）渲染撑开高度
function settleToBottom() {
  let prevH = -1
  let tries = 0
  const tick = () => {
    const el = containerRef.value
    if (!el) return
    const h = el.scrollHeight
    if (stickToBottom.value) scrollToBottom()
    tries++
    // 高度稳定或超过 ~1.2s 停止；高度变化就继续补滚
    if ((h !== prevH || tries < 6) && tries < 24) {
      prevH = h
      requestAnimationFrame(() => setTimeout(tick, 50))
    }
  }
  requestAnimationFrame(tick)
}

// 切对话/首次加载历史：重置贴底并落稳
watch(
  () => store.currentConversationId,
  async () => {
    stickToBottom.value = true
    await nextTick()
    settleToBottom()
  }
)

watch(
  () => [store.messages.length, store.messages[store.messages.length - 1]?.content,
         store.messages[store.messages.length - 1]?.decision, store.statusText],
  async () => {
    await nextTick()
    // 有新消息（含流式）且贴底时才滚动；用户正在上滑看历史则不打扰
    if (stickToBottom.value) settleToBottom()
  },
  { deep: true }
)
</script>

<style scoped lang="scss">
.chat-stream {
  flex: 1;
  overflow-y: auto;
  padding: 28px 0;
}

.welcome {
  max-width: 680px;
  margin: 40px auto;
  text-align: center;
  color: var(--pf-text-2);

  .welcome-icon {
    display: flex;
    margin: 0 auto 18px;
  }
  .welcome-title { font-size: 21px; font-weight: 700; color: var(--pf-text-1); margin-bottom: 8px; letter-spacing: 0.2px; }
  .welcome-desc { font-size: 13.5px; color: var(--pf-text-3); margin-bottom: 28px; strong { color: var(--pf-text-1); font-weight: 600; } }

  .suggestions {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 460px;
    margin: 0 auto;
  }
  .suggestion {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--pf-bg-surface);
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-r-xl);
    cursor: pointer;
    text-align: left;
    transition: all 0.18s;
    box-shadow: var(--pf-shadow-xs);
    &:hover {
      border-color: var(--pf-primary-200);
      box-shadow: var(--pf-shadow-md);
      transform: translateY(-1px);
    }
    .sug-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .sug-title { font-size: 13.5px; font-weight: 600; color: var(--pf-text-1); }
    .sug-desc { font-size: 12px; color: var(--pf-text-3); }
  }
}

.messages {
  max-width: 820px;
  margin: 0 auto;
  padding: 0 28px;
}
</style>
