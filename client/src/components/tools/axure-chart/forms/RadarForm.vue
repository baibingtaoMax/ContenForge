<template>
  <div class="rd-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec">
      <div class="f-title">
        对比实体（{{ model.entities.length }}）
        <el-button size="small" text type="primary" @click="addEntity">+ 添加实体</el-button>
      </div>
      <div class="entity-list">
        <div v-for="(e, i) in model.entities" :key="i" class="entity-card">
          <el-color-picker v-model="e.color" size="small" class="sc-color" />
          <el-input v-model="e.name" size="small" class="e-name" placeholder="实体名称" />
          <span class="ctl"><em>半透明填充</em><el-switch v-model="e.fill" size="small" /></span>
          <button class="row-del" title="删除实体" :disabled="model.entities.length <= 1" @click="removeEntity(i)">×</button>
        </div>
      </div>
    </div>

    <div class="f-sec grow">
      <div class="f-title">
        评分维度（{{ model.dimensions.length }}）
        <el-button size="small" text type="primary" @click="addDim">+ 添加维度</el-button>
        <span class="ctl" style="margin-left:auto"><em>统一上限</em>
          <el-input-number v-model="model.max" :controls="false" :min="0" size="small" placeholder="自动" class="max-in" />
        </span>
      </div>
      <p class="hint">上限留 0 则按数据自动取整。</p>
      <div class="data-card">
        <table class="dtable">
          <thead>
            <tr>
              <th class="col-dim">维度</th>
              <th v-for="(e, i) in model.entities" :key="i"><i class="dot" :style="{ background: e.color }"></i>{{ e.name }}</th>
              <th class="op"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(d, r) in model.dimensions" :key="r">
              <td><input v-model="model.dimensions[r]" class="cell cat wide" spellcheck="false" /></td>
              <td v-for="(e, c) in model.entities" :key="c">
                <input v-model.number="e.values[r]" type="number" class="cell num" />
              </td>
              <td class="op"><button class="row-del" title="删除维度" @click="removeDim(r)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextColor, type RadarCfg } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<RadarCfg>({ required: true })

function addEntity() {
  const i = model.value.entities.length
  model.value.entities.push({ name: '企业' + String.fromCharCode(65 + i), color: nextColor(i), fill: i === 0, values: model.value.dimensions.map(() => 0) })
}
function removeEntity(i: number) {
  model.value.entities.splice(i, 1)
}
function addDim() {
  model.value.dimensions.push('维度' + (model.value.dimensions.length + 1))
  model.value.entities.forEach((e) => e.values.push(0))
}
function removeDim(r: number) {
  model.value.dimensions.splice(r, 1)
  model.value.entities.forEach((e) => e.values.splice(r, 1))
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.rd-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; &.grow { flex: 1; } }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.entity-list { display: flex; flex-direction: column; gap: 8px; }
.entity-card { display: flex; align-items: center; gap: 10px; border: 1px solid #eef0f4; border-radius: 8px; padding: 8px; background: #fcfcfd; }
.e-name { flex: 1; min-width: 0; }
.sc-color { flex: 0 0 auto; :deep(.el-color-picker__trigger) { width: 26px; height: 26px; } }
.col-dim { width: 130px; }
.max-in { width: 84px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
</style>
