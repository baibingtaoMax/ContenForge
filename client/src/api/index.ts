import axios from 'axios'
import type { Project, ProjectDetail, Conversation, StoredMessage, ModelConfig, SkillSummary, Requirement, RequirementVersion, DesignDecision } from '@/types'

const api = axios.create({ baseURL: '/api', timeout: 30000 })

// 发送消息（SSE）
export async function sendMessage(
  message: string,
  signal: AbortSignal,
  projectId?: string,
  conversationId?: string,
  attachments?: unknown[],
  forceSkillId?: string,
  refRequirements?: unknown[]
) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, projectId, conversationId, attachments: attachments || [], forceSkillId, refRequirements: refRequirements || [] }),
    signal
  })
  if (!response.ok) throw new Error(`请求失败: ${response.status}`)
  return response.body!.getReader()
}

// 续传：重连到正在运行的评估（回放 + 实时），返回 SSE reader
export async function resumeChat(conversationId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/chat/resume/${encodeURIComponent(conversationId)}`, { signal })
  if (!response.ok) throw new Error(`续传失败: ${response.status}`)
  return response.body!.getReader()
}

// 查询运行中的对话
export const getRunningConversations = (): Promise<{ conversationIds: string[] }> =>
  api.get('/chat/running').then((r) => r.data)

// 中断当前对话
export async function abortChat(conversationId?: string) {
  await fetch('/api/chat/abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId })
  })
}

// 项目
export const getProjects = () => api.get<{ projects: Project[] }>('/projects').then((r) => r.data.projects)
export const createProject = (name: string, description = '') =>
  api.post<{ id: string }>('/projects', { name, description }).then((r) => r.data)
export const getProjectDetail = (id: string) =>
  api.get<ProjectDetail>(`/projects/${id}`).then((r) => r.data)
export const renameProject = (id: string, name: string, description = '') =>
  api.put(`/projects/${id}`, { name, description })
export const deleteProject = (id: string) => api.delete(`/projects/${id}`)

// 需求清单（ProtoForge）
export const listRequirements = (projectId: string, includeIdeas = false): Promise<Requirement[]> =>
  api.get(`/projects/${projectId}/requirements`, { params: includeIdeas ? { includeIdeas: '1' } : {} }).then((r) => r.data)
export const createRequirement = (projectId: string, title: string, docMd = '', kind: 'module' | 'page' = 'module', parentId: string | null = null) =>
  api.post(`/projects/${projectId}/requirements`, { title, docMd, kind, parentId }).then((r) => r.data)
/** 需求池手动新建（标题 + 提出人 + markdown 说明） */
export const createPoolItem = (projectId: string, payload: { title: string; proposer?: string; docMd?: string }): Promise<Requirement> =>
  api.post(`/projects/${projectId}/requirements`, {
    title: payload.title,
    proposer: payload.proposer || '',
    docMd: payload.docMd || '',
    kind: 'idea',
    poolStatus: 'raw',
  }).then((r) => r.data)
/** 需求池条目原地转正为模块/页面 */
export const promotePoolItem = (
  rid: string,
  payload: { kind: 'module' | 'page'; title?: string; moduleId?: string; moduleTitle?: string }
): Promise<Requirement> => api.post(`/requirements/${rid}/promote`, payload).then((r) => r.data)
export const getRequirement = (rid: string): Promise<Requirement> =>
  api.get(`/requirements/${rid}`).then((r) => r.data)
export const updateRequirement = (
  rid: string,
  patch: Partial<Pick<Requirement, 'title' | 'status' | 'doc_md' | 'kind' | 'parent_id' | 'summary' | 'pool_status' | 'urgent' | 'important' | 'related_module_id' | 'proposer'>>
): Promise<Requirement> => api.put(`/requirements/${rid}`, patch).then((r) => r.data)
export const deleteRequirement = (rid: string) => api.delete(`/requirements/${rid}`)

// 需求文档版本
export const listReqVersions = (rid: string): Promise<RequirementVersion[]> =>
  api.get(`/requirements/${rid}/versions`).then((r) => r.data.versions)
export const saveReqVersion = (rid: string, note?: string): Promise<{ versionNo: number }> =>
  api.post(`/requirements/${rid}/versions`, { note: note || '' }).then((r) => r.data)
export const restoreReqVersion = (rid: string, vid: string) =>
  api.post(`/requirements/${rid}/versions/${vid}/restore`).then((r) => r.data)

// 设计决策（决策脉络）
export const listDecisions = (projectId: string): Promise<DesignDecision[]> =>
  api.get(`/projects/${projectId}/decisions`).then((r) => r.data.decisions)
export const listDecisionsByRequirement = (rid: string): Promise<DesignDecision[]> =>
  api.get(`/requirements/${rid}/decisions`).then((r) => r.data.decisions)
export const getDecision = (id: string): Promise<DesignDecision> =>
  api.get(`/decisions/${id}`).then((r) => r.data)
export const createDecision = (
  projectId: string,
  payload: Partial<Pick<DesignDecision, 'topic' | 'point' | 'anchorText' | 'conclusion' | 'rationale' | 'rejected' | 'sourceType' | 'sourceLabel' | 'sourceExcerpt' | 'requirementIds'>>
): Promise<DesignDecision> =>
  api.post(`/projects/${projectId}/decisions`, payload).then((r) => r.data)
export const updateDecision = (
  id: string,
  payload: Partial<Pick<DesignDecision, 'topic' | 'point' | 'anchorText' | 'conclusion' | 'rationale' | 'rejected' | 'sourceType' | 'sourceLabel' | 'sourceExcerpt' | 'requirementIds'>>
): Promise<DesignDecision> => api.put(`/decisions/${id}`, payload).then((r) => r.data)
export const deleteDecision = (id: string) => api.delete(`/decisions/${id}`)

// ===== 原型标注 =====
export interface Annotation {
  id: string
  project_id: string
  page_id: string
  page_title: string
  target_kind: string
  target_label: string
  content: string
  author: string
  status: 'open' | 'resolved'
  proto_applied?: number
  needs_req?: number
  created_at: string
}
export const listAnnotations = (projectId: string, openOnly = false): Promise<Annotation[]> =>
  api.get(`/projects/${projectId}/annotations`, { params: openOnly ? { open: 1 } : {} }).then((r) => r.data.annotations)

export const resolveAnnotationApi = (id: string): Promise<void> =>
  api.post(`/annotations/${id}/resolve`).then(() => undefined)

// ============================================
// 需求变更周报
// ============================================
export type WeeklyAudience = 'boss' | 'client'

export interface WeeklyReportData {
  projectId: string
  projectName: string
  from: string
  to: string
  audience: WeeklyAudience
  /** AI 综述（Markdown）；失败降级时为空 */
  overview: string
  overviewError: string | null
  snapshot: {
    totalModules: number
    totalPages: number
    confirmedModules: number
    confirmedPages: number
    pending: Array<{ id: string; title: string; kind: 'module' | 'page'; updatedAt: string }>
  }
  stats: {
    newModules: number
    newPages: number
    confirmed: number
    rejected: number
    revised: number
    promoted: number
    decisions: number
    newAnnotations: number
    openAnnotations: number
  }
  created: Array<{ requirementId: string; title: string; kind: 'module' | 'page' | 'idea'; actor: string; createdAt: string }>
  statusChanges: Array<{ requirementId: string; title: string; kind: string; toStatus: 'confirmed' | 'proposed'; actor: string; note: string; versionNo: number; createdAt: string }>
  revisions: Array<{ requirementId: string; title: string; kind: string; trigger: 'manual' | 'ai' | 'restore'; versionNo: number; actor: string; note: string; createdAt: string }>
  promotions: Array<{ requirementId: string; title: string; kind: string; trigger: string; versionNo: number; actor: string; note: string; createdAt: string }>
  decisions: Array<{ id: string; topic: string; point: string; conclusion: string; sourceLabel: string; createdAt: string }>
  newAnnotations: Array<{ id: string; pageTitle: string; targetLabel: string; content: string; author: string; createdAt: string }>
  openAnnotations: Array<{ id: string; pageTitle: string; targetLabel: string; content: string; author: string; createdAt: string }>
}

/** 生成周报（含 AI 综述，后端失败会自动降级为纯清单；AI 慢，给 3 分钟超时） */
export const generateWeeklyReport = (
  projectId: string,
  payload: { from: string; to: string; audience: WeeklyAudience }
): Promise<WeeklyReportData> =>
  api
    .post(`/projects/${projectId}/weekly-report`, payload, { timeout: 180000 })
    .then((r) => r.data)

export interface ReqSyncResult {
  revised: Array<{ id: string; title: string }>
  created: Array<{ id: string; title: string }>
  answer: string
}
export const syncRequirementsApi = (projectId: string, annotationIds?: string[]): Promise<ReqSyncResult> =>
  api
    .post(`/projects/${projectId}/annotations/sync-requirements`, annotationIds?.length ? { annotationIds } : {})
    .then((r) => r.data)

// 对话
export const getConversations = (projectId: string) =>
  api.get<{ conversations: Conversation[] }>(`/projects/${projectId}/conversations`).then((r) => r.data.conversations)
export const createConversation = (projectId: string, title = '新对话') =>
  api.post<{ id: string }>(`/projects/${projectId}/conversations`, { title }).then((r) => r.data)
// 游离对话（不隶属任何项目）
export const getUnassignedConversations = () =>
  api.get<{ conversations: Conversation[] }>('/conversations').then((r) => r.data.conversations)
// 新建对话：不传 projectId 则为游离对话
export const createConversationStandalone = (projectId?: string, title = '新对话') =>
  api.post<{ id: string; projectId: string | null }>('/conversations', { projectId, title }).then((r) => r.data)
// 将对话归入某项目（projectId 传 null 取消归档）
export const assignConversation = (conversationId: string, projectId: string | null) =>
  api.patch(`/conversations/${conversationId}/project`, { projectId }).then((r) => r.data)
export const getMessages = (conversationId: string) =>
  api.get<{ messages: StoredMessage[] }>(`/conversations/${conversationId}/messages`).then((r) => r.data.messages)
// 追加一条用户消息（用于附件上传，不触发 LLM）
export const appendUserMessage = (
  conversationId: string,
  payload: { content?: string; attachments?: unknown[] }
) => api.post(`/conversations/${conversationId}/messages`, payload).then((r) => r.data)
export const deleteConversation = (id: string) => api.delete(`/conversations/${id}`)
export const renameConversation = (id: string, title: string) =>
  api.patch(`/conversations/${id}`, { title })

// 企业
export const getEnterprises = () => api.get('/enterprises').then((r) => r.data.enterprises)

// 附件
export interface AttachmentMeta {
  id: string
  filename: string
  category: string
  categoryLabel: string
  summary: string
  sizeBytes: number
  mimeType: string
  sourceUrl?: string | null
  createdAt: string
  /** 来源对话（在对话里上传的附件） */
  conversationId?: string | null
  conversationTitle?: string | null
  uploader?: string | null
  /** 内嵌图：是否还被项目需求文档引用（孤儿图可清理） */
  referenced?: boolean
}

export interface AttachmentDetail extends AttachmentMeta {
  extractedText: string
  referencedBy: Array<{ id: string; title: string; kind: string }>
}

export const listAttachments = (projectId: string) =>
  api.get<{ attachments: AttachmentMeta[]; embedCount?: number }>(`/projects/${projectId}/attachments`).then((r) => r.data)

/** 文件柜折叠区：列出文档内嵌图（含引用状态） */
export const listEmbedAttachments = (projectId: string): Promise<{ attachments: AttachmentMeta[]; embedCount: number }> =>
  api.get(`/projects/${projectId}/attachments`, { params: { include: 'embed' } }).then((r) => r.data)

/** 附件中心：单附件详情（提取文本 + 被哪些需求文档引用） */
export const getAttachmentDetail = (id: string) =>
  api.get<AttachmentDetail>(`/attachments/${id}/detail`).then((r) => r.data)

// 对话级附件列表
export const listConversationAttachments = (conversationId: string) =>
  api.get<{ attachments: AttachmentMeta[] }>(`/conversations/${conversationId}/attachments`).then((r) => r.data.attachments)

// 对话级上传（主入口，游离对话直接传）
export const uploadConversationAttachment = (conversationId: string, file: File,
  onProgress?: (percent: number) => void) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/conversations/${conversationId}/attachments`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total))
    }
  }).then((r) => r.data)
}

export const uploadAttachment = (projectId: string, file: File,
  onProgress?: (percent: number) => void, embed = false) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/projects/${projectId}/attachments`, form, {
    params: embed ? { embed: '1' } : undefined,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded * 100) / e.total))
    }
  }).then((r) => r.data)
}

export const downloadAttachmentUrl = (id: string) => `/api/attachments/${id}/download`

export const deleteAttachment = (id: string) => api.delete(`/attachments/${id}`)

/** 附件中心：改分类（手动纠正） */
export const updateAttachmentMeta = (id: string, category: string) =>
  api.patch(`/attachments/${id}`, { category }).then((r) => r.data)

// 网页快照附件：贴链接时抓取正文落库
export const createWebAttachment = (conversationId: string, url: string) =>
  api.post(`/conversations/${conversationId}/web-attachments`, { url }).then((r) => r.data)

// 模型配置
export const getModelConfig = (): Promise<ModelConfig> => api.get('/config/models').then((r) => r.data)
export const updateModelConfig = (config: Partial<ModelConfig>) =>
  api.put<{ message: string; embeddingModelChanged?: boolean; memoryChunkCount?: number }>('/config/models', config).then((r) => r.data)
// 清空向量记忆库（换 embedding 模型后维度不匹配，重建用）
export const rebuildMemory = () =>
  api.post<{ ok: boolean; removed: number }>('/config/memory/rebuild').then((r) => r.data)

// 技能
export interface SkillInput {
  id?: string
  name: string
  description?: string
  keywords?: string[]
  tools?: string[]
  body?: string
  enabled?: boolean
}
export interface SkillDetail extends SkillSummary {
  body: string
  path: string
  enabled: boolean
  tools?: string[]
}
export const listSkills = (includeDisabled = false): Promise<SkillDetail[]> =>
  api.get<{ skills: SkillDetail[] }>('/skills', { params: includeDisabled ? { all: 'true' } : {} }).then((r) => r.data.skills)
export const getSkill = (id: string): Promise<SkillDetail> =>
  api.get(`/skills/${encodeURIComponent(id)}`).then((r) => r.data)
export const createSkill = (input: SkillInput): Promise<SkillDetail> =>
  api.post('/skills', input).then((r) => r.data)
export const updateSkill = (id: string, input: Partial<SkillInput>): Promise<SkillDetail> =>
  api.put(`/skills/${encodeURIComponent(id)}`, input).then((r) => r.data)
export const toggleSkill = (id: string, enabled: boolean): Promise<{ id: string; enabled: boolean }> =>
  api.patch(`/skills/${encodeURIComponent(id)}/toggle`, { enabled }).then((r) => r.data)
export const deleteSkill = (id: string): Promise<{ ok: boolean }> =>
  api.delete(`/skills/${encodeURIComponent(id)}`).then((r) => r.data)
export const reloadSkills = (): Promise<{ count: number; skills: { id: string; name: string }[] }> =>
  api.post('/skills/reload').then((r) => r.data)

// 技能执行员工具目录
export interface SkillTool {
  name: string
  label: string
  group: string
  summary: string
  returns: string
  needsEnterpriseId?: boolean
}
export const listSkillTools = (): Promise<SkillTool[]> =>
  api.get('/skill-tools').then((r) => r.data.tools)

// 技能市场（内置库）
export interface LibrarySkill {
  id: string
  name: string
  description: string
  keywords: string[]
  installed: boolean
}
export const listLibrary = (): Promise<LibrarySkill[]> =>
  api.get('/skills-library').then((r) => r.data.skills)
export const installFromLibrary = (id: string): Promise<SkillDetail> =>
  api.post(`/skills-library/${encodeURIComponent(id)}/install`).then((r) => r.data)
export const uploadSkill = (file: File): Promise<SkillDetail> => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/skills/upload', form).then((r) => r.data)
}

// AI 起草技能（LLM 较慢，给 3 分钟超时）
export const generateSkill = (description: string, name?: string): Promise<{
  id: string; name: string; description: string; keywords: string[]; tools: string[]; raw: string
}> =>
  api.post('/skills/generate', { description, name }, { timeout: 180000 }).then((r) => r.data)

// ============================================
// MCP 数据源
// ============================================

export interface McpServer {
  id: string
  name: string
  slug: string
  transport: string
  url: string
  enabled: number
  status: 'unknown' | 'connecting' | 'connected' | 'error'
  last_error: string | null
  tool_count: number
  hasAuthHeader: boolean
  created_at: string
  updated_at: string
}

export interface McpTool {
  id: string
  server_id: string
  serverName?: string
  serverSlug?: string
  tool_name: string
  display_name: string
  description: string
  enabled: number
  boundRoles: string[]
  inputSchema: unknown
}

export interface McpCallLog {
  id: string
  server_name: string
  tool_name: string
  args: unknown
  result_preview: string | null
  success: number
  error_text: string | null
  duration_ms: number
  project_id: string | null
  enterprise_id: string | null
  created_at: string
}

export const listMcpServers = (): Promise<McpServer[]> =>
  api.get('/mcp/servers').then((r) => r.data.servers)
export const createMcpServer = (payload: {
  name: string; slug?: string; url: string; headers?: Record<string, string>; enabled?: boolean
}): Promise<{ server: McpServer; toolCount: number; connectError: string | null }> =>
  api.post('/mcp/servers', payload).then((r) => r.data)
export const updateMcpServer = (id: string, payload: {
  name?: string; slug?: string; url?: string; headers?: Record<string, string>; enabled?: boolean
}): Promise<{ server: McpServer; toolCount: number }> =>
  api.put(`/mcp/servers/${id}`, payload).then((r) => r.data)
export const deleteMcpServer = (id: string) => api.delete(`/mcp/servers/${id}`)
export const testMcpConnection = (payload: { url: string; headers?: Record<string, string> }) =>
  api.post('/mcp/test-connection', payload).then((r) => r.data as { connected: boolean; toolCount?: number; error?: string })
export const testMcpServerById = (id: string) =>
  api.post(`/mcp/servers/${id}/test`).then((r) => r.data as { connected: boolean; toolCount?: number; error?: string })
export const refreshMcpServer = (id: string): Promise<{ toolCount: number }> =>
  api.post(`/mcp/servers/${id}/refresh`).then((r) => r.data)
export const listMcpToolsByServer = (id: string): Promise<McpTool[]> =>
  api.get(`/mcp/servers/${id}/tools`).then((r) => r.data.tools)
export const updateMcpTool = (id: string, payload: { enabled?: boolean; boundRoles?: string[]; displayName?: string }): Promise<{ tool: McpTool }> =>
  api.patch(`/mcp/tools/${id}`, payload).then((r) => r.data)
/** 轻量映射：内部工具名 -> { name, server }，供工具卡片显示中文名 */
export const getMcpToolNames = (): Promise<Record<string, { name: string; server: string }>> =>
  api.get('/mcp/tool-names').then((r) => r.data.map)
export const listMcpLogs = (params: { serverId?: string; limit?: number } = {}): Promise<McpCallLog[]> =>
  api.get('/mcp/logs', { params }).then((r) => r.data.logs)

// ============================================
// ContentForge 内容业务 API
// ============================================
import type {
  SubjectInfo, SubjectType, SubjectProfile,
  Series, Article, ArticleDetail, ArticleStatus,
  ChannelKey, ChannelVersion, PublishRecord,
  WritingKit, ContentLine,
} from '@/types'

export const getSubject = (projectId: string): Promise<SubjectInfo> =>
  api.get(`/projects/${projectId}/subject`).then((r) => r.data)

export const saveSubject = (
  projectId: string,
  payload: { subjectType?: SubjectType; profile?: SubjectProfile; kitId?: string | null }
): Promise<{ ok: true }> =>
  api.put(`/projects/${projectId}/subject`, payload).then((r) => r.data)

export const listWritingKits = (): Promise<WritingKit[]> =>
  api.get('/writing-kits').then((r) => r.data)

export const createWritingKit = (payload: Partial<WritingKit> & { name: string }): Promise<WritingKit> =>
  api.post('/writing-kits', toKitPayload(payload)).then((r) => r.data)

export const updateWritingKit = (kid: string, payload: Partial<WritingKit>): Promise<{ ok: true }> =>
  api.put(`/writing-kits/${kid}`, toKitPayload(payload)).then((r) => r.data)

export const deleteWritingKit = (kid: string) =>
  api.delete(`/writing-kits/${kid}`)

export const duplicateWritingKit = (kid: string, name?: string): Promise<WritingKit> =>
  api.post(`/writing-kits/${kid}/duplicate`, { name }).then((r) => r.data)

export const mountWritingKit = (projectId: string, kitId: string | null): Promise<{ ok: true }> =>
  api.post(`/projects/${projectId}/mount-kit`, { kitId }).then((r) => r.data)

function toKitPayload(p: Partial<WritingKit>) {
  return {
    name: p.name,
    description: p.description,
    signoff: p.signoff,
    contentLines: p.contentLines as ContentLine[] | undefined,
    positioningMd: p.positioningMd,
    writingMd: p.writingMd,
    titleMd: p.titleMd,
    spreadMd: p.spreadMd,
  }
}

export const listSeries = (projectId: string): Promise<Series[]> =>
  api.get(`/projects/${projectId}/series`).then((r) => r.data)

export const createSeries = (projectId: string, title: string, description = ''): Promise<Series> =>
  api.post(`/projects/${projectId}/series`, { title, description }).then((r) => r.data)

export const updateSeries = (sid: string, payload: { title?: string; description?: string }): Promise<Series> =>
  api.put(`/series/${sid}`, payload).then((r) => r.data)

export const deleteSeries = (sid: string) =>
  api.delete(`/series/${sid}`)

export const listArticles = (projectId: string): Promise<Article[]> =>
  api.get(`/projects/${projectId}/articles`).then((r) => r.data)

export const createArticle = (
  projectId: string,
  payload: { title: string; angle?: string; seriesId?: string | null; docMd?: string; status?: ArticleStatus; contentLine?: string }
): Promise<Article> =>
  api.post(`/projects/${projectId}/articles`, payload).then((r) => r.data)

export const batchCreateArticles = (
  projectId: string,
  items: Array<{ title: string; angle?: string; seriesId?: string | null; contentLine?: string }>
): Promise<{ created: number; articles: Article[] }> =>
  api.post(`/projects/${projectId}/articles/batch`, { items }).then((r) => r.data)

export const getArticle = (aid: string): Promise<ArticleDetail> =>
  api.get(`/articles/${aid}`).then((r) => r.data)

export const updateArticle = (
  aid: string,
  payload: { title?: string; angle?: string; docMd?: string; status?: ArticleStatus; seriesId?: string | null; contentLine?: string }
): Promise<Article> =>
  api.put(`/articles/${aid}`, payload).then((r) => r.data)

export const deleteArticleApi = (aid: string) =>
  api.delete(`/articles/${aid}`)

export const listChannelVersions = (aid: string): Promise<{ versions: ChannelVersion[] }> =>
  api.get(`/articles/${aid}/channels`).then((r) => r.data)

export const saveChannelVersion = (
  aid: string,
  channel: ChannelKey,
  payload: { title?: string; content?: string; extra?: Record<string, unknown> }
): Promise<ChannelVersion> =>
  api.put(`/articles/${aid}/channels/${channel}`, payload).then((r) => r.data)

export const listPublishes = (projectId: string): Promise<PublishRecord[]> =>
  api.get(`/projects/${projectId}/publishes`).then((r) => r.data)

export const createPublish = (
  projectId: string,
  payload: {
    articleId: string
    channel: ChannelKey
    url?: string
    metrics?: Record<string, number>
    note?: string
  }
): Promise<PublishRecord> =>
  api.post(`/projects/${projectId}/publishes`, payload).then((r) => r.data)

export const updatePublish = (
  pid: string,
  payload: { url?: string; metrics?: Record<string, number>; note?: string }
): Promise<PublishRecord> =>
  api.put(`/publishes/${pid}`, payload).then((r) => r.data)

export const deletePublish = (pid: string) =>
  api.delete(`/publishes/${pid}`)

// ContentForge：无头生成渠道版本（面板按钮；三渠道并发生成，给足 180s）
export const adaptArticle = (
  aid: string,
  payload: { channels?: ChannelKey[]; requirement?: string }
): Promise<{ ok: boolean; channels: ChannelKey[]; error?: string }> =>
  api.post(`/articles/${aid}/adapt`, payload, { timeout: 300000 }).then((r) => r.data)
