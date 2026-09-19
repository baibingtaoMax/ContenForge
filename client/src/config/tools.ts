// PM 工具箱注册表
// 新增工具：在这里登记一条，ToolsView 网格自动出现，工作区组件在 ToolsView 内挂载

/** AppIcon 支持的 tint 着色（与 AppIcon props 保持一致） */
export type ToolTint = 'amber' | 'indigo' | 'violet' | 'sky' | 'slate' | 'rose' | 'emerald'

export interface ToolDef {
  id: string
  name: string
  /** 一句话说明（卡片副标题） */
  desc: string
  /** AppIcon 图标名 */
  icon: string
  /** AppIcon tint 着色 */
  tint: ToolTint
  /** 关键词，供以后搜索用 */
  keywords: string[]
}

export const TOOLS: ToolDef[] = [
  {
    id: 'axure-chart',
    name: 'Axure 图表生成器',
    desc: '向导里加系列、选柱/线/面积、绑左右轴，实时预览后一键复制 ECharts 注入码贴进 Axure；也支持直接粘自定义 option。',
    icon: 'chart-column',
    tint: 'indigo',
    keywords: ['axure', 'echarts', '图表', '注入', '原型', '柱状', '折线', '财务', '趋势'],
  },
  {
    id: 'image-convert',
    name: '图片格式转换',
    desc: 'JPG / PNG / WebP / BMP / ICO 互转，支持苹果 HEIC 照片；本地转换可压缩，文件不上传。',
    icon: 'image-convert',
    tint: 'emerald',
    keywords: ['图片', '转换', '格式', 'heic', 'ico', 'jpg', 'png', 'webp', '压缩'],
  },
  {
    id: 'json-list',
    name: 'JSON 列表查看',
    desc: '粘接口返回或日志，自动找出 JSON 里的对象数组摊成表格；可切换多个 list、粘字段映射显示中文列名。',
    icon: 'list',
    tint: 'indigo',
    keywords: ['json', '列表', '数组', '表格', '接口', '日志', '查看', '数据'],
  },
  {
    id: 'json-tool',
    name: 'JSON 解析',
    desc: '粘贴接口返回、日志、mock 数据，自动格式化并按树展开；支持压缩、去转义、报错定位到行列。',
    icon: 'braces',
    tint: 'sky',
    keywords: ['json', '格式化', '解析', '树状', '接口', '日志'],
  },
  {
    id: 'json-mapping',
    name: 'JSON 字段对照',
    desc: '粘 JSON 和字段映射表（key→中文名），自动把中文名和值对上；支持嵌套数组、漏配检查，一键导出 Excel。',
    icon: 'map',
    tint: 'amber',
    keywords: ['json', '字段', '中文名', '映射', '数据字典', '对照', '翻译', '导出'],
  },
  {
    id: 'dup-check',
    name: '重复数据检查',
    desc: '粘两列名单（企业名、信用代码、手机号），不管顺序找出两边重复、各自独有和单份内部重复，结果可复制。',
    icon: 'layers',
    tint: 'rose',
    keywords: ['重复', '查重', '去重', '名单', '两列', '交集', '对比', '一致', '核对'],
  },
  {
    id: 'text-diff',
    name: '文本比对',
    desc: '粘贴两版文本（需求稿、合同条款、聊天记录），逐行逐字对照差异，支持折叠相同内容。',
    icon: 'git-compare',
    tint: 'violet',
    keywords: ['对比', '差异', 'diff', '两版', '文档'],
  },
]

export function getTool(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id)
}
