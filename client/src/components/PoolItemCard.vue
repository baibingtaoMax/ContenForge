<template>
  <div class="pool-card" @click="open">
    <div class="pc-top">
      <span class="pc-badge"><AppIcon name="lightbulb" :size="12" :stroke-width="2.2" /></span>
      已收入需求池 · {{ statusLabel }}
    </div>
    <div class="pc-title">{{ title || '加载中…' }}</div>
    <div v-if="summary" class="pc-summary">{{ summary }}</div>
    <div class="pc-go">
      去需求池处理 <AppIcon name="arrow-right" :size="13" :stroke-width="2.4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useChatStore } from '@/stores/chat'
import { getRequirement } from '@/api'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ rid: string; title?: string; status?: string }>()
const store = useChatStore()
const title = ref(props.title || '')
const summary = ref('')
const statusLabel = ref(props.status === 'ready' ? '可转需求' : '待澄清')

onMounted(async () => {
  try {
    const r = await getRequirement(props.rid)
    if (!title.value) title.value = r.title
    summary.value = r.summary || ''
    if (r.pool_status === 'ready') statusLabel.value = '可转需求'
    if (r.pool_status === 'shelved') statusLabel.value = '已搁置'
  } catch {
    title.value = '（想法已删除）'
  }
})

function open() {
  store.selectProjectFixed('pool')
}
</script>

<style scoped lang="scss">
.pool-card {
  margin-top: 10px;
  border: 1px solid #fde68a;
  background: linear-gradient(180deg, #fffbeb 0%, #fef7dd 100%);
  border-radius: var(--pf-r-lg);
  padding: 11px 13px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;

  &:hover {
    border-color: #fcd34d;
    box-shadow: 0 4px 14px rgba(245, 158, 11, 0.12);
  }

  .pc-top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: #b45309;
    margin-bottom: 5px;
    .pc-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 6px;
      background: #f59e0b;
      color: #fff;
      flex-shrink: 0;
    }
  }
  .pc-title {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--pf-text-1);
  }
  .pc-summary {
    font-size: 12px;
    color: var(--pf-text-3);
    line-height: 1.6;
    margin: 3px 0 6px;
  }
  .pc-go {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    font-weight: 600;
    color: #d97706;
  }
}
</style>
