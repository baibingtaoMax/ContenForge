// 字符级 LCS：配对的删/增行做行内高亮（中文整段改一句话也能定位到字）
// 零依赖。超长行（乘积超阈值）退化为整段标红/标绿，不卡死输入
import type { DiffLine } from './lineDiff'

export type CharOp = 'same' | 'add' | 'del'

export interface CharSeg {
  op: CharOp
  text: string
}

/** DP 单元格上限：两行字符数之积超过它就不做字符级（约 2000×2000） */
const MAX_CELLS = 4_000_000

export function charDiff(oldText: string, newText: string): CharSeg[] {
  const a = [...oldText]
  const b = [...newText]
  const n = a.length
  const m = b.length

  if (!n && !m) return []
  if (n * m > MAX_CELLS) {
    const out: CharSeg[] = []
    if (n) out.push({ op: 'del', text: oldText })
    if (m) out.push({ op: 'add', text: newText })
    return out
  }

  const dp = new Uint32Array((n + 1) * (m + 1))
  const at = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] =
        a[i] === b[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)])
    }
  }

  const raw: CharSeg[] = []
  let i = 0
  let j = 0
  const push = (op: CharOp, ch: string) => {
    const last = raw[raw.length - 1]
    if (last && last.op === op) last.text += ch
    else raw.push({ op, text: ch })
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++; j++
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      push('del', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < n) { push('del', a[i]); i++ }
  while (j < m) { push('add', b[j]); j++ }
  return raw
}

// ============================================
// 行级统一序列 → 左右双栏行对
// ============================================

export type RowOp = 'same' | 'add' | 'del' | 'mod'

export interface DiffRow {
  op: RowOp
  oldLine: DiffLine | null
  newLine: DiffLine | null
  /** 行内字符级片段：mod 时两侧各自计算；其余为 null */
  oldSegs: CharSeg[] | null
  newSegs: CharSeg[] | null
}

export type FoldSegment =
  | { type: 'row'; row: DiffRow }
  | { type: 'block'; rows: DiffRow[]; key: number }

/** 连续 same 行（≥minRun）收成折叠块；差异行单独成段 */
export function foldRows(rows: DiffRow[], minRun = 3): FoldSegment[] {
  const out: FoldSegment[] = []
  let run: DiffRow[] = []
  let key = 0
  const flush = () => {
    if (run.length >= minRun) out.push({ type: 'block', rows: run, key: key++ })
    else run.forEach((row) => out.push({ type: 'row', row }))
    run = []
  }
  for (const row of rows) {
    if (row.op === 'same') run.push(row)
    else { flush(); out.push({ type: 'row', row }) }
  }
  flush()
  return out
}

/**
 * lineDiff 的输出是统一序列（del/add 可能相邻成块）。
 * 双栏视图需要行对：same 占两侧；相邻 del/add 块按位置 zip，
 * 两边都有的 = mod（行内高亮），单边的 = 纯删/纯增。
 */
export function pairRows(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = []
  let k = 0
  while (k < lines.length) {
    const l = lines[k]
    if (l.op === 'same') {
      rows.push({ op: 'same', oldLine: l, newLine: l, oldSegs: null, newSegs: null })
      k++
      continue
    }
    // 收集相邻的 del/add 块（中间无 same）
    const dels: DiffLine[] = []
    const adds: DiffLine[] = []
    while (k < lines.length && lines[k].op !== 'same') {
      if (lines[k].op === 'del') dels.push(lines[k])
      else adds.push(lines[k])
      k++
    }
    const len = Math.max(dels.length, adds.length)
    for (let t = 0; t < len; t++) {
      const d = dels[t] || null
      const a2 = adds[t] || null
      if (d && a2) {
        rows.push({
          op: 'mod',
          oldLine: d,
          newLine: a2,
          oldSegs: charDiff(d.text, a2.text),
          newSegs: charDiff(d.text, a2.text),
        })
      } else if (d) {
        rows.push({ op: 'del', oldLine: d, newLine: null, oldSegs: null, newSegs: null })
      } else {
        rows.push({ op: 'add', oldLine: null, newLine: a2, oldSegs: null, newSegs: null })
      }
    }
  }
  return rows
}
