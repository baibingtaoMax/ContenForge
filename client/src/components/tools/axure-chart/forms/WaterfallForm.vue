<template>
  <div class="wf-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec">
      <div class="f-title">
        构成项
        <el-button size="small" text type="primary" @click="addRow">+ 添加一项</el-button>
      </div>
      <p class="hint">顺序即瀑布走向：起点（绝对值）→ 各项增/减（变化量，正数）→ 合计（值留 0 自动算）。</p>
      <div class="data-card">
        <table class="dtable">
          <thead>
            <tr><th class="col-name">项目名称</th><th class="col-kind">类型</th><th>数值（万元）</th><th class="op"></th></tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in model.rows" :key="i">
              <td><input v-model="r.name" class="cell cat wide" spellcheck="false" /></td>
              <td>
                <el-select v-model="r.kind" size="small" class="kind-sel">
                  <el-option value="start" label="起点" />
                  <el-option value="add" label="增加" />
                  <el-option value="sub" label="减少" />
                  <el-option value="total" label="合计" />
                </el-select>
              </td>
              <td>
                <input v-model.number="r.value" type="number" class="cell num"
                  :placeholder="r.kind === 'total' ? '0=自动' : ''" :disabled="r.kind === 'total'" />
              </td>
              <td class="op"><button class="row-del" title="删除" @click="model.rows.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <span class="ctl" style="margin-top:8px"><em>数值标签</em><el-switch v-model="model.showLabel" size="small" /></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WaterfallCfg, WfKind } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<WaterfallCfg>({ required: true })

function addRow() {
  const kinds = model.value.rows.map((r) => r.kind)
  const kind: WfKind = !kinds.includes('start') ? 'start' : 'add'
  model.value.rows.push({ name: kind === 'start' ? '期初值' : '新增项', kind, value: 0 })
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.wf-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.col-name { width: 46%; text-align: left !important; padding-left: 10px !important; }
.col-kind { width: 110px; }
.kind-sel { width: 96px; }
:deep(.kind-sel .el-select__wrapper) { padding: 0 8px; }
</style>
