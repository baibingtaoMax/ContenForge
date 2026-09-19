// ============================================
// MCP 数据访问层（mcp_servers / mcp_tools / mcp_call_logs）
// ============================================

import { v4 as uuid } from 'uuid';
import { getDb } from './database.js';
import type {
  McpServerRow,
  McpToolRow,
  McpCallLogRow,
  McpServerInput,
} from '../mcp/types.js';

const now = () => new Date().toISOString();

// ============================================
// mcp_servers
// ============================================

export function listMcpServers(): McpServerRow[] {
  return getDb()
    .prepare('SELECT * FROM mcp_servers ORDER BY created_at ASC')
    .all() as unknown as McpServerRow[];
}

export function getMcpServer(id: string): McpServerRow | undefined {
  return getDb()
    .prepare('SELECT * FROM mcp_servers WHERE id = ?')
    .get(id) as unknown as McpServerRow | undefined;
}

export function getMcpServerBySlug(slug: string): McpServerRow | undefined {
  return getDb()
    .prepare('SELECT * FROM mcp_servers WHERE slug = ?')
    .get(slug) as unknown as McpServerRow | undefined;
}

export function listEnabledMcpServers(): McpServerRow[] {
  return getDb()
    .prepare("SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY created_at ASC")
    .all() as unknown as McpServerRow[];
}

export function createMcpServer(input: McpServerInput): McpServerRow {
  const d = getDb();
  const id = uuid();
  const ts = now();
  const slug = (input.slug || slugify(input.name)).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`slug 不合法（仅允许小写字母、数字、短横）：${slug}`);
  }
  const existing = d.prepare('SELECT 1 FROM mcp_servers WHERE slug = ?').get(slug);
  if (existing) throw new Error(`slug 已存在：${slug}`);

  d.prepare(
    `INSERT INTO mcp_servers
       (id, name, slug, transport, url, headers_json, enabled, status, last_error, tool_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', NULL, 0, ?, ?)`
  ).run(
    id,
    input.name,
    slug,
    input.transport || 'http',
    input.url,
    JSON.stringify(input.headers || {}),
    input.enabled === false ? 0 : 1,
    ts,
    ts
  );
  return getMcpServer(id)!;
}

export interface McpServerUpdate {
  name?: string;
  slug?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  /** 合并模式：true 则把 headers 合并进现有 headers；false 则整体替换 */
  mergeHeaders?: boolean;
}

export function updateMcpServer(id: string, patch: McpServerUpdate): McpServerRow {
  const d = getDb();
  const current = getMcpServer(id);
  if (!current) throw new Error(`MCP server 不存在：${id}`);

  const name = patch.name ?? current.name;
  const slug = (patch.slug ?? current.slug).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`slug 不合法：${slug}`);
  }
  if (slug !== current.slug) {
    const dup = d.prepare('SELECT 1 FROM mcp_servers WHERE slug = ? AND id != ?').get(slug, id);
    if (dup) throw new Error(`slug 已存在：${slug}`);
  }
  const url = patch.url ?? current.url;
  const enabled = patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0;

  let headers = JSON.parse(current.headers_json) as Record<string, string>;
  if (patch.headers) {
    headers = patch.mergeHeaders ? { ...headers, ...patch.headers } : patch.headers;
  }

  d.prepare(
    `UPDATE mcp_servers
     SET name=?, slug=?, url=?, headers_json=?, enabled=?, updated_at=?
     WHERE id=?`
  ).run(name, slug, url, JSON.stringify(headers), enabled, now(), id);

  return getMcpServer(id)!;
}

/** 仅更新连接状态/错误（由 registry 在连接后回写） */
export function updateMcpServerStatus(
  id: string,
  status: McpServerRow['status'],
  lastError: string | null
): void {
  getDb()
    .prepare('UPDATE mcp_servers SET status=?, last_error=?, updated_at=? WHERE id=?')
    .run(status, lastError, now(), id);
}

export function deleteMcpServer(id: string): void {
  getDb().prepare('DELETE FROM mcp_servers WHERE id=?').run(id);
}

// ============================================
// mcp_tools
// ============================================

export function listMcpToolsByServer(serverId: string): McpToolRow[] {
  return getDb()
    .prepare('SELECT * FROM mcp_tools WHERE server_id=? ORDER BY tool_name ASC')
    .all(serverId) as unknown as McpToolRow[];
}

export function listAllMcpTools(): McpToolRow[] {
  return getDb()
    .prepare('SELECT * FROM mcp_tools ORDER BY server_id, tool_name')
    .all() as unknown as McpToolRow[];
}

/**
 * 列出所有「已启用」的 MCP 工具（server.enabled=1 且 tool.enabled=1）。
 * 这些工具会被注入平台工具池。
 */
export function listEnabledMcpTools(): Array<McpToolRow & { server_slug: string; server_name: string; server_url: string; server_headers_json: string }> {
  return getDb()
    .prepare(
      `SELECT t.*, s.slug AS server_slug, s.name AS server_name, s.url AS server_url, s.headers_json AS server_headers_json
       FROM mcp_tools t
       JOIN mcp_servers s ON s.id = t.server_id
       WHERE s.enabled = 1 AND t.enabled = 1
       ORDER BY s.created_at, t.tool_name`
    )
    .all() as unknown as Array<
    McpToolRow & { server_slug: string; server_name: string; server_url: string; server_headers_json: string }
  >;
}

/** 列出某角色绑定的已启用 MCP 工具 */
export function listEnabledMcpToolsForRole(role: string): Array<McpToolRow & { server_slug: string; server_name: string }> {
  // bound_roles_json 是 JSON 数组，用 LIKE 做粗匹配后在内存精确过滤
  const rows = listEnabledMcpTools();
  return rows.filter((r) => {
    let roles: string[] = [];
    try {
      roles = JSON.parse(r.bound_roles_json);
    } catch {
      roles = [];
    }
    return roles.includes(role);
  });
}

export function getMcpTool(id: string): McpToolRow | undefined {
  return getDb()
    .prepare('SELECT * FROM mcp_tools WHERE id=?')
    .get(id) as unknown as McpToolRow | undefined;
}

/**
 * 同步某 server 发现到的工具列表（upsert），并回写 tool_count。
 * 新工具默认 enabled=0（白名单默认关闭，需手动勾选）。
 * server 上已不存在的工具会被删除。
 */
/** 从工具描述提取简短显示名（取第一个分句，最多 20 字） */
function deriveDisplayName(name: string, description?: string): string {
  if (description) {
    // 取第一个逗号/句号/分号前的文字，去掉「查询」「获取」等前缀后保留核心
    const first = description.split(/[，,。;；:：、\n]/)[0]?.trim();
    if (first && first.length <= 20 && /[\u4e00-\u9fff]/.test(first)) return first;
    if (first && first.length > 20) return first.slice(0, 20);
  }
  return name;
}

export function syncMcpTools(
  serverId: string,
  remoteTools: Array<{ name: string; description?: string; inputSchema?: unknown }>
): void {
  const d = getDb();
  const existing = listMcpToolsByServer(serverId);
  const existingByName = new Map(existing.map((t) => [t.tool_name, t]));
  const remoteNames = new Set(remoteTools.map((t) => t.name));
  const ts = now();

  const insert = d.prepare(
    `INSERT INTO mcp_tools
       (id, server_id, tool_name, display_name, description, input_schema_json, enabled, bound_roles_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, ?)`
  );
  const update = d.prepare(
    `UPDATE mcp_tools SET description=?, input_schema_json=?, updated_at=? WHERE id=?`
  );

  d.exec('BEGIN');
  try {
    for (const rt of remoteTools) {
      const ex = existingByName.get(rt.name);
      if (ex) {
        // 已存在：只更新描述和 schema，不覆盖用户自定义的 display_name
        update.run(
          rt.description || '',
          JSON.stringify(rt.inputSchema || {}),
          ts,
          ex.id
        );
      } else {
        insert.run(
          uuid(),
          serverId,
          rt.name,
          deriveDisplayName(rt.name, rt.description),
          rt.description || '',
          JSON.stringify(rt.inputSchema || {}),
          ts,
          ts
        );
      }
    }
    // 删除远端已不存在的工具
    for (const ex of existing) {
      if (!remoteNames.has(ex.tool_name)) {
        d.prepare('DELETE FROM mcp_tools WHERE id=?').run(ex.id);
      }
    }
    const count = remoteTools.length;
    d.prepare('UPDATE mcp_servers SET tool_count=?, updated_at=? WHERE id=?').run(count, ts, serverId);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** 更新工具白名单开关 / 角色绑定 */
export function updateMcpTool(
  id: string,
  patch: { enabled?: boolean; boundRoles?: string[]; displayName?: string }
): McpToolRow {
  const d = getDb();
  const current = getMcpTool(id);
  if (!current) throw new Error(`MCP tool 不存在：${id}`);
  const enabled = patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0;
  const boundRoles =
    patch.boundRoles === undefined ? current.bound_roles_json : JSON.stringify(patch.boundRoles);
  const displayName = patch.displayName === undefined ? current.display_name : patch.displayName;
  d.prepare('UPDATE mcp_tools SET enabled=?, bound_roles_json=?, display_name=?, updated_at=? WHERE id=?')
    .run(enabled, boundRoles, displayName, now(), id);
  return getMcpTool(id)!;
}

// ============================================
// mcp_call_logs
// ============================================

export interface CreateCallLogInput {
  serverId: string;
  serverName: string;
  toolName: string;
  boundToolName: string;
  args: unknown;
  resultPreview?: string | null;
  success: boolean;
  errorText?: string | null;
  durationMs: number;
  projectId?: string | null;
  conversationId?: string | null;
  enterpriseId?: string | null;
}

export function insertMcpCallLog(input: CreateCallLogInput): McpCallLogRow {
  const id = uuid();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO mcp_call_logs
         (id, server_id, server_name, tool_name, bound_tool_name, args_json, result_preview,
          success, error_text, duration_ms, project_id, conversation_id, enterprise_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.serverId,
      input.serverName,
      input.toolName,
      input.boundToolName,
      JSON.stringify(input.args ?? {}),
      input.resultPreview ?? null,
      input.success ? 1 : 0,
      input.errorText ?? null,
      input.durationMs,
      input.projectId ?? null,
      input.conversationId ?? null,
      input.enterpriseId ?? null,
      ts
    );
  return getMcpCallLog(id)!;
}

export function getMcpCallLog(id: string): McpCallLogRow | undefined {
  return getDb()
    .prepare('SELECT * FROM mcp_call_logs WHERE id=?')
    .get(id) as unknown as McpCallLogRow | undefined;
}

export interface ListCallLogsQuery {
  serverId?: string;
  projectId?: string;
  limit?: number;
  offset?: number;
}

export function listMcpCallLogs(q: ListCallLogsQuery = {}): McpCallLogRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (q.serverId) {
    conditions.push('server_id = ?');
    params.push(q.serverId);
  }
  if (q.projectId) {
    conditions.push('project_id = ?');
    params.push(q.projectId);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(q.limit ?? 100, 500);
  const offset = q.offset ?? 0;
  return getDb()
    .prepare(`SELECT * FROM mcp_call_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as McpCallLogRow[];
}

// ============================================
// 工具函数
// ============================================

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
