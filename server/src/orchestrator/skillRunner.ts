// ============================================
// 技能执行编排
// 独立于三角色评估闭环，由接待员通过 invoke_skill 工具召唤
// ============================================

import { chatCompletionWithTools } from '../llm/client.js';
import { getSkill } from '../skills/loader.js';
import { skillExecutor, buildSkillToolHandlers } from '../agents/skillExecutor.js';
import { getModelForRole } from '../config/index.js';
import { getToolDefinitionsByNames, getRoleMcpTools } from '../tools/index.js';
import type { SSEEvent } from '../types/index.js';

type SendSSE = (event: SSEEvent) => void;

export interface SkillRunParams {
  skillId: string;
  task: string;
  projectId?: string | null;
  conversationId?: string | null;
  enterpriseId?: string;
  sendSSE: SendSSE;
  signal?: AbortSignal;
}

export interface SkillRunRecord {
  /** 最终文本结果 */
  result: string;
  /** 推理过程（reasoning_content 累积） */
  reasoningContent: string;
  /** 工具调用记录（含结果） */
  toolCalls: Array<{ toolName: string; args: unknown; result: string }>;
  /** 技能元信息，前端还原紫色⚡气泡用 */
  skillMeta: { skillId: string; skillName: string; task: string };
}

export async function runSkill(params: SkillRunParams): Promise<SkillRunRecord> {
  const { skillId, task, projectId, conversationId, enterpriseId, sendSSE, signal } = params;

  const skill = await getSkill(skillId);
  if (!skill) {
    const msg = `未找到技能：${skillId}。请确认技能名称是否正确。`;
    sendSSE({ type: 'skill_message', data: { content: msg, done: true } });
    return {
      result: msg,
      reasoningContent: '',
      toolCalls: [],
      skillMeta: { skillId, skillName: skillId, task },
    };
  }

  const model = getModelForRole('investigator'); // 技能执行员复用调查员模型配置
  const basePrompt = skillExecutor.buildSystemPrompt(skill.name, skill.body, task);
  // 外部企业（通过 MCP 数据源登记）内置样本库无数据，提示技能员直接调外部工具
  const externalHint = enterpriseId?.startsWith('EXT-')
    ? `\n\n## 外部企业提示\n当前企业（ID: ${enterpriseId}）是通过外部数据源登记的企业，平台内置样本库没有它的数据。\n` +
      `需要该企业数据时，请直接调用工具列表中以「[外部数据源:...]」开头的外部 MCP 工具查询真实数据，不要调用平台内置的样本查询工具。`
    : '';
  const systemPrompt = basePrompt + externalHint;
  const skillMeta = { skillId: skill.id, skillName: skill.name, task };

  sendSSE({
    type: 'skill_start',
    data: { ...skillMeta },
  });

  let finalResult = '';
  let finalReasoning = '';
  const toolCalls: SkillRunRecord['toolCalls'] = [];

  const baseMcpTools = getRoleMcpTools('skill_executor');
  // 技能通过 frontmatter `tools` 声明的额外工具（主要是未绑定给执行员的 MCP 工具）
  const declaredTools = getToolDefinitionsByNames(skill.tools || []);
  // 合并去重（按 function name）
  const seen = new Set<string>();
  const extraTools = [...baseMcpTools, ...declaredTools].filter((t) => {
    if (seen.has(t.function.name)) return false;
    seen.add(t.function.name);
    return true;
  });

  await chatCompletionWithTools({
    messages: [{ role: 'system', content: systemPrompt }],
    model,
    // 基础工具与技能声明工具可能重叠（如 read_webpage），按 function name 去重
    tools: [...skillExecutor.tools, ...extraTools].filter((t, i, arr) =>
      arr.findIndex((x) => x.function.name === t.function.name) === i
    ),
    temperature: 0.3,
    signal,
    toolContext: { projectId: projectId || null, conversationId: conversationId || null, enterpriseId },
    onChunk: (_delta, accumulated) => {
      finalResult = accumulated;
      sendSSE({
        type: 'skill_message',
        data: { skillId: skill.id, content: accumulated, done: false },
      });
    },
    onReasoning: (_delta, accumulated) => {
      finalReasoning = accumulated;
      sendSSE({
        type: 'skill_reasoning',
        data: { skillId: skill.id, content: accumulated },
      });
    },
    onStatus: (status) => {
      sendSSE({
        type: 'skill_status',
        data: { skillId: skill.id, status },
      });
    },
    onToolCall: (event) => {
      const result = event.result.length > 500 ? event.result.slice(0, 500) + '…' : event.result;
      toolCalls.push({ toolName: event.toolName, args: event.args, result });
      sendSSE({
        type: 'skill_tool_call',
        data: {
          skillId: skill.id,
          toolName: event.toolName,
          args: event.args,
          result,
        },
      });
    },
    toolHandlers: buildSkillToolHandlers(projectId),
    maxRounds: 6,
  });

  if (!finalResult) {
    finalResult = '技能执行完成，但未产生文本输出。';
  }

  sendSSE({
    type: 'skill_message',
    data: { skillId: skill.id, content: finalResult, done: true },
  });

  sendSSE({ type: 'skill_done', data: { skillId: skill.id, skillName: skill.name } });

  const record: SkillRunRecord = {
    result: finalResult,
    reasoningContent: finalReasoning,
    toolCalls,
    skillMeta,
  };
  return record;
}
