<template>
  <div class="article-row" @click="$emit('open', article.id)">
    <span class="status-dot" :class="article.status" />
    <span class="ar-title" :title="article.title">{{ article.title }}</span>
    <span v-if="article.angle" class="ar-angle">{{ article.angle }}</span>
    <span class="ar-spacer" />
    <span class="ch-icons" @click.stop>
      <AppIcon v-for="c in presentChannels" :key="c" :name="channelIcon(c)" :size="13" class="ch-ic" />
    </span>
    <el-dropdown trigger="click" @command="(cmd: string) => onStatus(cmd as ArticleStatus)" @click.stop>
      <span class="ar-status" :class="article.status" @click.stop>{{ statusLabel }}</span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-for="s in STATUS_OPTS" :key="s.value" :command="s.value">{{ s.label }}</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <AppIcon name="trash" :size="13" class="ar-del" @click.stop="$emit('del', article)" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import type { Article, ArticleStatus, ChannelKey } from '@/types'

const props = defineProps<{ article: Article }>()
const emit = defineEmits<{
  (e: 'open', id: string): void
  (e: 'status', article: Article, s: ArticleStatus): void
  (e: 'del', article: Article): void
}>()

const STATUS_OPTS: Array<{ value: ArticleStatus; label: string }> = [
  { value: 'topic', label: '选题' },
  { value: 'writing', label: '写作中' },
  { value: 'final', label: '定稿' },
  { value: 'published', label: '已发' },
]
const statusLabel = computed(() => STATUS_OPTS.find((s) => s.value === props.article.status)?.label || '选题')
const presentChannels = computed(() => (props.article.channels || []) as ChannelKey[])
function channelIcon(c: ChannelKey) {
  return c === 'wechat' ? 'chat' : c === 'xhs' ? 'bookmark' : 'file'
}
function onStatus(s: ArticleStatus) {
  emit('status', props.article, s)
}
</script>

<script lang="ts">
export default { name: 'ArticleRow' }
</script>

<style scoped lang="scss">
.article-row {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: var(--pf-r-md);
  cursor: pointer; transition: background 0.12s;
  &:hover { background: var(--pf-bg-hover); .ar-del { opacity: 1; } }
}
.status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: #a5b4fc;
  &.writing { background: #f59e0b; } &.final { background: #10b981; } &.published { background: #16a34a; }
}
.ar-title { font-size: 13px; font-weight: 500; color: var(--pf-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
.ar-angle { font-size: 11.5px; color: var(--pf-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
.ar-spacer { flex: 1; }
.ch-icons { display: inline-flex; gap: 3px; margin-right: 4px; .ch-ic { color: var(--pf-text-3); } }
.ar-status {
  font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 10px; flex-shrink: 0;
  background: #e0e7ff; color: #4338ca;
  &.writing { background: #fef3c7; color: #b45309; }
  &.final { background: #d1fae5; color: #047857; }
  &.published { background: #dcfce7; color: #15803d; }
}
.ar-del { color: var(--pf-text-3); opacity: 0; transition: opacity 0.12s, color 0.12s; flex-shrink: 0;
  &:hover { color: var(--pf-danger); }
}
</style>
