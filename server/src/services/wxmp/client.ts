// ============================================
// 微信公众号 API 客户端
// 凭据读 tools/wxmp/.env（不入 git）；access_token 进程内缓存，
// 提前于过期时间刷新；40001/42001 失效时强制重取一次。
// ============================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const API = 'https://api.weixin.qq.com';

function loadCredentials(): { appId: string; secret: string } {
  const path =
    process.env.WXMP_CREDENTIALS_PATH ||
    resolve(process.cwd(), '../../tools/wxmp/.env');
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
  return { appId: env.WXMP_APP_ID, secret: env.WXMP_APP_SECRET };
}

interface TokenState {
  token: string;
  expireAt: number;
}
let state: TokenState | null = null;

async function fetchToken(force = false): Promise<string> {
  if (!force && state && Date.now() < state.expireAt) return state.token;
  const { appId, secret } = loadCredentials();
  const res = await fetch(
    `${API}/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${secret}`
  );
  const j = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!j.access_token) {
    throw new Error(`取 access_token 失败 ${j.errcode}: ${j.errmsg}`);
  }
  // 提前 5 分钟过期，避免临界点失效
  state = { token: j.access_token, expireAt: Date.now() + (j.expires_in || 7200) * 1000 - 300_000 };
  return state.token;
}

/** 调 GET/POST JSON 接口；token 失效自动重取重试一次 */
export async function wxmpGet(path: string): Promise<any> {
  return call('GET', path, undefined, false);
}

export async function wxmpPostJson(path: string, body: unknown): Promise<any> {
  return call('POST', path, JSON.stringify(body), false);
}

/** multipart 表单上传（素材/图片） */
export async function wxmpPostForm(path: string, form: FormData): Promise<any> {
  return call('POST', path, form, true);
}

async function call(
  method: string,
  path: string,
  body: BodyInit | undefined,
  isForm: boolean,
  retried = false
): Promise<any> {
  const token = await fetchToken();
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API}${path}${sep}access_token=${token}`;
  const res = await fetch(url, {
    method,
    body,
    headers: isForm ? undefined : { 'content-type': 'application/json' },
  });
  const j = await res.json();
  // 40001/42001 = token 失效；强制刷新重试一次
  if (!retried && (j.errcode === 40001 || j.errcode === 42001)) {
    await fetchToken(true);
    return call(method, path, body, isForm, true);
  }
  return j;
}

export { fetchToken };
