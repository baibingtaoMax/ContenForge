// ============================================
// 设计决策「需求点」工具
// point 单值：优先 = 需求文档已有章节标题；也允许自拟短名
// ============================================

/** 从需求 doc_md 提取 ## / ### 标题（按文档顺序） */
export function extractHeadings(docMd: string): string[] {
  if (!docMd) return []
  const out: string[] = []
  for (const line of docMd.split(/\r?\n/)) {
    const m = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line.trim())
    if (m) {
      const t = m[1].replace(/\*\*/g, '').trim()
      if (t && !out.includes(t)) out.push(t)
    }
  }
  return out
}

/** 归一化用于匹配：去空白/标点/序号，方便「2.1 搜索交互」对上「搜索交互」 */
export function normalizePoint(s: string): string {
  return (s || '')
    .replace(/^\d+(\.\d+)*[.、\s]*/, '') // 去掉章节序号
    .replace(/[\s　·•\-—_/\\:：,，.。、（）()【】\[\]]/g, '')
    .toLowerCase()
}

/** point 是否能匹配到文档标题（匹配不上 = 文档重写过，决策需重新指认） */
export function matchHeading(point: string, headings: string[]): string | null {
  const p = normalizePoint(point)
  if (!p) return null
  for (const h of headings) {
    const hh = normalizePoint(h)
    if (hh === p || hh.includes(p) || p.includes(hh)) return h
  }
  return null
}

/** 分组：按 point 分组，组内时间正序；空 point 归「通用决策」置底 */
export interface PointGroup<T extends { point: string; createdAt: string }> {
  point: string // '' = 通用决策
  items: T[]
}

export function groupByPoint<T extends { point: string; createdAt: string }>(decisions: T[]): PointGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const d of decisions) {
    const key = d.point || ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(d)
  }
  const groups: PointGroup<T>[] = []
  for (const [point, items] of map) {
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    groups.push({ point, items })
  }
  groups.sort((a, b) => {
    if (!a.point) return 1 // 通用置底
    if (!b.point) return -1
    return a.items[0].createdAt.localeCompare(b.items[0].createdAt)
  })
  return groups
}
