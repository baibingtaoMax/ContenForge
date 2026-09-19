// ============================================
// OpenAI 兼容 LLM 客户端封装
// 支持流式输出 + function calling 循环 + AbortSignal 中断
// ============================================

import OpenAI from 'openai';
import { getConfig } from '../config/index.js';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { executeTool } from '../tools/index.js';
import type { ToolContext } from '../types/index.js';

export type LLMMessage = ChatCompletionMessageParam;
export type StreamChunkHandler = (deltaText: string, accumulatedText: string) => void;

export interface ToolCallEvent {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
}

/** 中断错误 */
export class AbortedError extends Error {
  constructor() {
    super('模型调用已中断');
    this.name = 'AbortedError';
  }
}

function createClient(): OpenAI {
  const cfg = getConfig();
  return new OpenAI({
    apiKey: cfg.llm.apiKey,
    baseURL: cfg.llm.baseUrl,
  });
}

/**
 * 流式调用 LLM，自动处理 function calling 循环。
 * - 每轮模型输出的文本（包括工具调用轮的思考过程）都通过 onChunk 实时推送
 * - 支持 AbortSignal 中断
 * - onToolCall 在工具执行后触发
 */
export async function chatCompletionWithTools(params: {
  messages: LLMMessage[];
  model?: string;
  tools?: ChatCompletionTool[];
  onChunk?: StreamChunkHandler;
  onReasoning?: StreamChunkHandler;
  onToolCall?: (event: ToolCallEvent) => void;
  onStatus?: (status: string) => void;
  temperature?: number;
  signal?: AbortSignal;
  toolContext?: ToolContext;
  /** 自定义工具处理器：优先于全局注册中心，用于需要运行时上下文（如调度 worker）的工具 */
  toolHandlers?: Record<string, (args: Record<string, unknown>) => string | Promise<string>>;
  maxRounds?: number;
  /** 调完工具后直接返回工具结果文本，不再进行下一轮 LLM 调用（用于 worker 只取数不写小结） */
  stopAfterToolCalls?: boolean;
}): Promise<string> {
  const client = createClient();
  const cfg = getConfig();
  const model = params.model || cfg.llm.model;
  const { tools, onChunk, onReasoning, onToolCall, onStatus, temperature = 0.3, signal, toolContext, toolHandlers, maxRounds = 8, stopAfterToolCalls = false } = params;

  const conversation: LLMMessage[] = [...params.messages];
  const MAX_TOOL_ROUNDS = maxRounds;
  // 跨轮次累积的文本（工具调用轮的旁白 + 最终报告，始终增长不回退）
  let fullAccumulated = '';
  // 跨轮次累积的思考过程（推理模型的 reasoning_content）
  let fullReasoning = '';
  const IDLE_TIMEOUT_MS = 60_000;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal?.aborted) throw new AbortedError();

    // idle 超时：60s 没收到 chunk 就中止当前流，用已有内容继续
    const idleCtl = new AbortController();
    let idleTimer: NodeJS.Timeout | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idleCtl.abort(), IDLE_TIMEOUT_MS);
    };
    const onExternalAbort = () => idleCtl.abort();
    signal?.addEventListener('abort', onExternalAbort);

    const stream = await client.chat.completions.create(
      {
        model,
        messages: conversation,
        tools,
        temperature,
        stream: true,
      },
      { signal: idleCtl.signal as any }
    );

    let roundAccumulated = '';
    const toolCallsBuf: Array<{
      id: string;
      function: { name: string; arguments: string };
      type: 'function';
    }> = [];

    resetIdle();
    try {
      for await (const chunk of stream) {
        resetIdle();
        if (signal?.aborted) {
          stream.controller.abort();
          throw new AbortedError();
        }
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;

        // 推理模型的思考过程（doubao-seed 等输出 reasoning_content）
        const r = (delta as any).reasoning_content;
        if (r) {
          fullReasoning += r;
          onReasoning?.(r, fullReasoning);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsBuf[idx]) {
              toolCallsBuf[idx] = {
                id: tc.id ?? '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (tc.id) toolCallsBuf[idx].id = tc.id;
            if (tc.function?.name) toolCallsBuf[idx].function.name += tc.function.name;
            if (tc.function?.arguments)
              toolCallsBuf[idx].function.arguments += tc.function.arguments;
          }
        }

        // 实时推送模型文本（跨轮累积，始终增长）
        if (delta.content) {
          roundAccumulated += delta.content;
          fullAccumulated += delta.content;
          onChunk?.(delta.content, fullAccumulated);
        }
      }
    } catch (e) {
      // idle 超时（非外部中断）：用已收到的内容继续
      if (!signal?.aborted && e instanceof Error && e.name === 'AbortError') {
        onStatus?.('响应超时，使用已接收的内容继续…');
      } else if (signal?.aborted) {
        throw new AbortedError();
      } else {
        throw e;
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      signal?.removeEventListener('abort', onExternalAbort);
    }

    const validToolCalls = toolCallsBuf.filter(Boolean);

    if (validToolCalls.length > 0 && tools && tools.length > 0) {
      conversation.push({
        role: 'assistant',
        content: roundAccumulated || null,
        tool_calls: validToolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const tc of validToolCalls) {
        if (signal?.aborted) throw new AbortedError();

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }

        onStatus?.(`正在查询：${toolDisplayName(tc.function.name)}…`);

        const result = toolHandlers?.[tc.function.name]
          ? await toolHandlers[tc.function.name](parsedArgs)
          : await executeTool(tc.function.name, parsedArgs, toolContext);

        onToolCall?.({ toolName: tc.function.name, args: parsedArgs, result });

        conversation.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        });
      }

      // stopAfterToolCalls 模式：直接拼接工具结果返回，不再调 LLM
      if (stopAfterToolCalls) {
        const toolOutputs = conversation
          .filter((m) => m.role === 'tool')
          .map((m) => (m as { content: string }).content)
          .join('\n\n');
        return toolOutputs || '该领域工具未返回有效数据。';
      }

      continue;
    }

    return fullAccumulated.trim();
  }

  return '已达到最大工具调用轮数，未能完成本次分析。';
}

/** 工具中文名 */
function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    getEnterpriseBasic: '工商基本信息',
    getCreditReport: '征信报告',
    getFinancialData: '财报数据',
    getLitigationRecords: '司法诉讼记录',
    getTaxInfo: '税务信息',
  };
  return map[name] || name;
}

/**
 * 流式简单对话（无工具），边收边推。
 */
export async function chatCompletionStream(params: {
  messages: LLMMessage[];
  model?: string;
  onChunk: StreamChunkHandler;
  onReasoning?: StreamChunkHandler;
  temperature?: number;
  /** 最大输出 tokens；不传用模型默认（原型补丁/整页 HTML 输出必须显式传大值，否则默认 4k 会截断） */
  maxTokens?: number;
  signal?: AbortSignal;
  /** 火山方舟思考开关：原型生成等结构化任务传 { type: 'disabled' } 关闭 thinking，避免复杂任务思考卡死 */
  thinking?: { type: 'disabled' | 'enabled' };
}): Promise<string> {
  const client = createClient();
  const cfg = getConfig();
  const model = params.model || cfg.llm.model;
  const IDLE_TIMEOUT_MS = 60_000;

  // idle 超时：60s 没收到 chunk 就中止当前流
  const idleCtl = new AbortController();
  let idleTimer: NodeJS.Timeout | null = null;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idleCtl.abort(), IDLE_TIMEOUT_MS);
  };
  const onExternalAbort = () => idleCtl.abort();
  params.signal?.addEventListener('abort', onExternalAbort);

  const body: any = {
    model,
    messages: params.messages,
    temperature: params.temperature ?? 0.2,
    stream: true,
    ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    ...(params.thinking ? { thinking: params.thinking } : {}),
  };
  const stream: any = await client.chat.completions.create(
    body as any,
    { signal: idleCtl.signal as any }
  );

  let accumulated = '';
  let reasoningAccumulated = '';
  resetIdle();
  try {
    for await (const chunk of stream) {
      resetIdle();
      if (params.signal?.aborted) {
        stream.controller.abort();
        throw new AbortedError();
      }
      const choice = chunk.choices[0]?.delta;
      const r = (choice as any)?.reasoning_content;
      if (r) {
        reasoningAccumulated += r;
        params.onReasoning?.(r, reasoningAccumulated);
      }
      const delta = choice?.content;
      if (delta) {
        accumulated += delta;
        params.onChunk(delta, accumulated);
      }
    }
  } catch (e) {
    if (!params.signal?.aborted && e instanceof Error && e.name === 'AbortError') {
      // idle 超时，用已有内容继续
    } else if (params.signal?.aborted) {
      throw new AbortedError();
    } else {
      throw e;
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    params.signal?.removeEventListener('abort', onExternalAbort);
  }
  return accumulated.trim();
}
