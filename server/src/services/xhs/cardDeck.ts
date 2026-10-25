// ============================================
// 小红书知识卡片轮播 · cardDeck 服务
// --------------------------------------------
// 读主稿 → 单次 LLM 调用产出整套卡片的结构化文案（封面 + N 张正文 + 结尾），
// 存进 xhs 渠道版本 extra_json.cardDeck。文字可改；出图是确定性 HTML 模板
// （cardTemplate）经 Chrome 无头截图成 1080×1440 PNG，零错字、风格统一。
// 图片落 data/xhs-cards/<articleId>/<cardId>.png（每张覆盖式保留最新一版）。
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';
import { getConfig, getModelForRole } from '../../config/index.js';
import {
  getArticle,
  listChannelVersions,
  upsertChannelVersion,
} from '../../store/contentStore.js';
import { withXhsLock } from './xhsLock.js';
import { renderHtmlToImage } from '../gzh/browserShot.js';
import {
  renderCardHtml,
  CARD_W,
  CARD_H,
  type CardData,
} from './cardTemplate.js';
import {
  getStyle,
  listStyles,
  saveStyle,
  DEFAULT_STYLE_ID,
  type CardStyle,
} from './cardStyle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** server/data */
const DATA_DIR = path.resolve(__dirname, '../../../data');
/** 卡片成图落盘根目录：data/xhs-cards/<articleId>/<cardId>.png */
const XHS_CARD_DIR = path.join(DATA_DIR, 'xhs-cards');

export interface CardRenderMeta {
  relPath: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
}

export interface DeckContentCard {
  id: string;             // c1..cN
  title: string;
  hl?: string;
  points: string[];
  render?: CardRenderMeta | null;
}

export interface CardDeck {
  styleId: string;       // 绑定的卡片风格 id（cardStyle 库）
  kicker: string;         // 栏目名
  issue: string;          // 期号
  cover: { title: string; hl?: string; deck: string; render?: CardRenderMeta | null };
  cards: DeckContentCard[];
  closing: { quote: string; quoteHl?: string; cta: string; render?: CardRenderMeta | null };
  updatedAt: number;
}

const CARD_MIN = 6;
const CARD_MAX = 9;

function imageBaseUrl(): string {
  const port = getConfig().port || 3200;
  return `http://127.0.0.1:${port}/api/xhs-img/`;
}

/** relPath → 绝对文件系统路径，强制限定在 XHS_CARD_DIR 内（防目录穿越） */
export function resolveXhsImagePath(relPath: string): string | null {
  const normalized = path.normalize(relPath).replace(/^([/\\])+/, '');
  const abs = path.join(XHS_CARD_DIR, normalized);
  if (!abs.startsWith(XHS_CARD_DIR)) return null;
  return abs;
}

function readXhsExtra(articleId: string): Record<string, unknown> {
  const v = listChannelVersions(articleId).find((x) => x.channel === 'xhs');
  try { return JSON.parse(v?.extra_json || '{}'); } catch { return {}; }
}

function writeXhsExtra(articleId: string, extra: Record<string, unknown>): void {
  const existing = listChannelVersions(articleId).find((x) => x.channel === 'xhs');
  const article = getArticle(articleId);
  upsertChannelVersion(articleId, 'xhs', {
    title: existing?.title || article?.title || '',
    content: existing?.content || '',
    extra,
  });
}

export function getDeck(articleId: string): CardDeck | null {
  const d = readXhsExtra(articleId).cardDeck;
  return d && typeof d === 'object' ? (d as CardDeck) : null;
}

function clip(s: unknown, max: number): string {
  return String(s ?? '').trim().slice(0, max);
}

function safeParseJson(text: string): any | null {
  try { return JSON.parse(text); } catch { /* ignore */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

function buildSystemPrompt(): string {
  return `你是小红书知识卡片操盘手，把一篇长文拆成一套「滑动读图」的知识卡片轮播文案。
读者在小红书是滑着看的：每张卡只讲一个点，标题要短、狠、有钩子，正文是提炼后的要点不是原文搬运。

只输出 JSON，不要任何解释或 markdown 代码块：
{
  "kicker": "栏目名，4字内，如 情绪笔记",
  "issue": "期号纯数字，如 042（没有就给 001）",
  "cover": { "title": "封面大标题，可含\\n分行，2行内、每行≤10字，要最抓眼球的结论或反差", "hl": "title里需橙色高亮的连续原文子串，2-6字，逐字一致", "deck": "一句副述，≤24字，补充痛点或收益" },
  "cards": [
    { "title": "本张卡片核心观点，≤14字", "hl": "title里高亮子串，2-6字，可空", "points": ["要点1，≤28字", "要点2", "要点3"] }
  ],
  "closing": { "quote": "收尾金句，≤24字，有力可转发", "quoteHl": "金句里高亮子串，可空", "cta": "关注/收藏引导，一句话，≤30字，不要站外引流词" }
}

要求：
- 正文卡 ${CARD_MIN}-${CARD_MAX} 张，按文章逻辑递进（现象→原因→方法→误区→行动等），每张 2-4 条要点。
- 只挑真正值得做成卡片的认知点，不要把每段都做成卡、不要灌水。
- 标题口语化、有信息量，避免“关于XX的几点思考”这类无钩子标题。
- 所有高亮 hl 必须是对应 title/quote 里逐字出现的连续子串。`;
}

/** 读主稿生成整套卡片文案（不出图） */
export async function generateDeck(articleId: string): Promise<{ ok: boolean; deck?: CardDeck; error?: string }> {
  const article = getArticle(articleId);
  if (!article) return { ok: false, error: '文章不存在' };
  if (!article.doc_md?.trim()) return { ok: false, error: '主稿还是空的，先写成稿再出卡片' };

  const cfg = getConfig();
  const client = new OpenAI({ apiKey: cfg.llm.apiKey, baseURL: cfg.llm.baseUrl });
  const model = getModelForRole('receptionist');

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.7,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content:
          `把下面这篇文章拆成 ${CARD_MIN}-${CARD_MAX} 张知识卡片的轮播文案，只输出要求的 JSON。\n\n` +
          `# ${article.title}\n\n${article.doc_md}`,
      },
    ],
  });

  const parsed = safeParseJson(resp.choices[0]?.message?.content || '');
  const deck = parsed ? normalizeDeck(parsed) : null;
  if (!deck) return { ok: false, error: '卡片方案生成失败（模型未返回有效 JSON），可重试' };

  return withXhsLock(articleId, () => {
    const extra = readXhsExtra(articleId);
    // 重生成保留不了旧成图（卡片集合会变），清掉渲染标记，需重新出图
    extra.cardDeck = deck;
    writeXhsExtra(articleId, extra);
    return { ok: true as const, deck };
  });
}

function normalizeDeck(p: any): CardDeck | null {
  const rawCards = Array.isArray(p.cards) ? p.cards : [];
  const cards: DeckContentCard[] = rawCards
    .slice(0, CARD_MAX)
    .map((c: any, i: number) => ({
      id: `c${i + 1}`,
      title: clip(c?.title, 40),
      hl: clip(c?.hl, 12),
      points: (Array.isArray(c?.points) ? c.points : [])
        .map((x: unknown) => clip(x, 60))
        .filter(Boolean)
        .slice(0, 4),
      render: null,
    }))
    .filter((c: DeckContentCard) => c.title && c.points.length);

  const coverTitle = clip(p?.cover?.title, 44);
  const quote = clip(p?.closing?.quote, 48);
  if (!coverTitle || !cards.length || !quote) return null;

  return {
    styleId: /^[a-zA-Z0-9_-]{1,40}$/.test(clip(p?.styleId, 40)) ? clip(p.styleId, 40) : DEFAULT_STYLE_ID,
    kicker: clip(p?.kicker, 8) || '情绪笔记',
    issue: /^\d{2,4}$/.test(clip(p?.issue, 4)) ? clip(p?.issue, 4).padStart(2, '0') : '001',
    cover: { title: coverTitle, hl: clip(p?.cover?.hl, 12), deck: clip(p?.cover?.deck, 60), render: null },
    cards,
    closing: { quote, quoteHl: clip(p?.closing?.quoteHl, 12), cta: clip(p?.closing?.cta, 60) || '点赞收藏，关注我看下篇', render: null },
    updatedAt: Date.now(),
  };
}

/** 保存人工改过的文案（整体覆盖文本字段，保留已有成图标记；卡数不可在此增删） */
export function saveDeckPlan(
  articleId: string,
  patch: Record<string, unknown>
): { ok: boolean; deck?: CardDeck; error?: string } {
  const deck = getDeck(articleId);
  if (!deck) return { ok: false, error: '还没有卡片方案' };

  const next: CardDeck = JSON.parse(JSON.stringify(deck));
  // 切换风格：合法且变化时换绑，并清空旧风格的全部成图（需按新风格重绘）
  if (typeof patch.styleId === 'string') {
    const sid = clip(patch.styleId, 40);
    if (listStyles().some((st) => st.id === sid) && sid !== next.styleId) {
      next.styleId = sid;
      next.cover.render = null;
      next.cards.forEach((c) => { c.render = null; });
      next.closing.render = null;
    }
  }
  if (typeof patch.kicker === 'string') next.kicker = clip(patch.kicker, 8);
  if (typeof patch.issue === 'string') next.issue = clip(patch.issue, 4);
  if (patch.cover && typeof patch.cover === 'object') {
    const c = patch.cover as Record<string, unknown>;
    if (typeof c.title === 'string') next.cover.title = clip(c.title, 44);
    if (typeof c.hl === 'string') next.cover.hl = clip(c.hl, 12);
    if (typeof c.deck === 'string') next.cover.deck = clip(c.deck, 60);
  }
  if (patch.closing && typeof patch.closing === 'object') {
    const c = patch.closing as Record<string, unknown>;
    if (typeof c.quote === 'string') next.closing.quote = clip(c.quote, 48);
    if (typeof c.quoteHl === 'string') next.closing.quoteHl = clip(c.quoteHl, 12);
    if (typeof c.cta === 'string') next.closing.cta = clip(c.cta, 60);
  }
  if (Array.isArray(patch.cards)) {
    for (const pc of patch.cards as Array<Record<string, unknown>>) {
      const id = clip(pc.id, 8);
      const target = next.cards.find((x) => x.id === id);
      if (!target) continue;
      if (typeof pc.title === 'string') target.title = clip(pc.title, 40);
      if (typeof pc.hl === 'string') target.hl = clip(pc.hl, 12);
      if (Array.isArray(pc.points)) target.points = (pc.points as unknown[]).map((x) => clip(x, 60)).filter(Boolean).slice(0, 4);
    }
  }
  next.updatedAt = Date.now();

  withXhsLock(articleId, () => {
    const extra = readXhsExtra(articleId);
    extra.cardDeck = next;
    writeXhsExtra(articleId, extra);
  });
  return { ok: true, deck: next };
}

/** 拼某张卡的模板数据 */
function cardDataOf(deck: CardDeck, cardId: string): CardData | null {
  if (cardId === 'cover') {
    return { kind: 'cover', kicker: deck.kicker, title: deck.cover.title, hl: deck.cover.hl || '', deck: deck.cover.deck, issue: deck.issue };
  }
  if (cardId === 'closing') {
    return { kind: 'closing', quote: deck.closing.quote, quoteHl: deck.closing.quoteHl || '', cta: deck.closing.cta };
  }
  const idx = deck.cards.findIndex((c) => c.id === cardId);
  if (idx < 0) return null;
  return {
    kind: 'content',
    index: idx + 1,
    total: deck.cards.length,
    kicker: deck.kicker,
    title: deck.cards[idx].title,
    hl: deck.cards[idx].hl || '',
    points: deck.cards[idx].points,
  };
}

/** 渲染单张卡为 PNG 并落盘，回写该卡 render 元信息 */
export async function renderCard(
  articleId: string,
  cardId: string
): Promise<{ ok: boolean; render?: CardRenderMeta; error?: string }> {
  const deck = getDeck(articleId);
  if (!deck) return { ok: false, error: '还没有卡片方案' };
  const data = cardDataOf(deck, cardId);
  if (!data) return { ok: false, error: '未知卡片' };

  const html = renderCardHtml(data, getStyle(deck.styleId));
  const shot = await renderHtmlToImage(html, { width: CARD_W, height: CARD_H, format: 'png' });

  const dir = path.join(XHS_CARD_DIR, articleId);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${cardId}.png`;
  const abs = path.join(dir, file);
  fs.writeFileSync(abs, shot.image);
  const relPath = `${articleId}/${file}`;
  const meta: CardRenderMeta = {
    relPath,
    url: imageBaseUrl() + relPath,
    width: CARD_W,
    height: CARD_H,
    bytes: shot.image.length,
    createdAt: Date.now(),
  };

  await withXhsLock(articleId, () => {
    const extra = readXhsExtra(articleId);
    const d = extra.cardDeck as CardDeck;
    if (cardId === 'cover') d.cover.render = meta;
    else if (cardId === 'closing') d.closing.render = meta;
    else { const c = d.cards.find((x) => x.id === cardId); if (c) c.render = meta; }
    writeXhsExtra(articleId, extra);
  });
  return { ok: true, render: meta };
}

/** 依次渲染全部卡片（封面 + 正文 + 结尾） */
export async function renderAllCards(articleId: string): Promise<{ ok: boolean; rendered: number; failed: string[]; error?: string }> {
  const deck = getDeck(articleId);
  if (!deck) return { ok: false, rendered: 0, failed: [], error: '还没有卡片方案' };
  const ids = ['cover', ...deck.cards.map((c) => c.id), 'closing'];
  const failed: string[] = [];
  let rendered = 0;
  for (const id of ids) {
    const r = await renderCard(articleId, id);
    if (r.ok) rendered += 1; else failed.push(id);
  }
  return { ok: failed.length === 0, rendered, failed };
}

/** AI 根据一句风格诉求（或结合文章）设计一个新风格；normalize 严格校验后存入自定义库 */
export async function designStyleWithAi(input: {
  brief: string;
  articleId?: string;
}): Promise<{ ok: boolean; style?: CardStyle; error?: string }> {
  const brief = clip(input.brief, 300);
  if (!brief) return { ok: false, error: '先说下想要什么感觉的风格' };

  let articleCtx = '';
  if (input.articleId) {
    const a = getArticle(input.articleId);
    if (a?.doc_md) articleCtx = `\n\n参考文章标题：${a.title}\n正文节选：\n${a.doc_md.slice(0, 1200)}`;
  }

  const cfg = getConfig();
  const client = new OpenAI({ apiKey: cfg.llm.apiKey, baseURL: cfg.llm.baseUrl });
  const model = getModelForRole('receptionist');

  const system = `你是小红书知识卡片视觉设计师。你不能写 HTML/CSS，只能在给定的设计旋钮（枚举与配色）里选值，产出一套风格。
可选值：
- titleFont / bodyFont: serif（宋体/文艺）、hei（黑体/现代有力）、dengxian（等线/理性清爽）、kaiti（楷体/柔软文艺）、fangsong（仿宋）
- kickerStyle（栏目标签）: block（实心色块）、pill（描边胶囊）、plain（下划线纯字）
- highlightStyle（标题高亮）: marker（荧光笔底色）、solid（实心色块反白字）、underline（粗下划线）
- numberStyle（正文编号）: big（巨大数字）、circle（描边圆圈）、none（不要大编号）
- coverAlign: top（上对齐杂志感）、center（居中大字报）
- accentBar / cornerFrame / showWatermark / darkClosing: true/false（顶色条/四角括弧/期号水印/结尾深底）
- colors: bg（卡底）、ink（主文字，须与 bg 高对比）、muted（次要文字）、accent（一个强调色）、accentInk（压在强调色上的字色），全部 #rrggbb。line 可省略。
配色要协调、bg 与 ink 必须高对比、accent 只用一个主强调色。只输出 JSON：
{"name":"4-8字风格名","description":"一句话风格说明","colors":{"bg":"#...","ink":"#...","muted":"#...","accent":"#...","accentInk":"#..."},"titleFont":"...","bodyFont":"...","kickerStyle":"...","highlightStyle":"...","numberStyle":"...","coverAlign":"...","accentBar":true,"cornerFrame":false,"showWatermark":true,"darkClosing":true}`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.9,
    max_tokens: 900,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `想要的风格感觉：${brief}${articleCtx}` },
    ],
  });

  const parsed = safeParseJson(resp.choices[0]?.message?.content || '');
  if (!parsed) return { ok: false, error: 'AI 未返回有效风格，可换个说法重试' };
  const id = `ai-${Date.now().toString(36)}`;
  const saved = saveStyle({ ...parsed, id });
  if (!saved.ok || !saved.style) return { ok: false, error: saved.error || '风格保存失败' };
  return { ok: true, style: saved.style };
}

export const ALL_CARD_ID_PREFIX = { cover: 'cover', closing: 'closing' };
