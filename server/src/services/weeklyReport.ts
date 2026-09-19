// ============================================
// 需求变更周报：区间变更聚合（确定性数据，不含 AI）
// 数据源：requirement_versions（有意变更才存版）+ decisions + annotations
// ============================================

import { getDb } from '../store/database.js';
import { listDecisions } from '../store/decisionStore.js';

export interface WeeklyRange {
  /** ISO，含 */
  from: string;
  /** ISO，不含 */
  to: string;
}

export interface WeeklyCreated {
  requirementId: string;
  title: string;
  kind: 'module' | 'page' | 'idea';
  actor: string;
  createdAt: string;
}

export interface WeeklyStatusChange {
  requirementId: string;
  title: string;
  kind: 'module' | 'page' | 'idea';
  toStatus: 'confirmed' | 'proposed';
  actor: string;
  note: string;
  versionNo: number;
  createdAt: string;
}

export interface WeeklyRevision {
  requirementId: string;
  title: string;
  kind: 'module' | 'page' | 'idea';
  trigger: 'manual' | 'ai' | 'restore';
  versionNo: number;
  actor: string;
  note: string;
  createdAt: string;
}

export interface WeeklyDecision {
  id: string;
  topic: string;
  point: string;
  conclusion: string;
  sourceLabel: string;
  createdAt: string;
}

export interface WeeklyAnnotation {
  id: string;
  pageTitle: string;
  targetLabel: string;
  content: string;
  author: string;
  createdAt: string;
}

export interface WeeklyPendingItem {
  id: string;
  title: string;
  kind: 'module' | 'page';
  updatedAt: string;
}

export interface WeeklySnapshot {
  totalModules: number;
  totalPages: number;
  confirmedModules: number;
  confirmedPages: number;
  /** 仍待确认的模块/页面（客观待收口队列） */
  pending: WeeklyPendingItem[];
}

export interface WeeklyReport {
  projectId: string;
  projectName: string;
  from: string;
  to: string;
  snapshot: WeeklySnapshot;
  stats: {
    newModules: number;
    newPages: number;
    confirmed: number;
    rejected: number; // 打回（confirmed → proposed）
    revised: number;
    promoted: number;
    decisions: number;
    newAnnotations: number;
    openAnnotations: number;
  };
  created: WeeklyCreated[];
  statusChanges: WeeklyStatusChange[];
  revisions: WeeklyRevision[];
  promotions: WeeklyRevision[];
  decisions: WeeklyDecision[];
  newAnnotations: WeeklyAnnotation[];
  openAnnotations: WeeklyAnnotation[];
}

interface VersionJoinRow {
  id: string;
  requirement_id: string;
  version_no: number;
  title: string;
  status: string;
  trigger: string;
  actor: string;
  note: string;
  created_at: string;
  req_kind: string | null;
}

const PROMOTE_NOTE = '从需求池转正';

export function buildWeeklyReport(projectId: string, range: WeeklyRange): WeeklyReport {
  const db = getDb();
  const project = db.prepare('SELECT name FROM projects WHERE id=?').get(projectId) as
    | { name: string }
    | undefined;

  const rows = db
    .prepare(
      `SELECT v.id, v.requirement_id, v.version_no, v.title, v.status, v.trigger,
              v.actor, v.note, v.created_at, r.kind AS req_kind
       FROM requirement_versions v
       LEFT JOIN requirements r ON r.id = v.requirement_id
       WHERE r.project_id = ? AND v.created_at >= ? AND v.created_at < ?
       ORDER BY v.created_at ASC`
    )
    .all(projectId, range.from, range.to) as unknown as VersionJoinRow[];

  const normKind = (k: string | null): 'module' | 'page' | 'idea' =>
    k === 'page' ? 'page' : k === 'idea' ? 'idea' : 'module';

  const created: WeeklyCreated[] = [];
  const statusChanges: WeeklyStatusChange[] = [];
  const revisions: WeeklyRevision[] = [];
  const promotions: WeeklyRevision[] = [];

  for (const v of rows) {
    const kind = normKind(v.req_kind);
    if (v.trigger === 'create') {
      // 需求池想法的 v1 不算「新增需求」
      if (kind === 'idea') continue;
      created.push({
        requirementId: v.requirement_id,
        title: v.title,
        kind,
        actor: v.actor,
        createdAt: v.created_at,
      });
    } else if (v.trigger === 'status') {
      statusChanges.push({
        requirementId: v.requirement_id,
        title: v.title,
        kind,
        toStatus: v.status === 'confirmed' ? 'confirmed' : 'proposed',
        actor: v.actor,
        note: v.note,
        versionNo: v.version_no,
        createdAt: v.created_at,
      });
    } else if (v.trigger === 'manual' || v.trigger === 'ai' || v.trigger === 'restore') {
      const rev: WeeklyRevision = {
        requirementId: v.requirement_id,
        title: v.title,
        kind,
        trigger: v.trigger,
        versionNo: v.version_no,
        actor: v.actor,
        note: v.note,
        createdAt: v.created_at,
      };
      if (v.trigger === 'manual' && v.note.includes(PROMOTE_NOTE)) {
        promotions.push(rev);
      } else {
        revisions.push(rev);
      }
    }
  }

  // 决策（区间内新拍板）
  const decisions: WeeklyDecision[] = listDecisions(projectId)
    .filter((d) => d.createdAt >= range.from && d.createdAt < range.to)
    .map((d) => ({
      id: d.id,
      topic: d.topic,
      point: d.point,
      conclusion: d.conclusion,
      sourceLabel: d.sourceLabel,
      createdAt: d.createdAt,
    }));

  // 原型意见
  const annRows = db
    .prepare(
      `SELECT id, page_title, target_label, content, author, status, created_at
       FROM annotations WHERE project_id=? ORDER BY created_at ASC`
    )
    .all(projectId) as Array<{
    id: string
    page_title: string
    target_label: string
    content: string
    author: string
    status: string
    created_at: string
  }>;
  const toAnn = (a: (typeof annRows)[number]): WeeklyAnnotation => ({
    id: a.id,
    pageTitle: a.page_title,
    targetLabel: a.target_label,
    content: a.content,
    author: a.author,
    createdAt: a.created_at,
  });
  const newAnnotations = annRows
    .filter((a) => a.created_at >= range.from && a.created_at < range.to)
    .map(toAnn);
  const openAnnotations = annRows.filter((a) => a.status === 'open').map(toAnn);

  // 项目全景快照：给综述提供“分母”和待收口队列（需求池 idea 不计入需求盘子）
  const reqRows = db
    .prepare(
      `SELECT id, title, kind, status, updated_at FROM requirements
       WHERE project_id = ? AND kind != 'idea'`
    )
    .all(projectId) as Array<{
    id: string
    title: string
    kind: string
    status: string
    updated_at: string
  }>;
  const normReqKind = (k: string): 'module' | 'page' => (k === 'page' ? 'page' : 'module');
  const modules = reqRows.filter((r) => normReqKind(r.kind) === 'module');
  const pages = reqRows.filter((r) => normReqKind(r.kind) === 'page');
  const pending: WeeklyPendingItem[] = reqRows
    .filter((r) => r.status !== 'confirmed')
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .map((r) => ({
      id: r.id,
      title: r.title,
      kind: normReqKind(r.kind),
      updatedAt: r.updated_at,
    }));
  const snapshot: WeeklySnapshot = {
    totalModules: modules.length,
    totalPages: pages.length,
    confirmedModules: modules.filter((r) => r.status === 'confirmed').length,
    confirmedPages: pages.filter((r) => r.status === 'confirmed').length,
    pending,
  };

  return {
    projectId,
    projectName: project?.name || '未命名项目',
    from: range.from,
    to: range.to,
    snapshot,
    stats: {
      newModules: created.filter((c) => c.kind === 'module').length,
      newPages: created.filter((c) => c.kind === 'page').length,
      confirmed: statusChanges.filter((s) => s.toStatus === 'confirmed').length,
      rejected: statusChanges.filter((s) => s.toStatus === 'proposed').length,
      revised: revisions.length,
      promoted: promotions.length,
      decisions: decisions.length,
      newAnnotations: newAnnotations.length,
      openAnnotations: openAnnotations.length,
    },
    created,
    statusChanges,
    revisions,
    promotions,
    decisions,
    newAnnotations,
    openAnnotations,
  };
}

/** actor 原始值 → 中文展示 */
export function formatActor(actor: string): string {
  if (!actor) return '系统';
  if (actor === 'user') return 'PM';
  if (actor.startsWith('ai:')) return 'AI';
  if (actor.startsWith('proposer:')) return `提出人 ${actor.slice('proposer:'.length)}`;
  return actor;
}
