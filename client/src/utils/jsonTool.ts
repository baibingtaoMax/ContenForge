// JSON 工具箱：纯前端解析 / 错误定位 / 高亮 / 节点描述，零依赖，数据不出浏览器

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface JsonError {
  message: string
  pos: number // 出错字符位置；-1 = 定位不到（如空输入/不完整）
  line: number
  col: number
  hint: string
}

export interface ParseResult {
  ok: boolean
  value?: JsonValue
  pretty?: string
  error?: JsonError
}

/** 从错误位置反推行号列号（1 起） */
function lineColAt(text: string, pos: number): { line: number; col: number } {
  if (pos < 0) return { line: 1, col: 1 }
  let line = 1
  let lastLineStart = 0
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      lastLineStart = i + 1
    }
  }
  return { line, col: pos - lastLineStart + 1 }
}

/** 根据出错类型给一句 PM 能看懂的排查提示 */
function buildHint(kind: ErrorKind, raw: string, pos: number): string {
  const around = pos >= 0 ? raw.slice(Math.max(0, pos - 12), pos + 12) : ''
  if (kind === 'end') return 'JSON 不完整，检查结尾是不是漏了 } 或 ]，或者复制时少了一段'
  if (kind === 'trailing') return 'JSON 结束后还有多余内容，可能是两段数据拼在了一起'
  if (around.includes("'")) return 'JSON 字符串只能用英文双引号 "，不能用单引号 \''
  if (kind === 'trailingComma') return '} 或 ] 前面多了一个逗号，删掉它'
  if (kind === 'unquotedKey') return '字段名必须用双引号包起来（如 "name"）'
  if (kind === 'missingColon') return '字段名后面少了英文冒号 :'
  if (kind === 'emptyValue') return '某个字段的值缺了，或者逗号前后多了一个逗号'
  return '检查这个位置附近：逗号、引号、括号是否成对，有没有中文标点'
}

type ErrorKind = 'token' | 'end' | 'trailing' | 'trailingComma' | 'unquotedKey' | 'missingColon' | 'emptyValue'
interface LocatedError {
  pos: number
  kind: ErrorKind
}

/**
 * 手写 JSON 定位器：新版 V8 的报错不带 position，自己扫出第一个出错字符。
 * 返回 null = 语法合法。
 */
function locateJsonError(text: string): LocatedError | null {
  let i = 0
  const n = text.length
  const ws = () => { while (i < n && /\s/.test(text[i])) i++ }

  function parseString(): LocatedError | null {
    i++ // 跳过开头引号
    while (i < n) {
      const c = text[i]
      if (c === '"') { i++; return null }
      if (c === '\\') { i += 2; continue }
      if (c === '\n') return { pos: i, kind: 'token' }
      i++
    }
    return { pos: n, kind: 'end' }
  }

  function parseLiteral(lit: string): LocatedError | null {
    for (let k = 0; k < lit.length; k++) {
      if (text[i + k] !== lit[k]) return { pos: i, kind: 'token' }
    }
    i += lit.length
    return null
  }

  function parseNumber(): LocatedError | null {
    const re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
    re.lastIndex = i
    const m = re.exec(text)
    if (!m) return { pos: i, kind: 'token' }
    i += m[0].length
    return null
  }

  function parseValue(): LocatedError | null {
    ws()
    if (i >= n) return { pos: n, kind: 'end' }
    const c = text[i]
    if (c === '"') return parseString()
    if (c === '{') return parseObject()
    if (c === '[') return parseArray()
    if (c === 't') return parseLiteral('true')
    if (c === 'f') return parseLiteral('false')
    if (c === 'n') return parseLiteral('null')
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber()
    if (c === ',' || c === '}' || c === ']') return { pos: i, kind: 'emptyValue' }
    return { pos: i, kind: 'token' }
  }

  function parseObject(): LocatedError | null {
    i++ // {
    ws()
    if (text[i] === '}') { i++; return null }
    while (true) {
      ws()
      if (i >= n) return { pos: n, kind: 'end' }
      if (text[i] !== '"') return { pos: i, kind: 'unquotedKey' }
      const e1 = parseString()
      if (e1) return e1
      ws()
      if (text[i] !== ':') return { pos: i, kind: 'missingColon' }
      i++
      const e2 = parseValue()
      if (e2) return e2
      ws()
      if (text[i] === ',') { i++; ws(); if (text[i] === '}' || text[i] === ']') return { pos: i, kind: 'trailingComma' }; continue }
      if (text[i] === '}') { i++; return null }
      if (i >= n) return { pos: n, kind: 'end' }
      return { pos: i, kind: 'token' }
    }
  }

  function parseArray(): LocatedError | null {
    i++ // [
    ws()
    if (text[i] === ']') { i++; return null }
    while (true) {
      const e = parseValue()
      if (e) return e
      ws()
      if (text[i] === ',') { i++; ws(); if (text[i] === ']') return { pos: i, kind: 'trailingComma' }; continue }
      if (text[i] === ']') { i++; return null }
      if (i >= n) return { pos: n, kind: 'end' }
      return { pos: i, kind: 'token' }
    }
  }

  const first = parseValue()
  if (first) return first
  ws()
  if (i < n) return { pos: i, kind: 'trailing' }
  return null
}

/** 出错位置的中文一句话描述 */
function locatedMessage(loc: LocatedError, raw: string): string {
  if (loc.kind === 'end') return 'JSON 不完整，内容在结束前就断了'
  if (loc.kind === 'trailing') return 'JSON 结束后还有多余的内容'
  if (loc.kind === 'trailingComma') return '这里多了一个逗号'
  if (loc.kind === 'unquotedKey') return '字段名没有用双引号包起来'
  if (loc.kind === 'missingColon') return '字段名后面少了冒号 :'
  if (loc.kind === 'emptyValue') return '这里应该有一个值，现在是空的（多了逗号或少了内容）'
  const ch = raw[loc.pos]
  return ch === undefined ? '这里的内容无法识别' : `这里有个无法识别的字符「${ch === '\n' ? '换行' : ch}」`
}

/** 解析输入；成功给 pretty（2 空格缩进），失败给带行列的错误 */
export function parseJsonText(raw: string): ParseResult {
  const text = raw.trim()
  if (!text) return { ok: false, error: { message: '内容为空', pos: -1, line: 1, col: 1, hint: '把 JSON 粘贴到左边' } }

  try {
    const value = JSON.parse(text) as JsonValue
    return { ok: true, value, pretty: JSON.stringify(value, null, 2) }
  } catch {
    // 新版 V8 报错不带位置且夹着技术上下文，用自写定位器拿到行列
    const loc = locateJsonError(text) ?? { pos: -1, kind: 'token' as ErrorKind }
    const lc = lineColAt(text, loc.pos)
    return {
      ok: false,
      error: {
        message: locatedMessage(loc, text),
        pos: loc.pos,
        line: lc.line,
        col: lc.col,
        hint: buildHint(loc.kind, text, loc.pos),
      },
    }
  }
}

/** 剥一层转义："{\"a\":1}" → {"a":1}；返回 null = 没有可剥的外层字符串 */
export function stripEscapes(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const inner = JSON.parse(text)
    if (typeof inner === 'string') return inner
    return null // 本身就是合法对象/数组，没有外层转义
  } catch {
    return null
  }
}

/** 压缩成单行 */
export function minifyJson(value: JsonValue): string {
  return JSON.stringify(value)
}

export interface JsonNodeInfo {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  /** object/array 的直接子项数 */
  count: number
  /** 标量值的简短预览 */
  preview: string
}

export function describeValue(v: JsonValue): JsonNodeInfo {
  if (v === null) return { type: 'null', count: 0, preview: 'null' }
  if (Array.isArray(v)) return { type: 'array', count: v.length, preview: `数组 ${v.length} 项` }
  const t = typeof v
  if (t === 'object') return { type: 'object', count: Object.keys(v as object).length, preview: `对象 ${Object.keys(v as object).length} 个字段` }
  if (t === 'string') {
    const s = String(v)
    return { type: 'string', count: 0, preview: s.length > 60 ? s.slice(0, 60) + '…' : s }
  }
  if (t === 'number' || t === 'boolean') return { type: t, count: 0, preview: String(v) }
  return { type: 'null', count: 0, preview: String(v) }
}

/** JSON 语法高亮 HTML（输入必须是 JSON.stringify 产出的合法 pretty 串） */
export function highlightJson(pretty: string): string {
  const esc = pretty
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return esc.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g,
    (m, str, colon, num, bool, nil) => {
      if (str !== undefined) {
        return colon ? `<span class="jk">${str}</span>${colon}` : `<span class="js">${str}</span>`
      }
      if (num !== undefined) return `<span class="jn">${num}</span>`
      if (bool !== undefined) return `<span class="jb">${bool}</span>`
      if (nil !== undefined) return `<span class="jl">${nil}</span>`
      return m
    }
  )
}

export interface JsonSearchHit {
  /** 从根到命中节点的路径段：对象键 / 数组下标 */
  path: (string | number)[]
  /** true=键名命中，false=标量值命中 */
  inKey: boolean
}

/** 树视图搜索态：由 JsonTool 计算后下发给每个树节点。集合 key = JSON.stringify(路径) */
export interface JsonTreeSearch {
  active: boolean
  keyword: string
  keyHits: Set<string>
  valueHits: Set<string>
  /** 需要强制展开的节点（命中节点及其祖先） */
  expand: Set<string>
  /** 当前跳转选中的节点路径 key */
  activeKey: string | null
  /** 自增信号：变化时选中节点滚动到可视区 */
  activeTick: number
}

/**
 * 深度优先搜索：对象键名 + 标量值，忽略大小写子串匹配。
 * 数组下标不当键名搜（搜 "0" 否则会命中所有数组元素）。
 */
export function searchJson(value: JsonValue, keyword: string): JsonSearchHit[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return []
  const hits: JsonSearchHit[] = []

  const walk = (node: JsonValue, path: (string | number)[]) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, i]))
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, JsonValue>)) {
        const next = [...path, k]
        if (k.toLowerCase().includes(kw)) hits.push({ path: next, inKey: true })
        walk(v, next)
      }
      return
    }
    const text = node === null ? 'null' : String(node)
    if (text.toLowerCase().includes(kw)) hits.push({ path, inKey: false })
  }

  walk(value, [])
  return hits
}

/**
 * 在语法高亮后的 HTML 里给关键词套 <mark>（跳过标签内部，避免把 class 名染了）。
 * 返回计数供上下跳转用。
 */
export function markKeywordInHtml(highlightedHtml: string, keyword: string): { html: string; count: number } {
  const kw = keyword.trim()
  if (!kw) return { html: highlightedHtml, count: 0 }
  const escKw = kw
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const re = new RegExp(`(${escKw})`, 'gi')

  let count = 0
  let out = ''
  let i = 0
  while (i < highlightedHtml.length) {
    if (highlightedHtml[i] === '<') {
      const end = highlightedHtml.indexOf('>', i)
      const stop = end < 0 ? highlightedHtml.length : end + 1
      out += highlightedHtml.slice(i, stop)
      i = stop
    } else {
      const next = highlightedHtml.indexOf('<', i)
      const segEnd = next < 0 ? highlightedHtml.length : next
      out += highlightedHtml.slice(i, segEnd).replace(re, (m) => `<mark class="j-find" data-i="${count++}">${m}</mark>`)
      i = segEnd
    }
  }
  return { html: out, count }
}

/** 顶层结构概览 */
export function summarize(value: JsonValue): string {
  const info = describeValue(value)
  if (info.type === 'array') return `数组，共 ${info.count} 项`
  if (info.type === 'object') return `对象，共 ${info.count} 个字段`
  return info.type === 'null' ? 'null' : `单个${info.type === 'string' ? '字符串' : info.type === 'number' ? '数字' : '布尔值'}`
}
