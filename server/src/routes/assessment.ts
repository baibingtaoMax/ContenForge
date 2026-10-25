// ============================================
// 路由：聊天(SSE) + 项目/对话管理 + 评估 + 企业
// ============================================

import type { FastifyInstance } from 'fastify';
import { handleChat } from '../orchestrator/chat.js';
import { runAssessment } from '../orchestrator/engine.js';
import {
  listProjects,
  getProject,
  createProject,
  renameProject,
  deleteProject,
  listConversations,
  createConversation,
  getConversation,
  renameConversation,
  deleteConversation,
  listUnassignedConversations,
  assignConversationToProject,
  getMessages,
  appendMessage,
  listProjectEntities,
  addProjectEntity,
  removeProjectEntity,
  listAssessments,
  getAssessment,
  getProjectArchive,
} from '../store/database.js';
import { getEnterpriseList } from '../tools/index.js';
import type { SSEEvent, ProjectEntityRole } from '../types/index.js';
import { AbortedError } from '../llm/client.js';
import { emitToHub, subscribeHub, finishHub, migrateHub, resetHub, isHubRunning, listRunningHubs } from '../orchestrator/streamHub.js';

// 运行中的评估：conversationId → AbortController
const activeRuns = new Map<string, AbortController>();

export async function assessmentRoutes(app: FastifyInstance) {
  // ---------- 企业 ----------
  app.get('/api/enterprises', async () => {
    return { enterprises: getEnterpriseList() };
  });

  // ---------- 项目（文件夹） ----------
  app.get('/api/projects', async () => {
    const projects = listProjects().map((p) => {
      const entities = listProjectEntities(p.id);
      const archive = getProjectArchive(p.id);
      return {
        ...p,
        entityCount: entities.length,
        assessmentCount: archive.assessments.length,
      };
    });
    return { projects };
  });

  app.post<{ Body: { name: string; description?: string } }>(
    '/api/projects',
    async (request, reply) => {
      const { name, description = '' } = request.body || {};
      if (!name?.trim()) return reply.status(400).send({ error: '项目名称不能为空' });
      const id = crypto.randomUUID();
      createProject(id, name.trim(), description);
      return { id, name, description };
    }
  );

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const project = getProject(request.params.id);
    if (!project) return reply.status(404).send({ error: '项目不存在' });
    const entities = listProjectEntities(project.id);
    const entList = getEnterpriseList();
    const archive = getProjectArchive(project.id);
    return {
      ...project,
      entities: entities.map((e) => ({
        enterpriseId: e.enterprise_id,
        name: entList.find((x) => x.id === e.enterprise_id)?.name || e.enterprise_id,
        role: e.role,
      })),
      archive,
      conversations: listConversations(project.id),
    };
  });

  app.put<{ Params: { id: string }; Body: { name: string; description?: string } }>(
    '/api/projects/:id',
    async (request, reply) => {
      if (!getProject(request.params.id)) return reply.status(404).send({ error: '项目不存在' });
      const { name, description = '' } = request.body || {};
      renameProject(request.params.id, name, description);
      return { ok: true };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    if (!getProject(request.params.id)) return reply.status(404).send({ error: '项目不存在' });
    deleteProject(request.params.id);
    return { ok: true };
  });

  // 项目企业成员
  app.post<{
    Params: { id: string };
    Body: { enterpriseId: string; role: ProjectEntityRole };
  }>('/api/projects/:id/entities', async (request, reply) => {
    if (!getProject(request.params.id)) return reply.status(404).send({ error: '项目不存在' });
    const { enterpriseId, role } = request.body || {};
    addProjectEntity(request.params.id, enterpriseId, role || 'related');
    return { ok: true };
  });

  app.delete<{ Params: { id: string }; Body: { enterpriseId: string } }>(
    '/api/projects/:id/entities',
    async (request) => {
      const { enterpriseId } = request.body || {};
      removeProjectEntity(request.params.id, enterpriseId);
      return { ok: true };
    }
  );

  // ---------- 对话 ----------
  // 游离对话（不属于任何项目）
  app.get('/api/conversations', async () => {
    return { conversations: listUnassignedConversations() };
  });

  // 新建对话：可指定 projectId（归入项目），不传则为游离对话
  app.post<{ Body: { projectId?: string; title?: string } }>(
    '/api/conversations',
    async (request, reply) => {
      const { projectId, title } = request.body || {};
      if (projectId && !getProject(projectId))
        return reply.status(404).send({ error: '项目不存在' });
      const id = crypto.randomUUID();
      createConversation(id, projectId || null, title || '新对话');
      return { id, projectId: projectId || null };
    }
  );

  // 将对话归入某项目（body.projectId 传 null 表示取消归档）
  app.patch<{ Params: { id: string }; Body: { projectId: string | null } }>(
    '/api/conversations/:id/project',
    async (request, reply) => {
      if (!getConversation(request.params.id))
        return reply.status(404).send({ error: '对话不存在' });
      const { projectId } = request.body || {};
      if (projectId && !getProject(projectId))
        return reply.status(404).send({ error: '目标项目不存在' });
      assignConversationToProject(request.params.id, projectId || null);
      return { ok: true, projectId: projectId || null };
    }
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/conversations',
    async (request) => {
      return { conversations: listConversations(request.params.projectId) };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { title?: string } }>(
    '/api/projects/:projectId/conversations',
    async (request, reply) => {
      if (!getProject(request.params.projectId))
        return reply.status(404).send({ error: '项目不存在' });
      const id = crypto.randomUUID();
      createConversation(id, request.params.projectId, request.body?.title || '新对话');
      return { id, projectId: request.params.projectId };
    }
  );

  app.get<{ Params: { id: string } }>('/api/conversations/:id/messages', async (request, reply) => {
    if (!getConversation(request.params.id))
      return reply.status(404).send({ error: '对话不存在' });
    return { messages: getMessages(request.params.id) };
  });

  // 追加一条用户消息（用于附件上传，不触发 LLM）
  app.post<{
    Params: { id: string };
    Body: { content?: string; attachments?: unknown[] };
  }>('/api/conversations/:id/messages', async (request, reply) => {
    if (!getConversation(request.params.id))
      return reply.status(404).send({ error: '对话不存在' });
    const { content = '', attachments = [] } = request.body || {};
    appendMessage(request.params.id, 'user', content, attachments);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (request) => {
    deleteConversation(request.params.id);
    return { ok: true };
  });

  // 重命名对话
  app.patch<{ Params: { id: string }; Body: { title?: string } }>(
    '/api/conversations/:id',
    async (request, reply) => {
      if (!getConversation(request.params.id))
        return reply.status(404).send({ error: '对话不存在' });
      const title = (request.body?.title || '').trim();
      if (!title) return reply.status(400).send({ error: '标题不能为空' });
      renameConversation(request.params.id, title);
      return { ok: true };
    }
  );

  // ---------- 把一个 SSE 连接接入某个 hub（回放 + 实时 + 心跳） ----------
  function attachToHub(reply: any, hubKey: string, heartbeat: { interval: NodeJS.Timeout | null }) {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.statusCode = 200;
    // 关闭 Nagle，避免小事件（补查阶段事件少）被攒包，导致前端长时间看不到流式输出
    reply.raw.socket?.setNoDelay(true);

    const write = (event: SSEEvent) => {
      if (reply.raw.writableEnded || reply.raw.destroyed) return;
      try { reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* noop */ }
    };

    const unsubscribe = subscribeHub(
      hubKey,
      (event) => {
        write(event);
        // 只有 complete 阶段的 done 才是流结束；session 阶段的 done 仅用于回传 conversationId
        if (event.type === 'done' && (event.data as any)?.stage === 'complete') {
          if (heartbeat.interval) clearInterval(heartbeat.interval);
          if (!reply.raw.writableEnded) reply.raw.end();
        }
      },
      () => {
        // hub 已结束，回放完收尾
        if (heartbeat.interval) clearInterval(heartbeat.interval);
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    );

    heartbeat.interval = setInterval(() => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        try { reply.raw.write(': heartbeat\n\n'); } catch { /* noop */ }
      }
    }, 15000);

    // 客户端断开：只取消订阅，不中止评估
    reply.raw.on('close', () => {
      unsubscribe();
      if (heartbeat.interval) clearInterval(heartbeat.interval);
    });
  }

  // ---------- 聊天（SSE） ----------
  app.post<{
    Body: { projectId?: string; conversationId?: string; message: string; attachments?: unknown[]; refArticles?: unknown[]; forceSkillId?: string };
  }>('/api/chat', async (request, reply) => {
    const { projectId, conversationId, message, attachments, refArticles, forceSkillId } = request.body || {};
    if (!message?.trim()) return reply.status(400).send({ error: '消息不能为空' });

    const controller = new AbortController();
    const convKey = conversationId || `pending-${Date.now()}`;
    activeRuns.set(convKey, controller);

    // 新一轮消息：重置该对话的 hub，清掉上一轮的事件缓存
    // （否则 60 秒内重发消息会回放旧事件并直接关闭连接）
    resetHub(convKey);

    const heartbeat = { interval: null as NodeJS.Timeout | null };
    let finishKey = convKey;
    attachToHub(reply, convKey, heartbeat);

    // 评估在后台跑，事件发往 hub（可被多个连接订阅）
    void (async () => {
      try {
        const result = await handleChat({
          projectId,
          conversationId,
          message: message.trim(),
          attachments: attachments || [],
          refArticles: refArticles || [],
          forceSkillId: forceSkillId || null,
          sendSSE: (event: SSEEvent) => emitToHub(convKey, event),
          signal: controller.signal,
        });
        // 用真实 conversationId 重新登记 + 迁移 hub
        activeRuns.delete(convKey);
        activeRuns.set(result.conversationId, controller);
        migrateHub(convKey, result.conversationId);
        finishKey = result.conversationId;
      } catch (error) {
        if (error instanceof AbortedError) {
          emitToHub(convKey, { type: 'aborted', data: { message: '已中断' } });
        } else {
          request.log.error(error, '聊天流程异常');
          emitToHub(convKey, { type: 'error', data: { message: error instanceof Error ? error.message : String(error) } });
        }
      } finally {
        activeRuns.delete(convKey);
        finishHub(finishKey);
      }
    })();
  });

  // ---------- 查询运行中的对话 ----------
  app.get('/api/chat/running', async () => {
    return { conversationIds: listRunningHubs() };
  });

  // ---------- 续传：刷新后重连到正在跑的评估（回放 + 实时） ----------
  app.get<{ Params: { conversationId: string } }>(
    '/api/chat/resume/:conversationId',
    async (request, reply) => {
      const { conversationId } = request.params;
      if (!isHubRunning(conversationId)) {
        return reply.status(404).send({ error: '该对话没有正在运行的评估' });
      }
      const heartbeat = { interval: null as NodeJS.Timeout | null };
      attachToHub(reply, conversationId, heartbeat);
    }
  );

  // ---------- 中断 ----------
  app.post<{ Body: { conversationId?: string } }>(
    '/api/chat/abort',
    async (request, reply) => {
      const { conversationId } = request.body || {};
      if (conversationId && activeRuns.has(conversationId)) {
        activeRuns.get(conversationId)!.abort();
        activeRuns.delete(conversationId);
        return { ok: true };
      }
      // 没指定就中断所有
      for (const [, c] of activeRuns) c.abort();
      activeRuns.clear();
      return { ok: true };
    }
  );

  // ---------- 直接评估（兼容，SSE） ----------
  app.post<{ Body: { enterpriseId: string; projectId?: string } }>(
    '/api/assessment/start',
    async (request, reply) => {
      const { enterpriseId, projectId } = request.body || {};
      if (!enterpriseId) return reply.status(400).send({ error: '缺少 enterpriseId' });

      const controller = new AbortController();
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.statusCode = 200;
      reply.raw.socket?.setNoDelay(true);

      const sendSSE = (event: SSEEvent): boolean => {
        if (reply.raw.writableEnded || reply.raw.destroyed) return false;
        try {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
          return true;
        } catch { return false; }
      };

      request.raw.on('close', () => controller.abort());

      try {
        await runAssessment({ enterpriseId, sendSSE, signal: controller.signal, projectId: projectId || null });
      } catch (error) {
        request.log.error(error, '评估异常');
        sendSSE({ type: 'error', data: { message: error instanceof Error ? error.message : String(error) } });
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    }
  );

  app.get('/api/assessment/list', async () => {
    return { assessments: listAssessments() };
  });

  app.get<{ Params: { id: string } }>('/api/assessment/:id', async (request, reply) => {
    const row = getAssessment(request.params.id);
    if (!row) return reply.status(404).send({ error: '评估记录不存在' });
    return row;
  });
}
