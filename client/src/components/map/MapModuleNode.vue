<template>
  <div class="map-mod-node" :class="`tone-${data.tone}`">
    <div class="mod-top">
      <AppIcon :name="data.icon" :tint="data.tone" :size="28" />
      <div class="mod-name" :title="data.title">{{ data.title }}</div>
      <span v-if="data.openCount > 0" class="mod-open">{{ data.openCount }}</span>
    </div>
    <div class="mod-meta">
      <span class="mod-pages">{{ data.total }} 页</span>
      <span class="mod-bar"><i :style="{ width: pct + '%' }"></i></span>
      <span class="mod-pct">{{ pct }}%</span>
    </div>
    <Handle type="source" :position="data.dir === 'LR' ? Position.Right : Position.Bottom" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import AppIcon from '@/components/AppIcon.vue'
import type { MapTone } from '@/utils/requirementMap'

interface ModuleNodeData {
  title: string
  tone: MapTone
  icon: string
  total: number
  confirmed: number
  openCount: number
  dir: 'LR' | 'TB'
}

const props = defineProps<{ data: ModuleNodeData }>()
const pct = computed(() =>
  props.data.total ? Math.round((props.data.confirmed / props.data.total) * 100) : 0
)
</script>

<style scoped lang="scss">
.map-mod-node {
  width: 200px;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: 13px;
  padding: 12px 13px;
  box-shadow: var(--pf-shadow-md);
  position: relative;
  overflow: hidden;
  cursor: pointer;
  transition: box-shadow 0.18s, transform 0.18s, border-color 0.18s;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--pf-tint-indigo);
    opacity: 0.85;
  }
  &.tone-violet::before { background: var(--pf-tint-violet); }
  &.tone-sky::before { background: var(--pf-tint-sky); }
  &.tone-amber::before { background: var(--pf-tint-amber); }
  &.tone-emerald::before { background: var(--pf-tint-emerald); }
  &.tone-slate::before { background: var(--pf-tint-slate); }

  &:hover {
    box-shadow: var(--pf-shadow-lg);
    border-color: var(--pf-primary-200);
    transform: translateY(-1px);
  }
}
.mod-top {
  display: flex;
  align-items: center;
  gap: 9px;
}
.mod-name {
  font-size: 13.5px;
  font-weight: 700;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--pf-text-1);
}
.mod-open {
  flex-shrink: 0;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--pf-danger);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mod-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 11px;
}
.mod-pages {
  font-size: 11px;
  color: var(--pf-text-3);
}
.mod-bar {
  flex: 1;
  height: 5px;
  border-radius: 99px;
  background: var(--pf-bg-hover);
  overflow: hidden;
  i {
    display: block;
    height: 100%;
    border-radius: 99px;
    background: linear-gradient(90deg, #34d399, #10b981);
  }
}
.mod-pct {
  font-size: 11px;
  font-weight: 700;
  color: var(--pf-text-2);
}
</style>
