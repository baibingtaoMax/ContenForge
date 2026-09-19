<template>
  <div class="map-page-node" :class="{ 'has-open': data.open > 0 }">
    <div v-if="data.open > 0" class="open-bubble">{{ data.open > 99 ? '99+' : data.open }}</div>
    <div class="page-top">
      <AppIcon name="file" :size="23" class="page-ico" :stroke-width="2" />
      <div class="page-name" :title="data.title">{{ data.title }}</div>
      <AppIcon v-if="data.inProto" name="monitor" :size="13" class="proto-mark" :stroke-width="2" />
      <span class="status-dot" :class="data.status"></span>
    </div>
    <Handle type="target" :position="data.dir === 'LR' ? Position.Left : Position.Top" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import AppIcon from '@/components/AppIcon.vue'

interface PageNodeData {
  title: string
  status: 'proposed' | 'confirmed'
  inProto: boolean
  open: number
  dir: 'LR' | 'TB'
}

defineProps<{ data: PageNodeData }>()
</script>

<style scoped lang="scss">
.map-page-node {
  width: 176px;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: 11px;
  padding: 11px 12px;
  box-shadow: var(--pf-shadow-sm);
  transition: box-shadow 0.18s, transform 0.18s, border-color 0.18s;
  position: relative;
  cursor: pointer;

  &:hover {
    box-shadow: var(--pf-shadow-md);
    transform: translateY(-1px);
    border-color: var(--pf-primary-200);
  }
  &.has-open {
    border-color: #f3b4b4;
  }
}
.page-top {
  display: flex;
  align-items: center;
  gap: 8px;
}
.page-ico {
  color: var(--pf-text-3);
  flex-shrink: 0;
}
.page-name {
  font-size: 12.5px;
  font-weight: 600;
  flex: 1;
  min-width: 0;
  color: var(--pf-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proto-mark {
  color: var(--pf-text-3);
  flex-shrink: 0;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.confirmed { background: var(--pf-success); }
  &.proposed { background: var(--pf-warning); }
}
.open-bubble {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--pf-danger);
  color: #fff;
  font-size: 10.5px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 3px 8px rgba(239, 68, 68, 0.35);
  border: 2px solid #fff;
}
</style>
