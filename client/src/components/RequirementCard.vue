<template>
  <div class="req-card" @click="open">
    <div class="rc-top">
      <span class="rc-badge"><AppIcon name="sparkle" :size="12" :stroke-width="2.2" /></span>
      已沉淀需求 · {{ kindLabel }}
    </div>
    <div class="rc-title">{{ title || '加载中…' }}</div>
    <div class="rc-go">
      去查看 <AppIcon name="arrow-right" :size="13" :stroke-width="2.4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { getRequirement } from '@/api'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ rid: string; title?: string; kind?: string }>()
const store = useChatStore()
const title = ref(props.title || '')
const kind = ref(props.kind || '')

onMounted(async () => {
  if (!title.value || !kind.value) {
    try {
      const r = await getRequirement(props.rid)
      title.value = r.title
      kind.value = (r as any).kind || 'module'
    } catch {
      title.value = '（需求已删除）'
    }
  }
})

const kindLabel = computed(() => (kind.value === 'page' ? '页面' : '模块'))

function open() {
  // 对话内只读预览（抽屉），不离开对话；要改文档从抽屉里去需求清单
  store.previewRequirement(props.rid)
}
</script>

<style scoped lang="scss">
.req-card {
  margin-top: 10px;
  border: 1px solid #fed7aa;
  background: linear-gradient(180deg, #fff7f0 0%, #fff1e8 100%);
  border-radius: var(--pf-r-lg);
  padding: 11px 13px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;

  &:hover {
    border-color: #fdba74;
    box-shadow: 0 4px 14px rgba(249, 115, 22, 0.12);
  }

  .rc-top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--pf-orange-text);
    margin-bottom: 5px;
    .rc-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 6px;
      background: var(--pf-orange);
      color: #fff;
      flex-shrink: 0;
    }
  }
  .rc-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--pf-text-1);
    margin-bottom: 7px;
  }
  .rc-go {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    font-weight: 600;
    color: var(--pf-primary);
  }
}
</style>
