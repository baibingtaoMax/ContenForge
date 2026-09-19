// ============================================
// 路由：Skills 管理
// ============================================

import type { FastifyInstance } from 'fastify';
import { generateSkillDraft } from '../skills/generator.js';
import { listSkillTools } from '../skills/toolCatalog.js';
import {
  loadSkills,
  listSkillSummaries,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  listLibrarySkills,
  installFromLibrary,
  installFromContent,
} from '../skills/loader.js';

export async function skillRoutes(app: FastifyInstance) {
  // 列出技能（简要，不含 body）
  // ?all=true 管理页用：包含禁用技能
  app.get<{ Querystring: { all?: string } }>('/api/skills', async (request) => {
    const includeDisabled = request.query.all === 'true' || request.query.all === '1';
    const skills = await listSkillSummaries(includeDisabled);
    return { skills };
  });

  // 获取单个技能详情（含 body）
  app.get<{ Params: { id: string } }>('/api/skills/:id', async (request, reply) => {
    const skill = await getSkill(request.params.id);
    if (!skill) return reply.status(404).send({ error: '技能不存在' });
    return skill;
  });

  // 新建技能
  app.post<{ Body: { id: string; name: string; description?: string; keywords?: string[]; tools?: string[]; body?: string; enabled?: boolean } }>(
    '/api/skills',
    async (request, reply) => {
      const b = request.body || ({} as any);
      if (!b.id || !b.name) return reply.status(400).send({ error: '缺少必填字段 id 或 name' });
      try {
        const skill = await createSkill({
          id: b.id,
          name: b.name,
          description: b.description || '',
          keywords: Array.isArray(b.keywords) ? b.keywords : [],
          tools: Array.isArray(b.tools) ? b.tools : [],
          body: b.body || '',
          enabled: b.enabled,
        });
        return reply.status(201).send(skill);
      } catch (e) {
        return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  // 更新技能（编辑内容 / 启用禁用）
  app.put<{ Params: { id: string }; Body: any }>('/api/skills/:id', async (request, reply) => {
    try {
      const skill = await updateSkill(request.params.id, request.body || {});
      return skill;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg.includes('不存在') ? 404 : 400;
      return reply.status(status).send({ error: msg });
    }
  });

  // 启用/禁用（快捷）
  app.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/api/skills/:id/toggle',
    async (request, reply) => {
      try {
        const skill = await updateSkill(request.params.id, { enabled: request.body?.enabled });
        return { id: skill.id, enabled: skill.enabled };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return reply.status(msg.includes('不存在') ? 404 : 400).send({ error: msg });
      }
    }
  );

  // 删除技能
  app.delete<{ Params: { id: string } }>('/api/skills/:id', async (request, reply) => {
    try {
      await deleteSkill(request.params.id);
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(msg.includes('不存在') ? 404 : 400).send({ error: msg });
    }
  });



  // AI 起草技能（返回草稿，不保存；前端确认后走 POST /api/skills）
  app.post<{ Body: { description: string; name?: string } }>('/api/skills/generate', async (request, reply) => {
    const b = request.body || ({} as any);
    if (!b.description || !b.description.trim()) {
      return reply.status(400).send({ error: '请描述技能需求' });
    }
    try {
      const draft = await generateSkillDraft({ description: b.description, name: b.name });
      return draft;
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 技能执行员可用工具目录（内置 + 已启用且绑定技能执行员的 MCP 工具，前端编辑器面板/工具目录展示）
  app.get('/api/skill-tools', async () => {
    return { tools: listSkillTools() };
  });

  // ===== 技能市场（内置库）=====
  // 列出可安装的内置技能
  app.get('/api/skills-library', async () => {
    const skills = await listLibrarySkills();
    return { skills };
  });

  // 从内置库安装
  app.post<{ Params: { id: string } }>('/api/skills-library/:id/install', async (request, reply) => {
    try {
      const skill = await installFromLibrary(request.params.id);
      return reply.status(201).send(skill);
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 上传 SKILL.md 安装（支持单文件）
  app.post('/api/skills/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: '未收到文件' });
    const buffer = await data.toBuffer();
    const rawContent = buffer.toString('utf-8');
    // 文件名作为 id：去掉 .md 和路径，转 kebab-case
    let id = (data.filename || 'skill.md').replace(/\.md$/i, '').split(/[\/\\]/).pop() || '';
    id = id.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (!id) return reply.status(400).send({ error: '无法从文件名确定技能 ID' });
    try {
      const skill = await installFromContent(id, rawContent);
      return reply.status(201).send(skill);
    } catch (e) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // 重新加载技能（改了 SKILL.md 不用重启）
  app.post('/api/skills/reload', async () => {
    const skills = await loadSkills(true);
    return { ok: true, count: skills.length, skills: skills.map((s) => ({ id: s.id, name: s.name })) };
  });
}
