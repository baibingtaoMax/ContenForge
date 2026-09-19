// ============================================
// 站外标注（链路验证版）
// Chrome 扩展/书签注入器在任意真实站点上贴的意见，按 project + page_url 存储
// 注入脚本托管在 GET /inject/annotator.js，bookmarklet 引它即可
// ============================================

import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getProject,
  createAnnotation,
  listExternalAnnotations,
  upsertExternalCapture,
  listExternalCaptures,
  getExternalCapture,
} from '../store/database.js';
import { rebuildFromCapture } from '../services/externalRebuild.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ExternalBody {
  projectId?: string;
  pageUrl?: string;
  pageTitle?: string;
  targetKind?: string;
  targetLabel?: string;
  targetPath?: string;
  content?: string;
  author?: string;
}

export async function externalRoutes(app: FastifyInstance) {
  // 贴一条站外意见
  app.post('/api/external/annotations', async (request, reply) => {
    const body = (request.body || {}) as ExternalBody;
    if (!body.projectId || !getProject(body.projectId)) {
      return reply.status(400).send({ error: '项目不存在或缺少 projectId' });
    }
    if (!body.pageUrl?.trim()) return reply.status(400).send({ error: '缺少 pageUrl' });
    if (!body.content?.trim()) return reply.status(400).send({ error: '意见内容不能为空' });

    // 规范化 URL：去掉 hash（站内侧内锚点不影响页面身份）
    let url = body.pageUrl.trim();
    try {
      const u = new URL(url);
      url = u.origin + u.pathname + u.search;
    } catch {
      return reply.status(400).send({ error: 'pageUrl 不是合法 URL' });
    }

    const ann = createAnnotation({
      id: crypto.randomUUID(),
      projectId: body.projectId,
      pageId: 'external', // 站外行不绑 spec page
      pageTitle: body.pageTitle || '',
      targetKind: body.targetKind || 'element',
      targetLabel: body.targetLabel || '',
      targetPath: body.targetPath || '',
      content: body.content.trim(),
      author: (body.author || '').trim(),
      pageUrl: url,
      origin: 'extension',
    });
    return ann;
  });

  // 拉某页的站外意见
  app.get<{ Querystring: { projectId?: string; url?: string; open?: string } }>(
    '/api/external/annotations',
    async (request, reply) => {
      const { projectId, url, open } = request.query;
      if (!projectId || !getProject(projectId)) {
        return reply.status(400).send({ error: '项目不存在或缺少 projectId' });
      }
      if (!url) return reply.status(400).send({ error: '缺少 url' });
      const annotations = listExternalAnnotations(projectId, url, open === '1');
      return { annotations };
    }
  );

  // 上报页面采集包（渲染后精简 DOM）。阶段一：只存储，供重建使用
  app.post('/api/external/collect', async (request, reply) => {
    const body = (request.body || {}) as {
      projectId?: string;
      pageUrl?: string;
      pageTitle?: string;
      viewport?: { w?: number; h?: number };
      nodeCount?: number;
      truncated?: boolean;
      domHtml?: string;
      layoutHint?: string;
      visualSpec?: any;
    };
    if (!body.projectId || !getProject(body.projectId)) {
      return reply.status(400).send({ error: '项目不存在或缺少 projectId' });
    }
    if (!body.pageUrl?.trim()) return reply.status(400).send({ error: '缺少 pageUrl' });
    if (!body.domHtml || body.domHtml.length < 50) {
      return reply.status(400).send({ error: '采集内容为空' });
    }
    let url = body.pageUrl.trim();
    try {
      const u = new URL(url);
      url = u.origin + u.pathname + u.search;
    } catch {
      return reply.status(400).send({ error: 'pageUrl 不是合法 URL' });
    }
    const cap = upsertExternalCapture({
      projectId: body.projectId,
      pageUrl: url,
      pageTitle: body.pageTitle || '',
      viewport: body.viewport ? `${body.viewport.w || 0}x${body.viewport.h || 0}` : '',
      nodeCount: body.nodeCount || 0,
      truncated: !!body.truncated,
      domHtml: body.domHtml,
      layoutHint: body.layoutHint,
      visualSpec: body.visualSpec,
    });
    // TODO（下一步）：触发重建 pipeline（DOM+样式+该页意见 → PF 原生页）
    // 异步触发重建，不阻塞采集响应
    void rebuildFromCapture(cap.id).catch((e) => {
      console.error('[外部重建] 后台失败：', e);
    });
    return {
      id: cap.id,
      nodeCount: cap.node_count,
      truncated: !!cap.truncated,
      status: 'rebuilding',
      domLength: body.domHtml.length,
      hasVisualSpec: !!(body.visualSpec && Object.keys(body.visualSpec).length),
    };
  });

  // 采集包列表（不回传大字段 dom_html）
  app.get<{ Querystring: { projectId?: string } }>(
    '/api/external/captures',
    async (request, reply) => {
      const { projectId } = request.query;
      if (!projectId || !getProject(projectId)) {
        return reply.status(400).send({ error: '项目不存在或缺少 projectId' });
      }
      return { captures: listExternalCaptures(projectId) };
    }
  );

  // 单个采集包状态/详情（含重建状态，不回传大 dom）
  app.get<{ Params: { id: string } }>('/api/external/captures/:id', async (request, reply) => {
    const cap = getExternalCapture(request.params.id);
    if (!cap) return reply.status(404).send({ error: '采集包不存在' });
    const { dom_html, ...meta } = cap;
    return { capture: { ...meta, domLength: dom_html?.length || 0 } };
  });

  // 手动触发重建
  app.post<{ Params: { id: string } }>('/api/external/captures/:id/rebuild', async (request, reply) => {
    const cap = getExternalCapture(request.params.id);
    if (!cap) return reply.status(404).send({ error: '采集包不存在' });
    void rebuildFromCapture(cap.id).catch(() => {});
    return { ok: true, status: 'rebuilding' };
  });

  // 注入脚本（bookmarklet/扩展共用的验证版）
  app.get('/inject/annotator.js', async (_request, reply) => {
    const js = readFileSync(join(__dirname, '..', 'assets', 'external-annotator.js'), 'utf-8');
    reply.header('content-type', 'application/javascript; charset=utf-8');
    reply.header('cache-control', 'no-store');
    return reply.send(js);
  });
}
