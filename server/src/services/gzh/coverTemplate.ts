// ============================================
// 公众号封面 HTML 模板构造（两版 × 两比例 = 4 张）
// --------------------------------------------
// xiaohei（小黑 IP）：Editorial 分栏，插画按版位精确比例生成、装在细框版位里。
// magazine（杂志抽象）：AI 意象图满版 + 深色渐变遮罩，标题压在图上。
// 所有中文文字都由模板精确排版（零错字）；背景图绝不画文字。
// 本机字体：华文宋体 STSong / Georgia / Consolas（无 Noto/Playfair/Plex）。
// 背景用 file:// 绝对地址，和 spike 一样本机 Chrome 可直接加载。
// ============================================
import { pathToFileURL } from 'node:url';

export type CoverVariant = 'xiaohei' | 'magazine';
export type CoverRatio = 'wide' | 'square';
export type CoverArtKey = `${CoverVariant}-${CoverRatio}`;

export interface CoverArtSpec {
  /** 传给 seedream 的 宽x高 */
  size: string;
  width: number;
  height: number;
  /** 给生图的构图提示后缀 */
  compositionHint: string;
}

/** 四张成品各自的背景生图规格（像素在 seedream 921600–4624220、比例 1/16–16 内） */
export const COVER_ART_SPECS: Record<CoverArtKey, CoverArtSpec> = {
  // 宽图右栏版位约 882×900（近正方）
  'xiaohei-wide': { size: '976x1000', width: 976, height: 1000, compositionHint: '近正方形构图，主体居中，四周留白' },
  // 方图上方版位 960×470（约 2:1 横条）
  'xiaohei-square': { size: '1408x690', width: 1408, height: 690, compositionHint: '横向宽幅构图，主体居中偏左，右侧留白' },
  // 杂志宽图满版 21:9
  'magazine-wide': { size: '1920x824', width: 1920, height: 824, compositionHint: '超宽横幅电影感构图，左侧留出干净的暗色空间放标题' },
  // 杂志方图满版 1:1
  'magazine-square': { size: '1440x1440', width: 1440, height: 1440, compositionHint: '竖正方构图，下半部留出干净的暗色空间放标题' },
};

export interface CoverPlan {
  issue: string;          // NO.042
  year: string;           // 2026
  kicker: string;         // 情绪笔记
  en: string;             // EMOTIONAL NOTES
  wideTitle: string;      // 可含 \n
  wideHl: string;         // 需高亮的子串
  squareTitle: string;    // 可含 \n
  squareHl: string;
  deck: string;           // 宽图左栏副述
  quote: string;          // 金句（小黑宽图右栏不用，杂志/署名区可用）
  quoteHl: string;
}

export const COVER_DIM: Record<CoverRatio, { w: number; h: number }> = {
  wide: { w: 2100, h: 900 },
  square: { w: 1080, h: 1080 },
};

const FONT = {
  serif: `STSong,'STSong','SimSun',serif`,
  georgia: `Georgia,'Times New Roman',serif`,
  mono: `Consolas,'IBM Plex Mono',monospace`,
};

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 把含高亮子串的标题转成 HTML（\n→<br>，高亮包 .hl）；转义其余文字 */
function titleHtml(raw: string, hl: string): string {
  const safe = esc(raw);
  const safeHl = esc(hl);
  const withHl = safeHl
    ? safe.split(safeHl).join(`\u0000${safeHl}\u0000`)
    : safe;
  return withHl
    .split('\u0000')
    .map((seg, i) => (i % 2 === 1 ? `<span class="hl">${seg}</span>` : seg))
    .join('')
    .replace(/\n/g, '<br>');
}

function artUrl(absPath: string): string {
  return pathToFileURL(absPath).href;
}

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{--paper:#f3f0e8;--ink:#0a0a0b;--muted:#68625a;--orange:#ed7b2f;--line:rgba(10,10,11,.22)}
html,body{background:var(--paper)}
.serif{font-family:${FONT.serif}}
.mono{font-family:${FONT.mono}}
.georgia{font-family:${FONT.georgia}}
.poster{position:relative;overflow:hidden;background:var(--paper);color:var(--ink)}
`;

// ---------- 小黑版 · 宽 21:9 ----------
function xiaoheiWide(p: CoverPlan, artAbs: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${BASE_CSS}
.poster{width:2100px;height:900px;display:grid;grid-template-columns:1.16fr .84fr}
.left{padding:56px 58px;display:flex;flex-direction:column;border-right:1px solid var(--line);position:relative;z-index:2;background:var(--paper)}
.top-row{display:flex;justify-content:space-between;align-items:center;font-size:16px;letter-spacing:.2em;color:var(--muted);margin-bottom:38px;font-weight:700}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--ink);margin-right:10px;vertical-align:middle}
.kicker{font-size:19px;letter-spacing:.3em;color:var(--ink);margin-bottom:28px;font-weight:700}
.title{font-weight:700;font-size:92px;line-height:1.18;letter-spacing:1px}
.hl{background:linear-gradient(transparent 60%,rgba(237,123,47,.36) 60%)}
.deck{margin-top:28px;font-size:22px;line-height:1.7;color:rgba(10,10,11,.66);max-width:600px}
.byline{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;padding-top:24px;border-top:2px solid var(--ink)}
.byline .name{font-weight:700;font-size:23px;letter-spacing:.16em}
.byline .issue{font-size:18px;color:var(--muted);letter-spacing:2px}
.right{position:relative;background:#fbfaf6;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:46px 46px 40px}
.frame{width:100%;flex:1;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:6px;position:relative;overflow:hidden;background:#fff}
.pc{position:absolute;width:32px;height:32px;border:3px solid var(--orange);z-index:3;pointer-events:none}
.pc-tl{top:16px;left:16px;border-width:3px 0 0 3px}
.pc-br{bottom:16px;right:16px;border-width:0 3px 3px 0}
.frame img{width:100%;height:100%;object-fit:cover;display:block}
.art-tag{margin-top:18px;font-size:15px;letter-spacing:.32em;color:var(--muted)}
</style></head><body>
<section class="poster">
  <div class="left">
    <div class="top-row mono"><span><span class="dot"></span>有点真知</span><span>${esc(p.issue)} · ${esc(p.year)}</span></div>
    <div class="kicker mono">${esc(p.kicker.toUpperCase())} · ${esc(p.en)}</div>
    <h1 class="title serif">${titleHtml(p.wideTitle, p.wideHl)}</h1>
    <p class="deck serif">${esc(p.deck)}</p>
    <div class="byline"><span class="name serif">「有点真知」</span><span class="issue mono">${esc(p.issue)}</span></div>
  </div>
  <div class="right">
    <div class="frame">
      <span class="pc pc-tl"></span><span class="pc pc-br"></span>
      <img src="${artUrl(artAbs)}" alt="">
    </div>
    <div class="art-tag mono">ILLUSTRATION · 小黑</div>
  </div>
</section></body></html>`;
}

// ---------- 小黑版 · 方 1:1 ----------
function xiaoheiSquare(p: CoverPlan, artAbs: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${BASE_CSS}
.poster{width:1080px;height:1080px;display:flex;flex-direction:column}
.accent-bar{height:14px;background:var(--orange);flex-shrink:0}
.sq-top{display:flex;justify-content:space-between;align-items:center;padding:32px 58px 0;font-size:18px;letter-spacing:.18em;color:var(--muted);font-weight:700}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--ink);margin-right:10px;vertical-align:middle}
.sq-art{margin:26px 58px 0;height:430px;flex-shrink:0;border:1px solid var(--line);border-radius:6px;background:#fff;position:relative;overflow:hidden;display:flex}
.pc{position:absolute;width:30px;height:30px;border:3px solid var(--orange);z-index:3}
.pc-tl{top:15px;left:15px;border-width:3px 0 0 3px}
.pc-br{bottom:15px;right:15px;border-width:0 3px 3px 0}
.sq-art img{width:100%;height:100%;object-fit:cover;display:block}
.sq-body{padding:34px 58px 0;display:flex;flex-direction:column;flex:1}
.kicker{font-size:20px;letter-spacing:.28em;color:var(--muted);margin-bottom:20px;font-weight:700}
.title{font-weight:700;font-size:84px;line-height:1.2;letter-spacing:1px}
.hl{background:linear-gradient(transparent 60%,rgba(237,123,47,.38) 60%)}
.sq-bottom{margin-top:auto;margin-bottom:50px;padding-top:22px;border-top:2px solid var(--ink);display:flex;justify-content:space-between;align-items:center}
.sq-bottom .name{font-weight:700;font-size:26px;letter-spacing:.14em}
.sq-bottom .issue{font-size:20px;color:var(--muted);letter-spacing:2px}
.sq-bgissue{position:absolute;right:-30px;top:250px;font-size:300px;font-style:italic;font-weight:700;color:rgba(10,10,11,.05);z-index:0;pointer-events:none}
</style></head><body>
<section class="poster">
  <div class="accent-bar"></div>
  <div class="sq-bgissue georgia">${esc((p.issue.replace(/[^0-9]/g, '') || '00').slice(-2))}</div>
  <div class="sq-top mono"><span><span class="dot"></span>有点真知</span><span>${esc(p.issue)} · ${esc(p.year)}</span></div>
  <div class="sq-art">
    <span class="pc pc-tl"></span><span class="pc pc-br"></span>
    <img src="${artUrl(artAbs)}" alt="">
  </div>
  <div class="sq-body">
    <div class="kicker mono">${esc(p.kicker.toUpperCase())} · ${esc(p.en)}</div>
    <h1 class="title serif">${titleHtml(p.squareTitle, p.squareHl)}</h1>
    <div class="sq-bottom"><span class="name serif">「有点真知」</span><span class="issue mono">${esc(p.issue)}</span></div>
  </div>
</section></body></html>`;
}

// ---------- 杂志抽象版 · 宽 21:9（满版图 + 左暗遮罩压标题） ----------
function magazineWide(p: CoverPlan, artAbs: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${BASE_CSS}
.poster{width:2100px;height:900px;color:#f3f0e8}
.bg{position:absolute;inset:0}
.bg img{width:100%;height:100%;object-fit:cover;display:block}
.scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,6,7,.96) 0%,rgba(6,6,7,.90) 32%,rgba(6,6,7,.62) 54%,rgba(6,6,7,.22) 76%,rgba(6,6,7,.04) 100%)}
.inner{position:relative;z-index:2;height:100%;padding:58px 64px;display:flex;flex-direction:column;max-width:1180px}
.top-row{display:flex;align-items:center;font-size:16px;letter-spacing:.22em;color:rgba(243,240,232,.72);margin-bottom:40px;font-weight:700}
.odot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--orange);margin-right:12px}
.kicker{display:inline-flex;align-self:flex-start;font-size:18px;letter-spacing:.3em;font-weight:700;color:#0a0a0b;background:var(--orange);padding:9px 18px;margin-bottom:30px}
.title{font-weight:700;font-size:104px;line-height:1.14;letter-spacing:1px;text-shadow:0 2px 24px rgba(0,0,0,.45)}
.hl{color:var(--orange)}
.deck{margin-top:30px;font-size:23px;line-height:1.7;color:rgba(243,240,232,.9);max-width:720px;text-shadow:0 1px 14px rgba(0,0,0,.55)}
.byline{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;padding-top:24px;border-top:1px solid rgba(243,240,232,.28);max-width:1052px}
.byline .name{font-weight:700;font-size:23px;letter-spacing:.16em}
.byline .issue{font-size:18px;color:rgba(243,240,232,.6);letter-spacing:2px}
</style></head><body>
<section class="poster">
  <div class="bg"><img src="${artUrl(artAbs)}" alt=""></div>
  <div class="scrim"></div>
  <div class="inner">
    <div class="top-row mono"><span class="odot"></span>有点真知 · ${esc(p.issue)} · ${esc(p.year)}</div>
    <div class="kicker mono">${esc(p.kicker.toUpperCase())} · ${esc(p.en)}</div>
    <h1 class="title serif">${titleHtml(p.wideTitle, p.wideHl)}</h1>
    <p class="deck serif">${esc(p.deck)}</p>
    <div class="byline"><span class="name serif">「有点真知」</span><span class="issue mono">${esc(p.issue)}</span></div>
  </div>
</section></body></html>`;
}

// ---------- 杂志抽象版 · 方 1:1（满版图 + 下暗遮罩压标题） ----------
function magazineSquare(p: CoverPlan, artAbs: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
${BASE_CSS}
.poster{width:1080px;height:1080px;color:#f3f0e8}
.bg{position:absolute;inset:0}
.bg img{width:100%;height:100%;object-fit:cover;display:block}
.scrim{position:absolute;inset:0;background:linear-gradient(0deg,rgba(6,6,7,.96) 0%,rgba(6,6,7,.84) 32%,rgba(6,6,7,.34) 58%,rgba(6,6,7,.10) 100%)}
.topscrim{position:absolute;top:0;left:0;right:0;height:120px;background:linear-gradient(180deg,rgba(6,6,7,.55),rgba(6,6,7,0));z-index:1}
.topbar{position:absolute;top:0;left:0;right:0;height:14px;background:var(--orange);z-index:3}
.inner{position:relative;z-index:2;height:100%;padding:64px 60px 56px;display:flex;flex-direction:column;justify-content:flex-end}
.top-row{position:absolute;top:48px;left:60px;right:60px;display:flex;justify-content:space-between;font-size:18px;letter-spacing:.18em;color:rgba(243,240,232,.9);font-weight:700;text-shadow:0 1px 12px rgba(0,0,0,.7)}
.odot{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--orange);margin-right:10px}
.kicker{display:inline-flex;align-self:flex-start;font-size:19px;letter-spacing:.28em;font-weight:700;color:#0a0a0b;background:var(--orange);padding:8px 16px;margin-bottom:24px}
.title{font-weight:700;font-size:92px;line-height:1.18;letter-spacing:1px;text-shadow:0 2px 22px rgba(0,0,0,.5)}
.hl{color:var(--orange)}
.rule{width:64px;height:3px;background:var(--orange);margin:30px 0 24px}
.sq-bottom{display:flex;justify-content:space-between;align-items:center}
.sq-bottom .name{font-weight:700;font-size:26px;letter-spacing:.14em}
.sq-bottom .issue{font-size:20px;color:rgba(243,240,232,.62);letter-spacing:2px}
</style></head><body>
<section class="poster">
  <div class="topbar"></div>
  <div class="bg"><img src="${artUrl(artAbs)}" alt=""></div>
  <div class="scrim"></div>
  <div class="topscrim"></div>
  <div class="top-row mono"><span><span class="odot"></span>有点真知</span><span>${esc(p.issue)} · ${esc(p.year)}</span></div>
  <div class="inner">
    <div class="kicker mono">${esc(p.kicker.toUpperCase())} · ${esc(p.en)}</div>
    <h1 class="title serif">${titleHtml(p.squareTitle, p.squareHl)}</h1>
    <div class="rule"></div>
    <div class="sq-bottom"><span class="name serif">「有点真知」</span><span class="issue mono">${esc(p.issue)}</span></div>
  </div>
</section></body></html>`;
}

export function buildCoverHtml(
  variant: CoverVariant,
  ratio: CoverRatio,
  plan: CoverPlan,
  artAbsPath: string
): string {
  if (variant === 'xiaohei') return ratio === 'wide' ? xiaoheiWide(plan, artAbsPath) : xiaoheiSquare(plan, artAbsPath);
  return ratio === 'wide' ? magazineWide(plan, artAbsPath) : magazineSquare(plan, artAbsPath);
}
