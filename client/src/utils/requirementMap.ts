/**
 * 需求全景图：配表（色调/图标规则）+ 适配器（需求原始数据 → 全景视图模型）
 * 规则集中在本文件，节点组件只负责渲染。
 */
import type { Requirement } from '@/types'

export type MapTone = 'sky' | 'indigo' | 'violet' | 'amber' | 'emerald' | 'slate'

const TONES: MapTone[] = ['sky', 'indigo', 'violet', 'amber', 'emerald', 'slate']

/** 模块色调：按 id 稳定哈希，保证同一模块每次颜色一致、多模块均匀分布 */
export function pickTone(id: string): MapTone {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]
}

/**
 * 模块图标：按标题关键词推断业务域（中文场景）；未命中用通用 layers。
 * 图标名必须存在于 AppIcon 的 ICONS 表。
 */
const ICON_RULES: Array<{ icon: string; keywords: string[] }> = [
  { icon: 'globe', keywords: ['门户', '官网', '首页', '商城', '公众'] },
  // 网关在接入之前：「API 网关」优先识别为网络拓扑，「API 接入」才是插头
  { icon: 'network', keywords: ['网关', '路由', '网络', '链路'] },
  { icon: 'plug', keywords: ['接入', '接口', 'api', 'API', '集成'] },
  { icon: 'gauge', keywords: ['运营', '后台', '统计', '监控', '看板', '驾驶舱', '分析', '报表'] },
  { icon: 'credit-card', keywords: ['计费', '账单', '计量', '支付', '收费', '账务', '财务'] },
  { icon: 'settings', keywords: ['系统', '权限', '角色', '用户', '账号', '设置', '配置'] },
  { icon: 'inbox', keywords: ['工单', '审批', '审核', '流程'] },
  { icon: 'user', keywords: ['客户', '会员', '员工', '人员'] },
  { icon: 'database', keywords: ['数据', '资产', '资源', '目录'] },
]

export function pickModuleIcon(title: string): string {
  for (const rule of ICON_RULES) {
    if (rule.keywords.some((k) => title.includes(k))) return rule.icon
  }
  return 'layers'
}

export interface MapPage {
  id: string
  title: string
  status: 'proposed' | 'confirmed'
  inProto: boolean
  /** 待处理原型意见条数（红角标） */
  open: number
}

export interface MapModule {
  id: string
  title: string
  status: 'proposed' | 'confirmed'
  tone: MapTone
  icon: string
  confirmed: number
  total: number
  pages: MapPage[]
}

export interface MapStats {
  moduleCount: number
  pageCount: number
  confirmedPages: number
  /** 已进原型的页面数 */
  protoCount: number
  /** 待处理原型意见总数 */
  openCount: number
  /** 需求池未搁置想法数 */
  poolCount: number
}

export interface MapModel {
  /** 最后一个可能是合成的「未归属页面」分组（id === '__orphan__'） */
  modules: MapModule[]
  stats: MapStats
}

export const ORPHAN_MODULE_ID = '__orphan__'

interface BuildOptions {
  /** 原型 spec 中已关联需求 id 的集合（pages + nav） */
  protoReqIds: Set<string>
  /** 需求 id → 待处理意见数（已由原型页面 id 映射到需求 id） */
  openByReqId: Map<string, number>
}

export function buildMapModel(reqs: Requirement[], opts: BuildOptions): MapModel {
  const { protoReqIds, openByReqId } = opts
  const toPage = (r: Requirement): MapPage => ({
    id: r.id,
    title: r.title,
    status: r.status,
    inProto: protoReqIds.has(r.id),
    open: openByReqId.get(r.id) || 0,
  })

  const moduleReqs = reqs.filter((r) => r.kind === 'module')
  const pageReqs = reqs.filter((r) => r.kind === 'page')
  const moduleIds = new Set(moduleReqs.map((m) => m.id))

  const modules: MapModule[] = moduleReqs.map((m) => {
    const pages = pageReqs
      .filter((p) => p.parent_id === m.id)
      .map(toPage)
    return {
      id: m.id,
      title: m.title,
      status: m.status,
      tone: pickTone(m.id),
      icon: pickModuleIcon(m.title),
      confirmed: pages.filter((p) => p.status === 'confirmed').length,
      total: pages.length,
      pages,
    }
  })

  const orphanPages = pageReqs.filter((p) => !p.parent_id || !moduleIds.has(p.parent_id)).map(toPage)
  if (orphanPages.length) {
    modules.push({
      id: ORPHAN_MODULE_ID,
      title: '未归属页面',
      status: 'confirmed',
      tone: 'slate',
      icon: 'flag',
      confirmed: orphanPages.filter((p) => p.status === 'confirmed').length,
      total: orphanPages.length,
      pages: orphanPages,
    })
  }

  const allPages = [...modules.flatMap((m) => m.pages)]
  const poolCount = reqs.filter(
    (r) => r.kind === 'idea' && r.pool_status !== 'shelved'
  ).length

  const stats: MapStats = {
    moduleCount: modules.length,
    pageCount: allPages.length,
    confirmedPages: allPages.filter((p) => p.status === 'confirmed').length,
    protoCount: allPages.filter((p) => p.inProto).length,
    openCount: allPages.reduce((s, p) => s + p.open, 0),
    poolCount,
  }

  return { modules, stats }
}

/** 原型 spec 页面 id → 需求 id 映射（annotations.page_id 用的是原型页面 id） */
export function mapOpenAnnotationsToReqs(
  annotations: Array<{ page_id: string; status: string }>,
  protoPages: Array<{ id?: string; requirementId?: string | null }>
): Map<string, number> {
  const protoPageToReq = new Map<string, string>()
  for (const p of protoPages) {
    if (p.id && p.requirementId) protoPageToReq.set(p.id, p.requirementId)
  }
  const counts = new Map<string, number>()
  for (const a of annotations) {
    if (a.status !== 'open') continue
    const rid = protoPageToReq.get(a.page_id)
    if (rid) counts.set(rid, (counts.get(rid) || 0) + 1)
  }
  return counts
}
