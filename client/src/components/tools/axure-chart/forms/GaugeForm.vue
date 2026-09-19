<template>
  <div class="ga-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec">
      <div class="f-title">指标值</div>
      <div class="num-grid">
        <label class="field">
          <span>当前值</span>
          <el-input-number v-model="model.value" :controls="false" size="small" class="num-in" />
        </label>
        <label class="field">
          <span>单位后缀</span>
          <el-input v-model="model.unit" size="small" placeholder="%" />
        </label>
        <label class="field">
          <span>小数位</span>
          <el-input-number v-model="model.decimals" :min="0" :max="4" size="small" class="num-in" />
        </label>
        <label class="field">
          <span>最小值</span>
          <el-input-number v-model="model.min" :controls="false" size="small" class="num-in" />
        </label>
        <label class="field">
          <span>最大值</span>
          <el-input-number v-model="model.max" :min="1" :controls="false" size="small" class="num-in" />
        </label>
      </div>
    </div>

    <div class="f-sec">
      <div class="f-title">
        阈值分段
        <el-button size="small" text type="primary" @click="addSeg">+ 添加一段</el-button>
      </div>
      <p class="hint">从最小到最大依次给上限和颜色，如 0~2 绿、2~3.5 黄、3.5~5 红。</p>
      <div class="data-card">
        <table class="dtable">
          <thead>
            <tr><th class="op"></th><th>段名称</th><th>上限（到）</th><th class="op"></th></tr>
          </thead>
          <tbody>
            <tr v-for="(sg, i) in model.segs" :key="i">
              <td class="op"><el-color-picker v-model="sg.color" size="small" class="seg-color" /></td>
              <td><input v-model="sg.name" class="cell cat wide" spellcheck="false" /></td>
              <td><input v-model.number="sg.to" type="number" class="cell num" /></td>
              <td class="op"><button class="row-del" title="删除" :disabled="model.segs.length <= 1" @click="model.segs.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PALETTE, type GaugeCfg } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<GaugeCfg>({ required: true })

const SEG_COLORS = [PALETTE.green, PALETTE.yellow, PALETTE.red]
function addSeg() {
  const i = model.value.segs.length
  model.value.segs.push({ to: model.value.max || 100, color: SEG_COLORS[i % 3], name: '段' + (i + 1) })
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.ga-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.num-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
.num-in { width: 100%; :deep(input) { text-align: left; } }
.seg-color { :deep(.el-color-picker__trigger) { width: 24px; height: 24px; } }
</style>
