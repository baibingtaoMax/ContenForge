// ============================================
// 需求清单 CRUD（ProtoForge）
// ============================================

import type { FastifyInstance } from 'fastify';
import {
  createRequirement,
  listRequirements,
  getRequirement,
  updateRequirement,
  deleteRequirement,
  ensureParentModule,
  listRequirementVersions,
  getRequirementVersion,
  snapshotRequirement,
} from '../store/database.js';
import { getProject } from '../store/database.js';

export async function requirementRoutes(app: FastifyInstance) {
  // 列出项目下所有需求（默认不含需求池 idea；?includeIdeas=1 返回全部）
  app.get<{ Params: { projectId: string }; Querystring: { includeIdeas?: string } }>(
    '/api/projects/:projectId/requirements',
    async (request) => listRequirements(request.params.projectId, { includeIdeas: request.query.includeIdeas === '1' })
  );

  // 手动新建需求
  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/requirements',
    async (request, reply) => {
      if (!getProject(request.params.projectId)) {
        return reply.status(404).send({ error: '项目不存在' });
      }
      const { title, docMd = '', status, kind = 'module', parentId = null, summary = '', poolStatus, urgent = false, important = false, relatedModuleId = null, proposer = '' } = (request.body || {}) as {
        title?: string;
        docMd?: string;
        status?: 'proposed' | 'confirmed';
        kind?: 'module' | 'page' | 'idea';
        parentId?: string | null;
        summary?: string;
        poolStatus?: 'raw' | 'ready' | 'shelved';
        urgent?: boolean;
        important?: boolean;
        relatedModuleId?: string | null;
        proposer?: string;
      };
      if (!title?.trim()) return reply.status(400).send({ error: '需求标题必填' });
      const req = createRequirement({
        id: crypto.randomUUID(),
        projectId: request.params.projectId,
        title: title.trim(),
        docMd,
        status,
        kind,
        parentId,
        summary,
        poolStatus,
        urgent,
        important,
        relatedModuleId,
        proposer,
      });
      return req;
    }
  );

  app.get<{ Params: { rid: string } }>('/api/requirements/:rid', async (request, reply) => {
    const r = getRequirement(request.params.rid);
    if (!r) return reply.status(404).send({ error: '需求不存在' });
    return r;
  });

  app.put<{ Params: { rid: string } }>('/api/requirements/:rid', async (request, reply) => {
    if (!getRequirement(request.params.rid)) {
      return reply.status(404).send({ error: '需求不存在' });
    }
    const body = (request.body || {}) as Record<string, unknown>;
    return updateRequirement(request.params.rid, {
      title: body.title as string | undefined,
      status: body.status as 'proposed' | 'confirmed' | undefined,
      docMd: (body.docMd ?? body.doc_md) as string | undefined,
      kind: body.kind as 'module' | 'page' | 'idea' | undefined,
      parentId: (body.parentId ?? body.parent_id) as string | null | undefined,
      summary: body.summary as string | undefined,
      poolStatus: (body.poolStatus ?? body.pool_status) as '' | 'raw' | 'ready' | 'shelved' | undefined,
      urgent: body.urgent as boolean | undefined,
      important: body.important as boolean | undefined,
      relatedModuleId: (body.relatedModuleId ?? body.related_module_id) as string | null | undefined,
      proposer: body.proposer as string | undefined,
    }, 'user');
  });

  // 版本列表（含完整快照，供前端 diff）
  app.get<{ Params: { rid: string } }>('/api/requirements/:rid/versions', async (request, reply) => {
    if (!getRequirement(request.params.rid)) {
      return reply.status(404).send({ error: '需求不存在' });
    }
    return { versions: listRequirementVersions(request.params.rid) };
  });

  // 手动存一版（内容与上一版完全相同则跳过）
  app.post<{ Params: { rid: string } }>('/api/requirements/:rid/versions', async (request, reply) => {
    if (!getRequirement(request.params.rid)) {
      return reply.status(404).send({ error: '需求不存在' });
    }
    const { note = '' } = (request.body || {}) as { note?: string };
    const no = snapshotRequirement(request.params.rid, 'manual', { actor: 'user', note: note.slice(0, 80) });
    if (no === null) return reply.status(409).send({ error: '与上一版完全相同，无需重复存版' });
    return { versionNo: no };
  });

  // 回滚到某一版（恢复文档内容，不动状态；回滚本身存一版）
  app.post<{ Params: { rid: string; vid: string } }>(
    '/api/requirements/:rid/versions/:vid/restore',
    async (request, reply) => {
      const req = getRequirement(request.params.rid);
      if (!req) return reply.status(404).send({ error: '需求不存在' });
      const v = getRequirementVersion(request.params.vid);
      if (!v || v.requirement_id !== request.params.rid) {
        return reply.status(404).send({ error: '版本不存在' });
      }
      updateRequirement(request.params.rid, { docMd: v.doc_md, title: v.title }, 'user');
      snapshotRequirement(request.params.rid, 'restore', {
        actor: 'user',
        note: `回滚自 v${v.version_no}`,
      });
      return { ok: true, restoredFrom: v.version_no };
    }
  );

  app.delete<{ Params: { rid: string } }>('/api/requirements/:rid', async (request) => {
    deleteRequirement(request.params.rid);
    return { ok: true };
  });

  // 需求池条目原地转正为模块/页面（保留同一条记录与来源对话）
  app.post<{ Params: { rid: string } }>('/api/requirements/:rid/promote', async (request, reply) => {
    const r = getRequirement(request.params.rid);
    if (!r) return reply.status(404).send({ error: '需求不存在' });
    if (r.kind !== 'idea') return reply.status(400).send({ error: '只有需求池条目可以转正' });
    const body = (request.body || {}) as { kind?: 'module' | 'page'; title?: string; moduleId?: string; moduleTitle?: string };
    const kind = body.kind === 'page' ? 'page' : 'module';
    let parentId: string | null = null;
    if (kind === 'page') {
      const { parentId: pid } = ensureParentModule(r.project_id, {
        moduleId: body.moduleId || undefined,
        moduleTitle: body.moduleTitle || undefined,
        fallbackTitle: (body.title || r.title).replace(/(页面|登记|列表|详情|工作台)$/, ''),
        sourceConversationId: r.source_conversation_id,
      });
      parentId = pid;
    }
    const updated = updateRequirement(r.id, {
      kind,
      parentId,
      title: body.title?.trim() || r.title,
      // 想法的 markdown 说明作为需求文档初稿带过去，进清单后继续补
      docMd: r.doc_md || '',
      poolStatus: '',
      summary: '',
      urgent: false,
      important: false,
      relatedModuleId: null,
    }, 'user');
    // 转正 = 重要节点，存一版
    snapshotRequirement(r.id, 'manual', { actor: 'user', note: '从需求池转正' });
    return updated;
  });
}
