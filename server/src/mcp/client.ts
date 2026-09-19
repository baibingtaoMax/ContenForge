// ============================================
// 单个 MCP server 的客户端封装（基于官方 SDK，streamableHttp）
// ============================================

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerRow } from './types.js';

export interface RemoteToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * 一个 McpClient 对应一个已连接的 MCP server。
 * 生命周期由 registry 管理：连接后缓存，配置变更/删除时 close。
 */
export class McpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private toolsCache: RemoteToolInfo[] | null = null;
  private connecting: Promise<void> | null = null;

  constructor(public readonly server: McpServerRow) {}

  private parseHeaders(): Record<string, string> {
    try {
      return JSON.parse(this.server.headers_json || '{}') as Record<string, string>;
    } catch {
      return {};
    }
  }

  /** 建立连接并完成 initialize 握手。重复调用复用同一连接。 */
  async connect(): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const headers = this.parseHeaders();
      const client = new Client(
        { name: 'risk-agent-platform', version: '1.0.0' },
        { capabilities: {} }
      );

      const transport = new StreamableHTTPClientTransport(new URL(this.server.url), {
        requestInit: { headers },
      });

      await client.connect(transport);
      this.client = client;
      this.transport = transport;
    })();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  get isConnected(): boolean {
    return this.client !== null;
  }

  /** 列出远端工具（连接后调用一次；结果缓存，刷新时传 force） */
  async listTools(force = false): Promise<RemoteToolInfo[]> {
    if (this.toolsCache && !force) return this.toolsCache;
    await this.connect();
    const res = await this.client!.listTools();
    this.toolsCache = (res.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return this.toolsCache;
  }

  /** 调用远端工具，返回 MCP CallToolResult */
  async callTool(name: string, args: Record<string, unknown>) {
    await this.connect();
    return this.client!.callTool({ name, arguments: args });
  }

  async close(): Promise<void> {
    try {
      this.transport?.close?.();
    } catch {
      // ignore
    }
    this.client = null;
    this.transport = null;
    this.toolsCache = null;
  }
}
