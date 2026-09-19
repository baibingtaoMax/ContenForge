<template>
  <div class="sk-form">
    <div class="f-sec">
      <div class="f-title">图表信息</div>
      <BaseMeta :model="model" />
    </div>

    <div class="f-sec">
      <div class="f-title">
        节点
        <el-button size="small" text type="primary" @click="addNode">+ 添加节点</el-button>
      </div>
      <div class="node-chips">
        <span v-for="(n, i) in model.nodes" :key="i" class="node-chip">
          {{ n }}
          <button title="删除节点" @click="removeNode(i)">×</button>
        </span>
      </div>
      <p v-if="orphanLinks.length" class="warn">有边引用了不存在的节点：{{ orphanLinks }}</p>
    </div>

    <div class="f-sec grow">
      <div class="f-title">
        流向边
        <el-button size="small" text type="primary" @click="addLink">+ 添加一条边</el-button>
      </div>
      <p class="hint">按资金方向填：来源 → 目标，如 银行授信 → 工程担保。节点名要与上面一致。</p>
      <div class="data-card">
        <table class="dtable">
          <thead>
            <tr><th class="col-from">来源</th><th></th><th class="col-to">目标</th><th>数值（万元）</th><th class="op"></th></tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in model.links" :key="i">
              <td>
                <el-select v-model="l.source" size="small" filterable class="node-sel" placeholder="选节点">
                  <el-option v-for="n in model.nodes" :key="'s' + n" :value="n" :label="n" />
                </el-select>
              </td>
              <td style="color:#a9b0bc;text-align:center">→</td>
              <td>
                <el-select v-model="l.target" size="small" filterable class="node-sel" placeholder="选节点">
                  <el-option v-for="n in model.nodes" :key="'t' + n" :value="n" :label="n" />
                </el-select>
              </td>
              <td><input v-model.number="l.value" type="number" class="cell num" min="0" /></td>
              <td class="op"><button class="row-del" title="删除边" @click="model.links.splice(i, 1)">×</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SankeyCfg } from '../chartTypes'
import BaseMeta from './BaseMeta.vue'
import './shared.scss'

const model = defineModel<SankeyCfg>({ required: true })

const orphanLinks = computed(() => {
  const bad: string[] = []
  model.value.links.forEach((l) => {
    if (!model.value.nodes.includes(l.source)) { bad.push(l.source || '(空)') }
    if (!model.value.nodes.includes(l.target)) { bad.push(l.target || '(空)') }
  })
  return [...new Set(bad)].join('、')
})

function addNode() {
  let n = '新节点'
  let i = 1
  while (model.value.nodes.includes(n)) { n = '新节点' + (++i) }
  model.value.nodes.push(n)
}
function removeNode(i: number) {
  const n = model.value.nodes[i]
  model.value.nodes.splice(i, 1)
  model.value.links = model.value.links.filter((l) => l.source !== n && l.target !== n)
}
function addLink() {
  const first = model.value.nodes[0] || ''
  const second = model.value.nodes[1] || first
  model.value.links.push({ source: first, target: second, value: 0 })
}
</script>

<style scoped lang="scss">
@use './shared.scss';
.sk-form { display: flex; flex-direction: column; gap: 14px; }
.f-sec { display: flex; flex-direction: column; gap: 8px; &.grow { flex: 1; } }
.f-title { font-size: 13px; font-weight: 600; color: #1d2129; display: flex; align-items: center; gap: 10px; }
.node-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.node-chip {
  display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #4e5969;
  background: #f2f4f8; border: 1px solid #e5e8ef; border-radius: 999px; padding: 2px 8px 2px 10px;
  button { border: 0; background: none; color: #a9b0bc; cursor: pointer; font-size: 13px; line-height: 1; padding: 0;
    &:hover { color: #f56c6c; } }
}
.col-from, .col-to { width: 38%; }
.node-sel { width: 100%; }
</style>
