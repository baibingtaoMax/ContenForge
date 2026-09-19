<template>
  <div class="hm-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec grow">
      <div class="f-title">
        矩阵数据
        <span class="ctl" style="margin-left:auto"><em>格内数值</em><el-switch v-model="model.showLabel" size="small" /></span>
      </div>
      <p class="hint">列 = 横向类目（默认 12 个月），行 = 纵向分类；颜色深浅自动按最小/最大值映射。</p>
      <div class="col-bar">
        <el-button size="small" @click="addCol">+ 添加列</el-button>
        <el-button size="small" @click="addRow">+ 添加行</el-button>
      </div>
      <div class="data-card matrix-card">
        <table class="dtable">
          <thead>
            <tr>
              <th class="col-rowname">分类 ＼ 列</th>
              <th v-for="(c, ci) in model.cols" :key="ci">
                <input v-model="model.cols[ci]" class="cell cat" spellcheck="false" />
              </th>
              <th class="op"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, ri) in model.rows" :key="ri">
              <td><input v-model="r.name" class="cell cat wide" spellcheck="false" /></td>
              <td v-for="(c, ci) in model.cols" :key="ci">
                <input v-model.number="r.values[ci]" type="number" class="cell num" />
              </td>
              <td class="op"><button class="row-del" title="删除行" @click="removeRow(ri)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button class="add-line" @click="removeCol">删除最后一列（{{ model.cols.length }} 列）</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HeatmapCfg } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<HeatmapCfg>({ required: true })

function addCol() {
  model.value.cols.push('新列')
  model.value.rows.forEach((r) => r.values.push(0))
}
function removeCol() {
  if (model.value.cols.length <= 1) { return }
  model.value.cols.pop()
  model.value.rows.forEach((r) => r.values.pop())
}
function addRow() {
  model.value.rows.push({ name: '新分类', values: model.value.cols.map(() => 0) })
}
function removeRow(ri: number) {
  model.value.rows.splice(ri, 1)
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.hm-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; &.grow { flex: 1; } }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.col-bar { display: flex; gap: 8px; }
.matrix-card { max-height: none; }
.col-rowname { min-width: 110px; text-align: left !important; padding-left: 10px !important; }
</style>
