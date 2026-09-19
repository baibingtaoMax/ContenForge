/**
 * 图型卡片的迷你示意图（24×16 SVG，单色 currentColor）。
 * ChartTypePicker 与主组件头部当前图型共用这一份。
 */
const AXIS =
  '<line x1="2" y1="14" x2="22" y2="14" stroke="currentColor" stroke-width="1" opacity=".55"/>' +
  '<line x1="2" y1="2" x2="2" y2="14" stroke="currentColor" stroke-width="1" opacity=".55"/>'

const ROSE_BARS = [0, 45, 90, 135, 180, 225, 270, 315]
  .map((a, i) => {
    const l = [6.5, 4.5, 5.8, 3.6, 5, 6.2, 4, 5.4][i]
    return `<rect x="-.7" y="${-l}" width="1.4" height="${l}" rx=".5" fill="currentColor" opacity="${0.4 + (i % 3) * 0.2}" transform="rotate(${a})"/>`
  })
  .join('')

const HEAT_CELLS = [0, 1, 2, 3]
  .map((r) =>
    [0, 1, 2, 3, 4]
      .map((c) => {
        const op = [0.25, 0.45, 0.7, 0.9][(r + c) % 4]
        return `<rect x="${2 + c * 3.9}" y="${2 + r * 3.2}" width="3.3" height="2.6" rx=".5" fill="currentColor" opacity="${op}"/>`
      })
      .join(''),
  )
  .join('')

const GLYPHS: Record<string, string> = {
  'single-line': `${AXIS}<path d="M2 11 L6 8 L10 9.5 L14 5 L18 6.5 L22 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2 11 L6 8 L10 9.5 L14 5 L18 6.5 L22 3 L22 14 L2 14 Z" fill="currentColor" opacity=".14"/>`,
  'multi-line': `${AXIS}<path d="M2 10 L7 7 L12 8 L17 4.5 L22 5.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 12 L7 11 L12 9 L17 8 L22 6" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".55" stroke-dasharray="2 1.4"/><path d="M2 8 L7 9 L12 5.5 L17 6 L22 3" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".3"/>`,
  'bar-rate': `${AXIS}<rect x="3.5" y="8" width="2.6" height="6" rx=".5" fill="currentColor" opacity=".75"/><rect x="9.2" y="6" width="2.6" height="8" rx=".5" fill="currentColor" opacity=".75"/><rect x="14.9" y="9" width="2.6" height="5" rx=".5" fill="currentColor" opacity=".75"/><path d="M4.5 6 L10.2 4 L16 6.5 L21 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.2"/>`,
  'grouped-bar': `${AXIS}<rect x="4" y="7" width="2" height="7" rx=".4" fill="currentColor"/><rect x="6.3" y="9" width="2" height="5" rx=".4" fill="currentColor" opacity=".55"/><rect x="11" y="5" width="2" height="9" rx=".4" fill="currentColor"/><rect x="13.3" y="8" width="2" height="6" rx=".4" fill="currentColor" opacity=".55"/><rect x="18" y="8.5" width="2" height="5.5" rx=".4" fill="currentColor"/><rect x="20.3" y="6.5" width="2" height="7.5" rx=".4" fill="currentColor" opacity=".55"/>`,
  'posneg-bar': `<line x1="2" y1="8.5" x2="22" y2="8.5" stroke="currentColor" stroke-width=".8" opacity=".5"/><rect x="4.5" y="3" width="3" height="5.3" rx=".4" fill="currentColor"/><rect x="10.5" y="8.7" width="3" height="3.5" rx=".4" fill="currentColor" opacity=".5"/><rect x="16.5" y="5" width="3" height="3.3" rx=".4" fill="currentColor"/>`,
  'stacked-bar': `${AXIS}<g><rect x="4" y="11" width="3.4" height="3" fill="currentColor" opacity=".4"/><rect x="4" y="8" width="3.4" height="3" fill="currentColor" opacity=".7"/><rect x="4" y="5" width="3.4" height="3" fill="currentColor"/><rect x="10.3" y="10.5" width="3.4" height="3.5" fill="currentColor" opacity=".4"/><rect x="10.3" y="6.5" width="3.4" height="4" fill="currentColor" opacity=".7"/><rect x="10.3" y="3.5" width="3.4" height="3" fill="currentColor"/><rect x="16.6" y="11.5" width="3.4" height="2.5" fill="currentColor" opacity=".4"/><rect x="16.6" y="7.5" width="3.4" height="4" fill="currentColor" opacity=".7"/><rect x="16.6" y="4.5" width="3.4" height="3" fill="currentColor"/></g>`,
  'pct-stack': `<g><rect x="2.5" y="4" width="18" height="3" fill="currentColor"/><rect x="2.5" y="7.2" width="12" height="3" fill="currentColor" opacity=".7"/><rect x="14.7" y="7.2" width="5.8" height="3" fill="currentColor" opacity=".4"/><rect x="2.5" y="10.4" width="7" height="3" fill="currentColor" opacity=".7"/><rect x="9.7" y="10.4" width="6" height="3" fill="currentColor" opacity=".42"/><rect x="15.9" y="10.4" width="4.6" height="3" fill="currentColor" opacity=".22"/></g>`,
  'dual-mix': `${AXIS}<rect x="3.5" y="9" width="2.4" height="5" rx=".4" fill="currentColor" opacity=".45"/><rect x="8.6" y="7.5" width="2.4" height="6.5" rx=".4" fill="currentColor" opacity=".45"/><rect x="13.7" y="8.5" width="2.4" height="5.5" rx=".4" fill="currentColor" opacity=".45"/><rect x="18.8" y="6.5" width="2.4" height="7.5" rx=".4" fill="currentColor" opacity=".45"/><path d="M4.7 6 L9.8 5 L14.9 6.8 L20 3.5" fill="none" stroke="currentColor" stroke-width="1.3"/>`,
  'rank-bar': `${AXIS}<rect x="2" y="2.6" width="15" height="2.1" rx=".6" fill="currentColor"/><rect x="2" y="5.8" width="12" height="2.1" rx=".6" fill="currentColor" opacity=".8"/><rect x="2" y="9" width="9" height="2.1" rx=".6" fill="currentColor" opacity=".62"/><rect x="2" y="12.2" width="5.5" height="2.1" rx=".6" fill="currentColor" opacity=".45"/>`,
  'diverging-bar': `<line x1="12" y1="1.5" x2="12" y2="14.5" stroke="currentColor" stroke-width=".9" opacity=".55"/><rect x="12.3" y="2.4" width="7" height="2" rx=".6" fill="currentColor"/><rect x="12.3" y="5.6" width="5" height="2" rx=".6" fill="currentColor" opacity=".75"/><rect x="6" y="8.8" width="5.7" height="2" rx=".6" fill="currentColor" opacity=".55"/><rect x="8.2" y="12" width="3.5" height="2" rx=".6" fill="currentColor" opacity=".4"/>`,
  waterfall: `<line x1="2" y1="14" x2="22" y2="14" stroke="currentColor" stroke-width=".8" opacity=".5"/><rect x="3" y="9" width="2.6" height="5" rx=".4" fill="currentColor"/><rect x="7" y="6" width="2.6" height="3" rx=".4" fill="currentColor" opacity=".75"/><rect x="11" y="4" width="2.6" height="2" rx=".4" fill="currentColor" opacity=".55"/><rect x="15" y="6.5" width="2.6" height="2.6" rx=".4" fill="currentColor" opacity=".35"/><rect x="19" y="5" width="2.6" height="9" rx=".4" fill="currentColor"/>`,
  pie: `<circle cx="10" cy="9" r="6.5" fill="currentColor" opacity=".28"/><path d="M10 9 L10 2.5 A6.5 6.5 0 0 1 15.9 11.4 Z" fill="currentColor" opacity=".85"/><path d="M10 9 L15.9 11.4 A6.5 6.5 0 0 1 7 14.9 Z" fill="currentColor" opacity=".55"/>`,
  donut: `<circle cx="10" cy="9" r="6.4" fill="none" stroke="currentColor" stroke-width="3.2" stroke-dasharray="14 9 10 7.5" opacity=".85"/><circle cx="10" cy="9" r="2.4" fill="#fff"/>`,
  rose: `<g transform="translate(11 9)">${ROSE_BARS}</g>`,
  'nested-pie': `<circle cx="10" cy="9" r="3" fill="currentColor" opacity=".55"/><circle cx="10" cy="9" r="6.6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-dasharray="10 7 12 5 8" opacity=".8"/>`,
  funnel: `<path d="M4 2.5 L16 2.5 L13.8 6 L6.2 6 Z" fill="currentColor" opacity=".9"/><path d="M6.6 6.6 L13.4 6.6 L11.6 9.8 L8.4 9.8 Z" fill="currentColor" opacity=".68"/><path d="M8.8 10.4 L11.2 10.4 L10 13.4 Z" fill="currentColor" opacity=".46"/>`,
  radar: `<polygon points="10,2.6 16.4,7.2 14,14 6,14 3.6,7.2" fill="none" stroke="currentColor" stroke-width="1" opacity=".4"/><polygon points="10,5.4 13.8,8.2 12.4,12 7.6 12 6.2,8.2" fill="none" stroke="currentColor" stroke-width=".8" opacity=".25"/><polygon points="10,3.4 15.4,7.6 12.8,13.2 7.4 11.6 4.6,7" fill="currentColor" opacity=".25" stroke="currentColor" stroke-width="1.2"/>`,
  'scatter-bubble': `<circle cx="6" cy="11" r="2" fill="currentColor" opacity=".8"/><circle cx="11" cy="8" r="3" fill="currentColor" opacity=".55"/><circle cx="17" cy="5" r="3.8" fill="currentColor" opacity=".35"/><circle cx="17.5" cy="11.5" r="1.5" fill="currentColor" opacity=".7"/>`,
  treemap: `<rect x="2" y="2" width="9" height="12" rx=".6" fill="currentColor" opacity=".85"/><rect x="11.5" y="2" width="9" height="5.6" rx=".6" fill="currentColor" opacity=".6"/><rect x="11.5" y="8.1" width="5.2" height="5.9" rx=".6" fill="currentColor" opacity=".4"/><rect x="17.2" y="8.1" width="3.3" height="5.9" rx=".6" fill="currentColor" opacity=".28"/>`,
  heatmap: HEAT_CELLS,
  sankey: `<rect x="2" y="3" width="2" height="4" rx=".6" fill="currentColor" opacity=".8"/><rect x="2" y="9.5" width="2" height="4" rx=".6" fill="currentColor" opacity=".55"/><rect x="10.5" y="2" width="2" height="5" rx=".6" fill="currentColor" opacity=".7"/><rect x="10.5" y="9" width="2" height="5.5" rx=".6" fill="currentColor" opacity=".45"/><rect x="19" y="3.5" width="2" height="4" rx=".6" fill="currentColor" opacity=".8"/><rect x="19" y="10" width="2" height="3.4" rx=".6" fill="currentColor" opacity=".55"/><path d="M4 5 C7.5 5 7.5 4 10.5 4" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".35"/><path d="M4 6 C7.5 7 7.5 10.5 10.5 11" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".25"/><path d="M12.5 4.5 C16 5 16 5 19 5" fill="none" stroke="currentColor" stroke-width="2.2" opacity=".35"/><path d="M12.5 11.5 C16 11.5 16 11 19 11" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".25"/>`,
  gauge: `<path d="M3.5 12 A7 7 0 0 1 16.5 12" fill="none" stroke="currentColor" stroke-width="2" opacity=".25"/><path d="M3.5 12 A7 7 0 0 1 11.2 5.2" fill="none" stroke="currentColor" stroke-width="2" opacity=".85"/><line x1="10" y1="9" x2="13" y2="6.6" stroke="currentColor" stroke-width="1.1"/><circle cx="10" cy="9" r="1.1" fill="currentColor"/>`,
}

export function chartGlyph(id: string): string {
  return `<svg viewBox="0 0 24 16" width="100%" height="100%">${GLYPHS[id] || ''}</svg>`
}
