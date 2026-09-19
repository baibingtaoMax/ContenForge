// 行级 LCS diff（markdown 文档版本对比用，零依赖）
// 返回合并后的行序列，按对方视角对齐（增/删行成对出现，相同行各一条）

export type DiffOp = 'same' | 'add' | 'del'

export interface DiffLine {
  op: DiffOp
  oldNo: number | null // 旧版本行号（从 1 起），新增行为 null
  newNo: number | null // 新版本行号
  text: string
}

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length

  // LCS 动态规划表（行数级，文档通常几百行，可接受）
  const dp: Uint32Array[] = new Array(n + 1)
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', oldNo: i + 1, newNo: j + 1, text: a[i] })
      i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'del', oldNo: i + 1, newNo: null, text: a[i] })
      i++
    } else {
      out.push({ op: 'add', oldNo: null, newNo: j + 1, text: b[j] })
      j++
    }
  }
  while (i < n) { out.push({ op: 'del', oldNo: i + 1, newNo: null, text: a[i] }); i++ }
  while (j < m) { out.push({ op: 'add', oldNo: null, newNo: j + 1, text: b[j] }); j++ }
  return out
}

/** 统计增删行数 */
export function diffStats(lines: DiffLine[]): { adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const l of lines) {
    if (l.op === 'add') adds++
    else if (l.op === 'del') dels++
  }
  return { adds, dels }
}
