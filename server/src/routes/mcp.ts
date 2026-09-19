// ============================================
// MCP 数据源管理路由
// ============================================

import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import {
  listMcpServers,
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  listMcpToolsByServer,
  listAllMcpTools,
  updateMcpTool,
  listMcpCallLogs,
  type McpServerUpdate,
} from '../store/mcpStore.js';
import {
  testServerConnection,
  refreshServerTools,
  reloadServer,
  disconnectServer,
} from '../mcp/registry.js';
import { refreshMcpTools } from '../tools/index.js';
import type { McpServerRow, McpTransport } from '../mcp/types.js';

/** 脱敏：把 headers 中疑似鉴权的值打码 */
function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (/auth|token|key|secret/i.test(k) && v && v.length > 8) {
      out[k] = v.slice(0, 6) + '****' + v.slice(-4);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function serializeServer(row: McpServerRow) {
  let headers: Record<string, string> = {};
  try {
    headers = JSON.parse(row.headers_json);
  } catch {
    headers = {};
  }
  const { headers_json, ...rest } = row;
  void headers_json;
  return {
    ...rest,
    headers: maskHeaders(headers),
    hasAuthHeader: Object.keys(headers).some((k) => /auth|token|key|secret/i.test(k)),
  };
}

export async function mcpRoutes(app: FastifyInstance) {
  // 列出所有 MCP 数据源
  app.get('/api/mcp/servers', async () => {
    const servers = listMcpServers();
    return { servers: servers.map(serializeServer) };
  });

  // 新建 MCP 数据源
  app.post<{
    Body: {
      name: string;
      slug?: string;
      transport?: McpTransport;
      url: string;
      headers?: Record<string, string>;
      enabled?: boolean;
      autoRefresh?: boolean;
    };
  }>('/api/mcp/servers', async (request, reply) => {
    const body = request.body || ({} as any);
    if (!body.name || !body.url) {
      return reply.status(400).send({ error: 'name 和 url 必填' });
    }
    try {
      const server = createMcpServer({
        name: body.name,
        slug: body.slug,
        transport: body.transport || 'http',
        url: body.url,
        headers: body.headers,
        enabled: body.enabled,
      });

      let toolCount = 0;
      let connectError: string | null = null;
      if (server.enabled) {
        try {
          toolCount = await refreshServerTools(server.id);
          refreshMcpTools();
        } catch (err) {
          connectError = err instanceof Error ? err.message : String(err);
        }
      }

      return reply.status(201).send({
        server: serializeServer(getMcpServer(server.id)!),
        toolCount,
        connectError,
      });
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 更新 MCP 数据源
  app.put<{
    Params: { id: string };
    Body: McpServerUpdate & { headers?: Record<string, string> };
  }>('/api/mcp/servers/:id', async (request, reply) => {
    const id = request.params.id;
    const body = request.body || {};
    try {
      const patch: McpServerUpdate = {
        name: body.name,
        slug: body.slug,
        url: body.url,
        enabled: body.enabled,
        mergeHeaders: body.mergeHeaders,
      };
      if (body.headers) patch.headers = body.headers;

      const server = updateMcpServer(id, patch);
      await reloadServer(id);

      // 启用状态下自动刷新工具
      let toolCount = 0;
      if (server.enabled) {
        try {
          toolCount = await refreshServerTools(id);
        } catch {
          // 刷新失败不阻塞保存
        }
      }
      refreshMcpTools();
      return { server: serializeServer(getMcpServer(id)!), toolCount };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 删除 MCP 数据源
  app.delete<{ Params: { id: string } }>('/api/mcp/servers/:id', async (request, reply) => {
    const id = request.params.id;
    const existing = getMcpServer(id);
    if (!existing) return reply.status(404).send({ error: '数据源不存在' });
    await disconnectServer(id);
    deleteMcpServer(id);
    refreshMcpTools();
    return { message: '已删除' };
  });

  // 测试连接（可传临时配置，也可对已存在 server 测试）
  app.post<{
    Params: { id: string };
    Body: { url?: string; headers?: Record<string, string> };
  }>('/api/mcp/servers/:id/test', async (request, reply) => {
    const id = request.params.id;
    const existing = getMcpServer(id);
    if (!existing) return reply.status(404).send({ error: '数据源不存在' });

    // 允许用临时 url/headers 覆盖测试（未保存的编辑）
    const testServer: McpServerRow = {
      ...existing,
      url: request.body?.url || existing.url,
      headers_json: request.body?.headers
        ? JSON.stringify(request.body.headers)
        : existing.headers_json,
    };

    try {
      const result = await testServerConnection(testServer);
      return { connected: true, toolCount: result.toolCount };
    } catch (err) {
      return reply
        .status(200)
        .send({ connected: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 对未保存的临时配置做连通性测试
  app.post<{
    Body: { url: string; headers?: Record<string, string> };
  }>('/api/mcp/test-connection', async (request, reply) => {
    const { url, headers } = request.body || ({} as any);
    if (!url) return reply.status(400).send({ error: 'url 必填' });
    const temp: McpServerRow = {
      id: 'temp-' + uuid(),
      name: 'temp',
      slug: 'temp',
      transport: 'http',
      url,
      headers_json: JSON.stringify(headers || {}),
      enabled: 1,
      status: 'unknown',
      last_error: null,
      tool_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      const result = await testServerConnection(temp);
      return { connected: true, toolCount: result.toolCount };
    } catch (err) {
      return { connected: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 刷新某 server 的工具列表
  app.post<{ Params: { id: string } }>(
    '/api/mcp/servers/:id/refresh',
    async (request, reply) => {
      const id = request.params.id;
      const existing = getMcpServer(id);
      if (!existing) return reply.status(404).send({ error: '数据源不存在' });
      try {
        const toolCount = await refreshServerTools(id);
        refreshMcpTools();
        return { toolCount };
      } catch (err) {
        return reply
          .status(502)
          .send({ error: '刷新失败：' + (err instanceof Error ? err.message : String(err)) });
      }
    }
  );

  // 列出某 server 的工具（含白名单/角色绑定状态）
  app.get<{ Params: { id: string } }>('/api/mcp/servers/:id/tools', async (request, reply) => {
    const id = request.params.id;
    const existing = getMcpServer(id);
    if (!existing) return reply.status(404).send({ error: '数据源不存在' });
    const tools = listMcpToolsByServer(id);
    return {
      tools: tools.map((t) => ({
        ...t,
        boundRoles: safeParseArray(t.bound_roles_json),
        inputSchema: safeParseJson(t.input_schema_json),
      })),
    };
  });

  // 列出所有 MCP 工具（跨 server，便于总览）
  app.get('/api/mcp/tools', async () => {
    const tools = listAllMcpTools();
    const servers = listMcpServers();
    const serverMap = new Map(servers.map((s) => [s.id, s]));
    return {
      tools: tools.map((t) => {
        const server = serverMap.get(t.server_id);
        return {
          ...t,
          serverName: server?.name || '',
          serverSlug: server?.slug || '',
          boundRoles: safeParseArray(t.bound_roles_json),
          inputSchema: safeParseJson(t.input_schema_json),
        };
      }),
    };
  });

  // 更新工具白名单/角色绑定
  app.patch<{
    Params: { id: string };
    Body: { enabled?: boolean; boundRoles?: string[]; displayName?: string };
  }>('/api/mcp/tools/:id', async (request, reply) => {
    const id = request.params.id;
    const { enabled, boundRoles, displayName } = request.body || {};
    try {
      const tool = updateMcpTool(id, { enabled, boundRoles, displayName });
      refreshMcpTools();
      return {
        tool: {
          ...tool,
          boundRoles: safeParseArray(tool.bound_roles_json),
        },
      };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 轻量映射：boundName -> 显示名（供前端工具卡片用，不暴露 schema）
  app.get('/api/mcp/tool-names', async () => {
    const tools = listAllMcpTools();
    const servers = listMcpServers();
    const serverMap = new Map(servers.map((s) => [s.id, s]));
    const map: Record<string, { name: string; server: string }> = {};
    for (const t of tools) {
      const server = serverMap.get(t.server_id);
      if (!server) continue;
      const boundName = `mcp__${server.slug}__${t.tool_name}`;
      map[boundName] = { name: t.display_name || t.tool_name, server: server.name };
    }
    return { map };
  });

  // 查询调用日志
  app.get<{
    Querystring: { serverId?: string; projectId?: string; limit?: string; offset?: string };
  }>('/api/mcp/logs', async (request) => {
    const q = request.query || {};
    const logs = listMcpCallLogs({
      serverId: q.serverId,
      projectId: q.projectId,
      limit: q.limit ? Number(q.limit) : 100,
      offset: q.offset ? Number(q.offset) : 0,
    });
    return {
      logs: logs.map((l) => ({
        ...l,
        args: safeParseJson(l.args_json),
      })),
    };
  });
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function safeParseArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
