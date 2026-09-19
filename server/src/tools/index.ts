// ============================================
// 工具注册中心
// 定义调查员可调用的工具（OpenAI function calling 格式）
// ============================================

import type { ToolHandler, ToolContext, ToolDefinition } from '../types/index.js';
import { getEnterpriseData, listEnterprises } from './mockData.js';
import { listAttachments, listAttachmentsByConversation, getAttachment, updateAttachmentText, getExternalEnterprise, getDb, listRequirements, getPrototype as getPrototypeRow } from '../store/database.js';
import { extractText } from '../services/fileParser.js';
import { CATEGORY_LABELS } from '../services/classifier.js';
import { saveMemory } from '../services/memory.js';
import { fetchWebPage } from '../services/webFetch.js';
import {
  getMcpToolDefinitionsForRole,
  getAllEnabledMcpToolDefinitions,
  buildMcpToolHandlerMap,
  isMcpTool,
} from '../mcp/adapter.js';

interface ToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}

const enterpriseIdParam = {
  type: 'string',
  description: '企业唯一标识 ID，例如 HB-HS-001',
};

/**
 * 内置数据工具的前置检查：如果企业是外部企业（通过 MCP 检索登记的），
 * 内置库没有它的数据，返回明确提示引导 worker 用外部 MCP 工具取数。
 * @param enterpriseId 企业 ID
 * @param domainLabel 领域中文名（如“工商信息”“征信报告”），用于提示
 * @returns null 表示是内置企业可正常查；字符串则是要直接返回给 worker 的提示
 */
function externalEnterpriseGuard(enterpriseId: string, domainLabel: string): string | null {
  if (getEnterpriseData(enterpriseId)) return null; // 内置企业
  const ext = getExternalEnterprise(enterpriseId);
  if (ext) {
    return [
      `【提示】「${ext.name}」是通过外部数据源登记的企业，本平台内置样本库中没有它的${domainLabel}。`,
      `统一社会信用代码：${ext.credit_code || '未知'}`,
      ext.legal_person ? `法定代表人：${ext.legal_person}` : '',
      '',
      '请调用工具列表中以「[外部数据源:...]」开头的外部 MCP 工具查询真实数据。',
    ].filter(Boolean).join('\n');
  }
  return `【错误】未找到企业 ID 为 ${enterpriseId} 的数据。`;
}

/** 调查主管派活工具的 schema（handler 由 engine 注入，需要 sendSSE 上下文） */
export const DISPATCH_TOOL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'dispatch_investigation',
    description:
      '把调查任务派发给一个或多个领域专员并行执行。首次全面调查应派出全部 5 个领域；补充调查只派相关领域。每个专员会调用自己领域的工具取数并返回小结。',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: '要派出的调查任务列表',
          items: {
            type: 'object',
            properties: {
              domain: {
                type: 'string',
                enum: ['business', 'credit', 'financial', 'litigation', 'tax'],
                description: '领域：business=工商, credit=征信, financial=财务, litigation=司法, tax=税务',
              },
              instruction: {
                type: 'string',
                description: '给该专员的具体调查指令，说明要查什么、重点关注什么',
              },
            },
            required: ['domain', 'instruction'],
          },
        },
      },
      required: ['tasks'],
    },
  },
};

const TOOL_ENTRIES: ToolEntry[] = [
  {
    definition: {
      type: 'function',
      function: {
        name: 'getEnterpriseBasic',
        description: '查询企业工商基本信息，包括名称、统一社会信用代码、法定代表人、注册资本、成立日期、经营状态、注册地址、经营范围等。',
        parameters: {
          type: 'object',
          properties: { enterpriseId: enterpriseIdParam },
          required: ['enterpriseId'],
        },
      },
    },
    handler: (args) => {
      const guard = externalEnterpriseGuard(args.enterpriseId as string, '工商信息');
      if (guard) return guard;
      const data = getEnterpriseData(args.enterpriseId as string);
      if (!data) return `【错误】未找到企业 ID 为 ${args.enterpriseId} 的数据。`;
      const b = data.basic;
      return [
        '【工商基本信息】',
        `企业名称：${b.name}`,
        `统一社会信用代码：${b.creditCode}`,
        `法定代表人：${b.legalPerson}`,
        `注册资本：${b.registeredCapital}`,
        `成立日期：${b.establishDate}`,
        `经营状态：${b.status}`,
        `注册地址：${b.address}`,
        `经营范围：${b.businessScope}`,
        '',
        '【股东信息】',
        ...b.shareholders.map((sh) =>
          `${sh.type}股东：${sh.name}，持股比例 ${sh.ratio}${sh.enterpriseId ? `（企业ID：${sh.enterpriseId}，可穿透查询）` : ''}`
        ),
        '',
        '【对外投资】',
        ...(b.outwardInvestments.length > 0
          ? b.outwardInvestments.map((inv) =>
              `${inv.name}，持股比例 ${inv.ratio}（企业ID：${inv.enterpriseId}，可穿透查询）`
            )
          : ['无对外投资']),
      ].join('\n');
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'getCreditReport',
        description: '查询企业征信报告摘要，包括贷款余额、逾期记录、查询频率、对外担保、票据等信贷信息。',
        parameters: {
          type: 'object',
          properties: { enterpriseId: enterpriseIdParam },
          required: ['enterpriseId'],
        },
      },
    },
    handler: (args) => {
      const guard = externalEnterpriseGuard(args.enterpriseId as string, '征信报告');
      if (guard) return guard;
      const data = getEnterpriseData(args.enterpriseId as string);
      if (!data) return `【错误】未找到企业 ID 为 ${args.enterpriseId} 的数据。`;
      return data.creditReport;
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'getFinancialData',
        description: '查询企业财报关键指标，包括资产负债率、流动比率、营收、净利润、现金流、应收账款、其他应收款占比等。',
        parameters: {
          type: 'object',
          properties: { enterpriseId: enterpriseIdParam },
          required: ['enterpriseId'],
        },
      },
    },
    handler: (args) => {
      const guard = externalEnterpriseGuard(args.enterpriseId as string, '财务数据');
      if (guard) return guard;
      const data = getEnterpriseData(args.enterpriseId as string);
      if (!data) return `【错误】未找到企业 ID 为 ${args.enterpriseId} 的数据。`;
      return data.financial;
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'getLitigationRecords',
        description: '查询企业司法诉讼记录，包括作为原告/被告的案件、涉案金额、判决结果、失信被执行、限制高消费等。',
        parameters: {
          type: 'object',
          properties: { enterpriseId: enterpriseIdParam },
          required: ['enterpriseId'],
        },
      },
    },
    handler: (args) => {
      const guard = externalEnterpriseGuard(args.enterpriseId as string, '司法诉讼记录');
      if (guard) return guard;
      const data = getEnterpriseData(args.enterpriseId as string);
      if (!data) return `【错误】未找到企业 ID 为 ${args.enterpriseId} 的数据。`;
      return data.litigation;
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'getTaxInfo',
        description: '查询企业税务信息，包括纳税信用等级、实缴税款、欠税、税务行政处罚、非正常户、社保缴纳等。',
        parameters: {
          type: 'object',
          properties: { enterpriseId: enterpriseIdParam },
          required: ['enterpriseId'],
        },
      },
    },
    handler: (args) => {
      const guard = externalEnterpriseGuard(args.enterpriseId as string, '税务信息');
      if (guard) return guard;
      const data = getEnterpriseData(args.enterpriseId as string);
      if (!data) return `【错误】未找到企业 ID 为 ${args.enterpriseId} 的数据。`;
      return data.tax;
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'list_project_requirements',
        description: '列出当前项目沉淀的全部需求（模块/页面），含每条需求的状态（proposed 待确认/confirmed 已确认）和完整需求文档。做需求完整性体检、字段梳理、验收用例生成、需求-原型一致性检查等需要读需求文档的工作时先调用此工具。',
        parameters: {
          type: 'object',
          properties: {
            confirmedOnly: {
              type: 'boolean',
              description: '是否只返回已确认的需求（默认 false，返回全部）',
            },
          },
          required: [],
        },
      },
    },
    handler: (args, ctx: ToolContext) => {
      if (!ctx.projectId) {
        return '【提示】当前对话未归档到项目，暂无需求清单。';
      }
      let reqs = listRequirements(ctx.projectId);
      if (args?.confirmedOnly) reqs = reqs.filter((r: any) => r.status === 'confirmed');
      if (reqs.length === 0) return '当前项目还没有沉淀任何需求。';
      const lines: string[] = [];
      for (const r of reqs) {
        lines.push(`## [${r.kind === 'page' ? '页面' : '模块'}] ${r.title}（id=${r.id}，状态：${r.status === 'confirmed' ? '已确认' : '待确认'}）`);
        lines.push(r.doc_md || '（文档为空）');
        lines.push('');
      }
      return lines.join('\n');
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'get_prototype_overview',
        description: '读取当前项目已生成的原型概况：导航分组（模块）、页面清单（页面 id/标题/类型/对应需求）、数据集清单（数据集名、字段列表、记录数）。做需求变更影响分析（改需求后哪些页面/数据集要跟着动）、功能架构图等需要知道“原型现在长什么样”的工作时调用此工具。原型未生成时会明确提示。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    handler: (_args, ctx: ToolContext) => {
      if (!ctx.projectId) return '【提示】当前对话未归档到项目。';
      const row = getPrototypeRow(ctx.projectId);
      if (!row || !row.spec_json) return '当前项目还没有生成原型。';
      if (row.status !== 'ready') return `当前原型状态为「${row.status}」${row.error ? `：${row.error}` : ''}，尚无可用原型。`;
      let spec: any;
      try { spec = JSON.parse(row.spec_json); } catch { return '原型数据解析失败。'; }
      const lines: string[] = ['【原型概况】'];
      lines.push('导航/页面：');
      for (const nav of spec.nav || []) {
        lines.push(`- 页面「${nav.title}」（pageId=${nav.pageId}，模块分组：${nav.group || '未分组'}${nav.requirementId ? `，需求id=${nav.requirementId}` : ''}）`);
      }
      if (Array.isArray(spec.datasets) && spec.datasets.length) {
        lines.push('\n数据集：');
        for (const ds of spec.datasets) {
          const fields = Array.isArray(ds.records?.[0]) || Array.isArray(ds.records) ? Object.keys(ds.records?.[0] || {}) : [];
          lines.push(`- 数据集「${ds.name}」：字段 ${fields.join('、')}（共 ${Array.isArray(ds.records) ? ds.records.length : 0} 条记录${ds.statusField ? `，状态字段=${ds.statusField}` : ''}）`);
        }
      }
      lines.push('\n注：这里给的是原型结构概况（页面/数据集/字段），不含页面完整 HTML；分析影响时以页面标题、分组、数据集字段为准。');
      return lines.join('\n');
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'list_project_attachments',
        description: '列出当前项目中已上传的所有附件（如需求文档、现有系统截图、表格、参考原型、合同等），返回附件ID、文件名、类别和摘要。用户提到「我发的材料/截图/文档」时先调用此工具。',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
    handler: (_args, ctx: ToolContext) => {
      if (!ctx.projectId && !ctx.conversationId) {
        return '【提示】当前没有关联的项目或对话，无法列出附件。';
      }
      // 优先项目级；游离对话则查对话级。文档内嵌图不作为项目材料暴露给 AI
      const attachments = (ctx.projectId
        ? listAttachments(ctx.projectId)
        : listAttachmentsByConversation(ctx.conversationId!)).filter((a) => a.category !== 'embed');
      if (attachments.length === 0) return '当前对话/项目暂无已上传的附件。';
      const lines = ['【附件列表】'];
      for (const a of attachments) {
        const catLabel = CATEGORY_LABELS[a.category] || a.category;
        lines.push(`- [${a.id}] ${a.filename}（${catLabel}）`);
      }
      lines.push('\n如需查看某附件内容，用 read_attachment 传入附件 ID。');
      return lines.join('\n');
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'read_attachment',
        description: '读取项目中某个附件的完整文本内容。根据 list_project_attachments 返回的附件 ID 读取，可获取需求文档原文、截图识别文字、表格内容等。',
        parameters: {
          type: 'object',
          properties: {
            attachmentId: {
              type: 'string',
              description: '附件 ID（从 list_project_attachments 获取）',
            },
          },
          required: ['attachmentId'],
        },
      },
    },
    handler: async (args) => {
      const attachment = getAttachment(args.attachmentId as string);
      if (!attachment) return `【错误】未找到附件 ID 为 ${args.attachmentId} 的文件。`;

      // 懒加载：智能体第一次读时才提取文本，提取后缓存回数据库
      // 注意：提取失败的错误文本不缓存（以便下次重试），仅缓存真实内容
      let firstExtract = false;
      if (!attachment.extracted_text) {
        const text = await extractText(attachment.stored_path, attachment.mime_type);
        const isFailure =
          text.startsWith('【扫描件视觉识别失败：') ||
          text.startsWith('【文本提取失败：') ||
          text.startsWith('【暂不支持文本提取的文件类型：');
        if (!isFailure) {
          updateAttachmentText(attachment.id, text);
          attachment.extracted_text = text;
          firstExtract = true;
        } else {
          return `【附件：${attachment.filename}】${text}`;
        }
      }

      if (!attachment.extracted_text) {
        return `【附件：${attachment.filename}】该文件类型暂不支持文本提取。`;
      }

      // G 打底：首次提取后写入项目记忆（附件类别 + 内容前 500 字作为摘要）
      if (firstExtract && attachment.project_id) {
        const preview = attachment.extracted_text.slice(0, 500);
        const catLabel = CATEGORY_LABELS[attachment.category] || attachment.category;
        void saveMemory({
          projectId: attachment.project_id,
          sourceType: 'attachment',
          sourceId: attachment.id,
          memoryType: 'attachment_summary',
          content: `[附件] ${attachment.filename}（类别：${catLabel}）\n内容摘要：\n${preview}`,
          metadata: { attachmentId: attachment.id, filename: attachment.filename, category: attachment.category },
        });
      }

      // 返回给模型时截断，防超长附件（大 PDF/长文档）单轮顶爆上下文；全文仍完整存库
      const full = attachment.extracted_text;
      const MAX_ATTACH_CHARS = 20_000;
      const body = full.length > MAX_ATTACH_CHARS
        ? full.slice(0, MAX_ATTACH_CHARS) + `\n\n…（附件全文 ${full.length} 字，已截断；如需后半部分，可让用户指出要关注的章节/字段）`
        : full;
      return `【附件内容：${attachment.filename}】\n${body}`;
    },
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'read_webpage',
        description:
          '抓取并读取一个网页（http/https 链接）的正文内容，用于参考竞品官网、开放平台、文档站等。当 PM 发来网址、让你「看看这个链接/参考这个网站/对标这个平台」时调用。返回网页标题和正文（纯文本/markdown）。注意：只能读静态/服务端渲染页面，纯 JS 渲染的页面可能抓不到正文。',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: '要读取的网页完整链接，如 https://open.zhihuiya.com/',
            },
          },
          required: ['url'],
        },
      },
    },
    handler: async (args) => {
      const rawUrl = String(args.url || '').trim();
      if (!rawUrl) return '【错误】缺少 url 参数。';
      const page = await fetchWebPage(rawUrl);
      if (page.error) {
        return `【网页读取失败：${page.url}】${page.error}。可以请 PM 截图或把页面文字贴给你。`;
      }
      const head = page.title ? `【网页：${page.title}】\n链接：${page.url}\n\n` : `【网页：${page.url}】\n\n`;
      return head + page.markdown;
    },
  },
];

const TOOL_MAP: Record<string, ToolEntry> = Object.fromEntries(
  TOOL_ENTRIES.map((entry) => [entry.definition.function.name, entry])
);

// ============================================
// MCP 外部工具融合
// ============================================

/** MCP 工具 handler 缓存（工具名 -> handler），DB 配置变更后调用 refreshMcpTools 重建 */
let mcpHandlerCache: Record<string, ToolHandler> = {};
/** MCP 工具定义缓存（避免模块加载期 / 高频调用时查库） */
let mcpDefsCache: ToolDefinition[] = [];

/** 重建 MCP 工具缓存（启动/配置变更后调用）。安全：库未初始化时静默置空。 */
export function refreshMcpTools(): void {
  try {
    mcpHandlerCache = buildMcpToolHandlerMap();
    mcpDefsCache = getAllEnabledMcpToolDefinitions();
  } catch {
    // 数据库尚未初始化（模块加载期可能早于 initConfig），保持空缓存
    mcpHandlerCache = {};
    mcpDefsCache = [];
  }
}

/**
 * 取某角色应额外获得的 MCP 工具定义（白名单 + 角色绑定过滤）。
 * 使用缓存，避免高频查库；配置变更后 refreshMcpTools 会更新。
 */
export function getRoleMcpTools(role: string): ToolDefinition[] {
  if (mcpDefsCache.length === 0) refreshMcpTools();
  return getMcpToolDefinitionsForRole(role);
}

/** 取全部已启用 MCP 工具定义（不按角色过滤）。供技能执行员这类通用角色使用。 */
export function getAllMcpTools(): ToolDefinition[] {
  if (mcpDefsCache.length === 0) refreshMcpTools();
  return mcpDefsCache;
}

export function getAllToolDefinitions(): ToolDefinition[] {
  return TOOL_ENTRIES.map((e) => e.definition);
}

export function getToolDefinitionsByNames(names: string[]): ToolDefinition[] {
  return names
    .map((name) => {
      if (TOOL_MAP[name]) return TOOL_MAP[name].definition;
      if (name === DISPATCH_TOOL_DEFINITION.function.name) return DISPATCH_TOOL_DEFINITION;
      if (isMcpTool(name)) return mcpDefsCache.find((d) => d.function.name === name);
      return undefined;
    })
    .filter((def): def is ToolDefinition => Boolean(def));
}

/**
 * 执行工具调用（支持异步 handler）
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext = {}
): Promise<string> {
  const entry = TOOL_MAP[toolName];
  if (entry) return entry.handler(args, ctx);
  // MCP 外部工具路由
  if (isMcpTool(toolName)) {
    const handler = mcpHandlerCache[toolName];
    if (!handler) return `【错误】MCP 工具不可用（未启用或未连接）：${toolName}`;
    return handler(args, ctx);
  }
  return `【错误】未知工具：${toolName}`;
}

export function getEnterpriseList() {
  const internal = listEnterprises();
  // 合并外部企业（通过 MCP 检索登记的）
  const ext = getDb().prepare('SELECT enterprise_id, name, credit_code, legal_person, industry FROM external_enterprises').all() as Array<{
    enterprise_id: string; name: string; credit_code: string | null; legal_person: string | null; industry: string | null;
  }>;
  const external = ext.map((e) => ({
    id: e.enterprise_id,
    name: e.name,
    creditCode: e.credit_code || '',
    legalPerson: e.legal_person || '',
    industry: e.industry || '未知',
    external: true as const,
  }));
  return [...internal, ...external];
}

/** 根据 enterpriseId 解析企业显示名（内置 + 外部） */
export function resolveEnterpriseName(id: string): string {
  const internal = listEnterprises().find((e) => e.id === id);
  if (internal) return internal.name;
  const ext = getExternalEnterprise(id);
  return ext?.name || id;
}
