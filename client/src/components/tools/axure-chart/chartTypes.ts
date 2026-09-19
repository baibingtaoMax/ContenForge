/**
 * Axure 图表生成器 —— 类型与配色层（v3：10 族 22 图型）
 *
 * 向导配置是按族区分的判别联合（family 字段）；每族一套傻瓜表单。
 * 只放业务字段（名称/数值/颜色/单位/标签开关），不放 ECharts 技术参数。
 */

export type Family =
  | 'cartesian'
  | 'waterfall'
  | 'pie'
  | 'funnel'
  | 'radar'
  | 'scatter'
  | 'gauge'
  | 'treemap'
  | 'heatmap'
  | 'sankey'

/** 所有族共有：Axure 元件名 + 左上单位 + 右上时段（可空） */
export interface WizardBase {
  label: string
  unitTag: string
  period: string
}

export type AxisFormat = 'number' | 'money' | 'percent'
export interface AxisCfg {
  format: AxisFormat
}

/* ---------------- 族 1：柱线（含横向、堆叠、双轴、年季切换） ---------------- */

export type SeriesType = 'bar' | 'line' | 'area'
export type AxisSide = 'left' | 'right'
/** 不堆叠 / 普通堆叠 / 百分比堆叠（对柱系列生效） */
export type StackMode = 'none' | 'normal' | 'percent'

export interface ChartSeries {
  name: string
  /** 图例简称（长科目名用，如 销售商品、提供劳务收到的现金 → 销售收现）；tooltip 仍用全称 */
  short?: string
  type: SeriesType
  axis: AxisSide
  color: string
  /** 柱顶/线上是否显示数值 */
  showLabel: boolean
  values: number[]
}

export interface CartesianCfg extends WizardBase {
  family: 'cartesian'
  categories: string[]
  series: ChartSeries[]
  leftAxis: AxisCfg
  rightAxis: AxisCfg | null
  /** 年/季切换：数据按季度填，右上角出年度/季度切换 */
  yearQuarter: boolean
  /** 年度聚合：ending=每年末季度值（时点类）／sum=四季度合计（流量类） */
  annualMode: 'ending' | 'sum'
  /** 横向条形图 */
  horizontal: boolean
  stack: StackMode
}

/* ---------------- 族 2：瀑布 ---------------- */

export type WfKind = 'start' | 'add' | 'sub' | 'total'
export interface WfRow {
  name: string
  kind: WfKind
  /** 增/减行填变化量（正数）；起点/合计行填绝对值；合计可留 0 由运行时自动算 */
  value: number
}
export interface WaterfallCfg extends WizardBase {
  family: 'waterfall'
  rows: WfRow[]
  showLabel: boolean
}

/* ---------------- 族 3：饼 / 环 / 玫瑰 / 嵌套双饼 ---------------- */

export type PieVariant = 'pie' | 'donut' | 'rose' | 'nested'
export interface PieItem {
  name: string
  value: number
  color?: string
  /** nested 变体：该外环项归属的内环分组名 */
  parent?: string
}
export interface PieCfg extends WizardBase {
  family: 'pie'
  variant: PieVariant
  items: PieItem[]
  /** 环形中心标题（默认「合计」）；中心数值自动汇总 */
  centerTitle: string
  showLabel: boolean
}

/* ---------------- 族 4：漏斗 ---------------- */

export interface FunnelStage {
  name: string
  value: number
}
export interface FunnelCfg extends WizardBase {
  family: 'funnel'
  stages: FunnelStage[]
  /** 标签附带「相对上阶段转化率」 */
  showRate: boolean
}

/* ---------------- 族 5：雷达 ---------------- */

export interface RadarEntity {
  name: string
  color: string
  values: number[]
  /** 是否半透明填充 */
  fill: boolean
}
export interface RadarCfg extends WizardBase {
  family: 'radar'
  dimensions: string[]
  entities: RadarEntity[]
  /** 统一轴上限；null = 自动取数据最大值向上取整 */
  max: number | null
}

/* ---------------- 族 6：散点 / 气泡 ---------------- */

export interface ScatterPoint {
  name: string
  x: number
  y: number
  /** bubble=true 时决定气泡大小 */
  size: number
}
export interface ScatterGroup {
  name: string
  color: string
  points: ScatterPoint[]
}
export interface ScatterCfg extends WizardBase {
  family: 'scatter'
  bubble: boolean
  groups: ScatterGroup[]
  xName: string
  yName: string
  xAxisFmt: AxisFormat
  yAxisFmt: AxisFormat
}

/* ---------------- 族 7：仪表盘 ---------------- */

export interface GaugeSeg {
  /** 段上限（最后一段应等于 max） */
  to: number
  color: string
  name: string
}
export interface GaugeCfg extends WizardBase {
  family: 'gauge'
  value: number
  unit: string
  min: number
  max: number
  decimals: number
  segs: GaugeSeg[]
}

/* ---------------- 族 8：矩形树图 ---------------- */

export interface TreeItem {
  name: string
  value: number
  parent: string
}
export interface TreemapCfg extends WizardBase {
  family: 'treemap'
  items: TreeItem[]
}

/* ---------------- 族 9：热力图 ---------------- */

export interface HeatRow {
  name: string
  values: number[]
}
export interface HeatmapCfg extends WizardBase {
  family: 'heatmap'
  cols: string[]
  rows: HeatRow[]
  showLabel: boolean
}

/* ---------------- 族 10：桑基 ---------------- */

export interface SankeyLink {
  source: string
  target: string
  value: number
}
export interface SankeyCfg extends WizardBase {
  family: 'sankey'
  nodes: string[]
  links: SankeyLink[]
}

/* ---------------- 向导配置联合 ---------------- */

export type WizardCfg =
  | CartesianCfg
  | WaterfallCfg
  | PieCfg
  | FunnelCfg
  | RadarCfg
  | ScatterCfg
  | GaugeCfg
  | TreemapCfg
  | HeatmapCfg
  | SankeyCfg

/* ---------------- 自定义 option 模式（不变） ---------------- */

export interface CustomChartConfig {
  label: string
  /** ECharts option 的 JS 对象字面量源码，或官网示例风格完整脚本 */
  source: string
}

/* ---------------- 配色 ---------------- */

export const PALETTE = {
  blue: '#2b5cff',
  deepBlue: '#1e3fd4',
  teal: '#19c4c4',
  orange: '#ff8f1f',
  lightBlue: '#aecbff',
  purple: '#7c5cff',
  green: '#18a058',
  red: '#f53f3f',
  yellow: '#f7ba1e',
  sky: '#5aa7ff',
}

/** 多系列/饼图自动取色序列（循环），10 色和谐财务色板 */
export const AUTO_COLORS = [
  PALETTE.blue, PALETTE.teal, PALETTE.orange, PALETTE.purple,
  PALETTE.green, PALETTE.yellow, PALETTE.red, PALETTE.lightBlue,
  PALETTE.deepBlue, PALETTE.sky,
]

export function nextColor(existingCount: number): string {
  return AUTO_COLORS[existingCount % AUTO_COLORS.length]
}

export const FORMAT_LABELS: Record<AxisFormat, string> = {
  number: '数值（千分位）',
  money: '大额简写（亿）',
  percent: '百分比（%）',
}

/* ---------------- v2 → v3 迁移 ---------------- */

/**
 * 旧版（v2）配置没有 family/horizontal/stack/annualMode，
 * 读 localStorage 时补成 cartesian 族，用户数据不丢。
 */
export function migrateWizardCfg(raw: unknown): WizardCfg | null {
  if (!raw || typeof raw !== 'object') { return null }
  const r = raw as Record<string, unknown>
  if (typeof r.family === 'string') { return raw as WizardCfg }
  if (!Array.isArray(r.series)) { return null }
  return {
    family: 'cartesian',
    label: String(r.label ?? 'chart_new'),
    unitTag: String(r.unitTag ?? ''),
    period: String(r.period ?? ''),
    categories: Array.isArray(r.categories) ? r.categories.map(String) : [],
    series: r.series as ChartSeries[],
    leftAxis: (r.leftAxis as AxisCfg) ?? { format: 'number' },
    rightAxis: (r.rightAxis as AxisCfg | null) ?? null,
    yearQuarter: Boolean(r.yearQuarter),
    annualMode: 'ending',
    horizontal: false,
    stack: 'none',
  }
}
