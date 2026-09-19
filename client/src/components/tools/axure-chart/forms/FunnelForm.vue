<template>
  <div class="fn-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec">
      <div class="f-title">
        阶段
        <el-button size="small" text type="primary" @click="addStage">+ 添加阶段</el-button>
      </div>
      <p class="hint">按业务从上到下排列（提交申请 → … → 放款），渲染时按数值自动排序成漏斗。</p>
      <div v-if="!decreasing" class="warn">数值没有逐阶段递减——漏斗通常越来越窄，确认下数据顺序。</div>
      <div class="data-card">
        <table class="dtable">
          <thead>
            <tr><th class="col-idx">#</th><th class="col-name" style="text-align:left;padding-left:10px">阶段名称</th><th>数量</th><th class="op"></th></tr>
          </thead>
          <tbody>
            <tr v-for="(st, i) in model.stages" :key="i">
              <td class="op" style="color:#a9b0bc">{{ i + 1 }}</td>
              <td><input v-model="st.name" class="cell cat wide" spellcheck="false" /></td>
              <td><input v-model.number="st.value" type="number" class="cell num" min="0" /></td>
              <td class="op"><button class="row-del" title="删除" @click="model.stages.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <span class="ctl" style="margin-top:8px"><em>阶段标签带转化率</em><el-switch v-model="model.showRate" size="small" /></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { FunnelCfg } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<FunnelCfg>({ required: true })

const decreasing = computed(() =>
  model.value.stages.every((st, i) => i === 0 || Number(st.value) <= Number(model.value.stages[i - 1].value)),
)

function addStage() {
  model.value.stages.push({ name: '新阶段', value: 0 })
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.fn-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.col-idx { width: 36px; }
</style>
