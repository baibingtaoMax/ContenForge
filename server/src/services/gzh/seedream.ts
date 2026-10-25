// ============================================
// Seedream 5.0 Pro 生图（火山方舟 plan 网关，OpenAI 兼容 /images/generations）
// 逐条手动触发：一次一张。返回的 TOS 签名链只活 24h，必须当场下载落本地。
// 参数按官方 byted-ark-seedream-skill 校准（2026-10-14）：
//   Pro 普通文生图 size 支持 1K/1.5K/2K 或 宽x高（总像素 921600–4624220、宽高比 1/16–16）；
//   1920x1080=2073600 像素、16:9，合法。response_format 固定 url，output_format jpeg。
// ============================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/** server/data */
export const DATA_DIR = path.resolve(__dirname, '../../../data');
/** 正文配图落盘根目录：data/gzh-images/<articleId>/<shotId>/<ts>.jpg */
export const GZH_IMG_DIR = path.join(DATA_DIR, 'gzh-images');

export const SEEDREAM_MODEL = 'doubao-seedream-5.0-pro';
export const SEEDREAM_SIZE = '1920x1080';

export interface GeneratedImage {
  /** 相对 GZH_IMG_DIR 的 POSIX 相对路径，如 <aid>/<sid>/1728....jpg */
  relPath: string;
  /** 本地绝对路径 */
  absPath: string;
  /** 后端可访问的绝对 http 地址（推草稿时由 draft 当外链 fetch 转 mp 素材） */
  url: string;
  bytes: number;
  width: number;
  height: number;
  createdAt: number;
}

/** 生图结果元信息（存进 shot.candidates） */
export type ShotCandidate = Omit<GeneratedImage, 'absPath'>;

/** 从 config.port 拼本机图片基址（服务端推草稿时要 fetch 绝对地址） */
export function imageBaseUrl(): string {
  const port = getConfig().port || 3200;
  return `http://127.0.0.1:${port}/api/gzh-img/`;
}

/** relPath → 绝对文件系统路径，并强制限定在 GZH_IMG_DIR 内（防目录穿越） */
export function resolveImagePath(relPath: string): string | null {
  const normalized = path.normalize(relPath).replace(/^([/\\])+/, '');
  const abs = path.join(GZH_IMG_DIR, normalized);
  if (!abs.startsWith(GZH_IMG_DIR)) return null;
  return abs;
}

/** relPath → 可访问绝对 URL */
export function relPathToUrl(relPath: string): string {
  return imageBaseUrl() + relPath.split(path.sep).join('/');
}

/** 从 JPEG 字节里读宽高（只解析 SOF0~SOF15 标记，够本项目用） */
function jpegSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { width: 0, height: 0 };
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    // SOF0..SOF15（除 DHT=C4、DAC=CC、SOI/EOI/RSTn 外的帧标记）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return { width: 0, height: 0 };
}

/** 上游错误是否为内容审核拦截（prompt 含敏感词，400 The request failed because the input text may contain sensitive information） */
export function isSensitivePromptError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /sensitive information|sensitive content|敏感|内容安全|内容审核|审核未通过/i.test(msg);
}

/**
 * 调一次 seedream 生图，只负责拿到 JPEG 字节与像素尺寸（不落盘）。
 * 封面背景要用近正方/横长等不同比例，故 size 由调用方传入。
 * 失败抛 Error（含上游错误体）。
 */
export async function generateSeedreamBytes(
  prompt: string,
  size: string = SEEDREAM_SIZE,
  watermark = true
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const cfg = getConfig();
  const base = cfg.llm.baseUrl.replace(/\/+$/, '');
  const url = `${base}/images/generations`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: SEEDREAM_MODEL,
      prompt,
      size,
      response_format: 'url',
      output_format: 'jpeg',
      watermark,
    }),
  });

  const raw = await resp.text();
  let json: any;
  try { json = JSON.parse(raw); } catch { json = null; }
  if (!resp.ok) {
    const msg = json?.error?.message || json?.message || raw.slice(0, 300);
    throw new Error(`seedream ${resp.status}: ${msg}`);
  }
  const imgUrl: string | undefined = json?.data?.[0]?.url;
  if (!imgUrl) throw new Error(`seedream 未返回图片 URL：${raw.slice(0, 300)}`);

  // TOS 签名链只活 24h，当场下载成字节
  const dl = await fetch(imgUrl);
  if (!dl.ok) throw new Error(`下载生图失败 ${dl.status}`);
  const buffer = Buffer.from(await dl.arrayBuffer());
  const { width, height } = jpegSize(buffer);
  return { buffer, width, height };
}

/**
 * 调一次 seedream 生图并落本地（正文配图用，固定 16:9）。逐条手动调用，不自动重试。
 * @returns 候选图信息；失败抛 Error（含上游错误体）
 */
export async function generateSeedreamImage(params: {
  articleId: string;
  shotId: string;
  prompt: string;
  watermark?: boolean;
}): Promise<GeneratedImage> {
  const { articleId, shotId, prompt, watermark = true } = params;
  const { buffer: buf, width, height } = await generateSeedreamBytes(prompt, SEEDREAM_SIZE, watermark);

  const dir = path.join(GZH_IMG_DIR, articleId, shotId);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${Date.now()}.jpg`;
  const abs = path.join(dir, file);
  fs.writeFileSync(abs, buf);

  const relPath = [articleId, shotId, file].join('/');
  return {
    relPath,
    absPath: abs,
    url: relPathToUrl(relPath),
    bytes: buf.length,
    width,
    height,
    createdAt: Date.now(),
  };
}
