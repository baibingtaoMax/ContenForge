<template>
  <div class="sc-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec">
      <div class="f-title">坐标轴</div>
      <div class="axis-grid">
        <label class="field">
          <span>横轴含义</span>
          <el-input v-model="model.xName" size="small" placeholder="如 担保规模（万元）" />
        </label>
        <label class="field">
          <span>纵轴含义</span>
          <el-input v-model="model.yName" size="small" placeholder="如 代偿率（%）" />
        </label>
        <span class="ctl bubble-ctl"><em>气泡模式</em><el-switch v-model="model.bubble" size="small" active-text="点大小带第三指标" inline-prompt /></span>
        <span class="ctl"><em>横轴刻度</em>
          <el-select v-model="model.xAxisFmt" size="small" class="fmt-sel">
            <el-option v-for="(lab, key) in FORMAT_LABELS" :key="'x' + key" :value="key" :label="lab" />
          </el-select>
        </span>
        <span class="ctl"><em>纵轴刻度</em>
          <el-select v-model="model.yAxisFmt" size="small" class="fmt-sel">
            <el-option v-for="(lab, key) in FORMAT_LABELS" :key="'y' + key" :value="key" :label="lab" />
          </el-select>
        </span>
      </div>
    </div>

    <div class="f-sec grow">
      <div class="f-title">
        分组与数据点
        <el-button size="small" text type="primary" @click="addGroup">+ 添加分组</el-button>
      </div>
      <div v-for="(g, gi) in model.groups" :key="gi" class="group-block">
        <div class="group-head">
          <el-color-picker v-model="g.color" size="small" class="sc-color" />
          <el-input v-model="g.name" size="small" class="g-name" placeholder="分组名称" />
          <el-button size="small" text type="primary" @click="addPoint(gi)">+ 添加点</el-button>
          <button class="row-del" title="删除分组" :disabled="model.groups.length <= 1" @click="model.groups.splice(gi, 1)">×</button>
        </div>
        <div class="data-card">
          <table class="dtable">
            <thead>
              <tr><th class="col-pname">点名称</th><th>X 值</th><th>Y 值</th><th v-if="model.bubble">大小值</th><th class="op"></th></tr>
            </thead>
            <tbody>
              <tr v-for="(p, pi) in g.points" :key="pi">
                <td><input v-model="p.name" class="cell cat wide" spellcheck="false" /></td>
                <td><input v-model.number="p.x" type="number" class="cell num" /></td>
                <td><input v-model.number="p.y" type="number" class="cell num" /></td>
                <td v-if="model.bubble"><input v-model.number="p.size" type="number" class="cell num" /></td>
                <td class="op"><button class="row-del" title="删除点" @click="g.points.splice(pi, 1)">×</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FORMAT_LABELS, nextColor, type ScatterCfg } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<ScatterCfg>({ required: true })

function addGroup() {
  const i = model.value.groups.length
  model.value.groups.push({ name: '分组' + (i + 1), color: nextColor(i), points: [] })
}
function addPoint(gi: number) {
  model.value.groups[gi].points.push({ name: '企业', x: 0, y: 0, size: 10 })
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.sc-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; &.grow { flex: 1; } }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.axis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: end; }
.fmt-sel { width: 132px; }
.bubble-ctl { padding-bottom: 6px; }
.group-block { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.group-head { display: flex; align-items: center; gap: 8px; }
.g-name { width: 180px; flex: 0 0 auto; }
.sc-color { flex: 0 0 auto; :deep(.el-color-picker__trigger) { width: 26px; height: 26px; } }
.col-pname { min-width: 120px; }
</style>
