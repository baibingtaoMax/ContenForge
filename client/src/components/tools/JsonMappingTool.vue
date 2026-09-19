<template>
  <div class="jm-tool">
    <!-- 工具条 -->
    <div class="tool-bar">
      <div class="bar-left">
        <template v-if="result.ok">
          <span class="stat">共 <b>{{ result.stats.total }}</b> 个字段</span>
          <span class="stat ok">已配 <b>{{ result.stats.configured }}</b></span>
          <span class="stat" :class="{ miss: result.stats.missing > 0 }">未配 <b>{{ result.stats.missing }}</b></span>
          <el-divider direction="vertical" />
          <el-checkbox v-model="onlyMissing" size="small" :disabled="!result.stats.missing">只看未配置</el-checkbox>
        </template>
        <span v-else-if="!jsonRaw.trim()" class="bar-tip">左边粘 JSON 和字段映射表，右边自动出对照</span>
      </div>
      <div class="bar-right">
        <el-button size="small" :disabled="!result.ok" @click="exportTsv">
          <AppIcon name="copy" :size="13" /> 复制表格（可粘 Excel）
        </el-button>
        <el-button size="small" @click="loadSample">示例</el-button>
        <el-button size="small" :disabled="!jsonRaw && !mapRaw" @click="clearAll">清空</el-button>
      </div>
    </div>

    <div class="jm-grid">
      <!-- 左：两个输入 -->
      <div class="input-col">
        <div class="col-label">JSON 数据</div>
        <textarea
          v-model="jsonRaw"
          class="code-area"
          spellcheck="false"
          placeholder='粘接口返回 / mock 数据&#10;{"cust_name":"张三", ...}'
        ></textarea>
        <div class="col-label gap map-label">
          <span>字段映射表（key → 中文名）</span>
          <el-radio-group v-model="mapMode" size="small" class="mode-switch">
            <el-radio-button value="mixed">整段粘贴</el-radio-button>
            <el-radio-button value="columns">左右分栏</el-radio-button>
          </el-radio-group>
        </div>

        <!-- 混合模式：一个框，JSON/两列文本/Excel 都认 -->
        <textarea
          v-if="mapMode === 'mixed'"
          v-model="mapRaw"
          class="code-area map-area"
          spellcheck="false"
          placeholder="三种写法都认：&#10;1) JSON：{&quot;cust_name&quot;:&quot;客户名称&quot;}&#10;2) 从 Excel 复制两列（Tab 分隔）&#10;3) cust_name,客户名称 或 cust_name:客户名称"
        ></textarea>

        <!-- 分栏模式：左 key 右中文名，按行一一对应 -->
        <div v-else class="map-columns">
          <textarea
            v-model="keysRaw"
            class="code-area"
            spellcheck="false"
            placeholder="每行一个 key&#10;cust_name&#10;credit_code&#10;guar_amt_wan"
          ></textarea>
          <textarea
            v-model="namesRaw"
            class="code-area"
            spellcheck="false"
            placeholder="每行一个中文名（与左侧同行对应）&#10;客户名称&#10;统一社会信用代码&#10;担保金额（万元）"
          ></textarea>
        </div>
        <div v-if="mapMode === 'columns'" class="col-hint" :class="{ mismatch: colMismatch }">
          左 {{ colParse.leftCount ?? 0 }} 行 · 右 {{ colParse.rightCount ?? 0 }} 行<span v-if="colMismatch"> · 行数不一致，只有同一行两侧都有内容才会配对</span>
        </div>
      </div>

      <!-- 右：对照结果 -->
      <div class="output-col">
        <div class="col-label">对照结果</div>
        <div v-if="!jsonRaw.trim()" class="state-pane">
          <el-icon :size="30"><Document /></el-icon>
          <p>粘入 JSON 后自动对照</p>
        </div>
        <div v-else-if="!result.ok" class="state-pane error">
          <div class="err-head"><el-icon :size="18"><WarningFilled /></el-icon><strong>JSON 格式有误</strong></div>
          <div v-if="result.errorLine" class="err-loc">第 {{ result.errorLine }} 行，第 {{ result.errorCol }} 列</div>
          <div class="err-msg">{{ result.error }}</div>
        </div>
        <JsonMappingTable v-else :rows="result.rows" :only-missing="onlyMissing" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Document, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import JsonMappingTable from './JsonMappingTable.vue'
import {
  buildMappingResult,
  buildMappingFromMap,
  parseMappingColumns,
  rowsToTsv,
} from '@/utils/jsonMapping'

const jsonRaw = ref('')
const mapRaw = ref('')
const keysRaw = ref('')
const namesRaw = ref('')
const mapMode = ref<'mixed' | 'columns'>('mixed')
const onlyMissing = ref(false)

const colParse = computed(() => parseMappingColumns(keysRaw.value, namesRaw.value))
const colMismatch = computed(() => {
  const l = colParse.value.leftCount ?? 0
  const r = colParse.value.rightCount ?? 0
  return l !== r && (l > 0 || r > 0)
})

const result = computed(() =>
  mapMode.value === 'columns'
    ? buildMappingFromMap(jsonRaw.value, colParse.value.map)
    : buildMappingResult(jsonRaw.value, mapRaw.value)
)

const SAMPLE_JSON = `{
  "cust_name": "石家庄示例科技有限公司",
  "credit_code": "91130100MA07X1234B",
  "guar_amt_wan": 500,
  "approve_status": "pending",
  "contact": {
    "person": "王经理",
    "phone": "13800138000",
    "internal_note": "老客户引荐"
  },
  "approve_records": [
    { "stage": "受理", "passed": true, "opinion": "材料齐全" },
    { "stage": "风控审查", "passed": null, "opinion": null }
  ],
  "created_at": "2026-09-12T10:30:00+08:00"
}`

const SAMPLE_MAP = `cust_name,客户名称
credit_code,统一社会信用代码
guar_amt_wan,担保金额（万元）
approve_status,审批状态
contact,联系人信息
person,联系人
phone,联系电话
approve_records,审批记录
stage,环节
passed,是否通过
opinion,审批意见
created_at,创建时间`

const SAMPLE_KEYS = `cust_name
credit_code
guar_amt_wan
approve_status
contact
person
phone
approve_records
stage
passed
opinion
created_at`

const SAMPLE_NAMES = `客户名称
统一社会信用代码
担保金额（万元）
审批状态
联系人信息
联系人
联系电话
审批记录
环节
是否通过
审批意见
创建时间`

function loadSample() {
  jsonRaw.value = SAMPLE_JSON
  mapRaw.value = SAMPLE_MAP
  keysRaw.value = SAMPLE_KEYS
  namesRaw.value = SAMPLE_NAMES
}
function clearAll() {
  jsonRaw.value = ''
  mapRaw.value = ''
  keysRaw.value = ''
  namesRaw.value = ''
  onlyMissing.value = false
}

async function exportTsv() {
  if (!result.value.ok) return
  const tsv = rowsToTsv(result.value.rows)
  try {
    await navigator.clipboard.writeText(tsv)
    ElMessage.success('已复制，可直接粘贴到 Excel')
  } catch {
    const ta = document.createElement('textarea')
    ta.value = tsv
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    ElMessage.success('已复制，可直接粘贴到 Excel')
  }
}
</script>

<style scoped lang="scss">
.jm-tool {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tool-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  .bar-left { display: flex; align-items: center; gap: 14px; }
  .bar-right { display: flex; gap: 8px; }
  .bar-tip { font-size: 12.5px; color: var(--pf-text-3); }
  .stat {
    font-size: 13px;
    color: var(--pf-text-2);
    b { color: var(--pf-text-1); font-weight: 700; margin-left: 2px; }
    &.ok b { color: #059669; }
    &.miss b { color: #d97706; }
  }
}
.jm-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 12px;
}
.input-col, .output-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.col-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--pf-text-2);
  padding: 0 2px 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  &.gap { padding-top: 12px; }
}
.map-columns {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  .code-area { flex: none; height: 100%; }
}
.col-hint {
  flex-shrink: 0;
  padding: 5px 2px 0;
  font-size: 11.5px;
  color: var(--pf-text-3);
  &.mismatch { color: #b45309; }
}
.code-area {
  flex: 1;
  min-height: 0;
  resize: none;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
  padding: 12px 14px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--pf-text-1);
  outline: none;
  transition: border-color .15s;
  &:focus { border-color: var(--pf-primary, #6366f1); box-shadow: 0 0 0 3px rgba(99,102,241,.12); }
  &::placeholder { color: var(--pf-text-3); font-family: var(--pf-font-sans, inherit); line-height: 1.7; }
}
.map-area { background: #fcfbf7; }
.state-pane {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--pf-text-3);
  p { margin: 0; font-size: 13px; }
  &.error {
    justify-content: flex-start;
    align-items: stretch;
    padding: 22px;
    background: #fef3f2;
    .err-head { display: flex; align-items: center; gap: 8px; color: #b42318; font-size: 15px; }
    .err-loc {
      margin-top: 10px;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 13px; font-weight: 700; color: #b42318;
      background: #fee4e2; border-radius: 6px; padding: 6px 10px; width: fit-content;
    }
    .err-msg { margin-top: 10px; font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; color: #7a271a; word-break: break-all; }
  }
}
</style>
