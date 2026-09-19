<template>
  <div class="tm-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec grow">
      <div class="f-title">
        子项数据（两级：板块 → 子项）
        <el-button size="small" text type="primary" @click="addItem">+ 添加一项</el-button>
      </div>
      <p class="hint">「所属板块」相同的子项自动聚成一组，颜色按板块分配。</p>
      <div class="data-card">
        <table class="dtable">
          <thead>
            <tr><th class="col-child">子项名称</th><th class="col-parent">所属板块</th><th>数值（万元）</th><th class="op"></th></tr>
          </thead>
          <tbody>
            <tr v-for="(it, i) in model.items" :key="i">
              <td><input v-model="it.name" class="cell cat wide" spellcheck="false" /></td>
              <td>
                <el-input v-model="it.parent" size="small" list="pf-tm-parents" placeholder="板块名" class="parent-in" />
                <datalist id="pf-tm-parents">
                  <option v-for="p in parents" :key="p" :value="p" />
                </datalist>
              </td>
              <td><input v-model.number="it.value" type="number" class="cell num" /></td>
              <td class="op"><button class="row-del" title="删除" @click="model.items.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TreemapCfg } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<TreemapCfg>({ required: true })

const parents = computed(() => {
  const set = new Set<string>()
  model.value.items.forEach((it) => { if (it.parent) { set.add(it.parent) } })
  return [...set]
})
function addItem() {
  model.value.items.push({ name: '新子项', value: 0, parent: parents.value[0] || '' })
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.tm-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; &.grow { flex: 1; } }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.col-child { width: 40%; text-align: left !important; padding-left: 10px !important; }
.col-parent { width: 150px; }
.parent-in { width: 138px; }
</style>
