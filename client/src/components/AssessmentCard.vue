<template>
  <div class="assessment-card" :class="cardStatusClass">
    <!-- 卡头 -->
    <div class="card-header" @click="toggle">
      <div class="header-left">
        <span class="card-icon">{{ statusIcon }}</span>
        <span class="card-title">评估：{{ enterpriseName }}</span>
        <el-tag v-if="finalDecision" :type="decisionTagType" size="small" effect="dark" class="decision-tag">
          {{ decisionText(finalDecision.decision) }} · 风险{{ riskText(finalDecision.riskLevel) }}
        </el-tag>
        <span v-else class="running-hint">
          <span class="mini-spin"></span> 评估进行中…
        </span>
      </div>
      <el-icon class="collapse-icon" :class="{ collapsed: !expanded }"><ArrowDown /></el-icon>
    </div>

    <div v-show="expanded" class="card-body">
      <!-- 初始调查阶段 -->
       
      <section class="stage">
        <div class="stage-label">
          <span class="stage-dot investigation"></span> 调查阶段
          <span v-if="reviewRounds.length" class="stage-meta">含 {{ reviewRounds.length }} 轮补查</span>
        </div>
        <WorkerChips
        :groups="initialInvestigation.workers"
        section-key="initial"
        v-model:open="openWorker"
      />

        <div v-if="initialInvestigation.report" class="conclusion-block investigation">
          <ReasoningBlock v-if="initialInvestigation.reasoning" :content="initialInvestigation.reasoning" :streaming="streaming && !decision" />
          <div class="conclusion-label">🕵️ 调查主管综合结论</div>
          <div class="conclusion-text" v-html="render(initialInvestigation.report)"></div>
        </div>

    
      </section>

      <!-- 审查阶段（含补查） -->
      <section v-if="reviewRounds.length" class="stage">
        <div class="stage-label">
          <span class="stage-dot review"></span> 审查阶段
        </div>
        <div v-for="(round, i) in reviewRounds" :key="i" class="review-block">
          <div class="round-tag">第 {{ i + 1 }} 轮</div>

          <div class="conclusion-block review">
            <div class="conclusion-label">⚖️ 审查官意见</div>
            <ReasoningBlock v-if="round.reviewerReasoning" :content="round.reviewerReasoning" :streaming="streaming && !round.feedback" />
            <ReviewFeedbackCard v-if="round.feedback" :feedback="round.feedback" />
          </div>

          <template v-if="round.supplement">
            <WorkerChips
            :groups="round.supplement.workers"
            :section-key="`sup-${i}`"
            v-model:open="openWorker"
          />
            <div v-if="round.supplement.report || round.supplement.reasoning" class="conclusion-block investigation supplement">
              <ReasoningBlock v-if="round.supplement.reasoning" :content="round.supplement.reasoning" :streaming="streaming && !round.supplement.report" />
              <template v-if="round.supplement.report">
                <div class="conclusion-label">🕵️ 补充调查报告</div>
                <div class="conclusion-text" v-html="render(round.supplement.report)"></div>
              </template>
            </div>
           
          </template>
        </div>
      </section>

      <!-- 决策阶段 -->
      <section v-if="decision || decisionReasoning" class="stage">
        <div class="stage-label">
          <span class="stage-dot decision"></span> 最终决策
        </div>
        <ReasoningBlock v-if="decisionReasoning" :content="decisionReasoning" :streaming="streaming && !decision" />
        <DecisionCard v-if="decision" :decision="decision" />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import type { ChatMessage } from '@/types'
import ToolCallCard from './ToolCallCard.vue'
import ReviewFeedbackCard from './ReviewFeedbackCard.vue'
import DecisionCard from './DecisionCard.vue'
import WorkerChips from './WorkerChips.vue'
import ReasoningBlock from './ReasoningBlock.vue'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  messages: ChatMessage[]
  enterpriseName: string
  streaming?: boolean
}>()

const expanded = ref(true)
const openWorker = ref<string | null>(null)

function toggle() { expanded.value = !expanded.value }

const workerRoles = [
  'worker_business', 'worker_credit', 'worker_financial',
  'worker_litigation', 'worker_tax'
]

interface WorkerGroup {
  agentRole: string
  agentName: string
  toolCalls: ChatMessage['toolCalls']
}

interface ReviewRoundData {
  feedback: any
  reviewerReasoning?: string
  supplement: { report: string; reasoning?: string; workers: WorkerGroup[] } | null
}

function collectWorkers(msgs: ChatMessage[]): WorkerGroup[] {
  const map = new Map<string, WorkerGroup>()
  for (const m of msgs) {
    if (!m.agentRole || !workerRoles.includes(m.agentRole)) continue
    let g = map.get(m.agentRole)
    if (!g) {
      g = { agentRole: m.agentRole, agentName: m.agentName || m.agentRole, toolCalls: [] }
      map.set(m.agentRole, g)
    }
    if (m.toolCalls) g.toolCalls.push(...m.toolCalls)
  }
  return Array.from(map.values()).filter((g) => g.toolCalls.length > 0)
}

const timeline = computed(() => {
  const msgs = props.messages
  let initialReport = ''
  const initialWorkers: WorkerGroup[] = []
  const rounds: ReviewRoundData[] = []

  const firstInvIdx = msgs.findIndex((m) => m.agentRole === 'investigator')
  if (firstInvIdx >= 0) initialReport = msgs[firstInvIdx].content
  const initialReasoning = firstInvIdx >= 0 ? msgs[firstInvIdx].reasoningContent || '' : ''

  const reviewerIdx: number[] = []
  msgs.forEach((m, i) => { if (m.agentRole === 'reviewer') reviewerIdx.push(i) })

  if (reviewerIdx.length === 0) {
    initialWorkers.push(...collectWorkers(msgs.slice(firstInvIdx >= 0 ? firstInvIdx + 1 : 0)))
  } else {
    const startSlice = firstInvIdx >= 0 ? firstInvIdx + 1 : 0
    initialWorkers.push(...collectWorkers(msgs.slice(startSlice, reviewerIdx[0])))

    for (let i = 0; i < reviewerIdx.length; i++) {
      const rMsg = msgs[reviewerIdx[i]]
      const nextIdx = i + 1 < reviewerIdx.length ? reviewerIdx[i + 1] : msgs.length
      const afterMsgs = msgs.slice(reviewerIdx[i] + 1, nextIdx)

      const supInvIdx = afterMsgs.findIndex((m) => m.agentRole === 'investigator')
      const supInvMsg = supInvIdx >= 0 ? afterMsgs[supInvIdx] : null
      let supplement: ReviewRoundData['supplement'] = null
      if (supInvMsg) {
        supplement = {
          report: supInvMsg.content || '',
          reasoning: supInvMsg.reasoningContent || '',
          workers: collectWorkers(afterMsgs.slice(supInvIdx + 1)),
        }
      }

      rounds.push({ feedback: rMsg.reviewFeedback, reviewerReasoning: rMsg.reasoningContent, supplement })
    }
  }

  return {
    initialInvestigation: { report: initialReport, reasoning: initialReasoning, workers: initialWorkers },
    rounds,
  }
})

const initialInvestigation = computed(() => timeline.value.initialInvestigation)
const reviewRounds = computed(() => timeline.value.rounds)

const decisionMsg = computed(() => props.messages.find((m) => m.decision))
const decision = computed(() => decisionMsg.value?.decision || null)
const decisionReasoning = computed(() => decisionMsg.value?.reasoningContent || '')
const finalDecision = computed(() => decision.value)

const statusIcon = computed(() => {
  if (decision.value) {
    return decision.value.decision === 'reject' ? '⛔'
      : decision.value.decision === 'pass' ? '✅' : '⚠️'
  }
  return '🔍'
})
const cardStatusClass = computed(() => {
  if (!decision.value) return 'running'
  return decision.value.decision
})

function decisionText(d: string) {
  return ({ pass: '通过', reject: '拒绝', review: '人工复核' } as Record<string, string>)[d] || d
}
function riskText(r: string) {
  return ({ low: '低', medium: '中', high: '高' } as Record<string, string>)[r] || r
}
function decisionTagType(d?: string) {
  if (!d) return 'info'
  return ({ pass: 'success', reject: 'danger', review: 'warning' } as Record<string, string>)[d] || 'info'
}

function render(text: string) {
  return renderMarkdown(text)
}
</script>

<style scoped lang="scss">
.assessment-card {
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  margin-bottom: 18px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);

  &.pass { border-top: 3px solid #67c23a; }
  &.reject { border-top: 3px solid #f56c6c; }
  &.review { border-top: 3px solid #e6a23c; }
  &.running { border-top: 3px solid #409eff; }
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  background: #fafbfc;
  &:hover { background: #f5f7fa; }

  .header-left { display: flex; align-items: center; gap: 8px; }
  .card-icon { font-size: 18px; }
  .card-title { font-size: 14px; font-weight: 600; color: #303133; }
  .decision-tag { font-weight: 600; }
  .running-hint {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12px; color: #409eff;
  }
  .mini-spin {
    width: 12px; height: 12px; border-radius: 50%;
    border: 2px solid #d9ecff; border-top-color: #409eff;
    animation: spin 0.8s linear infinite;
  }
  .collapse-icon {
    color: #c0c4cc; transition: transform 0.2s;
    &.collapsed { transform: rotate(-90deg); }
  }
}
@keyframes spin { to { transform: rotate(360deg); } }

.card-body { padding: 12px 16px 16px; }

.stage {
  padding: 10px 0;
  border-top: 1px dashed #ebeef5;
  &:first-of-type { border-top: none; padding-top: 4px; }
}
.stage-label {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 600; color: #909399;
  text-transform: uppercase; letter-spacing: 0.3px;
  margin-bottom: 10px;
  .stage-meta { font-weight: 400; color: #c0c4cc; margin-left: 4px; }
}
.stage-dot {
  width: 8px; height: 8px; border-radius: 50%;
  &.investigation { background: #409eff; }
  &.review { background: #e6a23c; }
  &.decision { background: #67c23a; }
}

.sub-label { font-size: 12px; color: #606266; font-weight: 500; margin-bottom: 6px; }

/* 统一的角色结论块：调查主管 / 审查官 / 决策官 同一套结构与底色 */
.conclusion-block {
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-left: 4px solid transparent;
  background: #f5f9ff;
  border-left-color: #409eff;

  .conclusion-label {
    font-size: 12px; font-weight: 600; color: #409eff;
    margin-bottom: 6px;
  }
  .conclusion-text { font-size: 13px; line-height: 1.7; color: #303133; word-break: break-word;
    :deep(table) { border-collapse: collapse; width: 100%; margin: 8px 0; }
    :deep(th), :deep(td) { border: 1px solid #e4e7ed; padding: 5px 8px; text-align: left; font-size: 12px; }
    :deep(th) { background: #f5f7fa; font-weight: 600; }
    :deep(strong) { font-weight: 600; }
    :deep(ul), :deep(ol) { padding-left: 18px; margin: 4px 0; }
  }

  &.review {
    background: #fdf6ec; border-left-color: #e6a23c;
    .conclusion-label { color: #e6a23c; }
  }
  &.decision {
    background: #f0f9eb; border-left-color: #67c23a;
    .conclusion-label { color: #67c23a; }
  }
}

.review-block {
  margin-bottom: 10px;
  .round-tag {
    display: inline-block; font-size: 11px; color: #e6a23c;
    background: #fdf6ec; padding: 1px 8px; border-radius: 10px; margin-bottom: 6px;
  }
}

.supplement {
  margin-top: 8px;
}
</style>
