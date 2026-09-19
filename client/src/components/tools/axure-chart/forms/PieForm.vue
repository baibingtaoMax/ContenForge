<template>
  <div class="pie-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec">
      <div class="f-title">形态</div>
      <el-radio-group v-model="model.variant" size="small">
        <el-radio-button value="pie">饼图</el-radio-button>
        <el-radio-button value="donut">环形图</el-radio-button>
        <el-radio-button value="rose">南丁格尔玫瑰</el-radio-button>
        <el-radio-button value="nested">嵌套双饼</el-radio-button>
      </el-radio-group>
      <label v-if="model.variant === 'donut'" class="field center-title">
        <span>中心标题（数值自动汇总）</span>
        <el-input v-model="model.centerTitle" size="small" placeholder="合计" />
      </label>
      <span class="ctl"><em>引导线标签</em><el-switch v-model="model.showLabel" size="small" /></span>
    </div>

    <div class="f-sec grow">
      <div class="f-title">
        数据项
        <el-button size="small" text type="primary" @click="addItem">+ 添加一项</el-button>
      </div>
      <div class="data-card">
        <table class="dtable">
          <thead>
            <tr>
              <th class="col-color"></th>
              <th class="col-name" style="text-align:left;padding-left:10px">名称</th>
              <th v-if="model.variant === 'nested'" class="col-parent">归属内环</th>
              <th>数值</th>
              <th class="op"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(it, i) in model.items" :key="i">
              <td class="op"><el-color-picker v-model="it.color" size="small" class="cell-color" /></td>
              <td><input v-model="it.name" class="cell cat wide" spellcheck="false" /></td>
              <td v-if="model.variant === 'nested'">
                <el-input v-model="it.parent" size="small" list="pf-pie-parents" placeholder="内环分组" class="parent-in">
                  <datalist id="pf-pie-parents">
                    <option v-for="p in parents" :key="p" :value="p" />
                  </datalist>
                </el-input>
              </td>
              <td><input v-model.number="it.value" type="number" class="cell num" /></td>
              <td class="op"><button class="row-del" title="删除" @click="model.items.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="model.variant === 'nested'" class="hint">内环按「归属内环」自动聚合；外环每项填产品级名称和值。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { nextColor, type PieCfg } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<PieCfg>({ required: true })

const parents = computed(() => {
  const set = new Set<string>()
  model.value.items.forEach((it) => { if (it.parent) { set.add(it.parent) } })
  return [...set]
})

function addItem() {
  const i = model.value.items.length
  model.value.items.push({ name: '分项' + (i + 1), value: 0, color: nextColor(i), parent: parents.value[0] || '' })
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.pie-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; &.grow { flex: 1; } }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.center-title { max-width: 260px; }
.col-color { width: 40px; }
.col-parent { width: 130px; }
.cell-color { :deep(.el-color-picker__trigger) { width: 22px; height: 22px; } }
.parent-in { width: 118px; }
</style>
