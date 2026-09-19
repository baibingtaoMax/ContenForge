// ============================================
// MCP 连接注册表：管理所有已启用 server 的 McpClient 生命周期
// ============================================

import { McpClient } from './client.js';
import type { McpServerRow } from './types.js';
import {
  listEnabledMcpServers,
  getMcpServer,
  syncMcpTools,
  updateMcpServerStatus,
} from '../store/mcpStore.js';

/** server id -> McpClient */
const clients = new Map<string, McpClient>();

/** 取已连接的 client（未连接则按需连接） */
export async function getClient(serverId: string): Promise<McpClient | null> {
  let client = clients.get(serverId);
  if (client?.isConnected) return client;

  const server = getMcpServer(serverId);
  if (!server || !server.enabled) return null;

  if (!client) {
    client = new McpClient(server);
    clients.set(serverId, client);
  } else {
    // 用最新配置重建
    const fresh = new McpClient(server);
    clients.set(serverId, fresh);
    client = fresh;
  }

  try {
    updateMcpServerStatus(serverId, 'connecting', null);
    await client.connect();
    updateMcpServerStatus(serverId, 'connected', null);
    return client;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateMcpServerStatus(serverId, 'error', msg);
    clients.delete(serverId);
    return null;
  }
}

/**
 * 启动时连接所有 enabled server，并同步它们的工具列表到数据库。
 * 单个 server 失败不影响其他 server。
 */
export async function initMcpRegistry(): Promise<void> {
  const servers = listEnabledMcpServers();
  await Promise.all(
    servers.map(async (server) => {
      try {
        const client = await getClient(server.id);
        if (!client) return;
        const tools = await client.listTools(true);
        syncMcpTools(server.id, tools);
        console.log(`[MCP] 已连接 ${server.name}，发现 ${tools.length} 个工具`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateMcpServerStatus(server.id, 'error', msg);
        console.warn(`[MCP] 连接 ${server.name} 失败：${msg}`);
      }
    })
  );
}

/**
 * 测试一个 server 配置（可用于尚未入库的临时配置）。
 * 成功返回工具数量，失败抛错。
 */
export async function testServerConnection(server: McpServerRow): Promise<{ toolCount: number }> {
  const client = new McpClient(server);
  try {
    await client.connect();
    const tools = await client.listTools(true);
    return { toolCount: tools.length };
  } finally {
    await client.close();
  }
}

/**
 * 刷新已入库 server 的工具列表（连接 + listTools + 同步入库 + 更新状态）。
 */
export async function refreshServerTools(serverId: string): Promise<number> {
  const client = await getClient(serverId);
  if (!client) throw new Error('无法连接到该 MCP server');
  const tools = await client.listTools(true);
  syncMcpTools(serverId, tools);
  return tools.length;
}

/** 关闭并移除某 server 的连接（配置更新/删除/禁用时调用） */
export async function disconnectServer(serverId: string): Promise<void> {
  const client = clients.get(serverId);
  if (client) {
    await client.close();
    clients.delete(serverId);
  }
}

/** 重建某 server 连接（配置变更后调用，下次取 client 时用新配置） */
export async function reloadServer(serverId: string): Promise<void> {
  await disconnectServer(serverId);
}

/** 关闭全部连接（进程退出时） */
export async function closeAllMcpClients(): Promise<void> {
  await Promise.all([...clients.values()].map((c) => c.close()));
  clients.clear();
}
