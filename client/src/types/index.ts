// SSE 事件类型
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
  | 'requirement' // ProtoForge：沉淀出新需求
  | 'pool_item' // ProtoForge：收入需求池
  | 'design_decision' // ProtoForge：记录设计决策
  | 'article' // ContentForge：沉淀/更新文章
  | 'channel_versions' // ContentForge：渠道版本生成完成
  | 'aborted'
  | 'error'
  | 'done'

export interface SSEEvent {
  type: SSEEventType
  data: any
}

export type AgentRole =
  | 'receptionist'
  | 'investigator'
  | 'reviewer'
  | 'decision_maker'
  | 'skill_executor'
  | 'worker_business'
  | 'worker_credit'
  | 'worker_financial'
  | 'worker_litigation'
  | 'worker_tax'

export interface ToolCallRecord {
  toolName: string
  args: any
  result?: any
  loading: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  agentRole?: AgentRole
  agentName?: string
  content: string
  reasoningContent?: string
  toolCalls: ToolCallRecord[]
  reviewFeedback?: ReviewFeedback
  decision?: DecisionResult
  assessmentId?: string
  skillMeta?: { skillId: string; skillName: string; task?: string }
  attachments?: Array<{ id: string; filename: string; categoryLabel: string; sizeBytes: number; category?: string; sourceUrl?: string | null }>
  /** ProtoForge：本条消息 @ 引用的需求（模块/页面） */
  refArticles?: Array<{ id: string; title: string; status?: string; seriesTitle?: string }>
  status?: string
  isStatus?: boolean
  requirementIds?: string[] // ProtoForge：该条消息沉淀出的需求 id
  poolIds?: string[] // ProtoForge：该条消息收入需求池的 idea id
  decisionIds?: string[] // ProtoForge：该条消息记录的设计决策 id
  articleIds?: string[] // ContentForge：该条消息沉淀/更新的文章 id
  articles?: ArticleCardInfo[] // ContentForge：文章沉淀卡片（运行时 SSE 推送）
  requirements?: RequirementCardInfo[] // ProtoForge：沉淀卡片（运行时 SSE 推送）
  poolItems?: RequirementCardInfo[] // ProtoForge：入池卡片（运行时 SSE 推送）
  decisions?: DesignDecisionCardInfo[] // ProtoForge：设计决策记录卡片（运行时 SSE 推送）
  timestamp: number
}

// ProtoForge：沉淀需求卡片信息
export interface RequirementCardInfo {
  id: string
  title: string
  status: 'proposed' | 'confirmed'
}

// ContentForge：文章沉淀卡片信息
export interface ArticleCardInfo {
  id: string
  title: string
  status?: string
  kind?: 'article' | 'series'
  revised?: boolean
  published?: boolean
}

// ContentForge：推广主体类型
export type SubjectType =
  | 'product' | 'official_account' | 'personal_ip' | 'service' | 'event' | 'community' | 'other'

export interface SubjectProfile {
  positioning?: string
  audience?: string
  pains?: string
  sellingPoints?: string[]
  difference?: string
  cta?: string
  ctaTarget?: string
  tone?: string
  notes?: string
  [k: string]: unknown
}

export interface SubjectInfo {
  subjectType: SubjectType
  profile: SubjectProfile
  kitId?: string | null
}

// ContentForge：写作规范包
export interface ContentLine {
  key: string
  label: string
  source?: string
  focus?: string
}

export interface WritingKit {
  id: string
  name: string
  description: string
  signoff: string
  contentLines: ContentLine[]
  isBuiltin: boolean
  positioningMd: string
  writingMd: string
  titleMd: string
  spreadMd: string
}

export interface Series {
  id: string
  project_id: string
  title: string
  description: string
  sort_order: number
  created_at: string
  updated_at: string
}

export type ArticleStatus = 'topic' | 'writing' | 'final' | 'published'
export type ChannelKey = 'wechat' | 'xhs' | 'markdown'

export interface Article {
  id: string
  project_id: string
  series_id: string | null
  title: string
  angle: string
  doc_md: string
  status: ArticleStatus
  content_line?: string
  sort_order: number
  source_conversation_id: string | null
  created_at: string
  updated_at: string
  channels?: ChannelKey[]
}

export interface ChannelVersion {
  id: string
  article_id: string
  channel: ChannelKey
  title: string
  content: string
  extra_json: string
  created_at: string
  updated_at: string
}

export interface PublishRecord {
  id: string
  article_id: string
  project_id: string
  channel: ChannelKey
  url: string
  metrics_json: string
  note: string
  published_at: string
  created_at: string
  updated_at: string
}

export interface ArticleDetail extends Article {
  channelVersions: ChannelVersion[]
  publishes: PublishRecord[]
}

// ProtoForge：需求清单条目
export interface Requirement {
  id: string
  project_id: string
  title: string
  kind: 'module' | 'page' | 'idea'
  parent_id: string | null
  status: 'proposed' | 'confirmed'
  doc_md: string
  source_conversation_id: string | null
  // 需求池字段（kind='idea'）
  summary?: string
  pool_status?: '' | 'raw' | 'ready' | 'shelved'
  urgent?: number | boolean
  important?: number | boolean
  related_module_id?: string | null
  proposer?: string
  created_at: string
  updated_at: string
}

// 需求文档版本快照
export interface RequirementVersion {
  id: string
  requirement_id: string
  version_no: number
  title: string
  doc_md: string
  status: 'proposed' | 'confirmed'
  trigger: 'create' | 'status' | 'manual' | 'restore' | 'ai'
  actor: string
  note: string
  created_at: string
}

// ProtoForge：设计决策（决策脉络，回答「当时为什么这么定」）
export interface DesignDecision {
  id: string
  projectId: string
  topic: string
  /** 需求点：文档里的设计点/章节（单值）；空=整条需求的通用决策 */
  point: string
  /** 锚文本：从需求文档摘的原句，行内高亮；空=文档里还没这句话 */
  anchorText: string
  conclusion: string
  rationale: string
  rejected: Array<{ option: string; reason: string }>
  sourceType: 'meeting' | 'chat' | 'manual'
  sourceLabel: string
  sourceConversationId: string | null
  sourceExcerpt: string
  createdAt: string
  requirementIds: string[]
}

export interface DesignDecisionCardInfo {
  id: string
  topic: string
}

export interface ReviewFeedback {
  action: 'supplement' | 'approve'
  questions?: string[]
  summary?: string
  round: number
  maxRoundsReached?: boolean
}

export interface DecisionResult {
  decision: 'pass' | 'reject' | 'review'
  riskLevel: 'low' | 'medium' | 'high'
  reasons: string[]
  suggestions: string[]
}

// 项目（文件夹）
export interface Project {
  id: string
  name: string
  description: string
  entityCount: number
  assessmentCount: number
  created_at: string
  updated_at: string
}

export interface ProjectEntity {
  enterpriseId: string
  name: string
  role: 'borrower' | 'beneficiary' | 'guarantor' | 'related' | 'other'
}

export interface ArchiveAssessment {
  assessmentId: string
  enterpriseId: string
  enterpriseName: string
  decision: string
  riskLevel: string
  summary: string
  reasons: string[]
  suggestions: string[]
  assessedAt: string
}

export interface ProjectDetail extends Project {
  entities: ProjectEntity[]
  archive: { assessments: ArchiveAssessment[]; keyFacts: string[] }
  conversations: Conversation[]
}

// 对话
export interface Conversation {
  id: string
  project_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface StoredMessage {
  id: number
  conversation_id: string
  role: 'user' | 'assistant' | 'system' | 'agent'
  content: string
  attachments?: string // JSON string
  agent_role?: string | null
  agent_name?: string | null
  tool_calls?: string | null // JSON string
  review_feedback?: string | null // JSON string
  decision?: string | null // JSON string
  assessment_id?: string | null
  reasoning_content?: string | null
  skill_meta?: string | null // JSON string
  created_at: string
}

export interface WxmpConfigStatus {
  configured: boolean
  appId: string
  hasSecret: boolean
  credentialsPath: string
}

export interface WxmpTestResult {
  ok: boolean
  appId?: string
  message?: string
  stage?: 'config' | 'whitelist' | 'credentials' | 'unknown'
  errcode?: number
  currentIp?: string | null
  error?: string
  guide?: string
  detail?: string
}

export interface ModelConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 向量/嵌入模型名（记忆检索用）；后端默认 doubao-embedding-vision */
  embeddingModel?: string
  /** 记忆库已存向量条数（前端判断换模型时是否需要重建） */
  memoryChunkCount?: number
}

export interface SkillSummary {
  id: string
  name: string
  description: string
  keywords: string[]
}
