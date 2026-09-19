// ============================================
// 技能执行员 Agent
// 独立于三角色评估闭环，由接待员通过 invoke_skill 工具召唤（接待员负责上下文补全/追问）
// 读 SKILL.md → 按步骤调用工具 → 流式输出结果
// ============================================

import { ChatCompletionTool } from 'openai/resources/chat/completions';
import { getToolDefinitionsByNames } from '../tools/index.js';
import { searchProjectMemory, formatSearchResults } from '../services/memory.js';

export const skillExecutor = {
  name: '技能执行员',
  role: 'skill_executor' as const,

  /**
   * 构造系统提示词：把 skill 正文嵌进去
   */
  buildSystemPrompt(skillName: string, skillBody: string, task: string): string {
    return `你是 ProtoForge 需求-原型工作台的**技能执行员**，协助产品经理做需求梳理与原型相关的套路化工作。

你将严格按照下方「技能说明书」执行用户任务。不要偏离技能说明书中定义的步骤和输出格式。

## 技能：${skillName}

${skillBody}

## 用户任务
${task}

## 工作要求
1. 按技能说明书的步骤逐步执行，需要材料时调用对应工具（读项目附件、检索项目记忆）。
2. 最终输出严格遵循技能说明书中定义的输出格式。
3. 你产出的是供 PM 参考/确认的分析结果，不替 PM 做需求决策；拿不准的地方明确列为「待 PM 确认」。
4. 材料/信息不足时明确指出缺什么，不要编造需求内容。
5. **全程使用中文**——包括你的思考过程、工具调用前后的说明和最终报告，不要出现英文句子。
6. 最终报告严格按技能说明书的输出格式，直接给结果，不要寒暄和复述任务。`;
  },

  /**
   * 技能执行员可用工具：项目记忆检索 + 附件列表/读取（需求分析材料来源）。
   * ProtoForge 无外部业务数据源，技能围绕“读材料 → 结构化分析 → 输出文档”展开。
   */
  tools: [
    {
      type: 'function' as const,
      function: {
        name: 'search_memory',
        description: '在当前项目的记忆库中检索历史信息：已聊定的需求要点、字段口径、业务规则、附件摘要。当任务涉及该项目之前已得出的结论或规则时调用，避免与已确认内容矛盾或重复追问。未归档到项目的对话无项目记忆。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '检索查询词，例如“审核工作台的字段口径”' },
            topK: { type: 'number', description: '返回结果数量，默认 6' },
          },
          required: ['query'],
        },
      },
    },
    ...getToolDefinitionsByNames([
      'list_project_requirements',
      'get_prototype_overview',
      'list_project_attachments',
      'read_attachment',
      'read_webpage',
    ]),
  ] as unknown as ChatCompletionTool[],
};

/**
 * 技能执行员的自定义工具处理器。
 * search_memory 不在全局工具注册表中，这里按需注入（附件工具走全局注册表）。
 * search_memory 绑定当前 projectId。
 */
export function buildSkillToolHandlers(projectId?: string | null) {
  return {
    search_memory: async (args: Record<string, unknown>) => {
      const query = args.query as string;
      if (!query) return '错误：缺少 query 参数。';
      if (!projectId) return '当前对话未归档到项目，暂无项目记忆可供检索。';
      try {
        const results = await searchProjectMemory({
          projectId,
          query,
          topK: (args.topK as number) || 6,
        });
        return formatSearchResults(results);
      } catch (e) {
        return `记忆检索出错：${e instanceof Error ? e.message : String(e)}`;
      }
    },
  };
}
