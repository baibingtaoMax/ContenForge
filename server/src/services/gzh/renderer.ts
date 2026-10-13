// ============================================
// 公众号 · 橄榄手记确定性渲染器
// 输入 GzhDoc（结构化稿件），输出可直接粘贴公众号的 <section> 正文片段。
// HTML 全部逐字转录自 gzh-design theme-olive-journal 组件库，不在此发挥。
// ============================================

import type { GzhDoc, GzhBlock, Inline, InlineContent } from './types.js';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ESC[c]);
}

/**
 * 渲染行内内容；每个文字片段都包 <span leaf="">（公众号保样式的关键）。支持节点序列。
 * dark=true 用于深色底组件（closing 金句框）：文字反白，橙下划线保留；
 * 官方组件库 closing 金句原为纯文本，深底标记配色是 AI 排版新增场景。
 */
function inline(node: Inline | Inline[], dark = false): string {
  if (Array.isArray(node)) return node.map((n) => inline(n, dark)).join('');
  if (typeof node === 'string') return `<span leaf="">${esc(node)}</span>`;
  const c = inline(node.c, dark);
  switch (node.t) {
    case 'strong':
      return `<strong style="color:${dark ? '#fafafa' : '#23251d'};">${c}</strong>`;
    case 'under':
      // 浅底：墨黑字+橙下划线；深底：反白字+橙下划线（否则标记文字在黑底上隐形）
      return `<span style="border-bottom:2px solid #ed7b2f;font-weight:600;color:${dark ? '#fafafa' : '#23251d'};">${c}</span>`;
    case 'mark':
      return dark
        ? `<span style="background:rgba(255,255,255,0.14);padding:1px 5px;border-radius:4px;font-weight:600;color:#fafafa;">${c}</span>`
        : `<span style="background:#eeefe9;padding:1px 5px;border-radius:4px;font-weight:600;color:#23251d;border:1px solid #bfc1b7;">${c}</span>`;
    case 'code':
      return dark
        ? `<span style="background:rgba(255,255,255,0.14);color:#fafafa;padding:2px 6px;border-radius:4px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:13px;">${c}</span>`
        : `<span style="background:#eeefe9;color:#23251d;padding:2px 6px;border-radius:4px;font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:13px;border:1px solid #b6b7af;">${c}</span>`;
    case 'strike':
      return `<span style="color:${dark ? 'rgba(255,255,255,0.55)' : '#9ea096'};text-decoration:line-through;">${c}</span>`;
  }
}

/** 外层 margin 包装；全文第一个块去掉 margin-top */
function wrap(inner: string, first: boolean): string {
  return `<section style="${first ? '' : 'margin-top:24px;'}">${inner}</section>`;
}

// ---------- 各组件（编号对应 theme-olive-journal 组件库） ----------

/** 把内容按字符串中的 \n\n 拆成多段落；标记节点随段落复制，保留样式。 */
function toParagraphs(content: InlineContent): InlineContent[] {
  const paras: InlineContent[] = [];
  const pushNode = (node: Inline, para: Inline[]): Inline[] => {
    if (typeof node === 'string') {
      const parts = node.split('\n\n');
      parts.forEach((s, i) => {
        if (i > 0) para = [];
        if (s) para.push(s);
        if (i < parts.length - 1) { paras.push(para); para = []; }
      });
      return para;
    }
    const sub = toParagraphs(node.c);
    sub.forEach((sc, i) => {
      if (i > 0) para = [];
      para.push({ ...node, c: sc });
      if (i < sub.length - 1) { paras.push(para); para = []; }
    });
    return para;
  };
  let current: Inline[] = [];
  const nodes = Array.isArray(content) ? content : [content];
  for (const n of nodes) current = pushNode(n, current);
  if (current.length) paras.push(current);
  return paras;
}

function editorNote(b: Extract<GzhBlock, { kind: 'editorNote' }>, first: boolean): string {
  const label = b.label ?? '写在前面';
  const meta = b.meta ?? "EDITOR'S NOTE";
  const ps = toParagraphs(b.text);
  const paras = ps
    .map((p, i) => {
      const mb = i === ps.length - 1 ? 'margin:0;' : 'margin:0 0 10px;';
      return `<p style="${mb}font-size:14px;line-height:1.9;color:#4d4f46;text-align:justify;">${inline(p)}</p>`;
    })
    .join('');
  return wrap(`
  <section style="background:#fdfdf8;border:1px solid #bfc1b7;border-radius:6px;overflow:hidden;font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <section style="padding:10px 16px;background:#1e1f23;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:2px;color:#ffffff;"><span leaf="">${esc(label)}</span></p>
      <span style="font-size:10px;color:rgba(255,255,255,0.65);"><span leaf="">${esc(meta)}</span></span>
    </section>
    <section style="padding:16px 18px 18px;background:#eeefe9;">${paras}
    </section>
  </section>`, first);
}

function sectionTitle(num: string, part: string, title: string, en: string, first: boolean): string {
  return wrap(`
  <section style="font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <section style="display:flex;align-items:center;gap:14px;">
      <section style="text-align:center;flex-shrink:0;">
        <p style="margin:0;font-size:24px;font-weight:800;color:#23251d;line-height:1;letter-spacing:-2px;"><span leaf="">${esc(num)}</span></p>
        <p style="margin:0;font-size:8px;font-weight:700;color:#9ea096;letter-spacing:2px;"><span leaf="">${esc(part)}</span></p>
      </section>
      <span style="width:1px;height:36px;background:#bfc1b7;flex-shrink:0;display:inline-block;overflow:hidden;vertical-align:middle;font-size:0;line-height:0;"><span leaf="">&nbsp;</span></span>
      <section>
        <p style="margin:0 0 1px;font-size:17px;font-weight:800;color:#23251d;letter-spacing:0.2px;"><span leaf="">${esc(title)}</span></p>
        <p style="margin:0;font-size:11px;font-weight:600;color:#65675e;letter-spacing:1.2px;"><span leaf="">${esc(en)}</span></p>
      </section>
    </section>
  </section>`, first);
}

function paragraph(text: InlineContent, first: boolean): string {
  return wrap(`
  <section style="font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <p style="margin:0;font-size:14px;line-height:1.9;text-align:justify;color:#4d4f46;">${inline(text)}</p>
  </section>`, first);
}

function bullets(items: InlineContent[], first: boolean): string {
  const lis = items
    .map(
      (it) => `
      <li style="margin-bottom:8px;font-size:15px;color:#4d4f46;list-style-type:disc;">
        <section>${inline(it)}</section>
      </li>`
    )
    .join('');
  return wrap(`
  <section style="font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <ul style="margin:0;padding-left:22px;line-height:1.8;list-style-position:outside;">${lis}
    </ul>
  </section>`, first);
}

function keyPoint(point: InlineContent, extra: InlineContent | undefined, first: boolean): string {
  const tail = extra ? `<span leaf="">&nbsp;</span>${inline(extra)}` : '';
  return wrap(`
  <section style="font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <section style="background:#fdfdf8;border-radius:6px;padding:16px 18px;border:1px solid #bfc1b7;">
      <p style="font-size:14px;color:#4d4f46;margin:0;line-height:1.8;text-align:justify;">
        <strong style="color:#23251d;border-bottom:3px solid #ed7b2f;">${inline(point)}</strong>${tail}
      </p>
    </section>
  </section>`, first);
}

function actionGuide(label: string, meta: string, steps: InlineContent[], first: boolean): string {
  const body = steps
    .map((s, i) => {
      const idx = String(i + 1).padStart(2, '0');
      const last = i === steps.length - 1;
      return `<p style="margin:0 ${last ? '0 0 0' : '0 0 12px'};font-size:14px;line-height:1.9;color:#4d4f46;text-align:justify;"><span leaf="">${idx}　</span>${inline(s)}</p>`;
    })
    .join('');
  return wrap(`
  <section style="background:#fdfdf8;border:1px solid #bfc1b7;border-radius:6px;overflow:hidden;font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <section style="padding:10px 16px;background:#1e1f23;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:2px;color:#ffffff;"><span leaf="">${esc(label)}</span></p>
      <span style="font-size:10px;color:rgba(255,255,255,0.65);"><span leaf="">${esc(meta)}</span></span>
    </section>
    <section style="padding:16px 18px 18px;background:#eeefe9;">${body}
    </section>
  </section>`, first);
}

function compare(left: { title: string; desc: string }, right: { title: string; desc: string }, first: boolean): string {
  return wrap(`
  <section style="background:#eeefe9;padding:16px;border-radius:6px;border:1px solid #bfc1b7;font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <section style="display:flex;align-items:stretch;justify-content:center;gap:8px;">
      <section style="flex:1;text-align:center;padding:10px 8px;background:#1e1f23;border-radius:6px;border:1px solid #23251d;">
        <p style="font-size:13px;font-weight:800;color:#fff;margin:0 0 3px;"><span leaf="">${esc(left.title)}</span></p>
        <p style="font-size:10px;color:rgba(255,255,255,0.75);margin:0;line-height:1.5;"><span leaf="">${esc(left.desc)}</span></p>
      </section>
      <section style="display:flex;align-items:center;color:#bfc1b7;font-size:14px;padding:0 4px;"><span leaf="">vs</span></section>
      <section style="flex:1;text-align:center;padding:10px 8px;background:#fdfdf8;border:1px solid #bfc1b7;border-radius:6px;">
        <p style="font-size:13px;font-weight:800;color:#23251d;margin:0 0 3px;"><span leaf="">${esc(right.title)}</span></p>
        <p style="font-size:10px;color:#65675e;margin:0;line-height:1.5;"><span leaf="">${esc(right.desc)}</span></p>
      </section>
    </section>
  </section>`, first);
}

function pills(label: string | undefined, items: string[], first: boolean): string {
  const labelRow = label
    ? `<p style="margin:0 0 12px;font-size:11px;font-weight:800;letter-spacing:2px;color:#65675e;"><span leaf="">${esc(label)}</span></p>`
    : '';
  const spans = items
    .map(
      (it) => `<span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#e5e7e0;border:1px solid #bfc1b7;font-size:12px;font-weight:700;color:#23251d;"><span leaf="">${esc(it)}</span></span>`
    )
    .join('');
  return wrap(`
  <section style="padding:18px;border-radius:6px;background:#fdfdf8;border:1px solid #bfc1b7;font-family:'IBM Plex Sans',-apple-system,sans-serif;">${labelRow}
    <section style="display:flex;flex-wrap:wrap;gap:8px;">${spans}</section>
  </section>`, first);
}

function dots(first: boolean): string {
  return wrap(`
  <section style="display:flex;align-items:center;justify-content:center;gap:10px;font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <span style="width:8px;height:8px;border-radius:50%;background:#4d4f46;display:inline-block;overflow:hidden;vertical-align:middle;font-size:0;line-height:0;"><span leaf="">&nbsp;</span></span>
    <span style="width:8px;height:8px;border-radius:50%;background:#bfc1b7;display:inline-block;overflow:hidden;vertical-align:middle;font-size:0;line-height:0;"><span leaf="">&nbsp;</span></span>
    <span style="width:8px;height:8px;border-radius:50%;background:#ed7b2f;display:inline-block;overflow:hidden;vertical-align:middle;font-size:0;line-height:0;"><span leaf="">&nbsp;</span></span>
  </section>`, first);
}

function closing(label: string, quote: InlineContent, first: boolean): string {
  return wrap(`
  <section style="background:#1e1f23;border:1px solid #23251d;padding:8px;box-sizing:border-box;border-radius:6px;font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <section style="border:1px solid rgba(255,255,255,0.16);border-radius:4px;padding:20px 22px;">
      <p style="margin:0 0 8px;font-size:10px;line-height:1.6;color:#a3a3a3;letter-spacing:4px;font-weight:800;"><span leaf="">${esc(label)}</span></p>
      <p style="margin:0;font-size:16px;line-height:1.9;color:#fafafa;font-weight:700;">${inline(quote, true)}</p>
    </section>
  </section>`, first);
}

/** 结尾行动区（组件 28），互动引导固定 */
function endingActions(): string {
  return `
<section style="margin-top:24px;">
  <section style="background:#fdfdf8;border:1px solid #bfc1b7;border-radius:6px;padding:22px 16px;text-align:center;font-family:'IBM Plex Sans',-apple-system,sans-serif;">
    <p style="font-size:13px;font-weight:700;color:#23251d;line-height:1.6;margin:0 0 14px;"><span leaf="">如果你觉得今天这篇有收获，欢迎点赞、在看、转发三连，我们下篇见</span></p>
    <section style="display:flex;justify-content:center;gap:18px;margin-bottom:14px;flex-wrap:wrap;">
      <section style="text-align:center;color:#4d4f46;">
        <section style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;background:#eeefe9;border-radius:6px;border:1px solid #bfc1b7;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
        </section>
        <span style="font-size:11px;font-weight:600;"><span leaf="">赞</span></span>
      </section>
      <section style="text-align:center;color:#4d4f46;">
        <section style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;background:#eeefe9;border-radius:6px;border:1px solid #bfc1b7;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path></svg>
        </section>
        <span style="font-size:11px;font-weight:600;"><span leaf="">在看</span></span>
      </section>
      <section style="text-align:center;color:#23251d;">
        <section style="width:40px;height:40px;display:flex;align-items:center;justify-content:center;margin:0 auto 6px;background:#d4c9b8;border-radius:6px;border:1px solid #b17816;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#23251d" stroke-width="1.8" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
        </section>
        <span style="font-size:11px;font-weight:700;"><span leaf="">收藏</span></span>
      </section>
    </section>
    <p style="line-height:1.6;font-size:10px;color:#9ea096;letter-spacing:2px;margin:0;font-weight:500;"><span leaf="">THANKS FOR READING</span></p>
  </section>
</section>`;
}

/**
 * 渲染整篇。返回纯 <section> 正文片段 + 文末隐藏标记，无 html/body 外壳。
 */
export function renderGzh(doc: GzhDoc): string {
  let sectionCount = 0;
  const parts = doc.blocks.map((b, i) => {
    const first = i === 0;
    switch (b.kind) {
      case 'editorNote':
        return editorNote(b, first);
      case 'section': {
        sectionCount += 1;
        const num = b.num ?? String(sectionCount).padStart(2, '0');
        return sectionTitle(num, 'PART', b.title, b.en ?? '', first);
      }
      case 'endSection':
        return sectionTitle('∞', 'THE END', b.title, b.en ?? '', first);
      case 'paragraph':
        return paragraph(b.text, first);
      case 'bullets':
        return bullets(b.items, first);
      case 'keyPoint':
        return keyPoint(b.point, b.extra, first);
      case 'actionGuide':
        return actionGuide(b.label ?? '行动指南', b.meta ?? 'ACTION GUIDE', b.steps, first);
      case 'compare':
        return compare(b.left, b.right, first);
      case 'pills':
        return pills(b.label, b.items, first);
      case 'dots':
        return dots(first);
      case 'closing':
        return closing(b.label ?? 'CLOSING', b.quote, first);
    }
  });

  if (doc.signoff) {
    const { author, intro } = doc.signoff;
    parts.push(paragraph(`我是 ${author}，${intro}。`, false));
  }
  parts.push(endingActions());

  const body = parts.join('\n');
  const hidden = `
<p style="display:none;">
  <mp-style-type data-value="3"></mp-style-type>
</p>`;

  return `<section style="max-width:677px;margin:0 auto;padding:8px;box-sizing:border-box;background:#fdfdf8;color:#4d4f46;font-family:'IBM Plex Sans',-apple-system,system-ui,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;line-height:1.75;">
${body}
</section>${hidden}`;
}
