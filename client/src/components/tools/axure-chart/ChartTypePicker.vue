<template>
  <div class="type-picker">
    <div v-for="g in groups" :key="g.key" class="tp-group">
      <div class="tp-gtitle">{{ g.label }}</div>
      <div class="tp-grid">
        <button
          v-for="c in g.cards"
          :key="c.id"
          type="button"
          class="tp-card"
          :class="{ on: c.id === modelValue }"
          :title="c.desc"
          @click="$emit('update:modelValue', c.id)"
        >
          <span class="tp-icon" v-html="chartGlyph(c.id)"></span>
          <span class="tp-name">{{ c.name }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CHART_CATALOG, CARD_GROUP_LABELS, type CardGroup } from './chartCatalog'
import { chartGlyph } from './chartGlyphs'

defineProps<{ modelValue: string }>()
defineEmits<{ 'update:modelValue': [id: string] }>()

const groups = computed(() => {
  const order: CardGroup[] = ['bar', 'part', 'metric']
  return order.map((key) => ({
    key,
    label: CARD_GROUP_LABELS[key],
    cards: CHART_CATALOG.filter((c) => c.group === key),
  }))
})
</script>

<style scoped lang="scss">
.type-picker { display: flex; flex-direction: column; gap: 10px; }
.tp-gtitle { font-size: 11px; color: #a9b0bc; font-weight: 600; letter-spacing: .5px; margin-bottom: 2px; }
.tp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 8px; }
.tp-card {
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 8px 4px 6px; border: 1px solid #ebedf2; border-radius: 8px; background: #fcfcfd;
  cursor: pointer; transition: all .15s;
  .tp-icon { width: 46px; height: 30px; color: #9aa3b5; display: block; transition: color .15s; }
  .tp-name { font-size: 11px; color: #4e5969; line-height: 1.2; text-align: center; }
  &:hover { border-color: #c6d2f5; background: #f7f9ff; }
  &.on {
    border-color: #6366f1; background: #f3f4ff; box-shadow: 0 1px 4px rgba(99,102,241,.18);
    .tp-icon { color: #6366f1; }
    .tp-name { color: #4338ca; font-weight: 600; }
  }
}
</style>
