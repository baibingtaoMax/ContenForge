// ============================================
// 薄大脑编排引擎
// 调查员 → 审查官 → (补查循环) → 决策官
// 支持 AbortSignal 中断、项目关联、结论沉淀
// ============================================

import { v4 as uuidv4 } from 'uuid';
import { investigator } from '../agents/investigator.js';
import { reviewer } from '../agents/reviewer.js';
import { decisionMaker } from '../agents/decisionMaker.js';
import {
  chatCompletionWithTools,
  chatCompletionStream,
  AbortedError,
  type LLMMessage,
  type ToolCallEvent,
} from '../llm/client.js';
import { getToolDefinitionsByNames, DISPATCH_TOOL_DEFINITION, getRoleMcpTools } from '../tools/index.js';
import { runWorkers, type WorkerResult } from './workers.js';
import { createTranscriptRecorder } from './transcript.js';
import { getModelForRole } from '../config/index.js';
import { appendAgentMessages } from '../store/database.js';
import {
  createAssessment,
  completeAssessment,
  appendProjectAssessment,
} from '../store/database.js';
import { getEnterpriseList, resolveEnterpriseName } from '../tools/index.js';
import { saveMemories, saveMemoryOnce } from '../services/memory.js';
import type { SSEEvent, ReviewResult, DecisionResult, AgentRole } from '../types/index.js';

const MAX_REVIEW_ROUNDS = 2;

type SendSSE = (event: SSEEvent) => void;

interface LogEntry {
  timestamp: string;
  role: AgentRole | 'system';
  type: string;
  content: any;
}

function parseJSONFromModel<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { /* continue */ }
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) { try { return JSON.parse(jsonMatch[1].trim()) as T; } catch { /* continue */ } }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) { try { return JSON.parse(braceMatch[0]) as T; } catch { /* continue */ } }
  return null;
}

function enterpriseName(id: string): string {
  return resolveEnterpriseName(id);
}

/**
 * 运行调查员（调度大脑）：调查员派活给领域 worker 并行执行，然后汇总写报告。
 * supplement 模式下可传入上轮报告和补查问题，只派相关领域。
 */
async function runInvestigator(params: {
  enterpriseId: string;
  enterpriseName: string;
  sendSSE: SendSSE;
  signal?: AbortSignal;
  projectId: string | null;
  conversationId: string | null;
  log: (type: string, content: any) => void;
  supplement?: { previousReport: string; questions: string };
}): Promise<string> {
  const { enterpriseId, enterpriseName, sendSSE, signal, projectId, conversationId, log, supplement } = params;

  const messages: LLMMessage[] = [
    { role: 'system', content: investigator.systemPrompt },
    supplement
      ? {
          role: 'user',
          content:
            `请对企业 ${enterpriseName}（ID: ${enterpriseId}）进行调查，调用 dispatch_investigation 派出相关领域专员。`,
        }
      : {
          role: 'user',
          content:
            `请对企业 ${enterpriseName}（ID: ${enterpriseId}）进行全面调查，调用 dispatch_investigation 派出全部 5 个领域专员并行调查。`,
        },
  ];

  if (supplement) {
    messages.push(
      { role: 'assistant', content: supplement.previousReport },
      {
        role: 'user',
        content:
          `审查官要求补充调查以下问题，请只派相关领域的专员去核实，不要全派：\n${supplement.questions}`,
      }
    );
  }

  const toolContext = { projectId, conversationId, enterpriseId };

  let dispatched = false;
  // 调查员的派活工具处理器：真正并行拉起 worker（一次调查只允许派一次）
  const dispatchHandler = async (args: Record<string, unknown>): Promise<string> => {
    if (dispatched) {
      return '【提示】本次调查已经派发过任务，上面是各专员的结果，请直接基于这些结果写调查报告，不要重复派发。';
    }
    dispatched = true;
    const rawTasks = (args.tasks as Array<{ domain: string; instruction: string }>) || [];
    const tasks = rawTasks
      .filter((t) => t && t.domain && t.instruction)
      .map((t) => ({
        domain: t.domain as WorkerResult['domain'],
        instruction: String(t.instruction),
      }));

    if (tasks.length === 0) return '【错误】没有有效的调查任务，请重新派发。';

    log('dispatch', { tasks: tasks.map((t) => t.domain) });
    sendSSE({ type: 'status', data: { text: `调查主管派出 ${tasks.length} 个专员并行调查…` } });

    const workerResults = await runWorkers({
      tasks,
      enterpriseId,
      enterpriseName,
      sendSSE,
      signal,
      toolContext,
    });

    if (signal?.aborted) throw new AbortedError();

    const report = workerResults
      .map((r) => `=== ${r.shortName}调查专员结果 ===\n${r.output}`)
      .join('\n\n');
    log('workers_result', { domains: workerResults.map((r) => r.domain) });
    return report;
  };

  const output = await chatCompletionWithTools({
    model: getModelForRole('investigator'),
    messages,
    tools: [DISPATCH_TOOL_DEFINITION, ...getRoleMcpTools('investigator')],
    temperature: 0.3,
    signal,
    toolHandlers: { dispatch_investigation: dispatchHandler },
    onChunk: (_delta, accumulated) => {
      sendSSE({ type: 'agent_message', data: { agentRole: 'investigator', content: accumulated } });
    },
    onReasoning: (_delta, accumulated) => {
      sendSSE({ type: 'reasoning', data: { agentRole: 'investigator', content: accumulated } });
    },
    onStatus: (text) => sendSSE({ type: 'status', data: { text } }),
    onToolCall: (event: ToolCallEvent) => {
      log('tool_call', { toolName: event.toolName, args: event.args });
    },
  });

  return output.trim();
}

/**
 * 运行完整评估流程
 */
export async function runAssessment(params: {
  enterpriseId: string;
  sendSSE: SendSSE;
  signal?: AbortSignal;
  projectId?: string | null;
  conversationId?: string | null;
}): Promise<{ assessmentId: string; decision: DecisionResult | null }> {
  const { enterpriseId, sendSSE, signal, projectId = null, conversationId = null } = params;
  const assessmentId = uuidv4();
  const fullLog: LogEntry[] = [];
  const entName = enterpriseName(enterpriseId);

  const log = (role: LogEntry['role'], type: string, content: any) => {
    fullLog.push({ timestamp: new Date().toISOString(), role, type, content });
  };

  const checkAbort = () => {
    if (signal?.aborted) throw new AbortedError();
  };

  const send = (event: SSEEvent) => {
    if (!signal?.aborted) sendSSE(event);
  };

  createAssessment(assessmentId, enterpriseId, projectId, conversationId, []);

  // 评估过程转录器：镜像 SSE 事件，结束时把 agent 气泡落库
  const transcript = createTranscriptRecorder(send, assessmentId);
  const emit = (event: SSEEvent) => transcript.send(event);

  // 评估过程落库（完成/中断/出错都尝试保存已有部分）
  const persistTranscript = () => {
    if (!conversationId) return; // 无对话归属（理论不会发生）
    try {
      const records = transcript.getRecords();
      if (records.length > 0) appendAgentMessages(conversationId, records);
    } catch (e) {
      console.error('保存评估过程失败', e);
    }
  };

  try {
    emit({ type: 'assessment_start', data: { assessmentId, enterpriseId, enterpriseName: entName } });
    emit({ type: 'status', data: { text: `开始评估「${entName}」` } });
    log('system', 'start', { enterpriseId });

    // ========== 1. 调查员（调度大脑 + 领域 worker 并行） ==========
    emit({
      type: 'agent_start',
      data: { agentName: investigator.name, agentRole: investigator.role },
    });
    log('investigator', 'start', { enterpriseId });

    const investigatorOutput = await runInvestigator({
      enterpriseId,
      enterpriseName: entName,
      sendSSE: emit,
      signal,
      projectId,
      conversationId,
      log: (type, content) => log('investigator', type, content),
    });
    checkAbort();
    log('investigator', 'message', { content: investigatorOutput });

    // ========== 2. 审查 → 补查循环 ==========
    let reviewRound = 0;
    let reviewResult: ReviewResult | null = null;
    const reviewContext: LLMMessage[] = [
      {
        role: 'user',
        content: `以下是调查员对企业 ${entName}（ID: ${enterpriseId}）的调查报告：\n\n${investigatorOutput}`,
      },
    ];

    while (reviewRound <= MAX_REVIEW_ROUNDS) {
      checkAbort();
      reviewRound++;

      emit({ type: 'status', data: { text: `审查官审查中（第 ${reviewRound} 轮）…` } });
      emit({
        type: 'agent_start',
        data: { agentName: reviewer.name, agentRole: reviewer.role },
      });
      log('reviewer', 'start', { round: reviewRound });

      const reviewText = await chatCompletionStream({
        model: getModelForRole('reviewer'),
        messages: [
          { role: 'system', content: reviewer.systemPrompt },
          ...reviewContext,
        ],
        temperature: 0.2,
        signal,
        onChunk: (_delta, accumulated) => {
          emit({ type: 'agent_message', data: { agentRole: 'reviewer', content: accumulated } });
        },
        onReasoning: (_delta, accumulated) => {
          emit({ type: 'reasoning', data: { agentRole: 'reviewer', content: accumulated } });
        },
      });
      checkAbort();
      log('reviewer', 'message', { content: reviewText, round: reviewRound });

      reviewResult = parseJSONFromModel<ReviewResult>(reviewText);
      if (!reviewResult) {
        reviewResult = {
          action: 'approve',
          summary: '审查官输出格式异常，默认进入决策环节。',
        };
        log('reviewer', 'parse_error', { raw: reviewText });
      }

      if (reviewResult.action === 'approve') {
        emit({ type: 'review_feedback', data: { ...reviewResult, round: reviewRound } });
        log('reviewer', 'feedback', reviewResult);
        break;
      }

      if (reviewRound > MAX_REVIEW_ROUNDS) {
        // 已达最大补查轮次：审查官还想补，但不再补查，基于现有信息进决策
        const finalFeedback = { ...reviewResult, round: reviewRound, maxRoundsReached: true };
        log('system', 'max_rounds_reached', { maxRounds: MAX_REVIEW_ROUNDS });
        emit({ type: 'review_feedback', data: finalFeedback });
        log('reviewer', 'feedback', finalFeedback);
        emit({
          type: 'status',
          data: { text: '已达最大补查轮次，基于现有信息进入最终决策' },
        });
        break;
      }

      emit({ type: 'review_feedback', data: { ...reviewResult, round: reviewRound } });
      log('reviewer', 'feedback', reviewResult);

      reviewContext.push({ role: 'assistant', content: reviewText });

      emit({ type: 'status', data: { text: '审查官要求补充调查，调查员补查中…' } });
      emit({
        type: 'agent_start',
        data: { agentName: investigator.name, agentRole: investigator.role },
      });
      log('investigator', 'supplement_start', { round: reviewRound });

      const supplementQuestions = reviewResult.questions?.join('\n') || '请补充更多信息。';

      const supplementOutput = await runInvestigator({
        enterpriseId,
        enterpriseName: entName,
        sendSSE: emit,
        signal,
        projectId,
        conversationId,
        log: (type, content) => log('investigator', type, { ...content, round: reviewRound }),
        supplement: { previousReport: investigatorOutput, questions: supplementQuestions },
      });
      checkAbort();
      log('investigator', 'supplement_message', { content: supplementOutput, round: reviewRound });

      reviewContext.push({
        role: 'user',
        content: `调查员补充调查结果：\n\n${supplementOutput}`,
      });
    }

    // ========== 3. 决策官 ==========
    checkAbort();
    emit({ type: 'status', data: { text: '决策官综合评估中…' } });
    emit({
      type: 'agent_start',
      data: { agentName: decisionMaker.name, agentRole: decisionMaker.role },
    });
    log('decision_maker', 'start', {});

    const recordText = reviewContext
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role === 'user' ? '调查员' : '审查官'}：${typeof m.content === 'string' ? m.content : ''}`)
      .join('\n\n');

    const decisionMessages: LLMMessage[] = [
      { role: 'system', content: decisionMaker.systemPrompt },
      {
        role: 'user',
        content: `以下是对企业 ${entName}（ID: ${enterpriseId}）的完整调查和审查记录，请做出最终担保决策。\n\n=== 调查报告 ===\n${investigatorOutput}\n\n=== 审查记录 ===\n${recordText}`,
      },
    ];

    const decisionText = await chatCompletionStream({
      model: getModelForRole('decision_maker'),
      messages: decisionMessages,
      temperature: 0.2,
      signal,
      onChunk: (_delta, accumulated) => {
        emit({ type: 'agent_message', data: { agentRole: 'decision_maker', content: accumulated } });
      },
      onReasoning: (_delta, accumulated) => {
        emit({ type: 'reasoning', data: { agentRole: 'decision_maker', content: accumulated } });
      },
    });
    checkAbort();
    log('decision_maker', 'message', { content: decisionText });

    const decision = parseJSONFromModel<DecisionResult>(decisionText);
    if (!decision) throw new Error('决策官输出格式异常，无法解析决策结果。');

    emit({ type: 'decision', data: { ...decision, enterpriseId, enterpriseName: entName } as unknown as Record<string, unknown> });
    log('decision_maker', 'decision', decision);

    emit({ type: 'assessment_end', data: { assessmentId, enterpriseId, decision: decision.decision, riskLevel: decision.riskLevel } });

    // 生成摘要
    const summary = buildSummary(entName, decision);

    completeAssessment({
      id: assessmentId,
      status: 'completed',
      decision: decision.decision,
      riskLevel: decision.riskLevel,
      reasons: decision.reasons,
      suggestions: decision.suggestions,
      summary,
      fullLog,
    });

    // 沉淀到项目档案 + 写入项目记忆
    if (projectId) {
      appendProjectAssessment(projectId, {
        assessmentId,
        enterpriseId,
        enterpriseName: entName,
        decision: decision.decision,
        riskLevel: decision.riskLevel,
        reasons: decision.reasons,
        suggestions: decision.suggestions,
        summary,
        assessedAt: new Date().toISOString(),
      });

      // G 打底：评估结论 + 企业档案自动入记忆（异步，不阻塞返回）
      const decisionLabel = decision.decision === 'pass' ? '通过' : decision.decision === 'reject' ? '拒绝' : '人工复核';
      const riskLabel = decision.riskLevel === 'high' ? '高风险' : decision.riskLevel === 'medium' ? '中风险' : decision.riskLevel === 'low' ? '低风险' : decision.riskLevel || '';
      const reasonsText = (decision.reasons || []).map((r, i) => `${i + 1}. ${r}`).join('\n');
      const suggestionsText = (decision.suggestions || []).map((s, i) => `${i + 1}. ${s}`).join('\n');

      void saveMemories([
        {
          projectId,
          sourceType: 'assessment',
          sourceId: assessmentId,
          memoryType: 'decision',
          content: `[评估结论] ${entName}（${enterpriseId}）：${decisionLabel}${riskLabel ? ' / ' + riskLabel : ''}\n\n核心原因：\n${reasonsText || '无'}\n${suggestionsText ? `\n风控建议：\n${suggestionsText}` : ''}`,
          metadata: { enterpriseId, enterpriseName: entName, decision: decision.decision, riskLevel: decision.riskLevel },
        },
        {
          projectId,
          sourceType: 'enterprise_profile',
          sourceId: assessmentId,
          memoryType: 'profile',
          content: `[企业档案] ${entName}（${enterpriseId}）调查报告：\n\n${investigatorOutput}`,
          metadata: { enterpriseId, enterpriseName: entName },
        },
      ]);
    }

    emit({ type: 'done', data: { assessmentId, stage: 'assessment' } });
    persistTranscript();
    return { assessmentId, decision };
  } catch (error) {
    if (error instanceof AbortedError) {
      log('system', 'aborted', {});
      completeAssessment({
        id: assessmentId,
        status: 'failed',
        decision: null,
        riskLevel: null,
        reasons: null,
        suggestions: null,
        summary: '评估已被用户中断',
        fullLog,
      });
      emit({ type: 'aborted', data: { message: '评估已中断' } });
      persistTranscript();
      return { assessmentId, decision: null };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    emit({ type: 'error', data: { message: errorMessage } });
    log('system', 'error', { message: errorMessage });
    persistTranscript();
    completeAssessment({
      id: assessmentId,
      status: 'failed',
      decision: null,
      riskLevel: null,
      reasons: null,
      suggestions: null,
      summary: null,
      fullLog,
    });
    throw error;
  }
}

function buildSummary(entName: string, d: DecisionResult): string {
  const decisionMap: Record<string, string> = { pass: '通过', reject: '拒绝', review: '人工复核' };
  const riskMap: Record<string, string> = { low: '低', medium: '中', high: '高' };
  return `${entName}：${decisionMap[d.decision]}（风险${riskMap[d.riskLevel]}）。${d.reasons.slice(0, 2).join('；')}。`;
}
