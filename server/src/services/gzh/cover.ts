// ============================================
// 公众号封面存档（每篇一张，可更换）
// --------------------------------------------
// 文件落 data/gzh-covers/<articleId>/cover-<ts>.<ext>；元信息存进该篇
// wechat 渠道版本 extra_json.cover。推草稿时从盘上读，无需每次手选文件。
// 与配图共用 withGzhLock，避免「设封面」与「生图/采用」并发互覆整份 extra。
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../config/index.js';
import {
  listChannelVersions,
  upsertChannelVersion,
  getArticle,
} from '../../store/contentStore.js';
import { withGzhLock } from './gzhLock.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** server/data */
const DATA_DIR = path.resolve(__dirname, '../../../data');
/** 封面落盘根目录：data/gzh-covers/<articleId>/cover-<ts>.<ext> */
const COVER_DIR = path.join(DATA_DIR, 'gzh-covers');

export interface CoverMeta {
  /** 相对 COVER_DIR 的 POSIX 路径：<articleId>/cover-<ts>.jpg */
  relPath: string;
  /** 后端可读的绝对 http 地址 */
  url: string;
  filename: string;
  bytes: number;
  contentType: string;
  createdAt: number;
}

function imageBaseUrl(): string {
  const port = getConfig().port || 3200;
  return `http://127.0.0.1:${port}/api/gzh-cover/`;
}

/** relPath → 绝对文件系统路径，强制限定在 COVER_DIR 内（防目录穿越） */
export function resolveCoverPath(relPath: string): string | null {
  const normalized = path.normalize(relPath).replace(/^([/\\])+/, '');
  const abs = path.join(COVER_DIR, normalized);
  if (!abs.startsWith(COVER_DIR)) return null;
  return abs;
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

/** 读这篇已存封面的元信息（无则 null） */
export function getCover(articleId: string): CoverMeta | null {
  const c = readExtra(articleId).cover;
  return c && typeof c === 'object' ? (c as CoverMeta) : null;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * 保存（覆盖）这篇的封面：落盘新文件、删除旧文件、更新 extra.cover。
 * 串行化；返回新封面元信息。
 */
export function saveCover(
  articleId: string,
  input: { data: Buffer; contentType: string; filename?: string }
): Promise<CoverMeta> {
  return withGzhLock(articleId, () => {
    const contentType = (input.contentType || 'image/jpeg').split(';')[0].trim();
    const ext = EXT_BY_TYPE[contentType]
      || (input.filename?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4))
      || 'jpg';
    const dir = path.join(COVER_DIR, articleId);
    fs.mkdirSync(dir, { recursive: true });

    // 删旧封面文件（一篇只留一张）
    const old = readExtra(articleId).cover as CoverMeta | undefined;
    if (old?.relPath) {
      const oldAbs = resolveCoverPath(old.relPath);
      if (oldAbs && fs.existsSync(oldAbs)) {
        try { fs.unlinkSync(oldAbs); } catch { /* ignore */ }
      }
    }

    const file = `cover-${Date.now()}.${ext}`;
    const abs = path.join(dir, file);
    fs.writeFileSync(abs, input.data);
    const relPath = `${articleId}/${file}`;
    const meta: CoverMeta = {
      relPath,
      url: imageBaseUrl() + relPath,
      filename: input.filename || file,
      bytes: input.data.length,
      contentType,
      createdAt: Date.now(),
    };

    const extra = readExtra(articleId);
    extra.cover = meta;
    writeExtra(articleId, extra);
    return meta;
  });
}

/** 删除封面（文件 + extra.cover） */
export function deleteCover(articleId: string): Promise<boolean> {
  return withGzhLock(articleId, () => {
    const extra = readExtra(articleId);
    const old = extra.cover as CoverMeta | undefined;
    if (!old) return false;
    if (old.relPath) {
      const abs = resolveCoverPath(old.relPath);
      if (abs && fs.existsSync(abs)) {
        try { fs.unlinkSync(abs); } catch { /* ignore */ }
      }
    }
    delete extra.cover;
    writeExtra(articleId, extra);
    return true;
  });
}

/** 取已存封面文件的字节与类型（供推草稿上传永久素材）；无封面返回 null */
export function readCoverFile(articleId: string): { data: Buffer; contentType: string; filename: string } | null {
  const meta = getCover(articleId);
  if (!meta) return null;
  const abs = resolveCoverPath(meta.relPath);
  if (!abs || !fs.existsSync(abs)) return null;
  return {
    data: fs.readFileSync(abs),
    contentType: meta.contentType || 'image/jpeg',
    filename: meta.filename || path.basename(abs),
  };
}
