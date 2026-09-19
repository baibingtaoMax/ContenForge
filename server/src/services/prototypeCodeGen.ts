// ============================================
// 原型代码生成器 v2（ProtoForge）
// AI 读需求文档 → 产出「页面代码」（HTML 片段 + Tailwind + 原生 JS，调 PF SDK）
// 管线：骨架契约（导航/数据集/mock 数据）→ 逐页并行生成 HTML → 逐页落库点亮
// 结构说明见 docs/prototype-code-v2.md
// ============================================

import { chatCompletionStream, type LLMMessage } from '../llm/client.js';
import { getPrototypeModel } from '../config/index.js';
import { upsertPrototype, getPrototype, listRequirements } from '../store/database.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirSvc = dirname(fileURLToPath(import.meta.url));

// --------------------------------------------
// 壳 CSS 变量白名单（防 AI 自造 --pf-* 变量名导致样式静默失效）
// --------------------------------------------
/** 读不到壳时的兜底白名单（常用核心 token，与壳保持同步） */
const FALLBACK_SHELL_VARS = [
  '--pf-primary','--pf-primary-hover','--pf-primary-soft','--pf-primary-contrast',
  '--pf-bg-app','--pf-bg-surface','--pf-bg-subtle','--pf-bg-hover',
  '--pf-border','--pf-border-strong',
  '--pf-text-1','--pf-text-2','--pf-text-3',
  '--pf-success','--pf-success-bg','--pf-success-text',
  '--pf-warning','--pf-warning-bg','--pf-warning-text',
  '--pf-danger','--pf-danger-bg','--pf-danger-text',
  '--pf-info','--pf-info-bg','--pf-info-text',
];

/** 从 proto-shell.html 解析出全部已定义的 --pf-* 变量（壳是唯一事实源） */
function loadShellVars(): Set<string> {
  try {
    const shell = readFileSync(join(__dirSvc, '..', 'assets', 'proto-shell.html'), 'utf-8');
    const vars = new Set<string>();
    for (const m of shell.matchAll(/(--pf-[a-z0-9-]+)\s*:/g)) vars.add(m[1]);
    if (vars.size) return vars;
  } catch { /* 落到兜底 */ }
  return new Set(FALLBACK_SHELL_VARS);
}

export const SHELL_CSS_VARS = loadShellVars();

/** 给模型的白名单提示文本（随壳自动同步） */
export const CSS_VAR_WHITELIST_TEXT =
  '允许的 CSS 变量白名单（只能用这些，严禁自造其它 --pf-* 名字——引用未定义变量会静默失效、什么都不显示）：' +
  [...SHELL_CSS_VARS].sort().join('、') +
  '。要浅灰底用 --pf-bg-subtle 或 --pf-bg-hover，不要臆造 --pf-bg-muted 之类名字。';

/**
 * 找 HTML 里 var(--pf-xxx) 引用了、但壳没定义且片段自身也没声明的变量。
 * 页面片段自己内联声明过的局部自定义属性不算违规。
 */
export function findUnknownCssVars(html: string): string[] {
  const pageDefined = new Set<string>();
  for (const m of html.matchAll(/(--pf-[a-z0-9-]+)\s*:/g)) pageDefined.add(m[1]);
  const used = new Set<string>();
  for (const m of html.matchAll(/var\(\s*(--pf-[a-z0-9-]+)/g)) used.add(m[1]);
  return [...used].filter((v) => !SHELL_CSS_VARS.has(v) && !pageDefined.has(v)).sort();
}

export interface ReqDoc {
  id?: string;
  title: string;
  doc_md: string;
  status: string;
  kind?: string;
  parent_id?: string | null;
}

// --------------------------------------------
// 工具
// --------------------------------------------

/** 从模型输出里抠 JSON（容忍 ```json 围栏和前后旁白） */
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw);
  } catch { /* 兜底 */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('输出里找不到合法 JSON');
}

/** 从模型输出里抠 HTML 片段（```html 围栏优先，否则取 <div 开头到结尾） */
export function extractHtml(text: string): string {
  const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  let raw = fenced ? fenced[1] : text;
  // 没围栏时：截第一个 < 到最后一个 >
  if (!fenced) {
    const s = raw.search(/<\w/);
    const e = raw.lastIndexOf('>');
    if (s >= 0 && e > s) raw = raw.slice(s, e + 1);
  }
  return raw.trim();
}

async function callModel(messages: LLMMessage[], temperature = 0.2, maxTokens?: number): Promise<string> {
  let raw = '';
  await chatCompletionStream({
    messages,
    model: getPrototypeModel(),
    temperature,
    ...(maxTokens ? { maxTokens } : {}),
    thinking: { type: 'disabled' },
    onChunk: (_d, acc) => { raw = acc; },
  });
  return raw;
}

async function callJson(messages: LLMMessage[], temperature = 0.2, maxTokens?: number): Promise<any> {
  const raw = await callModel(messages, temperature, maxTokens);
  try {
    return extractJson(raw);
  } catch (e) {
    throw new Error(`${(e as Error).message}；输出尾部：${raw.slice(-160)}`);
  }
}

// --------------------------------------------
// spec v2 结构
// --------------------------------------------
// {
//   version: 2, appName, generatedAt,
//   nav: [{ pageId, title, group?, requirementId? }],
//   pages: [{ id, title, kind: 'form'|'list'|'detail', html, requirementId? }],
//   datasets: [{ name, statusField?, statusMap?: {key:{text,type}}, records: [] }],
//   pageStatus: { pageId: 'pending'|'ready'|'error' },
//   requirements: [{ id, title, kind, docMd }]
// }

export const LAYOUTS = ['sidebar', 'topnav'] as const;
export type ProtoLayout = (typeof LAYOUTS)[number];

export function emptySpec(): any {
  return { version: 2, appName: '', theme: 'saas', layout: 'sidebar', nav: [], pages: [], datasets: [], pageStatus: {}, requirements: [] };
}

/** 结构校验：返回错误列表（空=通过）。partial 时允许页面还没 html */
export function validateSpec(spec: any, opts: { partial?: boolean } = {}): string[] {
  const errors: string[] = [];
  if (!spec || typeof spec !== 'object') return ['spec 不是对象'];
  if (spec.version !== 2) errors.push('spec 版本不是 v2');
  if (spec.layout !== undefined && !LAYOUTS.includes(spec.layout)) errors.push(`layout 非法（只能是 ${LAYOUTS.join('|')}）`);
  if (typeof spec.appName !== 'string' || !spec.appName.trim()) errors.push('缺少 appName');
  if (!Array.isArray(spec.nav) || spec.nav.length === 0) errors.push('nav 必须是非空数组');
  if (!Array.isArray(spec.pages) || spec.pages.length === 0) {
    errors.push('pages 必须是非空数组');
  } else {
    const ids = new Set<string>();
    for (const p of spec.pages) {
      if (!p.id || typeof p.id !== 'string') { errors.push('存在页面缺少 id'); continue; }
      if (ids.has(p.id)) errors.push(`页面 id 重复：${p.id}`);
      ids.add(p.id);
      if (!['form', 'list', 'detail'].includes(p.kind)) errors.push(`页面 ${p.id} 的 kind 非法`);
      if (!opts.partial && (!p.html || typeof p.html !== 'string' || p.html.length < 100)) {
        errors.push(`页面 ${p.id} 缺少 html 内容`);
      }
      if (p.html) {
        const perr = checkPageHtml(p.html, spec, p.id);
        if (perr) errors.push(perr);
      }
    }
    for (const n of spec.nav) {
      if (!ids.has(n.pageId)) errors.push(`导航「${n.title || n.pageId}」指向了不存在的页面 ${n.pageId}`);
    }
  }
  if (!Array.isArray(spec.datasets)) errors.push('datasets 必须是数组');
  else {
    const names = new Set<string>();
    for (const ds of spec.datasets) {
      if (!ds.name) { errors.push('存在数据集缺少 name'); continue; }
      if (names.has(ds.name)) errors.push(`数据集重名：${ds.name}`);
      names.add(ds.name);
      if (!Array.isArray(ds.records)) errors.push(`数据集 ${ds.name} 缺 records`);
    }
  }
  return errors;
}

/**
 * 提取 HTML 脚本里 PF.<fn>(el, {...}) 形式的调用，平衡括号/花括号截取配置对象。
 * 返回 [{fn, body}]，body=第二个参数对象字面量原文。
 */
export function extractPfObjectCalls(html: string, fns: string[]): Array<{ fn: string; body: string }> {
  const out: Array<{ fn: string; body: string }> = [];
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!scripts.length) scripts.push(html); // 容错：配置理论上只在 script 里
  const skipString = (s: string, i: number): number => {
    const q = s[i];
    i++; // 开引号
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === q) return i + 1;
      i++;
    }
    return i;
  };
  for (const code of scripts) {
    for (const fn of fns) {
      const re = new RegExp(`PF\\.${fn}\\s*\\(`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(code))) {
        // 从调用的 '(' 起平衡括号，途中找第一个 '{' 并平衡花括号
        let i = m.index + m[0].length, depth = 1;
        let braceStart = -1;
        while (i < code.length && depth > 0) {
          const c = code[i];
          if (c === '"' || c === "'" || c === '`') { i = skipString(code, i); continue; }
          if (c === '(') depth++;
          else if (c === ')') depth--;
          else if (c === '{' && braceStart < 0) braceStart = i;
          i++;
        }
        if (depth === 0 && braceStart >= 0) {
          // 平衡花括号截对象
          let j = braceStart + 1, bd = 1;
          while (j < code.length && bd > 0) {
            const c = code[j];
            if (c === '"' || c === "'" || c === '`') { j = skipString(code, j); continue; }
            if (c === '{') bd++;
            else if (c === '}') bd--;
            j++;
          }
          if (bd === 0) out.push({ fn, body: code.slice(braceStart + 1, j - 1) });
          re.lastIndex = i;
        }
      }
    }
  }
  return out;
}

/** 单页 HTML 片段检查：结构约定 + 数据集/跳转引用存在 + <script> 语法 */
export function checkPageHtml(html: string, spec: any, pageId: string): string | null {
  if (/<\/?(html|head|body|!doctype)/i.test(html)) {
    return `页面 ${pageId}：只能输出 HTML 片段（不要 <html>/<head>/<body>）`;
  }
  const pageIds = new Set((spec.pages || []).map((p: any) => p.id));
  const dsNames = new Set((spec.datasets || []).map((d: any) => d.name));
  // PF.go('xxx') / PF.go("xxx") 引用
  // 注意：跨模块跳转目标可能是「尚未生成」的页面（增量生成场景下必然出现），
  // 不判硬错误——页面照常落库，运行时壳里 go() 对缺失页有 toast 兜底，
  // 等对应模块生成后跳转自然生效。
  const goRefs = [...html.matchAll(/PF\.go\(\s*['"]([\w-]+)['"]/g)].map((m) => m[1]);
  for (const ref of goRefs) {
    if (!pageIds.has(ref)) {
      console.log(`[校验] 页面 ${pageId}：PF.go 指向尚未生成的页面 ${ref}，跳过（运行时 toast 兜底）`);
    }
  }
  // 数据集引用
  const dsRefs = new Set<string>();
  for (const m of html.matchAll(/PF\.(records|findRecord|addRecord|updateRecord|statusMap|statusField)\(\s*['"]([\w-]+)['"]/g)) {
    dsRefs.add(m[2]);
  }
  // PF.chart / PF.metric 引用的数据集与字段
  // (?<![A-Za-z0-9_'\"]) 左边界：防止短键 y 匹配到 granularity: 结尾的 y、type 匹配 prototype 结尾等
  const keyStrRe = (k: string) => new RegExp(`(?<![A-Za-z0-9_'\"])['\"]?${k}['\"]?\\s*:\\s*['\"]([\\w-]+)['\"]`);
  for (const call of extractPfObjectCalls(html, ['chart', 'metric'])) {
    // dataset 用字符串字面量才校验；用变量/表达式传配置时不硬拦（运行时页面自负其责）
    const dm = call.body.match(keyStrRe('dataset'));
    if (dm) dsRefs.add(dm[1]);
  }
  for (const ref of dsRefs) {
    if (!dsNames.has(ref)) return `页面 ${pageId}：引用了不存在的数据集 ${ref}`;
  }
  // 图表配置硬校验：图型合法 + 绑定字段在数据集 records 里真实存在（有样本时）
  const CHART_TYPES = new Set(['bar', 'hbar', 'line', 'pie', 'donut', 'funnel']);
  const dsFieldMap = new Map<string, Set<string>>();
  for (const ds of (spec.datasets || [])) {
    const keys = new Set<string>();
    for (const r of ds.records || []) { if (r && typeof r === 'object') Object.keys(r).forEach((k) => keys.add(k)); }
    dsFieldMap.set(ds.name, keys);
  }
  for (const call of extractPfObjectCalls(html, ['chart'])) {
    const tm = call.body.match(/(?<![A-Za-z0-9_'"])type\s*:\s*['"]([a-z]+)['"]/);
    const type = tm ? tm[1] : 'bar';
    if (!CHART_TYPES.has(type)) return `页面 ${pageId}：PF.chart 的 type="${type}" 不支持（只支持 bar/hbar/line/pie/donut/funnel）`;
    const dm = call.body.match(keyStrRe('dataset'));
    if (!dm) continue; // dataset 非字面量（变量配置）→ 不做字段静态校验
    const fields = dsFieldMap.get(dm[1]);
    if (!fields || !fields.size) continue; // 契约只有名字没样本时（站外重建等）跳过字段校验
    for (const key of ['x', 'y', 'name', 'field']) {
      const fm = call.body.match(keyStrRe(key));
      if (fm && !fields.has(fm[1])) {
        return `页面 ${pageId}：PF.chart(${type}) 绑定的字段 "${fm[1]}" 在数据集 ${dm[1]} 里不存在（实际字段：${[...fields].join('、')}）`;
      }
    }
    if (type === 'line' && !/['"]?granularity['"]?\s*:\s*['"](?:month|year)['"]/.test(call.body)) {
      const xm = call.body.match(keyStrRe('x'));
      if (xm) {
        const ds = (spec.datasets || []).find((d: any) => d.name === dm![1]);
        const looksDate = (ds?.records || []).slice(0, 8).some((r: any) => typeof r?.[xm[1]] === 'string' && /^\d{4}-\d{1,2}(-\d{1,2}|[T ])?.*/.test(r[xm[1]]));
        if (looksDate || /date|time|月|日|createdAt|created_at/i.test(xm[1])) {
          return `页面 ${pageId}：折线图横轴是时间字段 ${xm[1]}，必须配 granularity:'month'|'year'（按月/年补连续空桶）`;
        }
      }
    }
  }
  // 不许直接碰 echarts 全局/自己引库——只能走 PF.chart
  if (/\becharts\s*[.=]|src\s*=\s*['"][^'"]*echarts/i.test(html)) {
    return `页面 ${pageId}：不要直接使用 echarts 或自己引图表库，统一用 PF.chart(el, 配置)`;
  }
  // 看板指标卡不许手写万/亿换算+聚合，必须用 PF.metric（否则不随提交/审核联动）
  const hasChart = /PF\.chart\s*\(/.test(html);
  const hasStatCard = /pf-(?:stat|metric)-value/.test(html);
  const metricCalls = (html.match(/PF\.metric\s*\(/g) || []).length;
  const handWrittenScale = /\/\s*(?:10000|100000000|1e4|1e8)\b/.test(html) || /formatCompact|formatMoney|formatWan|toWan|toYi/i.test(html);
  if (hasChart && hasStatCard && metricCalls === 0 && handWrittenScale) {
    return `页面 ${pageId}：指标卡数字不要自己写循环/万/亿换算函数去填，统一用 PF.metric(el,{dataset,agg:'sum'|'count'|'avg',field,filters,compact:true}) 绑数据集（壳已处理万/亿缩写，且能随提交/审核自动联动）`;
  }
  // CSS 变量必须是壳已定义的（防 AI 自造 --pf-* 名字导致样式静默失效）
  const unknownVars = findUnknownCssVars(html);
  if (unknownVars.length) {
    return `页面 ${pageId}：用了壳未定义的 CSS 变量 ${unknownVars.join('、')}（引用未定义变量会静默失效）——改用白名单里的现有变量，浅灰底用 --pf-bg-subtle/--pf-bg-hover`;
  }
  // <script> 语法检查（编译不执行）
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(m[1]);
    } catch (e) {
      return `页面 ${pageId}：脚本语法错误 — ${(e as Error).message}`;
    }
  }
  return null;
}

/**
 * 把关联需求的文档快照填进 spec.requirements（原型自包含需求说明）。
 * - pages[].requirementId + nav[].requirementId 校验有效（无效清掉）
 * - 没填时按标题同名兜底匹配
 */
export function attachRequirementSnapshots(spec: any, projectId: string): void {
  const all = listRequirements(projectId);
  const byId = new Map(all.map((r) => [r.id, r]));
  const norm = (s: string) => (s || '').replace(/[\s页面模块]/g, '');

  const pickReq = (title: string, kind: 'page' | 'module'): any => {
    const t = norm(title);
    if (!t) return null;
    if (kind === 'page') {
      const pages = all.filter((r) => r.kind === 'page');
      const mods = all.filter((r) => r.kind !== 'page');
      return pages.find((r) => norm(r.title) === t)
        || pages.find((r) => norm(r.title).includes(t) || t.includes(norm(r.title)))
        || mods.find((r) => norm(r.title) === t)
        || mods.find((r) => norm(r.title).includes(t) || t.includes(norm(r.title)));
    }
    const cands = all.filter((r) => r.kind !== 'page');
    return cands.find((r) => norm(r.title) === t) || cands.find((r) => norm(r.title).includes(t) || t.includes(norm(r.title))) || null;
  };

  const refIds = new Set<string>();
  for (const p of spec.pages || []) {
    let rid = typeof p.requirementId === 'string' ? p.requirementId : '';
    if (rid && byId.has(rid)) refIds.add(rid);
    else {
      if (rid) delete p.requirementId;
      const match = pickReq(p.title, 'page');
      if (match) { p.requirementId = match.id; refIds.add(match.id); }
    }
  }
  for (const n of spec.nav || []) {
    let rid = typeof n.requirementId === 'string' ? n.requirementId : '';
    if (rid && byId.has(rid)) refIds.add(rid);
    else {
      if (rid) delete n.requirementId;
      const match = pickReq(n.group || n.title, 'module');
      if (match) { n.requirementId = match.id; refIds.add(match.id); }
    }
  }
  for (const id of [...refIds]) {
    const r = byId.get(id);
    if (r && r.kind === 'page' && r.parent_id && byId.has(r.parent_id)) refIds.add(r.parent_id);
  }

  spec.requirements = [...refIds]
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((r) => ({ id: r.id, title: r.title, kind: r.kind === 'page' ? 'page' : 'module', docMd: r.doc_md || '' }));
}

// --------------------------------------------
// Prompt：页面代码 SDK 手册（骨架 worker 和页面 worker 共用）
// --------------------------------------------
const CODE_GUIDE = `# 页面代码写法（必须严格遵守）
每个页面输出一个 **HTML 片段**（不要 <html>/<head>/<body>，不要 <link>，不要自己引 Tailwind——壳已经提供）。
**布局/间距/尺寸用 Tailwind class；颜色、圆角、阴影、按钮、表格、标签、卡片、表单、弹窗必须用壳预置的 .pf-* 语义 class（见下方组件库），严禁写死任何颜色（不许 bg-indigo-600 / text-gray-700 / border-gray-300 这类带色 class，也不许内联 style 写颜色）。** 原型支持多主题换肤，写死颜色会换肤失败。交互用原生 JS，放在片段末尾的 \`<script>\` 里。
页面数据/跳转/提示**只能**通过壳注入的全局对象 \`PF\`，不许自己 fetch、不许 localStorage 造假数据。

## 视觉组件库（必须使用，class 已在壳内置）
- 页面外层：**后台页**用 \`<div class="p-5 flex flex-col gap-4">\`（padding/间距用 Tailwind）；**沉浸页（immersive=true）不要套 p-5**，最外层用 \`<div>\` 直接包 pf-navbar + pf-hero + 各区块，全部贴边全宽。
- 页头：\`<div class="pf-page-header"><div><h2>页面名</h2><p>一句话说明</p></div><button class="pf-btn primary">+ 主操作</button></div>\`
- 卡片：\`<div class="pf-card p-4">…</div>\`（p-4/p-5 间距自己定）。
- 统计卡组：\`<div class="pf-stats">\` 里放 \`<div class="pf-card pf-stat"><div class="pf-stat-label">指标名</div><div class="pf-stat-value pf-num">28,640<span class="unit">万元</span></div><div class="pf-stat-trend">较上月 <span class="up">↑ 6.8%</span></div></div>\`；下降用 \`<span class="down">\`。
- 筛选条：\`<div class="pf-card pf-filter-bar">\`，输入框/下拉用 \`<input class="pf-input">\` / \`<select class="pf-input">\`，查询按钮 \`<button class="pf-btn primary">\`、重置 \`<button class="pf-btn">\`。
- 表格：\`<div class="pf-card pf-table-wrap"><table class="pf-table">\`；\`<th>\`/\`<td>\` 直接用；企业名列用 \`<div class="pf-ent"><div class="pf-av" style="background:var(--pf-info-bg);color:var(--pf-info-text)">中</div><div><div class="pf-name">公司名</div><div class="pf-sub">编号 · 类型</div></div></div>\`（头像底色用 info/warning/danger/success 语义变量）；金额 \`<td class="pf-money pf-num">800.00 万</td>\`；状态用 \`<span class="pf-tag success|warning|danger|info">\`；行操作 \`<button class="pf-link">查看</button>\`（危险动作用 class="pf-link danger"），多个操作用 \`<div class="pf-actions-cell">\` 包住；分页用 \`<div class="pf-pagination"><span>共 N 条</span><div class="pf-page-no active">1</div>…\`。
- 按钮：\`<button class="pf-btn">次按钮</button>\` / \`<button class="pf-btn primary">主按钮</button>\`；小尺寸加 Tailwind：\`class="pf-btn primary text-xs"\` 并 style="height:30px;padding:0 12px"。
- 表单页：字段用 \`<div class="pf-field"><label>字段名<span class="req">*</span></label><input/select/textarea</div>\`（输入控件自带样式，不要加 pf-input）；底部 \`<button class="pf-btn primary">提交</button>\`。
- 弹窗：\`<div class="pf-modal-mask"><div class="pf-modal"><div class="pf-modal-head">标题</div><div class="pf-modal-body">…pf-field…</div><div class="pf-modal-foot"><button class="pf-btn">取消</button><button class="pf-btn primary">确定</button></div></div></div>\`；点遮罩关闭。
- 数字/金额/日期等宽：给数字元素加 class="pf-num"。

### 门户 / 营销 / 大屏页专用积木（做出品牌感和记忆点）
- **沉浸页顶部导航**（门户/官网/登录页，全屏布局必用，不要用后台页头）：\`<nav class="pf-navbar"><span class="pf-navbar-brand"><span class="pf-brand-mark">…svg…</span>站点名</span><div class="pf-navbar-links"><a class="pf-navbar-link active">首页</a><a class="pf-navbar-link">API 市场</a></div><div class="pf-navbar-actions"><button class="pf-btn primary">登录 / 注册</button></div></nav>\`。navbar 独立在页面最顶部（浅色背景），**默认就是深色文字，不要加 on-hero**（on-hero 仅当你把 navbar 放进 pf-hero 内部、叠在深色渐变上时才用，新手别用）。**沉浸页不要用 \`p-5\` 内边距外层**；最外层用 \`<div>\` 直接包 navbar + hero + 各区块，navbar 和 hero 贴边全宽（区块之间的间距用 mb-* / gap 控制）。
- **Hero 品牌头图**（首页/门户首屏主视觉，必用）：\`<div class="pf-hero"><span class="pf-hero-eyebrow">小标签</span><h1>主标题</h1><p class="pf-hero-sub">一句话说明</p><div class="pf-hero-actions"><button class="pf-btn primary">主 CTA</button><button class="pf-btn ghost">次 CTA</button></div></div>\`；hero 内的搜索条用 \`<div class="pf-hero-search"><input placeholder="…"><button class="pf-btn primary">搜索</button></div>\`。**hero 内文字自带白色，不要再套颜色**。
- **特性卡网格**（能力/卖点/分类入口）：\`<div class="pf-feature-grid">\` 里放多个 \`<div class="pf-feature"><div class="pf-feature-icon"><svg…></svg></div><h3>标题</h3><p>说明</p></div>\`，图标用线性 svg。**门户的分类/品类/服务入口（如“工商/金融/交通”分类）也必须用 pf-feature**：每张卡 = 渐变图标 + 分类名 + 一句说明或数量（如“128 个 API”“企业工商信息”）；**禁止用 pf-card 只放一个图标加两个字、大片留白的空盒子**，那样在深色/任何主题下都显廉价。
- **区块标题**：\`<div class="pf-section-head"><div class="pf-eyebrow">MODULE</div><h2>区块名</h2><p>副标题</p></div>\`，放在特性卡/列表等区块上方。
- **氛围横幅**（公告/引导）：\`<div class="pf-banner"><div class="pf-banner-icon"><svg…></svg></div><div class="pf-banner-text"><strong>标题</strong> 说明文字</div><button class="pf-btn">动作</button></div>\`。
- **大数字指标带**（数据大屏）：\`<div class="pf-metric-band">\` 里放 \`<div class="pf-card pf-metric"><div class="pf-metric-value pf-num">128<span class="unit">万</span></div><div class="pf-metric-label">指标名</div></div>\`。
- 小图标底：\`<span class="pf-icon-tile"><svg…></svg></span>\`（列表/卡片标题前）。
- **渐变/背景色一律不要自己写**：hero、特性图标、主按钮的品牌渐变已经内建在上述 class 里（随主题换肤）；严禁手写 linear-gradient 或任何 hex 颜色。

## PF API
- \`PF.records('数据集名')\` → 该数据集全部记录（数组，已深拷贝，可自由过滤排序）
- \`PF.findRecord('数据集名', id)\` → 按 id 找一条
- \`PF.params()\` → 地址栏参数（如详情页的 { id: 'r1' }）
- \`PF.addRecord('数据集名', 数据对象, '状态值')\` → 追加一条记录（id/createdAt 自动补）
- \`PF.updateRecord('数据集名', id, { 字段: 值 })\` → 更新记录（审核动作用它改 status）
- \`PF.go('页面id', { id: 'r1' })\` → 跳页面；第二个参数可省略
- \`PF.toast('提示文字', 'success'|'info'|'error')\`
- \`PF.money(数字)\` → 格式化成 ¥1,234,500
- \`PF.statusMap('数据集名')\` → { 状态key: { text: '中文名', type: 'success|warning|danger|info' } }
- 状态标签：\`const map = PF.statusMap('数据集名');\` 然后 \`<span class="pf-tag \${map[r.status].type}">\${map[r.status].text}</span>\`（type 直接拼接，不要用 PF_STATUS_CLASS）。

## 图表 PF.chart / PF.metric（工作台/看板/大屏必须用，不许用 div/CSS 假装柱子）
图表库壳已内置，**不要自己引 echarts、不要写 echarts.init**，只调 PF.chart。颜色自动跟随主题（禁写颜色字段），数据绑数据集、提交/审核后图表自动刷新。
容器给固定高度（Tailwind h-* 或 style="height:300px"），放在 pf-card 里，卡片头写中文标题：\`<div class="pf-card p-4"><div class="font-semibold mb-2">各行业担保金额</div><div id="chart1" style="height:280px"></div></div>\`。

- \`PF.chart(el, 配置)\`：
  - \`type\`：'bar' 柱 | 'hbar' 条形 | 'line' 折线 | 'pie' 饼 | 'donut' 环 | 'funnel' 漏斗
  - \`dataset\`：数据集名（必须存在）；\`agg\`：'sum' | 'count' | 'avg' | 'max' | 'min'（count 时不用给值字段）
  - 柱/条/折线：\`x\`=分类/时间字段，\`y\`=数值字段（agg=count 省略 y）；折线横轴是日期字段时**必须**配 \`granularity:'month'|'year'\`（自动补齐连续月份空桶）
  - 饼/环/漏斗：\`name\`=分类字段（状态分布直接 name=状态字段，图例自动出 statusMap 中文）
  - 可选：\`filters:{status:'approved'}\`（值也可以是数组）、\`top:6\`（只取前 N，其余并「其他」）、\`order:['submitted','approved','rejected']\`（漏斗按原始 key 排阶段顺序）、\`unit:'笔'\`（tooltip 文字单位）、\`compact:true\`（大数缩写成 万/亿）、\`showLabel:true\`
  - **金额口径（重要）**：数据集中金额一律以**元**存（如 120 万存 1200000）；图表/指标显示大额时用 \`compact:true\`（自动出“9350 万/1.2 亿”），**不要**再配 unit:'万元'（会变成「1.0 万 万元」）；unit 只用于笔/家/个这类文字单位。
  - 示例：
    - 柱：\`PF.chart(document.getElementById('c1'), {type:'bar', dataset:'guarantees', x:'industry', y:'amount', agg:'sum', top:6, compact:true, showLabel:true})\`
    - 折线：\`PF.chart(el, {type:'line', dataset:'guarantees', x:'createdAt', granularity:'month', y:'amount', agg:'sum', compact:true})\`
    - 环：\`PF.chart(el, {type:'donut', dataset:'guarantees', name:'status', agg:'count'})\`
    - 漏斗：\`PF.chart(el, {type:'funnel', dataset:'leads', name:'stage', agg:'count', order:['submitted','reviewing','signed','done']})\`
    - **漏斗必须是纯正向阶段（重要）**：阶段只能是「提交→审核中→已签约→已放款」这类层层递进、数量递减的转化环节。\n      ① name 必须绑一个独立的正向阶段字段（stage/phase/funnelStage），并配 order 按业务先后排序；\n      ② **严禁**直接拿业务终态 status 凑漏斗——「已驳回/已拒绝/已取消/失败/作废」这类异常分支不属于转化链路，塞进去会出现漏斗下层反而比上层大、语义错误；\n      ③ 如果数据集里没有正向阶段字段，就在骨架阶段补一个独立阶段字段（不要复用 status）；实在没有阶段数据就不要画漏斗，不要硬凑。
- \`PF.metric(el, 配置)\`：动态指标数字（绑数据，自动联动），\`{dataset, agg, field( count 省略), filters, prefix:'¥', suffix:'笔', compact:true}\`。用在 pf-stat-value/pf-metric-value 上，取代手写死数字。金额（元）用 compact:true 出万/亿、不要再加万元 suffix；文字单位（笔/家）用 suffix。
- **指标卡不许自己算（重要）**：凡是「在保余额/总笔数/平均单笔/总额」这类要随台账数据变化的统计数字，**必须用 PF.metric 绑数据集**，严禁手写循环/reduce/filter 求和、严禁自己写 toFixed + /10000、/100000000 的万/亿换算函数去填 pf-stat-value（壳的 compact 已处理缩写和尾零，手写既重复又不会随提交/审核联动）。初值可以留 \`—\` 占位，由 PF.metric 渲染。只有门户页没有对应业务数据集的宣传大数字才允许静态手写。
- **一个指标卡的单位只能出现一次（重要）**：PF.metric 会把 compact 的「万/亿」或 suffix 直接渲染进目标元素，所以——① 金额用 \`compact:true\` 时已自带「万/亿」，同一张卡**严禁**再写静态 \`<span class="unit">元/万元</span>\` 之类单位标签（否则出「1.33 亿 元」）；② 计数用了 \`suffix:'笔'\` 就**严禁**再放静态「笔」字标签（否则出「48笔 笔」）。要单位就只选一处表达：要么交给 suffix/compact，要么静态 unit span 配 suffix:'' + 不用 compact，别两套都上。
- **选型**：趋势用折线，对比用柱/条，占比用饼/环（类别 ≤6，多了用条形 top N），阶段转化用漏斗。一个看板页 3~6 张图为宜，别堆满。
- **门户/营销页的宣传大数字**（平台累计交易额、接入机构数，没有对应业务表单）**不要**用 PF.metric 造假数据，继续用静态 pf-metric 积木手写。

## 交互偏好：弹窗优先于跳页
- 列表行的「查看」、简单审核动作（通过/驳回）、快速编辑这类轻量交互，**优先在当前页用 .pf-modal 弹窗完成**，不要 PF.go 跳页；弹窗里照样用 PF.records/findRecord/updateRecord 渲染和改数据，改完关闭弹窗、重新渲染列表即可看到状态变化。
- 只有信息量大、需要独立页面承载的复杂详情（多分区、多动作、时间线/日志）才用 PF.go 跳独立详情页。
- 表单录入类页面保持独立页面（从导航/主按钮进入）。

## 页面要按类型选表现手法（重要）
- **门户/营销/对外首页（portal/home/landing）**：**必须有品牌感和记忆点**——首屏用 pf-hero（渐变主视觉 + 主副标题 + CTA + 可选搜索条），往下用 pf-section-head 分节 + pf-feature-grid 展能力，**在能力/推荐区之后、页尾之前固定放一条 pf-banner 引导横幅**（如“需要帮助？查看文档/联系我们”+ 一个动作钮，必须真的写出这个 .pf-banner 元素，不要省略），最后可加数据指标带；禁止用一张白卡居中堆黑字当 hero。要有营销页的氛围，不是后台表单。
- **工作台/数据大屏（dashboard）**：顶部 pf-stats/pf-metric-band 指标（**数字用 PF.metric 绑数据集，不写死**），再图表区（**必须用 PF.chart 出真图表：趋势折线、分类柱/条、状态环图等 3~6 张，禁止用 div/CSS 假装图表**），可配待办列表。
- **后台列表/表单/详情（list/form/detail）**：保持信息密度和清爽，用上面的后台套路，不要硬套大渐变。

## 三种后台页的套路
**表单页（form）**：卡片容器内放字段（label + input/select/textarea，必填加 *），底部按钮。
提交时 JS 收集值、校验必填（不过就 PF.toast 报错），通过后 PF.addRecord → PF.toast('提交成功') → PF.go 跳列表页。
「存草稿」类按钮校验放宽、addRecord 传草稿状态。只读默认值（如当前登录人）用 input 的 value + readonly。

**列表页（list）**：顶部操作区（标题/主按钮/搜索框，布局自己定，搜索框就是普通 input + JS 前端过滤），
下面表格（table，状态列用 statusMap + PF_STATUS_CLASS 渲染彩色标签）。
行内按钮：查看跳详情 \`PF.go('xxx-detail', { id: r.id })\`；操作按钮按状态显隐（如仅待审核显示「审核」）。
表格要横向不挤、中文不竖排；空数据给「暂无数据」行。

**详情页（detail）**：\`const r = PF.findRecord('数据集名', PF.params().id)\`；找不到给提示。
分区卡片展示字段（描述列表 dl/grid 均可），状态用彩色标签；底部动作按钮（审核通过/驳回等）按状态显隐，
点击后 \`PF.updateRecord(..., { status: 'approved' })\` → PF.toast → PF.go 回列表。

## 代码质量
- 中文界面，字段名/状态/规则严格遵循需求文档，不发明文档里没有的业务。
- **颜值是硬要求**：门户/首页必须用 pf-hero 做出品牌渐变主视觉（这是首屏记忆点），全站间距舒展、中文不竖排、空数据给「暂无数据」行；颜色一律走 token / 内建 class，不要写死任何颜色或渐变，不要用 Tailwind 带色 class。
- 列表金额右对齐加 pf-num；表格行 hover 高亮（组件自带）。
- 脚本用最简单的 render() 全量渲染 + 事件绑定模式即可，不要引框架。
- script 里可以直接用 PF（全局已注入）。页面每次切换都会重新执行，无需清理定时器以外的东西。
${CSS_VAR_WHITELIST_TEXT}`;

// --------------------------------------------
// 站外页面重建：真实页面采集 DOM → PF 原生 HTML 片段
// --------------------------------------------

// 颜色写死硬校验：外部页最容易犯（text-gray-xxx / bg-xxx / 内联 rgb hex），换肤会崩
const HARDCODED_COLOR_RE = [
  /\b(?:text|bg|border|divide|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:\d{2,3})\b/g,
  /\b(?:text|bg|border)-(?:black|white)\b/g,
];
const INLINE_COLOR_RE = /(?:^|[;"'\s])(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke)\s*:\s*(?!var\()\s*(?:#[0-9a-fA-F]{3,8}\b|rgba?\s*\(|hsla?\s*\()/;

export function checkExternalPageHtml(html: string): string[] {
  const errs: string[] = [];
  for (const re of HARDCODED_COLOR_RE) {
    const hits = new Set<string>();
    for (const m of html.matchAll(re)) hits.add(m[0]);
    if (hits.size) errs.push(`用了 Tailwind 带色 class：${[...hits].slice(0, 8).join('、')}（改用 .pf-* 组件 class，或内联 color:var(--pf-text-2/3)、border:1px solid var(--pf-border) 等语义变量）`);
  }
  // 内联颜色：逐 style 属性查（允许 var()）
  for (const m of html.matchAll(/style\s*=\s*["']([^"']*)["']/gi)) {
    const body = m[1];
    for (const decl of body.split(';')) {
      if (INLINE_COLOR_RE.test(';' + decl)) {
        errs.push(`内联 style 写死了颜色：${decl.trim().slice(0, 60)}（改成 var(--pf-text-1/2/3)、var(--pf-border)、var(--pf-bg-app/surface) 等语义变量）`);
        break;
      }
    }
    if (errs.length > 6) break;
  }
  return [...new Set(errs)];
}

// 确定性去色：模型产出后自动剥写死颜色，保证换肤合规（比靠重试更稳）
const TAILWIND_COLOR_CLASS_RE = /\b(?:text|bg|border|divide|ring|from|to|via|outline|fill|stroke|accent|caret|decoration)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:\d{2,3})(?:\/\d{1,3})?\b/g;
const TAILWIND_BW_CLASS_RE = /\b(?:text|bg|border)-(?:black|white)(?:\/\d{1,3})?\b/g;
const COLOR_PROP_RE = /^(?:color|background|background-color|border(?:-[a-z]+)?-color|outline-color|fill|stroke|caret-color|accent-color|text-decoration-color)\s*:/i;

export function sanitizeExternalPageHtml(html: string): string {
  let out = html
    .replace(TAILWIND_COLOR_CLASS_RE, '')
    .replace(TAILWIND_BW_CLASS_RE, '');
  // 清 class 多余空格
  out = out.replace(/class\s*=\s*(["'])([\s\S]*?)\1/g, (_m, q, cls) => {
    const clean = String(cls).replace(/\s+/g, ' ').trim();
    return `class=${q}${clean}${q}`;
  });
  // 内联 style：删掉写死颜色声明（保留 var() 与布局/尺寸/间距等）
  out = out.replace(/style\s*=\s*(["'])([\s\S]*?)\1/gi, (m, q, body) => {
    const kept = String(body)
      .split(';')
      .map((d: string) => d.trim())
      .filter((decl: string) => {
        if (!decl) return false;
        if (COLOR_PROP_RE.test(decl)) return /:\s*var\(/.test(decl);
        return true;
      })
      .join(';');
    return kept ? `style=${q}${kept}${q}` : '';
  });
  return out;
}

// --------------------------------------------
// 视觉规格 → prompt 文本：把采集到的真实字号/间距/圆角/排布给模型当“标尺”
// --------------------------------------------
export function formatVisualSpec(spec: any): string {
  if (!spec || typeof spec !== 'object') return '';
  const L: string[] = ['# 原系统视觉规格（实测计算样式，布局/尺寸照此数值，不要自由发挥）'];
  if (spec.base) {
    L.push(`- 正文：基础字号 ${spec.base.fontSize || '16px'}，行高 ${spec.base.lineHeight || 'normal'}，字体族 ${spec.base.fontFamily || '系统默认'}`);
  }
  if (spec.card) {
    const c = spec.card;
    L.push(`- 卡片：圆角 ${c.radius || '—'}，边框 ${c.border || '无'}，阴影 ${c.shadow === 'none' ? '无' : '有轻阴影'}，内边距 ${c.bodyPadding || '—'}${c.headerPadding ? `，卡头内边距 ${c.headerPadding}` : ''}${c.titleFont ? `，卡标题 ${c.titleFont}` : ''}`);
  }
  if (spec.form) {
    const f = spec.form;
    L.push(`- 表单：label 位置 ${f.labelPos || 'right'}（${f.labelPos === 'top' ? 'label 在控件上方' : 'label 在控件左侧'}），一行 ${f.colsPerRow || 1} 列${f.rowGap ? `，表单项纵向间距 ${f.rowGap}` : ''}`);
    if (f.label) L.push(`  · label：宽 ${f.label.w}px，${f.label.align}对齐，字号 ${f.label.fontSize}，右内边距 ${f.label.padR}`);
  }
  if (spec.input) {
    const i = spec.input;
    L.push(`- 输入框：高 ${i.h || '—'}px，圆角 ${i.radius}，内边距 ${i.padding}，字号 ${i.fontSize}，描边方式 ${i.border}`);
  }
  if (spec.button) {
    const b = spec.button;
    L.push(`- 主按钮：高 ${b.h || '—'}px，圆角 ${b.radius}，字号 ${b.fontSize}/${b.fontWeight}，左右内边距 ${b.padX}`);
  }
  if (spec.content) L.push(`- 内容区：内边距 ${spec.content.padding}，宽 ${spec.content.w || '自适应'}px`);
  if (spec.navbar) L.push(`- 顶栏：高 ${spec.navbar.h}px`);
  L.push('\n**以上是实测值：padding/margin/gap/圆角/字号/行高/控件高度/列宽比例都要对齐它；颜色不用你管（平台按原站色板自动套 token），你只准用 .pf-* 组件和 var(--pf-*)。**\n');
  return L.join('\n');
}

// --------------------------------------------
// scoped 色板：平台确定性生成，只覆盖本页根节点内的 pf token
// 模型全程不碰 hex；要恢复 PF 主题，去掉这层包裹即可
// --------------------------------------------
const PALETTE_TOKEN_MAP: Array<[string, string]> = [
  ['primary', '--pf-primary'],
  ['primaryHover', '--pf-primary-hover'],
  ['primarySoft', '--pf-primary-soft'],
  ['text1', '--pf-text-1'],
  ['text2', '--pf-text-2'],
  ['text3', '--pf-text-3'],
  ['placeholder', '--pf-text-3'],
  ['surface', '--pf-bg-surface'],
  ['bg', '--pf-bg-surface'],
  ['bgPage', '--pf-bg-app'],
  ['success', '--pf-success'],
  ['warning', '--pf-warning'],
  ['danger', '--pf-danger'],
  ['info', '--pf-info'],
];

export function wrapScopedPalette(html: string, spec: any): string {
  if (!spec || !spec.palette || typeof spec.palette !== 'object') return html;
  const pal = spec.palette;
  const decls: string[] = [];
  for (const [key, token] of PALETTE_TOKEN_MAP) {
    const v = pal[key];
    if (v && typeof v === 'string') decls.push(`  ${token}: ${v};`);
  }
  // 边框：Element 常规边框更深（输入框），light 更浅（卡片分隔）
  if (pal.border) decls.push('  --pf-border-strong: ' + pal.border + ';');
  if (pal.borderLight) decls.push('  --pf-border: ' + pal.borderLight + ';');
  else if (pal.border) decls.push('  --pf-border: ' + pal.border + ';');
  // 顶栏深色（采集器沿祖先链实测）
  if (spec.chrome && spec.chrome.bg) decls.push('  --pf-nav-solid-bg: ' + spec.chrome.bg + ';');
  if (!decls.length) return html;
  const style = `<style>\n.pfx-scoped-page{\n${decls.join('\n')}\n}\n</style>`;
  return `${style}\n<div class="pfx-scoped-page">\n${html}\n</div>`;
}

const EXTERNAL_REBUILD_INTRO = `# 你的任务：把一个**已上线真实页面**的采集结构，1:1 转写成 PF 原型页面

给你的是浏览器渲染后抽取的精简 HTML（保留 Element Plus 组件 class、文本、层级和少量关键样式）。
这是别人做好的真系统，你的目标是**忠实复刻现状**，不是重新设计：

1. **布局结构、信息层级、区块划分、字段、表格列、按钮、文案、配色气质，严格照采集 HTML 还原**，不许增删业务内容、不许发明页面上没有的模块。
2. 采集里的 Element Plus 组件（data-el / el-* class）转译成下方 PF 组件库：
   - el-card → pf-card；el-button(--primary) → pf-btn( primary)；el-table → pf-table；
   - el-input/el-select → pf-input；el-form 字段 → pf-field；el-tag → pf-tag；
   - el-tabs / el-collapse / el-radio-group / el-empty 等用原生 + PF class 做出同样结构和观感。
3. 数据用**页面内 const 静态假数据**（写在 <script> 里，数组写 4-6 行像真的业务数据），**不许调用 PF.records/findRecord/addRecord/statusMap 等任何数据 API**（这个原型没有数据集）。
4. **不许用 PF.go**（其他页面还没重建）；需要表现“能跳”的地方写成普通按钮/链接样式即可，不要绑跳转。
5. 交互只还原**看得见的状态结构**：弹窗/下拉/折叠面板在页面里做出静态结构和最简单的原生 JS 开关；不还原真实接口逻辑。
6. <svg-icon /> 是图标占位，用简洁线性内联 svg 代替；<canvas-chart> 是图表，用简化的 CSS 柱状/折线占位或 pf-stat 卡组表现其区域。
7. 后台页面最外层用 <div class="p-5 flex flex-col gap-4">；如果采集内容明显是全屏门户/登录页，才用沉浸页结构。
8. **label/输入框的相对位置严格照采集 HTML**：原页 label 在左（横向表单）你就做在左，原页 label 在上（纵向）你才做在上；卡片是左右双栏还是上下堆叠、宽度比例、间距，都要忠实。

# 颜色铁律（违反会被打回重做）
- **严禁任何写死颜色**：不许 text-gray-500 / bg-gray-100 / border-gray-200 这类带色 Tailwind class，不许内联 style 写 #hex / rgb()。
- 正文标题色用 .pf-* 组件默认；需要次级/弱化文字时写内联 \`style="color:var(--pf-text-2)"\`，最弱提示用 \`var(--pf-text-3)\`。
- 分隔线/弱边框用 \`style="border-color:var(--pf-border)"\` 或 pf-card 自带边框；页面底色用 \`var(--pf-bg-app)\`，卡片面用 \`var(--pf-bg-surface)\`。
- 强调色/主按钮只准用 .pf-btn.primary / .pf-tag.* / .pf-link 等内建组件，它们自带主题色。
- 布局、间距、字号、圆角、阴影可以用无颜色的 Tailwind class（flex/grid/p-*/gap-*/text-sm/rounded-lg/shadow-sm 等）。

输出要求与代码规范完全照下方《页面代码写法》。`;

export async function buildExternalPageHtml(opts: {
  title: string;
  url: string;
  domHtml: string;
  opinions?: string[];
  layoutHint?: string;
  visualSpec?: any;
}): Promise<string> {
  const { title, url, domHtml, opinions = [], layoutHint = 'sidebar', visualSpec = null } = opts;
  const specBlock = formatVisualSpec(visualSpec);
  const isTopnav = layoutHint === 'topnav';
  const layoutBlock = isTopnav
    ? `# 布局形态：原系统是**顶部深藏青横导航 + 无侧栏**的后台（采集根节点 data-layout="topnav"）\n` +
      `- 本页必须按【全屏页】输出：**不要套 p-5 在外层，不要做左侧菜单**，最外层用 <div> 贴边全宽。\n` +
      `- 页面最顶部用 **<nav class="pf-navbar dark-solid">** 还原原站深色顶栏（必须带 dark-solid，它是藏青底白字，不要用白底 navbar）：品牌 logo 位（pf-brand-mark 里放一个简洁线性 svg）+ 站点名 + 横向主菜单（照采集 header 菜单项：首页/企业评估/企业报告/风险监控/策略引擎/企业数据）+ 右侧用户区（圆形头像首字 + 用户名）；当前模块的菜单项加 class="active"。\n` +
      `- 顶栏下方是一行面包屑，再往下内容区整体包一层 <div class="p-5 flex flex-col gap-4">。\n` +
      `- 顶栏颜色已由 dark-solid 内建，**不要自己写任何背景色/文字色**。\n\n`
    : `# 布局形态：原系统是**左侧导航**后台（data-layout="sidebar"），按普通后台页输出（最外层 <div class="p-5 flex flex-col gap-4">），不用自己画顶栏侧栏（壳已提供）。\n\n`;
  // Element Plus 表单排布信号（label-right/left=横排，label-top=竖排），给模型死映射，避免把横排画成竖排
  const formSignal = /el-form--label-(right|left)/.test(domHtml)
    ? `# 表单排布（重要，别画反）\n采集到的是 Element Plus **el-form--label-right 横向表单**：label 在**左**、控件在**右**，同一 el-row 里多个 el-col-12 = **一行两列**。\n**必须严格照下面这个结构写，禁止把 label 放到输入框上方**：\n\`\`\`html\n<!-- 一行两列 -->\n<div class="grid grid-cols-2 gap-x-6" style="row-gap:18px">\n  <div class="flex items-start" style="margin-bottom:0">\n    <label class="shrink-0 pt-[7px] text-right text-[14px] leading-none" style="width:110px;padding-right:12px">策略名称</label>\n    <div class="flex-1 min-w-0"><!-- 控件，高32px，圆角8px --></div>\n  </div>\n  <div class="flex items-start">\n    <label class="shrink-0 pt-[7px] text-right text-[14px] leading-none" style="width:110px;padding-right:12px">适用场景</label>\n    <div class="flex-1 min-w-0"></div>\n  </div>\n</div>\n<!-- 独占一行的字段（如多行文本）：外层不要 grid，直接同样的 flex 横排，控件 flex-1 -->\n<div class="flex items-start" style="margin-bottom:18px">\n  <label class="shrink-0 pt-[7px] text-right text-[14px] leading-none" style="width:110px;padding-right:12px">策略描述</label>\n  <div class="flex-1 min-w-0"></div>\n</div>\n\`\`\`\n要点：label 固定 110px 右对齐、padding-right 12px；必填红星放 label 文字前；纵向间距 18px；控件全部高 32px。\n\n`
    : '';
  // 采集 HTML 限长保护，超了截尾部（主内容一般在前中段；超长页后续做分块）
  const MAX_DOM = 60000;
  const dom = domHtml.length > MAX_DOM ? domHtml.slice(0, MAX_DOM) + '\n<!-- 采集内容超长，尾部截断 -->' : domHtml;
  const opinionText = opinions.length
    ? `\n\n# 本页已贴的评审意见（复刻时**只保留现状结构**，不要照意见改；意见仅供你理解页面）\n${opinions.map((o, i) => `${i + 1}. ${o}`).join('\n')}`
    : '';
  const messages: LLMMessage[] = [
    { role: 'system', content: '你是资深前端工程师，擅长把真实系统页面高保真转写成 Tailwind 原型片段，像素级尊重原版式，严格遵守设计 token 不写死颜色。' },
    {
      role: 'user',
      content:
        `${CODE_GUIDE}\n\n${EXTERNAL_REBUILD_INTRO}\n\n` +
        layoutBlock + formSignal + specBlock + '\n' +
        `# 页面信息\n标题：${title}\n来源 URL：${url}\n\n` +
        `# 采集到的真实页面结构\n\`\`\`html\n${dom}\n\`\`\`${opinionText}\n\n` +
        `请输出页面「${title}」的完整 PF HTML 片段。再次提醒：不要写死任何颜色（平台会按原站色板自动套色）；版式、label 左右位置、一行几列、卡片比例、字号字重、圆角、间距都严格对齐上面的实测视觉规格，追求和原系统一致的精致度。`,
    },
  ];

  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callModel(
        attempt === 0 ? messages : [...messages, { role: 'user', content: `上次页面代码有问题：${lastErr}\n请修正后重新输出这个页面的完整 HTML 片段。` }],
        0.3,
        32000
      );
      const rawHtml = extractHtml(raw);
      if (rawHtml.length < 100) throw new Error('HTML 内容为空或过短');
      const baseErr = checkPageHtml(rawHtml, { pages: [{ id: 'external-page' }], datasets: [] }, 'external-page');
      if (baseErr) throw new Error(baseErr);
      // 确定性去色（不靠模型自觉）：剥带色 class/内联颜色，回落 pf token
      const clean = sanitizeExternalPageHtml(rawHtml);
      const residual = checkExternalPageHtml(clean);
      if (residual.length) console.log(`[外部重建] 去色后仍有残留（已兜底不阻断）：${residual[0]}`);
      // 平台按采集色板套 scoped token：颜色 1:1 还原，但不写死、可一键剥离
      const html = wrapScopedPalette(clean, visualSpec);
      return html;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (attempt === 1) throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || '重建失败');
}

// --------------------------------------------
// 第 1 步：骨架契约
// 页面集合 = 需求清单里的页面需求集合（代码侧强制），AI 只定 id/kind/分组/数据集，不许发明页面
// --------------------------------------------
const SKELETON_RULES = `# 你的任务：为【已定的页面清单】设计原型骨架
页面清单是 PM 已确认的需求，**一条页面需求 = 一个原型页，不许新增、遗漏、合并**。页面的具体 HTML 代码由别的工人按你的契约并行编写，你不要输出页面代码。

# 输出格式（只输出 JSON）
{
  "appName": "站点名，如 担保业务管理系统",
  "theme": "视觉主题，四选一：saas|dark|finance|consumer（见下方选色规则）",
  "pages": [
    { "id": "英文驼峰id", "title": "页面名（用需求标题）", "kind": "form|list|detail", "immersive": false, "group": "所属模块分组名", "requirementId": "对应页面需求的id（必须填，一一对应）" }
  ],
  "nav": [
    { "pageId": "必须是 pages 里的 id", "title": "导航显示名", "group": "模块分组名", "requirementId": "该分组对应模块需求的id（有就填）" }
  ],
  "datasets": [
    {
      "name": "数据集英文名",
      "statusField": "状态字段名，没有状态可省略",
      "statusMap": { "draft": {"text":"草稿","type":"info"}, "pending": {"text":"待审核","type":"warning"}, "approved": {"text":"已通过","type":"success"}, "rejected": {"text":"已驳回","type":"danger"} },
      "records": [ { "字段名": "值，状态字段用 statusMap 的 key" } ]
    }
  ]
}

# 铁律
- **pages 必须与输入的页面清单一一对应**：数量一致、requirementId 一一对应、title 用需求标题。不许发明清单里没有的页面（哪怕你觉得业务上“应该有”），也不许漏掉。
- kind 按页面需求文档判断：录入类→form，列表/工作台类→list，详情类→detail。
- **immersive（沉浸态）**：对外门户/官网首页/营销落地页/登录注册页/大屏展示页 → true（这类页面全屏、自带顶部 navbar，不套后台左侧菜单）；后台的列表/表单/详情/工作台 → false。拿不准就 false。
- **form 和 list 进 nav；detail 不进 nav**（从列表弹窗或跳转进入）。不要为“列表行查看/审核通过驳回”这类轻量交互发明 detail 页——那些用弹窗完成；detail 只在页面需求本身就是独立详情页时才建。
- group 用页面所属模块名；nav 顺序符合业务流程。
- 每个有状态的数据集给 statusMap（type 只能是 info/warning/success/danger）。
- **mock 数据量按消费方定（重要）**：
  - 会被【工作台/看板/数据概览/大屏/统计分析】类页面的图表（PF.chart）或指标卡（PF.metric）消费的数据集：**30~50 条**记录；必须有一个日期字段（如 createdAt，"2026-08-28 10:30" 格式）且日期**铺在最近 12 个月内、逐月都有分布**（折线图才有形状）；分类字段（行业/类型/状态）分布要不均匀、像真实业务（状态不要平均分配，通常已通过占多数、待审核/驳回少数）；金额符合业务量级且有大小差异。
  - 纯录入/列表/详情（CRUD）消费的数据集：4~6 条即可。
  - 判断不了有没有图表消费时，按 8~12 条给。
- 记录 id 用 "r1","r2"...；时间用 "2026-08-28 10:30" 字符串；金额用数字（元）。
- **转化漏斗要独立正向阶段字段（重要）**：页面需求里出现「转化漏斗/销售漏斗/线索转化/阶段转化」时，必须在对应数据集造一个**独立的正向阶段字段**（如 stage/phase），取值只能是层层递进的转化环节（submitted 提交→reviewing 审核中→signed 已签约→done 已放款），并给该字段配 statusMap；记录沿漏斗**严格上宽下窄递减分布**（如 4 阶段总 40 条左右：提交 ~16、审核中 ~11、已签约 ~8、已放款 ~5，越靠后越少，绝不能平均分配——等宽的漏斗一眼假）；该数据集总量也控在 30~50 条。**不要**只靠业务终态 status（它含 rejected 已驳回/cancelled 已取消等异常分支），否则漏斗会把异常态错当转化阶段。若漏斗主体是另一类对象（线索 vs 台账），为它单建一个数据集。
- **theme 按行业气质选**：金融/银行/担保/保险/财务/政企审批类 → "finance"（藏青稳重、高密度）；数据监控/大屏/AI/运维/科技平台类 → "dark"（深色数据感）；C 端/会员/营销/电商/门店/小程序类 → "consumer"（大圆角撞色、活泼）；通用后台/SaaS/管理系统/拿不准 → "saas"（明亮靛蓝，默认）。
只输出 JSON 本身。`;

function buildDocsText(reqs: ReqDoc[]): string {
  return reqs
    .map((r, i) => {
      const label = r.kind === 'page' ? '页面' : '模块';
      const idTag = r.id ? `，需求id=${r.id}` : '';
      return `## 需求 ${i + 1}【${label}】：${r.title}（${r.status === 'confirmed' ? '已确认' : '待确认'}${idTag}）\n\n${r.doc_md}`;
    })
    .join('\n\n---\n\n');
}

/** 页面清单（代码侧从已确认页面需求组装，AI 必须一一对应） */
function buildPageManifest(reqs: ReqDoc[]): Array<{ requirementId: string; title: string; module: string; moduleReqId?: string }> {
  const mods = reqs.filter((r) => r.kind !== 'page');
  const modTitle = (id?: string | null) => mods.find((m) => m.id === id)?.title || '';
  return reqs
    .filter((r) => r.kind === 'page')
    .map((r) => ({
      requirementId: r.id!,
      title: r.title,
      module: modTitle(r.parent_id) || '未分组',
      moduleReqId: r.parent_id || undefined,
    }));
}

function validateSkeleton(s: any, manifest: Array<{ requirementId: string; title: string; module: string }>): string[] {
  const errs: string[] = [];
  if (!s?.appName) errs.push('缺少 appName');
  if (!Array.isArray(s.pages) || !s.pages.length) errs.push('pages 为空');
  if (!Array.isArray(s.nav) || !s.nav.length) errs.push('nav 为空');
  if (!Array.isArray(s.datasets)) errs.push('datasets 必须是数组');
  if (errs.length) return errs;

  // 铁律：页面集合必须与页面需求清单一一对应
  const manifestIds = new Set(manifest.map((m) => m.requirementId));
  const gotIds = new Set(s.pages.map((p: any) => p.requirementId).filter(Boolean));
  if (s.pages.length !== manifest.length) {
    errs.push(`pages 数量 ${s.pages.length} 与页面需求数量 ${manifest.length} 不一致（不许新增或遗漏页面）`);
  }
  for (const m of manifest) {
    if (!gotIds.has(m.requirementId)) errs.push(`缺少页面需求「${m.title}」(${m.requirementId}) 对应的页面`);
  }
  for (const p of s.pages) {
    if (p.requirementId && !manifestIds.has(p.requirementId)) errs.push(`页面 ${p.id} 关联了不存在的页面需求 ${p.requirementId}（不许发明页面）`);
  }

  const pageIds = new Set(s.pages.map((p: any) => p.id));
  for (const n of s.nav) if (!pageIds.has(n.pageId)) errs.push(`导航「${n.title}」指向的页面 ${n.pageId} 不存在`);
  for (const p of s.pages) {
    if (!p.id) { errs.push('有页面缺 id'); continue; }
    if (!['form', 'list', 'detail'].includes(p.kind)) errs.push(`页面 ${p.id} kind 非法`);
    const inNav = s.nav.some((n: any) => n.pageId === p.id);
    if (!inNav && p.kind !== 'detail') errs.push(`页面 ${p.id} 不在导航里且不是详情页`);
  }
  for (const ds of s.datasets) {
    if (!ds.name) { errs.push('有数据集缺 name'); continue; }
    if (!Array.isArray(ds.records) || !ds.records.length) errs.push(`数据集 ${ds.name} 缺 records`);
  }
  return errs;
}

async function buildSkeleton(reqs: ReqDoc[]): Promise<any> {
  const manifest = buildPageManifest(reqs);
  const manifestText = manifest
    .map((m, i) => `${i + 1}. 需求id=${m.requirementId} 标题="${m.title}" 所属模块="${m.module}"${m.moduleReqId ? ` 模块需求id=${m.moduleReqId}` : ''}`)
    .join('\n');
  const messages: LLMMessage[] = [
    { role: 'system', content: '你是资深产品架构师，擅长把已确认的需求拆成页面结构和数据模型。只输出 JSON。' },
    { role: 'user', content: `${SKELETON_RULES}\n\n# 必须建的页面清单（一条 = 一个原型页，一一对应）\n${manifestText}\n\n# 需求文档\n${buildDocsText(reqs)}` },
  ];
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const st = Date.now();
    try {
      const out = await callJson(attempt === 0 ? messages : [...messages, { role: 'user', content: `上次输出有问题：${lastErr}，请修正后只输出 JSON。` }], 0.2, 16000);
      const errs = validateSkeleton(out, manifest);
      if (errs.length) { lastErr = errs.join('；'); console.log(`[管线] 骨架第${attempt + 1}次校验失败(${Date.now() - st}ms): ${lastErr.slice(0, 120)}`); continue; }
      console.log(`[管线] 骨架完成 ${Date.now() - st}ms | ${out.pages.length}页 ${out.datasets.length}数据集`);
      return out;
    } catch (e) {
      lastErr = (e as Error).message;
      console.log(`[管线] 骨架第${attempt + 1}次异常(${Date.now() - st}ms): ${lastErr.slice(0, 120)}`);
    }
  }
  throw new Error(`骨架生成失败：${lastErr}`);
}

// --------------------------------------------
// 第 2 步：单页代码 worker
// --------------------------------------------
const PAGE_RULES_INTRO = `# 你的任务：按「骨架契约」编写**一个页面**的 HTML 代码片段
契约已定死所有 pageId、数据集字段、状态枚举。你只输出分给你的这一页的代码。
- PF.records/addRecord/findRecord 等只能引用契约里存在的数据集名，不许发明数据集。
- **跳转规则**：所有导航/查看/操作入口按钮都必须有点击行为，不许留死按钮。跳页一律用 \`PF.go('目标页英文驼峰id')\`（如「浏览 API 市场」→ \`PF.go('ApiMarket')\`、「查看详情」→ \`PF.go('ApiDetail')\`）。契约 pages 里暂不存在的目标页**也照常写 PF.go**——系统运行时会自动提示「该功能将在后续模块上线」，等对应模块生成后跳转自动接通，你不需要判断页面是否已生成。
- 字段名、状态值、业务规则严格遵循需求文档和契约，不许发明。
- **宽内容不能被裁**：表格列多时，表格外层容器要用 \`overflow-x-auto\`（不要用 overflow-hidden），让表格能横向滚动；表头/单元格不要写死过宽。
- 只输出 HTML 片段本身（可以用 \`\`\`html 围栏包裹），不要输出解释。
${CSS_VAR_WHITELIST_TEXT}`;

export async function buildPageHtml(page: any, skel: any, reqs: ReqDoc[]): Promise<string> {
  const reqIds = new Set<string>();
  if (page.requirementId) reqIds.add(page.requirementId);
  const navItem = (skel.nav || []).find((n: any) => n.group === page.group && n.requirementId);
  if (navItem?.requirementId) reqIds.add(navItem.requirementId);
  const myReqs = reqs.filter((r) => r.id && reqIds.has(r.id));
  const docsText = myReqs.length ? buildDocsText(myReqs) : '（本页没有独立需求文档，按页面标题和契约合理设计）';

  const contract = {
    appName: skel.appName,
    pages: (skel.pages || []).map((p: any) => ({ id: p.id, title: p.title, kind: p.kind, immersive: !!p.immersive })),
    datasets: skel.datasets,
  };

  const immersiveTip = page.immersive
    ? `\n⚠️ **本页是沉浸页（immersive=true）**：对外门户/官网/营销页，壳已隐藏后台侧栏和顶栏、全屏展示。你必须自己用 \`pf-navbar\` 做顶部导航（logo+链接+CTA），最外层不要套 \`p-5\`，navbar/hero/各区块贴边全宽。这是营销官网不是后台，首屏必须 pf-hero。`
    : `\n本页是后台页（immersive=false）：外层用 \`<div class="p-5 flex flex-col gap-4">\`，不要自己做顶部 navbar（壳已有侧栏导航）。`;

  const messages: LLMMessage[] = [
    { role: 'system', content: '你是资深前端工程师，擅长用 Tailwind + 原生 JS 写出精致的业务系统页面原型。' },
    {
      role: 'user',
      content:
        `${CODE_GUIDE}\n\n${PAGE_RULES_INTRO}\n\n` +
        `# 骨架契约（必须严格遵守）\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n\n` +
        `# 本页需求文档\n${docsText}\n\n` +
        `请输出页面「${page.title}」（id=${page.id}，kind=${page.kind}）的 HTML 片段。${immersiveTip}`,
    },
  ];

  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const st = Date.now();
    try {
      const raw = await callModel(
        attempt === 0 ? messages : [...messages, { role: 'user', content: `上次页面代码有问题：${lastErr}\n请修正后重新输出这个页面的完整 HTML 片段。` }],
        0.4,
        32000
      );
      const html = extractHtml(raw);
      if (html.length < 100) throw new Error('HTML 内容为空或过短');
      // 用契约拼一个临时 spec 做引用校验
      const tmpSpec = {
        pages: (skel.pages || []).map((p: any) => ({ id: p.id })),
        datasets: (skel.datasets || []).map((d: any) => ({ name: d.name })),
      };
      const perr = checkPageHtml(html, tmpSpec, page.id);
      if (perr) throw new Error(perr);
      console.log(`[管线]   页「${page.id}」完成 ${Date.now() - st}ms, ${html.length} 字符`);
      return html;
    } catch (e) {
      lastErr = (e as Error).message;
      console.log(`[管线]   页「${page.id}」第${attempt + 1}次失败(${Date.now() - st}ms): ${lastErr.slice(0, 120)}`);
    }
  }
  throw new Error(`页面「${page.title}」生成失败：${lastErr}`);
}

// --------------------------------------------
// 主管线：骨架 → 逐页并行
// --------------------------------------------
export async function generatePrototypePipeline(projectId: string, reqs: ReqDoc[], layout: ProtoLayout = 'sidebar'): Promise<void> {
  const model = getPrototypeModel();
  console.log(`[管线] 开始（代码生成 v2），模型=${model}，布局=${layout}，需求 ${reqs.length} 条`);

  const skel = await buildSkeleton(reqs);

  const spec = emptySpec();
  spec.appName = skel.appName;
  spec.theme = ['saas', 'dark', 'finance', 'consumer'].includes(skel.theme) ? skel.theme : 'saas';
  // 布局由 PM 生成前手动指定，AI 骨架契约不含此字段、不参与决定
  spec.layout = layout;
  spec.generatedAt = new Date().toISOString();
  spec.nav = (skel.nav || []).map((n: any) => ({ pageId: n.pageId, title: n.title, group: n.group || '', requirementId: n.requirementId }));
  spec.pages = (skel.pages || []).map((p: any) => ({
    id: p.id, title: p.title, kind: p.kind, immersive: !!p.immersive, group: p.group || '', requirementId: p.requirementId, html: '',
  }));
  spec.datasets = (skel.datasets || []).map((d: any) => ({
    name: d.name,
    statusField: d.statusField || 'status',
    statusMap: d.statusMap || {},
    records: d.records || [],
  }));
  for (const p of skel.pages) spec.pageStatus[p.id] = 'pending';
  attachRequirementSnapshots(spec, projectId);

  const skelErrs = validateSpec(spec, { partial: true });
  if (skelErrs.length) throw new Error(`骨架结构异常：${skelErrs.join('；')}`);

  upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'generating', error: null });
  console.log(`[管线] 骨架已落库，前端可见导航；开始 ${skel.pages.length} 页并行编码`);

  const savePage = (pageId: string, html: string, status: 'ready' | 'error') => {
    const pg = spec.pages.find((p: any) => p.id === pageId);
    if (pg) pg.html = html || '';
    spec.pageStatus[pageId] = status;
    spec.generatedAt = new Date().toISOString();
    upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'generating', error: null });
  };

  const results = await Promise.allSettled(
    skel.pages.map((page: any) =>
      buildPageHtml(page, skel, reqs)
        .then((html) => { savePage(page.id, html, 'ready'); return page.id; })
        .catch((e) => { savePage(page.id, '', 'error'); throw e; })
    )
  );

  const failed: string[] = [];
  results.forEach((r, i) => { if (r.status === 'rejected') failed.push(skel.pages[i].title); });

  spec.generatedAt = new Date().toISOString();
  if (failed.length) {
    upsertPrototype(projectId, {
      specJson: JSON.stringify(spec),
      status: 'ready',
      error: `以下页面生成失败：${failed.join('、')}（可在原型里对该页贴意见让 AI 修补，或重新生成）`,
    });
    console.log(`[管线] 完成（部分失败）：${failed.join('、')}`);
  } else {
    const errs = validateSpec(spec);
    upsertPrototype(projectId, {
      specJson: JSON.stringify(spec),
      status: 'ready',
      error: errs.length ? `校验提示：${errs.join('；')}` : null,
    });
    console.log('[管线] 全部页面完成，status=ready');
  }
}

// --------------------------------------------
// 模块增量管线：只补/重做一个模块
// --------------------------------------------
const MODULE_RULES = `# 你的任务：在**已有原型**基础上，为【一个模块已定的页面清单】重做/补建页面
系统整体结构已存在（下面给你现有骨架）。你只负责这个模块，绝不能改动/重命名其他模块已有的页面和数据集。

# 输出格式（只输出 JSON）
{
  "group": "这个模块在导航里的分组名（沿用需求模块名；若现有骨架已有同名分组，用完全一样的名字）",
  "pages": [ { "id": "英文驼峰id", "title": "页面名（用需求标题）", "kind": "form|list|detail", "requirementId": "对应页面需求id（必须填，一一对应）" } ],
  "nav": [ { "pageId": "必须是 pages 里的 id", "title": "导航名", "requirementId": "模块需求id" } ],
  "datasets": [ 仅当这个模块需要【全新】数据集时才给，结构同骨架契约；CRUD 用给 4~6 条 mock，会被看板/工作台图表（PF.chart/PF.metric）消费的给 30~50 条且日期铺近 12 个月 ]
}

# 铁律
- **pages 必须与输入的该模块页面清单一一对应**：数量一致、requirementId 一一对应，不许新增/遗漏/发明页面。
- form/list 进 nav；detail 不进 nav。不要为轻量交互（列表行查看、审核通过驳回）发明 detail 页，那些用弹窗。
- pageId 英文驼峰且全局唯一：先看现有骨架已有的 pageId，不许重名（重做已有页面时沿用原 pageId）。
- pages/nav 只为这个模块的页面清单创建，不要把其他模块的页加进来；页面代码里跨模块入口照常 PF.go（目标页暂不存在时系统运行时自动占位）。
- 复用现有数据集就不要在 datasets 里重建；只有独有新数据集才放。
- 状态枚举若复用现有数据集，沿用现有 statusMap 的 key。
只输出 JSON 本身。`;

async function buildModuleSkeleton(existingSpec: any, moduleReqs: ReqDoc[]): Promise<any> {
  // 该模块的页面清单（代码侧强制，AI 必须一一对应）
  const pageManifest = moduleReqs
    .filter((r) => r.kind === 'page')
    .map((r) => ({ requirementId: r.id!, title: r.title }));
  const manifestText = pageManifest.map((m, i) => `${i + 1}. 需求id=${m.requirementId} 标题="${m.title}"`).join('\n');
  const existing = {
    appName: existingSpec.appName,
    nav: (existingSpec.nav || []).map((n: any) => ({ pageId: n.pageId, title: n.title, group: n.group })),
    pages: (existingSpec.pages || []).map((p: any) => ({ id: p.id, title: p.title, kind: p.kind })),
    datasets: (existingSpec.datasets || []).map((d: any) => ({
      name: d.name, statusField: d.statusField, statusMap: d.statusMap,
      records: (d.records || []).slice(0, 1),
    })),
  };
  const messages: LLMMessage[] = [
    { role: 'system', content: '你是资深产品架构师，擅长在已有系统上增量扩展一个业务模块。只输出 JSON。' },
    {
      role: 'user',
      content:
        `${MODULE_RULES}\n\n# 必须建的页面清单（一条 = 一个原型页，一一对应）\n${manifestText}\n\n` +
        `# 现有原型骨架（必须兼容，不许破坏）\n\`\`\`json\n${JSON.stringify(existing, null, 2)}\n\`\`\`\n\n` +
        `# 本次要补的模块需求文档\n${buildDocsText(moduleReqs)}\n\n` +
        `请只输出这个模块的增量 JSON。`,
    },
  ];

  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const st = Date.now();
    try {
      const out = await callJson(
        attempt === 0 ? messages : [...messages, { role: 'user', content: `上次输出有问题：${lastErr}，请修正后只输出 JSON。` }],
        0.2
      );
      const errs = validateModuleSkeleton(out, existingSpec, pageManifest);
      if (errs.length) { lastErr = errs.join('；'); console.log(`[模块管线] 骨架第${attempt + 1}次校验失败(${Date.now() - st}ms): ${lastErr.slice(0, 120)}`); continue; }
      console.log(`[模块管线] 模块骨架完成 ${Date.now() - st}ms | 分组「${out.group}」新增 ${out.pages.length} 页`);
      return out;
    } catch (e) {
      lastErr = (e as Error).message;
      console.log(`[模块管线] 骨架第${attempt + 1}次异常(${Date.now() - st}ms): ${lastErr.slice(0, 120)}`);
    }
  }
  throw new Error(`模块骨架生成失败：${lastErr}`);
}

function validateModuleSkeleton(out: any, existingSpec: any, pageManifest: Array<{ requirementId: string; title: string }>): string[] {
  const errs: string[] = [];
  if (!out?.group) errs.push('缺少 group');
  if (!Array.isArray(out.pages) || !out.pages.length) errs.push('pages 为空');
  if (!Array.isArray(out.nav)) errs.push('nav 必须是数组');
  if (errs.length) return errs;
  // 铁律：页面与该模块页面需求一一对应
  const manifestIds = new Set(pageManifest.map((m) => m.requirementId));
  const gotIds = new Set(out.pages.map((p: any) => p.requirementId).filter(Boolean));
  if (out.pages.length !== pageManifest.length) {
    errs.push(`pages 数量 ${out.pages.length} 与该模块页面需求数量 ${pageManifest.length} 不一致（不许新增或遗漏页面）`);
  }
  for (const m of pageManifest) if (!gotIds.has(m.requirementId)) errs.push(`缺少页面需求「${m.title}」对应的页面`);
  for (const p of out.pages) if (p.requirementId && !manifestIds.has(p.requirementId)) errs.push(`页面 ${p.id} 关联了不属于本模块的需求（不许发明页面）`);

  const existingIds = new Set((existingSpec.pages || []).map((p: any) => p.id));
  const newIds = new Set<string>();
  for (const p of out.pages) {
    if (!p.id) { errs.push('有页面缺 id'); continue; }
    // 重做已有页面：同 requirementId 的旧页 id 允许复用
    const oldPage = (existingSpec.pages || []).find((x: any) => x.requirementId === p.requirementId);
    if (existingIds.has(p.id) && (!oldPage || oldPage.id !== p.id)) errs.push(`页面 ${p.id} 与其他模块现有页面重名`);
    if (newIds.has(p.id)) errs.push(`模块内页面 id 重复：${p.id}`);
    newIds.add(p.id);
    if (!['form', 'list', 'detail'].includes(p.kind)) errs.push(`页面 ${p.id} kind 非法`);
  }
  for (const n of out.nav || []) if (!newIds.has(n.pageId)) errs.push(`导航「${n.title}」应指向本模块页面 ${n.pageId}`);
  return errs;
}

export async function generateModulePipeline(projectId: string, moduleReqIds: string[]): Promise<void> {
  const row = getPrototype(projectId);
  if (!row?.spec_json) throw new Error('主原型还没生成，请先生成主原型');
  const spec = JSON.parse(row.spec_json);
  if (spec.version !== 2) throw new Error('旧版原型数据，请重新生成整套原型');
  console.log(`[模块管线] 开始，模块需求 ${moduleReqIds.length} 条`);

  const allReqs = listRequirements(projectId).map((r: any) => ({
    id: r.id, title: r.title, doc_md: r.doc_md, status: r.status, kind: r.kind, parent_id: r.parent_id,
  }));
  const idSet = new Set(moduleReqIds);
  const moduleReqs = allReqs.filter((r) => r.id && idSet.has(r.id));
  if (!moduleReqs.length) throw new Error('找不到该模块的需求文档');

  const delta = await buildModuleSkeleton(spec, moduleReqs);
  const groupName = delta.group;
  const moduleReqIdSet = new Set(moduleReqs.map((r) => r.id).filter(Boolean) as string[]);

  // 合并：删该分组旧 nav/旧页（按 group + 需求归属兜底）
  const oldGroupPageIds = new Set<string>(
    (spec.nav || []).filter((n: any) => n.group === groupName).map((n: any) => String(n.pageId))
  );
  spec.nav = (spec.nav || []).filter((n: any) => n.group !== groupName);
  spec.pages = (spec.pages || []).filter((pg: any) => {
    if (pg.group === groupName) { oldGroupPageIds.add(pg.id); return false; }
    if (!pg.group && oldGroupPageIds.has(pg.id)) return false;
    if (pg.requirementId && moduleReqIdSet.has(pg.requirementId)) { oldGroupPageIds.add(pg.id); return false; }
    return true;
  });
  for (const n of delta.nav || []) spec.nav.push({ pageId: n.pageId, title: n.title, group: groupName, requirementId: n.requirementId });
  for (const p of delta.pages) {
    spec.pages.push({ id: p.id, title: p.title, kind: p.kind, immersive: !!p.immersive, group: groupName, requirementId: p.requirementId, html: '' });
  }
  spec.datasets = spec.datasets || [];
  for (const ds of delta.datasets || []) {
    spec.datasets = spec.datasets.filter((d: any) => d.name !== ds.name);
    spec.datasets.push({ name: ds.name, statusField: ds.statusField || 'status', statusMap: ds.statusMap || {}, records: ds.records || [] });
  }
  spec.pageStatus = spec.pageStatus || {};
  for (const p of delta.pages) spec.pageStatus[p.id] = 'pending';
  for (const id of oldGroupPageIds) delete spec.pageStatus[id];

  // 页面 worker 需要的契约（含全部页/数据集）
  const mergedSkel = {
    appName: spec.appName,
    nav: spec.nav,
    pages: spec.pages.map((p: any) => ({ id: p.id, title: p.title, kind: p.kind, group: p.group, requirementId: p.requirementId })),
    datasets: spec.datasets,
  };

  attachRequirementSnapshots(spec, projectId);
  const partialErrs = validateSpec(spec, { partial: true });
  if (partialErrs.length) throw new Error(`模块合并后结构异常：${partialErrs.join('；')}`);

  const save = () => { spec.generatedAt = new Date().toISOString(); upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'generating', error: null }); };
  save();
  console.log(`[模块管线] 模块「${groupName}」已合并落库，开始 ${delta.pages.length} 页并行编码`);

  const savePage = (pageId: string, html: string, status: 'ready' | 'error') => {
    const pg = spec.pages.find((p: any) => p.id === pageId);
    if (pg) pg.html = html || '';
    spec.pageStatus[pageId] = status;
    save();
  };
  const results = await Promise.allSettled(
    delta.pages.map((page: any) =>
      buildPageHtml(page, mergedSkel, moduleReqs)
        .then((html) => { savePage(page.id, html, 'ready'); return page.id; })
        .catch((e) => { savePage(page.id, '', 'error'); throw e; })
    )
  );
  const failed: string[] = [];
  results.forEach((r, i) => { if (r.status === 'rejected') failed.push(delta.pages[i].title); });

  spec.generatedAt = new Date().toISOString();
  if (failed.length) {
    upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'ready', error: `模块「${groupName}」以下页面生成失败：${failed.join('、')}` });
  } else {
    const errs = validateSpec(spec);
    upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'ready', error: errs.length ? `校验提示：${errs.join('；')}` : null });
  }
  console.log(`[模块管线] 模块「${groupName}」完成`);
}

// --------------------------------------------
// 单页重生成：主原型已存在，只重做某一页（其余页面/数据集不动）
// --------------------------------------------
export async function regeneratePagePipeline(projectId: string, pageReqId: string): Promise<{ title: string }> {
  const row = getPrototype(projectId);
  if (!row?.spec_json) throw new Error('主原型还没生成，请先生成整套原型');
  const spec = JSON.parse(row.spec_json);
  if (spec.version !== 2) throw new Error('旧版原型数据，请重新生成整套原型');

  // 按 requirementId 定位页面
  const target = (spec.pages || []).find((p: any) => p.requirementId === pageReqId);
  if (!target) throw new Error('这个页面还没有对应的原型页（先生成整套原型，或在对话里把需求聊清楚后整模块生成）');

  // 该页需求文档 + 其所属模块需求文档
  const allReqs = listRequirements(projectId);
  const pageReq = allReqs.find((r) => r.id === pageReqId);
  if (!pageReq) throw new Error('需求不存在');
  const reqsForPage: ReqDoc[] = [
    { id: pageReq.id, title: pageReq.title, doc_md: pageReq.doc_md, status: pageReq.status, kind: pageReq.kind, parent_id: pageReq.parent_id },
  ];
  if (pageReq.parent_id) {
    const mod = allReqs.find((r) => r.id === pageReq.parent_id);
    if (mod) reqsForPage.unshift({ id: mod.id, title: mod.title, doc_md: mod.doc_md, status: mod.status, kind: mod.kind, parent_id: mod.parent_id });
  }

  // 完整骨架上下文（页面 worker 需要看到所有 pageId/数据集，保证跳转/引用正确）
  const skel = {
    appName: spec.appName,
    nav: spec.nav,
    pages: spec.pages.map((p: any) => ({ id: p.id, title: p.title, kind: p.kind, immersive: !!p.immersive, group: p.group || '', requirementId: p.requirementId })),
    datasets: spec.datasets,
  };

  console.log(`[单页重生成] 页面「${target.id}」（需求：${pageReq.title}）开始`);
  spec.pageStatus[target.id] = 'pending';
  upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'generating', error: null });

  try {
    const html = await buildPageHtml(
      { id: target.id, title: target.title, kind: target.kind, immersive: !!target.immersive, group: target.group || '', requirementId: target.requirementId },
      skel,
      reqsForPage
    );
    target.html = html;
    spec.pageStatus[target.id] = 'ready';
    spec.patchedAt = new Date().toISOString();
    attachRequirementSnapshots(spec, projectId);
    const errs = checkPageHtml(html, spec, target.id);
    if (errs) console.log(`[单页重生成] 校验警告：${errs}`);
    upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'ready', error: null });
    console.log(`[单页重生成] 页面「${target.id}」完成，${html.length} 字符`);
    return { title: target.title };
  } catch (e) {
    spec.pageStatus[target.id] = 'error';
    upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'ready', error: `页面「${target.title}」重生成失败：${(e as Error).message}` });
    throw e;
  }
}
