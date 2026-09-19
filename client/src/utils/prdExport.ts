// ProtoForge：PRD 导出（从需求文档拼装，不从代码反推）
// - Markdown：直接下载
// - PDF：buildPrdPdfHtml 组装排版 HTML → POST /api/prd/export-pdf
//   后端用本机 Chrome 无头打印为矢量 PDF（文字可选、背景精确），前端下载 .pdf
//   注意：模板内禁用 background-clip:text 渐变文字（Chrome 打印会渲染成方块），用纯色
import type { Requirement } from '@/types'
import { renderMarkdown } from './markdown'

export interface PrdGroup {
  module: Requirement | null
  pages: Requirement[]
}

/** 标题整体降级 n 级（需求文档内部用 ## 开头，拼进大文档要让位） */
function demoteHeadings(md: string, by: number): string {
  const prefix = '#'.repeat(by)
  return md
    .split('\n')
    .map((line) => (/^#{1,6}\s/.test(line) ? prefix + line : line))
    .join('\n')
}

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 只保留已确认；模块未确认时其下已确认页面兜底进附录 */
export function toConfirmedGroups(groups: PrdGroup[]): PrdGroup[] {
  const out: PrdGroup[] = []
  const orphans: Requirement[] = []
  for (const g of groups) {
    const pages = g.pages.filter((p) => p.status === 'confirmed')
    if (g.module && g.module.status === 'confirmed') {
      out.push({ module: g.module, pages })
    } else {
      orphans.push(...pages)
    }
  }
  if (orphans.length) out.push({ module: null, pages: orphans })
  return out
}

export function prdStats(groups: PrdGroup[]) {
  return {
    modules: groups.filter((g) => g.module).length,
    pages: groups.reduce((n, g) => n + g.pages.length, 0),
  }
}

/** 章节编号：模块 1、2、3；页面 1.1、1.2；未分组页面 附1、附2 */
function sectionNo(mi: number, pi: number, hasModule: boolean): string {
  return hasModule ? `${mi}.${pi + 1}` : `附${pi + 1}`
}

export function buildPrdMarkdown(projectName: string, groups: PrdGroup[]): string {
  const stats = prdStats(groups)
  const L: string[] = []
  L.push(`# ${projectName} 产品需求文档（PRD）`)
  L.push('')
  L.push(`> 导出日期：${today()}　｜　${stats.modules} 个模块 / ${stats.pages} 个页面（均为已确认）`)
  L.push('')
  L.push('## 目录')
  let mi = 0
  groups.forEach((g) => {
    if (g.module) {
      mi++
      L.push(`- ${mi}. ${g.module.title}`)
    }
    g.pages.forEach((p, pi) =>
      L.push(`  - ${sectionNo(mi, pi, !!g.module)} ${p.title}`)
    )
  })
  L.push('')
  L.push('---')
  L.push('')
  mi = 0
  groups.forEach((g) => {
    if (g.module) {
      mi++
      L.push(`## ${mi}. ${g.module.title}`)
      L.push('')
      L.push(demoteHeadings(g.module.doc_md || '（暂无文档）', 1))
      L.push('')
    }
    g.pages.forEach((p, pi) => {
      const no = sectionNo(mi, pi, !!g.module)
      L.push(`### ${no} ${p.title}`)
      L.push('')
      L.push(demoteHeadings(p.doc_md || '（暂无文档）', 2))
      L.push('')
    })
  })
  return L.join('\n')
}

export function downloadMarkdown(projectName: string, md: string) {
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projectName}-PRD.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 组装 PDF 用 HTML（封面 + 目录 + 正文）；交给后端 Chrome 无头打印为矢量 PDF */
export function buildPrdPdfHtml(projectName: string, groups: PrdGroup[]): string {
  const stats = prdStats(groups)
  const toc: string[] = []
  const body: string[] = []
  let mi = 0

  groups.forEach((g) => {
    if (g.module) {
      mi++
      toc.push(
        `<a class="toc-chapter" href="#sec-${mi}"><span class="toc-no">${mi}</span><span class="toc-name">${escapeHtml(g.module.title)}</span>${g.pages.length ? `<span class="toc-count">${g.pages.length} 个页面</span>` : ''}</a>`
      )
    }
    g.pages.forEach((p, pi) => {
      const no = sectionNo(mi, pi, !!g.module)
      const id = g.module ? `sec-${mi}-${pi + 1}` : `sec-app-${pi + 1}`
      toc.push(
        `<a class="toc-page ${g.module ? '' : 'toc-orphan'}" href="#${id}"><span class="toc-page-no">${no}</span><span class="toc-name">${escapeHtml(p.title)}</span></a>`
      )
    })
  })

  mi = 0
  groups.forEach((g) => {
    if (g.module) {
      mi++
      body.push(`
        <section class="chapter" id="sec-${mi}">
          <div class="chapter-head">
            <div class="chapter-bigno">${String(mi).padStart(2, '0')}</div>
            <div class="chapter-titles">
              <span class="kind-badge kind-module">模块</span>
              <h2>${escapeHtml(g.module.title)}</h2>
              <div class="chapter-rule"></div>
            </div>
          </div>
          <div class="doc">${renderMarkdown(demoteHeadings(g.module.doc_md || '（暂无文档）', 1))}</div>
        </section>`)
    }
    g.pages.forEach((p, pi) => {
      const no = sectionNo(mi, pi, !!g.module)
      const id = g.module ? `sec-${mi}-${pi + 1}` : `sec-app-${pi + 1}`
      body.push(`
        <section class="page-block" id="${id}">
          <div class="page-head">
            <span class="page-no">${no}</span>
            <h3>${escapeHtml(p.title)}</h3>
            <span class="kind-badge kind-page">页面</span>
          </div>
          <div class="doc">${renderMarkdown(demoteHeadings(p.doc_md || '（暂无文档）', 2))}</div>
        </section>`)
    })
  })

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(projectName)} 产品需求文档</title>
<style>
  @page { margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
    color: #1a1d29; line-height: 1.8; font-size: 12.5px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  a { color: inherit; text-decoration: none; }

  /* ============ 封面 ============ */
  .cover {
    position: relative;
    min-height: 262mm;
    page-break-after: always;
    background:
      radial-gradient(560px 380px at 88% -6%, rgba(139,92,246,.14), transparent 60%),
      radial-gradient(620px 420px at -10% 108%, rgba(99,102,241,.12), transparent 60%),
      linear-gradient(160deg, #fbfbff 0%, #f5f6fe 55%, #faf8ff 100%);
    border-radius: 0 0 18px 18px;
    padding: 30mm 22mm 20mm;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .cover-brand { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 700; color: #1a1d29; }
  .cover-brand .logo { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 16px rgba(99,102,241,.35); }
  .cover-brand .logo svg { width: 17px; height: 17px; }
  .cover-brand em { font-style: normal; color: #6366f1; }
  .cover-center { margin: auto 0; }
  .cover .kicker {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 700; letter-spacing: 3px; color: #6366f1;
    background: #eef0ff; border: 1px solid #e0e3ff;
    padding: 6px 14px; border-radius: 999px; margin-bottom: 22px;
  }
  .cover h1 { font-size: 38px; line-height: 1.32; margin: 0; font-weight: 800; letter-spacing: .5px; }
  /* 注意：Chrome 打印 PDF 时 background-clip:text 渐变文字会渲染成方块，PDF 模板一律用纯色文字 */
  .cover h1 .grad { color: #6366f1; }
  .cover .sub { font-size: 17px; color: #5b6172; margin-top: 10px; font-weight: 500; }
  .cover .rule { width: 64px; height: 5px; border-radius: 3px; background: linear-gradient(90deg, #6366f1, #8b5cf6); margin: 26px 0; }
  .cover-stats { display: flex; gap: 12px; }
  .stat-card {
    background: rgba(255,255,255,.82); border: 1px solid #e7e8ee; border-radius: 12px;
    padding: 12px 20px; box-shadow: 0 6px 20px rgba(17,24,39,.06);
    display: flex; align-items: center; gap: 12px;
  }
  .stat-ico { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .stat-ico svg { width: 17px; height: 17px; }
  .stat-ico.indigo { background: #eef0ff; color: #6366f1; }
  .stat-ico.violet { background: #f1eefe; color: #7c3aed; }
  .stat-ico.slate { background: #eef1f6; color: #475569; }
  .stat-num { font-size: 19px; font-weight: 800; line-height: 1.1; }
  .stat-lab { font-size: 11px; color: #9aa0b0; font-weight: 600; }
  .cover-foot { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #9aa0b0; }

  /* ============ 目录 ============ */
  .toc-page-wrap { page-break-after: always; padding-top: 6mm; }
  .toc-title { font-size: 22px; font-weight: 800; margin: 0 0 4px; }
  .toc-title-sub { font-size: 12px; color: #9aa0b0; margin-bottom: 20px; }
  .toc-chapter {
    display: flex; align-items: center; gap: 12px;
    background: #fff; border: 1px solid #e7e8ee; border-radius: 12px;
    padding: 12px 16px; margin: 10px 0 0; box-shadow: 0 1px 3px rgba(17,24,39,.05);
    page-break-inside: avoid;
  }
  .toc-no {
    width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0;
    background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; font-weight: 800;
  }
  .toc-name { font-size: 14.5px; font-weight: 700; flex: 1; }
  .toc-count { font-size: 11.5px; color: #6366f1; background: #eef0ff; border-radius: 999px; padding: 3px 10px; font-weight: 600; }
  .toc-page { display: flex; align-items: center; gap: 10px; margin: 4px 0 4px 30px; padding: 5px 12px; border-radius: 8px; page-break-inside: avoid; }
  .toc-page:hover { background: #f6f7f9; }
  .toc-page-no { font-size: 11.5px; font-weight: 700; color: #7c3aed; font-family: "SF Mono", Menlo, monospace; min-width: 30px; }
  .toc-page .toc-name { font-size: 12.5px; font-weight: 500; color: #3d4250; flex: 1; }
  .toc-orphan { margin-left: 0; }

  /* ============ 章节（模块） ============ */
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: avoid; }
  .chapter-head { position: relative; display: flex; align-items: flex-start; gap: 18px; margin: 4px 0 18px; }
  .chapter-bigno {
    font-size: 64px; font-weight: 800; line-height: 1;
    color: rgba(99,102,241,.28);
    font-family: "SF Mono", Menlo, monospace;
  }
  .chapter-titles h2 { font-size: 25px; font-weight: 800; margin: 6px 0 0; line-height: 1.3; }
  .chapter-rule { width: 52px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, #6366f1, #8b5cf6); margin-top: 12px; }

  /* ============ 页面节 ============ */
  .page-block { margin-top: 26px; page-break-inside: auto; }
  .page-head {
    display: flex; align-items: center; gap: 12px;
    background: linear-gradient(90deg, #f1eefe 0%, #f7f5ff 60%, rgba(241,238,254,0) 100%);
    border: 1px solid #e9e4fc; border-radius: 12px;
    padding: 12px 16px; margin-bottom: 12px;
    page-break-after: avoid;
  }
  .page-no {
    font-family: "SF Mono", Menlo, monospace; font-size: 13px; font-weight: 800;
    color: #fff; background: linear-gradient(135deg, #7c3aed, #8b5cf6);
    padding: 4px 11px; border-radius: 8px; flex-shrink: 0;
  }
  .page-head h3 { margin: 0; font-size: 17px; font-weight: 800; flex: 1; }

  .kind-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10.5px; font-weight: 700; letter-spacing: 1px;
    padding: 3px 10px; border-radius: 999px;
  }
  .kind-module { color: #b45309; background: #fef3e2; border: 1px solid #fde6c4; }
  .kind-page { color: #0369a1; background: #e8f6fe; border: 1px solid #d3eefb; }
  .chapter-titles .kind-badge { vertical-align: middle; }

  /* ============ 文档正文 ============ */
  .doc { color: #272b38; }
  .doc h3 { font-size: 15px; font-weight: 700; margin: 20px 0 8px; padding-left: 10px; border-left: 3px solid #c7ccfe; }
  .doc h4 { font-size: 13.5px; font-weight: 700; margin: 16px 0 6px; color: #1a1d29; }
  .doc h5 { font-size: 13px; font-weight: 700; margin: 14px 0 6px; color: #3d4250; }
  .doc p { margin: 8px 0; }
  .doc strong { color: #1a1d29; }
  .doc ul, .doc ol { padding-left: 22px; margin: 8px 0; }
  .doc li { margin: 4px 0; }
  .doc li::marker { color: #6366f1; font-weight: 700; }
  .doc table {
    border-collapse: separate; border-spacing: 0;
    width: 100%; margin: 14px 0; font-size: 11.5px;
    border: 1px solid #e7e8ee; border-radius: 10px; overflow: hidden;
    page-break-inside: avoid;
  }
  .doc th {
    background: linear-gradient(180deg, #f3f4fe, #eef0ff);
    color: #4338ca; font-weight: 700;
    padding: 8px 11px; text-align: left; vertical-align: middle;
    border-bottom: 1px solid #e0e3ff;
  }
  .doc td { padding: 7px 11px; text-align: left; vertical-align: top; border-bottom: 1px solid #f0f1f5; }
  .doc tr:last-child td { border-bottom: none; }
  .doc tbody tr:nth-child(even) td { background: #fafafe; }
  .doc blockquote {
    margin: 12px 0; padding: 10px 14px;
    border-left: 3px solid #6366f1;
    background: #f5f5ff; color: #4b5060;
    border-radius: 0 8px 8px 0; font-size: 12px;
  }
  .doc code { font-family: "SF Mono", Menlo, monospace; font-size: 11px; background: #f1eefe; color: #6d28d9; padding: 1px 6px; border-radius: 5px; }
  .doc pre { background: #1a1d29; color: #e7e9f0; padding: 13px 15px; border-radius: 10px; overflow-x: auto; font-size: 11px; line-height: 1.7; }
  .doc pre code { background: none; color: inherit; padding: 0; }
  .doc hr { border: none; border-top: 1px solid #e7e8ee; margin: 18px 0; }
  .doc a { color: #6366f1; }

</style>
</head>
<body>
  <div class="cover">
    <div class="cover-brand">
      <span class="logo"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.2L21 9l-5 4.2L17.5 20 12 16.4 6.5 20 8 13.2 3 9l6.6-.8L12 2z" fill="#fff"/></svg></span>
      Proto<em>Forge</em>
    </div>
    <div class="cover-center">
      <span class="kicker">产品需求文档 · PRD</span>
      <h1>${escapeHtml(projectName)}<br/><span class="grad">产品需求文档</span></h1>
      <div class="rule"></div>
      <div class="cover-stats">
        <div class="stat-card">
          <span class="stat-ico indigo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg></span>
          <div><div class="stat-num">${stats.modules}</div><div class="stat-lab">个模块</div></div>
        </div>
        <div class="stat-card">
          <span class="stat-ico violet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>
          <div><div class="stat-num">${stats.pages}</div><div class="stat-lab">个页面</div></div>
        </div>
        <div class="stat-card">
          <span class="stat-ico slate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
          <div><div class="stat-num" style="font-size:14px">${today()}</div><div class="stat-lab">导出日期</div></div>
        </div>
      </div>
    </div>
    <div class="cover-foot">
      <span>由 ProtoForge 需求-原型工作台自动生成</span>
      <span>内容范围：全部为已确认需求</span>
    </div>
  </div>

  <div class="toc-page-wrap">
    <div class="toc-title">目录</div>
    <div class="toc-title-sub">模块 = 业务功能域　·　页面挂在模块下，按章节编号组织</div>
    ${toc.join('\n')}
  </div>

  ${body.join('\n')}
</body>
</html>`
}

/** 导出矢量 PDF：HTML 交给后端 Chrome 无头打印，下载 .pdf（文字可选、背景精确） */
export async function exportPrdPdf(projectName: string, groups: PrdGroup[]): Promise<void> {
  const html = buildPrdPdfHtml(projectName, groups)
  const resp = await fetch('/api/prd/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, fileName: `${projectName}-PRD` }),
  })
  if (!resp.ok) {
    let msg = `PDF 生成失败（${resp.status}）`
    try {
      const data = await resp.json()
      if (data?.error) msg = data.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projectName}-PRD.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
