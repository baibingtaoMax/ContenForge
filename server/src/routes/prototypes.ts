// ============================================
// 原型 v2（ProtoForge）
// GET  取原型 spec/状态 ｜ POST 触发生成 ｜ POST patch 局部修改
// GET  /proto/:projectId         原型站 shell（在线，Tailwind 内联）
// GET  /api/.../prototype/export 导出自包含单文件 HTML
// ============================================

import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPrototype, getProject, getDb, upsertPrototype, deleteExternalCaptureBySpecPage } from '../store/database.js';
import { generatePrototype, generateModulePrototype, regeneratePagePrototype, checkGenerateReady, checkModuleReady, checkPageReady } from '../services/prototypeGenerator.js';
import { LAYOUTS } from '../services/prototypeCodeGen.js';
import { patchPrototypeFromAnnotations } from '../services/prototypePatcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SHELL_TEMPLATE = readFileSync(join(__dirname, '..', 'assets', 'proto-shell.html'), 'utf-8');
const TAILWIND_JS = readFileSync(join(__dirname, '..', 'assets', 'tailwind-play.js'), 'utf-8');
const ECHARTS_JS = readFileSync(join(__dirname, '..', 'assets', 'echarts.min.js'), 'utf-8');

/** 这个原型有没有页面用到图表（导出时才内联 echarts，无图表项目不摊体积） */
function specUsesCharts(spec: any): boolean {
  return (spec?.pages || []).some((p: any) => typeof p.html === 'string' && /PF\.(chart|metric)\s*\(/.test(p.html));
}

/** 组装 shell HTML：boot 注入项目 id（在线）或离线 spec */
function renderShell(opts: { projectId?: string; offlineSpec?: any; appName?: string }): string {
  const tailwindTag = `<script>\n${TAILWIND_JS}\n</script>`;
  // 离线导出：仅当页面真用到图表时内联 echarts（约 +1MB）；在线态由壳按需动态拉 /proto/echarts.min.js
  const echartsTag = opts.offlineSpec && specUsesCharts(opts.offlineSpec)
    ? `<script>\n${ECHARTS_JS}\n</script>\n`
    : '';
  let boot = '';
  if (opts.offlineSpec) {
    const specJson = JSON.stringify(opts.offlineSpec)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
    boot = `<script>window.__PF_OFFLINE__=true;window.__PF_SPEC__=${specJson};</script>`;
  } else {
    boot = `<script>window.__PF_PROJECT__=${JSON.stringify(opts.projectId || '')};</script>`;
  }
  return SHELL_TEMPLATE
    .replace('__PF_TAILWIND__', () => echartsTag + tailwindTag + '\n' + boot)
    .replace(/<title>原型<\/title>/, () => `<title>${(opts.appName || '业务原型').replace(/[<>]/g, '')}</title>`);
}

// 原型 patch 项目级锁
const patchLocks = new Set<string>();

export async function prototypeRoutes(app: FastifyInstance) {
  // 图表库（在线壳按需动态加载；静态路径必须注册在 /proto/:projectId 之前）
  app.get('/proto/echarts.min.js', async (_request, reply) => {
    reply.header('Content-Type', 'application/javascript; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(ECHARTS_JS);
  });

  // 原型站 shell（在线）
  app.get<{ Params: { projectId: string } }>('/proto/:projectId', async (request, reply) => {
    const { projectId } = request.params;
    const project = getProject(projectId);
    if (!project) return reply.status(404).send('项目不存在');
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Cache-Control', 'no-store');
    return reply.send(renderShell({ projectId, appName: project.name }));
  });

  // 取项目原型（spec + 状态）
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/prototype',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      const row = getPrototype(projectId);
      if (!row) return { status: 'empty', spec: null, error: null, updatedAt: null };
      return {
        status: row.status,
        spec: row.spec_json ? JSON.parse(row.spec_json) : null,
        error: row.error || null,
        updatedAt: row.updated_at,
      };
    }
  );

  // 触发生成（后台异步）。body.layout：PM 生成前手动指定 sidebar|topnav，默认 sidebar
  app.post<{ Params: { projectId: string }; Body: { layout?: string } }>(
    '/api/projects/:projectId/prototype/generate',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      const layout = (request.body?.layout || 'sidebar') as string;
      if (!LAYOUTS.includes(layout as any)) return reply.status(400).send({ error: `layout 非法（只能是 ${LAYOUTS.join('|')}）` });
      const current = getPrototype(projectId);
      if (current?.status === 'generating') return reply.status(409).send({ error: '正在生成中，请稍候' });
      const notReady = checkGenerateReady(projectId);
      if (notReady) return reply.status(400).send({ error: notReady });
      void generatePrototype(projectId, layout as any);
      return { status: 'generating' };
    }
  );

  // 模块增量生成
  app.post<{ Params: { projectId: string }; Body: { moduleReqId?: string } }>(
    '/api/projects/:projectId/prototype/generate-module',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      const moduleReqId = request.body?.moduleReqId;
      if (!moduleReqId) return reply.status(400).send({ error: '缺少 moduleReqId' });
      const current = getPrototype(projectId);
      if (!current?.spec_json || current.status !== 'ready') {
        return reply.status(400).send({ error: '主原型还没生成，请先在「原型」tab 生成整套原型' });
      }
      if (current.status === 'generating') return reply.status(409).send({ error: '原型正在生成中，请稍候' });
      const notReady = checkModuleReady(projectId, moduleReqId);
      if (notReady) return reply.status(400).send({ error: notReady });
      void generateModulePrototype(projectId, moduleReqId);
      return { status: 'generating' };
    }
  );

  // 单页重生成：主原型已存在时，只重做某条页面需求对应的原型页
  app.post<{ Params: { projectId: string }; Body: { requirementId?: string } }>(
    '/api/projects/:projectId/prototype/regenerate-page',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      const requirementId = request.body?.requirementId;
      if (!requirementId) return reply.status(400).send({ error: '缺少 requirementId' });
      const current = getPrototype(projectId);
      if (!current?.spec_json || current.status !== 'ready') {
        return reply.status(400).send({ error: '主原型还没生成，请先生成整套原型' });
      }
      if (current.status === 'generating') return reply.status(409).send({ error: '原型正在生成中，请稍候' });
      const notReady = checkPageReady(projectId, requirementId);
      if (notReady) return reply.status(400).send({ error: notReady });
      void regeneratePagePrototype(projectId, requirementId);
      return { status: 'generating' };
    }
  );

  // 切换原型主题（不重新生成，只改 spec.theme；壳按 spec 渲染）
  app.post<{ Params: { projectId: string }; Body: { theme?: string } }>(
    '/api/projects/:projectId/prototype/theme',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      const theme = request.body?.theme;
      if (!['saas', 'dark', 'finance', 'consumer'].includes(theme || '')) {
        return reply.status(400).send({ error: 'theme 非法' });
      }
      const row = getPrototype(projectId);
      if (!row?.spec_json) return reply.status(400).send({ error: '原型还没生成' });
      let spec: any;
      try { spec = JSON.parse(row.spec_json); } catch { return reply.status(500).send({ error: '原型数据损坏' }); }
      spec.theme = theme;
      upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: row.status, error: row.error || null });
      return { status: 'ok', theme };
    }
  );

  // 切换原型布局（不重新生成，只改 spec.layout；壳按 spec 渲染）
  app.post<{ Params: { projectId: string }; Body: { layout?: string } }>(
    '/api/projects/:projectId/prototype/layout',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      const layout = request.body?.layout;
      if (!LAYOUTS.includes(layout as any)) {
        return reply.status(400).send({ error: `layout 非法（只能是 ${LAYOUTS.join('|')}）` });
      }
      const row = getPrototype(projectId);
      if (!row?.spec_json) return reply.status(400).send({ error: '原型还没生成' });
      let spec: any;
      try { spec = JSON.parse(row.spec_json); } catch { return reply.status(500).send({ error: '原型数据损坏' }); }
      spec.layout = layout;
      upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: row.status, error: row.error || null });
      return { status: 'ok', layout };
    }
  );

  // 局部修改：评审标注 → AI 只改涉及页面
  app.post<{ Params: { projectId: string }; Body: { annotationIds?: string[] } }>(
    '/api/projects/:projectId/prototype/patch',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      if (patchLocks.has(projectId)) return reply.status(409).send({ error: '原型正在修改中，请稍候' });
      patchLocks.add(projectId);
      try {
        const ids = Array.isArray(request.body?.annotationIds) ? request.body!.annotationIds! : [];
        const result = await patchPrototypeFromAnnotations(projectId, ids);
        if (!result.ok) return reply.status(400).send({ error: result.error });
        return {
          ok: true,
          changedPages: result.changedPages,
          appliedCount: result.appliedCount,
          failedCount: result.failedCount || 0,
          dataChanged: result.dataChanged || 0,
          needsReqCount: result.needsReqCount || 0,
          modes: result.modes,
          appliedItems: result.appliedItems || [],
        };
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : String(e) });
      } finally {
        patchLocks.delete(projectId);
      }
    }
  );

  // 导出自包含单文件 HTML（Tailwind + spec + 全部页面代码内联，双击即可打开，无需后端）
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/prototype/export',
    async (request, reply) => {
      const { projectId } = request.params;
      const project = getProject(projectId);
      if (!project) return reply.status(404).send({ error: '项目不存在' });
      const row = getPrototype(projectId);
      if (!row || row.status !== 'ready' || !row.spec_json) {
        return reply.status(400).send({ error: '原型还没生成或未就绪' });
      }
      const spec = JSON.parse(row.spec_json);
      const html = renderShell({ offlineSpec: spec, appName: spec.appName || project.name });
      const fname = encodeURIComponent(`${spec.appName || project.name || '原型'}-原型.html`);
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
      return reply.send(html);
    }
  );

  // 清空原型
  // 删除单个站外采集页（仅 source=external；级联清采集包，保留该 URL 意见）
  app.delete<{ Params: { projectId: string; pageId: string } }>(
    '/api/projects/:projectId/prototype/pages/:pageId',
    async (request, reply) => {
      const { projectId, pageId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      const row = getPrototype(projectId);
      if (!row?.spec_json) return reply.status(400).send({ error: '原型还没生成' });
      let spec: any;
      try { spec = JSON.parse(row.spec_json); } catch { return reply.status(500).send({ error: '原型数据损坏' }); }
      const page = (spec.pages || []).find((p: any) => p.id === pageId);
      if (!page) return reply.status(404).send({ error: '页面不存在' });
      if (!page.source || page.source.type !== 'external') {
        return reply.status(400).send({ error: '只能删除站外采集页，需求页面请重新生成' });
      }
      // 级联清采集包（意见按 project+page_url 独立保留）
      const captureDeleted = deleteExternalCaptureBySpecPage(projectId, pageId);
      spec.pages = (spec.pages || []).filter((p: any) => p.id !== pageId);
      spec.nav = (spec.nav || []).filter((n: any) => n.pageId !== pageId);
      if (spec.pageStatus) { delete spec.pageStatus[pageId]; }
      spec.patchedAt = new Date().toISOString();
      upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: row.status, error: row.error || null });
      return { ok: true, pageId, title: page.title || '', remainingPages: spec.pages.length, captureDeleted };
    }
  );

  app.delete<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/prototype',
    async (request, reply) => {
      const { projectId } = request.params;
      if (!getProject(projectId)) return reply.status(404).send({ error: '项目不存在' });
      getDb().prepare('DELETE FROM prototypes WHERE project_id=?').run(projectId);
      return { ok: true };
    }
  );
}
