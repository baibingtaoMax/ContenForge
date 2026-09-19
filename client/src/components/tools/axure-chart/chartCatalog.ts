/**
 * Axure 图表生成器 —— 22 图型注册表（v3）
 * 一张卡片 = 一个预置 factory（出带担保/财务味演示数据的族配置）。
 * 卡片只负责填数据与默认参数；表单与 builder 按 family 复用。
 */
import {
  PALETTE,
  type CartesianCfg, type WaterfallCfg, type PieCfg, type FunnelCfg,
  type RadarCfg, type ScatterCfg, type GaugeCfg, type TreemapCfg,
  type HeatmapCfg, type SankeyCfg, type WizardCfg, type Family,
} from './chartTypes'

export type CardGroup = 'bar' | 'part' | 'metric'

export interface ChartCardDef {
  id: string
  name: string
  family: Family
  group: CardGroup
  /** 卡片上的一句话：适用场景 */
  desc: string
  factory: () => WizardCfg
}

export const CARD_GROUP_LABELS: Record<CardGroup, string> = {
  bar: '柱线类',
  part: '构成与分布',
  metric: '指标与流向',
}

function quarters(): string[] {
  return [
    '2023Q3', '2023Q4', '2024Q1', '2024Q2',
    '2024Q3', '2024Q4', '2025Q1', '2025Q2',
    '2025Q3', '2025Q4', '2026Q1', '2026Q2',
  ]
}

const B = PALETTE.blue, D = PALETTE.deepBlue, T = PALETTE.teal, O = PALETTE.orange
const LB = PALETTE.lightBlue, P = PALETTE.purple, G = PALETTE.green
const Y = PALETTE.yellow, R = PALETTE.red, S = PALETTE.sky

/* ---------------- A. 柱线类（11 张） ---------------- */

const fSingleLine = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_occurrence_trend', unitTag: '金额（万元）', period: '近3年趋势',
  categories: quarters(),
  series: [
    { name: '担保发生额', type: 'area', axis: 'left', color: B, showLabel: false,
      values: [9800, 11200, 10500, 12800, 13600, 15200, 12100, 14300, 15800, 17600, 13900, 16800] },
  ],
  leftAxis: { format: 'money' }, rightAxis: null,
  yearQuarter: false, annualMode: 'sum', horizontal: false, stack: 'none',
})

const fMultiLine = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_branch_balance', unitTag: '金额（万元）', period: '近3年',
  categories: quarters(),
  series: [
    { name: '石家庄分公司', type: 'line', axis: 'left', color: B, showLabel: false,
      values: [42000, 43600, 44200, 45800, 47200, 49800, 50600, 52400, 54800, 58200, 59100, 61800] },
    { name: '保定分公司', type: 'line', axis: 'left', color: T, showLabel: false,
      values: [28600, 29400, 30100, 31200, 32800, 34600, 35200, 36400, 37900, 40200, 40800, 42600] },
    { name: '唐山分公司', type: 'line', axis: 'left', color: O, showLabel: false,
      values: [19800, 20300, 21200, 21800, 22600, 24100, 24800, 25600, 26400, 28200, 28900, 30200] },
  ],
  leftAxis: { format: 'money' }, rightAxis: null,
  yearQuarter: false, annualMode: 'ending', horizontal: false, stack: 'none',
})

const fBarRate = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_occur_compensate', unitTag: '金额（万元）', period: '近3年',
  categories: quarters(),
  series: [
    { name: '担保发生额', type: 'bar', axis: 'left', color: B, showLabel: false,
      values: [12000, 13800, 11200, 13400, 14600, 17200, 12800, 15100, 16800, 19600, 14400, 17800] },
    { name: '代偿率', type: 'line', axis: 'right', color: O, showLabel: true,
      values: [0.9, 0.8, 1.1, 1.3, 1.0, 0.8, 1.2, 1.4, 1.1, 0.7, 0.9, 0.8] },
  ],
  leftAxis: { format: 'money' }, rightAxis: { format: 'percent' },
  yearQuarter: true, annualMode: 'ending', horizontal: false, stack: 'none',
})

const fGroupedBar = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_cashflow', unitTag: '金额（万元）', period: '近3年',
  categories: ['2023年', '2024年', '2025年'],
  series: [
    { name: '销售商品、提供劳务收到的现金', short: '销售收现', type: 'bar', axis: 'left', color: D, showLabel: true,
      values: [53500, 60200, 68300] },
    { name: '经营活动净额', type: 'bar', axis: 'left', color: B, showLabel: true,
      values: [12500, 14800, 16900] },
    { name: '投资活动净额', type: 'bar', axis: 'left', color: LB, showLabel: true,
      values: [-8600, -9400, -10200] },
    { name: '筹资活动净额', type: 'bar', axis: 'left', color: T, showLabel: true,
      values: [3200, -1800, -2600] },
  ],
  leftAxis: { format: 'money' }, rightAxis: null,
  yearQuarter: false, annualMode: 'sum', horizontal: false, stack: 'none',
})

const fPosNegBar = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_net_amount', unitTag: '金额（万元）', period: '近3年',
  categories: ['2023年', '2024年', '2025年'],
  series: [
    { name: '经营活动净额', type: 'bar', axis: 'left', color: B, showLabel: true,
      values: [12500, 14800, 16900] },
    { name: '投资活动净额', type: 'bar', axis: 'left', color: LB, showLabel: true,
      values: [-8600, -9400, -10200] },
    { name: '筹资活动净额', type: 'bar', axis: 'left', color: T, showLabel: true,
      values: [3200, -1800, -2600] },
  ],
  leftAxis: { format: 'money' }, rightAxis: null,
  yearQuarter: false, annualMode: 'sum', horizontal: false, stack: 'none',
})

const fStackedBar = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_business_mix', unitTag: '金额（万元）', period: '近3年',
  categories: quarters(),
  series: [
    { name: '工程担保', type: 'bar', axis: 'left', color: B, showLabel: false,
      values: [5200, 5800, 5400, 6600, 7200, 8400, 6800, 7800, 8600, 9800, 7400, 8800] },
    { name: '融资担保', type: 'bar', axis: 'left', color: T, showLabel: false,
      values: [3200, 3600, 3100, 3800, 4100, 4600, 3400, 4200, 4500, 5200, 3900, 4800] },
    { name: '诉讼保全', type: 'bar', axis: 'left', color: O, showLabel: false,
      values: [1400, 1600, 1500, 1800, 1900, 2200, 1700, 2000, 2100, 2400, 1800, 2200] },
    { name: '投标保函', type: 'bar', axis: 'left', color: P, showLabel: false,
      values: [2000, 2200, 2300, 2800, 3100, 3600, 2700, 3400, 3800, 4400, 3200, 3800] },
  ],
  leftAxis: { format: 'money' }, rightAxis: null,
  yearQuarter: false, annualMode: 'sum', horizontal: false, stack: 'normal',
})

const fPctStack = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_business_share', unitTag: '占比（%）', period: '近3年',
  categories: quarters(),
  series: [
    { name: '工程担保', type: 'bar', axis: 'left', color: B, showLabel: false,
      values: [5200, 5800, 5400, 6600, 7200, 8400, 6800, 7800, 8600, 9800, 7400, 8800] },
    { name: '融资担保', type: 'bar', axis: 'left', color: T, showLabel: false,
      values: [3200, 3600, 3100, 3800, 4100, 4600, 3400, 4200, 4500, 5200, 3900, 4800] },
    { name: '诉讼保全', type: 'bar', axis: 'left', color: O, showLabel: false,
      values: [1400, 1600, 1500, 1800, 1900, 2200, 1700, 2000, 2100, 2400, 1800, 2200] },
    { name: '投标保函', type: 'bar', axis: 'left', color: P, showLabel: false,
      values: [2000, 2200, 2300, 2800, 3100, 3600, 2700, 3400, 3800, 4400, 3200, 3800] },
  ],
  leftAxis: { format: 'percent' }, rightAxis: null,
  yearQuarter: false, annualMode: 'sum', horizontal: false, stack: 'percent',
})

const fDualMix = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_guarantee_overview', unitTag: '金额（万元）', period: '近3年',
  categories: quarters(),
  series: [
    { name: '担保发生额', type: 'bar', axis: 'left', color: B, showLabel: false,
      values: [12000, 13800, 11200, 13400, 14600, 17200, 12800, 15100, 16800, 19600, 14400, 17800] },
    { name: '在保余额', type: 'bar', axis: 'left', color: LB, showLabel: false,
      values: [82000, 84600, 85200, 87800, 90600, 95200, 96400, 99800, 104200, 110600, 112800, 118600] },
    { name: '代偿率', type: 'line', axis: 'right', color: O, showLabel: true,
      values: [0.9, 0.8, 1.1, 1.3, 1.0, 0.8, 1.2, 1.4, 1.1, 0.7, 0.9, 0.8] },
  ],
  leftAxis: { format: 'money' }, rightAxis: { format: 'percent' },
  yearQuarter: false, annualMode: 'sum', horizontal: false, stack: 'none',
})

const fRankBar = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_branch_rank', unitTag: '金额（万元）', period: '2025年',
  categories: ['石家庄', '保定', '唐山', '邯郸', '沧州', '廊坊', '邢台', '衡水'],
  series: [
    { name: '担保发生额', type: 'bar', axis: 'left', color: B, showLabel: true,
      values: [28600, 24300, 21800, 18900, 16500, 14200, 12800, 9600] },
  ],
  leftAxis: { format: 'money' }, rightAxis: null,
  yearQuarter: false, annualMode: 'sum', horizontal: true, stack: 'none',
})

const fDivergingBar = (): CartesianCfg => ({
  family: 'cartesian',
  label: 'chart_yoy_change', unitTag: '同比变化（%）', period: '2025年',
  categories: ['投标保函', '工程担保', '融资担保', '诉讼保全', '履约担保', '其他业务'],
  series: [
    { name: '同比增速', type: 'bar', axis: 'left', color: B, showLabel: true,
      values: [22, 18, 12, 6, -9, -14] },
  ],
  leftAxis: { format: 'percent' }, rightAxis: null,
  yearQuarter: false, annualMode: 'sum', horizontal: true, stack: 'none',
})

const fWaterfall = (): WaterfallCfg => ({
  family: 'waterfall',
  label: 'chart_profit_bridge', unitTag: '金额（万元）', period: '2025年',
  showLabel: true,
  rows: [
    { name: '期初未分配利润', kind: 'start', value: 8200 },
    { name: '担保业务收入', kind: 'add', value: 6800 },
    { name: '评审咨询收入', kind: 'add', value: 1400 },
    { name: '业务及管理费用', kind: 'sub', value: 2600 },
    { name: '担保赔偿准备', kind: 'sub', value: 900 },
    { name: '所得税费用', kind: 'sub', value: 1150 },
    { name: '期末净利润', kind: 'total', value: 0 },
  ],
})

/* ---------------- B. 构成与分布（8 张） ---------------- */

const fPie = (): PieCfg => ({
  family: 'pie', variant: 'pie',
  label: 'chart_income_pie', unitTag: '', period: '2025年',
  centerTitle: '合计', showLabel: true,
  items: [
    { name: '担保费收入', value: 4680, color: B },
    { name: '评审费收入', value: 1280, color: T },
    { name: '咨询服务收入', value: 620, color: O },
    { name: '其他收入', value: 340, color: LB },
  ],
})

const fDonut = (): PieCfg => ({
  family: 'pie', variant: 'donut',
  label: 'chart_balance_donut', unitTag: '', period: '2025年',
  centerTitle: '在保总额', showLabel: true,
  items: [
    { name: '工程担保', value: 38600, color: B },
    { name: '融资担保', value: 24200, color: T },
    { name: '诉讼保全', value: 9800, color: O },
    { name: '投标保函', value: 7600, color: P },
    { name: '其他', value: 3200, color: LB },
  ],
})

const fRose = (): PieCfg => ({
  family: 'pie', variant: 'rose',
  label: 'chart_industry_rose', unitTag: '', period: '2025年',
  centerTitle: '合计', showLabel: true,
  items: [
    { name: '建筑工程', value: 42800, color: B },
    { name: '房地产', value: 18600, color: D },
    { name: '制造业', value: 15200, color: T },
    { name: '批发零售', value: 9800, color: O },
    { name: '交通运输', value: 7600, color: P },
    { name: '能源化工', value: 5400, color: G },
    { name: '其他行业', value: 4200, color: LB },
  ],
})

const fNestedPie = (): PieCfg => ({
  family: 'pie', variant: 'nested',
  label: 'chart_product_nested', unitTag: '', period: '2025年',
  centerTitle: '', showLabel: false,
  items: [
    { name: '投标保函', value: 18600, parent: '工程担保', color: B },
    { name: '履约担保', value: 14200, parent: '工程担保', color: S },
    { name: '预付款保函', value: 9800, parent: '工程担保', color: LB },
    { name: '贷款担保', value: 16800, parent: '融资担保', color: T },
    { name: '债券担保', value: 7400, parent: '融资担保', color: G },
    { name: '诉前保全', value: 5600, parent: '诉讼保全', color: O },
    { name: '诉中保全', value: 4200, parent: '诉讼保全', color: Y },
  ],
})

const fFunnel = (): FunnelCfg => ({
  family: 'funnel',
  label: 'chart_biz_funnel', unitTag: '', period: '本季度',
  showRate: true,
  stages: [
    { name: '提交申请', value: 320 },
    { name: '受理', value: 268 },
    { name: '审批通过', value: 196 },
    { name: '签约', value: 152 },
    { name: '放款', value: 128 },
  ],
})

const fRadar = (): RadarCfg => ({
  family: 'radar',
  label: 'chart_company_radar', unitTag: '', period: '2025年',
  max: 100,
  dimensions: ['资本实力', '偿债能力', '盈利能力', '经营稳定性', '成长性'],
  entities: [
    { name: '企业A', color: B, fill: true, values: [88, 82, 76, 90, 72] },
    { name: '企业B', color: O, fill: false, values: [72, 68, 84, 65, 88] },
    { name: '企业C', color: T, fill: false, values: [64, 78, 62, 74, 80] },
  ],
})

const fScatter = (): ScatterCfg => ({
  family: 'scatter', bubble: true,
  label: 'chart_risk_scatter', unitTag: '', period: '2025年',
  xName: '担保规模（万元）', yName: '代偿率（%）',
  xAxisFmt: 'money', yAxisFmt: 'percent',
  groups: [
    {
      name: '工程类企业', color: B,
      points: [
        { name: '华北建设', x: 28000, y: 0.6, size: 46 },
        { name: '中建路桥', x: 22000, y: 0.9, size: 38 },
        { name: '冀东建工', x: 16500, y: 1.2, size: 29 },
        { name: '恒基工程', x: 9800, y: 0.4, size: 18 },
      ],
    },
    {
      name: '流通类企业', color: O,
      points: [
        { name: '北方商贸', x: 12000, y: 1.8, size: 24 },
        { name: '冀中物流', x: 8600, y: 2.3, size: 16 },
        { name: '正大农贸', x: 6200, y: 1.5, size: 12 },
      ],
    },
  ],
})

const fTreemap = (): TreemapCfg => ({
  family: 'treemap',
  label: 'chart_balance_treemap', unitTag: '金额（万元）', period: '2025年',
  items: [
    { name: '投标保函', value: 18600, parent: '工程担保' },
    { name: '履约担保', value: 14200, parent: '工程担保' },
    { name: '预付款保函', value: 9800, parent: '工程担保' },
    { name: '贷款担保', value: 16800, parent: '融资担保' },
    { name: '债券担保', value: 7400, parent: '融资担保' },
    { name: '诉前保全', value: 5600, parent: '诉讼保全' },
    { name: '诉中保全', value: 4200, parent: '诉讼保全' },
  ],
})

/* ---------------- C. 指标与流向（3 张） ---------------- */

const fHeatmap = (): HeatmapCfg => ({
  family: 'heatmap',
  label: 'chart_monthly_heat', unitTag: '金额（万元）', period: '2025年',
  showLabel: false,
  cols: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  rows: [
    { name: '工程担保', values: [3200, 2800, 3600, 4200, 4800, 5600, 6200, 6000, 5400, 4600, 3800, 3400] },
    { name: '融资担保', values: [2100, 1900, 2400, 2600, 2800, 3000, 3200, 3100, 2900, 2600, 2300, 2200] },
    { name: '诉讼保全', values: [800, 900, 1100, 1300, 1500, 1700, 1800, 1750, 1600, 1300, 1000, 850] },
    { name: '投标保函', values: [1400, 1200, 1700, 2100, 2400, 2900, 3300, 3200, 2800, 2200, 1700, 1500] },
  ],
})

const fSankey = (): SankeyCfg => ({
  family: 'sankey',
  label: 'chart_fund_sankey', unitTag: '金额（万元）', period: '2025年',
  nodes: ['银行授信', '自有资金', '商业合作', '工程担保', '融资担保', '诉讼保全', '建筑房地产', '制造业', '批发零售', '交通基建', '其他服务'],
  links: [
    { source: '银行授信', target: '工程担保', value: 32000 },
    { source: '银行授信', target: '融资担保', value: 18000 },
    { source: '自有资金', target: '融资担保', value: 6200 },
    { source: '自有资金', target: '诉讼保全', value: 4800 },
    { source: '商业合作', target: '工程担保', value: 8600 },
    { source: '商业合作', target: '诉讼保全', value: 3400 },
    { source: '工程担保', target: '建筑房地产', value: 28600 },
    { source: '工程担保', target: '交通基建', value: 12000 },
    { source: '融资担保', target: '制造业', value: 13800 },
    { source: '融资担保', target: '批发零售', value: 10400 },
    { source: '诉讼保全', target: '批发零售', value: 4600 },
    { source: '诉讼保全', target: '其他服务', value: 3600 },
  ],
})

const fGauge = (): GaugeCfg => ({
  family: 'gauge',
  label: 'chart_compensate_gauge', unitTag: '', period: '2025年',
  value: 1.8, unit: '%', min: 0, max: 5, decimals: 1,
  segs: [
    { to: 2, color: G, name: '安全' },
    { to: 3.5, color: Y, name: '关注' },
    { to: 5, color: R, name: '预警' },
  ],
})

/* ---------------- 注册表（顺序即展示顺序） ---------------- */

export const CHART_CATALOG: ChartCardDef[] = [
  // A 柱线类
  { id: 'single-line', name: '单线趋势', family: 'cartesian', group: 'bar', desc: '一个指标随时间变化，面积线看走势', factory: fSingleLine },
  { id: 'multi-line', name: '多线对比', family: 'cartesian', group: 'bar', desc: '2~3 个同量级指标的趋势对比', factory: fMultiLine },
  { id: 'bar-rate', name: '柱+率双轴', family: 'cartesian', group: 'bar', desc: '金额柱 + 百分比线（如发生额与代偿率），支持年/季切换', factory: fBarRate },
  { id: 'grouped-bar', name: '分组柱状', family: 'cartesian', group: 'bar', desc: '多个科目按类目并排对比，支持负值', factory: fGroupedBar },
  { id: 'posneg-bar', name: '正负柱状', family: 'cartesian', group: 'bar', desc: '净额类科目正负朝下对比（三大现金流活动）', factory: fPosNegBar },
  { id: 'stacked-bar', name: '堆叠柱状', family: 'cartesian', group: 'bar', desc: '总量 + 构成随时间变化', factory: fStackedBar },
  { id: 'pct-stack', name: '百分比堆叠柱', family: 'cartesian', group: 'bar', desc: '只看构成占比的变化，不看总量', factory: fPctStack },
  { id: 'dual-mix', name: '双轴混合', family: 'cartesian', group: 'bar', desc: '两根金额柱 + 一条百分比线，信息密度高', factory: fDualMix },
  { id: 'rank-bar', name: '横向排名条', family: 'cartesian', group: 'bar', desc: '分公司/客户/产品排名', factory: fRankBar },
  { id: 'diverging-bar', name: '正负双向条形', family: 'cartesian', group: 'bar', desc: '同比增减类指标，正负向两侧伸', factory: fDivergingBar },
  { id: 'waterfall', name: '瀑布图', family: 'waterfall', group: 'bar', desc: '利润桥：起点 → 各项增减 → 合计自动算', factory: fWaterfall },
  // B 构成与分布
  { id: 'pie', name: '饼图', family: 'pie', group: 'part', desc: '少量分项的占比构成', factory: fPie },
  { id: 'donut', name: '环形图', family: 'pie', group: 'part', desc: '中心显示总额的占比构成', factory: fDonut },
  { id: 'rose', name: '南丁格尔玫瑰', family: 'pie', group: 'part', desc: '分项较多时用半径区分大小', factory: fRose },
  { id: 'nested-pie', name: '嵌套双饼', family: 'pie', group: 'part', desc: '两级构成：外环产品归属内环板块', factory: fNestedPie },
  { id: 'funnel', name: '漏斗图', family: 'funnel', group: 'part', desc: '申请→受理→审批→签约→放款，带转化率', factory: fFunnel },
  { id: 'radar', name: '雷达图', family: 'radar', group: 'part', desc: '多维度评分，支持多家企业对比', factory: fRadar },
  { id: 'scatter-bubble', name: '散点/气泡', family: 'scatter', group: 'part', desc: '两指标相关性，气泡大小可带第三个指标', factory: fScatter },
  { id: 'treemap', name: '矩形树图', family: 'treemap', group: 'part', desc: '两级层级构成，面积即数值', factory: fTreemap },
  // C 指标与流向
  { id: 'heatmap', name: '热力图', family: 'heatmap', group: 'metric', desc: '月份 × 业务类型矩阵，颜色深浅看密度', factory: fHeatmap },
  { id: 'sankey', name: '桑基资金流向', family: 'sankey', group: 'metric', desc: '资金来源 → 业务板块 → 投向行业', factory: fSankey },
  { id: 'gauge', name: '仪表盘', family: 'gauge', group: 'metric', desc: '单个关键指标 + 绿黄红阈值段（如代偿率）', factory: fGauge },
]

export function getCard(id: string): ChartCardDef | undefined {
  return CHART_CATALOG.find((c) => c.id === id)
}
