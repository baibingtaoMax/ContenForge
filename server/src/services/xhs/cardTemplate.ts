// ============================================
// 小红书知识卡片 · 3:4 HTML 模板（风格令牌驱动 → Chrome 截图 1080×1440 PNG）
// --------------------------------------------
// 版式骨架固定（零崩版/零错字），观感全部来自 CardStyle 旋钮：
// 配色、标题/正文字体、栏目样式(kicker)、高亮样式、编号样式、封面对齐、
// 顶部色条、角标括弧、期号水印、结尾反色。AI 只能改 CardStyle，不能写 CSS。
// 字体均经本机无头 Chrome 实测可用（宋体/黑体用 sans-serif/楷体/仿宋/等线）。
// ============================================

import {
  getStyle,
  DEFAULT_STYLE_ID,
  type CardStyle,
  type FontKey,
} from './cardStyle.js';

export const CARD_W = 1080;
export const CARD_H = 1440;

export type CardKind = 'cover' | 'content' | 'closing';

export interface CoverCardData {
  kind: 'cover';
  kicker: string;
  title: string;
  hl: string;
  deck: string;
  issue: string;
}
export interface ContentCardData {
  kind: 'content';
  index: number;
  total: number;
  kicker: string;
  title: string;
  hl?: string;
  points: string[];
}
export interface ClosingCardData {
  kind: 'closing';
  quote: string;
  quoteHl?: string;
  cta: string;
}
export type CardData = CoverCardData | ContentCardData | ClosingCardData;

const FONT_STACK: Record<FontKey, string> = {
  // 注意：实测无头 Chrome 下显式 "Microsoft YaHei" 会回退异常变小，用 sans-serif 关键字才命中雅黑
  hei: `sans-serif,'Microsoft YaHei','PingFang SC'`,
  serif: `STSong,'STSong','SimSun',serif`,
  dengxian: `DengXian,'Microsoft YaHei',sans-serif`,
  kaiti: `KaiTi,'STKaiti','STSong',serif`,
  fangsong: `FangSong,'STFangsong','STSong',serif`,
};
const MONO_STACK = `Consolas,'IBM Plex Mono',monospace`;
const GEORGIA = `Georgia,'Times New Roman',serif`;

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function titleHtml(raw: string, hl: string | undefined, hlClass: string): string {
  const safe = esc(raw);
  const safeHl = esc(hl || '');
  const out = safeHl ? safe.split(safeHl).join(`${safeHl}`) : safe;
  return out
    .split('')
    .map((seg, i) => (i % 2 === 1 ? `<span class="${hlClass}">${seg}</span>` : seg))
    .join('')
    .replace(/\n/g, '<br>');
}

/** 卡片级 CSS 变量（配色 + 字体栈），所有组件只引用变量 */
function rootVars(s: CardStyle): string {
  return `--bg:${s.colors.bg};--ink:${s.colors.ink};--muted:${s.colors.muted};` +
    `--accent:${s.colors.accent};--accent-ink:${s.colors.accentInk};--line:${s.colors.line};` +
    `--tf:${FONT_STACK[s.titleFont]};--bf:${FONT_STACK[s.bodyFont]};`;
}

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--bg)}
.tf{font-family:var(--tf)}
.bf{font-family:var(--bf)}
.mono{font-family:${MONO_STACK}}
.georgia{font-family:${GEORGIA}}
.card{position:relative;overflow:hidden;width:${CARD_W}px;height:${CARD_H}px;background:var(--bg);color:var(--ink)}
/* 高亮三式 */
.hl-marker{background:linear-gradient(transparent 56%,color-mix(in srgb,var(--accent) 42%,transparent) 56%)}
.hl-solid{background:var(--accent);color:var(--accent-ink);padding:0 8px;border-radius:4px}
.hl-underline{background:linear-gradient(var(--accent),var(--accent)) left bottom/100% 6px no-repeat;padding-bottom:6px}
/* 栏目三式 */
.kk-block{display:inline-flex;background:var(--accent);color:var(--accent-ink);padding:12px 26px;font-weight:700}
.kk-pill{display:inline-flex;border:3px solid var(--accent);color:var(--accent);padding:9px 26px;border-radius:999px;font-weight:700;background:transparent}
.kk-plain{display:inline-flex;color:var(--accent);font-weight:700;padding:0 0 10px;border-bottom:4px solid var(--accent);background:transparent}
/* 角标括弧 */
.corner{position:absolute;width:46px;height:46px;border:5px solid var(--accent);z-index:3;pointer-events:none}
.corner-tl{top:34px;left:34px;border-width:5px 0 0 5px}
.corner-tr{top:34px;right:34px;border-width:5px 5px 0 0}
.corner-bl{bottom:34px;left:34px;border-width:0 0 5px 5px}
.corner-br{bottom:34px;right:34px;border-width:0 5px 5px 0}
`;

function hlClass(s: CardStyle): string {
  return s.highlightStyle === 'solid' ? 'hl-solid' : s.highlightStyle === 'underline' ? 'hl-underline' : 'hl-marker';
}
function kkClass(s: CardStyle): string {
  return s.kickerStyle === 'pill' ? 'kk-pill' : s.kickerStyle === 'plain' ? 'kk-plain' : 'kk-block';
}

// ---------- 封面 ----------
function coverHtml(d: CoverCardData, s: CardStyle): string {
  const issueNo = (d.issue.replace(/[^0-9]/g, '') || '00').slice(-3);
  const centered = s.coverAlign === 'center';
  const corners = s.cornerFrame
    ? `<span class="corner corner-tl"></span><span class="corner corner-tr"></span><span class="corner corner-bl"></span><span class="corner corner-br"></span>`
    : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${BASE_CSS}
.card{display:flex;flex-direction:column}
.accent{height:18px;background:var(--accent);flex-shrink:0}
.pad{padding:${centered ? '0 78px' : '72px 78px 0'};display:flex;flex-direction:column;flex:1;${centered ? 'justify-content:center' : ''};position:relative;z-index:2}
.top{display:flex;justify-content:space-between;align-items:center;font-size:26px;letter-spacing:.2em;color:var(--muted);font-weight:700;${centered ? 'position:absolute;top:72px;left:78px;right:78px' : 'margin-bottom:44px'}}
.dot{display:inline-block;width:14px;height:14px;border-radius:50%;background:var(--ink);margin-right:14px;vertical-align:-1px}
.kicker{font-size:30px;letter-spacing:.3em;align-self:flex-start;${centered ? 'margin-bottom:44px' : 'margin-bottom:46px'}}
.title{${centered ? '' : 'margin-top:8px'}font-weight:700;font-size:116px;line-height:1.22;letter-spacing:1px}
.deck{margin-top:44px;font-size:34px;line-height:1.7;color:var(--muted)}
.foot{${centered ? 'position:absolute;left:78px;right:78px;bottom:66px' : 'margin:auto 0 70px'};padding-top:32px;border-top:3px solid var(--ink);display:flex;justify-content:space-between;align-items:flex-end}
.foot .name{font-weight:700;font-size:36px;letter-spacing:.14em}
.foot .issue{font-size:30px;color:var(--muted);letter-spacing:3px}
.watermark{position:absolute;right:-40px;top:292px;font-size:380px;font-style:italic;font-weight:700;color:color-mix(in srgb,var(--ink) 7%,transparent);z-index:0;pointer-events:none}
</style></head><body>
<section class="card" style="${rootVars(s)}">
  ${s.accentBar ? '<div class="accent"></div>' : ''}
  ${corners}
  ${s.showWatermark ? `<div class="watermark georgia">${esc(issueNo)}</div>` : ''}
  <div class="pad">
    <div class="top mono"><span><span class="dot"></span>有点真知</span><span>NO.${esc(issueNo)}</span></div>
    <div class="kicker ${kkClass(s)} mono">${esc(d.kicker.toUpperCase())}</div>
    <h1 class="title tf">${titleHtml(d.title, d.hl, hlClass(s))}</h1>
    <p class="deck bf">${esc(d.deck)}</p>
    <div class="foot"><span class="name tf">「有点真知」</span><span class="issue mono">NO.${esc(issueNo)}</span></div>
  </div>
</section></body></html>`;
}

// ---------- 正文知识卡 ----------
function contentHtml(d: ContentCardData, s: CardStyle): string {
  const no = String(d.index).padStart(2, '0');
  const points = d.points
    .slice(0, 4)
    .map(
      (p, i) => `<li class="pt"><span class="pt-no bf">${i + 1}</span><span class="pt-tx bf">${esc(p)}</span></li>`
    )
    .join('');
  const numberBlock =
    s.numberStyle === 'big'
      ? `<div class="bigno georgia">${no}</div>`
      : s.numberStyle === 'circle'
        ? `<div class="circno bf">${no}</div>`
        : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${BASE_CSS}
.card{display:flex;flex-direction:column}
.accent{height:14px;background:var(--accent);flex-shrink:0}
.pad{padding:64px 78px 0;display:flex;flex-direction:column;flex:1}
.top{display:flex;justify-content:space-between;align-items:center;font-size:25px;letter-spacing:.18em;color:var(--muted);font-weight:700}
.bigno{font-size:120px;font-weight:700;line-height:1;color:var(--accent);margin-top:40px}
.circno{margin-top:44px;width:96px;height:96px;border:5px solid var(--accent);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:700;color:var(--accent)}
.title{margin-top:${s.numberStyle === 'none' ? '56px' : '26px'};font-weight:700;font-size:78px;line-height:1.24;letter-spacing:.5px}
ul{list-style:none;margin-top:50px;display:flex;flex-direction:column;gap:34px}
.pt{display:flex;gap:26px;align-items:flex-start}
.pt-no{flex:0 0 56px;height:56px;border:2px solid var(--ink);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:var(--ink)}
.pt-tx{font-size:40px;line-height:1.55;flex:1;padding-top:2px}
.foot{margin:auto 0 64px;padding-top:30px;border-top:2px solid var(--ink);display:flex;justify-content:space-between;align-items:center}
.foot .name{font-weight:700;font-size:30px;letter-spacing:.14em}
.foot .page{font-size:28px;color:var(--muted);letter-spacing:2px}
</style></head><body>
<section class="card" style="${rootVars(s)}">
  ${s.accentBar ? '<div class="accent"></div>' : ''}
  <div class="pad">
    <div class="top mono"><span>有点真知 · ${esc(d.kicker)}</span><span>${no}</span></div>
    ${numberBlock}
    <h2 class="title tf">${titleHtml(d.title, d.hl, hlClass(s))}</h2>
    <ul>${points}</ul>
    <div class="foot"><span class="name tf">「有点真知」</span><span class="page mono">${d.index} / ${d.total}</span></div>
  </div>
</section></body></html>`;
}

// ---------- 结尾引导卡（darkClosing 控制深/浅底，靠变量互换） ----------
function closingHtml(d: ClosingCardData, s: CardStyle): string {
  const dark = s.darkClosing;
  const vars = dark
    ? rootVars(s)
    : rootVars(s); // 浅底直接用原变量；深底把 bg/ink 互换
  const override = dark
    ? `--bg:${s.colors.ink};--ink:${s.colors.bg};--muted:color-mix(in srgb,${s.colors.bg} 68%,transparent);--line:color-mix(in srgb,${s.colors.bg} 28%,transparent);`
    : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${BASE_CSS}
.card{display:flex;flex-direction:column;justify-content:center;padding:0 84px}
.accent{position:absolute;top:0;left:0;right:0;height:18px;background:var(--accent)}
.kicker{font-size:28px;letter-spacing:.32em;font-weight:700;color:var(--accent);margin-bottom:46px;align-self:flex-start}
.quote{font-weight:700;font-size:76px;line-height:1.34;letter-spacing:.5px}
.rule{width:92px;height:4px;background:var(--accent);margin:56px 0 42px}
.cta{font-size:36px;line-height:1.7;color:var(--muted)}
.foot{position:absolute;left:84px;right:84px;bottom:64px;padding-top:26px;border-top:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}
.foot .name{font-weight:700;font-size:30px;letter-spacing:.14em}
.foot .issue{font-size:26px;color:var(--muted);letter-spacing:2px}
</style></head><body>
<section class="card" style="${vars}${override}">
  ${s.accentBar ? '<div class="accent"></div>' : '<div class="accent" style="height:6px"></div>'}
  <div class="kicker mono">有点真知</div>
  <p class="quote tf">${titleHtml(d.quote, d.quoteHl, dark && s.highlightStyle === 'marker' ? 'hl-underline' : hlClass(s))}</p>
  <div class="rule"></div>
  <p class="cta bf">${esc(d.cta)}</p>
  <div class="foot"><span class="name tf">关注「有点真知」</span><span class="issue mono">点赞 · 收藏 · 关注</span></div>
</section></body></html>`;
}

export function renderCardHtml(d: CardData, style?: CardStyle | string): string {
  const s = typeof style === 'string' || !style ? getStyle(typeof style === 'string' ? style : DEFAULT_STYLE_ID) : style;
  if (d.kind === 'cover') return coverHtml(d, s);
  if (d.kind === 'closing') return closingHtml(d, s);
  return contentHtml(d, s);
}
