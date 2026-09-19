<template>
  <div v-if="groups.length" class="workers">
    <div class="sub-label">
      <span>调查专员</span>
      <span class="sub-count">{{ groups.length }} 位</span>
    </div>
    <div class="worker-chips">
      <div
        v-for="w in groups"
        :key="w.agentRole"
        class="worker-chip"
        :class="chipState(w)"
        @click="toggle(w.agentRole)"
      >
        <span class="chip-icon">{{ icon(w.agentRole) }}</span>
        <span class="chip-name">{{ w.agentName }}</span>
        <span class="chip-status">
          <span v-if="chipState(w) === 'loading'" class="mini-spin"></span>
          <span v-else-if="chipState(w) === 'done'" class="check">✓</span>
        </span>
        <el-icon class="chip-arrow" :class="{ open: openKey === chipKey(w.agentRole) }">
          <ArrowRight />
        </el-icon>
      </div>
    </div>

    <Transition name="expand">
      <div v-if="openKey" class="worker-detail">
        <template v-for="w in groups.filter(x => chipKey(x.agentRole) === openKey)" :key="w.agentRole">
          <!-- <div class="detail-head">
            <span class="detail-icon">{{ icon(w.agentRole) }}</span>
            <span class="detail-name">{{ w.agentName }}</span>
          </div> -->
          <ToolCallCard v-for="(t, i) in w.toolCalls" :key="i" :tool="t" />
        </template>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import type { ChatMessage } from '@/types'
import ToolCallCard from './ToolCallCard.vue'

interface WorkerGroup {
  agentRole: string
  agentName: string
  toolCalls: ChatMessage['toolCalls']
}

const props = defineProps<{
  groups: WorkerGroup[]
  sectionKey: string
  open: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: string | null]
}>()

const openKey = computed(() => props.open)

function chipKey(role: string) {
  return `${props.sectionKey}:${role}`
}

function toggle(role: string) {
  const key = chipKey(role)
  emit('update:open', openKey.value === key ? null : key)
}

function icon(role: string) {
  const map: Record<string, string> = {
    worker_business: '🏢', worker_credit: '💳', worker_financial: '📊',
    worker_litigation: '⚖️', worker_tax: '🧾'
  }
  return map[role] || '👤'
}

/** 单个专员的状态：loading / done / idle */
function chipState(w: WorkerGroup): 'loading' | 'done' | 'idle' {
  if (!w.toolCalls.length) return 'idle'
  return w.toolCalls.some((t) => t.loading) ? 'loading' : 'done'
}
</script>

<style scoped lang="scss">
.workers { margin-top: 6px; }

.sub-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #909399;
  font-weight: 500;
  margin-bottom: 8px;

  .sub-count {
    font-size: 11px;
    color: #c0c4cc;
    background: #f5f7fa;
    padding: 0 6px;
    border-radius: 8px;
    line-height: 16px;
  }
}

.worker-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.worker-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 12px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 18px;
  font-size: 12px;
  color: #606266;
  cursor: pointer;
  transition: all 0.18s ease;
  user-select: none;

  .chip-icon { font-size: 14px; line-height: 1; }
  .chip-name { font-weight: 500; }

  .chip-status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
  }

  .chip-arrow {
    font-size: 11px;
    color: #c0c4cc;
    transition: transform 0.2s ease;
    &.open { transform: rotate(90deg); }
  }

  &:hover {
    border-color: #409eff;
    color: #409eff;
    background: #f5f9ff;
  }

  /* 加载中：蓝色描边 + 轻脉冲 */
  &.loading {
    border-color: #409eff;
    background: #ecf5ff;
    color: #409eff;
    animation: chip-pulse 1.6s ease-in-out infinite;
  }

  /* 完成：绿色对勾 + 柔和底 */
  &.done {
    .check {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #67c23a;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
    }
  }

  &.active {
    border-color: #409eff;
    background: #ecf5ff;
    color: #409eff;
    box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.12);
  }
}

@keyframes chip-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(64, 158, 255, 0.25); }
  50% { box-shadow: 0 0 0 4px rgba(64, 158, 255, 0); }
}

.mini-spin {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid #b3d8ff;
  border-top-color: #409eff;
  animation: spin 0.7s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.worker-detail {
  margin-top: 10px;
  padding: 12px 14px;
  background: #fafbfc;
  border: 1px solid #ebeef5;
  border-radius: 8px;

  .detail-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #303133;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px dashed #ebeef5;

    .detail-icon { font-size: 14px; }
  }
}

/* 展开/收起过渡 */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.22s ease;
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  margin-top: 0;
}
.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 600px;
}
</style>
