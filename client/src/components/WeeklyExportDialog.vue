<template>
  <el-dialog v-model="visible" title="导出需求变更周报" width="520px" :before-close="onClose">
    <el-form label-width="84px" @submit.prevent>
      <el-form-item label="呈报对象">
        <el-radio-group v-model="audience" :disabled="generating" @change="report = null">
          <el-radio-button value="boss">给老板</el-radio-button>
          <el-radio-button value="client">给客户</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="时间范围">
        <div class="range-wrap">
          <div class="quick-row">
            <el-button size="small" :disabled="generating" :type="quick === 'week' ? 'primary' : ''" @click="pickQuick('week')">本周</el-button>
            <el-button size="small" :disabled="generating" :type="quick === 'lastweek' ? 'primary' : ''" @click="pickQuick('lastweek')">上周</el-button>
            <el-button size="small" :disabled="generating" :type="quick === 'custom' ? 'primary' : ''" @click="quick = 'custom'">自定义</el-button>
          </div>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            :clearable="false"
            :disabled="generating"
            class="range-picker"
            @change="quick = 'custom'"
          />
        </div>
      </el-form-item>

      <el-form-item label="说明">
        <div class="hint">
          周报统计<b>已存版本的有意变更</b>（新增 / 确认 / 打回 / 修订 / 转正 / 决策 / 原型意见），普通改错别字不计入。
          AI 只写开头综述，清单全部是系统事实；AI 不可用时自动导出纯清单版。
        </div>
      </el-form-item>
      <el-alert
        v-if="generating"
        type="info"
        :closable="false"
        show-icon
        title="撰写中，可以关掉这个窗口、或切去别的页面先忙，好了右下角通知你取。"
        class="bg-hint"
      />
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ generating ? '后台运行' : '取消' }}</el-button>
      <el-button
        type="primary"
        :loading="generating"
        :disabled="!dateRange || !dateRange[0] || !dateRange[1]"
        @click="onGenerate"
      >
        {{ generating ? 'AI 撰写综述中…' : '生成周报' }}
      </el-button>
      <template v-if="report">
        <el-button @click="onDownload('md')">下载 Markdown</el-button>
        <el-button type="success" :loading="pdfing" @click="onDownload('pdf')">下载 PDF</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { downloadWeeklyMarkdown, exportWeeklyPdf } from '@/utils/weeklyExport'
import { useWeeklyReport, setWeeklyUiOpen } from '@/composables/useWeeklyReport'

const props = defineProps<{ projectId: string }>()
const visible = defineModel<boolean>('modelValue', { default: false })

const { generating, report, audience, quick, dateRange, resetDialogState, start } =
  useWeeklyReport()
const pdfing = ref(false)

function pickQuick(q: 'week' | 'lastweek') {
  if (!dateRange.value) return
  quick.value = q
  const now = new Date()
  const thisMon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  const mon = q === 'week' ? thisMon : new Date(thisMon.getFullYear(), thisMon.getMonth(), thisMon.getDate() - 7)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  const p = (n: number) => String(n).padStart(2, '0')
  dateRange.value = [
    `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}`,
    `${sun.getFullYear()}-${p(sun.getMonth() + 1)}-${p(sun.getDate())}`,
  ]
}

// 打开：空闲无成品时恢复默认；生成中/已有成品则保留现场
watch(visible, (v) => {
  setWeeklyUiOpen(v)
  if (v && !generating.value && !report.value) {
    resetDialogState()
  }
})

onMounted(() => {
  if (visible.value) setWeeklyUiOpen(true)
  if (!dateRange.value && !generating.value && !report.value) resetDialogState()
})
onBeforeUnmount(() => setWeeklyUiOpen(false))

function onGenerate() {
  if (!dateRange.value) return
  start({
    projectId: props.projectId,
    from: `${dateRange.value[0]}T00:00:00+08:00`,
    to: `${dateRange.value[1]}T23:59:59.999+08:00`,
    audience: audience.value,
  })
}

async function onDownload(kind: 'md' | 'pdf') {
  if (!report.value) return
  if (kind === 'md') {
    downloadWeeklyMarkdown(report.value)
    return
  }
  pdfing.value = true
  try {
    await exportWeeklyPdf(report.value)
  } catch (e) {
    ElMessage.error((e as Error).message || 'PDF 生成失败')
  } finally {
    pdfing.value = false
  }
}

/** X / ESC / 遮罩：只隐藏，组件/任务都继续 */
function onClose(done: () => void) {
  visible.value = false
  done()
}
</script>

<style scoped lang="scss">
.range-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.quick-row {
  display: flex;
  gap: 8px;
}
.range-picker {
  width: 100%;
}
.hint {
  font-size: 11.5px;
  color: var(--pf-text-3);
  line-height: 1.7;
  b {
    color: var(--pf-text-2);
  }
}
.bg-hint {
  margin-left: 84px;
}
</style>

<style lang="scss">
// teleport 到 body，scoped 不生效
.weekly-notify {
  .wn-text {
    margin: 0 0 10px;
    font-size: 13px;
  }
  .wn-btns {
    display: flex;
    gap: 8px;
  }
}
</style>
