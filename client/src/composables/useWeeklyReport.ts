// ============================================
// 周报生成任务：模块级单例，跨组件卸载存活
// 弹窗关掉、甚至切 tab 卸载面板，任务继续跑；
// 完成时没有弹窗在前台 → 右下角常驻通知，带下载按钮。
// ============================================

import { ref, h } from 'vue'
import { ElNotification, ElButton, ElMessage } from 'element-plus'
import {
  generateWeeklyReport,
  type WeeklyAudience,
  type WeeklyReportData,
} from '@/api'
import { downloadWeeklyMarkdown, exportWeeklyPdf } from '@/utils/weeklyExport'

export interface WeeklyJobParams {
  projectId: string
  from: string
  to: string
  audience: WeeklyAudience
}

const generating = ref(false)
const report = ref<WeeklyReportData | null>(null)
const runningParams = ref<WeeklyJobParams | null>(null)

// 弹窗现场也放模块级：切 tab 卸载面板后重开仍是原参数/成品
const audience = ref<WeeklyAudience>('boss')
const quick = ref<'week' | 'lastweek' | 'custom'>('lastweek')
const dateRange = ref<[string, string] | null>(null)

/** 弹窗是否在前台（挂载/打开时置 true，关闭/卸载置 false） */
let uiOpen = false
export function setWeeklyUiOpen(v: boolean) {
  uiOpen = v
}

function fireReadyNotification(data: WeeklyReportData) {
  const n = ElNotification({
    title: '需求变更周报已生成',
    position: 'bottom-right',
    duration: 0,
    message: () =>
      h('div', { class: 'weekly-notify' }, [
        h(
          'p',
          { class: 'wn-text' },
          `${data.projectName} · ${data.overviewError ? '纯清单版（AI 综述暂不可用）' : '含 AI 综述'}`
        ),
        h('div', { class: 'wn-btns' }, [
          h(
            ElButton,
            {
              size: 'small',
              onClick: () => {
                downloadWeeklyMarkdown(data)
                n.close()
              },
            },
            () => '下载 Markdown'
          ),
          h(
            ElButton,
            {
              size: 'small',
              type: 'success',
              onClick: async () => {
                try {
                  await exportWeeklyPdf(data)
                  n.close()
                } catch (e) {
                  ElMessage.error((e as Error).message || 'PDF 生成失败')
                }
              },
            },
            () => '下载 PDF'
          ),
        ]),
      ]),
  })
}

/** 启动（或复用）生成任务。同参数任务进行中不重复发。 */
export function startWeeklyJob(params: WeeklyJobParams): void {
  if (generating.value) return
  generating.value = true
  report.value = null
  runningParams.value = params

  void (async () => {
    try {
      const data = await generateWeeklyReport(params.projectId, {
        from: params.from,
        to: params.to,
        audience: params.audience,
      })
      report.value = data
      if (uiOpen) {
        if (data.overviewError) ElMessage.warning('AI 综述暂不可用，已生成纯清单版，可直接下载')
        else ElMessage.success('周报已生成，选择格式下载')
      } else {
        // 弹窗已关 / 面板已卸载 → 常驻通知取回
        fireReadyNotification(data)
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '周报生成失败'
      if (uiOpen) ElMessage.error(msg)
      else ElNotification.error({ title: '周报生成失败', message: msg, position: 'bottom-right' })
    } finally {
      generating.value = false
    }
  })()
}

export function useWeeklyReport() {
  return {
    generating,
    report,
    runningParams,
    audience,
    quick,
    dateRange,
    resetDialogState() {
      audience.value = 'boss'
      quick.value = 'lastweek'
      report.value = null
      pickDefaultRange()
    },
    start: startWeeklyJob,
  }
}

/** 默认区间：上周一 ~ 周日（本地时区） */
function pickDefaultRange() {
  const now = new Date()
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (((now.getDay() + 6) % 7) + 7))
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  dateRange.value = [fmt(mon), fmt(sun)]
}
function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
