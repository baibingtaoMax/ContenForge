// ============================================
// 小红书卡片 · 风格系统（设计令牌 + 内置预设 + 可复用风格库）
// --------------------------------------------
// 思路：版式骨架固定（零崩版/零错字），风格 = 一组受约束的设计旋钮
//（配色 / 字体 / 强调样式 / 装饰）。AI 只能在这些旋钮里出值，经 normalize
// 严格校验（颜色必须是 #rrggbb、枚举白名单、长度钳制），不能写 HTML/CSS。
// 内置预设常驻；自定义风格（含 AI 设计）落 data/xhs-styles.json，全局复用。
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../data');
const STYLE_FILE = path.join(DATA_DIR, 'xhs-styles.json');

export type FontKey = 'serif' | 'hei' | 'dengxian' | 'kaiti' | 'fangsong';
export type KickerStyle = 'block' | 'pill' | 'plain';
export type HighlightStyle = 'marker' | 'solid' | 'underline';
export type NumberStyle = 'big' | 'circle' | 'none';
export type CoverAlign = 'top' | 'center';

export interface CardStyle {
  id: string;
  name: string;
  description: string;
  builtin?: boolean;
  colors: {
    bg: string;          // 卡底
    ink: string;         // 主文字
    muted: string;       // 次要文字
    accent: string;      // 强调色
    accentInk: string;   // 压在 accent 色块上的文字色
    line: string;        // 分隔线（任意合法 CSS 颜色）
  };
  titleFont: FontKey;
  bodyFont: FontKey;
  kickerStyle: KickerStyle;
  highlightStyle: HighlightStyle;
  numberStyle: NumberStyle;
  coverAlign: CoverAlign;
  accentBar: boolean;        // 顶部色条
  cornerFrame: boolean;      // 封面角标括弧
  showWatermark: boolean;    // 封面巨型期号水印
  darkClosing: boolean;      // 结尾卡是否反色（深底）
}

export const DEFAULT_STYLE_ID = 'editorial';

const HEX = /^#[0-9a-fA-F]{6}$/;
const FONTS: FontKey[] = ['serif', 'hei', 'dengxian', 'kaiti', 'fangsong'];
const KICKERS: KickerStyle[] = ['block', 'pill', 'plain'];
const HLS: HighlightStyle[] = ['marker', 'solid', 'underline'];
const NUMS: NumberStyle[] = ['big', 'circle', 'none'];
const ALIGNS: CoverAlign[] = ['top', 'center'];

function hex(x: unknown, fallback: string): string {
  const s = String(x ?? '').trim();
  return HEX.test(s) ? s.toLowerCase() : fallback;
}
function oneOf<T extends string>(x: unknown, allow: readonly T[], fb: T): T {
  return typeof x === 'string' && (allow as readonly string[]).includes(x) ? (x as T) : fb;
}
function str(x: unknown, max: number, fb: string): string {
  const s = String(x ?? '').trim();
  return s ? s.slice(0, max) : fb;
}
function bool(x: unknown, fb: boolean): boolean {
  return typeof x === 'boolean' ? x : fb;
}

/** 严格校验/钳制一份外部风格（AI 或人工 JSON），保证永不崩版 */
export function normalizeStyle(input: unknown, fallbackId?: string): CardStyle {
  const fb = BUILTIN_STYLES[0];
  const p = (input && typeof input === 'object' ? input : {}) as Partial<CardStyle>;
  const c = (p.colors && typeof p.colors === 'object' ? p.colors : {}) as Partial<CardStyle['colors']>;
  return {
    id: fallbackId || str(p.id, 40, 'custom'),
    name: str(p.name, 16, '自定义风格'),
    description: str(p.description, 60, ''),
    builtin: false,
    colors: {
      bg: hex(c.bg, fb.colors.bg),
      ink: hex(c.ink, fb.colors.ink),
      muted: hex(c.muted, fb.colors.muted),
      accent: hex(c.accent, fb.colors.accent),
      accentInk: hex(c.accentInk, fb.colors.accentInk),
      line: str(c.line, 40, fb.colors.line),
    },
    titleFont: oneOf(p.titleFont, FONTS, fb.titleFont),
    bodyFont: oneOf(p.bodyFont, FONTS, fb.bodyFont),
    kickerStyle: oneOf(p.kickerStyle, KICKERS, fb.kickerStyle),
    highlightStyle: oneOf(p.highlightStyle, HLS, fb.highlightStyle),
    numberStyle: oneOf(p.numberStyle, NUMS, fb.numberStyle),
    coverAlign: oneOf(p.coverAlign, ALIGNS, fb.coverAlign),
    accentBar: bool(p.accentBar, fb.accentBar),
    cornerFrame: bool(p.cornerFrame, fb.cornerFrame),
    showWatermark: bool(p.showWatermark, fb.showWatermark),
    darkClosing: bool(p.darkClosing, fb.darkClosing),
  };
}

// ---------- 内置预设（字体均经无头 Chrome 实测可用） ----------
export const BUILTIN_STYLES: CardStyle[] = [
  {
    id: 'editorial',
    name: '橄榄手记',
    description: '米白纸底 + 墨黑宋体 + 橙色标注，杂志专栏感',
    builtin: true,
    colors: { bg: '#f3f0e8', ink: '#1a1a1c', muted: '#68625a', accent: '#ed7b2f', accentInk: '#1a1a1c', line: 'rgba(10,10,11,.22)' },
    titleFont: 'serif', bodyFont: 'serif',
    kickerStyle: 'block', highlightStyle: 'marker', numberStyle: 'big', coverAlign: 'top',
    accentBar: true, cornerFrame: false, showWatermark: true, darkClosing: true,
  },
  {
    id: 'night-neon',
    name: '暗夜霓虹',
    description: '深墨底 + 现代黑体 + 霓虹玫红，酷感强对比',
    builtin: true,
    colors: { bg: '#101115', ink: '#f5f4ef', muted: '#9aa0ac', accent: '#ff5d8f', accentInk: '#101115', line: 'rgba(245,244,239,.22)' },
    titleFont: 'hei', bodyFont: 'hei',
    kickerStyle: 'block', highlightStyle: 'solid', numberStyle: 'big', coverAlign: 'top',
    accentBar: true, cornerFrame: false, showWatermark: false, darkClosing: true,
  },
  {
    id: 'bold-pop',
    name: '活力撞色',
    description: '亮黄底 + 粗黑标题 + 黑色块，小红书高点击风',
    builtin: true,
    colors: { bg: '#ffe84a', ink: '#111111', muted: '#4a4510', accent: '#111111', accentInk: '#ffe84a', line: 'rgba(17,17,17,.35)' },
    titleFont: 'hei', bodyFont: 'hei',
    kickerStyle: 'block', highlightStyle: 'solid', numberStyle: 'big', coverAlign: 'center',
    accentBar: false, cornerFrame: false, showWatermark: false, darkClosing: false,
  },
  {
    id: 'minimal-ink',
    name: '极简墨白',
    description: '纯白留白 + 宋体 + 一点朱砂红，冷静克制',
    builtin: true,
    colors: { bg: '#ffffff', ink: '#141414', muted: '#7a7a7a', accent: '#d8322b', accentInk: '#ffffff', line: 'rgba(20,20,20,.18)' },
    titleFont: 'serif', bodyFont: 'serif',
    kickerStyle: 'plain', highlightStyle: 'underline', numberStyle: 'circle', coverAlign: 'top',
    accentBar: false, cornerFrame: true, showWatermark: false, darkClosing: false,
  },
  {
    id: 'literary-kai',
    name: '文艺楷体',
    description: '暖纸底 + 楷体大标题 + 砖红，柔软文艺',
    builtin: true,
    colors: { bg: '#f7efe2', ink: '#33271f', muted: '#7d6c5c', accent: '#a4513c', accentInk: '#f7efe2', line: 'rgba(51,39,31,.2)' },
    titleFont: 'kaiti', bodyFont: 'fangsong',
    kickerStyle: 'pill', highlightStyle: 'underline', numberStyle: 'big', coverAlign: 'top',
    accentBar: true, cornerFrame: false, showWatermark: true, darkClosing: true,
  },
  {
    id: 'calm-blue',
    name: '静谧蓝调',
    description: '雾蓝底 + 等线体 + 钴蓝，理性清爽',
    builtin: true,
    colors: { bg: '#eaf0f6', ink: '#16202c', muted: '#5f6b78', accent: '#2f6fed', accentInk: '#ffffff', line: 'rgba(22,32,44,.18)' },
    titleFont: 'dengxian', bodyFont: 'dengxian',
    kickerStyle: 'pill', highlightStyle: 'marker', numberStyle: 'circle', coverAlign: 'top',
    accentBar: true, cornerFrame: false, showWatermark: false, darkClosing: false,
  },
];

const BUILTIN_MAP = new Map(BUILTIN_STYLES.map((s) => [s.id, s]));

// ---------- 自定义风格库（data/xhs-styles.json） ----------

interface StyleFile {
  styles: CardStyle[];
}

function readCustom(): CardStyle[] {
  try {
    const raw = JSON.parse(fs.readFileSync(STYLE_FILE, 'utf8')) as StyleFile;
    return Array.isArray(raw.styles) ? raw.styles.map((s) => normalizeStyle(s, str(s.id, 40, 'custom'))) : [];
  } catch {
    return [];
  }
}

function writeCustom(styles: CardStyle[]): void {
  fs.mkdirSync(path.dirname(STYLE_FILE), { recursive: true });
  fs.writeFileSync(STYLE_FILE, JSON.stringify({ styles }, null, 2), 'utf8');
}

/** 全部风格（内置在前，自定义在后） */
export function listStyles(): CardStyle[] {
  return [...BUILTIN_STYLES, ...readCustom()];
}

/** 按 id 取风格；未知 id 回退默认 */
export function getStyle(id?: string): CardStyle {
  if (id) {
    const b = BUILTIN_MAP.get(id);
    if (b) return b;
    const c = readCustom().find((s) => s.id === id);
    if (c) return c;
  }
  return BUILTIN_MAP.get(DEFAULT_STYLE_ID)!;
}

/** 新增/更新自定义风格（id 不能占用内置）；返回保存后的风格 */
export function saveStyle(input: unknown): { ok: boolean; style?: CardStyle; error?: string } {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<CardStyle>;
  let id = str(p.id, 40, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) id = `custom-${Date.now().toString(36)}`;
  if (BUILTIN_MAP.has(id)) return { ok: false, error: '内置风格不可覆盖，请换个名字另存' };
  const style = normalizeStyle(input, id);
  style.id = id;
  const all = readCustom();
  const i = all.findIndex((s) => s.id === id);
  if (i >= 0) all[i] = style; else all.push(style);
  writeCustom(all);
  return { ok: true, style };
}

export function deleteStyle(id: string): boolean {
  if (BUILTIN_MAP.has(id)) return false;
  const all = readCustom();
  const next = all.filter((s) => s.id !== id);
  if (next.length === all.length) return false;
  writeCustom(next);
  return true;
}
