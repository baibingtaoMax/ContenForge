<template>
  <div v-if="content" class="reasoning-block" :class="{ streaming: streaming }">
    <div class="reasoning-header" @click="onHeaderClick">
      <span class="reasoning-icon"><AppIcon name="sparkle" :size="13" :stroke-width="2.2" /></span>
      <span class="reasoning-title">{{ streaming ? '思考中…' : '思考过程' }}</span>
      <span v-if="streaming" class="reasoning-dots"><span></span><span></span><span></span></span>
      <el-icon class="reasoning-arrow" :class="{ open: expanded }"><ArrowDown /></el-icon>
    </div>
    <Transition name="reasoning-fold">
      <div v-show="expanded" class="reasoning-body" v-html="rendered"></div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import { renderMarkdown } from '@/utils/markdown'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  content?: string
  /** 是否还在流式生成中（控制文案与默认展开） */
  streaming?: boolean
}>()

// 流式期间默认展开，结束后自动折叠；用户手动点击不受影响
const expanded = ref(false)
const userToggled = ref(false)
watch(() => props.streaming, (s) => {
  if (s && !userToggled.value) expanded.value = true
  else if (!s && !userToggled.value) expanded.value = false
}, { immediate: true })

function onHeaderClick() {
  userToggled.value = true
  expanded.value = !expanded.value
}

const rendered = computed(() => renderMarkdown(props.content || ''))
</script>

<style scoped lang="scss">
.reasoning-block {
  margin: 8px 0;
  border: 1px dashed var(--pf-border-strong);
  border-radius: var(--pf-r-md);
  background: var(--pf-bg-subtle);
  overflow: hidden;

  &.streaming {
    border-color: var(--pf-primary-200);
    background: var(--pf-primary-50);
  }

  .reasoning-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    color: var(--pf-text-3);
    transition: background 0.15s;

    &:hover { background: rgba(0, 0, 0, 0.02); }

    .reasoning-icon { display: inline-flex; color: var(--pf-text-3); }
    .streaming & .reasoning-icon { color: var(--pf-primary); }
    .reasoning-title { font-weight: 600; }

    .reasoning-arrow {
      margin-left: auto;
      font-size: 12px;
      transition: transform 0.2s;
      color: var(--pf-text-3);
      &.open { transform: rotate(180deg); }
    }
  }

  .reasoning-body {
    padding: 8px 14px 12px;
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--pf-text-2);
    border-top: 1px dashed var(--pf-border);
    max-height: 360px;
    overflow-y: auto;

    :deep(p) { margin: 4px 0; }
    :deep(ul), :deep(ol) { padding-left: 18px; margin: 4px 0; }
    :deep(strong) { color: var(--pf-text-1); }
  }
}

.reasoning-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 2px;
  span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--pf-primary); opacity: 0.4;
    animation: r-bounce 1.2s ease-in-out infinite both;
    &:nth-child(1) { animation-delay: -0.3s; }
    &:nth-child(2) { animation-delay: -0.15s; }
  }
}
@keyframes r-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

.reasoning-fold-enter-active,
.reasoning-fold-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.reasoning-fold-enter-from,
.reasoning-fold-leave-to { opacity: 0; max-height: 0; }
.reasoning-fold-enter-to,
.reasoning-fold-leave-from { opacity: 1; max-height: 400px; }
</style>
