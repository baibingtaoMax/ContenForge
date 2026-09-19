// ============================================
// 附件路由：上传（自动提取文本+打标签）、列表、下载、删除
// ============================================

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import {
  addAttachment,
  listAttachments,
  listAttachmentsByConversation,
  getAttachment,
  getConversation,
  listConversations,
  listRequirements,
} from '../store/database.js';
import { inferCategoryFromFilename, CATEGORY_LABELS } from '../services/classifier.js';
import { fetchWebPage } from '../services/webFetch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_ROOT = path.resolve(__dirname, '../../data/uploads');

/** 单文件大小上限 50MB */
const MAX_SIZE = 50 * 1024 * 1024;

/** 附件元数据（返回给前端，不含全文） */
function attachmentMeta(
  a: Awaited<ReturnType<typeof getAttachment>> & object,
  convTitleMap?: Map<string, string>,
) {
  return {
    id: a.id,
    filename: a.filename,
    category: a.category,
    categoryLabel: CATEGORY_LABELS[a.category] || a.category,
    summary: a.summary,
    sizeBytes: a.size_bytes,
    mimeType: a.mime_type,
    sourceUrl: (a as { source_url?: string | null }).source_url || null,
    conversationId: a.conversation_id || null,
    conversationTitle: a.conversation_id ? (convTitleMap?.get(a.conversation_id) || null) : null,
    uploader: a.uploader || null,
    createdAt: a.created_at,
  };
}

/** 找引用了某附件（内嵌图 id）的需求文档 */
function referencingRequirements(projectId: string, attachmentIds: string[]) {
  if (attachmentIds.length === 0) return new Map<string, Array<{ id: string; title: string; kind: string }>>();
  const result = new Map<string, Array<{ id: string; title: string; kind: string }>>();
  const reqs = listRequirements(projectId, { includeIdeas: true });
  for (const aId of attachmentIds) {
    const hits = reqs
      .filter((r) => String(r.doc_md || '').includes(aId))
      .map((r) => ({ id: r.id, title: r.title, kind: r.kind }));
    if (hits.length) result.set(aId, hits);
  }
  return result;
}

export async function attachmentRoutes(app: FastifyInstance) {
  // 通用上传处理：写入磁盘 + 落库
  async function saveAttachment(
    source: AsyncIterable<Uint8Array> | any,
    filename: string,
    mimetype: string,
    scope: { projectId?: string | null; conversationId?: string | null },
    categoryOverride?: string
  ) {
    const scopeId = scope.projectId || scope.conversationId || 'unassigned';
    const scopeDir = path.join(UPLOAD_ROOT, scope.projectId ? `p_${scope.projectId}` : `c_${scope.conversationId || 'unassigned'}`);
    await fs.mkdir(scopeDir, { recursive: true });

    const safeName = filename.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
    const storedName = `${Date.now()}_${randomUUID()}_${safeName}`;
    const storedPath = path.join(scopeDir, storedName);

    let size = 0;
    const limitStream = async function* (s: any) {
      for await (const chunk of s) {
        size += chunk.length;
        if (size > MAX_SIZE) {
          throw Object.assign(new Error('文件超过 50MB 限制'), { code: 'FILE_TOO_LARGE' });
        }
        yield chunk;
      }
    };

    try {
      await pipeline(limitStream(source), createWriteStream(storedPath));
    } catch (e: any) {
      await fs.rm(storedPath, { force: true });
      if (e.code === 'FILE_TOO_LARGE') {
        const err: any = new Error('文件超过 50MB 限制');
        err.statusCode = 413;
        throw err;
      }
      throw e;
    }

    // embed=文档内嵌图（markdown 编辑器粘贴），不参与文件名推断，独立分类
    const category = categoryOverride || inferCategoryFromFilename(filename);
    const id = randomUUID();
    addAttachment({
      id,
      project_id: scope.projectId || null,
      conversation_id: scope.conversationId || null,
      filename,
      stored_path: storedPath,
      mime_type: mimetype,
      size_bytes: size,
      category,
      summary: '',
      extracted_text: '',
    });

    return {
      id, filename, category,
      categoryLabel: CATEGORY_LABELS[category],
      summary: '', sizeBytes: size, mimeType: mimetype,
    };
  }

  // 对话级上传（主入口：游离对话直接传，不建项目）
  app.post<{ Params: { conversationId: string } }>(
    '/api/conversations/:conversationId/attachments',
    async (request, reply) => {
      const conversation = getConversation(request.params.conversationId);
      if (!conversation) return reply.status(404).send({ error: '对话不存在' });
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: '未收到文件' });
      const result = await saveAttachment(
        data.file, data.filename, data.mimetype,
        { projectId: conversation.project_id, conversationId: conversation.id }
      );
      return result;
    }
  );

  // 网页快照附件：贴链接时前端调用，抓取正文落库为 webpage 附件
  app.post<{ Params: { conversationId: string }; Body: { url?: string } }>(
    '/api/conversations/:conversationId/web-attachments',
    async (request, reply) => {
      const conversation = getConversation(request.params.conversationId);
      if (!conversation) return reply.status(404).send({ error: '对话不存在' });
      const rawUrl = String(request.body?.url || '').trim();
      if (!rawUrl) return reply.status(400).send({ error: '缺少 url' });

      const page = await fetchWebPage(rawUrl);
      if (page.error) {
        return reply.status(422).send({ error: page.error, url: page.url });
      }

      const id = randomUUID();
      const filename = page.title ? page.title.slice(0, 80) : page.url;
      addAttachment({
        id,
        project_id: conversation.project_id || null,
        conversation_id: conversation.id,
        filename,
        stored_path: '', // 网页快照无本地文件
        mime_type: 'text/html',
        size_bytes: Buffer.byteLength(page.markdown, 'utf-8'),
        category: 'webpage',
        summary: page.url,
        extracted_text: `【网页快照】${page.title}\n链接：${page.url}\n抓取时间：${new Date().toLocaleString('zh-CN')}\n\n${page.markdown}`,
        source_url: page.url,
      });

      return {
        id, filename, category: 'webpage',
        categoryLabel: CATEGORY_LABELS.webpage,
        summary: page.url, sizeBytes: Buffer.byteLength(page.markdown, 'utf-8'),
        mimeType: 'text/html', sourceUrl: page.url,
      };
    }
  );

  // 项目级上传（兼容/文件柜直接传）。?embed=1 = markdown 文档内嵌图
  app.post<{ Params: { projectId: string }; Querystring: { embed?: string } }>(
    '/api/projects/:projectId/attachments',
    async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ error: '未收到文件' });
      const isEmbed = request.query.embed === '1';
      if (isEmbed && !data.mimetype.startsWith('image/')) {
        // 消费并丢弃上传体，避免连接悬挂
        await data.file.resume?.();
        return reply.status(400).send({ error: '内嵌资源只支持图片' });
      }
      return saveAttachment(
        data.file, data.filename, data.mimetype,
        { projectId: request.params.projectId },
        isEmbed ? 'embed' : undefined
      );
    }
  );

  // 对话附件列表
  app.get<{ Params: { conversationId: string } }>(
    '/api/conversations/:conversationId/attachments',
    async (request) => {
      const rows = listAttachmentsByConversation(request.params.conversationId);
      return { attachments: rows.map((a) => attachmentMeta(a)) };
    }
  );

  // 项目附件列表（附件中心）。默认返回全部（含文档内嵌图），引用状态一并给出；
  // 兼容旧调用：?include=embed 行为相同，?include=noembed 不含内嵌图
  app.get<{ Params: { projectId: string }; Querystring: { include?: string } }>(
    '/api/projects/:projectId/attachments',
    async (request) => {
      const all = listAttachments(request.params.projectId);
      const noEmbed = request.query.include === 'noembed';
      const rows = noEmbed ? all.filter((a) => a.category !== 'embed') : all;
      const convTitleMap = new Map(
        listConversations(request.params.projectId).map((c) => [c.id, c.title])
      );
      // 内嵌图：扫一遍项目需求文档，标出是否还被引用（孤儿图可清理）
      const docs = listRequirements(request.params.projectId, { includeIdeas: true })
        .map((r) => String(r.doc_md || '')).join('\n');
      return {
        attachments: rows.map((a) => ({
          ...attachmentMeta(a, convTitleMap),
          referenced: a.category === 'embed' ? docs.includes(a.id) : undefined,
        })),
        embedCount: all.filter((a) => a.category === 'embed').length,
      };
    }
  );

  // 单附件详情：提取文本 + 被哪些需求文档引用（附件中心抽屉用）
  app.get<{ Params: { id: string } }>(
    '/api/attachments/:id/detail',
    async (request, reply) => {
      const row = getAttachment(request.params.id);
      if (!row) return reply.status(404).send({ error: '附件不存在' });
      let conversationTitle: string | null = null;
      if (row.conversation_id) {
        conversationTitle = getConversation(row.conversation_id)?.title || null;
      }
      const referencedBy = row.project_id
        ? (referencingRequirements(row.project_id, [row.id]).get(row.id) || [])
        : [];
      return {
        ...attachmentMeta(row, undefined),
        conversationTitle,
        extractedText: row.extracted_text || '',
        referencedBy,
      };
    }
  );

  // 下载原始文件（?inline=1 时以 inline 返回，供 markdown 内嵌图片 <img> 渲染）
  app.get<{ Params: { id: string }; Querystring: { inline?: string } }>(
    '/api/attachments/:id/download',
    async (request, reply) => {
      const row = getAttachment(request.params.id);
      if (!row) return reply.status(404).send({ error: '附件不存在' });
      // 网页快照无本地文件：跳转到原始链接
      if (row.category === 'webpage' || !row.stored_path) {
        const url = (row as { source_url?: string | null }).source_url;
        if (url) return reply.redirect(url);
        return reply.status(404).send({ error: '该网页快照没有可下载文件' });
      }
      const disposition = request.query.inline === '1' ? 'inline' : 'attachment';
      return reply.type(row.mime_type).header(
        'Content-Disposition',
        `${disposition}; filename*=UTF-8''${encodeURIComponent(row.filename)}`
      ).send(await import('node:fs/promises').then((fs) => fs.readFile(row.stored_path)));
    }
  );

  // 改附件分类（附件中心手动纠正）
  app.patch<{ Params: { id: string }; Body: { category?: string } }>(
    '/api/attachments/:id',
    async (request, reply) => {
      const row = getAttachment(request.params.id);
      if (!row) return reply.status(404).send({ error: '附件不存在' });
      const category = String(request.body?.category || '').trim();
      if (!category || !CATEGORY_LABELS[category]) {
        return reply.status(400).send({ error: '无效的分类' });
      }
      const { updateAttachmentClassification } = await import('../store/database.js');
      updateAttachmentClassification(request.params.id, category, row.summary || '');
      return { ok: true };
    }
  );

  // 删除附件
  app.delete<{ Params: { id: string } }>(
    '/api/attachments/:id',
    async (request, reply) => {
      const row = getAttachment(request.params.id);
      if (!row) return reply.status(404).send({ error: '附件不存在' });
      // 网页快照无本地文件，跳过磁盘删除
      if (row.stored_path) await fs.rm(row.stored_path, { force: true });
      const { getDb } = await import('../store/database.js');
      getDb().prepare('DELETE FROM attachments WHERE id=?').run(request.params.id);
      return { ok: true };
    }
  );
}
