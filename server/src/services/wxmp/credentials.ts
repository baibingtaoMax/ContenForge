// ============================================
// 公众号凭据管理：读 tools/wxmp/.env（不入 git），支持界面读写
// ============================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function getCredentialsPath(): string {
  return process.env.WXMP_CREDENTIALS_PATH || resolve(process.cwd(), '../../tools/wxmp/.env');
}

export interface WxmpCredentials {
  appId: string;
  appSecret: string;
}

/** 读原始凭据；文件不存在或缺字段时抛错 */
export function loadWxmpCredentials(): WxmpCredentials {
  const path = getCredentialsPath();
  const text = readFileSync(path, 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  if (!env.WXMP_APP_ID || !env.WXMP_APP_SECRET) {
    throw new Error('tools/wxmp/.env 缺少 WXMP_APP_ID / WXMP_APP_SECRET');
  }
  return { appId: env.WXMP_APP_ID, appSecret: env.WXMP_APP_SECRET };
}

export interface WxmpConfigStatus {
  configured: boolean;
  appId: string;
  /** secret 是否已配置（不回传明文） */
  hasSecret: boolean;
  credentialsPath: string;
}

/** 脱敏后的配置状态，供前端回显 */
export function getWxmpConfigStatus(): WxmpConfigStatus {
  try {
    const c = loadWxmpCredentials();
    return { configured: true, appId: c.appId, hasSecret: !!c.appSecret, credentialsPath: getCredentialsPath() };
  } catch {
    return { configured: false, appId: '', hasSecret: false, credentialsPath: getCredentialsPath() };
  }
}

/**
 * 更新凭据。undefined 字段保持不变；空字符串视为不修改。
 * 保留 .env 里其它键与注释，仅替换 WXMP_APP_ID / WXMP_APP_SECRET 两行。
 */
export function saveWxmpCredentials(patch: { appId?: string; appSecret?: string }): WxmpConfigStatus {
  const path = getCredentialsPath();
  let lines: string[] = [];
  if (existsSync(path)) lines = readFileSync(path, 'utf8').split(/\r?\n/);

  const next: Record<string, string> = {};
  try {
    const cur = loadWxmpCredentials();
    next.WXMP_APP_ID = cur.appId;
    next.WXMP_APP_SECRET = cur.appSecret;
  } catch {
    /* 现有文件不完整时以补丁为准 */
  }
  if (patch.appId && patch.appId.trim()) next.WXMP_APP_ID = patch.appId.trim();
  if (patch.appSecret && patch.appSecret.trim()) next.WXMP_APP_SECRET = patch.appSecret.trim();

  const seen = new Set<string>();
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    const i = t.indexOf('=');
    if (i <= 0) return line;
    const key = t.slice(0, i).trim();
    if (key === 'WXMP_APP_ID' || key === 'WXMP_APP_SECRET') {
      seen.add(key);
      return `${key}=${next[key]}`;
    }
    return line;
  });
  for (const key of ['WXMP_APP_ID', 'WXMP_APP_SECRET']) {
    if (!seen.has(key) && next[key]) out.push(`${key}=${next[key]}`);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out.join('\n'), { mode: 0o600 });
  return getWxmpConfigStatus();
}
