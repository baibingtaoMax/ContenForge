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

  // 公众号成品排版：结构化稿件 → 橄榄手记 HTML，存进 wechat 版本 extra.layoutHtml
  app.post<{ Params: { aid: string } }>(
    '/api/articles/:aid/gzh-layout',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const body = (request.body || {}) as { doc?: unknown };
      if (!body.doc || typeof body.doc !== 'object') {
        return reply.status(400).send({ error: '缺少 doc（结构化稿件）' });
      }
      const { renderGzh } = await import('../services/gzh/renderer.js');
      const { validateLayoutHtml } = await import('../services/gzh/validate.js');
      const doc = body.doc as any;
      const layoutHtml = renderGzh(doc);
      const { errors, leafCount } = validateLayoutHtml(layoutHtml);
      if (errors.length) return reply.status(500).send({ error: '排版未通过内建校验', errors });
      const existing = listChannelVersions(a.id).find((v) => v.channel === 'wechat');
      let extra: Record<string, unknown> = {};
      try { extra = JSON.parse(existing?.extra_json || '{}'); } catch { extra = {}; }
      extra.layoutDoc = doc;
      extra.layoutHtml = layoutHtml;
      upsertChannelVersion(a.id, 'wechat', {
        title: existing?.title || a.title,
        content: existing?.content || '',
        extra,
      });
      return { ok: true, leafCount, length: layoutHtml.length };
    }
  );

  // 公众号 AI 一键排版：读主稿 → LLM 调组件工具 → 成品存 extra.layoutHtml
  app.post<{ Params: { aid: string } }>(
    '/api/articles/:aid/auto-layout',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const { autoLayoutGzh } = await import('../services/gzh/autoLayout.js');
      const { mergeAdoptedImages } = await import('../services/gzh/shots.js');
      const r = await autoLayoutGzh({ docMd: a.doc_md || '', title: a.title });
      if (!r.ok || !r.html || !r.doc) return reply.status(500).send(r);
      const existing = listChannelVersions(a.id).find((v) => v.channel === 'wechat');
      let extra: Record<string, unknown> = {};
      try { extra = JSON.parse(existing?.extra_json || '{}'); } catch { extra = {}; }
      // 先落无图基线，再把之前已采用的图按锚点重套（重排版不丢配图）
      extra.layoutDoc = r.doc;
      extra.layoutHtml = r.html;
      const merge = mergeAdoptedImages(a.id, extra);
      upsertChannelVersion(a.id, 'wechat', {
        title: existing?.title || a.title,
        content: existing?.content || '',
        extra,
      });
      return { ok: true, leafCount: r.leafCount, componentCount: r.componentCount, merged: merge };
    }
  );

  // 公众号正文配图方案（独立工序，不属于排版）：整单生成/重生成，存 extra.shots
  app.post<{ Params: { aid: string } }>(
    '/api/articles/:aid/gzh-shots',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const { generateShots } = await import('../services/gzh/shots.js');
      const r = await generateShots(a.id);
      if (!r.ok) return reply.status(500).send(r);
      return r;
    }
  );

  // 编辑单条配图方案（主要改 prompt，也可改锚点/意图/画面）
  app.put<{ Params: { aid: string; sid: string } }>(
    '/api/articles/:aid/gzh-shots/:sid',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const body = (request.body || {}) as {
        prompt?: string; intent?: string; scene?: string; anchorSection?: string; afterParagraph?: string;
      };
      const { updateShot } = await import('../services/gzh/shots.js');
      const shot = await updateShot(a.id, request.params.sid, body);
      if (!shot) return reply.status(404).send({ error: '配图方案条目不存在' });
      return { ok: true, shot };
    }
  );

  // 删除单条配图方案
  app.delete<{ Params: { aid: string; sid: string } }>(
    '/api/articles/:aid/gzh-shots/:sid',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const { deleteShot } = await import('../services/gzh/shots.js');
      const ok = await deleteShot(a.id, request.params.sid);
      if (!ok) return reply.status(404).send({ error: '配图方案条目不存在' });
      return { ok: true };
    }
  );

  // 逐条生图 / 换一张：调 seedream 落本地，追加候选，不自动采用
  app.post<{ Params: { aid: string; sid: string } }>(
    '/api/articles/:aid/gzh-shots/:sid/generate',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const { generateShotImage } = await import('../services/gzh/shots.js');
      const r = await generateShotImage(a.id, request.params.sid);
      if (!r.ok) return reply.status(502).send(r);
      return r;
    }
  );

  // 在多候选里选一张（已采用时同步重套成品）
  app.put<{ Params: { aid: string; sid: string } }>(
    '/api/articles/:aid/gzh-shots/:sid/select',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const { relPath } = (request.body || {}) as { relPath?: string };
      if (!relPath) return reply.status(400).send({ error: '缺少 relPath' });
      const { selectShotCandidate } = await import('../services/gzh/shots.js');
      const shot = await selectShotCandidate(a.id, request.params.sid, String(relPath));
      if (!shot) return reply.status(404).send({ error: '候选图不存在' });
      return { ok: true, shot };
    }
  );

  // 采用 / 移除（只有采用的图进正文）
  app.put<{ Params: { aid: string; sid: string } }>(
    '/api/articles/:aid/gzh-shots/:sid/adopt',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const { adopted } = (request.body || {}) as { adopted?: boolean };
      const { setShotAdopted } = await import('../services/gzh/shots.js');
      const r = await setShotAdopted(a.id, request.params.sid, !!adopted);
      if (!r.ok) return reply.status(400).send(r);
      return r;
    }
  );

  // 本地正文配图读取（受控：限定 data/gzh-images，防目录穿越）
  app.get<{ Params: { '*': string } }>('/api/gzh-img/*', async (request, reply) => {
    const rel = (request.params as Record<string, string>)['*'] || '';
    const { resolveImagePath } = await import('../services/gzh/seedream.js');
    const fs = await import('node:fs/promises');
    const abs = resolveImagePath(rel);
    if (!abs) return reply.status(400).send({ error: '非法路径' });
    try {
      const buf = await fs.readFile(abs);
      return reply.type('image/jpeg').send(buf);
    } catch {
      return reply.status(404).send({ error: '图片不存在' });
    }
  });

  // 本地封面图读取（受控：限定 data/gzh-covers，防目录穿越）
  app.get<{ Params: { '*': string } }>('/api/gzh-cover/*', async (request, reply) => {
    const rel = (request.params as Record<string, string>)['*'] || '';
    const { resolveCoverPath } = await import('../services/gzh/cover.js');
    const fs = await import('node:fs/promises');
    const abs = resolveCoverPath(rel);
    if (!abs) return reply.status(400).send({ error: '非法路径' });
    try {
      const buf = await fs.readFile(abs);
      const ct = abs.endsWith('.png') ? 'image/png' : abs.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      return reply.type(ct).send(buf);
    } catch {
      return reply.status(404).send({ error: '封面不存在' });
    }
  });

  // 上传/更换本篇封面（multipart 字段 cover）；存盘 + 记进 extra.cover
  app.post<{ Params: { aid: string } }>(
    '/api/articles/:aid/gzh-cover',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      const parts = request.parts();
      let file: { filename: string; contentType: string; data: Buffer } | null = null;
      for await (const p of parts) {
        if (p.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const c of p.file) chunks.push(c as Buffer);
          file = { filename: p.filename || 'cover.jpg', contentType: p.mimetype || 'image/jpeg', data: Buffer.concat(chunks) };
        }
      }
      if (!file) return reply.status(400).send({ error: '缺少封面文件 cover' });
      const { saveCover } = await import('../services/gzh/cover.js');
      const meta = await saveCover(a.id, file);
      return { ok: true, cover: meta };
    }
  );

  // 删除本篇已存封面
  app.delete<{ Params: { aid: string } }>('/api/articles/:aid/gzh-cover', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const { deleteCover } = await import('../services/gzh/cover.js');
    const removed = await deleteCover(a.id);
    return { ok: true, removed };
  });

  // ============ AI 封面工坊（两版×两比例） ============
  const COVER_KEYS = ['xiaohei-wide', 'xiaohei-square', 'magazine-wide', 'magazine-square'] as const;
  const isCoverKey = (k: unknown): k is typeof COVER_KEYS[number] =>
    typeof k === 'string' && (COVER_KEYS as readonly string[]).includes(k);

  // 读封面工坊状态（随渠道版本 extra_json 返回，这里给个显式接口便于前端刷新）
  app.get<{ Params: { aid: string } }>('/api/articles/:aid/cover-studio', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const { getCoverStudio } = await import('../services/gzh/coverStudio.js');
    return { ok: true, state: getCoverStudio(a.id) };
  });

  // 生成 / 重生成封面方案（AI：文字 + 两版画面 prompt）。慢，前端超时放长。
  app.post<{ Params: { aid: string } }>('/api/articles/:aid/cover-studio/plan', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    try {
      const { generateCoverPlan } = await import('../services/gzh/coverStudio.js');
      const state = await generateCoverPlan(a.id);
      return { ok: true, state };
    } catch (e) {
      return reply.status(502).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 保存对方案文字 / 画面 prompt 的人工编辑
  app.put<{ Params: { aid: string } }>('/api/articles/:aid/cover-studio/plan', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    try {
      const { saveCoverPlan } = await import('../services/gzh/coverStudio.js');
      const state = await saveCoverPlan(a.id, (request.body || {}) as Record<string, string>);
      return { ok: true, state };
    } catch (e) {
      return reply.status(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 生某版位的无文字背景（逐版手动，可换一张）
  app.post<{ Params: { aid: string; key: string } }>(
    '/api/articles/:aid/cover-studio/art/:key',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });
      if (!isCoverKey(request.params.key)) return reply.status(400).send({ error: '未知封面版位' });
      try {
        const { generateCoverArt } = await import('../services/gzh/coverStudio.js');
        const r = await generateCoverArt(a.id, request.params.key);
        return { ok: true, ...r };
      } catch (e) {
        return reply.status(502).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // 合成封面：body 带 key 合成单张；不带 key 合成全部已有背景的版位
  app.post<{ Params: { aid: string } }>('/api/articles/:aid/cover-studio/render', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const key = (request.body as { key?: string } | null)?.key;
    try {
      if (key) {
        if (!isCoverKey(key)) return reply.status(400).send({ error: '未知封面版位' });
        const { renderCover } = await import('../services/gzh/coverStudio.js');
        const r = await renderCover(a.id, key);
        return { ok: true, ...r };
      }
      const { renderAllCovers } = await import('../services/gzh/coverStudio.js');
      const r = await renderAllCovers(a.id);
      return { ok: true, ...r };
    } catch (e) {
      return reply.status(502).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 4 张里选一张设为封面（写入 extra.cover，直接接一键推草稿）
  app.post<{ Params: { aid: string } }>('/api/articles/:aid/cover-studio/choose', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const key = (request.body as { key?: string } | null)?.key;
    if (!isCoverKey(key)) return reply.status(400).send({ error: '请选择一张封面' });
    try {
      const { chooseCover } = await import('../services/gzh/coverStudio.js');
      const r = await chooseCover(a.id, key);
      return { ok: true, ...r };
    } catch (e) {
      return reply.status(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ===================== 小红书知识卡片轮播 =====================

  // 本地卡片成图读取（受控：限定 data/xhs-cards，防目录穿越）
  app.get<{ Params: { '*': string } }>('/api/xhs-img/*', async (request, reply) => {
    const rel = (request.params as Record<string, string>)['*'] || '';
    const { resolveXhsImagePath } = await import('../services/xhs/cardDeck.js');
    const fs = await import('node:fs/promises');
    const abs = resolveXhsImagePath(rel);
    if (!abs) return reply.status(400).send({ error: '非法路径' });
    try {
      const buf = await fs.readFile(abs);
      return reply.type('image/png').send(buf);
    } catch {
      return reply.status(404).send({ error: '图片不存在' });
    }
  });

  // 风格库：列出全部（内置+自定义）
  app.get('/api/xhs-styles', async (_request, reply) => {
    const { listStyles } = await import('../services/xhs/cardStyle.js');
    return { ok: true, styles: listStyles() };
  });

  // 保存（新增/更新）自定义风格；body 为完整风格旋钮
  app.post('/api/xhs-styles', async (request, reply) => {
    const { saveStyle } = await import('../services/xhs/cardStyle.js');
    const r = saveStyle((request.body || {}) as Record<string, unknown>);
    if (!r.ok) return reply.status(400).send(r);
    return { ok: true, style: r.style };
  });

  // 删除自定义风格（内置不可删）
  app.delete<{ Params: { id: string } }>('/api/xhs-styles/:id', async (request, reply) => {
    const { deleteStyle } = await import('../services/xhs/cardStyle.js');
    const ok = deleteStyle(request.params.id);
    return { ok };
  });

  // AI 设计一个新风格并存入风格库；body: { brief, articleId? }
  app.post('/api/xhs-styles/design', async (request, reply) => {
    const { designStyleWithAi } = await import('../services/xhs/cardDeck.js');
    const body = (request.body || {}) as { brief?: string; articleId?: string };
    try {
      const r = await designStyleWithAi({ brief: String(body.brief || ''), articleId: body.articleId });
      if (!r.ok) return reply.status(400).send(r);
      return { ok: true, style: r.style };
    } catch (e) {
      return reply.status(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 读整套卡片方案（含各张成图状态）
  app.get<{ Params: { aid: string } }>('/api/articles/:aid/xhs-cards', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const { getDeck } = await import('../services/xhs/cardDeck.js');
    return { ok: true, deck: getDeck(a.id) };
  });

  // 读主稿生成整套卡片文案（不出图）
  app.post<{ Params: { aid: string } }>('/api/articles/:aid/xhs-cards/generate', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const { generateDeck } = await import('../services/xhs/cardDeck.js');
    const r = await generateDeck(a.id);
    if (!r.ok) return reply.status(400).send(r);
    return { ok: true, deck: r.deck };
  });

  // 保存人工改过的卡片文案
  app.put<{ Params: { aid: string } }>('/api/articles/:aid/xhs-cards', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const { saveDeckPlan } = await import('../services/xhs/cardDeck.js');
    const r = saveDeckPlan(a.id, (request.body || {}) as Record<string, unknown>);
    if (!r.ok) return reply.status(400).send(r);
    return { ok: true, deck: r.deck };
  });

  // 渲染单张卡片（body: { cardId }）或全部（无 cardId）
  app.post<{ Params: { aid: string } }>('/api/articles/:aid/xhs-cards/render', async (request, reply) => {
    const a = getArticle(request.params.aid);
    if (!a) return reply.status(404).send({ error: '文章不存在' });
    const cardId = (request.body as { cardId?: string } | null)?.cardId;
    try {
      const { renderCard, renderAllCards, getDeck } = await import('../services/xhs/cardDeck.js');
      if (cardId) {
        const r = await renderCard(a.id, String(cardId));
        if (!r.ok) return reply.status(400).send(r);
        return { ok: true, render: r.render, deck: getDeck(a.id) };
      }
      const r = await renderAllCards(a.id);
      return { ...r, deck: getDeck(a.id) };
    } catch (e) {
      return reply.status(400).send({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 公众号成品推送到草稿箱：cover 文件可选（已存封面时无需再传）+ meta JSON
  app.post<{ Params: { aid: string } }>(
    '/api/articles/:aid/push-draft',
    async (request, reply) => {
      const a = getArticle(request.params.aid);
      if (!a) return reply.status(404).send({ error: '文章不存在' });

      // 解析 multipart：cover 文件可选，meta 为 JSON 字段（纯 JSON 请求时两者皆空）
      let meta: { title?: string; author?: string; digest?: string; contentSourceUrl?: string } = {};
      let uploaded: { filename: string; contentType: string; data: Buffer } | null = null;
      if ((request.headers['content-type'] || '').includes('multipart/form-data')) {
        const parts = request.parts();
        for await (const p of parts) {
          if (p.type === 'file') {
            const chunks: Buffer[] = [];
            for await (const c of p.file) chunks.push(c as Buffer);
            uploaded = { filename: p.filename || 'cover.jpg', contentType: p.mimetype || 'image/jpeg', data: Buffer.concat(chunks) };
          } else if (p.fieldname === 'meta') {
            try { meta = JSON.parse(p.value as string); } catch { /* ignore */ }
          }
        }
      } else if (request.body && typeof request.body === 'object') {
        meta = request.body as typeof meta;
      }

      const v = listChannelVersions(a.id).find((x) => x.channel === 'wechat');
      let layoutHtml = '';
      try { layoutHtml = JSON.parse(v?.extra_json || '{}').layoutHtml || ''; } catch { /* ignore */ }
      if (!layoutHtml) return reply.status(400).send({ error: '尚无排版成品，先排版再推送' });

      // 封面：本次带了文件就用它并顺带存档；否则读已存封面；都没有才要求先传
      const { saveCover, readCoverFile } = await import('../services/gzh/cover.js');
      let cover: { filename: string; contentType: string; data: Buffer };
      if (uploaded) {
        await saveCover(a.id, uploaded);
        cover = uploaded;
      } else {
        const saved = readCoverFile(a.id);
        if (!saved) return reply.status(400).send({ error: '还没设置封面，先上传一次封面，之后即可一键推送' });
        cover = saved;
      }

      const { pushDraft } = await import('../services/wxmp/draft.js');
      const result = await pushDraft({
        title: meta.title || v?.title || a.title,
        author: meta.author,
        digest: meta.digest,
        content: layoutHtml,
        contentSourceUrl: meta.contentSourceUrl,
        cover,
      });
      if (!result.ok) return reply.status(502).send(result);
      return result;
    }
  );

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
