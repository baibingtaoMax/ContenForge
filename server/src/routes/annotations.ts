// ============================================
// 原型标注（ProtoForge）
// 原型站点上贴的意见：创建 / 列表 / 解决 / 重开 / 删除
// ============================================

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getProject,
  createAnnotation,
  listAnnotations,
  resolveAnnotation,
  reopenAnnotation,
  updateAnnotationContent,
  deleteAnnotation,
  getAnnotation,
} from '../store/database.js';
import { syncRequirementsFromAnnotations } from '../services/requirementSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANNOT_UPLOAD_ROOT = path.resolve(__dirname, '../../data/uploads/annotations');
const ANNOT_IMG_MAX = 10 * 1024 * 1024; // 单图 10MB
const ANNOT_IMG_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// 需求同步项目级锁
const syncLocks = new Set<string>();

export async function annotationRoutes(app: FastifyInstance) {
  // 列出项目下全部标注（?open=1 只看待处理）
  app.get<{ Params: { projectId: string }; Querystring: { open?: string } }>(
    '/api/projects/:projectId/annotations',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      return { annotations: listAnnotations(projectId, request.query.open === '1') };
    }
  );

  // 评审意见附图上传（multipart，字段名 file；存 data/uploads/annotations/p_<projectId>/）
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/annotation-images', async (request, reply) => {
    const { projectId } = request.params;
    if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: '缺少上传文件' });
    const mime = (data.mimetype || '').toLowerCase();
    if (!ANNOT_IMG_TYPES.has(mime)) return reply.status(400).send({ error: '只支持 png/jpeg/webp/gif 图片' });
    const dir = path.join(ANNOT_UPLOAD_ROOT, `p_${projectId}`);
    await fs.mkdir(dir, { recursive: true });
    const ext = (data.filename?.match(/\.(png|jpe?g|webp|gif)$/i)?.[0] || `.${mime.split('/')[1]}`).replace('jpeg', 'jpg');
    const storedName = `${Date.now()}_${randomUUID()}${ext}`;
    const storedPath = path.join(dir, storedName);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of data.file as any) {
      size += chunk.length;
      if (size > ANNOT_IMG_MAX) return reply.status(413).send({ error: '图片超过 10MB 限制' });
      chunks.push(chunk);
    }
    await fs.writeFile(storedPath, Buffer.concat(chunks));
    return { url: `/api/projects/${projectId}/annotation-images/${storedName}`, name: data.filename || storedName, size, mime };
  });

  // 评审附图读取（inline，供原型内 <img> 显示）
  app.get<{ Params: { projectId: string; file: string } }>(
    '/api/projects/:projectId/annotation-images/:file',
    async (request, reply) => {
      const { projectId, file } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      // 防路径穿越：只允许生成的文件名
      if (!/^\d+_[A-Za-z0-9-]+\.(png|jpg|jpeg|webp|gif)$/.test(file)) return reply.status(400).send({ error: '非法文件名' });
      const storedPath = path.join(ANNOT_UPLOAD_ROOT, `p_${projectId}`, file);
      const buf = await fs.readFile(storedPath).catch(() => null);
      if (!buf) return reply.status(404).send({ error: '图片不存在' });
      const mime = file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg'
        : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.gif') ? 'image/gif' : 'image/png';
      return reply.type(mime).header('Content-Disposition', 'inline').send(buf);
    }
  );

  // 贴一条标注
  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/annotations',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      const body = (request.body || {}) as {
        pageId?: string;
        pageTitle?: string;
        targetKind?: string;
        targetLabel?: string;
        targetPath?: string;
        content?: string;
        author?: string;
        images?: Array<{ url: string; name?: string; size?: number; mime?: string }>;
      };
      if (!body.pageId?.trim()) return reply.status(400).send({ error: '缺少 pageId' });
      if (!body.content?.trim()) return reply.status(400).send({ error: '请用一句话说明这张图要怎么改' });
      const images = (Array.isArray(body.images) ? body.images : [])
        .filter((im) => im && typeof im.url === 'string' && im.url.startsWith('/api/projects/'))
        .slice(0, 6)
        .map((im) => ({ url: im.url, name: im.name || '', size: im.size || 0, mime: im.mime || 'image/png' }));
      const ann = createAnnotation({
        id: crypto.randomUUID(),
        projectId,
        pageId: body.pageId.trim(),
        pageTitle: body.pageTitle || '',
        targetKind: body.targetKind || 'page',
        targetLabel: body.targetLabel || '',
        targetPath: body.targetPath || '',
        content: body.content?.trim() || '（附图意见）',
        author: (body.author || '').trim(),
        images,
      });
      return ann;
    }
  );

  // 把业务类意见同步进需求文档（无头：原型站点可直接触发，不经过对话）
  app.post<{ Params: { projectId: string }; Body: { annotationIds?: string[] } }>(
    '/api/projects/:projectId/annotations/sync-requirements',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      if (syncLocks.has(projectId)) return reply.status(409).send({ error: '正在同步需求文档，请稍候' });
      syncLocks.add(projectId);
      try {
        // 默认处理该项目所有 needs_req 的待同步意见
        let ids = Array.isArray(request.body?.annotationIds) ? request.body!.annotationIds! : [];
        if (ids.length === 0) {
          ids = listAnnotations(projectId)
            .filter((a) => a.needs_req && a.status === 'open')
            .map((a) => a.id);
        }
        if (ids.length === 0) return reply.status(400).send({ error: '没有待同步的业务意见' });
        const result = await syncRequirementsFromAnnotations(projectId, ids);
        if (!result.ok) return reply.status(400).send({ error: result.error });
        return {
          ok: true,
          revised: result.revised,
          created: result.created,
          answer: result.answer,
        };
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        syncLocks.delete(projectId);
      }
    }
  );

  // 标记已解决
  app.post<{ Params: { id: string } }>('/api/annotations/:id/resolve', async (request, reply) => {
    const ann = resolveAnnotation(request.params.id);
    if (!ann) return reply.status(404).send({ error: '标注不存在' });
    return ann;
  });

  // 重新打开
  app.post<{ Params: { id: string } }>('/api/annotations/:id/reopen', async (request, reply) => {
    if (!getAnnotation(request.params.id)) return reply.status(404).send({ error: '标注不存在' });
    return reopenAnnotation(request.params.id);
  });

  // 编辑意见内容（只改文字/称呼，不动圈选定位）
  app.patch<{ Params: { id: string }; Body: { content?: string; author?: string } }>(
    '/api/annotations/:id',
    async (request, reply) => {
      const existing = getAnnotation(request.params.id);
      if (!existing) return reply.status(404).send({ error: '标注不存在' });
      const { content, author } = request.body || {};
      if (!content || !content.trim()) return reply.status(400).send({ error: '意见内容不能为空' });
      return updateAnnotationContent(request.params.id, content, author);
    }
  );

  // 删除
  app.delete<{ Params: { id: string } }>('/api/annotations/:id', async (request, reply) => {
    if (!getAnnotation(request.params.id)) return reply.status(404).send({ error: '标注不存在' });
    deleteAnnotation(request.params.id);
    return { ok: true };
  });
}
