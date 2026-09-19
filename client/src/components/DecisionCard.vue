<template>
  <div class="decision-card" :class="decision.decision">
    <div class="decision-header">
      <span class="decision-icon">{{ icon }}</span>
      <span class="decision-text">{{ text }}</span>
      <el-tag :type="riskTagType" effect="dark" size="large" class="risk-tag">
        风险等级：{{ riskText }}
      </el-tag>
    </div>
    <div v-if="decision.reasons?.length" class="decision-section">
      <div class="section-title">决策依据</div>
      <ul>
        <li v-for="(r, i) in decision.reasons" :key="i">{{ r }}</li>
      </ul>
    </div>
    <div v-if="decision.suggestions?.length" class="decision-section">
      <div class="section-title">建议措施</div>
      <ul>
        <li v-for="(s, i) in decision.suggestions" :key="i">{{ s }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DecisionResult } from '@/types'

const props = defineProps<{
  decision: DecisionResult
}>()

const icon = computed(() => {
  const map: Record<string, string> = {
    pass: '✅',
    reject: '❌',
    review: '⚠️'
  }
  return map[props.decision.decision] || ''
})

const text = computed(() => {
  const map: Record<string, string> = {
    pass: '通过',
    reject: '拒绝',
    review: '人工复核'
  }
  return map[props.decision.decision] || ''
})

const riskText = computed(() => {
  const map: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高'
  }
  return map[props.decision.riskLevel] || ''
})

const riskTagType = computed(() => {
  const map: Record<string, string> = {
    low: 'success',
    medium: 'warning',
    high: 'danger'
  }
  return map[props.decision.riskLevel] || 'info'
})
</script>

<style scoped lang="scss">
.decision-card {
  margin-top: 16px;
  padding: 20px;
  border-radius: 12px;
  border: 2px solid;
  animation: fadeInUp 0.4s ease-out;

  .decision-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;

    .decision-icon {
      font-size: 32px;
    }
    .decision-text {
      font-size: 24px;
      font-weight: 700;
    }
    .risk-tag {
      margin-left: auto;
    }
  }

  .decision-section {
    margin-top: 12px;

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #606266;
      margin-bottom: 6px;
    }

    ul {
      margin: 0;
      padding-left: 20px;

      li {
        font-size: 14px;
        line-height: 1.8;
        color: #303133;
      }
    }
  }

  &.pass {
    background: #f0f9eb;
    border-color: #67c23a;
    .decision-text { color: #67c23a; }
  }
  &.reject {
    background: #fef0f0;
    border-color: #f56c6c;
    .decision-text { color: #f56c6c; }
  }
  &.review {
    background: #fdf6ec;
    border-color: #e6a23c;
    .decision-text { color: #e6a23c; }
  }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
