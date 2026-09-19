<template>
  <div class="ver-reader">
    <header class="rd-header">
      <button class="rd-back" @click="$emit('back')">
        <AppIcon name="arrow-left" :size="14" /> 历史版本
      </button>
      <div class="rd-nav">
        <button class="nav-btn" :disabled="!hasPrev" title="较新一版" @click="$emit('prev')">
          <AppIcon name="arrow-right" :size="13" style="transform: rotate(180deg)" />
        </button>
        <span class="rd-pos">{{ position }}</span>
        <button class="nav-btn" :disabled="!hasNext" title="较旧一版" @click="$emit('next')">
          <AppIcon name="arrow-right" :size="13" />
        </button>
      </div>
    </header>

    <div class="rd-meta-bar">
      <div class="rd-meta">
        <span class="rd-ver">{{ label }}</span>
        <span v-if="trigger" class="rd-trigger">{{ trigger }}</span>
        <span v-if="actor" class="rd-actor">{{ actor }}</span>
        <span class="rd-time">{{ time }}</span>
      </div>
      <el-button v-if="canRestore" size="small" plain :loading="restoring" @click="$emit('restore')">
        <AppIcon name="rotate-ccw" :size="13" /> 恢复此版内容
      </el-button>
    </div>

    <div class="rd-scroll">
      <article v-if="doc" class="md-doc" v-html="renderMarkdown(doc)"></article>
      <div v-else class="rd-empty">这一版没有正文内容</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { renderMarkdown } from '@/utils/markdown'

defineProps<{
  label: string
  trigger?: string
  actor?: string
  time: string
  doc: string
  position: string
  hasPrev: boolean
  hasNext: boolean
  canRestore: boolean
  restoring: boolean
}>()
defineEmits<{ back: []; prev: []; next: []; restore: [] }>()
</script>

<style scoped lang="scss">
.ver-reader { display: flex; flex-direction: column; height: 100%; background: var(--pf-bg, #f6f7f9); }
.rd-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px; background: var(--pf-bg-surface); border-bottom: 1px solid var(--pf-border);
}
.rd-back {
  display: inline-flex; align-items: center; gap: 5px; border: none; background: none;
  font-size: 13px; font-weight: 600; color: var(--pf-primary, #6366f1); cursor: pointer; padding: 4px 6px;
  border-radius: 6px;
  &:hover { background: var(--pf-bg-hover, #f1f2f8); }
}
.rd-nav { display: flex; align-items: center; gap: 4px; }
.nav-btn {
  width: 26px; height: 26px; border-radius: 7px; border: 1px solid var(--pf-border);
  background: var(--pf-bg-surface); cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--pf-text-2);
  &:hover:not(:disabled) { border-color: var(--pf-primary-200, #c7d2fe); color: var(--pf-primary, #6366f1); }
  &:disabled { opacity: .4; cursor: not-allowed; }
}
.rd-pos { font-size: 12px; color: var(--pf-text-3); min-width: 52px; text-align: center; }

.rd-meta-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 18px; background: var(--pf-bg-surface); border-bottom: 1px solid var(--pf-border);
}
.rd-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.rd-ver { font-size: 14px; font-weight: 800; color: var(--pf-text-1); }
.rd-trigger {
  font-size: 10.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px;
  background: #eef0ff; color: #4338ca; border: 1px solid #e0e3ff;
}
.rd-actor { font-size: 12px; color: var(--pf-text-3); }
.rd-time { font-size: 12px; color: var(--pf-text-3); }

.rd-scroll { flex: 1; overflow-y: auto; padding: 20px 24px 32px; }
.rd-empty { text-align: center; color: var(--pf-text-3); font-size: 13px; padding: 60px 0; }
</style>
