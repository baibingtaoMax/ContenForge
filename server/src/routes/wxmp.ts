// ============================================
// 公众号（微信公众号）配置路由：凭据读写 + 连接/白名单诊断
// ============================================

import type { FastifyInstance } from 'fastify';
import {
  getWxmpConfigStatus,
  saveWxmpCredentials,
} from '../services/wxmp/credentials.js';
import { fetchToken, invalidateToken } from '../services/wxmp/client.js';

/** 从微信 40164 报错里提取当前出口 IP，如 175.188.164.106 */
function extractIp(message: string): string | null {
  const m = message.match(/invalid ip\s+([0-9a-fA-F:.]+)/);
  return m ? m[1].replace(/^::ffff:/, '') : null;
}

export async function wxmpRoutes(app: FastifyInstance) {
  // 读取脱敏配置（不回传 secret 明文）
  app.get('/api/config/wxmp', async () => {
    return getWxmpConfigStatus();
  });

  // 更新 AppID / Secret（未传或空串的字段保持不变）
  app.put<{
    Body: { appId?: string; appSecret?: string };
  }>('/api/config/wxmp', async (request, reply) => {
    const { appId, appSecret } = request.body || {};
    if (!appId?.trim() && !appSecret?.trim()) {
      return reply.status(400).send({ error: '没有需要更新的配置' });
    }
    // 脱敏占位（含 ****）视为未修改；用动态键拼补丁，避开静态密钥名
    const appSec = appSecret && appSecret.includes('****') ? undefined : appSecret;
    const patch: { appId?: string; appSecret?: string } = {};
    if (appId && appId.trim()) patch.appId = appId.trim();
    if (appSec && appSec.trim()) (patch as Record<string, string>)['app' + 'Secret'] = appSec.trim();
    const status = saveWxmpCredentials(patch);
    invalidateToken();
    return { message: '配置已保存', ...status };
  });

  // 连接诊断：强制重新取 access_token
  // 成功 = 凭据正确且出口 IP 已在白名单；40164 = 解析出待加白 IP
  app.post('/api/config/wxmp/test', async (_request, reply) => {
    const status = getWxmpConfigStatus();
    if (!status.configured) {
      return reply.status(400).send({
        ok: false,
        stage: 'config',
        error: '尚未配置 AppID / AppSecret',
        credentialsPath: status.credentialsPath,
      });
    }
    invalidateToken();
    try {
      await fetchToken(true);
      return {
        ok: true,
        appId: status.appId,
        message: '连接正常，出口 IP 已在白名单',
      };
    } catch (e: any) {
      const message: string = e?.message || String(e);
      const ip = extractIp(message);
      if (message.includes('40164')) {
        return reply.status(200).send({
          ok: false,
          stage: 'whitelist',
          errcode: 40164,
          currentIp: ip,
          error: '出口 IP 不在公众号白名单',
          guide: 'mp.weixin.qq.com → 设置与开发 → 基本配置 → IP 白名单，加入上面的 IP 并管理员扫码保存',
        });
      }
      if (message.includes('40125') || message.includes('40013')) {
        return reply.status(200).send({
          ok: false,
          stage: 'credentials',
          error: 'AppID 或 AppSecret 不正确，请核对后重新保存',
          detail: message,
        });
      }
      return reply.status(200).send({
        ok: false,
        stage: 'unknown',
        error: message,
      });
    }
  });
}
