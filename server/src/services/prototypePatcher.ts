// ============================================
// 原型局部修改 v3（ProtoForge）—— 分角色流水线
//   1) 分诊官：每条意见分类（界面/字段/业务规则/布局）、定涉及页面、定要不要动数据集、要不要同步需求文档
//   2) 数据官：仅当意见涉及字段/数据时，产出定稿数据集（补字段 + 全量 mock）
//   3) 页面工：每个受影响页面一个，拿着定稿数据契约并行重写该页 HTML
//   4) 代码硬校验（非 AI）：字段必须存在、旧列不许消失、数据集字段不许丢；不合格带原因重试
// 旧版单一大模型包打天下（边分诊边写页面又补数据）已废弃——职责混杂必然漏字段/凑数据。
// ============================================

import { chatCompletionStream, type LLMMessage } from '../llm/client.js';
import { getPrototypeModel } from '../config/index.js';
import { getPrototype, upsertPrototype, listAnnotations, getAnnotation, markAnnotationProtoApplied, markAnnotationNotApplied } from '../store/database.js';
import { extractJson, extractHtml, checkPageHtml, attachRequirementSnapshots, CSS_VAR_WHITELIST_TEXT, extractPfObjectCalls } from './prototypeCodeGen.js';
import { applySubtreePatches } from './htmlPath.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirnameP = path.dirname(fileURLToPath(import.meta.url));
const ANNOT_IMG_ROOT = path.resolve(__dirnameP, '../../data/uploads/annotations');

// 把一条意见的附图读成 data URL（image_url 多模态）。读不到/非本站路径返回 null。
async function imageToDataUrl(img: { url?: string; mime?: string }): Promise<string | null> {
  const url = img.url || '';
  const m = url.match(/^\/api\/projects\/([^/]+)\/annotation-images\/([^/]+)$/);
  if (!m) return null;
  const file = path.join(ANNOT_IMG_ROOT, `p_${m[1]}`, m[2]);
  if (!file.startsWith(ANNOT_IMG_ROOT)) return null;
  const buf = await fs.readFile(file).catch(() => null);
  if (!buf) return null;
  const mime = img.mime || (m[2].endsWith('.webp') ? 'image/webp' : m[2].match(/\.png$/i) ? 'image/png' : 'image/jpeg');
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// 收集本页涉及意见的去重附图，转成多模态 content parts（图片超过 4MB base64 时跳过，避免超载）
async function buildImageParts(annots: any[]): Promise<Array<{ type: 'image_url'; image_url: { url: string } }>> {
  const seen = new Set<string>();
  const parts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
  for (const a of annots) {
    let imgs: any[] = [];
    try { imgs = typeof a?.images === 'string' ? JSON.parse(a.images || '[]') : (a?.images || []); } catch { imgs = []; }
    for (const im of imgs) {
      if (seen.has(im.url)) continue;
      seen.add(im.url);
      const dataUrl = await imageToDataUrl(im);
      if (dataUrl && dataUrl.length <= 4_000_000) parts.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
  }
  return parts;
}

// 把原本纯文本 user content 升级为多模态（有附图时）
type UserContent = Extract<LLMMessage, { role: 'user' }>['content'];
async function withImages(text: string, annots: any[]): Promise<UserContent> {
  const parts = await buildImageParts(annots);
  if (!parts.length) return text;
  return [
    { type: 'text', text: text + '\n\n# 用户附了参考图（重要）\n以下图片是用户给的视觉依据。先结合每条意见的文字说明读懂意图——可能是“照原站改成这样”“这块有问题”或“参考这个竞品的感觉”，**以文字说明为准、图片为视觉依据**，据此施工。' },
    ...parts,
  ] as UserContent;
}

export interface AppliedItem {
  pageTitle: string
  targetLabel: string
  content: string
  needsReq: boolean
  applied: boolean
  reason?: string
  kind?: 'data' | 'page' | 'chart'
}

export interface PatchResult {
  ok: boolean
  error?: string
  changedPages?: string[]
  appliedCount?: number
  failedCount?: number
  dataChanged?: number
  needsReqCount?: number
  modes?: Record<string, string>
  appliedItems?: AppliedItem[]
}

// --------------------------------------------
// 工具
// --------------------------------------------
async function callModel(messages: LLMMessage[], temperature = 0.2, maxTokens = 8000): Promise<string> {
  let raw = '';
  await chatCompletionStream({
    messages,
    model: getPrototypeModel(),
    temperature,
    maxTokens,
    thinking: { type: 'disabled' },
    onChunk: (_d, acc) => { raw = acc; },
  });
  return raw;
}

const KIND_NAME: Record<string, string> = {
  field: '字段', action: '按钮', icon: '图标', section: '区块', page: '整页', element: '元素',
};

/** 靶向页面工主动判断“改动超出单元素、需整页重写”——不是异常，不重试，直接升级 */
class NeedRewriteError extends Error {
  constructor(message: string) { super(message); this.name = 'NeedRewriteError'; }
}

// --------------------------------------------
// 阶段 0（治谎报/数据类意见）：靶点 → 页面 PF.metric 绑定的确定性解析
// 不靠 AI 猜：直接从页面代码解析每个 PF.metric 绑哪个数据集/聚合/过滤，再把标注对上。
// --------------------------------------------
interface MetricBinding {
  elId: string;
  dataset: string;
  agg: string;
  field?: string;
  filters: Record<string, string>;
  cardLabel: string;
  current: number;
}

function compactNumber(v: number): string {
  if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2).replace(/\.?0+$/, '') + ' 亿';
  if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1).replace(/\.?0+$/, '') + ' 万';
  return String(Math.round(v));
}

/** 把脚本里的单 const 字符串变量解析成字面量表（dataset: DS 这种简写要能还原） */
function resolveScriptConsts(script: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of script.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*['"]([\w-]+)['"]/g)) map[m[1]] = m[2];
  return map;
}

function parseFilters(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const fm = body.match(/filters\s*:\s*\{([\s\S]*?)\}/);
  if (!fm) return out;
  for (const kv of fm[1].matchAll(/(['"]?)([A-Za-z_]\w*)\1\s*:\s*(['"])([\w-]+)\3/g)) out[kv[2]] = kv[4];
  return out;
}

function aggRecords(records: Record<string, any>[], agg: string, field?: string, filters?: Record<string, string>): number {
  let rows = records;
  if (filters) for (const [k, v] of Object.entries(filters)) rows = rows.filter((r) => String(r[k]) === v);
  const n = rows.length;
  if (agg === 'count' || !field) return n;
  const nums = rows.map((r) => Number(r[field])).filter((x) => Number.isFinite(x));
  if (agg === 'avg') return n ? nums.reduce((a, b) => a + b, 0) / n : 0;
  if (agg === 'max') return nums.length ? Math.max(...nums) : 0;
  if (agg === 'min') return nums.length ? Math.min(...nums) : 0;
  return nums.reduce((a, b) => a + b, 0); // sum
}

/**
 * 提取完整 PF.<fn>(el, {...}) 调用：同时拿到第一个参数的元素 id 与配置对象 body。
 * extractPfObjectCalls 只回配置对象、不含 el，故这里自己做平衡括号扫描。
 * fn 可传 'metric' / 'chart' 等。
 */
function extractPfElCalls(html: string, fn: string): Array<{ elId: string; body: string }> {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!scripts.length) scripts.push(html);
  const skipString = (s: string, i: number): number => {
    const q = s[i]; i++;
    while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) return i + 1; i++; }
    return i;
  };
  const out: Array<{ elId: string; body: string }> = [];
  for (const code of scripts) {
    const re = new RegExp(`PF\\.${fn}\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const argStart = m.index + m[0].length; // 参数起点（'(' 之后）
      let i = argStart, depth = 1, braceStart = -1;
      while (i < code.length && depth > 0) {
        const c = code[i];
        if (c === '"' || c === "'" || c === '`') { i = skipString(code, i); continue; }
        if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) break; }
        else if (c === '{' && braceStart < 0) { braceStart = i; break; }
        i++;
      }
      if (braceStart < 0) { re.lastIndex = i + 1; continue; }
      // 第一个参数直接取原始切片（含字符串），避免 skipString 吞掉 getElementById 的 id
      const argHead = code.slice(argStart, braceStart);
      // 平衡花括号截对象
      let j = braceStart + 1, bd = 1;
      while (j < code.length && bd > 0) {
        const c = code[j];
        if (c === '"' || c === "'" || c === '`') { j = skipString(code, j); continue; }
        if (c === '{') bd++; else if (c === '}') bd--;
        j++;
      }
      if (bd === 0) {
        const body = code.slice(braceStart + 1, j - 1);
        const idM = argHead.match(/getElementById\(\s*['"]([\w-]+)['"]/);
        if (idM) out.push({ elId: idM[1], body });
        re.lastIndex = j;
      }
    }
  }
  return out;
}

function extractMetricCalls(html: string): Array<{ elId: string; body: string }> {
  return extractPfElCalls(html, 'metric');
}

/** 解析一个页面里所有 PF.metric 的绑定及其当前聚合值 */
function extractMetricBindings(page: any, datasets: any[]): MetricBinding[] {
  const html: string = page?.html || '';
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const script = scripts.join('\n');
  const consts = resolveScriptConsts(script);
  const dsMap = new Map(datasets.map((d) => [d.name, d]));
  const out: MetricBinding[] = [];
  for (const call of extractMetricCalls(html)) {
    const b = call.body;
    const elId = call.elId;
    const dsM = b.match(/(?<![A-Za-z0-9_'"])dataset\s*:\s*['"]([\w-]+)['"]/);
    if (!dsM) continue;
    const dataset = dsM[1];
    const ds = dsMap.get(dataset) || dsMap.get(consts[dataset]);
    if (!ds) continue;
    const aggM = b.match(/(?<![A-Za-z0-9_'"])agg\s*:\s*['"](\w+)['"]/);
    const fldM = b.match(/(?<![A-Za-z0-9_'"])field\s*:\s*['"]([\w-]+)['"]/);
    const agg = aggM ? aggM[1] : 'count';
    const field = fldM ? fldM[1] : undefined;
    const filters = parseFilters(b);
    // 卡片标签：找 id 所在位置往前最近的 pf-stat-label/pf-metric-label
    let cardLabel = '';
    const idx = html.indexOf(elId);
    if (idx >= 0) {
      const head = html.slice(Math.max(0, idx - 400), idx);
      const labels = [...head.matchAll(/pf-(?:stat|metric)-label[^>]*>([^<]+)</g)].map((x) => x[1].trim());
      cardLabel = labels.length ? labels[labels.length - 1] : '';
    }
    out.push({ elId, dataset: ds.name, agg, field, filters, cardLabel, current: aggRecords(ds.records || [], agg, field, filters) });
  }
  return out;
}

/** 中文数字：100 / 1,200 / 1.2万 / 3亿 */
function parseChineseCount(s: string): number | null {
  const m = s.match(/([0-9]+(?:\.[0-9]+)?)(万|亿)?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === '万') n *= 1e4;
  else if (m[2] === '亿') n *= 1e8;
  return Math.round(n);
}

/** 从意见文字解析“改条数”意图：改成100笔 / 加到80条 / 再加20条 / 减少10条 / 删掉15条 */
function parseCountIntent(content: string, current: number): { action: 'resize' | 'add' | 'remove'; target?: number; delta?: number } | null {
  // 加/减/删 的相对量
  let m = content.match(/(?:再加|再添|增加|新增|多|添|加)\s*([0-9]+(?:\.[0-9]+)?(?:万|亿)?)\s*(?:条|笔|个|家|行|记录)/);
  if (m) { const d = parseChineseCount(m[1])!; return { action: 'add', delta: d }; }
  m = content.match(/(?:减少|删掉|删除|去掉|减|少)\s*([0-9]+(?:\.[0-9]+)?(?:万|亿)?)\s*(?:条|笔|个|家|行|记录)/);
  if (m) { const d = parseChineseCount(m[1])!; return { action: 'remove', delta: d }; }
  // 绝对值：改成/调到/变为/要有 N 条笔
  m = content.match(/(?:改成|改为|调成|调到|变为|变成|弄成|设为|设成|要有|到)\s*([0-9]+(?:\.[0-9]+)?(?:万|亿)?)\s*(?:条|笔|个|家|行|记录)/);
  if (m) return { action: 'resize', target: parseChineseCount(m[1])! };
  // 裸 “100笔/100条” 默认当目标值（与现值不同才有意义）
  m = content.match(/(?<![0-9.])([0-9]+)\s*(?:笔|条|个|家|行)(?![0-9])/);
  if (m) { const t = parseInt(m[1], 10); if (t !== current) return { action: 'resize', target: t }; }
  return null;
}

/** 把一条标注确定性匹配到页面上的某个 PF.metric（匹配不上返回 null） */
function matchAnnotationMetric(a: any, bindings: MetricBinding[]): MetricBinding | null {
  if (!bindings.length) return null;
  const label: string = (a.target_label || '').replace(/\s+/g, '');
  const path: string = a.target_path || '';
  // 1) 靶点渲染值直接相等（50笔 == compact(50)+笔）
  let hit: MetricBinding | null | undefined = bindings.find((mb) => {
    const c = compactNumber(mb.current);
  return label === c || label === c + '笔' || label === c + '条' || label === String(mb.current) || label === mb.current + '笔';
  });
  if (hit) return hit;
  // 2) 卡片标签出现在 path 或 target_label（业务总笔数…）
  hit = bindings.find((mb) => mb.cardLabel && (path.includes(mb.cardLabel) || path.includes(mb.cardLabel.slice(0, 4)))) || null;
  if (hit) return hit;
  // 3) 全页只有一个 count 指标，意见又在谈“笔/条/数量”，兜底认它
  const counts = bindings.filter((mb) => mb.agg === 'count');
  if (counts.length === 1 && /(笔|条|数量|几个|多少)/.test(a.content || '')) return counts[0];
  return null;
}

// --------------------------------------------
// 图表类型意图（确定性，不走 AI）：折线↔柱图↔饼图…
// --------------------------------------------
interface ChartBinding {
  elId: string;
  type: string;
  cardLabel: string;
  bodyStart: number; // 配置对象在整页 html 的起止（用于确定性替换 type）
  bodyEnd: number;
  typeStart: number; // type 值字符串在 html 中的确切位置
  typeEnd: number;
}

const CHART_TYPE_NAMES: Record<string, string[]> = {
  bar: ['柱状图', '柱图', '柱形图', '柱子', '竖条图', '直方'],
  hbar: ['条形图', '横向柱', '横条图', '水平柱', '条形'],
  line: ['折线图', '折线', '线图', '趋势线', '曲线图', '折线形'],
  pie: ['饼图', '饼形图', '圆形占比'],
  donut: ['环形图', '圆环图', '甜甜圈', '环形', '圈图'],
  funnel: ['漏斗图', '漏斗'],
};

/** 全文扫描 PF.chart 调用，返回 elId/类型/卡片标题/可替换位置 */
function scanChartCalls(html: string): ChartBinding[] {
  const skipString = (s: string, i: number): number => {
    const q = s[i]; i++;
    while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) return i + 1; i++; }
    return i;
  };
  const out: ChartBinding[] = [];
  const re = /PF\.chart\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const argStart = m.index + m[0].length;
    let i = argStart, depth = 1, braceStart = -1;
    while (i < html.length && depth > 0) {
      const c = html[i];
      if (c === '"' || c === "'" || c === '`') { i = skipString(html, i); continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      else if (c === '{' && braceStart < 0) { braceStart = i; break; }
      i++;
    }
    if (braceStart < 0) continue;
    const argHead = html.slice(argStart, braceStart);
    const idM = argHead.match(/getElementById\(\s*['"]([\w-]+)['"]/);
    if (!idM) continue;
    let j = braceStart + 1, bd = 1;
    while (j < html.length && bd > 0) {
      const c = html[j];
      if (c === '"' || c === "'" || c === '`') { j = skipString(html, j); continue; }
      if (c === '{') bd++; else if (c === '}') bd--;
      j++;
    }
    if (bd !== 0) continue;
    const bodyStart = braceStart + 1, bodyEnd = j - 1;
    const body = html.slice(bodyStart, bodyEnd);
    const tM = body.match(/type\s*:\s*['"](\w+)['"]/);
    // type 值在全文的确切位置（取 body 内第一个 type）
    let typeStart = -1, typeEnd = -1, type = tM ? tM[1] : '';
    if (tM) {
      const vIdx = body.indexOf(tM[0]) + tM[0].indexOf(tM[1]);
      typeStart = bodyStart + vIdx;
      typeEnd = typeStart + tM[1].length;
    }
    // 卡片标题：DOM 中 id="elId" 之前最近的 font-semibold / chart-title 文本
    let cardLabel = '';
    const domAt = html.indexOf('id="' + idM[1] + '"');
    if (domAt >= 0) {
      const head = html.slice(Math.max(0, domAt - 500), domAt);
      const labels = [...head.matchAll(/(?:font-semibold|pf-chart-title|chart-title)[^>]*>([^<]+)</g)].map((x) => x[1].trim());
      cardLabel = labels.length ? labels[labels.length - 1] : '';
    }
    out.push({ elId: idM[1], type, cardLabel, bodyStart, bodyEnd, typeStart, typeEnd });
    re.lastIndex = j;
  }
  return out;
}

/** 从意见文字解析目标图表类型，识别不了返回 null */
function parseChartTypeIntent(content: string): string | null {
  // 先按词长降序，避免“柱图”抢在“柱状图”、“环”误命中（显式词表已足够具体）
  const entries = Object.entries(CHART_TYPE_NAMES).flatMap(([type, words]) =>
    words.map((w) => ({ type, w }))
  ).sort((a, b) => b.w.length - a.w.length);
  for (const { type, w } of entries) if (content.includes(w)) return type;
  return null;
}

/** 把一条标注确定性匹配到页面某张 PF.chart */
function matchAnnotationChart(a: any, charts: ChartBinding[]): ChartBinding | null {
  if (!charts.length) return null;
  const label = (a.target_label || '').replace(/\s+/g, '');
  const path = (a.target_path || '').replace(/\s+/g, '');
  // 1) 靶点标签等于卡片标题
  let hit = charts.find((c) => c.cardLabel && label === c.cardLabel.replace(/\s+/g, ''));
  if (hit) return hit;
  // 2) 卡片标题出现在 path（path 里带 [近12个月放款金额趋势 ]）
  hit = charts.find((c) => c.cardLabel && path.includes(c.cardLabel.replace(/\s+/g, '').slice(0, Math.min(8, c.cardLabel.length))));
  if (hit) return hit;
  // 3) 意见文本直接点了某张图的标题词
  hit = charts.find((c) => c.cardLabel && (a.content || '').replace(/\s+/g, '').includes(c.cardLabel.replace(/\s+/g, '').slice(0, 6)));
  return hit || null;
}

/** 确定性把指定图表的 type 改成 newType，返回新 html 与是否真的改了 */
function replaceChartType(html: string, chart: ChartBinding, newType: string): { html: string; changed: boolean } {
  if (chart.typeStart < 0 || chart.type === newType) return { html, changed: false };
  const next = html.slice(0, chart.typeStart) + newType + html.slice(chart.typeEnd);
  return { html: next, changed: true };
}

// --------------------------------------------
// 阶段 1：分诊官
// --------------------------------------------
interface TriOp {
  index: number;
  pageId: string;
  kind: 'ui' | 'layout' | 'fields' | 'bizrule';
  needsDataset: boolean;
  needsReqSync: boolean;
  affectsPages: string[];
  datasetChanges?: Record<string, { addFields?: Array<{ key: string; label: string; sampleHint?: string }>; removeFields?: string[] }>;
  summary: string;
  // 数据类意图（改条数/加记录/删记录/改值）——不重跑页面，直接改数据集，PF.metric/chart 运行时自动联动
  dataIntent?: DataIntent;
}

// 一条意见对数据的具体操作。action=none 表示不是数据类意见。
interface DataIntent {
  action: 'none' | 'resize' | 'add' | 'remove' | 'setValue';
  dataset: string;
  field?: string | null;  // setValue/sum/avg 时涉及的数值字段
  agg?: string | null;     // 靶点指标的聚合方式 count/sum/avg...
  metricId?: string | null;// 靶点 PF.metric 元素 id（服务式绑定清单带，便于核对）
  targetCount?: number | null; // resize：最终要的记录条数
  delta?: number | null;       // add/remove：增减条数
  where?: string;              // setValue：改哪些记录（人话说的范围/条件）
  valueSpec?: string;          // setValue：想改成什么
}

const TRIAGE_RULES = `# 你的任务：给每条评审意见分诊（只判断，不写代码、不改数据）
输出 JSON：
{
  "opinions": [
    {
      "index": 意见序号,
      "pageId": "意见所在页面 id（必须用给定的页面 id）",
      "kind": "ui | layout | fields | bizrule",
      "needsDataset": true/false,
      "needsReqSync": true/false,
      "affectsPages": ["需要改到的页面 id 列表"],
      "datasetChanges": { "数据集名": { "addFields": [ {"key":"英文驼峰字段名","label":"中文名","sampleHint":"示例值"} ], "removeFields": [] } },
      "summary": "一句话说清这条意见要改什么"
    }
  ]
}

# kind 分类标准
- ui：颜色、文案、字号、间距、位置、placeholder、图标、显隐微调等纯表达问题
- layout：整页或大区块布局重构（左右两栏、tab、看板）、整页风格调整
- fields：列表列/表单项/详情字段的【新增、删除、改名】——注意"列表加一列登记人"是 fields 不是 ui
- bizrule：状态流转、审核/审批规则、校验、阈值、数据口径（单位/枚举/计算）、权限

# needsDataset / needsReqSync
- fields：needsDataset=true（新列/新字段要有 mock 数据），needsReqSync=true（字段清单是需求文档的一部分）
- bizrule：needsReqSync=true；若改到状态枚举/记录数据，needsDataset=true
- layout：needsDataset=false、needsReqSync=false（布局不涉及数据口径）
- ui：needsDataset=false、needsReqSync=false

# affectsPages
- 意见落在哪页就写哪页；若意见改的是全局口径（多页都展示的同一字段/同一规则），把所有受影响页面 id 都列上
- datasetChanges 只在 needsDataset=true 时给：addFields 列出要补的字段（key 英文驼峰、label 中文、sampleHint 示例值）；removeFields 一般留空

只输出 JSON 本身。`;

async function triage(spec: any, annots: any[]): Promise<TriOp[]> {
  const pageSummaries = (spec.pages || []).map((p: any) => `- 页面 id="${p.id}" title="${p.title}" kind="${p.kind}"`).join('\n');
  const dsSummary = (spec.datasets || []).map((d: any) =>
    `- 数据集 "${d.name}"：字段 [${Object.keys(d.records?.[0] || {}).join(', ')}]，${d.records?.length || 0} 条记录`
  ).join('\n');
  const opinions = annots.map((a, i) =>
    `${i + 1}. [页面「${a.page_title}」pageId=${a.page_id}]（标注对象：${KIND_NAME[a.target_kind] || '元素'}${a.target_label ? '：' + a.target_label : ''}）${a.content}${a.author ? ` —— ${a.author}` : ''}`
  ).join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: '你是原型评审的分诊官，冷静、抠字眼，只做结构化判断。' },
    { role: 'user', content: `# 现有原型\n## 页面\n${pageSummaries}\n\n## 数据集\n${dsSummary}\n\n# 待分诊意见\n${opinions}\n\n${TRIAGE_RULES}` },
  ];

  let tri: any = null;
  let lastErr = '';
  const pageIds = new Set((spec.pages || []).map((p: any) => p.id));
  for (let attempt = 0; attempt < 2 && !tri; attempt++) {
    const msgs: LLMMessage[] = attempt === 0 ? messages : [...messages, { role: 'user', content: `分诊结果有问题：${lastErr}\n请修正后只输出 JSON。` }];
    try {
      const out = extractJson(await callModel(msgs, 0.1, 4000));
      if (!Array.isArray(out.opinions) || out.opinions.length !== annots.length) {
        lastErr = `opinions 数量要等于意见数 ${annots.length}`;
        continue;
      }
      for (const op of out.opinions) {
        if (!pageIds.has(op.pageId)) lastErr += ` 意见${op.index} 的 pageId ${op.pageId} 不存在；`;
        op.affectsPages = (op.affectsPages || []).filter((id: string) => pageIds.has(id));
        if (!op.affectsPages.length) op.affectsPages = [op.pageId];
      }
      if (lastErr) continue;
      tri = out.opinions;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (!tri) throw new Error(`分诊失败：${lastErr}`);
  return tri;
}

// --------------------------------------------
// 阶段 2：数据官
// --------------------------------------------
const DATASET_RULES = `# 你的任务：给原型数据集补字段（只出数据，不碰页面代码）
评审意见要求给列表/表单加字段，你要输出【完整数据集对象】：
{
  "datasets": [
    { "name": "数据集名", "statusField": "状态字段名", "statusMap": {原样保留}, "records": [ ...每条记录完整输出... ] }
  ]
}

# 铁律
1. records 里每条记录必须保留【全部旧字段且值不变】，再补上要求的新字段。
2. 新字段每条记录都要有值，值要像真实业务：人名用中文姓名、时间用 "2026-08-28 10:30" 格式且与该记录其他时间合理先后、状态/枚举用 statusMap 里的 key。
3. statusMap 没让改就原样；不要动意见没提到的数据集。
4. 只输出 JSON。`;

interface DatasetPatch {
  name: string;
  statusField: string;
  statusMap: Record<string, any>;
  records: Record<string, any>[];
}

async function buildDatasetPatch(spec: any, triOps: TriOp[], annots: any[]): Promise<Map<string, DatasetPatch>> {
  // 汇总要动的数据集：新增字段清单
  const addByDs = new Map<string, Map<string, { label: string; sampleHint?: string }>>();
  const removeByDs = new Map<string, Set<string>>();
  for (const op of triOps) {
    if (!op.needsDataset || !op.datasetChanges) continue;
    for (const [dsName, ch] of Object.entries(op.datasetChanges)) {
      if (!addByDs.has(dsName)) addByDs.set(dsName, new Map());
      for (const f of ch.addFields || []) {
        if (!addByDs.get(dsName)!.has(f.key)) addByDs.get(dsName)!.set(f.key, { label: f.label, sampleHint: f.sampleHint });
      }
      for (const k of ch.removeFields || []) {
        if (!removeByDs.has(dsName)) removeByDs.set(dsName, new Set());
        removeByDs.get(dsName)!.add(k);
      }
    }
  }
  const result = new Map<string, DatasetPatch>();
  if (!addByDs.size && !removeByDs.size) return result;

  const opinionText = triOps.filter((o) => o.needsDataset).map((o) => `${o.index}. ${o.summary}`).join('\n');

  for (const [dsName, addFields] of addByDs) {
    const old = (spec.datasets || []).find((d: any) => d.name === dsName);
    if (!old) throw new Error(`分诊提到的数据集 ${dsName} 不存在`);
    const oldKeys = Object.keys(old.records?.[0] || {});
    const fieldSpec = [...addFields.entries()].map(([key, v]) => `- 新增字段 ${key}（${v.label}）${v.sampleHint ? `，示例：${v.sampleHint}` : ''}`).join('\n');

    const messages: LLMMessage[] = [
      { role: 'system', content: '你是原型数据工程师，负责造像真实业务的 mock 数据。' },
      {
        role: 'user', content:
          `# 数据集现状（${dsName}）\n\`\`\`json\n${JSON.stringify({ statusField: old.statusField, statusMap: old.statusMap, records: old.records }, null, 2)}\n\`\`\`\n\n` +
          `# 要补的字段\n${fieldSpec}\n\n# 相关意见\n${opinionText}\n\n${DATASET_RULES}`,
      },
    ];

    let patched: DatasetPatch | null = null;
    let lastErr = '';
    for (let attempt = 0; attempt < 2 && !patched; attempt++) {
      const msgs: LLMMessage[] = attempt === 0 ? messages : [...messages, { role: 'user', content: `上次数据有问题：${lastErr}\n请修正后只输出 JSON。` }];
      try {
        const out = extractJson(await callModel(msgs, 0.3, 16000));
        const ds = (out.datasets || [])[0];
        const errs: string[] = [];
        if (!ds?.name || !Array.isArray(ds.records) || !ds.records.length) { errs.push('输出缺 datasets 或 records 为空'); }
        else {
          if (ds.records.length !== old.records.length) errs.push(`记录数 ${ds.records.length} 与原 ${old.records.length} 不一致`);
          for (let i = 0; i < ds.records.length; i++) {
            const r = ds.records[i];
            for (const k of oldKeys) {
              if (!(k in r)) errs.push(`第 ${i + 1} 条记录丢了旧字段 ${k}`);
            }
            for (const fk of addFields.keys()) {
              const v = r[fk];
              if (v === undefined || v === null || v === '') errs.push(`第 ${i + 1} 条记录缺新字段 ${fk} 的值`);
            }
          }
        }
        if (errs.length) { lastErr = errs.slice(0, 5).join('；'); continue; }
        patched = { name: ds.name, statusField: ds.statusField || old.statusField, statusMap: ds.statusMap || old.statusMap, records: ds.records };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (!patched) throw new Error(`数据集 ${dsName} 补字段失败：${lastErr}`);
    result.set(dsName, patched);
  }
  return result;
}

// --------------------------------------------
// 阶段 2b：数据条数类意见（改成 N 笔 / 再加 N 条 / 删 N 条）——确定性增删 + AI 造新行
// 只动数据集 records，不重跑页面；PF.metric/PF.chart 运行时读数据自动联动。
// --------------------------------------------
const RECORD_GEN_RULES = `# 你的任务：给业务数据集【只造新增的 mock 记录】，输出 JSON
{
  "records": [ {…每条新记录…}, … ]
}

# 铁律
1. 只输出要求新增的那几条，不要回传旧记录、不要改字段结构。
2. 每条必须包含给定的【全部字段 key】，值要像真实业务：
   - 中文名用人名/公司名，别用“测试1/xxx”；金额是合理的数值（单位与样例一致）；
   - 时间用 "2026-08-28 10:30" 这种字符串，且与同一批记录的时间先后合理；
   - 状态/枚举字段的值必须取自给定 statusMap 的 key（或我额外指定的固定值）。
3. 新记录要和已有记录风格一致、关键字段（姓名/编号/公司）不要与已有记录重复。
4. 只输出 JSON 本身。`;

/** AI 造 n 条新记录；filterMatch 要求某字段固定取值（满足指标的 filters） */
async function generateNewRecords(
  ds: any,
  n: number,
  filterMatch: Record<string, string>,
): Promise<Record<string, any>[]> {
  const old: Record<string, any>[] = ds.records || [];
  const keys = Object.keys(old[0] || {});
  const sample = old.slice(-3);
  const fixed = Object.entries(filterMatch).map(([k, v]) => `- 字段 ${k} 必须固定为 "${v}"`).join('\n');
  const messages: LLMMessage[] = [
    { role: 'system', content: '你是原型数据工程师，负责造像真实业务的 mock 数据。' },
    {
      role: 'user', content:
        `# 数据集「${ds.name}」
字段 key（每条都要齐全）：[${keys.join(', ')}]
状态枚举 statusField=${ds.statusField || '（无）'}，statusMap=${JSON.stringify(ds.statusMap || {})}
${fixed ? '\n# 本条硬性要求\n' + fixed : ''}

# 已有记录样例（风格对齐、勿重复）
${JSON.stringify(sample, null, 2)}

# 任务
请新增 ${n} 条记录。\n\n${RECORD_GEN_RULES}`,
    },
  ];
  let recs: Record<string, any>[] | null = null;
  let lastErr = '';
  for (let attempt = 0; attempt < 2 && !recs; attempt++) {
    const msgs: LLMMessage[] = attempt === 0 ? messages : [...messages, { role: 'user', content: `数据有问题：${lastErr}\n请修正后只输出 JSON。` }];
    try {
      const out = extractJson(await callModel(msgs, 0.5, Math.max(4000, n * 900)));
      const arr = out.records;
      const errs: string[] = [];
      if (!Array.isArray(arr) || !arr.length) errs.push('records 为空或不是数组');
      else {
        if (arr.length !== n) errs.push(`要 ${n} 条，实际给了 ${arr.length} 条`);
        arr.forEach((r: any, i: number) => {
          for (const k of keys) if (r[k] === undefined || r[k] === null || r[k] === '') errs.push(`第 ${i + 1} 条缺字段 ${k}`);
          for (const [fk, fv] of Object.entries(filterMatch)) if (String(r[fk]) !== fv) errs.push(`第 ${i + 1} 条 ${fk} 必须是 ${fv}`);
        });
      }
      if (errs.length) { lastErr = errs.slice(0, 6).join('；'); continue; }
      recs = arr;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (!recs) throw new Error(`造 ${n} 条新记录失败：${lastErr}`);
  // 确定性兜底：id 唯一（不信 AI）
  const existing = new Set(old.map((r) => String(r.id)));
  for (const r of recs) {
    if (!('id' in r) || existing.has(String(r.id))) r.id = crypto.randomUUID();
    existing.add(String(r.id));
  }
  return recs;
}

/** 一条数据意图应用到某个数据集后的结果（供主流程落实核对） */
interface DataApplyOutcome {
  opIndex: number;
  dataset: string;
  ok: boolean;
  reason: string;
  beforeCount: number;
  afterCount: number;
}

/**
 * 按序把所有条数类意图落到数据集，返回新 records 与每条结果。
 * 同一个数据集被多条意见命中时顺序应用。
 */
async function applyDataIntents(
  spec: any,
  ops: TriOp[],
): Promise<{ patch: Map<string, Record<string, any>[]>; outcomes: Map<number, DataApplyOutcome> }> {
  const patch = new Map<string, Record<string, any>[]>();
  const outcomes = new Map<number, DataApplyOutcome>();
  const getRecs = (name: string): Record<string, any>[] => {
    if (patch.has(name)) return patch.get(name)!;
    const ds = (spec.datasets || []).find((d: any) => d.name === name);
    return ds ? JSON.parse(JSON.stringify(ds.records || [])) : [];
  };

  for (const op of ops) {
    const di = op.dataIntent;
    if (!di || di.action === 'none' || !di.dataset) continue;
    const ds = (spec.datasets || []).find((d: any) => d.name === di.dataset);
    const before = getRecs(di.dataset);
    const beforeCount = before.length;
    let after = before;
    let ok = true;
    let reason = '';
    try {
      if (!ds) throw new Error(`数据集 ${di.dataset} 不存在`);
      const filters: Record<string, string> = {};
      // count 指标可能带过滤条件（如仅已放款）；补的记录需满足过滤，指标才会变
      const binding = (op as any)._metric as MetricBinding | undefined;
      if (binding?.filters) Object.assign(filters, binding.filters);
      const passes = (r: Record<string, any>) => Object.entries(filters).every(([k, v]) => String(r[k]) === v);
      const filteredCount = before.filter(passes).length;

      if (di.action === 'resize' && di.targetCount != null) {
        const t = di.targetCount;
        if (t === filteredCount) { ok = false; reason = `该指标现在就是 ${filteredCount} 条，无需改动`; }
        else if (t < filteredCount) {
          // 从尾部删掉 (filteredCount - t) 条满足过滤条件的记录
          let need = filteredCount - t;
          after = [];
          for (let i = before.length - 1; i >= 0; i--) {
            if (need > 0 && passes(before[i])) { need--; continue; }
            after.unshift(before[i]);
          }
        } else {
          after = [...before, ...await generateNewRecords(ds, t - filteredCount, filters)];
        }
      } else if (di.action === 'add' && di.delta) {
        after = [...before, ...await generateNewRecords(ds, di.delta, filters)];
      } else if (di.action === 'remove' && di.delta) {
        if (di.delta > filteredCount) throw new Error(`满足条件的只有 ${filteredCount} 条，删不了 ${di.delta} 条`);
        let need = di.delta;
        after = [];
        for (let i = before.length - 1; i >= 0; i--) {
          if (need > 0 && passes(before[i])) { need--; continue; }
          after.unshift(before[i]);
        }
      } else {
        throw new Error('暂不支持的改数方式（目前支持改成 N 笔 / 加 N 条 / 删 N 条）');
      }
    } catch (e) {
      ok = false;
      reason = e instanceof Error ? e.message : String(e);
      after = before;
    }
    patch.set(di.dataset, after);
    outcomes.set(op.index, { opIndex: op.index, dataset: di.dataset, ok, reason, beforeCount, afterCount: after.length });
  }
  return { patch, outcomes };
}

/**
 * 阶段 2c（确定性，不走 AI）：在分诊结果上叠加“改条数”数据意图。
 * 只处理能【确定性】识别的情况：标注靶点能对上页面某个 PF.metric，且意见含明确数字。
 * 识别不了就留给普通页面工/报错，绝不猜。命中的意见从页面工任务里摘除（纯数据变更不重跑页面）。
 * 返回 dataOps（index → {op, binding, outcome 占位}）与应跳过页面工的 index 集合。
 */
function detectDataIntents(
  spec: any,
  triOps: TriOp[],
  annots: any[],
): { dataIndexes: Set<number>; bindings: Map<number, MetricBinding> } {
  const dataIndexes = new Set<number>();
  const bindings = new Map<number, MetricBinding>();
  const pageCache = new Map<string, MetricBinding[]>();
  const datasets = spec.datasets || [];

  triOps.forEach((op) => {
    const a = annots[op.index - 1];
    if (!a) return;
    // 整页/布局类意见不走这条；附图意见也交页面工
    if (op.kind === 'layout') return;
    try { const imgs = typeof a?.images === 'string' ? JSON.parse(a.images || '[]') : (a?.images || []); if (Array.isArray(imgs) && imgs.length) return; } catch { /* ignore */ }

    const page = (spec.pages || []).find((p: any) => p.id === op.pageId);
    if (!page) return;
    if (!pageCache.has(page.id)) pageCache.set(page.id, extractMetricBindings(page, datasets));
    const bindingsOnPage = pageCache.get(page.id)!;
    const binding = matchAnnotationMetric(a, bindingsOnPage);
    if (!binding) return; // 对不上指标 → 不当数据意见

    // count 指标：解析“改成 N 笔 / 加 N 条 / 删 N 条”
    if (binding.agg === 'count') {
      const intent = parseCountIntent(a.content || '', binding.current);
      if (intent) {
        op.dataIntent = {
          action: intent.action,
          dataset: binding.dataset,
          agg: 'count',
          metricId: binding.elId,
          targetCount: intent.action === 'resize' ? intent.target : null,
          delta: intent.action === 'add' || intent.action === 'remove' ? intent.delta : null,
        };
        (op as any)._metric = binding;
        dataIndexes.add(op.index);
        bindings.set(op.index, binding);
      }
    }
  });

  return { dataIndexes, bindings };
}

/**
 * 阶段 1c（确定性，不走 AI）：识别“换图表类型”意图（折线→柱图…）。
 * 靶点能对上某张 PF.chart、且意见含明确类型词才命中；命中的意见不进页面工，
 * 直接对最终页面 html 做 type 确定性替换，改完重解析核对。
 */
interface ChartPlan {
  pageId: string;
  elId: string;
  targetType: string;
  fromType: string;
  cardLabel: string;
}

function detectChartTypeIntents(
  spec: any,
  triOps: TriOp[],
  annots: any[],
): { chartIndexes: Set<number>; plans: Map<number, ChartPlan> } {
  const chartIndexes = new Set<number>();
  const plans = new Map<number, ChartPlan>();
  const pageCache = new Map<string, ChartBinding[]>();

  triOps.forEach((op) => {
    const a = annots[op.index - 1];
    if (!a) return;
    if (op.kind === 'layout') return;
    try { const imgs = typeof a?.images === 'string' ? JSON.parse(a.images || '[]') : (a?.images || []); if (Array.isArray(imgs) && imgs.length) return; } catch { /* ignore */ }

    const targetType = parseChartTypeIntent(a.content || '');
    if (!targetType) return;

    const page = (spec.pages || []).find((p: any) => p.id === op.pageId);
    if (!page) return;
    if (!pageCache.has(page.id)) pageCache.set(page.id, scanChartCalls(page.html || ''));
    const charts = pageCache.get(page.id)!;
    const chart = matchAnnotationChart(a, charts);
    if (!chart) return; // 对不上哪张图 → 交回普通页面工，不猜

    chartIndexes.add(op.index);
    plans.set(op.index, { pageId: page.id, elId: chart.elId, targetType, fromType: chart.type, cardLabel: chart.cardLabel });
  });

  return { chartIndexes, plans };
}

/** 在给定 html 上按 elId 把图表 type 确定性替换为 targetType；返回新 html 与是否改动 */
function applyChartTypeToHtml(html: string, elId: string, targetType: string): { html: string; changed: boolean; reason: string } {
  const charts = scanChartCalls(html);
  const chart = charts.find((c) => c.elId === elId);
  if (!chart) return { html, changed: false, reason: `重写后的页面里找不到图表元素 ${elId}，未能换类型` };
  if (chart.type === targetType) return { html, changed: false, reason: '' }; // 本来就是目标类型
  if (chart.typeStart < 0) return { html, changed: false, reason: '该图表配置里没有可改的 type 字段' };
  const next = html.slice(0, chart.typeStart) + targetType + html.slice(chart.typeEnd);
  return { html: next, changed: true, reason: '' };
}


// --------------------------------------------
const PAGE_RULES = `# 你的任务：按评审意见修改【这一个页面】的代码，输出修改后的完整 HTML 片段。
写法跟首次生成完全一致：HTML 片段（无 <html>/<head>/<body>）、布局间距用 Tailwind class、颜色/卡片/表格/按钮/标签/表单/弹窗必须用壳内置的 .pf-* 语义组件 class（.pf-card / .pf-btn / .pf-btn primary / .pf-table / .pf-tag success|warning|danger|info / .pf-input / .pf-field / .pf-modal / .pf-stat / .pf-link，状态标签用 <span class="pf-tag type">）、严禁写死任何颜色（不许 bg-indigo-600/text-gray-700 等带色 class），<script> 里用 PF API。重写时保留原页面的元素结构层级和文案（按钮文字、列名、区块标题不要无故改名），系统按 DOM 结构定位评审意见。

# 铁律
1. **数据集是定稿事实**：只能读写「数据契约」里给出的字段 key。新增的列/字段必须用契约里的新字段 key 渲染，**严禁拿旧字段顶替新含义、严禁渲染数据契约里不存在的字段**。
2. **意见没要求删除/改名的列、按钮、区块、表单字段，必须原样保留**（表头文字、区块结构都不许顺手改）。
3. 意见怎么说就怎么改，不要自由发挥加戏。
4. 所有入口按钮都必须有点击行为（不许死按钮）：跳页用 PF.go（目标页暂未生成也照写，系统运行时自动 toast 占位）；不要 PF.go 到空 id。PF 数据集 API 只能引用给定数据集名。
5. **宽内容不能被裁**：表格列多时，表格外层容器要用 \`overflow-x-auto\`（不要用 overflow-hidden），让表格能横向滚动；表头/单元格不要写死过宽。
6. 只输出 HTML 片段本身。
7. **图表只能用 PF.chart(el, 配置)/PF.metric(el, 配置)**（柱 bar/条形 hbar/折线 line/饼 pie/环 donut/漏斗 funnel，绑 dataset 聚合，颜色自动跟主题），不许自己引 echarts、不许用 div/CSS 假装图表；配置字段必须在数据契约里。折线横轴是日期字段必须配 granularity:'month'|'year'。意见要求加图表/看板时照此写；原页已有 PF.chart 无意见不许改。
8. ${CSS_VAR_WHITELIST_TEXT}`;

async function patchPage(
  page: any,
  pageOps: TriOp[],
  annots: any[],
  datasets: any[],
  allPageIds: string[],
): Promise<string> {
  const pageAnnots = pageOps.map((op) => annots[op.index - 1]);
  const opinionText = pageOps.map((op) => {
    const a = annots[op.index - 1];
    return `${op.index}. （${KIND_NAME[a.target_kind] || '元素'}${a.target_label ? '：' + a.target_label : ''}）${a.content}`;
  }).join('\n');

  const contract = datasets.map((d: any) => {
    const sample = d.records?.[0] || {};
    return `- 数据集 "${d.name}"，字段 key：[${Object.keys(sample).join(', ')}]，示例记录：${JSON.stringify(sample)}`;
  }).join('\n');

  const userContent = await withImages(
    `# 本页\nid=${page.id} title=${page.title} kind=${page.kind}\n现有页面 id 列表：${allPageIds.join(', ')}\n\n` +
    `# 数据契约（定稿事实，只能引用这里面的数据集和字段）\n${contract}\n\n` +
    `# 本页现有代码\n\`\`\`html\n${page.html || ''}\n\`\`\`\n\n` +
    `# 要落实的意见\n${opinionText}\n\n${PAGE_RULES}`,
    pageAnnots
  );
  const messages: LLMMessage[] = [
    { role: 'system', content: '你是资深前端原型工程师，只改交给你的这一个页面，严格按意见和数据契约施工。' },
    { role: 'user', content: userContent },
  ];

  let html = '';
  let lastErr = '';
  const tmpSpec = {
    pages: allPageIds.map((id) => ({ id })),
    datasets: datasets.map((d: any) => ({ name: d.name, records: d.records || [] })),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs: LLMMessage[] = attempt === 0 ? messages : [...messages, { role: 'user', content: `页面代码有问题：${lastErr}\n请修正后重新输出这个页面的完整 HTML 片段。` }];
    try {
      const raw = await callModel(msgs, 0.4, 32000);
      const out = extractHtml(raw);
      if (out.length < 100) throw new Error('HTML 内容为空或过短');
      const errs = hardCheckPage(out, page, datasets, pageOps, annots, tmpSpec);
      if (errs.length) throw new Error(errs.join('；'));
      html = out;
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (!html) throw new Error(`页面「${page.title}」修改失败：${lastErr}`);
  return html;
}

// --------------------------------------------
// 阶段 3b：靶向页面工（局部意见 → 子树替换补丁，路径外冻结）
// --------------------------------------------
const TARGETED_RULES = `# 你的任务：只改意见点名的元素，输出「替换补丁」（不要重写整页）
每条意见都带一个元素定位路径（path），那就是默认要改的元素。

# 先判断：手术刀够不够（你同时看得到参考图、意见和整页代码）
- 如果所有意见都能通过【只替换 path 指向元素本身】实现（含元素内部子元素的联动，比如按钮里加图标）→ 正常输出 patches。
- 如果某条意见必须动到该元素的**兄弟元素、父容器布局，或整页结构/风格/多列重排**才做得对（path 那个子树装不下）→ **不要硬凑**，改为只输出：
  { "needRewrite": true, "reason": "一句话说明为什么必须整页重写" }

# 输出格式（二选一，只输出 JSON）
正常修改：
{
  "patches": [
    { "path": "把意见给的路径原封不动抄回来", "newHtml": "该元素改后的完整 HTML 片段" }
  ]
}
或超限升级：{ "needRewrite": true, "reason": "..." }

# 铁律
1. newHtml 是【那个元素本身】的新 outerHTML——保留原来的标签名和语义（原来是 button 就还是 button、原来是 td/th 就还是 td/th、原来是卡片 div 就还是 div），只改意见要求的内容/样式/文案。
2. **路径之外的元素一个字符都不许动**，也不要输出它们。
3. 颜色/卡片/按钮/标签等必须用壳内置 .pf-* 语义 class，严禁写死颜色；交互用 PF API。
4. 意见如果是改文案/颜色/显隐/图标等纯表达，只动那一个元素；若该元素的改动必须连带改它内部的子元素（比如按钮里加个图标），在 newHtml 里一起给出。
5. 一般不要动 <script>；只有意见明确要求改交互逻辑时，才对 <script> 元素出补丁（path 指向 script，newHtml 是完整新 <script>）。意见要求加图表时，用 PF.chart(el,配置)（绑数据集、主题色自动），不许自引 echarts 或用 div 假装。
6. 只输出 JSON 本身。
7. ${CSS_VAR_WHITELIST_TEXT}`;

async function patchPageTargeted(
  page: any,
  pageOps: TriOp[],
  annots: any[],
  datasets: any[],
  allPageIds: string[],
): Promise<string> {
  const pageAnnotsT = pageOps.map((op) => annots[op.index - 1]);
  const opinionText = pageOps.map((op) => {
    const a = annots[op.index - 1];
    return `意见${op.index}：（${KIND_NAME[a.target_kind] || '元素'}：${a.target_label || ''}）${a.content}\n  定位路径 path=${a.target_path}`;
  }).join('\n');

  const contract = datasets.map((d: any) => {
    const sample = d.records?.[0] || {};
    return `- 数据集 "${d.name}"，字段 key：[${Object.keys(sample).join(', ')}]`;
  }).join('\n');

  const userContentT = await withImages(
    `# 本页
id=${page.id} title=${page.title} kind=${page.kind}\n现有页面 id 列表：${allPageIds.join(', ')}\n\n` +
    `# 数据契约（只能引用这里的数据集/字段）\n${contract}\n\n` +
    `# 本页现有完整代码\n\`\`\`html\n${page.html || ''}\n\`\`\`\n\n` +
    `# 要落实的意见（每条都有定位路径）\n${opinionText}\n\n${TARGETED_RULES}`,
    pageAnnotsT
  );
  const messages: LLMMessage[] = [
    { role: 'system', content: '你是资深前端原型工程师，做外科手术式修改：只动指定元素，其余一律不碰。' },
    { role: 'user', content: userContentT },
  ];

  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const msgs: LLMMessage[] = attempt === 0 ? messages : [...messages, { role: 'user', content: `补丁有问题：${lastErr}\n请修正后重新输出 JSON。` }];
    try {
      const out = extractJson(await callModel(msgs, 0.3, 12000));
      // 页面工主动举手：改动超出单元素，需整页重写（不当作失败、不重试）
      if (out && out.needRewrite === true) {
        throw new NeedRewriteError(typeof out.reason === 'string' && out.reason.trim() ? out.reason.trim() : '改动超出指定元素范围');
      }
      const patches = Array.isArray(out.patches) ? out.patches : [];
      if (!patches.length) throw new Error('没有输出 patches');
      const clean = patches
        .filter((p: any) => p && typeof p.path === 'string' && typeof p.newHtml === 'string' && p.newHtml.trim())
        .map((p: any) => ({ path: p.path.trim(), newHtml: p.newHtml.trim() }));
      if (!clean.length) throw new Error('patches 内容为空');

      const result = applySubtreePatches(page.html || '', clean);
      if (result.failed.length) {
        throw new Error(`以下路径定位失败：${result.failed.map((f) => f.reason).join('；')}`);
      }
      // 补丁片段不能带整页文档标签
      for (const c of clean) {
        if (/<\/?(html|head|body|!doctype)/i.test(c.newHtml)) throw new Error('补丁只能是元素片段，不要 <html>/<head>/<body>');
      }
      // 合并结果过一遍硬校验（PF API / 脚本语法）
      const tmpSpec = {
        pages: allPageIds.map((id) => ({ id })),
        datasets: datasets.map((d: any) => ({ name: d.name, records: d.records || [] })),
      };
      const perr = checkPageHtml(result.html, tmpSpec as any, page.id);
      if (perr) throw new Error(perr);
      return result.html;
    } catch (e) {
      if (e instanceof NeedRewriteError) throw e;
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`靶向补丁失败：${lastErr}`);
}

// --------------------------------------------
// 阶段 4：代码硬校验（非 AI）
// --------------------------------------------
const JS_WHITELIST = new Set([
  'toFixed', 'toString', 'toLowerCase', 'toUpperCase', 'includes', 'trim', 'split', 'join',
  'map', 'filter', 'forEach', 'find', 'sort', 'reduce', 'some', 'length', 'push', 'classList',
  'addEventListener', 'textContent', 'innerHTML', 'value', 'style', 'dataset', 'closest',
  'getElementById', 'querySelector', 'preventDefault', 'toggle', 'remove', 'add', 'contains',
]);

/** 提取页面里渲染记录时的循环变量 → 引用的字段名 */
function extractRecordFieldRefs(html: string): Map<string, Set<string>> {
  const loopVars = new Set<string>();
  const re1 = /(?:forEach|map|filter|find|some|reduce|sort)\s*\(\s*\(?\s*(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(html))) loopVars.add(m[1]);
  const re2 = /(?:const|let|var)\s+(\w+)\s*=\s*[^;]*(?:PF\.findRecord|PF\.records|\.find\(|\.filter\()[^;]*/g;
  while ((m = re2.exec(html))) loopVars.add(m[1]);

  const refs = new Map<string, Set<string>>();
  for (const v of loopVars) {
    const fields = new Set<string>();
    const re = new RegExp(`\\b${v}\\.(\\w+)`, 'g');
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(html))) {
      const f = mm[1];
      if (!JS_WHITELIST.has(f)) fields.add(f);
    }
    if (fields.size) refs.set(v, fields);
  }
  return refs;
};

function hardCheckPage(
  html: string,
  page: any,
  datasets: any[],
  pageOps: TriOp[],
  annots: any[],
  tmpSpec: { pages: { id: string }[]; datasets: { name: string }[] },
): string[] {
  const errs: string[] = [];

  // 4.1 既有校验：PF API 引用合法性
  const perr = checkPageHtml(html, tmpSpec as any, page.id);
  if (perr) errs.push(perr);

  // 4.2 字段必须存在于定稿数据集
  const allFields = new Set<string>();
  for (const d of datasets) for (const k of Object.keys(d.records?.[0] || {})) allFields.add(k);
  const refs = extractRecordFieldRefs(html);
  for (const [v, fields] of refs) {
    for (const f of fields) {
      if (!allFields.has(f)) {
        errs.push(`页面渲染引用了数据契约里不存在的字段 ${v}.${f}（数据集现有字段：${[...allFields].join('/')}）——新列必须用数据契约里的新字段，禁止用旧字段顶替`);
      }
    }
  }

  // 4.3 旧列不许消失：旧表头文字在新 html 里必须还在，除非某条意见明确提到它
  const oldThs = [...(page.html || '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
    .map((x) => x[1].replace(/<[^>]+>/g, '').trim())
    .filter((t) => t.length >= 2);
  const opinionBlob = pageOps.map((op) => annots[op.index - 1]?.content || '').join(' ');
  for (const th of oldThs) {
    if (html.includes(th)) continue;
    // 意见全文提到该列名（或前两个字）才算有意删改
    const mentioned = opinionBlob.includes(th) || (th.length >= 3 && opinionBlob.includes(th.slice(0, 2)));
    if (!mentioned) {
      errs.push(`原来的列「${th}」在新页面里消失了，但没有任何意见要求删除或改名它——意见没提到的列必须原样保留`);
    }
  }
  return errs;
}

// --------------------------------------------
// 主流程
// --------------------------------------------
export async function patchPrototypeFromAnnotations(
  projectId: string,
  annotationIds: string[],
): Promise<PatchResult> {
  const proto = getPrototype(projectId);
  if (!proto || proto.status !== 'ready' || !proto.spec_json) {
    return { ok: false, error: '原型还没生成或未就绪，先整份生成一次' };
  }

  let spec: any;
  try {
    spec = JSON.parse(proto.spec_json);
  } catch {
    return { ok: false, error: '现有原型 spec 解析失败' };
  }
  if (spec.version !== 2) return { ok: false, error: '旧版原型数据，请重新生成整套原型' };

  const all = listAnnotations(projectId, false);
  let annots = annotationIds.length
    ? annotationIds.map((id) => getAnnotation(id)).filter(Boolean)
    : all.filter((a) => a.status === 'open');
  annots = annots.filter((a) => a && a.project_id === projectId && a.status === 'open');
  if (!annots.length) return { ok: false, error: '没有待处理的评审意见' };

  // ===== 阶段 1：分诊 =====
  const triOps = await triage(spec, annots);

  // ===== 阶段 1b：确定性识别“改条数”数据意图（不走 AI，治谎报） =====
  const { dataIndexes } = detectDataIntents(spec, triOps, annots);
  for (const idx of dataIndexes) {
    const di = triOps.find((o) => o.index === idx)!.dataIntent!;
    const a = annots[idx - 1];
    console.log(`[patch] 意见${idx}「${(a.content || '').slice(0, 20)}」识别为数据变更：${di.action} 数据集 ${di.dataset}${di.targetCount != null ? ' → ' + di.targetCount + ' 条' : ' ±' + di.delta}`);
  }

  // ===== 阶段 1c：确定性识别“换图表类型”意图（折线→柱图，不走 AI，治谎报） =====
  const { chartIndexes, plans: chartPlans } = detectChartTypeIntents(spec, triOps, annots);
  for (const idx of chartIndexes) {
    const p = chartPlans.get(idx)!;
    const a = annots[idx - 1];
    console.log(`[patch] 意见${idx}「${(a.content || '').slice(0, 20)}」识别为图表换型：${p.cardLabel || p.elId} ${p.fromType} → ${p.targetType}`);
  }

  // ===== 阶段 2：数据官·加字段（按需） =====
  let fieldPatch: Map<string, DatasetPatch>;
  try {
    fieldPatch = await buildDatasetPatch(spec, triOps, annots);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // 加字段后的数据集（作为后续“改条数”造新行的基底，保证新行带新字段）
  const specWithFields = JSON.parse(JSON.stringify(spec));
  specWithFields.datasets = (spec.datasets || []).map((d: any) =>
    fieldPatch.has(d.name) ? fieldPatch.get(d.name)! : d
  );

  // ===== 阶段 2b：数据官·改条数（确定性增删 + AI 造新行） =====
  let resizePatch = new Map<string, Record<string, any>[]>();
  let dataOutcomes = new Map<number, DataApplyOutcome>();
  if (dataIndexes.size) {
    const r = await applyDataIntents(specWithFields, triOps);
    resizePatch = r.patch;
    dataOutcomes = r.outcomes;
  }

  // 定稿数据集：先加字段、再叠改条数
  const finalDatasets = specWithFields.datasets.map((d: any) =>
    resizePatch.has(d.name) ? { ...d, records: resizePatch.get(d.name)! } : d
  );

  // ===== 阶段 3：页面工并行（纯数据意见不重跑页面——PF.metric/chart 运行时自动联动） =====
  const workerOps = triOps.filter((o) => !dataIndexes.has(o.index) && !chartIndexes.has(o.index));
  const affectedIds = [...new Set(workerOps.flatMap((o) => o.affectsPages))];
  const allPageIds = (spec.pages || []).map((p: any) => p.id);

  const pageResults = await Promise.all(
    affectedIds.map(async (pid) => {
      const page = (spec.pages || []).find((p: any) => p.id === pid);
      const pageOps = workerOps.filter((o) => o.affectsPages.includes(pid));
      // 该页每条意见对应的标注
      const pageAnnots = pageOps.map((o) => annots[o.index - 1]);
      // 路由：全部意见都是局部元素意见（有定位路径、非整页、非布局重构、不加数据列）→ 靶向；否则整页重写
      const allLocal = pageAnnots.every(
        (a) => a && a.target_path && a.target_kind !== 'page'
      );
      const hasStructural = pageOps.some((o) => o.kind === 'layout' || o.needsDataset);
      const hasImage = pageAnnots.some((a) => {
        try { const imgs = typeof a?.images === 'string' ? JSON.parse(a.images || '[]') : (a?.images || []); return Array.isArray(imgs) && imgs.length > 0; } catch { return false; }
      });
      // 带图也先走靶向；页面工若判断超出单元素会主动举手（NeedRewriteError）升级整页重写
      const useTargeted = allLocal && !hasStructural;
      console.log(`[patch] 页面 ${pid}：${useTargeted ? '靶向模式' : '整页重写'}（allLocal=${allLocal}, structural=${hasStructural}, image=${hasImage}, ops=${pageOps.length}）`);
      try {
        const html = useTargeted
          ? await patchPageTargeted(page, pageOps, annots, finalDatasets, allPageIds)
          : await patchPage(page, pageOps, annots, finalDatasets, allPageIds);
        return { pid, title: page.title, html, error: '', mode: useTargeted ? 'targeted' : 'rewrite' };
      } catch (e) {
        // 靶向页面工主动举手：改动超出单元素 → 整页重写（非异常，不重试靶向）
        if (useTargeted && e instanceof NeedRewriteError) {
          console.log(`[patch] 靶向主动升级整页重写：${e.message}`);
          try {
            const html = await patchPage(page, pageOps, annots, finalDatasets, allPageIds);
            return { pid, title: page.title, html, error: '', mode: 'rewrite-escalated' };
          } catch (e2) {
            return { pid, title: page?.title || pid, html: '', error: e2 instanceof Error ? e2.message : String(e2), mode: 'rewrite-escalated' };
          }
        }
        // 靶向异常失败 → 回退整页重写（保证意见总能落实）
        if (useTargeted) {
          console.log(`[patch] 靶向失败，回退整页重写：${e instanceof Error ? e.message : e}`);
          try {
            const html = await patchPage(page, pageOps, annots, finalDatasets, allPageIds);
            return { pid, title: page.title, html, error: '', mode: 'rewrite-fallback' };
          } catch (e2) {
            return { pid, title: page?.title || pid, html: '', error: e2 instanceof Error ? e2.message : String(e2), mode: 'rewrite-fallback' };
          }
        }
        return { pid, title: page?.title || pid, html: '', error: e instanceof Error ? e.message : String(e), mode: 'rewrite' };
      }
    })
  );

  const failed = pageResults.filter((r) => !r.html);
  if (failed.length) {
    return { ok: false, error: `页面修改失败，原型未改动：${failed.map((f) => `「${f.title}」${f.error}`).join('；')}` };
  }

  // ===== 合并（数据集 + 页面） =====
  const newSpec = JSON.parse(JSON.stringify(spec));
  // 加字段结果
  for (const [dsName, ds] of fieldPatch) {
    const idx = newSpec.datasets.findIndex((d: any) => d.name === dsName);
    const obj = { name: ds.name, statusField: ds.statusField, statusMap: ds.statusMap, records: ds.records };
    if (idx >= 0) newSpec.datasets[idx] = obj;
    else newSpec.datasets.push(obj);
  }
  // 改条数结果（在加字段之后）
  let dataChanged = 0;
  for (const [dsName, records] of resizePatch) {
    const idx = newSpec.datasets.findIndex((d: any) => d.name === dsName);
    const base = idx >= 0 ? newSpec.datasets[idx] : (spec.datasets || []).find((d: any) => d.name === dsName);
    if (idx >= 0) newSpec.datasets[idx] = { ...base, records };
    else newSpec.datasets.push({ name: dsName, statusField: base?.statusField, statusMap: base?.statusMap, records });
    dataChanged++;
  }
  const changedPages: string[] = [];
  for (const r of pageResults) {
    const idx = newSpec.pages.findIndex((p: any) => p.id === r.pid);
    if (idx >= 0) {
      newSpec.pages[idx].html = r.html;
      changedPages.push(newSpec.pages[idx].title || r.pid);
    }
  }

  // ===== 图表换型（确定性，不走 AI）：在最终页面 html 上按 elId 重扫后替换 type =====
  // 纯图表意见的页面没进 pageResults；若同页还有普通意见，页面工可能已重写 html，故一律以 newSpec 现页为准。
  const verifyChart = new Map<number, { applied: boolean; reason: string }>();
  for (const idx of chartIndexes) {
    const plan = chartPlans.get(idx)!;
    const pIdx = newSpec.pages.findIndex((p: any) => p.id === plan.pageId);
    if (pIdx < 0) { verifyChart.set(idx, { applied: false, reason: '找不到该页面' }); continue; }
    const curHtml: string = newSpec.pages[pIdx].html || '';
    const res = applyChartTypeToHtml(curHtml, plan.elId, plan.targetType);
    if (res.changed) {
      newSpec.pages[pIdx].html = res.html;
      const pageTitle = newSpec.pages[pIdx].title || plan.pageId;
      if (!changedPages.includes(pageTitle)) changedPages.push(pageTitle);
      verifyChart.set(idx, { applied: true, reason: '' });
    } else if (res.reason === '') {
      // 本来就是目标类型：视为已落实（幂等）
      verifyChart.set(idx, { applied: true, reason: '' });
    } else {
      verifyChart.set(idx, { applied: false, reason: res.reason });
    }
  }

  // ===== 落实校验（治谎报）：逐条核对数据意见是否真的生效，再决定标不标 resolved =====
  const verifyData = new Map<number, { applied: boolean; reason: string }>();
  for (const idx of dataIndexes) {
    const op = triOps.find((o) => o.index === idx)!;
    const outcome = dataOutcomes.get(idx);
    const binding = (op as any)._metric as MetricBinding | undefined;
    if (!binding) {
      verifyData.set(idx, { applied: false, reason: outcome?.reason || '没能对上页面指标，无法核对' });
      continue;
    }
    if (!outcome || !outcome.ok) {
      verifyData.set(idx, { applied: false, reason: outcome?.reason || '数据未能修改' });
      continue;
    }
    // 用定稿数据重新算靶点指标值，核对是否真的变到预期
    const finalDs = newSpec.datasets.find((d: any) => d.name === op.dataIntent!.dataset);
    const val = finalDs ? aggRecords(finalDs.records || [], binding.agg, binding.field, binding.filters) : NaN;
    const di = op.dataIntent!;
    let good = false;
    if (di.action === 'resize' && di.targetCount != null) good = val === di.targetCount;
    else good = Number.isFinite(val) && val !== binding.current; // add/remove：值确实变了
    verifyData.set(idx, good
      ? { applied: true, reason: '' }
      : { applied: false, reason: `改完后该指标仍是 ${val}，没变成预期值` });
  }

  // 有任何落实（页面重写 / 数据变更 / 图表换型）才落库
  const anyApplied =
    changedPages.length > 0 ||
    [...verifyData.values()].some((v) => v.applied) ||
    [...verifyChart.values()].some((v) => v.applied);
  if (anyApplied) {
    newSpec.version = 2;
    newSpec.patchedAt = new Date().toISOString();
    attachRequirementSnapshots(newSpec, projectId);
    upsertPrototype(projectId, { specJson: JSON.stringify(newSpec), status: 'ready', error: null });
  } else {
    // 确定性意见全失败：逐条写原因、保持 open（治谎报），再返回失败供前端红字提示
    for (const idx of dataIndexes) {
      const v = verifyData.get(idx);
      const a = annots[idx - 1];
      if (a && v && !v.applied) markAnnotationNotApplied(a.id, v.reason || '未能落实');
    }
    for (const idx of chartIndexes) {
      const v = verifyChart.get(idx);
      const a = annots[idx - 1];
      if (a && v && !v.applied) markAnnotationNotApplied(a.id, v.reason || '未能落实');
    }
    const reasons = [
      ...[...verifyData.values()].map((v) => v.reason),
      ...[...verifyChart.values()].map((v) => v.reason),
    ].filter(Boolean).join('；');
    return { ok: false, error: `没有意见能落实：${reasons || '请把意见说得更具体些（例如“改成 80 笔”“换成柱图”）'}` };
  }

  // ===== 逐条分流：真落实才标 resolved；没落实保持 open + 写原因 =====
  let needsReqCount = 0;
  let appliedCount = 0;
  const appliedItems: AppliedItem[] = [];
  annots.forEach((a, i) => {
    const op = triOps.find((o) => o.index === i + 1);
    const isData = dataIndexes.has(i + 1);
    const isChart = chartIndexes.has(i + 1);
    const v = isData ? verifyData.get(i + 1) : isChart ? verifyChart.get(i + 1) : null;
    const applied = isData || isChart ? !!v?.applied : true; // 页面意见：页面工成功产出即落实（失败已在上面整批中止）
    const needReq = !isData && !isChart && !!op?.needsReqSync;
    if (needReq) needsReqCount++;
    if (applied) appliedCount++;
    appliedItems.push({
      pageTitle: a.page_title || '',
      targetLabel: a.target_label || '',
      content: a.content || '',
      needsReq: needReq,
      applied,
      reason: v?.reason,
      kind: isData ? 'data' : isChart ? 'chart' : 'page',
    });
    if (applied) markAnnotationProtoApplied(a.id, needReq);
    else markAnnotationNotApplied(a.id, v?.reason || '未能落实');
  });

  const failedCount = annots.length - appliedCount;
  return {
    ok: true,
    changedPages,
    appliedCount,
    failedCount,
    needsReqCount,
    dataChanged,
    modes: Object.fromEntries(pageResults.map((r) => [r.pid, r.mode])),
    appliedItems,
  };
}
