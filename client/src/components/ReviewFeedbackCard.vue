<template>
  <div class="review-feedback" :class="cardClass">
    <template v-if="feedback.action === 'supplement' && !feedback.maxRoundsReached">
      <div class="feedback-header">
        <span class="icon">🔄</span>
        <span class="title">需要补充调查（第 {{ feedback.round }} 轮）</span>
      </div>
      <ul v-if="feedback.questions?.length" class="question-list">
        <li v-for="(q, i) in feedback.questions" :key="i">{{ q }}</li>
      </ul>
    </template>

    <template v-else-if="feedback.maxRoundsReached">

      <ul v-if="feedback.questions?.length" class="question-list muted">
        <li v-for="(q, i) in feedback.questions" :key="i">{{ q }}</li>
      </ul>
      <div class="feedback-header">
        <span class="icon">⚠️</span>
        <span class="title">已达最大补查轮次（第 {{ feedback.round }} 轮）</span>
      </div>
      <div class="max-rounds-notice">
        审查官仍提出补充方向，但不再继续补查，将<strong>基于现有信息进入最终决策</strong>。
      </div>
    </template>

    <template v-else>
      <div class="feedback-header">
        <span class="icon">✅</span>
        <span class="title">审查通过</span>
      </div>
      <p v-if="feedback.summary" class="summary">{{ feedback.summary }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ReviewFeedback } from '@/types'

const props = defineProps<{
  feedback: ReviewFeedback
}>()

const cardClass = computed(() =>
  props.feedback.maxRoundsReached ? 'max-rounds' : props.feedback.action
)
</script>

<style scoped lang="scss">
.review-feedback {
  margin: 12px 0;
  padding: 14px 16px;
  border-radius: 8px;
  border-left: 0 solid;

  .feedback-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;

    .icon { font-size: 18px; }
    .title { font-weight: 600; font-size: 14px; }
  }

  .question-list {
    margin: 0;
    padding-left: 20px;

    li {
      font-size: 13px;
      line-height: 1.8;
      color: #606266;
    }

    &.muted li { color: #909399; }
  }

  .summary {
    margin: 0;
    font-size: 13px;
    color: #606266;
    line-height: 1.6;
  }

  .max-rounds-notice {
    font-size: 13px;
    line-height: 1.7;
    color: #b88230;
    background: #fdf6ec;
    border: 1px solid #f5dab1;
    border-radius: 6px;
    padding: 8px 12px;
    margin-bottom: 8px;

    strong { color: #b88230; }
  }

  &.supplement {
    background: #ecf5ff;
    border-color: #409eff;
    .title { color: #409eff; }
  }

  &.approve {
    background: #f0f9eb;
    border-color: #67c23a;
    .title { color: #67c23a; }
  }

  &.max-rounds {
    background: #fdf6ec;
    border-color: #e6a23c;
    .title { color: #b88230; }
  }
}
</style>
