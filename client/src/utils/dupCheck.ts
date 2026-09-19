// 重复数据检查：两份一行一条的文本，找交集/差集 + 单份内部重复。纯前端零依赖。

export interface LineItem {
  /** 归一化后的文本（去首尾空格） */
  value: string
  /** 在所属输入里出现的次数 */
  count: number
  /** 首次出现的行号（1 起） */
  firstLine: number
  /** 所有出现的行号 */
  lines: number[]
}

export interface DupResult {
  a: SideStat
  b: SideStat
  /** 两边都有的唯一值，按 A 中首次出现排序 */
  both: CommonItem[]
  /** 仅 A 有，按首次出现排序 */
  onlyA: LineItem[]
  /** 仅 B 有 */
  onlyB: LineItem[]
}

export interface SideStat {
  /** 非空行总数（含重复） */
  total: number
  /** 去重后条数 */
  unique: number
  /** 重复值（出现 >1 次），按首次出现排序 */
  dups: LineItem[]
  /** 因重复多出的行数 = total - unique */
  extraCount: number
  map: Map<string, LineItem>
}

export interface CommonItem {
  value: string
  countA: number
  countB: number
  firstLineA: number
  firstLineB: number
}

/** 拆行：按换行切、去首尾空白、丢空行；保留原始顺序和行号 */
export function parseLines(raw: string): { value: string; line: number }[] {
  const out: { value: string; line: number }[] = []
  raw.split(/\r?\n/).forEach((text, i) => {
    const value = text.trim()
    if (value) out.push({ value, line: i + 1 })
  })
  return out
}

function buildSide(entries: { value: string; line: number }[]): SideStat {
  const map = new Map<string, LineItem>()
  for (const { value, line } of entries) {
    const item = map.get(value)
    if (item) {
      item.count++
      item.lines.push(line)
    } else {
      map.set(value, { value, count: 1, firstLine: line, lines: [line] })
    }
  }
  const dups = [...map.values()].filter((it) => it.count > 1)
  const total = entries.length
  return {
    total,
    unique: map.size,
    dups,
    extraCount: total - map.size,
    map,
  }
}

/** 主入口：两份文本 → 交集/差集/各自内部重复 */
export function checkDup(rawA: string, rawB: string): DupResult {
  const a = buildSide(parseLines(rawA))
  const b = buildSide(parseLines(rawB))

  const both: CommonItem[] = []
  const onlyA: LineItem[] = []
  // 交集与仅 A 按 A 的首次出现顺序遍历
  for (const item of a.map.values()) {
    const inB = b.map.get(item.value)
    if (inB) {
      both.push({
        value: item.value,
        countA: item.count,
        countB: inB.count,
        firstLineA: item.firstLine,
        firstLineB: inB.firstLine,
      })
    } else {
      onlyA.push(item)
    }
  }
  const onlyB: LineItem[] = []
  for (const item of b.map.values()) {
    if (!a.map.has(item.value)) onlyB.push(item)
  }

  return { a, b, both, onlyA, onlyB }
}

/** 结果列表导成纯文本（每行一个值），供复制 */
export function itemsToText(items: { value: string }[]): string {
  return items.map((it) => it.value).join('\n')
}
