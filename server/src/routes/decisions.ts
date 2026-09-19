// ============================================
// 设计决策 CRUD（ProtoForge）
// 挂在需求详情的「决策脉络」里，回答「为什么这么定」
// ============================================

import type { FastifyInstance } from 'fastify';
import {
  createDecision,
  listDecisions,
  listDecisionsByRequirement,
  getDecision,
  updateDecision,
  deleteDecision,
  type DecisionSource,
  type RejectedOption,
} from '../store/decisionStore.js';
import { getProject, getRequirement } from '../store/database.js';

const VALID_SOURCES: DecisionSource[] = ['meeting', 'chat', 'manual'];

interface DecisionBody {
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
  /** 标记字段是否真的出现在请求体里（部分更新语义） */
  _has?: Record<string, boolean>;
}

function parseBody(body: unknown): DecisionBody {
  const b = (body || {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  return {
    topic: typeof b.topic === 'string' ? b.topic : '',
    point: typeof b.point === 'string' ? b.point : '',
    anchorText: typeof b.anchorText === 'string' ? b.anchorText : '',
    conclusion: typeof b.conclusion === 'string' ? b.conclusion : '',
    rationale: typeof b.rationale === 'string' ? b.rationale : '',
    rejected: Array.isArray(b.rejected)
      ? (b.rejected as unknown[])
          .map((x) => ({
            option: String((x as Record<string, unknown>)?.option ?? ''),
            reason: String((x as Record<string, unknown>)?.reason ?? ''),
          }))
          .filter((x) => x.option.trim())
      : [],
    sourceType: VALID_SOURCES.includes(b.sourceType as DecisionSource)
      ? (b.sourceType as DecisionSource)
      : 'manual',
    sourceLabel: typeof b.sourceLabel === 'string' ? b.sourceLabel : '',
    sourceExcerpt: typeof b.sourceExcerpt === 'string' ? b.sourceExcerpt : '',
    requirementIds: Array.isArray(b.requirementIds)
      ? (b.requirementIds as unknown[]).map((x) => String(x))
      : undefined,
    _has: {
      topic: has('topic'), point: has('point'), anchorText: has('anchorText'), conclusion: has('conclusion'),
      rationale: has('rationale'), rejected: has('rejected'), sourceType: has('sourceType'),
      sourceLabel: has('sourceLabel'), sourceExcerpt: has('sourceExcerpt'), requirementIds: has('requirementIds'),
    },
  };
}

export async function decisionRoutes(app: FastifyInstance) {
  // 项目下全部决策
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/decisions',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) {
        return reply.status(404).send({ error: '项目不存在' });
      }
      return { decisions: listDecisions(request.params.projectId) };
    }
  );

  // 单条需求的决策脉络
  app.get<{ Params: { rid: string } }>(
    '/api/requirements/:rid/decisions',
    async (request, reply) => {
      const req = getRequirement(request.params.rid);
      if (!req) return reply.status(404).send({ error: '需求不存在' });
      return { decisions: listDecisionsByRequirement(request.params.rid) };
    }
  );

  // 手动新建决策
  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/decisions',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) {
        return reply.status(404).send({ error: '项目不存在' });
      }
      const b = parseBody(request.body);
      if (!b.topic?.trim()) return reply.status(400).send({ error: '决策议题必填' });
      try {
        const decision = createDecision({
          projectId: request.params.projectId,
          topic: b.topic!.trim(),
          point: b.point,
          anchorText: b.anchorText,
          conclusion: b.conclusion,
          rationale: b.rationale,
          rejected: b.rejected,
          sourceType: b.sourceType,
          sourceLabel: b.sourceLabel,
          sourceExcerpt: b.sourceExcerpt,
          requirementIds: b.requirementIds,
        });
        return decision;
      } catch (e) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/decisions/:id',
    async (request, reply) => {
      const decision = getDecision(request.params.id);
      if (!decision) return reply.status(404).send({ error: '决策不存在' });
      return decision;
    }
  );

  app.put<{ Params: { id: string } }>(
    '/api/decisions/:id',
    async (request, reply) => {
      if (!getDecision(request.params.id)) {
        return reply.status(404).send({ error: '决策不存在' });
      }
      const b = parseBody(request.body);
      try {
        const decision = updateDecision(request.params.id, {
          ...(b._has?.topic ? { topic: b.topic } : {}),
          ...(b._has?.point ? { point: b.point } : {}),
          ...(b._has?.anchorText ? { anchorText: b.anchorText } : {}),
          ...(b._has?.conclusion ? { conclusion: b.conclusion } : {}),
          ...(b._has?.rationale ? { rationale: b.rationale } : {}),
          ...(b._has?.rejected ? { rejected: b.rejected } : {}),
          ...(b._has?.sourceType ? { sourceType: b.sourceType } : {}),
          ...(b._has?.sourceLabel ? { sourceLabel: b.sourceLabel } : {}),
          ...(b._has?.sourceExcerpt ? { sourceExcerpt: b.sourceExcerpt } : {}),
          ...(b._has?.requirementIds ? { requirementIds: b.requirementIds } : {}),
        });
        return decision;
      } catch (e) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/api/decisions/:id',
    async (request, reply) => {
      if (!deleteDecision(request.params.id)) {
        return reply.status(404).send({ error: '决策不存在' });
      }
      return { ok: true };
    }
  );
}
