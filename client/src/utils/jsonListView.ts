// JSON 列表查看：从任意 JSON 里找出对象数组、推断列、生成单元格视图。纯前端零依赖。
import type { JsonValue } from './jsonTool'
import { parseMapping } from './jsonMapping'

export function isPlainObject(v: JsonValue): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export interface ArrayPathInfo {
  /** 结构路径段：对象键为 string，进数组为符号 '[]'；空数组 = 根就是数组 */
  struct: string[]
  /** 展示用路径，如 data.list[].approvals */
  label: string
  count: number
}

const ARRAY_MARK = '[]'

function formatStruct(struct: string[]): string {
  if (!struct.length || struct.every((s) => s === ARRAY_MARK)) return '$（整个 JSON 就是数组）'
  let s = ''
  for (const seg of struct) {
    if (seg === ARRAY_MARK) s += '[]'
    else if (!s) s = seg
    else s += `.${seg}`
  }
  return s
}

/**
 * 扫出 JSON 里所有「对象数组」：非空、且元素全部是对象或 null（接口记录的典型形态）。
 * 记录里嵌套的子表数组归并成同一条结构路径（data.list[].approvals），不按下标重复列。
 */
export function findObjectArrays(root: JsonValue): ArrayPathInfo[] {
  const found = new Map<string, ArrayPathInfo>()
  const register = (struct: string[]) => {
    const key = struct.join('\u0000')
    if (!found.has(key)) {
      found.set(key, { struct: [...struct], label: formatStruct(struct), count: 0 })
    }
  }
  const walk = (v: JsonValue, struct: string[]) => {
    if (Array.isArray(v)) {
      if (v.length > 0 && v.every((it) => it === null || isPlainObject(it))) {
        register([...struct, ARRAY_MARK])
      }
      for (const it of v) {
        if (it !== null) walk(it, [...struct, ARRAY_MARK])
      }
    } else if (isPlainObject(v)) {
      for (const [k, val] of Object.entries(v)) walk(val, [...struct, k])
    }
  }
  walk(root, [])
  const list = [...found.values()]
  for (const info of list) info.count = getStructRows(root, info.struct).length
  // 默认选择：条数多的在前
  return list.sort((a, b) => b.count - a.count)
}

/** 按结构路径取数：对象键取值，'[]' 拍平数组；跨所有父行收集记录 */
export function getStructRows(root: JsonValue, struct: string[]): JsonValue[] {
  let cur: JsonValue[] = [root]
  for (const seg of struct) {
    const next: JsonValue[] = []
    if (seg === ARRAY_MARK) {
      for (const v of cur) if (Array.isArray(v)) next.push(...v)
    } else {
      for (const v of cur) if (isPlainObject(v)) next.push(v[seg])
    }
    cur = next
    if (!cur.length) break
  }
  return cur
}

/** 列 = 所有行 key 的并集，顺序按首次出现 */
export function inferColumns(rows: Record<string, JsonValue>[]): string[] {
  const cols: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k)
        cols.push(k)
      }
    }
  }
  return cols
}

export type CellKind = 'string' | 'number' | 'boolean' | 'null' | 'empty' | 'object' | 'array'

export interface CellView {
  kind: CellKind
  /** 单元格里直接显示的短文本 */
  text: string
  /** 嵌套对象/数组：可点进详情 */
  complex: boolean
  /** 详情里展示的格式化 JSON */
  detail: string
}

const COMPACT_MAX = 42

export function cellView(v: JsonValue | undefined): CellView {
  if (v === undefined) return { kind: 'empty', text: '', complex: false, detail: '' }
  if (v === null) return { kind: 'null', text: 'null', complex: false, detail: '' }
  if (typeof v === 'string') return { kind: 'string', text: v, complex: false, detail: '' }
  if (typeof v === 'number') return { kind: 'number', text: String(v), complex: false, detail: '' }
  if (typeof v === 'boolean') return { kind: 'boolean', text: v ? 'true' : 'false', complex: false, detail: '' }
  // 对象 / 数组：压缩成一行截断，详情给完整 pretty JSON
  const compact = JSON.stringify(v)
  const text = compact.length > COMPACT_MAX ? compact.slice(0, COMPACT_MAX) + '…' : compact
  return {
    kind: Array.isArray(v) ? 'array' : 'object',
    text,
    complex: true,
    detail: safePretty(v),
  }
}

function safePretty(v: JsonValue): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

/** 字段名归一化：小写 + 去 _ - 空格，让 credit_code / creditCode / CREDIT-CODE 互相命中 */
export function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/[_\-\s]/g, '')
}

/** 查中文名：精确优先，查不到再按归一化兜底（忽略大小写/蛇形驼峰/连字符） */
export function lookupCn(map: Map<string, string>, key: string): string | undefined {
  const exact = map.get(key)
  if (exact !== undefined) return exact
  const nk = normalizeKey(key)
  if (!nk) return undefined
  for (const [k, v] of map) {
    if (normalizeKey(k) === nk) return v
  }
  return undefined
}

/** 解析粘贴的字段映射（复用字段对照工具的三格式解析：JSON 对象 / TSV / key:中文） */
export function buildLabelMap(rawMapping: string): { map: Map<string, string>; count: number } {
  const parsed = parseMapping(rawMapping)
  return { map: parsed.map, count: parsed.count }
}

/** 单元格转成适合进 Excel 的文本：对象/数组给紧凑 JSON，null/缺失给空串 */
export function cellToExcelText(v: JsonValue | undefined): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

/** 含制表符/换行/引号的单元格按 Excel 规则加引号转义 */
function escapeTsvCell(v: string): string {
  return /[\t\r\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
}

/**
 * 整表导成 TSV（当前选中数组的全部行，不受分页影响）。
 * 表头配了中文映射用中文，否则用英文 key；粘到 Excel/飞书表格自动分列分行。
 */
export function rowsToExcelTsv(
  rows: Record<string, JsonValue>[],
  columns: string[],
  labelMap: Map<string, string>
): string {
  const head = columns.map((c) => escapeTsvCell(lookupCn(labelMap, c) || c))
  const body = rows.map((row) =>
    columns.map((c) => escapeTsvCell(cellToExcelText(row[c]))).join('\t')
  )
  return [head.join('\t'), ...body].join('\r\n')
}
