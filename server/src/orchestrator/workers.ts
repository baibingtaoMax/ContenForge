// ============================================
// 领域 Worker 执行器
// 每个 worker 独立跑一轮 function calling，取本领域数据，
// 过程通过 SSE 作为独立气泡推给前端，最后返回调查小结。
// ============================================

import {
  chatCompletionWithTools,
  AbortedError,
  type LLMMessage,
  type ToolCallEvent,
} from '../llm/client.js';
import { getToolDefinitionsByNames, getRoleMcpTools } from '../tools/index.js';
import { getModelForRole } from '../config/index.js';
import { WORKERS, ALL_DOMAINS, type WorkerDomain, type WorkerConfig } from '../agents/workers.js';
import { listAttachments, listAttachmentsByConversation } from '../store/database.js';
import type { SSEEvent, ToolContext } from '../types/index.js';

export interface WorkerTask {
  domain: WorkerDomain;
  /** 调查主管给该 worker 的具体指令 */
  instruction: string;
}

export interface WorkerResult {
  domain: WorkerDomain;
  shortName: string;
  output: string;
}

type SendSSE = (event: SSEEvent) => void;

interface RunWorkersParams {
  tasks: WorkerTask[];
  enterpriseId: string;
  enterpriseName: string;
  sendSSE: SendSSE;
  signal?: AbortSignal;
  toolContext: ToolContext;
}

/** 并行运行多个领域 worker，返回各自小结 */
export async function runWorkers(params: RunWorkersParams): Promise<WorkerResult[]> {
  const { tasks, enterpriseId, enterpriseName, sendSSE, signal, toolContext } = params;

  // 派发前统一查一次附件：没附件就不给 worker 挂附件工具；有附件就把清单注入指令（省掉每个 worker 各自 list）
  let attachmentHint = '';
  try {
    const atts = toolContext.projectId
      ? listAttachments(toolContext.projectId)
      : (toolContext.conversationId ? listAttachmentsByConversation(toolContext.conversationId) : []);
    if (atts.length) {
      attachmentHint =
        '本次可用附件清单（用 read_attachment 读取，参数填附件 id）：\n' +
        atts.map((a) => `- id=${a.id} | 文件名：${a.filename} | 类别：${a.category}${a.summary ? ' | 摘要：' + a.summary : ''}`).join('\n');
    }
  } catch { attachmentHint = ''; }
  const hasAttachment = attachmentHint.length > 0;

  // 去重：同一 domain 只跑一次（指令合并）
  const merged = new Map<WorkerDomain, string>();
  for (const t of tasks) {
    if (!ALL_DOMAINS.includes(t.domain)) continue;
    const prev = merged.get(t.domain);
    merged.set(t.domain, prev ? `${prev}\n${t.instruction}` : t.instruction);
  }

  const uniqueTasks = Array.from(merged.entries()).map(([domain, instruction]) => ({
    domain,
    instruction,
  }));

  // 并行执行
  const results = await Promise.all(
    uniqueTasks.map((t) =>
      runOneWorker({
        worker: WORKERS[t.domain],
        instruction: t.instruction,
        enterpriseId,
        enterpriseName,
        sendSSE,
        signal,
        toolContext,
        attachmentHint,
      })
    )
  );

  return results;
}

async function runOneWorker(params: {
  worker: WorkerConfig;
  instruction: string;
  enterpriseId: string;
  enterpriseName: string;
  sendSSE: SendSSE;
  signal?: AbortSignal;
  toolContext: ToolContext;
  attachmentHint: string;
}): Promise<WorkerResult> {
  const { worker, instruction, enterpriseId, enterpriseName, sendSSE, signal, toolContext, attachmentHint } = params;
  const hasAttachment = attachmentHint.length > 0;

  if (signal?.aborted) throw new AbortedError();

  sendSSE({
    type: 'agent_start',
    data: { agentName: worker.name, agentRole: worker.role },
  });

  const isExternal = enterpriseId.startsWith('EXT-');
  const externalHint = isExternal
    ? `注意：该企业（ID以EXT-开头）是通过外部数据源登记的企业，平台内置样本库没有它的数据。` +
      `请直接调用工具列表中以「[外部数据源:...]」开头的外部MCP工具查询真实数据，不要调用平台内置的样本查询工具。\n\n`
    : '';

  const messages: LLMMessage[] = [
    { role: 'system', content: worker.systemPrompt },
    {
      role: 'user',
      content:
        `调查企业：${enterpriseName}（ID: ${enterpriseId}）\n\n` +
        externalHint +
        `调查主管的指令：${instruction}\n\n` +
        (hasAttachment
          ? `${attachmentHint}\n如与本领域相关，用 read_attachment 读取核对。\n\n`
          : `本次没有上传任何附件，不要调用附件相关工具。\n\n`) +
        `请调用你负责领域的工具取数，取完即可，不需要写小结。`,
    },
  ];

  const baseToolNames = hasAttachment && worker.availableTools
    ? [...worker.availableTools, 'read_attachment']
    : (worker.availableTools || []);

  const output = await chatCompletionWithTools({
    model: getModelForRole('worker'),
    messages,
    tools: [
      ...getToolDefinitionsByNames(baseToolNames),
      ...getRoleMcpTools(worker.role),
    ],
    temperature: 0.2,
    signal,
    toolContext,
    maxRounds: 3,
    stopAfterToolCalls: true,
    onReasoning: (_delta, accumulated) => {
      sendSSE({ type: 'reasoning', data: { agentRole: worker.role, content: accumulated } });
    },
    onStatus: (text) => sendSSE({ type: 'status', data: { text: `[${worker.shortName}] ${text}` } }),
    onToolCall: (event: ToolCallEvent) => {
      sendSSE({ type: 'tool_call', data: { toolName: event.toolName, args: event.args, agentRole: worker.role } });
      sendSSE({ type: 'tool_result', data: { toolName: event.toolName, result: event.result, agentRole: worker.role } });
    },
  });


  return {
    domain: worker.domain,
    shortName: worker.shortName,
    output: output || '该领域未返回有效调查结果。',
  };
}
