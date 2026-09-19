// JSON 字段对照：解析 key→中文名 映射表，把 JSON 递归展开成对照行
import { parseJsonText, type JsonValue } from './jsonTool'

export interface MappingParse {
  ok: boolean
  map: Map<string, string>
  /** 识别到多少条映射 */
  count: number
  /** 分栏模式：左右两侧各有多少个非空行 */
  leftCount?: number
  rightCount?: number
  error?: string
}

/**
 * 解析映射表，支持：
 * 1. JSON 对象：{"cust_name":"客户名称"}
 * 2. Excel/TSV 粘贴：Tab 多列，取前两列（key、中文名）
 * 3. 两列文本：逗号/中文逗号/冒号/等号/多空格分隔
 */
export function parseMapping(raw: string): MappingParse {
  const text = raw.trim()
  const map = new Map<string, string>()
  if (!text) return { ok: true, map, count: 0 }

  // 1. 先试 JSON
  if (text[0] === '{' || text[0] === '[') {
    try {
      const obj = JSON.parse(text)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
          if (v !== null && v !== undefined && String(v).trim()) map.set(String(k), String(v).trim())
        }
        return { ok: true, map, count: map.size }
      }
    } catch {
      // 落下去按文本行解析
    }
  }

  // 2/3. 逐行拆两列
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    let cells: string[]
    if (s.includes('\t')) cells = s.split('\t')
    else if (/[,，]/.test(s)) cells = s.split(/[,，]/)
    else if (/[:：=]/.test(s)) cells = s.split(/\s*[:：=]\s*/)
    else if (/\s{2,}/.test(s)) cells = s.split(/\s{2,}/)
    else cells = s.split(/\s+/)
    const key = cells[0]?.trim()
    const cn = cells[1]?.trim()
    if (key && cn) map.set(key, cn)
  }
  return { ok: true, map, count: map.size }
}

export type RowKind = 'object' | 'array' | 'leaf'

export interface MapRow {
  /** 完整路径段（对象键为 string，数组下标为 number） */
  path: (string | number)[]
  /** 本行字段名（数组项为下标） */
  key: string
  depth: number
  kind: RowKind
  /** 标量值（仅 leaf） */
  value: JsonValue
  /** 对象/数组的摘要，如「对象 · 3 字段」；leaf 为显示文本 */
  text: string
  /** 匹配到的中文名，null 表示未配置 */
  cn: string | null
  /** 是否数组元素（数组元素不参与「未配置」统计） */
  isArrayItem: boolean
}

function typeSummary(v: JsonValue): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `数组 · ${v.length} 项`
  if (typeof v === 'object') return `对象 · ${Object.keys(v).length} 字段`
  return String(v)
}

/** 递归把任意 JSON 展开为对照行（不含根节点自身） */
export function buildRows(root: JsonValue, map: Map<string, string>): MapRow[] {
  const rows: MapRow[] = []

  const walk = (value: JsonValue, path: (string | number)[], depth: number, isArrayItem: boolean) => {
    const key = path.length ? String(path[path.length - 1]) : ''
    const isContainer = value !== null && typeof value === 'object'
    const cn = !isArrayItem && key && map.has(key) ? map.get(key)! : null
    rows.push({
      path,
      key,
      depth,
      kind: isContainer ? (Array.isArray(value) ? 'array' : 'object') : 'leaf',
      value,
      text: typeSummary(value),
      cn,
      isArrayItem,
    })
    if (!isContainer) return
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, [...path, i], depth + 1, true))
    } else {
      for (const [k, item] of Object.entries(value)) walk(item, [...path, k], depth + 1, false)
    }
  }

  // 根为对象/数组：从其子项开始；根为标量：合成一行
  if (root !== null && typeof root === 'object') {
    if (Array.isArray(root)) root.forEach((item, i) => walk(item, [i], 0, true))
    else for (const [k, item] of Object.entries(root)) walk(item, [k], 0, false)
  } else {
    rows.push({ path: [], key: '', depth: 0, kind: 'leaf', value: root, text: typeSummary(root), cn: null, isArrayItem: false })
  }
  return rows
}

export interface RowStats {
  /** 叶子字段总数（不含数组元素） */
  total: number
  configured: number
  missing: number
}

export function rowStats(rows: MapRow[]): RowStats {
  let total = 0
  let configured = 0
  for (const r of rows) {
    if (r.kind !== 'leaf' || r.isArrayItem) continue
    total++
    if (r.cn) configured++
  }
  return { total, configured, missing: total - configured }
}

/** 路径转可读字符串：a.b[0].c */
export function pathText(path: (string | number)[]): string {
  let out = ''
  for (const seg of path) {
    if (typeof seg === 'number') out += `[${seg}]`
    else out += (out ? '.' : '') + seg
  }
  return out
}

/** 导出 TSV：每个叶子一行「中文名  字段路径  值」，可直接粘进 Excel */
export function rowsToTsv(rows: MapRow[]): string {
  const lines = ['中文名\t字段路径\t值']
  for (const r of rows) {
    if (r.kind !== 'leaf') continue
    const v = r.value === null ? 'null' : typeof r.value === 'object' ? '' : String(r.value)
    lines.push([r.cn ?? '', pathText(r.path), v].join('\t'))
  }
  return lines.join('\n')
}

/**
 * 左右分栏模式：左框一行 key、右框一行中文名，按行号一一对应。
 * 严格按下标对齐（中间的空行不参与配对，也不会把错位的行凑到一起）。
 */
export function parseMappingColumns(keysRaw: string, namesRaw: string): MappingParse {
  const keys = keysRaw.split(/\r?\n/)
  const names = namesRaw.split(/\r?\n/)
  const map = new Map<string, string>()
  const n = Math.max(keys.length, names.length)
  for (let i = 0; i < n; i++) {
    const key = keys[i]?.trim() ?? ''
    const cn = names[i]?.trim() ?? ''
    if (key && cn) map.set(key, cn)
  }
  const leftCount = keys.filter((k) => k.trim()).length
  const rightCount = names.filter((k) => k.trim()).length
  return { ok: true, map, count: map.size, leftCount, rightCount }
}

export interface MappingResult {
  ok: boolean
  rows: MapRow[]
  stats: RowStats
  error?: string
  errorLine?: number
  errorCol?: number
}

/** 一次性算出对照结果（映射表为混合粘贴文本） */
export function buildMappingResult(jsonRaw: string, mapRaw: string): MappingResult {
  return buildMappingFromMap(jsonRaw, parseMapping(mapRaw).map)
}

/** 一次性算出对照结果（映射表为已解析好的 Map） */
export function buildMappingFromMap(jsonRaw: string, map: Map<string, string>): MappingResult {
  const parsed = parseJsonText(jsonRaw)
  if (!jsonRaw.trim()) return { ok: false, rows: [], stats: { total: 0, configured: 0, missing: 0 } }
  if (!parsed.ok || parsed.value === undefined) {
    return {
      ok: false,
      rows: [],
      stats: { total: 0, configured: 0, missing: 0 },
      error: parsed.error?.message,
      errorLine: parsed.error && parsed.error.pos >= 0 ? parsed.error.line : undefined,
      errorCol: parsed.error && parsed.error.pos >= 0 ? parsed.error.col : undefined,
    }
  }
  const rows = buildRows(parsed.value, map)
  return { ok: true, rows, stats: rowStats(rows) }
}
