// ============================================
// MCP 工具适配器：把 MCP tool 转成平台内部 ToolDefinition + handler
// ============================================

import type { ToolDefinition, ToolHandler, ToolContext } from '../types/index.js';
import { listEnabledMcpTools, listEnabledMcpToolsForRole, insertMcpCallLog } from '../store/mcpStore.js';
import { getClient } from './registry.js';
import type { McpToolRow } from './types.js';

/** 工具名前缀，避免与平台内置工具撞名 */
export const MCP_TOOL_PREFIX = 'mcp__';

/** 构造平台内部工具名：mcp__<slug>__<原工具名> */
export function buildBoundToolName(slug: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${slug}__${toolName}`;
}

/** 从内部工具名解析出 serverId（需反查）与原工具名 */
export function parseBoundToolName(boundName: string): { slug: string; toolName: string } | null {
  if (!boundName.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = boundName.slice(MCP_TOOL_PREFIX.length);
  const idx = rest.indexOf('__');
  if (idx < 0) return null;
  return { slug: rest.slice(0, idx), toolName: rest.slice(idx + 2) };
}

function isMcpTool(boundName: string): boolean {
  return boundName.startsWith(MCP_TOOL_PREFIX);
}

/** 结果文本最大长度（超出截断，避免灌爆 LLM 上下文） */
const MAX_RESULT_CHARS = 12000;

interface EnabledTool extends McpToolRow {
  server_slug: string;
  server_name: string;
}

/**
 * 取某角色绑定的全部已启用 MCP 工具，转成平台 ToolDefinition。
 * 由 tools/index.ts 在装配角色工具时调用。
 */
export function getMcpToolDefinitionsForRole(role: string): ToolDefinition[] {
  const tools = listEnabledMcpToolsForRole(role) as EnabledTool[];
  return tools.map((t) => buildDefinition(t));
}

/** 取所有已启用 MCP 工具定义（供工具池/调试用） */
export function getAllEnabledMcpToolDefinitions(): ToolDefinition[] {
  const tools = listEnabledMcpTools() as EnabledTool[];
  return tools.map((t) => buildDefinition(t));
}

function buildDefinition(t: EnabledTool): ToolDefinition {
  let schema: Record<string, unknown> = {};
  try {
    schema = JSON.parse(t.input_schema_json || '{}');
  } catch {
    schema = { type: 'object', properties: {} };
  }
  // MCP inputSchema 已是 JSON Schema；OpenAI function parameters 要求 type:object
  if (!schema.type) schema = { ...schema, type: 'object' };

  return {
    type: 'function',
    function: {
      name: buildBoundToolName(t.server_slug, t.tool_name),
      description: `[外部数据源:${t.server_name}] ${t.description || t.tool_name}`,
      parameters: schema as ToolDefinition['function']['parameters'],
    },
  };
}

/**
 * MCP 工具统一 handler。按内部工具名路由到对应 server，调用并落日志。
 */
export const mcpToolHandler: ToolHandler = async (args, ctx: ToolContext) => {
  // args 里不带工具名；tools/index.ts 调用时会通过闭包绑定工具名。
  // 这里作为兜底，不应被直接调用。
  return '【错误】MCP handler 未绑定工具名';
};

/**
 * 为某个 MCP 工具生成带工具名绑定的 handler。
 */
export function makeMcpToolHandler(t: EnabledTool): ToolHandler {
  const boundName = buildBoundToolName(t.server_slug, t.tool_name);
  return async (args: Record<string, unknown>, toolCtx: ToolContext) => {
    const started = Date.now();
    let resultText = '';
    let success = true;
    let errorText: string | null = null;

    try {
      const client = await getClient(t.server_id);
      if (!client) {
        throw new Error(`MCP 数据源「${t.server_name}」未连接或已禁用`);
      }
      const res = await client.callTool(t.tool_name, args as Record<string, unknown>);

      if (res.isError) success = false;

      // 提取文本内容
      const textParts: string[] = [];
      if (Array.isArray(res.content)) {
        for (const block of res.content) {
          if (block.type === 'text' && typeof (block as { text?: string }).text === 'string') {
            textParts.push((block as { text: string }).text);
          } else if (block.type === 'image') {
            textParts.push('[图片内容]');
          } else {
            textParts.push(`[${block.type} 内容]`);
          }
        }
      }
      resultText = textParts.join('\n').trim();

      // structuredContent 兜底（部分 server 只给结构化内容）
      if (!resultText && res.structuredContent) {
        resultText = JSON.stringify(res.structuredContent, null, 2);
      }
      if (!resultText) resultText = '[MCP 返回为空]';

      if (resultText.length > MAX_RESULT_CHARS) {
        resultText = resultText.slice(0, MAX_RESULT_CHARS) + `\n…[结果过长，已截断，共 ${resultText.length} 字]`;
      }

      if (!success) {
        errorText = resultText.slice(0, 1000);
      }
      return resultText;
    } catch (err) {
      success = false;
      errorText = err instanceof Error ? err.message : String(err);
      return `【MCP 调用失败】${t.server_name}/${t.tool_name}：${errorText}`;
    } finally {
      const durationMs = Date.now() - started;
      try {
        insertMcpCallLog({
          serverId: t.server_id,
          serverName: t.server_name,
          toolName: t.tool_name,
          boundToolName: boundName,
          args,
          resultPreview: resultText.slice(0, 2000),
          success,
          errorText,
          durationMs,
          projectId: toolCtx.projectId ?? null,
          conversationId: toolCtx.conversationId ?? null,
          enterpriseId: toolCtx.enterpriseId ?? null,
        });
      } catch {
        // 留痕失败不影响主流程
      }
    }
  };
}

/**
 * 构建「内部工具名 → handler」映射，供 tools/index.ts 合并进 TOOL_MAP。
 * 注意：这里每次调用都从库读最新配置；启动期/工具刷新期可接受。
 */
export function buildMcpToolHandlerMap(): Record<string, ToolHandler> {
  const tools = listEnabledMcpTools() as EnabledTool[];
  const map: Record<string, ToolHandler> = {};
  for (const t of tools) {
    map[buildBoundToolName(t.server_slug, t.tool_name)] = makeMcpToolHandler(t);
  }
  return map;
}

export { isMcpTool };
