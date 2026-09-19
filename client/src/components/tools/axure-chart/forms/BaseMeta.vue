<template>
  <div class="wf-meta form-grid">
    <label class="field">
      <span>Axure 元件名</span>
      <el-input v-model="model.label" size="small" placeholder="如 chart_occurrence" />
    </label>
    <label class="field">
      <span>左上单位标注</span>
      <el-input v-model="model.unitTag" size="small" placeholder="金额（万元），可空" />
    </label>
    <label class="field">
      <span>右上时段文字</span>
      <el-input v-model="model.period" size="small" placeholder="近3年，可空" />
    </label>
  </div>
</template>

<script setup lang="ts">
import type { WizardBase } from '../chartTypes'
const model = defineModel<WizardBase>({ required: true })
</script>
