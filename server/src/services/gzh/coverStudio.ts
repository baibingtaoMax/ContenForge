// ============================================
// 公众号 AI 封面工坊（两版 × 两比例 = 4 张）
// --------------------------------------------
// 流程：generateCoverPlan（AI 读稿出文字方案+两版画面 prompt，可改）
//   → generateCoverArt（逐版调 seedream 生【无文字】背景，可换一张）
//   → renderCover / renderAll（Chrome 用 Editorial 模板把准确标题盖上）
//   → chooseCover（4 张里选一张，写入 extra.cover，直接接一键推草稿）
// 状态存 wechat 版本 extra_json.coverStudio；与 shots/cover 共用 withGzhLock。
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { getConfig, getModelForRole } from '../../config/index.js';
import { getArticle } from '../../store/contentStore.js';
import { withGzhLock } from './gzhLock.js';
import { generateSeedreamBytes } from './seedream.js';
import { renderHtmlToImage } from './browserShot.js';
import {
  buildCoverHtml,
  COVER_ART_SPECS,
  COVER_DIM,
  type CoverPlan,
  type CoverVariant,
  type CoverRatio,
  type CoverArtKey,
} from './coverTemplate.js';
import {
  listChannelVersions,
  upsertChannelVersion,
} from '../../store/contentStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../data');
const COVER_ROOT = path.join(DATA_DIR, 'gzh-covers');

export const COVER_KEYS: CoverArtKey[] = ['xiaohei-wide', 'xiaohei-square', 'magazine-wide', 'magazine-square'];

export interface CoverArtImage {
  relPath: string;
  url: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: number;
}
export interface CoverRender {
  relPath: string;
  url: string;
  bytes: number;
  createdAt: number;
}
export interface CoverStudioPlan extends CoverPlan {
  /** 小黑版画面主体（模型给，风格/无文字约束服务端补） */
  xiaoheiBody: string;
  /** 杂志抽象版画面主体 */
  magazineBody: string;
}
export interface CoverStudioState {
  plan: CoverStudioPlan;
  /** 每个版位的背景候选（换一张追加） */
  art: Partial<Record<CoverArtKey, CoverArtImage[]>>;
  /** 每个版位当前选中的背景 relPath */
  selectedArt: Partial<Record<CoverArtKey, string>>;
  /** 每个版位合成出的成品（换背景重渲染会追加，取最新） */
  renders: Partial<Record<CoverArtKey, CoverRender[]>>;
  /** 最终选作封面的版位 */
  chosen?: CoverArtKey;
}

function imageBaseUrl(): string {
  return `http://127.0.0.1:${getConfig().port || 3200}/api/gzh-cover/`;
}
function relToUrl(rel: string): string {
  return imageBaseUrl() + rel.split(path.sep).join('/');
}

function readExtra(articleId: string): Record<string, unknown> {
  const v = listChannelVersions(articleId).find((x) => x.channel === 'wechat');
  try { return JSON.parse(v?.extra_json || '{}'); } catch { return {}; }
}
function writeExtra(articleId: string, extra: Record<string, unknown>): void {
  const existing = listChannelVersions(articleId).find((x) => x.channel === 'wechat');
  const article = getArticle(articleId);
  upsertChannelVersion(articleId, 'wechat', {
    title: existing?.title || article?.title || '',
    content: existing?.content || '',
    extra,
  });
}
export function getCoverStudio(articleId: string): CoverStudioState | null {
  const s = readExtra(articleId).coverStudio;
  return s && typeof s === 'object' ? (s as CoverStudioState) : null;
}

// ---------- 方案生成 ----------

function safeParseJson(text: string): any | null {
  try { return JSON.parse(text); } catch { /* ignore */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}
const clip = (x: unknown, max: number) => String(x ?? '').trim().slice(0, max);

async function llmPlan(articleId: string): Promise<CoverStudioPlan> {
  const article = getArticle(articleId);
  if (!article) throw new Error('文章不存在');
  if (!article.doc_md?.trim()) throw new Error('主稿还是空的，先写成稿再做封面');

  const cfg = getConfig();
  const client = new OpenAI({ apiKey: cfg.llm.apiKey, baseURL: cfg.llm.baseUrl });
  const model = getModelForRole('receptionist');
  const resp = await client.chat.completions.create({
    model,
    temperature: 0.7,
    max_tokens: 1600,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `为这篇文章设计公众号封面方案，只输出 JSON。\n\n# ${article.title}\n\n${article.doc_md}` },
    ],
  });
  const parsed = safeParseJson(resp.choices[0]?.message?.content || '');
  if (!parsed) throw new Error('封面方案生成失败（模型未返回有效 JSON），可重试');

  return {
    issue: /^\d{2,4}$/.test(clip(parsed.issue, 4)) ? clip(parsed.issue, 4).padStart(2, '0') : '001',
    year: /^\d{4}$/.test(clip(parsed.year, 4)) ? clip(parsed.year, 4) : String(new Date().getFullYear()),
    kicker: clip(parsed.kicker, 12) || '随笔',
    en: clip(parsed.en, 28).toUpperCase() || 'ESSAY',
    wideTitle: clip(parsed.wideTitle, 44),
    wideHl: clip(parsed.wideHl, 12),
    squareTitle: clip(parsed.squareTitle, 24),
    squareHl: clip(parsed.squareHl, 10),
    deck: clip(parsed.deck, 70),
    quote: clip(parsed.quote, 40),
    quoteHl: clip(parsed.quoteHl, 10),
    xiaoheiBody: clip(parsed.xiaoheiBody, 200),
    magazineBody: clip(parsed.magazineBody, 200),
  };
}

const SYSTEM = `你是公众号「有点真知」的杂志封面编辑，为情绪/认知/成长类深度文章设计 Editorial 电子杂志封面。
只输出一个 JSON，不要解释、不要 markdown 代码块：
{"issue":"期号纯数字，如042","year":"2026","kicker":"中文栏目名，4字内，如 情绪笔记","en":"该栏目的英文，2-4个大写词",
"wideTitle":"21:9横图主标题，最多三行、每行≤13字，用\\n分行，要有力、可断成金句",
"wideHl":"wideTitle里需要橙色高亮的连续原文子串，2-6字，必须与标题用字完全一致",
"squareTitle":"1:1方图标题，最多两行、每行≤7字，用\\n分行，更短更狠",
"squareHl":"squareTitle里高亮的连续原文子串，2-5字，必须逐字一致",
"deck":"一句副述，30-50字，不重复标题，点出文章真正的洞察",
"quote":"一句金句，12-24字，备用","quoteHl":"金句里高亮词2-6字",
"xiaoheiBody":"小黑手绘封面的画面主体，中文30-60字：圆头黑色实心小人(白点眼细腿)在做一个荒诞但成立、能隐喻本文核心的动作，具体动作+物件+空间，不要写风格/字体/无文字等约束",
"magazineBody":"杂志抽象版背景的画面主体，中文30-60字：用光影/物件/场景/材质做高级克制的隐喻，电影感、无人物正脸也可，给出色调与氛围，不要出现任何文字字母数字"}
要求：标题必须忠于文章核心判断；高亮词必须是对应标题里原样存在的连续子串；两个画面 prompt 都绝不包含任何文字、字母、数字、logo。`;

export async function generateCoverPlan(articleId: string): Promise<CoverStudioState> {
  const plan = await llmPlan(articleId); // 慢的 LLM 在锁外
  return withGzhLock(articleId, () => {
    const extra = readExtra(articleId);
    const prev = (extra.coverStudio as CoverStudioState) || null;
    const state: CoverStudioState = {
      plan,
      art: prev?.art || {},
      selectedArt: prev?.selectedArt || {},
      renders: prev?.renders || {},
    };
    extra.coverStudio = state;
    writeExtra(articleId, extra);
    return state;
  });
}

/** 编辑方案里的文字/画面 prompt（字段白名单） */
export function saveCoverPlan(
  articleId: string,
  patch: Partial<CoverStudioPlan>
): Promise<CoverStudioState> {
  return withGzhLock(articleId, () => {
    const extra = readExtra(articleId);
    const state = extra.coverStudio as CoverStudioState | undefined;
    if (!state) throw new Error('还没生成封面方案');
    const fields: (keyof CoverStudioPlan)[] = [
      'issue', 'year', 'kicker', 'en', 'wideTitle', 'wideHl', 'squareTitle', 'squareHl',
      'deck', 'quote', 'quoteHl', 'xiaoheiBody', 'magazineBody',
    ];
    for (const f of fields) {
      if (typeof patch[f] === 'string') (state.plan as any)[f] = (patch[f] as string).trim();
    }
    extra.coverStudio = state;
    writeExtra(articleId, extra);
    return state;
  });
}

// ---------- 背景图 prompt ----------

const XIAOHEI_COVER_PREFIX =
  '手绘插画封面，纯白背景，黑色手绘钢笔线稿（线条略带手绘微颤），大量留白；' +
  '小黑是唯一主体：圆头黑色实心小人、白色圆点眼睛、细腿，表情空呆但认真，正在做一件荒诞但成立的事；' +
  '仅允许极少量手写中文短批注（橙/红/蓝，全图最多3个词）；无渐变无阴影无纸张纹理无复杂背景，' +
  '非PPT信息图非商业矢量非儿童卡通；画面中绝不出现标题、字母、数字、logo、乱码或伪文字。';

const MAGAZINE_COVER_PREFIX =
  '高级Editorial杂志封面背景摄影/插画，电影感布光，克制的米白/墨黑/暖橙色调，质感细腻，构图留有干净的暗色负空间；' +
  '无人物正脸、无品牌；画面中绝不出现任何文字、字母、数字、logo、标语、乱码或伪文字。画面：';

function buildArtPrompt(key: CoverArtKey, plan: CoverStudioPlan): string {
  const spec = COVER_ART_SPECS[key];
  const variant: CoverVariant = key.startsWith('xiaohei') ? 'xiaohei' : 'magazine';
  const body = variant === 'xiaohei' ? plan.xiaoheiBody : plan.magazineBody;
  const prefix = variant === 'xiaohei' ? XIAOHEI_COVER_PREFIX : MAGAZINE_COVER_PREFIX;
  return `${prefix}${body}。${spec.compositionHint}。`;
}

// ---------- 逐版生背景 ----------

/** 生某版位的无文字背景（换一张追加候选）。慢的生图在锁外，写回进锁。 */
export async function generateCoverArt(
  articleId: string,
  key: CoverArtKey
): Promise<{ state: CoverStudioState; image: CoverArtImage }> {
  if (!COVER_KEYS.includes(key)) throw new Error('未知封面版位');
  const planNow = getCoverStudio(articleId)?.plan;
  if (!planNow) throw new Error('还没生成封面方案');
  const spec = COVER_ART_SPECS[key];
  const prompt = buildArtPrompt(key, planNow);
  // 封面背景不带「AI生成」水印（成品已由模板精确排版，水印会压在画面上）
  const { buffer, width, height } = await generateSeedreamBytes(prompt, spec.size, false);

  return withGzhLock(articleId, () => {
    const extra = readExtra(articleId);
    const state = extra.coverStudio as CoverStudioState | undefined;
    if (!state) throw new Error('封面方案丢失，请重新生成');

    const dir = path.join(COVER_ROOT, articleId, 'art');
    fs.mkdirSync(dir, { recursive: true });
    const file = `${key}-${Date.now()}.jpg`;
    fs.writeFileSync(path.join(dir, file), buffer);
    const relPath = `${articleId}/art/${file}`;
    const image: CoverArtImage = {
      relPath, url: relToUrl(relPath), bytes: buffer.length, width, height, createdAt: Date.now(),
    };
    const list = state.art[key] ? [...state.art[key]!] : [];
    list.push(image);
    state.art[key] = list;
    state.selectedArt[key] = relPath;
    extra.coverStudio = state;
    writeExtra(articleId, extra);
    return { state, image };
  });
}

// ---------- Chrome 合成成品 ----------

function artAbsPath(articleId: string, state: CoverStudioState, key: CoverArtKey): string | null {
  const rel = state.selectedArt[key] || state.art[key]?.at(-1)?.relPath;
  if (!rel) return null;
  return path.join(COVER_ROOT, rel);
}

async function renderOne(
  articleId: string,
  state: CoverStudioState,
  key: CoverArtKey
): Promise<CoverRender> {
  const [variant, ratio] = key.split('-') as [CoverVariant, CoverRatio];
  const artAbs = artAbsPath(articleId, state, key);
  if (!artAbs || !fs.existsSync(artAbs)) throw new Error(`「${key}」还没生背景图`);
  const html = buildCoverHtml(variant, ratio, state.plan, artAbs);
  const { w, h } = COVER_DIM[ratio];
  const { image } = await renderHtmlToImage(html, { width: w, height: h, format: 'png' });

  const dir = path.join(COVER_ROOT, articleId, 'render');
  fs.mkdirSync(dir, { recursive: true });
  const file = `${key}-${Date.now()}.png`;
  fs.writeFileSync(path.join(dir, file), image);
  const relPath = `${articleId}/render/${file}`;
  return { relPath, url: relToUrl(relPath), bytes: image.length, createdAt: Date.now() };
}

/** 合成单个版位（换背景/改文案后重渲染） */
export function renderCover(articleId: string, key: CoverArtKey): Promise<{ state: CoverStudioState; render: CoverRender }> {
  return withGzhLock(articleId, async () => {
    const extra = readExtra(articleId);
    const state = extra.coverStudio as CoverStudioState | undefined;
    if (!state) throw new Error('还没生成封面方案');
    const render = await renderOne(articleId, state, key);
    const list = state.renders[key] ? [...state.renders[key]!] : [];
    list.push(render);
    state.renders[key] = list;
    extra.coverStudio = state;
    writeExtra(articleId, extra);
    return { state, render };
  });
}

/** 一次合成全部 4 张（已有背景的版位；缺背景的跳过并在 skipped 告知） */
export function renderAllCovers(articleId: string): Promise<{ state: CoverStudioState; renders: CoverRender[]; skipped: CoverArtKey[] }> {
  return withGzhLock(articleId, async () => {
    const extra = readExtra(articleId);
    const state = extra.coverStudio as CoverStudioState | undefined;
    if (!state) throw new Error('还没生成封面方案');
    const renders: CoverRender[] = [];
    const skipped: CoverArtKey[] = [];
    for (const key of COVER_KEYS) {
      const abs = artAbsPath(articleId, state, key);
      if (!abs || !fs.existsSync(abs)) { skipped.push(key); continue; }
      const r = await renderOne(articleId, state, key);
      const list = state.renders[key] ? [...state.renders[key]!] : [];
      list.push(r);
      state.renders[key] = list;
      renders.push(r);
    }
    extra.coverStudio = state;
    writeExtra(articleId, extra);
    return { state, renders, skipped };
  });
}

// ---------- 选一张作封面（写入 extra.cover，接一键推送） ----------

export interface ChosenCover {
  relPath: string;
  url: string;
  filename: string;
  bytes: number;
  contentType: string;
  createdAt: number;
}

/**
 * 选某个版位作封面。优先用 Chrome 合成的带标题成品（renders）；
 * 该版位还没合成、但已生过无文字背景图时，允许直接拿背景当封面——
 * 复制成一篇一张的独立 cover 文件（不引用工坊 art 源文件，换/删封面不会动到工坊背景）。
 */
export function chooseCover(
  articleId: string,
  key: CoverArtKey
): Promise<{ cover: ChosenCover; source: 'render' | 'art' }> {
  return withGzhLock(articleId, () => {
    const extra = readExtra(articleId);
    const state = extra.coverStudio as CoverStudioState | undefined;
    if (!state) throw new Error('还没生成封面方案');

    const render = state.renders[key]?.at(-1);
    let cover: ChosenCover;
    let source: 'render' | 'art';

    if (render) {
      cover = {
        relPath: render.relPath,
        url: render.url,
        filename: path.basename(render.relPath),
        bytes: render.bytes,
        contentType: 'image/png',
        createdAt: render.createdAt,
      };
      source = 'render';
    } else {
      // 回退：未合成，直接用该版位当前选中（或最新）的背景图
      const artRel = state.selectedArt[key] || state.art[key]?.at(-1)?.relPath;
      if (!artRel) throw new Error(`「${key}」还没生背景图，先点「生背景」或「合成」`);
      const srcAbs = path.join(COVER_ROOT, artRel);
      if (!fs.existsSync(srcAbs)) throw new Error(`「${key}」的背景图文件丢了，重新生一张`);

      const dir = path.join(COVER_ROOT, articleId);
      fs.mkdirSync(dir, { recursive: true });
      const file = `cover-${Date.now()}.jpg`;
      fs.copyFileSync(srcAbs, path.join(dir, file));
      const relPath = `${articleId}/${file}`;
      const artImg = state.art[key]?.find((a) => a.relPath === artRel) || state.art[key]?.at(-1);
      cover = {
        relPath,
        url: relToUrl(relPath),
        filename: file,
        bytes: artImg?.bytes ?? fs.statSync(path.join(dir, file)).size,
        contentType: 'image/jpeg',
        createdAt: Date.now(),
      };
      source = 'art';
    }

    state.chosen = key;
    extra.coverStudio = state;
    // 同步到推送用的单封面位（cover.ts / push-draft 读 extra.cover）
    extra.cover = cover;
    writeExtra(articleId, extra);
    return { cover, source };
  });
}
