// 周报导出：两套骨架
// - 内部版（老板/项目组）= 变更台账：本周动作 + 拍板/待收口 + 全口径明细
// - 客户版 = 交付进展汇报：确认总览 + 本期定稿内容 + 待贵方确认（独立骨架，不做内部版过滤）
// 数据全部是后端聚合的事实；overview 是 AI 概述（可能为空，空则不渲染）
import { renderMarkdown } from './markdown'
import type { WeeklyReportData, WeeklyAudience } from '@/api'

const AUDIENCE_LABEL: Record<WeeklyAudience, string> = {
  boss: '呈报：管理层',
  client: '呈报：客户',
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function day(iso: string): string {
  return iso.slice(0, 10)
}
function today(): string {
  return day(new Date().toISOString())
}
/** PDF 综述标题由容器统一渲染，剥掉模型可能自作主张加的「本周综述」前缀，避免重复 */
function cleanOverview(md: string): string {
  return md
    .replace(/^#{1,6}\s*本周综述\s*\n?/g, '')
    .replace(/^\*{0,2}\s*本周综述\s*\*{0,2}[\s:：\n]*/g, '')
    .trim()
}
function kindLabel(k: string): string {
  return k === 'module' ? '模块' : k === 'page' ? '页面' : '想法'
}
function triggerLabel(t: string): string {
  return t === 'ai' ? 'AI 修订' : t === 'restore' ? '版本回滚' : '手动存版'
}
function actorCn(actor: string): string {
  if (!actor) return '系统'
  if (actor === 'user') return 'PM'
  if (actor.startsWith('ai:')) return 'AI'
  if (actor.startsWith('proposer:')) return `提出人 ${actor.slice(9)}`
  return actor
}

function fileBaseName(report: WeeklyReportData): string {
  const label = report.audience === 'client' ? '需求确认周报' : '需求变更周报'
  return `${report.projectName}-${label}-${day(report.from)}~${day(report.to)}`
}

function mdTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map((c) => (c || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function htmlTable(headers: string[], rows: string[][], widths?: string[]): string {
  const colgroup = widths ? `<colgroup>${widths.map((w) => `<col style="width:${w}">`).join('')}</colgroup>` : ''
  return `<table>${colgroup}<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`
}

/** 本周内确认、且当前仍处于已确认状态的需求（中途确认又被打回的不算定稿） */
function confirmedAndHeld(report: WeeklyReportData) {
  const pendingIds = new Set(report.snapshot.pending.map((p) => p.id))
  return report.statusChanges.filter(
    (c) => c.toStatus === 'confirmed' && !pendingIds.has(c.requirementId)
  )
}

const CN = ['一', '二', '三', '四', '五', '六', '七', '八']

// ============================================
// 客户版：交付进展汇报
// ============================================

function buildClientMarkdown(report: WeeklyReportData): string {
  const snap = report.snapshot
  const held = confirmedAndHeld(report)
  const pending = snap.pending
  const L: string[] = []

  L.push(`# ${report.projectName} · 需求确认周报`)
  L.push('')
  L.push(`> 周期：${day(report.from)} ~ ${day(report.to)}　｜　呈报：客户　｜　导出：${today()}`)
  L.push('')

  if (report.overview.trim()) {
    L.push(report.overview.trim())
    L.push('')
  }

  L.push(`## 项目确认总览`)
  L.push('')
  L.push(`- 功能模块：已确认 **${snap.confirmedModules} / ${snap.totalModules}**`)
  L.push(`- 业务页面：已确认 **${snap.confirmedPages} / ${snap.totalPages}**`)
  if (pending.length === 0) L.push('- 当前模块与页面已全部确认。')
  L.push('')

  if (held.length) {
    L.push(`## 本期定稿内容（${held.length}）`)
    L.push('')
    L.push(
      mdTable(['名称', '类型', '确认时间'],
        held.map((c) => [`《${c.title}》`, kindLabel(c.kind), fmtDate(c.createdAt)]))
    )
    L.push('')
  }

  if (pending.length) {
    L.push(`## 待贵方确认事项（${pending.length}）`)
    L.push('')
    L.push(
      mdTable(['事项', '类型'],
        pending.map((p) => [`《${p.title}》`, kindLabel(p.kind)]))
    )
    L.push('')
  }

  if (!held.length && !pending.length && !report.overview.trim()) {
    L.push('> 本周期内无需求变更。')
    L.push('')
  }

  L.push('---')
  L.push('*本周报由 ProtoForge 需求-原型工作台自动生成。*')
  return L.join('\n')
}

// ============================================
// 内部版：变更台账（老板 / 项目组）
// ============================================

function buildInternalMarkdown(report: WeeklyReportData): string {
  const s = report.stats
  const L: string[] = []
  L.push(`# ${report.projectName} · 需求变更周报`)
  L.push('')
  L.push(`> 周期：${day(report.from)} ~ ${day(report.to)}　｜　${AUDIENCE_LABEL[report.audience]}　｜　导出：${today()}`)
  L.push('')

  if (report.overview.trim()) {
    L.push(report.overview.trim())
    L.push('')
  }

  const rejected = report.statusChanges.filter((c) => c.toStatus === 'proposed')

  // 确定性行动项（不经 AI）：需要拍板/待确认。没有就整块不出现，不凑“无阻塞”
  if (rejected.length) {
    L.push(`## ⚠️ 需要您拍板（${rejected.length}）`)
    L.push('')
    L.push(
      mdTable(['事项', '类型', '原因/说明'],
        rejected.map((c) => [`《${c.title}》`, kindLabel(c.kind), c.note || '被打回重做']))
    )
    L.push('')
  }
  if (report.snapshot.pending.length) {
    L.push(`## 下周待收口（${report.snapshot.pending.length}）`)
    L.push('')
    L.push(
      mdTable(['事项', '类型'],
        report.snapshot.pending.map((p) => [`《${p.title}》`, kindLabel(p.kind)]))
    )
    if (s.openAnnotations > 0) {
      L.push('')
      L.push(`另有 **${s.openAnnotations}** 条原型评审意见未处理。`)
    }
    L.push('')
  }

  L.push('## 本周数据')
  L.push('')
  L.push(`新增模块 **${s.newModules}** · 新增页面 **${s.newPages}** · 确认 **${s.confirmed}** · 打回 **${s.rejected}** · 文档修订 **${s.revised}** · 需求池转正 **${s.promoted}** · 新决策 **${s.decisions}** · 原型新意见 **${s.newAnnotations}**（未处理 ${s.openAnnotations}）`)
  L.push('')

  // 章节按出现顺序连续编号，避免缺项时断号
  let sec = 0
  const section = (title: string, body: string[]) => {
    L.push(`## ${CN[sec]}、${title}`)
    L.push('')
    L.push(...body)
    L.push('')
    sec += 1
  }

  if (report.created.length) {
    section('新增需求', [
      mdTable(['名称', '类型', '提出/操作人', '时间'],
        report.created.map((c) => [`《${c.title}》`, kindLabel(c.kind), actorCn(c.actor), fmtDate(c.createdAt)])),
    ])
  }

  if (report.statusChanges.length) {
    section('需求状态变更', [
      mdTable(['名称', '类型', '变更', '操作人', '时间'],
        report.statusChanges.map((c) => [
          `《${c.title}》`, kindLabel(c.kind),
          c.toStatus === 'confirmed' ? '✅ 已确认' : '↩️ 打回重做',
          actorCn(c.actor), fmtDate(c.createdAt),
        ])),
    ])
  }

  if (report.promotions.length) {
    section('需求池转正', [
      mdTable(['名称', '类型', '操作人', '时间'],
        report.promotions.map((c) => [`《${c.title}》`, kindLabel(c.kind), actorCn(c.actor), fmtDate(c.createdAt)])),
    ])
  }

  if (report.revisions.length) {
    section('需求文档修订', [
      mdTable(['名称', '类型', '版本', '方式', '说明', '操作人', '时间'],
        report.revisions.map((c) => [
          `《${c.title}》`, kindLabel(c.kind),
          `v${c.versionNo}`, triggerLabel(c.trigger), c.note || '—',
          actorCn(c.actor), fmtDate(c.createdAt),
        ])),
    ])
  }

  if (report.decisions.length) {
    section('新拍板设计决策', report.decisions.map((d, i) =>
      `${i + 1}. **${d.topic}**${d.point ? `（${d.point}）` : ''}：${d.conclusion || '（无结论描述）'}`))
  }

  if (report.newAnnotations.length) {
    section('原型评审意见（本周新增）', [
      mdTable(['页面', '标注对象', '意见', '提出人'],
        report.newAnnotations.map((a) => [a.pageTitle, a.targetLabel || '—', a.content, a.author || '匿名'])),
    ])
  }

  if (report.openAnnotations.length) {
    section(`未处理意见（${report.openAnnotations.length} 条）`, [
      mdTable(['页面', '标注对象', '意见', '提出人'],
        report.openAnnotations.map((a) => [a.pageTitle, a.targetLabel || '—', a.content, a.author || '匿名'])),
    ])
  }

  if (sec === 0) {
    L.push('> 本周期内没有需求变更记录。')
    L.push('')
  }

  L.push('---')
  L.push('*本周报由 ProtoForge 需求-原型工作台自动生成，变更记录可在需求文档版本历史中逐项追溯。*')
  return L.join('\n')
}

export function buildWeeklyMarkdown(report: WeeklyReportData): string {
  return report.audience === 'client'
    ? buildClientMarkdown(report)
    : buildInternalMarkdown(report)
}

// ============================================
// PDF 共享样式
// ============================================

const PDF_STYLES = `
  @page { margin: 15mm 15mm 17mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
    color: #1a1d29; line-height: 1.75; font-size: 12px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  .cover {
    background:
      radial-gradient(520px 340px at 90% -8%, rgba(139,92,246,.14), transparent 60%),
      radial-gradient(560px 380px at -12% 104%, rgba(99,102,241,.12), transparent 60%),
      linear-gradient(160deg, #fbfbff 0%, #f5f6fe 55%, #faf8ff 100%);
    border: 1px solid #e9e7fc; border-radius: 16px;
    padding: 26px 30px 24px; margin-bottom: 20px;
  }
  .cover-brand { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 700; }
  .cover-brand .logo { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg,#6366f1,#8b5cf6); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(99,102,241,.3); }
  .cover-brand .logo svg { width: 15px; height: 15px; }
  .cover-brand em { font-style: normal; color: #6366f1; }
  .kicker { display:inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: 3px; color: #6366f1; background:#eef0ff; border:1px solid #e0e3ff; padding: 5px 12px; border-radius: 999px; margin: 18px 0 12px; }
  h1 { font-size: 28px; font-weight: 800; margin: 0; line-height: 1.3; }
  .meta-line { margin-top: 12px; font-size: 11.5px; color: #5b6172; display: flex; gap: 18px; flex-wrap: wrap; }
  .meta-line b { color: #1a1d29; }

  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 4px; }
  .stat { flex: 1 1 80px; background: rgba(255,255,255,.85); border: 1px solid #e7e8ee; border-radius: 10px; padding: 9px 10px; text-align: center; box-shadow: 0 1px 3px rgba(17,24,39,.05); }
  .stat-n { font-size: 20px; font-weight: 800; color: #4f46e5; line-height: 1.1; }
  .stat-l { font-size: 10.5px; color: #9aa0b0; margin-top: 3px; }

  .overview { background: #fff; border: 1px solid #e7e8ee; border-left: 4px solid #6366f1; border-radius: 0 12px 12px 0; padding: 14px 18px; margin: 18px 0 8px; }
  .overview-title { font-size: 13px; font-weight: 800; color: #4338ca; margin-bottom: 6px; }
  .overview p { margin: 6px 0; }
  .overview strong { color: #1a1d29; }

  section { margin-top: 20px; page-break-inside: auto; }
  h2 { font-size: 16px; font-weight: 800; margin: 0 0 10px; padding-left: 10px; border-left: 4px solid #6366f1; page-break-after: avoid; }
  table { border-collapse: separate; border-spacing: 0; width: 100%; border: 1px solid #e7e8ee; border-radius: 10px; overflow: hidden; font-size: 11px; page-break-inside: auto; }
  thead th { background: linear-gradient(180deg,#f3f4fe,#eef0ff); color: #4338ca; font-weight: 700; padding: 7px 10px; text-align: left; border-bottom: 1px solid #e0e3ff; }
  tbody td { padding: 6px 10px; border-bottom: 1px solid #f0f1f5; vertical-align: top; text-align: left; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) td { background: #fafafe; }
  .tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 9px; border-radius: 999px; }
  .tag-green { color: #047857; background: #e7f8f2; }
  .tag-amber { color: #b45309; background: #fef3e2; }

  .action-block { margin-top: 18px; page-break-inside: avoid; }
  .action-block h2 { padding-left: 10px; }
  .action-warn h2 { border-left: 4px solid #f59e0b; }
  .action-todo h2 { border-left: 4px solid #6366f1; }
  .h-warn { color: #b45309 !important; }
  .h-todo { color: #4338ca !important; }
  .action-warn table { border-color: #ecdcc4; }
  .action-warn thead th { background: linear-gradient(180deg,#fdf3e4,#fbe9d2) !important; color: #92400e !important; border-bottom-color: #f0d9b8 !important; }
  .pending-note { margin: 8px 2px 0; font-size: 11px; color: #5b6172; }

  .decision-list { display: flex; flex-direction: column; gap: 8px; }
  .decision-item { background: #fff; border: 1px solid #e7e8ee; border-radius: 10px; padding: 10px 14px; page-break-inside: avoid; }
  .decision-topic { font-size: 12.5px; font-weight: 700; }
  .decision-point { font-size: 10.5px; font-weight: 600; color: #6d28d9; background: #f1eefe; border-radius: 6px; padding: 1px 8px; margin-left: 8px; }
  .decision-conc { font-size: 11.5px; color: #3d4250; margin-top: 4px; }

  .progress-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
  .progress-row:last-child { margin-bottom: 0; }
  .progress-label { width: 72px; flex: none; font-size: 12px; font-weight: 600; }
  .progress-track { flex: 1; height: 10px; border-radius: 999px; background: #eef0f7; overflow: hidden; }
  .progress-bar { height: 100%; border-radius: 999px; background: linear-gradient(90deg,#6366f1,#8b5cf6); }
  .progress-n { width: 96px; flex: none; text-align: right; font-size: 11.5px; color: #4338ca; font-weight: 700; font-variant-numeric: tabular-nums; }
  .progress-card { background: #fff; border: 1px solid #e7e8ee; border-radius: 12px; padding: 14px 18px; }

  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e7e8ee; font-size: 10px; color: #9aa0b0; text-align: center; }
`

function pdfCover(report: WeeklyReportData, kicker: string, statCards: string): string {
  return `
  <div class="cover">
    <div class="cover-brand">
      <span class="logo"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.2L21 9l-5 4.2L17.5 20 12 16.4 6.5 20 8 13.2 3 9l6.6-.8L12 2z" fill="#fff"/></svg></span>
      Proto<em>Forge</em>
    </div>
    <span class="kicker">${esc(kicker)}</span>
    <h1>${esc(report.projectName)}</h1>
    <div class="meta-line">
      <span>周期 <b>${day(report.from)} ~ ${day(report.to)}</b></span>
      <span>${esc(AUDIENCE_LABEL[report.audience])}</span>
      <span>导出日期 <b>${today()}</b></span>
    </div>
    <div class="stats">${statCards}</div>
  </div>`
}

function pdfOverview(overview: string, title = '本周综述'): string {
  const text = cleanOverview(overview)
  return text
    ? `<div class="overview"><div class="overview-title">${esc(title)}</div>${renderMarkdown(text)}</div>`
    : ''
}

function pdfShell(report: WeeklyReportData, body: string, footerTrace = true): string {
  const foot = footerTrace
    ? '由 ProtoForge 需求-原型工作台自动生成 · 变更记录可在需求文档版本历史中逐项追溯'
    : '由 ProtoForge 需求-原型工作台自动生成'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${esc(report.projectName)} 需求周报</title>
<style>${PDF_STYLES}</style>
</head>
<body>
${body}
  <div class="foot">${foot}</div>
</body>
</html>`
}

// ============================================
// 客户版 PDF
// ============================================

function buildClientPdfHtml(report: WeeklyReportData): string {
  const snap = report.snapshot
  const held = confirmedAndHeld(report)
  const pending = snap.pending

  const stat = (n: string, l: string) =>
    `<div class="stat"><div class="stat-n">${esc(n)}</div><div class="stat-l">${esc(l)}</div></div>`
  const statCards = [
    stat(`${snap.confirmedModules}/${snap.totalModules}`, '模块已确认'),
    stat(`${snap.confirmedPages}/${snap.totalPages}`, '页面已确认'),
    stat(String(held.length), '本期定稿'),
    stat(String(pending.length), '待贵方确认'),
  ].join('')

  const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0)
  const progressRow = (label: string, done: number, total: number) => {
    const p = pct(done, total)
    return `<div class="progress-row">
      <div class="progress-label">${esc(label)}</div>
      <div class="progress-track"><div class="progress-bar" style="width:${p}%"></div></div>
      <div class="progress-n">${done}/${total} · ${p}%</div>
    </div>`
  }

  const blocks: string[] = [pdfCover(report, '需求确认周报', statCards), pdfOverview(report.overview)]

  let sec = 0
  const section = (title: string, body: string) => {
    blocks.push(`<section><h2>${CN[sec]}、${title}</h2>${body}</section>`)
    sec += 1
  }

  section('项目确认总览', `<div class="progress-card">
    ${progressRow('功能模块', snap.confirmedModules, snap.totalModules)}
    ${progressRow('业务页面', snap.confirmedPages, snap.totalPages)}
  </div>`)

  if (held.length) {
    section(`本期定稿内容（${held.length}）`, htmlTable(
      ['名称', '类型', '确认时间'],
      held.map((c) => [
        `<strong>《${esc(c.title)}》</strong>`, kindLabel(c.kind), fmtDate(c.createdAt),
      ]),
      ['', '16%', '22%']
    ))
  }

  if (pending.length) {
    // 收尾的行动召唤：蓝色高亮卡
    blocks.push(`<section class="action-block action-todo"><h2 class="h-todo">${CN[sec]}、待贵方确认事项（${pending.length}）</h2>${htmlTable(
      ['事项', '类型'],
      pending.map((p) => [`<strong>《${esc(p.title)}》</strong>`, kindLabel(p.kind)]),
      ['', '20%']
    )}</section>`)
    sec += 1
  }

  if (!held.length && !pending.length && !cleanOverview(report.overview)) {
    blocks.push('<p style="color:#9aa0b0;font-size:12px;margin-top:20px;">本周期内无需求变更。</p>')
  }

  return pdfShell(report, blocks.join('\n'), false)
}

// ============================================
// 内部版 PDF（老板 / 项目组）
// ============================================

function buildInternalPdfHtml(report: WeeklyReportData): string {
  const s = report.stats
  const rejected = report.statusChanges.filter((c) => c.toStatus === 'proposed')
  const sections: string[] = []
  // 确定性行动项（不经 AI）：置于编号明细之前的高亮块，没有就不渲染
  const actionBlocks: string[] = []
  if (rejected.length) {
    actionBlocks.push(`<section class="action-block action-warn"><h2 class="h-warn">需要您拍板（${rejected.length}）</h2>${htmlTable(
      ['事项', '类型', '原因/说明'],
      rejected.map((c) => [
        `<strong>《${esc(c.title)}》</strong>`, kindLabel(c.kind), esc(c.note || '被打回重做'),
      ]),
      ['', '14%', '']
    )}</section>`)
  }
  if (report.snapshot.pending.length) {
    const extraNote = s.openAnnotations > 0
      ? `<p class="pending-note">另有 <strong>${s.openAnnotations}</strong> 条原型评审意见未处理。</p>`
      : ''
    actionBlocks.push(`<section class="action-block action-todo"><h2 class="h-todo">下周待收口（${report.snapshot.pending.length}）</h2>${htmlTable(
      ['事项', '类型'],
      report.snapshot.pending.map((p) => [`<strong>《${esc(p.title)}》</strong>`, kindLabel(p.kind)]),
      ['', '20%']
    )}${extraNote}</section>`)
  }
  // 章节按出现顺序连续编号，避免缺项时断号
  let sec = 0
  const section = (title: string, body: string) => {
    sections.push(`<section><h2>${CN[sec]}、${title}</h2>${body}</section>`)
    sec += 1
  }

  if (report.created.length) {
    section('新增需求', htmlTable(
      ['名称', '类型', '提出/操作人', '时间'],
      report.created.map((c) => [
        `<strong>《${esc(c.title)}》</strong>`, kindLabel(c.kind), esc(actorCn(c.actor)), fmtDate(c.createdAt),
      ]),
      ['', '12%', '18%', '18%']
    ))
  }
  if (report.statusChanges.length) {
    section('需求状态变更', htmlTable(
      ['名称', '类型', '变更', '操作人', '时间'],
      report.statusChanges.map((c) => [
        `<strong>《${esc(c.title)}》</strong>`,
        kindLabel(c.kind),
        c.toStatus === 'confirmed' ? '<span class="tag tag-green">已确认</span>' : '<span class="tag tag-amber">打回重做</span>',
        esc(actorCn(c.actor)),
        fmtDate(c.createdAt),
      ]),
      ['', '10%', '14%', '14%', '16%']
    ))
  }
  if (report.promotions.length) {
    section('需求池转正', htmlTable(
      ['名称', '类型', '操作人', '时间'],
      report.promotions.map((c) => [
        `<strong>《${esc(c.title)}》</strong>`, kindLabel(c.kind), esc(actorCn(c.actor)), fmtDate(c.createdAt),
      ]),
      ['', '12%', '18%', '18%']
    ))
  }
  if (report.revisions.length) {
    section('需求文档修订', htmlTable(
      ['名称', '版本', '方式', '说明', '操作人', '时间'],
      report.revisions.map((c) => [
        `<strong>《${esc(c.title)}》</strong>`,
        `v${c.versionNo}`,
        triggerLabel(c.trigger),
        esc(c.note || '—'),
        esc(actorCn(c.actor)),
        fmtDate(c.createdAt),
      ]),
      ['', '8%', '12%', '', '12%', '15%']
    ))
  }
  if (report.decisions.length) {
    section('新拍板设计决策', `<div class="decision-list">${report.decisions
      .map(
        (d) =>
          `<div class="decision-item"><div class="decision-topic">${esc(d.topic)}${d.point ? `<span class="decision-point">${esc(d.point)}</span>` : ''}</div><div class="decision-conc">${esc(d.conclusion || '（无结论描述）')}</div></div>`
      )
      .join('')}</div>`)
  }
  if (report.newAnnotations.length) {
    section('原型评审意见（本周新增）', htmlTable(
      ['页面', '标注对象', '意见', '提出人'],
      report.newAnnotations.map((a) => [
        esc(a.pageTitle), esc(a.targetLabel || '—'), esc(a.content), esc(a.author || '匿名'),
      ]),
      ['16%', '16%', '', '12%']
    ))
  }
  if (report.openAnnotations.length) {
    section(`未处理意见（${report.openAnnotations.length} 条）`, htmlTable(
      ['页面', '标注对象', '意见', '提出人'],
      report.openAnnotations.map((a) => [
        esc(a.pageTitle), esc(a.targetLabel || '—'), esc(a.content), esc(a.author || '匿名'),
      ]),
      ['16%', '16%', '', '12%']
    ))
  }

  const statCardDefs = [
    { n: s.newModules, l: '新增模块' },
    { n: s.newPages, l: '新增页面' },
    { n: s.confirmed, l: '确认' },
    { n: s.rejected, l: '打回' },
    { n: s.revised, l: '文档修订' },
    { n: s.decisions, l: '新决策' },
    { n: s.openAnnotations, l: '未处理意见' },
  ]
  const statCards = statCardDefs
    .map(
      (c) =>
        `<div class="stat"><div class="stat-n">${c.n}</div><div class="stat-l">${esc(c.l)}</div></div>`
    )
    .join('')

  const body = [
    pdfCover(report, '需求变更周报', statCards),
    pdfOverview(report.overview),
    actionBlocks.join('\n'),
    sections.join('\n'),
    sec === 0 && !actionBlocks.length
      ? '<p style="color:#9aa0b0;font-size:12px;margin-top:20px;">本周期内没有需求变更记录。</p>'
      : '',
  ].join('\n')

  return pdfShell(report, body)
}

export function buildWeeklyPdfHtml(report: WeeklyReportData): string {
  return report.audience === 'client'
    ? buildClientPdfHtml(report)
    : buildInternalPdfHtml(report)
}

export function downloadWeeklyMarkdown(report: WeeklyReportData) {
  const md = buildWeeklyMarkdown(report)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileBaseName(report)}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function exportWeeklyPdf(report: WeeklyReportData): Promise<void> {
  const html = buildWeeklyPdfHtml(report)
  const resp = await fetch('/api/prd/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, fileName: fileBaseName(report) }),
  })
  if (!resp.ok) {
    let msg = `PDF 生成失败（${resp.status}）`
    try {
      const data = await resp.json()
      if (data?.error) msg = data.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileBaseName(report)}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
