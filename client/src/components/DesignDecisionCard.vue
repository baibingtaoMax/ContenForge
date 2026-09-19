<template>
  <div class="dd-card" @click="open">
    <div class="dd-top">
      <span class="dd-badge"><AppIcon name="flag" :size="12" :stroke-width="2.4" /></span>
      已记录设计决策<template v-if="sourceLabel"> · {{ sourceLabel }}</template><template v-if="point"> · {{ point }}</template>
    </div>
    <div class="dd-topic">{{ topic || '加载中…' }}</div>
    <div v-if="conclusion" class="dd-conclusion">{{ conclusion }}</div>
    <div class="dd-go">
      {{ linkedCount ? `查看决策脉络（关联 ${linkedCount} 条需求）` : '查看决策详情' }}
      <AppIcon name="arrow-right" :size="13" :stroke-width="2.4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { getDecision } from '@/api'
import { useChatStore } from '@/stores/chat'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ did: string; topic?: string }>()
const store = useChatStore()
const topic = ref(props.topic || '')
const conclusion = ref('')
const sourceLabel = ref('')
const point = ref('')
const linkedCount = ref(0)

onMounted(async () => {
  try {
    const d = await getDecision(props.did)
    topic.value = d.topic
    conclusion.value = d.conclusion
    point.value = d.point || ''
    sourceLabel.value = d.sourceType === 'meeting' ? d.sourceLabel || '会议纪要' : d.sourceType === 'chat' ? '对话' : '手动记录'
    linkedCount.value = d.requirementIds.length
  } catch {
    topic.value = '（决策记录已删除）'
  }
})

function open() {
  // 对话内点决策卡：只读抽屉看需求文档 + 决策脉络，不离开对话
  if (!linkedCount.value) {
    ElMessage.info('这条决策没有关联具体需求，可在对应需求详情的「决策脉络」里查看全部')
    return
  }
  getDecision(props.did).then((d) => {
    if (d.requirementIds[0]) store.previewRequirement(d.requirementIds[0])
  })
}
</script>

<style scoped lang="scss">
.dd-card {
  margin-top: 10px;
  border: 1px solid #c7d2fe;
  background: linear-gradient(180deg, #f5f6ff 0%, #eef0ff 100%);
  border-radius: var(--pf-r-lg);
  padding: 11px 13px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;

  &:hover {
    border-color: #a5b4fc;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.14);
  }

  .dd-top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: #4f46e5;
    letter-spacing: 0.2px;
  }
  .dd-badge { display: inline-flex; }
  .dd-topic {
    margin-top: 5px;
    font-size: 13.5px;
    font-weight: 700;
    color: #1e1b4b;
    line-height: 1.5;
  }
  .dd-conclusion {
    margin-top: 3px;
    font-size: 12.5px;
    color: #4b5563;
    line-height: 1.6;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .dd-go {
    margin-top: 7px;
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    font-weight: 600;
    color: #4f46e5;
  }
}
</style>
