<template>
  <div class="cart-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec">
      <div class="f-title">
        指标系列（{{ model.series.length }}）
        <el-button size="small" text type="primary" @click="addSeries">+ 添加系列</el-button>
      </div>
      <div class="series-list">
        <div v-for="(s, i) in model.series" :key="i" class="series-card">
          <div class="sc-line1">
            <el-color-picker v-model="s.color" size="small" class="sc-color" />
            <el-input v-model="s.name" size="small" class="s-name" placeholder="系列名称" />
            <el-input v-model="s.short" size="small" class="s-short" placeholder="图例简称(选填)" />
            <button class="row-del" title="删除系列" :disabled="model.series.length <= 1" @click="removeSeries(i)">×</button>
          </div>
          <div class="sc-line2">
            <span class="ctl"><em>形态</em>
              <el-select v-model="s.type" size="small" class="w78">
                <el-option value="bar" label="柱" />
                <el-option value="line" label="线" />
                <el-option value="area" label="面积线" />
              </el-select>
            </span>
            <span class="ctl"><em>坐标轴</em>
              <el-select v-model="s.axis" size="small" class="w78">
                <el-option value="left" label="左轴" />
                <el-option value="right" label="右轴" />
              </el-select>
            </span>
            <span class="ctl"><em>数值标签</em><el-switch v-model="s.showLabel" size="small" /></span>
          </div>
        </div>
      </div>
    </div>

    <div class="f-sec">
      <div class="f-title">坐标轴与布局</div>
      <div class="ctl-row">
        <span class="ctl"><em>左轴刻度</em>
          <el-select v-model="model.leftAxis.format" size="small" class="w104">
            <el-option v-for="(lab, key) in FORMAT_LABELS" :key="key" :value="key" :label="lab" />
          </el-select>
        </span>
        <span class="ctl"><em>右轴</em>
          <el-switch :model-value="!!model.rightAxis" size="small" active-text="显示" inline-prompt @update:model-value="toggleRight" />
        </span>
        <span v-if="model.rightAxis" class="ctl"><em>右轴刻度</em>
          <el-select v-model="model.rightAxis.format" size="small" class="w104">
            <el-option v-for="(lab, key) in FORMAT_LABELS" :key="key" :value="key" :label="lab" />
          </el-select>
        </span>
        <span class="ctl"><em>横向条形</em><el-switch v-model="model.horizontal" size="small" /></span>
      </div>
      <div class="ctl-row" style="margin-top:10px">
        <span class="ctl"><em>柱堆叠</em>
          <el-radio-group v-model="model.stack" size="small">
            <el-radio-button value="none">不堆叠</el-radio-button>
            <el-radio-button value="normal">堆叠</el-radio-button>
            <el-radio-button value="percent">百分比</el-radio-button>
          </el-radio-group>
        </span>
        <span class="ctl"><em>年/季切换</em><el-switch v-model="model.yearQuarter" size="small" active-text="按季度填" inline-prompt /></span>
        <span v-if="model.yearQuarter" class="ctl"><em>年度口径</em>
          <el-select v-model="model.annualMode" size="small" class="w130">
            <el-option value="ending" label="年末值（余额/率）" />
            <el-option value="sum" label="四季度合计（发生额）" />
          </el-select>
        </span>
      </div>
      <p v-if="model.yearQuarter" class="hint">数据按季度填（如 2025Q1），右上角自动出年度/季度切换；年度视图按所选口径聚合，残年不进年度视图。</p>
    </div>

    <div class="f-sec grow">
      <div class="f-title">
        数据
        <span class="f-hint">{{ model.yearQuarter ? '一行一个季度' : '一行一个类目' }}</span>
        <el-button size="small" text type="primary" @click="addRow">+ 添加类目</el-button>
      </div>
      <div class="data-card">
        <table class="dtable">
          <thead>
            <tr>
              <th class="col-cat">类目</th>
              <th v-for="(s, i) in model.series" :key="i">
                <i class="dot" :style="{ background: s.color }"></i>{{ s.short || s.name }}
              </th>
              <th class="op"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(cat, r) in model.categories" :key="r">
              <td><input v-model="model.categories[r]" class="cell cat wide" spellcheck="false" /></td>
              <td v-for="(s, c) in model.series" :key="c">
                <input v-model.number="s.values[r]" type="number" class="cell num"
                  :placeholder="s.axis === 'right' && model.rightAxis?.format === 'percent' ? '%' : ''" />
              </td>
              <td class="op"><button class="row-del" title="删除此行" @click="removeRow(r)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FORMAT_LABELS, nextColor, type CartesianCfg, type AxisFormat } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<CartesianCfg>({ required: true })

function addSeries() {
  const i = model.value.series.length
  model.value.series.push({
    name: '指标' + (i + 1), type: 'line', axis: 'left',
    color: nextColor(i), showLabel: false,
    values: model.value.categories.map(() => 0),
  })
}
function removeSeries(i: number) {
  model.value.series.splice(i, 1)
}
function toggleRight(on: string | number | boolean) {
  model.value.rightAxis = on ? { format: 'percent' as AxisFormat } : null
  if (!on) { model.value.series.forEach((s) => { if (s.axis === 'right') { s.axis = 'left' } }) }
}
function addRow() {
  const last = model.value.categories[model.value.categories.length - 1] || ''
  model.value.categories.push(last ? last + '-新' : '新类目')
  model.value.series.forEach((s) => s.values.push(0))
}
function removeRow(r: number) {
  model.value.categories.splice(r, 1)
  model.value.series.forEach((s) => s.values.splice(r, 1))
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.cart-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px;
  &.grow { flex: 1; } }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.f-hint { font-size: 11px; font-weight: 400; color: #a9b0bc; margin-left: auto; }
.series-list { display: flex; flex-direction: column; gap: 8px; }
.col-cat { width: 110px; }
.w130 { width: 132px; }
</style>
