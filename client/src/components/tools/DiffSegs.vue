<template>
  <span class="diff-segs">
    <template v-if="!segs">{{ text || ' ' }}</template>
    <template v-else>
      <template v-for="(s, i) in visible" :key="i">
        <span v-if="s.op === 'same'">{{ s.text }}</span>
        <span v-else :class="side === 'old' ? 'c-del' : 'c-add'">{{ s.text }}</span>
      </template>
    </template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CharSeg } from '@/utils/charDiff'

const props = defineProps<{
  segs: CharSeg[] | null
  text: string
  /** old：显示 same+删除片段；new：显示 same+新增片段 */
  side: 'old' | 'new'
}>()

const visible = computed(() => {
  if (!props.segs) return []
  return props.segs.filter((s) =>
    s.op === 'same' ? true : props.side === 'old' ? s.op === 'del' : s.op === 'add'
  )
})
</script>

<style scoped>
.c-del { background: #fecaca; color: #991b1b; border-radius: 3px; }
.c-add { background: #a7f3d0; color: #065f46; border-radius: 3px; }
</style>
