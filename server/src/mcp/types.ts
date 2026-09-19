// ============================================
// MCP 模块类型定义
// ============================================

/** 传输类型（v1 仅支持 streamableHttp） */
export type McpTransport = 'http';

/** MCP 数据源连接状态 */
export type McpServerStatus = 'unknown' | 'connecting' | 'connected' | 'error';

/** mcp_servers 表行 */
export interface McpServerRow {
  id: string;
  name: string;
  slug: string;
  transport: McpTransport;
  url: string;
  headers_json: string; // JSON 字符串，含鉴权头
  enabled: number; // 0/1
  status: McpServerStatus;
  last_error: string | null;
  tool_count: number;
  created_at: string;
  updated_at: string;
}

/** mcp_tools 表行 */
export interface McpToolRow {
  id: string;
  server_id: string;
  tool_name: string;
  display_name: string;
  description: string;
  input_schema_json: string;
  enabled: number; // 0/1（白名单总开关）
  bound_roles_json: string; // JSON 数组字符串
  created_at: string;
  updated_at: string;
}

/** mcp_call_logs 表行 */
export interface McpCallLogRow {
  id: string;
  server_id: string;
  server_name: string;
  tool_name: string;
  bound_tool_name: string;
  args_json: string;
  result_preview: string | null;
  success: number; // 0/1
  error_text: string | null;
  duration_ms: number;
  project_id: string | null;
  conversation_id: string | null;
  enterprise_id: string | null;
  created_at: string;
}

/** 新建/更新 server 的入参 */
export interface McpServerInput {
  name: string;
  slug?: string;
  transport?: McpTransport;
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

/** 更新工具白名单/角色绑定入参 */
export interface McpToolConfigInput {
  enabled?: boolean;
  boundRoles?: string[];
}

/** 前端展示用的脱敏 server（headers 中鉴权值打码） */
export interface McpServerMasked extends Omit<McpServerRow, 'headers_json'> {
  headers: Record<string, string>;
  hasAuthHeader: boolean;
}
