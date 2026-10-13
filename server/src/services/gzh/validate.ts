// ============================================
// 公众号成品 HTML · 内建合规校验（JS 版）
// 复刻 gzh-design validate_gzh_html.py 的关键规则，API 层即时返回，
// 省去每次排版都 spawn Python；Python 脚本仍是交付前的权威兜底。
// ============================================

const FORBIDDEN: Array<[RegExp, string]> = [
  [/<style[\s>]/i, '<style> 标签会被过滤，样式必须内联'],
  [/<script[\s>]/i, '<script> 标签会被过滤'],
  [/<\/?div[\s>]/i, '<div> 会被改写，请用 <section>'],
  [/<link[\s>]/i, '外部 <link>（CSS/字体）会被过滤'],
  [/\sclass\s*=/i, 'class 属性会被剥离，请用内联 style'],
  [/\sid\s*=/i, 'id 属性会被剥离'],
  [/position\s*:\s*(fixed|absolute|sticky)/i, 'position fixed/absolute/sticky 不被支持'],
  [/float\s*:/i, 'float 不被支持'],
  [/@media/i, '@media 媒体查询不被支持'],
  [/@keyframes/i, '@keyframes 动画不被支持'],
  [/display\s*:\s*grid/i, 'display:grid 不被支持，请用 flex'],
  [/var\s*\(\s*--/i, 'CSS 变量 var(--x) 不被支持，请写死值'],
];

export interface GzhValidation {
  errors: string[];
  leafCount: number;
}

export function validateLayoutHtml(html: string): GzhValidation {
  const errors: string[] = [];
  for (const [rx, msg] of FORBIDDEN) {
    const n = rx.test(html);
    if (n) errors.push(msg);
  }
  const leafCount = (html.match(/<span\s+leaf(="")?\s*>/g) || []).length;
  if (leafCount === 0) {
    errors.push('全文没有任何 <span leaf=""> 包裹——粘贴后样式会大面积丢失');
  }
  return { errors, leafCount };
}
