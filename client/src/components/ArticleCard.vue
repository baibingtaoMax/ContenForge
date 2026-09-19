<template>
  <div class="article-card" @click="open">
    <div class="ac-top">
      <span class="ac-badge"><AppIcon name="edit" :size="12" :stroke-width="2.2" /></span>
      {{ topLabel }}
      <span class="ac-status" :class="statusKey">{{ statusLabel }}</span>
    </div>
    <div class="ac-title">{{ title || '加载中…' }}</div>
    <div class="ac-go">
      去查看 <AppIcon name="arrow-right" :size="13" :stroke-width="2.4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { getArticle } from '@/api'
import AppIcon from './AppIcon.vue'
import type { ArticleStatus } from '@/types'

const props = defineProps<{ aid: string; title?: string; status?: string; revised?: boolean; published?: boolean }>()
const store = useChatStore()
const title = ref(props.title || '')
const status = ref<ArticleStatus>((props.status as ArticleStatus) || 'topic')

onMounted(async () => {
  if (!title.value || !props.status) {
    try {
      const a = await getArticle(props.aid)
      title.value = a.title
      status.value = a.status
    } catch {
      title.value = '（文章已删除）'
    }
  }
})

const statusKey = computed(() => props.published || status.value === 'published' ? 'published' : status.value)
const statusLabel = computed(() => {
  const map: Record<string, string> = {
    topic: '选题', writing: '写作中', final: '定稿', published: '已发',
  }
  return map[statusKey.value] || '选题'
})
const topLabel = computed(() => {
  if (props.published || status.value === 'published') return '已记录发布'
  if (props.revised) return '已更新文章'
  return status.value === 'topic' ? '已沉淀到内容计划' : '已沉淀文章'
})

function open() {
  store.requestOpenArticle?.(props.aid)
}
</script>

<style scoped lang="scss">
.article-card {
  margin-top: 10px;
  border: 1px solid #c7d2fe;
  background: linear-gradient(180deg, #f5f7ff 0%, #eef2ff 100%);
  border-radius: var(--pf-r-lg);
  padding: 11px 13px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;

  &:hover {
    border-color: #a5b4fc;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.14);
  }

  .ac-top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: #4f46e5;
    margin-bottom: 5px;
    .ac-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 6px;
      background: #6366f1;
      color: #fff;
      flex-shrink: 0;
    }
    .ac-status {
      margin-left: auto;
      font-size: 10.5px;
      font-weight: 600;
      padding: 1px 8px;
      border-radius: 10px;
      background: #e0e7ff;
      color: #4338ca;
      &.writing { background: #fef3c7; color: #b45309; }
      &.final { background: #d1fae5; color: #047857; }
      &.published { background: #dcfce7; color: #15803d; }
    }
  }
  .ac-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--pf-text-1);
    margin-bottom: 7px;
  }
  .ac-go {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    font-weight: 600;
    color: var(--pf-primary);
  }
}
</style>
