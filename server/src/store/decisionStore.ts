// ============================================
// 设计决策数据访问层（decisions / decision_links）
// 决策回答「这个设计当时为什么这么定」：
// 会议/对话/附件只是来源标签，会议本身不做实体。
// ============================================

import { randomUUID } from 'node:crypto';
import { getDb, touchProject, deleteMemoryChunksBySource, getRequirement } from './database.js';
import { saveMemory } from '../services/memory.js';
import type { MemoryChunkInput } from '../types/index.js';

/**
 * 服务端原话兼底：把文本归一（去章节序号/标点/空白、小写），
 * 与前端 utils/decisionPoints.normalizePoint 同规则。
 */
export function normalizeAnchorText(raw: string): string {
  const stripped = String(raw || '').replace(/^\d+(\.\d+)*[.、\s]*/, '');
  return stripped
    .toLowerCase()
    .replace(/[\s\u3000\u00b7\u2022\-\u2014_/\\:\uff1a,\uff0c.\u3002\u3001\uff08\uff09()\u3010\u3011\[\]]/g, '');
}

/**
 * 校验 anchorText 是否为关联需求 doc_md 里的逐字原话（归一化子串匹配）。
 * 任何一条关联文档包含原话即通过；无关联需求时无法校验，保守放行（手录场景）。
 * 防止 AI 把原话改写/编造后假装是原文。
 */
export function anchorIsVerbatim(anchorText: string, requirementIds: string[]): boolean {
  const needle = normalizeAnchorText(anchorText);
  if (!needle) return true; // 空锚文本是合法的（先拍板后补文档）
  if (!requirementIds.length) return true;
  for (const rid of requirementIds) {
    const req = getRequirement(rid);
    if (req?.doc_md && normalizeAnchorText(req.doc_md).includes(needle)) return true;
  }
  return false;
}

/** 决策来源类型 */
export type DecisionSource = 'meeting' | 'chat' | 'manual';

/** 被否决的备选方案 */
export interface RejectedOption {
  /** 备选方案是什么 */
  option: string;
  /** 为什么被否 */
  reason: string;
}

/** 决策行（DB → 视图模型） */
export interface DesignDecision {
  id: string;
  projectId: string;
  /** 议题：一句话说清在决定什么，如「台账状态枚举设计」 */
  topic: string;
  /** 需求点：这条决策针对文档里的哪个设计点/章节（单值），如「搜索交互」；空=整条需求通用决策 */
  point: string;
  /** 锚文本：从需求文档摘的原句（≤40字），渲染时行内高亮；空=文档里还没这句话（未归位） */
  anchorText: string;
  /** 拍板的结论 */
  conclusion: string;
  /** 为什么这么定 */
  rationale: string;
  /** 被否决的备选方案及原因 */
  rejected: RejectedOption[];
  /** 来源类型 */
  sourceType: DecisionSource;
  /** 来源标签：会议名（如「09-09 评审会」）；chat/manual 可为空 */
  sourceLabel: string;
  sourceConversationId: string | null;
  /** 纪要/对话原文片段（凭证，不是整篇存档） */
  sourceExcerpt: string;
  createdAt: string;
  /** 关联需求 id 列表 */
  requirementIds: string[];
}

export interface DecisionInput {
  projectId: string;
  topic: string;
  point?: string;
  anchorText?: string;
  conclusion?: string;
  rationale?: string;
  rejected?: RejectedOption[];
  sourceType?: DecisionSource;
  sourceLabel?: string;
  sourceConversationId?: string | null;
  sourceExcerpt?: string;
  requirementIds?: string[];
}

interface DecisionRow {
  id: string;
  project_id: string;
  topic: string;
  point: string;
  anchor_text: string;
  conclusion: string;
  rationale: string;
  rejected_json: string;
  source_type: string;
  source_label: string;
  source_conversation_id: string | null;
  source_excerpt: string;
  created_at: string;
}

const SOURCE_TYPES: DecisionSource[] = ['meeting', 'chat', 'manual'];

function normalizeSource(v: unknown): DecisionSource {
  return SOURCE_TYPES.includes(v as DecisionSource) ? (v as DecisionSource) : 'chat';
}

function parseRejected(json: string): RejectedOption[] {
  try {
    const arr = JSON.parse(json || '[]');
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x) => ({
        option: String(x?.option ?? '').trim(),
        reason: String(x?.reason ?? '').trim(),
      }))
      .filter((x) => x.option);
  } catch {
    return [];
  }
}

/** 过滤关联需求：必须是同项目内真实存在的需求，防止脏 id 挂链 */
function filterValidRequirementIds(projectId: string, ids: string[]): string[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT id FROM requirements WHERE project_id=? AND id IN (${placeholders})`)
    .all(projectId, ...ids) as Array<{ id: string }>;
  const valid = new Set(rows.map((r) => r.id));
  return [...new Set(ids)].filter((id) => valid.has(id));
}

function rowToModel(row: DecisionRow): DesignDecision {
  const requirementIds = (
    getDb()
      .prepare('SELECT requirement_id FROM decision_links WHERE decision_id=?')
      .all(row.id) as Array<{ requirement_id: string }>
  ).map((r) => r.requirement_id);

  return {
    id: row.id,
    projectId: row.project_id,
    topic: row.topic,
    point: row.point || '',
    anchorText: row.anchor_text || '',
    conclusion: row.conclusion,
    rationale: row.rationale,
    rejected: parseRejected(row.rejected_json),
    sourceType: normalizeSource(row.source_type),
    sourceLabel: row.source_label,
    sourceConversationId: row.source_conversation_id,
    sourceExcerpt: row.source_excerpt,
    createdAt: row.created_at,
    requirementIds,
  };
}

/** 组织决策的记忆文本（供 search_memory 语义召回） */
function buildDecisionMemory(d: {
  projectId: string;
  topic: string;
  point: string;
  anchorText: string;
  conclusion: string;
  rationale: string;
  rejected: RejectedOption[];
  sourceType: DecisionSource;
  sourceLabel: string;
  requirementIds: string[];
}): MemoryChunkInput {
  const reqTitles = d.requirementIds
    .map((id) => (getDb().prepare('SELECT title FROM requirements WHERE id=?').get(id) as { title?: string } | undefined)?.title)
    .filter(Boolean)
    .join('、');
  const sourceText =
    d.sourceType === 'meeting' ? `会议（${d.sourceLabel || '未命名会议'}）` :
    d.sourceType === 'chat' ? '需求讨论对话' : '手动记录';
  const lines = [
    `【设计决策】${d.topic}`,
  ];
  if (d.point) lines.push(`需求点：${d.point}`);
  if (d.anchorText) lines.push(`文档原文：${d.anchorText}`);
  lines.push(`结论：${d.conclusion}`, `理由：${d.rationale}`);
  if (d.rejected.length) {
    lines.push('被否决方案：' + d.rejected.map((r) => `「${r.option}」（${r.reason}）`).join('；'));
  }
  lines.push(`来源：${sourceText}${reqTitles ? `；关联需求：${reqTitles}` : ''}`);
  return {
    projectId: d.projectId,
    sourceType: 'design_decision',
    sourceId: '', // 调用方填决策 id（幂等更新靠先删后写）
    memoryType: 'decision',
    content: lines.join('\n'),
    metadata: { requirementIds: d.requirementIds, sourceType: d.sourceType, sourceLabel: d.sourceLabel },
  };
}

/** 写入/刷新决策的项目记忆（embedding 失败不阻断，saveMemory 内部兜底） */
function syncDecisionMemory(d: DesignDecision): void {
  const chunk = buildDecisionMemory(d);
  chunk.sourceId = d.id;
  void saveMemory(chunk);
}

export function createDecision(input: DecisionInput): DesignDecision {
  const topic = input.topic.trim();
  if (!topic) throw new Error('决策议题必填');
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const requirementIds = filterValidRequirementIds(
    input.projectId,
    (input.requirementIds || []).map((x) => String(x)).filter(Boolean)
  );

  const db = getDb();
  db.prepare(
    `INSERT INTO decisions
       (id, project_id, topic, point, anchor_text, conclusion, rationale, rejected_json,
        source_type, source_label, source_conversation_id, source_excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.projectId,
    topic,
    (input.point || '').trim(),
    (input.anchorText || '').trim(),
    input.conclusion || '',
    input.rationale || '',
    JSON.stringify(input.rejected || []),
    normalizeSource(input.sourceType),
    input.sourceLabel || '',
    input.sourceConversationId || null,
    input.sourceExcerpt || '',
    createdAt
  );

  const linkStmt = db.prepare(
    'INSERT INTO decision_links (decision_id, requirement_id) VALUES (?, ?)'
  );
  for (const rid of requirementIds) linkStmt.run(id, rid);

  touchProject(input.projectId);
  const created = getDecision(id)!;
  syncDecisionMemory(created);
  return created;
}

export function getDecision(id: string): DesignDecision | undefined {
  const row = getDb()
    .prepare('SELECT * FROM decisions WHERE id=?')
    .get(id) as DecisionRow | undefined;
  return row ? rowToModel(row) : undefined;
}

/** 项目下全部决策（默认按时间正序，脉络天然按演进排列） */
export function listDecisions(projectId: string): DesignDecision[] {
  const rows = getDb()
    .prepare('SELECT * FROM decisions WHERE project_id=? ORDER BY created_at ASC')
    .all(projectId) as unknown as DecisionRow[];
  return rows.map(rowToModel);
}

/** 某条需求关联的决策（需求详情的决策脉络用） */
export function listDecisionsByRequirement(requirementId: string): DesignDecision[] {
  const rows = getDb()
    .prepare(
      `SELECT d.* FROM decisions d
       JOIN decision_links l ON l.decision_id = d.id
       WHERE l.requirement_id=?
       ORDER BY d.created_at ASC`
    )
    .all(requirementId) as unknown as DecisionRow[];
  return rows.map(rowToModel);
}

export function updateDecision(
  id: string,
  patch: {
    topic?: string;
    point?: string;
    anchorText?: string;
    conclusion?: string;
    rationale?: string;
    rejected?: RejectedOption[];
    sourceType?: DecisionSource;
    sourceLabel?: string;
    sourceExcerpt?: string;
    requirementIds?: string[];
  }
): DesignDecision | undefined {
  const current = getDecision(id);
  if (!current) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.topic !== undefined) { fields.push('topic=?'); values.push(patch.topic.trim()); }
  if (patch.point !== undefined) { fields.push('point=?'); values.push(patch.point.trim()); }
  if (patch.anchorText !== undefined) { fields.push('anchor_text=?'); values.push(patch.anchorText.trim()); }
  if (patch.conclusion !== undefined) { fields.push('conclusion=?'); values.push(patch.conclusion); }
  if (patch.rationale !== undefined) { fields.push('rationale=?'); values.push(patch.rationale); }
  if (patch.rejected !== undefined) { fields.push('rejected_json=?'); values.push(JSON.stringify(patch.rejected)); }
  if (patch.sourceType !== undefined) { fields.push('source_type=?'); values.push(normalizeSource(patch.sourceType)); }
  if (patch.sourceLabel !== undefined) { fields.push('source_label=?'); values.push(patch.sourceLabel); }
  if (patch.sourceExcerpt !== undefined) { fields.push('source_excerpt=?'); values.push(patch.sourceExcerpt); }

  const db = getDb();
  if (fields.length > 0) {
    db.prepare(`UPDATE decisions SET ${fields.join(', ')} WHERE id=?`).run(...(values as any[]), id);
  }

  if (patch.requirementIds) {
    const valid = filterValidRequirementIds(current.projectId, patch.requirementIds);
    db.prepare('DELETE FROM decision_links WHERE decision_id=?').run(id);
    const linkStmt = db.prepare(
      'INSERT INTO decision_links (decision_id, requirement_id) VALUES (?, ?)'
    );
    for (const rid of valid) linkStmt.run(id, rid);
  }

  touchProject(current.projectId);
  const updated = getDecision(id);
  if (updated) {
    // 决策内容/关联变了：先删旧记忆再写新的（embedding 内容随之刷新）
    deleteMemoryChunksBySource('design_decision', id);
    syncDecisionMemory(updated);
  }
  return updated;
}

export function deleteDecision(id: string): boolean {
  const current = getDecision(id);
  if (!current) return false;
  const db = getDb();
  db.prepare('DELETE FROM decision_links WHERE decision_id=?').run(id);
  db.prepare('DELETE FROM decisions WHERE id=?').run(id);
  deleteMemoryChunksBySource('design_decision', id);
  touchProject(current.projectId);
  return true;
}
