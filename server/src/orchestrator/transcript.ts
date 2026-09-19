// ============================================
// 评估过程转录器
// 在 runAssessment 期间镜像前端的气泡聚合逻辑，把
// investigator / worker / reviewer / decision_maker
// 的消息、工具调用、审查反馈、决策卡片收集起来，
// 评估结束（成功/中断/出错）时批量落库，保证刷新可还原。
// ============================================

import type { SSEEvent } from '../types/index.js';

interface TranscriptToolCall {
  toolName: string;
  args: unknown;
  result?: unknown;
  loading: boolean;
}

interface TranscriptMessage {
  agentRole: string;
  agentName: string;
  content: string;
  reasoningContent?: string;
  toolCalls: TranscriptToolCall[];
  reviewFeedback?: unknown;
  decision?: unknown;
  _active?: boolean;
}

export interface TranscriptRecorder {
  /** 包装后的 sendSSE：一边转发给前端，一边记录 */
  send: (event: SSEEvent) => void;
  /** 取出聚合后的消息（已清理内部标记、过滤空消息） */
  getRecords: () => Array<{
    agentRole: string;
    agentName: string;
    content: string;
    toolCalls: TranscriptToolCall[];
    reviewFeedback?: unknown;
    decision?: unknown;
  }>;
}

export function createTranscriptRecorder(
  forward: (event: SSEEvent) => void,
  assessmentId: string
): TranscriptRecorder {
  const messages: TranscriptMessage[] = [];

  function findActive(role: string): TranscriptMessage | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].agentRole === role && messages[i]._active) return messages[i];
    }
    return undefined;
  }

  function findOrCreate(role: string, name: string): TranscriptMessage {
    const existing = findActive(role);
    if (existing) return existing;
    const msg: TranscriptMessage = {
      agentRole: role,
      agentName: name,
      content: '',
      toolCalls: [],
      _active: true,
    };
    messages.push(msg);
    return msg;
  }

  function deactivate(role: string) {
    for (const m of messages) {
      if (m.agentRole === role && m._active) m._active = false;
    }
  }

  function handle(event: SSEEvent) {
    const data = (event.data || {}) as Record<string, any>;
    switch (event.type) {
      case 'agent_start':
        deactivate(data.agentRole);
        findOrCreate(data.agentRole, data.agentName);
        break;
      case 'agent_message': {
        const msg = findOrCreate(data.agentRole, data.agentName || data.agentRole);
        msg.content = data.content || '';
        break;
      }
      case 'reasoning': {
        const msg = findOrCreate(data.agentRole, data.agentName || data.agentRole);
        msg.reasoningContent = data.content || '';
        break;
      }
      case 'tool_call': {
        const role = data.agentRole || 'investigator';
        const msg = findOrCreate(role, role);
        msg.toolCalls.push({ toolName: data.toolName, args: data.args, loading: true });
        break;
      }
      case 'tool_result': {
        const role = data.agentRole || 'investigator';
        const msg = findActive(role);
        if (msg) {
          for (let i = msg.toolCalls.length - 1; i >= 0; i--) {
            const tc = msg.toolCalls[i];
            if (tc.toolName === data.toolName && tc.loading) {
              tc.result = data.result;
              tc.loading = false;
              break;
            }
          }
        }
        break;
      }
      case 'review_feedback': {
        // 挂到最新一条审查官消息
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].agentRole === 'reviewer') {
            messages[i].reviewFeedback = data;
            break;
          }
        }
        break;
      }
      case 'decision': {
        const msg = findOrCreate('decision_maker', '决策官');
        msg.decision = data;
        break;
      }
      default:
        break;
    }
  }

  return {
    send: (event) => {
      handle(event);
      forward(event);
    },
    getRecords: () =>
      messages
        .filter(
          (m) =>
            m.content ||
            m.reasoningContent ||
            m.toolCalls.length > 0 ||
            m.reviewFeedback ||
            m.decision
        )
        .map((m) => ({
          assessmentId,
          agentRole: m.agentRole,
          agentName: m.agentName,
          content: m.content,
          reasoningContent: m.reasoningContent,
          toolCalls: m.toolCalls,
          reviewFeedback: m.reviewFeedback,
          decision: m.decision,
        })),
  };
}
