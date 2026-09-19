// ============================================
// ContentForge 内容业务路由
// 推广主体档案 / 系列 / 文章 / 渠道版本 / 发布记录
// ============================================

import type { FastifyInstance } from 'fastify';
import {
  getProject,
  getDb,
} from '../store/database.js';
import {
  getSubjectType,
  getSubjectProfile,
  updateSubject,
  type SubjectType,
  type SubjectProfile,
  createSeries,
  listSeries,
  getSeries,
  updateSeries,
  deleteSeries,
  createArticle,
  batchCreateArticles,
  listArticles,
  getArticle,
  updateArticle,
  deleteArticle,
  listChannelVersions,
  upsertChannelVersion,
  type ChannelKey,
  type ArticleStatus,
  listPublishes,
  listPublishesByArticle,
  createPublish,
  updatePublish,
  deletePublish,
} from '../store/contentStore.js';
import {
  listKits,
  getKit,
  createKit,
  updateKit,
  deleteKit,
  duplicateKit,
  mountKit,
  type WritingKitInput,
} from '../store/writingKitStore.js';

const CHANNELS: ChannelKey[] = ['wechat', 'xhs', 'markdown'];

export async function contentRoutes(app: FastifyInstance) {
  // ---------- 推广主体档案 ----------
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/subject',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) return reply.status(404).send({ error: '主体不存在' });
      const row = getDb()
        .prepare('SELECT kit_id FROM projects WHERE id=?')
        .get(request.params.projectId) as { kit_id: string | null } | undefined;
      return {
        subjectType: getSubjectType(request.params.projectId),
        profile: getSubjectProfile(request.params.projectId),
        kitId: row?.kit_id || null,
      };
    }
  );

  app.put<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/subject',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) return reply.status(404).send({ error: '主体不存在' });
      const body = (request.body || {}) as {
        subjectType?: SubjectType;
        profile?: SubjectProfile;
        kitId?: string | null;
      };
      updateSubject(request.params.projectId, {
        subjectType: body.subjectType,
        profile: body.profile,
      });
      if (typeof body.kitId === 'string' || body.kitId === null) {
        mountKit(request.params.projectId, body.kitId || null);
      }
      return { ok: true };
    }
  );

  // ---------- 系列 ----------
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/series',
    async (request) => listSeries(request.params.projectId)
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/series',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) return reply.status(404).send({ error: '主体不存在' });
      const { title, description = '' } = (request.body || {}) as { title?: string; description?: string };
      if (!title?.trim()) return reply.status(400).send({ error: '系列名称必填' });
      return createSeries(request.params.projectId, title.trim(), description);
    }
  );

  app.put<{ Params: { sid: string } }>('/api/series/:sid', async (request, reply) => {
    if (!getSeries(request.params.sid)) return reply.status(404).send({ error: '系列不存在' });
    const { title, description } = (request.body || {}) as { title?: string; description?: string };
    return updateSeries(request.params.sid, { title, description });
  });

  app.delete<{ Params: { sid: string } }>('/api/series/:sid', async (request, reply) => {
    if (!getSeries(request.params.sid)) return reply.status(404).send({ error: '系列不存在' });
    deleteSeries(request.params.sid);
    return { ok: true };
  });

  // ---------- 文章 ----------
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/articles',
    async (request) => {
      const articles = listArticles(request.params.projectId);
      const versions = listChannelVersionsByProject(getDb(), request.params.projectId);
      return articles.map((a) => ({
        ...a,
        channels: versions.filter((v) => v.article_id === a.id).map((v) => v.channel),
      }));
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/articles',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) return reply.status(404).send({ error: '主体不存在' });
      const body = (request.body || {}) as {
        title?: string;
        angle?: string;
        seriesId?: string | null;
        docMd?: string;
        status?: ArticleStatus;
        contentLine?: string;
      };
      if (!body.title?.trim()) return reply.status(400).send({ error: '文章标题必填' });
      return createArticle({
        projectId: request.params.projectId,
        title: body.title.trim(),
        angle: body.angle,
        seriesId: body.seriesId ?? null,
        docMd: body.docMd,
        status: body.status,
        contentLine: body.contentLine ?? '',
      });
    }
  );

  // 批量铺选题
  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/articles/batch',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) return reply.status(404).send({ error: '主体不存在' });
      const body = (request.body || {}) as {
        items?: Array<{ title: string; angle?: string; seriesId?: string | null; contentLine?: string }>;
      };
      if (!Array.isArray(body.items) || body.items.length === 0) {
        return reply.status(400).send({ error: 'items 必填且非空' });
      }
      const created = batchCreateArticles(request.params.projectId, body.items);
      return { created: created.length, articles: created };
    }
  );

  app.get<{ Params: { aid: string } }>('/api/articles/:aid', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    return {
      ...a,
      channelVersions: listChannelVersions(a.id),
      publishes: listPublishesByArticle(a.id),
    };
  });

  app.put<{ Params: { aid: string } }>('/api/articles/:aid', async (request, reply) => {
    if (!getArticle(request.params.aid)) return reply.status(404).send({ error: '文章不存在' });
    const body = (request.body || {}) as {
      title?: string;
      angle?: string;
      docMd?: string;
      status?: ArticleStatus;
      seriesId?: string | null;
      contentLine?: string;
    };
    return updateArticle(request.params.aid, body);
  });

  app.delete<{ Params: { aid: string } }>('/api/articles/:aid', async (request, reply) => {
    if (!getArticle(request.params.aid)) return reply.status(404).send({ error: '文章不存在' });
    deleteArticle(request.params.aid);
    return { ok: true };
  });

  // ---------- 渠道版本 ----------
  app.get<{ Params: { aid: string } }>('/api/articles/:aid/channels', async (request, reply) => {
    if (!getArticle(request.params.aid)) return reply.status(404).send({ error: '文章不存在' });
    return { versions: listChannelVersions(request.params.aid) };
  });

  app.put<{ Params: { aid: string; channel: string } }>(
    '/api/articles/:aid/channels/:channel',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const channel = request.params.channel as ChannelKey;
      if (!CHANNELS.includes(channel)) return reply.status(400).send({ error: '渠道不支持' });
      const { title, content, extra } = (request.body || {}) as {
        title?: string;
        content?: string;
        extra?: Record<string, unknown>;
      };
      return upsertChannelVersion(a.id, channel, { title, content, extra });
    }
  );

  // 无头生成渠道版本（面板按钮直调；对话里也可由搭档的 adapt_channels 工具触发同一服务）
  app.post<{ Params: { aid: string } }>('/api/articles/:aid/adapt', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const body = (request.body || {}) as { channels?: ChannelKey[]; requirement?: string };
    const channels = Array.isArray(body.channels)
      ? body.channels.filter((c) => CHANNELS.includes(c))
      : [];
    const { adaptArticleChannels } = await import('../services/channelAdapter.js');
    const result = await adaptArticleChannels(a.project_id, a.id, channels, body.requirement || '');
    if (!result.ok) return reply.status(400).send(result);
    return result;
  });

  // ---------- 发布记录 ----------
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/publishes',
    async (request) => listPublishes(request.params.projectId)
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/publishes',
    async (request, reply) => {
      const projectId = request.params.projectId;
      if (!getProject(projectId)) return reply.status(404).send({ error: '主体不存在' });
      const body = (request.body || {}) as {
        articleId?: string;
        channel?: ChannelKey;
        url?: string;
        metrics?: Record<string, number>;
        note?: string;
        publishedAt?: string;
      };
      if (!body.articleId || !getArticle(body.articleId)) {
        return reply.status(400).send({ error: 'articleId 无效' });
      }
      if (!body.channel || !CHANNELS.includes(body.channel)) {
        return reply.status(400).send({ error: '渠道不支持' });
      }
      return createPublish({
        articleId: body.articleId,
        projectId,
        channel: body.channel,
        url: body.url,
        metrics: body.metrics,
        note: body.note,
        publishedAt: body.publishedAt,
      });
    }
  );

  app.put<{ Params: { pid: string } }>('/api/publishes/:pid', async (request, reply) => {
    const body = (request.body || {}) as {
      url?: string;
      metrics?: Record<string, number>;
      note?: string;
      publishedAt?: string;
    };
    const updated = updatePublish(request.params.pid, body);
    if (!updated) return reply.status(404).send({ error: '发布记录不存在' });
    return updated;
  });

  app.delete<{ Params: { pid: string } }>('/api/publishes/:pid', async (request) => {
    deletePublish(request.params.pid);
    return { ok: true };
  });

  // ---------- 写作规范包 ----------
  app.get('/api/writing-kits', async () =>
    listKits().map((k) => ({
      id: k.id,
      name: k.name,
      description: k.description,
      signoff: k.signoff,
      contentLines: k.contentLines,
      isBuiltin: !!k.is_builtin,
      positioningMd: k.positioning_md,
      writingMd: k.writing_md,
      titleMd: k.title_md,
      spreadMd: k.spread_md,
    }))
  );

  app.get<{ Params: { kid: string } }>('/api/writing-kits/:kid', async (request, reply) => {
    const k = getKit(request.params.kid);
    if (!k) return reply.status(404).send({ error: '规范包不存在' });
    return {
      id: k.id,
      name: k.name,
      description: k.description,
      signoff: k.signoff,
      contentLines: k.contentLines,
      isBuiltin: !!k.is_builtin,
      positioningMd: k.positioning_md,
      writingMd: k.writing_md,
      titleMd: k.title_md,
      spreadMd: k.spread_md,
    };
  });

  app.post('/api/writing-kits', async (request, reply) => {
    const body = (request.body || {}) as WritingKitInput & { name?: string };
    if (!body.name?.trim()) return reply.status(400).send({ error: '规范包名称必填' });
    return createKit({
      name: body.name.trim(),
      description: body.description,
      positioningMd: body.positioningMd,
      writingMd: body.writingMd,
      titleMd: body.titleMd,
      spreadMd: body.spreadMd,
      signoff: body.signoff,
      contentLines: body.contentLines,
    });
  });

  app.put<{ Params: { kid: string } }>('/api/writing-kits/:kid', async (request, reply) => {
    const updated = updateKit(request.params.kid, (request.body || {}) as WritingKitInput);
    if (!updated) return reply.status(404).send({ error: '规范包不存在' });
    return { ok: true };
  });

  app.delete<{ Params: { kid: string } }>('/api/writing-kits/:kid', async (request, reply) => {
    const r = deleteKit(request.params.kid);
    if (!r.ok) return reply.status(400).send({ error: r.error });
    return { ok: true };
  });

  app.post<{ Params: { kid: string } }>('/api/writing-kits/:kid/duplicate', async (request, reply) => {
    const body = (request.body || {}) as { name?: string };
    const k = duplicateKit(request.params.kid, body.name);
    if (!k) return reply.status(404).send({ error: '规范包不存在' });
    return k;
  });

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/mount-kit',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) return reply.status(404).send({ error: '主体不存在' });
      const { kitId } = (request.body || {}) as { kitId?: string | null };
      if (kitId && !getKit(kitId)) return reply.status(400).send({ error: '规范包不存在' });
      mountKit(request.params.projectId, kitId || null);
      return { ok: true };
    }
  );
}

/** 项目下全部渠道版本（列表页带 channels 标记用） */
function listChannelVersionsByProject(
  db: ReturnType<typeof getDb>,
  projectId: string
): Array<{ article_id: string; channel: ChannelKey }> {
  return db
    .prepare(
      `SELECT cv.article_id, cv.channel FROM cf_channel_versions cv
       JOIN cf_articles a ON a.id = cv.article_id
       WHERE a.project_id=?`
    )
    .all(projectId) as Array<{ article_id: string; channel: ChannelKey }>;
}
