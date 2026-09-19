// ============================================
// 全局类型定义
// ============================================

/** 智能体角色类型 */
export type AgentRole =
  | 'investigator'
  | 'reviewer'
  | 'decision_maker'
  | 'worker_business'
  | 'worker_credit'
  | 'worker_financial'
  | 'worker_litigation'
  | 'worker_tax';

/** 智能体配置 */
export interface AgentConfig {
  /** 中文名 */
  name: string;
  /** 角色标识 */
  role: AgentRole;
  /** 系统提示词 */
  systemPrompt: string;
  /** 可调用的工具名列表 */
  availableTools?: string[];
}

/** SSE 事件类型 */
export type SSEEventType =
  | 'assessment_start'
  | 'assessment_end'
  | 'agent_start'
  | 'agent_message'
  | 'reasoning'
  | 'tool_call'
  | 'tool_result'
  | 'review_feedback'
  | 'decision'
  | 'status'
  | 'skill_start'
  | 'skill_message'
  | 'skill_reasoning'
  | 'skill_status'
  | 'skill_tool_call'
  | 'skill_done'
  | 'aborted'
  | 'error'
  | 'requirement' // ProtoForge：沉淀出新需求
  | 'pool_item' // ProtoForge：收入需求池
  | 'design_decision' // ProtoForge：记录设计决策
  | 'article' // ContentForge：沉淀/更新文章
  | 'channel_versions' // ContentForge：渠道版本生成完成
  | 'done';

/** SSE 事件 */
export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown> | unknown[] | string | number | boolean | null;
}

/** 审查官返回的操作 */
export type ReviewAction = 'supplement' | 'approve';

/** 审查官审查结果 */
export interface ReviewResult {
  action: ReviewAction;
  questions?: string[];
  summary?: string;
}

/** 决策类型 */
export type DecisionType = 'pass' | 'reject' | 'review';

/** 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high';

/** 决策官最终决策 */
export interface DecisionResult {
  decision: DecisionType;
  riskLevel: RiskLevel;
  reasons: string[];
  suggestions: string[];
}

/** 评估状态 */
export type AssessmentStatus = 'running' | 'completed' | 'failed';

/** 评估记录（数据库行） */
export interface AssessmentRow {
  id: string;
  enterprise_id: string;
  project_id: string | null;
  conversation_id: string | null;
  status: AssessmentStatus;
  created_at: string;
  completed_at: string | null;
  decision: DecisionType | null;
  risk_level: RiskLevel | null;
  reasons: string | null;
  suggestions: string | null;
  summary: string | null;
  full_log: string;
}

/** 模型配置（数据库行） */
export interface ModelConfigRow {
  id: number;
  base_url: string;
  api_key: string;
  model_name: string;
  embedding_model?: string | null;
}

/** 会话角色 */
export type SessionRole = 'user' | 'assistant' | 'system' | 'agent';

// ============================================
// 项目（文件夹）：业务容器，包含多个企业成员 + 多轮对话 + 沉淀档案
// ============================================

/** 项目中的企业角色（担保场景：被保证人/受益人/反担保人/关联企业等） */
export type ProjectEntityRole =
  | 'borrower'      // 被保证人/借款人
  | 'beneficiary'   // 受益人
  | 'guarantor'     // 反担保人
  | 'related'       // 关联企业
  | 'other';        // 其他

/** 项目企业成员（数据库行） */
export interface ProjectEntityRow {
  id: number;
  project_id: string;
  enterprise_id: string;
  role: ProjectEntityRole;
  created_at: string;
}

/** 项目档案中的评估结论沉淀 */
export interface ArchiveAssessment {
  assessmentId: string;
  enterpriseId: string;
  enterpriseName: string;
  decision: DecisionType;
  riskLevel: RiskLevel;
  reasons: string[];
  suggestions: string[];
  summary: string;
  assessedAt: string;
}

/** 项目（数据库行） */
export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  archive: string; // JSON: 项目结构化档案（评估结论沉淀 + 关键事实）
  created_at: string;
  updated_at: string;
}

/** 项目详情（含成员企业列表） */
export interface ProjectDetail extends ProjectRow {
  entities: Array<{
    enterpriseId: string;
    name: string;
    legalPerson: string;
    industry: string;
    role: ProjectEntityRole;
  }>;
  assessments: ArchiveAssessment[];
}

/** 对话消息（数据库行） */
export interface MessageRow {
  id: number;
  conversation_id: string;
  role: SessionRole;
  content: string;
  attachments?: string; // JSON string
  agent_role?: string | null;
  agent_name?: string | null;
  tool_calls?: string | null; // JSON string
  review_feedback?: string | null; // JSON string
  decision?: string | null; // JSON string
  assessment_id?: string | null;
  reasoning_content?: string | null;
  req_ids?: string | null; // ProtoForge：该条 assistant 消息沉淀出的需求 id 列表（JSON）
  ref_requirements?: string | null; // ProtoForge：该条 user 消息 @ 引用的需求 id 列表（JSON）
  created_at: string;
}

/** 需求清单行（ProtoForge） */
export interface RequirementRow {
  id: string;
  project_id: string;
  title: string;
  status: 'proposed' | 'confirmed';
  doc_md: string;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

/** 对话（数据库行，隶属于项目） */
export interface ConversationRow {
  id: string;
  project_id: string | null;
  title: string;
  summary?: string | null;       // 早期对话摘要（上下文压缩）
  summarized_count?: number;     // 已折叠进摘要的消息条数
  created_at: string;
  updated_at: string;
}

/** 企业基本信息 */
export interface EnterpriseShareholder {
  /** 股东名称 */
  name: string;
  /** 股东类型 */
  type: '自然人' | '企业';
  /** 持股比例（如 '45%'） */
  ratio: string;
  /** 企业股东的唯一标识，可用于二次 getEnterpriseBasic 穿透；自然人无此字段 */
  enterpriseId?: string;
}

export interface EnterpriseInvestment {
  /** 被投资企业名称 */
  name: string;
  /** 持股比例 */
  ratio: string;
  /** 被投资企业 ID，可用于穿透 */
  enterpriseId: string;
}

export interface EnterpriseBasic {
  id: string;
  name: string;
  creditCode: string;
  legalPerson: string;
  registeredCapital: string;
  establishDate: string;
  status: string;
  address: string;
  businessScope: string;
  /** 股东列表 */
  shareholders: EnterpriseShareholder[];
  /** 对外投资列表 */
  outwardInvestments: EnterpriseInvestment[];
}

/** 企业简要信息（列表用） */
export interface EnterpriseSummary {
  id: string;
  name: string;
  creditCode: string;
  legalPerson: string;
  industry: string;
}

/** 附件分类（模型自动打标） */
export type AttachmentCategory =
  | 'doc'            // 需求/参考文档
  | 'screenshot'     // 截图/图片
  | 'form'           // 表格/清单
  | 'prototype'      // 原型/设计稿
  | 'contract'       // 合同/协议
  | 'report'         // 报告
  | 'data'           // 数据样例
  | 'webpage'        // 网页快照（贴链接自动抓取）
  | 'embed'          // 文档内嵌图（markdown 编辑器粘贴，不进文件柜主列表/AI 材料清单）
  | 'other';

/** 附件（数据库行） */
export interface AttachmentRow {
  id: string;
  project_id: string | null;
  conversation_id: string | null;
  filename: string;
  /** 磁盘路径；网页快照无本地文件，为空字符串 */
  stored_path: string;
  mime_type: string;
  size_bytes: number;
  category: AttachmentCategory;
  summary: string;
  extracted_text: string;
  /** 网页快照的原始链接（其余附件为 null） */
  source_url?: string | null;
  uploader: string;
  created_at: string;
}

/** 附件简要信息（返回给前端，不含全文） */
export interface AttachmentMeta {
  id: string;
  filename: string;
  category: AttachmentCategory;
  summary: string;
  sizeBytes: number;
  mimeType: string;
  /** 网页快照的原始链接 */
  sourceUrl?: string | null;
  createdAt: string;
}

/** 记忆来源类型 */
export type MemorySourceType = 'assessment' | 'enterprise_profile' | 'entity' | 'attachment' | 'extracted' | 'design_decision';

/** 记忆语义类型 */
export type MemoryType = 'decision' | 'profile' | 'relationship' | 'attachment_summary' | 'fact' | 'rule';

/** 记忆片段（数据库行） */
export interface MemoryChunkRow {
  id: string;
  project_id: string;
  source_type: MemorySourceType;
  source_id: string;
  memory_type: MemoryType;
  content: string;
  metadata: string; // JSON string
  embedding: Buffer | null;
  created_at: string;
}

/** 记忆写入参数 */
export interface MemoryChunkInput {
  projectId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  memoryType: MemoryType;
  content: string;
  metadata?: Record<string, unknown>;
}

/** 记忆检索结果 */
export interface MemorySearchResult {
  id: string;
  content: string;
  sourceType: MemorySourceType;
  memoryType: MemoryType;
  metadata: Record<string, unknown>;
  score: number;
  createdAt: string;
}

/** 工具执行上下文 */
export interface ToolContext {
  projectId?: string | null;
  conversationId?: string | null;
  enterpriseId?: string;
}

/** 工具执行函数类型（支持同步或异步返回） */
export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => string | Promise<string>;

/** 工具定义（OpenAI function calling 格式，parameters 为宽松 JSON Schema 以容纳 MCP 工具） */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties?: Record<string, unknown>;
      required?: string[];
      [key: string]: unknown;
    };
  };
}
