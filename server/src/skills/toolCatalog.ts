// ============================================
// 技能执行员工具目录（单一数据源）
// 描述技能执行员可调用的全部工具，供：
//   1. AI 起草 SKILL.md 时注入提示词（告诉模型有哪些工具可调）
//   2. 前端技能中心「可用工具」面板/工具目录展示
// 新增内置工具时只需在 BUILTIN_SKILL_TOOLS 登记一处；
// 已启用且绑定了技能执行员的 MCP 外部工具会自动合并进来。
// ============================================

import { listEnabledMcpTools } from '../store/mcpStore.js';
import { buildBoundToolName } from '../mcp/adapter.js';

export interface SkillToolMeta {
  /** 工具函数名（与执行员注册的 function name 一致） */
  name: string;
  /** 中文名 */
  label: string;
  /** 分组 */
  group: string;
  /** 一句话说明（给用户看） */
  summary: string;
  /** 返回什么数据（给写技能的人看） */
  returns: string;
  /** 是否需要企业 ID 参数 */
  needsEnterpriseId?: boolean;
}

export const BUILTIN_SKILL_TOOLS: SkillToolMeta[] = [
  {
    name: 'list_project_requirements',
    label: '项目需求清单',
    group: '需求材料',
    summary: '列出当前项目沉淀的全部模块/页面需求，含状态（待确认/已确认）和完整需求文档。做需求体检、字段梳理、验收用例生成、一致性检查时先调它。',
    returns: '每条需求的类型、标题、状态、完整需求文档文本',
  },
  {
    name: 'get_prototype_overview',
    label: '原型概况',
    group: '原型',
    summary: '读取当前项目已生成原型的结构概况：导航分组、页面清单（id/标题/类型/对应需求）、数据集（字段、记录数、状态字段）。变更影响分析、架构图等需要知道“原型现在长什么样”的工作先调它。',
    returns: '页面清单（pageId/标题/模块分组/需求 id）、数据集清单（名称/字段/记录数/状态字段）',
  },
  {
    name: 'list_project_attachments',
    label: '项目附件列表',
    group: '项目材料',
    summary: '列出当前项目中已上传的全部附件（需求文档、现有系统截图、表格、参考原型、合同等）。用户提到「我发的材料/截图/文档」或需要查阅项目材料时先调它。',
    returns: '附件 ID、文件名、类别、摘要',
  },
  {
    name: 'read_attachment',
    label: '读取附件内容',
    group: '项目材料',
    summary: '根据附件 ID 读取某个附件的完整文本（截图类附件返回 OCR/视觉识别出的文字）。用于细读需求文档原文、截图内容、表格字段。',
    returns: '附件的完整文本内容',
  },
  {
    name: 'read_webpage',
    label: '读取网页',
    group: '项目材料',
    summary: '抓取并读取一个 http/https 网页链接的正文（竞品官网、开放平台、文档站等）。PM 发来网址、要求参考/对标某个网站时调用。只读得到静态/服务端渲染页面，纯 JS 页面可能抓不到。',
    returns: '网页标题 + 正文纯文本/markdown',
  },
  {
    name: 'search_memory',
    label: '项目记忆检索',
    group: '辅助',
    summary: '在当前项目记忆库中检索历史结论、已定的需求要点、字段口径、业务规则，避免跟用户已经聊过的内容矛盾或重复追问。未归档到项目的对话无项目记忆。',
    returns: '与查询词相关的历史记忆片段（结论、事实、规则）',
  },
];

/** MCP 外部工具的返回说明（MCP 协议无结构化返回字段，统一兜底） */
const MCP_TOOL_RETURNS = '返回该工具的原始查询结果（JSON/文本）';

/** 从 MCP 工具的 inputSchema 推断是否需要企业 ID 参数 */
function mcpToolNeedsEnterpriseId(inputSchemaJson: string): boolean {
  try {
    const schema = JSON.parse(inputSchemaJson || '{}') as {
      properties?: Record<string, unknown>;
    };
    const props = schema.properties || {};
    return Object.keys(props).some((k) => /^enterprise[_]?id$/i.test(k));
  } catch {
    return false;
  }
}

/** 把全部已启用的 MCP 工具转成 SkillToolMeta（不按角色过滤，技能执行员可用所有已启用工具） */
function listMcpSkillTools(): SkillToolMeta[] {
  let rows: ReturnType<typeof listEnabledMcpTools> = [];
  try {
    rows = listEnabledMcpTools();
  } catch {
    // 库未初始化（模块加载早于 DB 初始化）时静默返回空
    return [];
  }
  return rows.map((t) => ({
    name: buildBoundToolName(t.server_slug, t.tool_name),
    label: t.display_name || t.tool_name,
    group: '外部数据源',
    summary: `[${t.server_name}] ${t.description || t.tool_name}`,
    returns: MCP_TOOL_RETURNS,
    needsEnterpriseId: mcpToolNeedsEnterpriseId(t.input_schema_json),
  }));
}

/**
 * 取技能执行员的完整工具目录：内置工具 + 已启用且绑定技能执行员的 MCP 工具。
 * 这是单一数据源，外部一律走这个函数，不要直接引用 BUILTIN_SKILL_TOOLS。
 */
export function listSkillTools(): SkillToolMeta[] {
  return [...BUILTIN_SKILL_TOOLS, ...listMcpSkillTools()];
}

/** 按名取工具元数据 */
export function getSkillTool(name: string): SkillToolMeta | undefined {
  return listSkillTools().find((t) => t.name === name);
}

/**
 * 生成给 LLM 看的工具清单文本（AI 起草技能时注入 system prompt）。
 * 格式统一，避免在提示词里硬编码。动态反映当前启用的 MCP 工具。
 */
export function buildToolCatalogForPrompt(): string {
  const lines: string[] = [];
  for (const t of listSkillTools()) {
    const param = t.needsEnterpriseId ? '（调用时需传入企业 ID）' : '';
    lines.push(`- ${t.name}：${t.summary}${param} 返回：${t.returns}`);
  }
  return lines.join('\n');
}
