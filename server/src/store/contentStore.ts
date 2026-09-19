// ============================================
// ContentForge 内容业务存储层
// 推广主体档案复用 projects（subject_type / profile_json 两列）；
// 系列 / 文章 / 渠道版本 / 发布记录走 cf_* 表。
// ============================================

import { getDb, touchProject } from './database.js';

// ---------- 推广主体档案 ----------

export type SubjectType =
  | 'product' // 软件/实体产品
  | 'official_account' // 公众号/账号本身
  | 'personal_ip' // 个人 IP
  | 'service' // 服务/课程
  | 'event' // 活动
  | 'community' // 社群
  | 'other';

export interface SubjectProfile {
  /** 一句话定位 */
  positioning?: string;
  /** 目标用户/受众 */
  audience?: string;
  /** 核心痛点 */
  pains?: string;
  /** 核心卖点（数组序列化） */
  sellingPoints?: string[];
  /** 差异点/凭什么是你 */
  difference?: string;
  /** 行动指令 CTA，如「试用申请」「关注公众号」 */
  cta?: string;
  /** 转化链接/微信号等 */
  ctaTarget?: string;
  /** 语气风格备注 */
  tone?: string;
  /** 其他补充 */
  notes?: string;
  [k: string]: unknown;
}

export function getSubjectType(projectId: string): SubjectType {
  const row = getDb().prepare('SELECT subject_type FROM projects WHERE id=?').get(projectId) as
    | { subject_type: string }
    | undefined;
  return (row?.subject_type as SubjectType) || 'product';
}

export function getSubjectProfile(projectId: string): SubjectProfile {
  const row = getDb().prepare('SELECT profile_json FROM projects WHERE id=?').get(projectId) as
    | { profile_json: string }
    | undefined;
  try {
    return row?.profile_json ? (JSON.parse(row.profile_json) as SubjectProfile) : {};
  } catch {
    return {};
  }
}

export function updateSubject(
  projectId: string,
  patch: { subjectType?: SubjectType; profile?: SubjectProfile }
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.subjectType) {
    fields.push('subject_type=?');
    values.push(patch.subjectType);
  }
  if (patch.profile) {
    fields.push('profile_json=?');
    values.push(JSON.stringify(patch.profile));
  }
  if (fields.length === 0) return;
  fields.push('updated_at=?');
  values.push(new Date().toISOString());
  values.push(projectId);
  getDb()
    .prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id=?`)
    .run(...(values as any[]));
  touchProject(projectId);
}

// ---------- 内容系列 ----------

export interface SeriesRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function createSeries(projectId: string, title: string, description = ''): SeriesRow {
  const now = new Date().toISOString();
  const maxRow = getDb()
    .prepare('SELECT MAX(sort_order) AS m FROM cf_series WHERE project_id=?')
    .get(projectId) as { m: number | null };
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO cf_series (id, project_id, title, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, projectId, title.trim(), description, (maxRow.m ?? -1) + 1, now, now);
  touchProject(projectId);
  return getSeries(id)!;
}

export function listSeries(projectId: string): SeriesRow[] {
  return getDb()
    .prepare('SELECT * FROM cf_series WHERE project_id=? ORDER BY sort_order, created_at')
    .all(projectId) as unknown as SeriesRow[];
}

/**
 * 解析文章归属系列：id 命中 → 用；否则同名复用；都没有 → 自动建。
 */
export function ensureSeries(
  projectId: string,
  opts: { seriesId?: string; seriesTitle?: string; fallbackTitle?: string }
): { seriesId: string | null; createdSeries?: { id: string; title: string } } {
  if (!opts.seriesId && !opts.seriesTitle?.trim()) return { seriesId: null };
  const existing = listSeries(projectId);
  if (opts.seriesId) {
    const hit = existing.find((s) => s.id === opts.seriesId);
    if (hit) return { seriesId: hit.id };
  }
  const title = (opts.seriesTitle || opts.fallbackTitle || '').trim();
  if (!title) return { seriesId: null };
  const dup = existing.find((s) => s.title === title);
  if (dup) return { seriesId: dup.id };
  const s = createSeries(projectId, title);
  return { seriesId: s.id, createdSeries: { id: s.id, title: s.title } };
}

export function getSeries(id: string): SeriesRow | undefined {
  return getDb().prepare('SELECT * FROM cf_series WHERE id=?').get(id) as SeriesRow | undefined;
}

export function updateSeries(id: string, patch: { title?: string; description?: string }): SeriesRow | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    fields.push('title=?');
    values.push(patch.title);
  }
  if (patch.description !== undefined) {
    fields.push('description=?');
    values.push(patch.description);
  }
  fields.push('updated_at=?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE cf_series SET ${fields.join(', ')} WHERE id=?`).run(...(values as any[]));
  return getSeries(id);
}

export function deleteSeries(id: string): void {
  const s = getSeries(id);
  // 系列删除：文章 series_id 由 ON DELETE SET NULL 自动置空（文章保留）
  getDb().prepare('DELETE FROM cf_series WHERE id=?').run(id);
  if (s) touchProject(s.project_id);
}

// ---------- 文章 ----------

export type ArticleStatus = 'topic' | 'writing' | 'final' | 'published';

export interface ArticleRow {
  id: string;
  project_id: string;
  series_id: string | null;
  title: string;
  angle: string;
  doc_md: string;
  status: ArticleStatus;
  /** 内容线 key（规范包里定义，如 classic/practice），空串=未分线 */
  content_line: string;
  sort_order: number;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export function createArticle(row: {
  id?: string;
  projectId: string;
  seriesId?: string | null;
  title: string;
  angle?: string;
  docMd?: string;
  status?: ArticleStatus;
  contentLine?: string;
  sortOrder?: number;
  sourceConversationId?: string | null;
}): ArticleRow {
  const now = new Date().toISOString();
  const id = row.id || crypto.randomUUID();
  const sort =
    row.sortOrder ??
    ((getDb()
      .prepare('SELECT MAX(sort_order) AS m FROM cf_articles WHERE project_id=?')
      .get(row.projectId) as { m: number | null }).m ?? -1) + 1;
  getDb()
    .prepare(
      `INSERT INTO cf_articles
         (id, project_id, series_id, title, angle, doc_md, status, content_line, sort_order, source_conversation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      row.projectId,
      row.seriesId ?? null,
      row.title.trim(),
      row.angle ?? '',
      row.docMd ?? '',
      row.status ?? 'topic',
      row.contentLine ?? '',
      sort,
      row.sourceConversationId ?? null,
      now,
      now
    );
  touchProject(row.projectId);
  return getArticle(id)!;
}

/** 批量铺选题（一次 N 条 topic） */
export function batchCreateArticles(
  projectId: string,
  items: Array<{ title: string; angle?: string; seriesId?: string | null; contentLine?: string }>
): ArticleRow[] {
  const out: ArticleRow[] = [];
  for (const it of items) {
    if (!it.title?.trim()) continue;
    out.push(
      createArticle({
        projectId,
        seriesId: it.seriesId ?? null,
        title: it.title,
        angle: it.angle ?? '',
        contentLine: it.contentLine ?? '',
        status: 'topic',
      })
    );
  }
  return out;
}

export function listArticles(projectId: string): ArticleRow[] {
  return getDb()
    .prepare('SELECT * FROM cf_articles WHERE project_id=? ORDER BY sort_order, created_at')
    .all(projectId) as unknown as ArticleRow[];
}

export function getArticle(id: string): ArticleRow | undefined {
  return getDb().prepare('SELECT * FROM cf_articles WHERE id=?').get(id) as ArticleRow | undefined;
}

export function updateArticle(
  id: string,
  patch: {
    title?: string;
    angle?: string;
    docMd?: string;
    status?: ArticleStatus;
    seriesId?: string | null;
    contentLine?: string;
    sortOrder?: number;
  }
): ArticleRow | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    fields.push('title=?');
    values.push(patch.title);
  }
  if (patch.angle !== undefined) {
    fields.push('angle=?');
    values.push(patch.angle);
  }
  if (patch.docMd !== undefined) {
    fields.push('doc_md=?');
    values.push(patch.docMd);
  }
  if (patch.status !== undefined) {
    fields.push('status=?');
    values.push(patch.status);
  }
  if (patch.seriesId !== undefined) {
    fields.push('series_id=?');
    values.push(patch.seriesId);
  }
  if (patch.contentLine !== undefined) {
    fields.push('content_line=?');
    values.push(patch.contentLine);
  }
  if (patch.sortOrder !== undefined) {
    fields.push('sort_order=?');
    values.push(patch.sortOrder);
  }
  fields.push('updated_at=?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE cf_articles SET ${fields.join(', ')} WHERE id=?`).run(...(values as any[]));
  return getArticle(id);
}

export function deleteArticle(id: string): void {
  const a = getArticle(id);
  getDb().prepare('DELETE FROM cf_articles WHERE id=?').run(id); // 渠道版本/发布记录级联删
  if (a) touchProject(a.project_id);
}

// ---------- 渠道版本 ----------

export type ChannelKey = 'wechat' | 'xhs' | 'markdown';

export interface ChannelVersionRow {
  id: string;
  article_id: string;
  channel: ChannelKey;
  title: string;
  content: string;
  extra_json: string;
  created_at: string;
  updated_at: string;
}

export function listChannelVersions(articleId: string): ChannelVersionRow[] {
  return getDb()
    .prepare('SELECT * FROM cf_channel_versions WHERE article_id=?')
    .all(articleId) as unknown as ChannelVersionRow[];
}

export function getChannelVersion(articleId: string, channel: string): ChannelVersionRow | undefined {
  return getDb()
    .prepare('SELECT * FROM cf_channel_versions WHERE article_id=? AND channel=?')
    .get(articleId, channel) as ChannelVersionRow | undefined;
}

export function upsertChannelVersion(
  articleId: string,
  channel: ChannelKey,
  patch: { title?: string; content?: string; extra?: Record<string, unknown> }
): ChannelVersionRow {
  const existing = getChannelVersion(articleId, channel);
  const now = new Date().toISOString();
  const title = patch.title ?? existing?.title ?? '';
  const content = patch.content ?? existing?.content ?? '';
  const extra = patch.extra
    ? JSON.stringify(patch.extra)
    : existing?.extra_json ?? '{}';
  if (existing) {
    getDb()
      .prepare(
        `UPDATE cf_channel_versions SET title=?, content=?, extra_json=?, updated_at=? WHERE id=?`
      )
      .run(title, content, extra, now, existing.id);
  } else {
    getDb()
      .prepare(
        `INSERT INTO cf_channel_versions (id, article_id, channel, title, content, extra_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(crypto.randomUUID(), articleId, channel, title, content, extra, now, now);
  }
  const a = getArticle(articleId);
  if (a) touchProject(a.project_id);
  return getChannelVersion(articleId, channel)!;
}

// ---------- 发布记录 ----------

export interface PublishRow {
  id: string;
  article_id: string;
  project_id: string;
  channel: ChannelKey;
  url: string;
  metrics_json: string;
  note: string;
  published_at: string;
  created_at: string;
  updated_at: string;
}

export interface PublishMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  collects?: number;
  shares?: number;
  [k: string]: unknown;
}

export function listPublishes(projectId: string): PublishRow[] {
  return getDb()
    .prepare('SELECT * FROM cf_publishes WHERE project_id=? ORDER BY created_at DESC')
    .all(projectId) as unknown as PublishRow[];
}

export function listPublishesByArticle(articleId: string): PublishRow[] {
  return getDb()
    .prepare('SELECT * FROM cf_publishes WHERE article_id=? ORDER BY created_at DESC')
    .all(articleId) as unknown as PublishRow[];
}

export function createPublish(row: {
  articleId: string;
  projectId: string;
  channel: ChannelKey;
  url?: string;
  metrics?: PublishMetrics;
  note?: string;
  publishedAt?: string;
}): PublishRow {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO cf_publishes
         (id, article_id, project_id, channel, url, metrics_json, note, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      row.articleId,
      row.projectId,
      row.channel,
      row.url ?? '',
      JSON.stringify(row.metrics ?? {}),
      row.note ?? '',
      row.publishedAt ?? now,
      now,
      now
    );
  touchProject(row.projectId);
  return getDb().prepare('SELECT * FROM cf_publishes WHERE id=?').get(id) as unknown as PublishRow;
}

export function updatePublish(
  id: string,
  patch: { url?: string; metrics?: PublishMetrics; note?: string; publishedAt?: string }
): PublishRow | undefined {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.url !== undefined) {
    fields.push('url=?');
    values.push(patch.url);
  }
  if (patch.metrics !== undefined) {
    fields.push('metrics_json=?');
    values.push(JSON.stringify(patch.metrics));
  }
  if (patch.note !== undefined) {
    fields.push('note=?');
    values.push(patch.note);
  }
  if (patch.publishedAt !== undefined) {
    fields.push('published_at=?');
    values.push(patch.publishedAt);
  }
  fields.push('updated_at=?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE cf_publishes SET ${fields.join(', ')} WHERE id=?`).run(...(values as any[]));
  return getDb().prepare('SELECT * FROM cf_publishes WHERE id=?').get(id) as unknown as PublishRow | undefined;
}

export function deletePublish(id: string): void {
  getDb().prepare('DELETE FROM cf_publishes WHERE id=?').run(id);
}

// ---------- 消息回填（刷新还原文章卡片） ----------

export function setLatestAssistantArticleIds(conversationId: string, articleIds: string[]): void {
  getDb()
    .prepare(
      `UPDATE messages SET article_ids=?
       WHERE id = (SELECT id FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY id DESC LIMIT 1)`
    )
    .run(JSON.stringify(articleIds), conversationId);
}
