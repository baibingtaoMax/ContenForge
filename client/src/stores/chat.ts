import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type {
  ChatMessage, SSEEvent, AgentRole, Project, ProjectDetail, Conversation, StoredMessage, SkillSummary
} from '@/types'
import * as api from '@/api'

let idCounter = 0
const nextId = () => `msg-${++idCounter}-${Date.now()}`

const LS_KEY = 'riskagent:lastConversation'
function saveLast(c: { conversationId?: string; projectId?: string }) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}
function loadLast(): { conversationId?: string; projectId?: string } {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch { return {} }
}

/** 一个正在运行（SSE 连接中）的对话的隔离运行态 */
interface ConversationRun {
  conversationId: string
  messages: ChatMessage[]
  isStreaming: boolean
  statusText: string
  abortController: AbortController
  assessmentId?: string
}

export const useChatStore = defineStore('chat', () => {
  // 项目与对话
  const projects = ref<Project[]>([])
  const unassignedConversations = ref<Conversation[]>([])
  const currentProjectId = ref<string | undefined>(undefined)
  // 左侧项目树的展开态独立于「当前项目」：再点项目头可收起，收起不切走主区内容
  const expandedProjectId = ref<string | undefined>(undefined)
  const currentConversationId = ref<string | undefined>(undefined)
  const projectDetail = ref<ProjectDetail | null>(null)
  // ProtoForge：项目内当前选中的条目（对话 / 需求清单 / 原型）。
  // 需求清单、原型是项目树下的固定条目（侧边栏里与对话平级），不属于某个对话。
  // ContentForge：plan=内容计划，subject=主体档案，publishes=发布台账（requirements/prototype 等 PF 面板留盘不接线）
  const mainTab = ref<'chat' | 'plan' | 'subject' | 'publishes' | 'requirements' | 'prototype' | 'pool' | 'map' | 'attachments'>('chat')
  // 进入内容计划时 bump，强制 ContentPlanPanel 重挂载拉最新（含刚沉淀的选题）
  const planPanelNonce = ref(0)
  // 进入发布台账时 bump
  const publishPanelNonce = ref(0)
  // 进入主体档案时 bump
  const subjectPanelNonce = ref(0)
  const reqPanelNonce = ref(0)
  // 进入需求全景时 bump，强制 MapPanel 重挂载重算 dagre 布局
  const mapPanelNonce = ref(0)
  // 设计决策刚在对话中记录后 bump，刷新打开中的决策脉络
  const decisionPanelNonce = ref(0)
  // 需求池条目刚入池后 bump，刷新需求池列表
  const poolPanelNonce = ref(0)
  // 进入附件中心时 bump，强制重挂载拉最新列表
  const attachmentPanelNonce = ref(0)
  // 文档里贴/删内嵌图后 bump，刷新侧栏项目附件面板（内嵌图角标）
  const attachmentNonce = ref(0)
  function bumpAttachments() { attachmentNonce.value++ }
  // 当前项目需求池未搁置条目数（侧栏角标）
  const poolCount = ref(0)
  async function refreshPoolCount() {
    if (!currentProjectId.value) { poolCount.value = 0; return }
    try {
      const all = await api.listRequirements(currentProjectId.value, true)
      poolCount.value = all.filter((r) => r.kind === 'idea' && r.pool_status !== 'shelved').length
    } catch { /* ignore */ }
  }
  // ProtoForge：从沉淀卡片跳转到某条需求（清单面板监听 nonce 打开，整页跳转）
  const openReqId = ref<string | null>(null)
  const openReqNonce = ref(0)
  // ProtoForge：对话内点沉淀卡片/@ pill → 只读抽屉预览，不离开对话、不丢滚动位置
  const reqPreviewId = ref<string | null>(null)
  const reqPreviewNonce = ref(0)
  // 切到某个对话时自动回到对话视图；清空对话（切去固定条目）时不重置
  watch(currentConversationId, (cid) => { if (cid) mainTab.value = 'chat' })

  /** 选中项目下的固定条目（需求清单 / 原型）：退出当前对话视图 */
  function selectProjectFixed(kind: 'plan' | 'subject' | 'publishes' | 'requirements' | 'prototype' | 'pool' | 'map' | 'attachments') {
    if (!currentProjectId.value) return
    currentConversationId.value = undefined
    loadedMessages.value = []
    draftProjectId.value = undefined
    mainTab.value = kind
    if (kind === 'plan') planPanelNonce.value++
    if (kind === 'subject') subjectPanelNonce.value++
    if (kind === 'publishes') publishPanelNonce.value++
    if (kind === 'requirements') reqPanelNonce.value++
    if (kind === 'pool') poolPanelNonce.value++
    if (kind === 'map') mapPanelNonce.value++
    if (kind === 'attachments') attachmentPanelNonce.value++
  }

  /** 对话内只读预览：右侧抽屉滑出，对话视图原封不动 */
  function previewRequirement(rid: string) {
    reqPreviewId.value = rid
    reqPreviewNonce.value++
  }

  function closeReqPreview() {
    reqPreviewId.value = null
  }

  /** 整页跳转到需求清单详情（退出对话视图）；抽屉里「去需求清单处理」用它 */
  function requestOpenRequirement(rid: string) {
    reqPreviewId.value = null
    openReqId.value = rid
    openReqNonce.value++
    // 从对话气泡跳过来：退出对话视图，进入需求清单
    if (currentProjectId.value) {
      currentConversationId.value = undefined
      loadedMessages.value = []
      draftProjectId.value = undefined
    }
    mainTab.value = 'requirements'
    reqPanelNonce.value++
  }

  // ContentForge：从文章沉淀卡片跳到内容计划并打开某篇文章
  const openArticleId = ref<string | null>(null)
  const openArticleNonce = ref(0)
  function requestOpenArticle(aid: string) {
    openArticleId.value = aid
    openArticleNonce.value++
    if (currentProjectId.value) {
      currentConversationId.value = undefined
      loadedMessages.value = []
      draftProjectId.value = undefined
    }
    mainTab.value = 'plan'
    planPanelNonce.value++
  }

  // 新对话草稿态（点了新对话但还没发消息）
  const draftProjectId = ref<string | null | undefined>(undefined)
  const hasDraft = computed(() => !currentConversationId.value && draftProjectId.value !== undefined)

  // 非运行中的当前对话，其历史消息从数据库加载到这里
  const loadedMessages = ref<ChatMessage[]>([])

  // 运行态按 conversationId 隔离，多个对话可同时跑
  const runs = ref<Map<string, ConversationRun>>(new Map())

  const inputText = ref('')
  const skills = ref<SkillSummary[]>([])
  // 用户通过 ⚡ 选定的技能：接待员追问期间保持，收到 skill_start（技能真正开跑）才清除
  const pendingSkillId = ref<string | null>(null)

  let abortController: AbortController | null = null

  const currentProject = computed(() =>
    projects.value.find((p) => p.id === currentProjectId.value)
  )

  /** 当前对话是否游离（未归档） */
  const isUnassigned = computed(
    () => !!currentConversationId.value && !currentProjectId.value
  )

  /** 正在运行的对话 id 列表（侧边栏转圈用） */
  const runningIds = computed(() => Array.from(runs.value.keys()))

  /** 当前对话是否在跑 */
  const isStreaming = computed(() => {
    const cid = currentConversationId.value
    return !!cid && runs.value.has(cid)
  })

  /** 当前对话的状态文案 */
  const statusText = computed(() => {
    const cid = currentConversationId.value
    return cid ? runs.value.get(cid)?.statusText || '' : ''
  })

  /** 当前对话要显示的消息：运行中取 run 缓冲，否则取历史 */
  const messages = computed<ChatMessage[]>(() => {
    const cid = currentConversationId.value
    if (cid && runs.value.has(cid)) return runs.value.get(cid)!.messages
    return loadedMessages.value
  })

  // ---------- 加载 ----------
  async function loadProjects() {
    projects.value = await api.getProjects()
  }

  /** 初始化：加载列表并恢复上次的对话 */
  async function init() {
    await loadAll()
    const last = loadLast()
    if (!last.conversationId) return
    try {
      if (last.projectId && projects.value.some((p) => p.id === last.projectId)) {
        await selectProject(last.projectId)
        await selectConversation(last.conversationId)
      } else {
        currentConversationId.value = last.conversationId
        await loadMessages(last.conversationId)
      }
    } catch {
      currentConversationId.value = undefined
      loadedMessages.value = []
    }
    // 接回刷新前正在运行的评估（断线重连 + 事件回放）
    try {
      const { conversationIds } = await api.getRunningConversations()
      for (const id of conversationIds) {
        void resumeRun(id)
      }
    } catch { /* ignore */ }
  }

  async function loadUnassigned() {
    unassignedConversations.value = await api.getUnassignedConversations()
  }

  async function loadSkills() {
    try { skills.value = await api.listSkills() } catch { /* ignore */ }
  }

  async function loadAll() {
    await Promise.all([loadProjects(), loadUnassigned(), loadSkills()])
  }

  // ---------- 项目 ----------
  async function selectProject(id: string) {
    expandedProjectId.value = id
    currentProjectId.value = id
    draftProjectId.value = undefined
    projectDetail.value = await api.getProjectDetail(id)
    currentConversationId.value = undefined
    loadedMessages.value = []
    // 点主体文件夹：默认落在「内容计划」固定条目
    mainTab.value = 'plan'
    planPanelNonce.value++
  }

  /** 点项目头：已展开→仅收起（不切主区）；未展开→展开，且若不是当前项目则选中它 */
  function toggleProject(id: string) {
    if (expandedProjectId.value === id) {
      expandedProjectId.value = undefined
      return
    }
    expandedProjectId.value = id
    if (currentProjectId.value !== id) void selectProject(id)
  }

  async function newProject(name: string, description = '') {
    const created = await api.createProject(name, description)
    await loadProjects()
    await selectProject(created.id)
    return created.id
  }

  async function renameProject(id: string, name: string, description = '') {
    await api.renameProject(id, name, description)
    await loadProjects()
  }

  async function removeProject(id: string) {
    // 中断该项目下所有正在跑的对话
    for (const [cid, run] of runs.value) {
      if (projectDetail.value?.conversations.some((c) => c.id === cid)) {
        run.abortController.abort()
      }
    }
    await api.deleteProject(id)
    if (currentProjectId.value === id) {
      currentProjectId.value = undefined
      expandedProjectId.value = undefined
      currentConversationId.value = undefined
      loadedMessages.value = []
      projectDetail.value = null
      mainTab.value = 'chat'
    }
    await loadAll()
  }

  // ---------- 对话 ----------
  function newConversation() {
    currentConversationId.value = undefined
    currentProjectId.value = undefined
    expandedProjectId.value = undefined
    projectDetail.value = null
    loadedMessages.value = []
    draftProjectId.value = null
    mainTab.value = 'chat'
  }

  function newConversationInProject(projectId: string) {
    currentConversationId.value = undefined
    currentProjectId.value = projectId
    expandedProjectId.value = projectId
    loadedMessages.value = []
    draftProjectId.value = projectId
    mainTab.value = 'chat'
    loadProjectDetail()
  }

  async function ensureConversation(): Promise<string> {
    if (currentConversationId.value) return currentConversationId.value
    const inProject = draftProjectId.value
    const conv = inProject
      ? await api.createConversation(inProject)
      : await api.createConversationStandalone()
    currentConversationId.value = conv.id
    draftProjectId.value = undefined
    if (inProject) {
      currentProjectId.value = inProject
      expandedProjectId.value = inProject
      loadProjectDetail() // 刷新项目对话列表，让新对话立即出现在侧边栏
    }
    await loadUnassigned()
    return conv.id
  }

  async function selectUnassignedConversation(id: string) {
    draftProjectId.value = undefined
    currentProjectId.value = undefined
    expandedProjectId.value = undefined
    projectDetail.value = null
    currentConversationId.value = id
    if (runs.value.has(id)) return // 运行中，消息由 run 提供
    // 检查后端是否有正在跑的（比如别的标签页起的或刷新后未接回）
    if (await isRunningOnServer(id)) { await resumeRun(id); return }
    await loadMessages(id)
  }

  async function selectConversation(id: string) {
    draftProjectId.value = undefined
    currentConversationId.value = id
    if (runs.value.has(id)) return // 运行中，消息由 run 提供
    if (await isRunningOnServer(id)) { await resumeRun(id); return }
    await loadMessages(id)
  }

  async function deleteConversation(id: string) {
    runs.value.get(id)?.abortController.abort()
    runs.value.delete(id)
    await api.deleteConversation(id)
    if (currentConversationId.value === id) {
      currentConversationId.value = undefined
      loadedMessages.value = []
    }
    await loadAll()
    if (currentProjectId.value) {
      projectDetail.value = await api.getProjectDetail(currentProjectId.value)
    }
  }

  async function renameConversation(id: string, title: string) {
    await api.renameConversation(id, title)
    await loadAll()
    if (currentProjectId.value) {
      projectDetail.value = await api.getProjectDetail(currentProjectId.value)
    }
  }

  function parseStored(m: StoredMessage): ChatMessage {
    let attachments: ChatMessage['attachments']
    if (m.attachments) {
      try { attachments = JSON.parse(m.attachments) } catch { attachments = undefined }
    }
    let toolCalls: ChatMessage['toolCalls'] = []
    if (m.tool_calls) {
      try { toolCalls = JSON.parse(m.tool_calls) } catch { toolCalls = [] }
    }
    let reviewFeedback: ChatMessage['reviewFeedback']
    if (m.review_feedback) {
      try { reviewFeedback = JSON.parse(m.review_feedback) } catch { reviewFeedback = undefined }
    }
    let decision: ChatMessage['decision']
    if (m.decision) {
      try { decision = JSON.parse(m.decision) } catch { decision = undefined }
    }
    let skillMeta: ChatMessage['skillMeta']
    if ((m as any).skill_meta) {
      try { skillMeta = JSON.parse((m as any).skill_meta) } catch { skillMeta = undefined }
    }
    let refArticles: ChatMessage['refArticles']
    if ((m as any).ref_articles) {
      try { refArticles = JSON.parse((m as any).ref_articles) } catch { refArticles = undefined }
    }
    return {
      id: `hist-${m.id}`,
      role: m.role === 'user' ? 'user' : 'agent',
      agentRole: m.role === 'agent'
        ? (m.agent_role as AgentRole)
        : (m.role === 'assistant' ? 'receptionist' : undefined),
      agentName: m.role === 'agent'
        ? (m.agent_name || m.agent_role || '')
        : (m.role === 'assistant' ? '内容搭档' : undefined),
      content: m.content,
      reasoningContent: m.reasoning_content || undefined,
      toolCalls,
      reviewFeedback,
      decision,
      skillMeta,
      attachments,
      assessmentId: m.assessment_id || undefined,
      articleIds: (() => { try { return JSON.parse((m as any).article_ids || '[]') } catch { return [] } })(),
      requirementIds: (() => { try { return JSON.parse((m as any).req_ids || '[]') } catch { return [] } })(),
      poolIds: (() => { try { return JSON.parse((m as any).pool_ids || '[]') } catch { return [] } })(),
      decisionIds: (() => { try { return JSON.parse((m as any).decision_ids || '[]') } catch { return [] } })(),
      refArticles,
      timestamp: new Date(m.created_at).getTime()
    }
  }

  async function loadMessages(id: string) {
    const stored: StoredMessage[] = await api.getMessages(id)
    loadedMessages.value = stored.map(parseStored)
  }

  async function loadProjectDetail() {
    if (currentProjectId.value) {
      projectDetail.value = await api.getProjectDetail(currentProjectId.value)
      refreshPoolCount()
    }
  }

  // 记住当前对话，刷新后恢复
  watch(
    [currentConversationId, currentProjectId],
    ([cid, pid]) => {
      if (cid) saveLast({ conversationId: cid, projectId: pid })
      else saveLast({})
    }
  )

  async function archiveConversation(projectId: string) {
    if (!currentConversationId.value) return
    await api.assignConversation(currentConversationId.value, projectId)
    currentProjectId.value = projectId
    expandedProjectId.value = projectId
    projectDetail.value = await api.getProjectDetail(projectId)
    mainTab.value = 'chat'
    await loadAll()
  }

  // ---------- SSE 处理（按 conversationId 路由到对应 run） ----------
  function findOrCreateAgentMessage(run: ConversationRun, agentRole: string, agentName: string): ChatMessage {
    for (let i = run.messages.length - 1; i >= 0; i--) {
      const m = run.messages[i]
      if (m.role === 'agent' && m.agentRole === agentRole && (m as any)._active) return m
    }
    const msg: ChatMessage = {
      id: nextId(),
      role: 'agent',
      agentRole: agentRole as AgentRole,
      agentName,
      content: '',
      toolCalls: [],
      timestamp: Date.now()
    }
    ;(msg as any)._active = true
    run.messages.push(msg)
    return msg
  }

  function deactivateAgent(run: ConversationRun, role: string) {
    for (const m of run.messages) {
      if (m.agentRole === role && (m as any)._active) (m as any)._active = false
    }
  }

  function agentName(role: string) {
    const map: Record<string, string> = {
      receptionist: '内容搭档', investigator: '调查主管',
      reviewer: '审查官', decision_maker: '决策官',
      worker_business: '工商调查员', worker_credit: '征信调查员',
      worker_financial: '财务调查员', worker_litigation: '司法调查员',
      worker_tax: '税务调查员', skill_executor: '技能执行员'
    }
    return map[role] || role
  }

  function handleSSE(cid: string, event: SSEEvent): string {
    const run = runs.value.get(cid)
    if (!run) return cid

    switch (event.type) {
      case 'assessment_start': {
        const aid = event.data.assessmentId
        run.assessmentId = aid
        ;(run as any)._assessmentMeta = {
          assessmentId: aid,
          enterpriseName: event.data.enterpriseName,
          enterpriseId: event.data.enterpriseId
        }
        // 续传刷新时存在竞态：评估刚结束的瞬间 DB 已批量落库该批评测消息，
        // 但 hub 尚未标记 finished，resumeRun 会先从 DB 取出全套 hist-* 消息，
        // 再由 hub 回放整套事件重建 msg-* 气泡，导致同一批评测出现两套、评估卡被拆散。
        // assessmentId 每轮全新，这里只剔掉「当前这轮」已存在的消息，回放会重新构建；
        // 不影响同对话里更早的历史评估（它们是别的 assessmentId）。
        const before = run.messages.length
        run.messages = run.messages.filter((m) => m.assessmentId !== aid)
        if (before !== run.messages.length) {
          console.warn(`[resume] assessment_start 去重：移除 ${before - run.messages.length} 条已落库的评测消息（aid=${aid.slice(0, 8)}）`)
        }
        break
      }
      case 'assessment_end':
        run.assessmentId = undefined
        break
      case 'agent_start': {
        deactivateAgent(run, event.data.agentRole)
        const m = findOrCreateAgentMessage(run, event.data.agentRole, event.data.agentName)
        if (run.assessmentId) m.assessmentId = run.assessmentId
        run.statusText = ''
        break
      }
      case 'agent_message': {
        const msg = findOrCreateAgentMessage(run, event.data.agentRole, agentName(event.data.agentRole))
        // 调查主管第二轮写报告等场景会新建气泡，必须带上 assessmentId，
        // 否则该消息漏出评估卡，导致运行时评估被拆成多张卡、样式错乱
        if (run.assessmentId && !msg.assessmentId) msg.assessmentId = run.assessmentId
        msg.content = event.data.content
        break
      }
      case 'reasoning': {
        const msg = findOrCreateAgentMessage(run, event.data.agentRole, agentName(event.data.agentRole))
        if (run.assessmentId && !msg.assessmentId) msg.assessmentId = run.assessmentId
        msg.reasoningContent = event.data.content
        break
      }
      case 'tool_call': {
        const role = event.data.agentRole || 'investigator'
        const msg = findOrCreateAgentMessage(run, role, agentName(role))
        if (run.assessmentId && !msg.assessmentId) msg.assessmentId = run.assessmentId
        msg.toolCalls.push({ toolName: event.data.toolName, args: event.data.args, loading: true })
        break
      }
      case 'tool_result': {
        const role = event.data.agentRole || 'investigator'
        const msg = findOrCreateAgentMessage(run, role, agentName(role))
        if (run.assessmentId && !msg.assessmentId) msg.assessmentId = run.assessmentId
        for (let i = msg.toolCalls.length - 1; i >= 0; i--) {
          if (msg.toolCalls[i].toolName === event.data.toolName && msg.toolCalls[i].loading) {
            msg.toolCalls[i].result = event.data.result
            msg.toolCalls[i].loading = false
            break
          }
        }
        break
      }
      case 'review_feedback': {
        for (let i = run.messages.length - 1; i >= 0; i--) {
          if (run.messages[i].agentRole === 'reviewer') {
            run.messages[i].reviewFeedback = event.data
            break
          }
        }
        break
      }
      case 'decision': {
        const msg = findOrCreateAgentMessage(run, 'decision_maker', '决策官')
        if (run.assessmentId && !msg.assessmentId) msg.assessmentId = run.assessmentId
        msg.decision = event.data
        break
      }
      case 'status':
        run.statusText = event.data.text
        break
      case 'skill_start': {
        deactivateAgent(run, 'skill_executor')
        // 技能真正开跑，清除待执行技能标记
        pendingSkillId.value = null
        // 续传刷新竞态：技能执行完即时落库（chat.ts appendAgentMessages），落库后到 finishHub 之间刷新，
        // DB 里的 hist-* 技能气泡会和 hub 回放重建的 msg-* 气泡重复。同 assessment_start 的处理，
        // 按 skillId 剔掉本次技能已落库的消息，回放会重新构建。
        // 注：同对话里更早的同技能历史气泡会在回放期间暂时消失，done 后 loadMessages 全量恢复，无数据丢失。
        // skillId 是技能定义 ID（同对话反复跑同一技能会重复），不能像 assessmentId 那样全删，
        // 只剔掉「最后一条」匹配的技能气泡——刚落库、正被 hub 回放重复的就是它；更早的同技能历史保留。
        let removed = 0
        for (let i = run.messages.length - 1; i >= 0; i--) {
          const m = run.messages[i]
          if (m.agentRole === 'skill_executor' && m.skillMeta?.skillId === event.data.skillId) {
            run.messages.splice(i, 1)
            removed = 1
            break
          }
        }
        if (removed) {
          console.warn(`[resume] skill_start 去重：移除 ${removed} 条已落库的技能气泡（skill=${event.data.skillId}）`)
        }
        const m = findOrCreateAgentMessage(run, 'skill_executor', '技能执行员')
        m.skillMeta = { skillId: event.data.skillId, skillName: event.data.skillName, task: event.data.task }
        m.content = ''
        run.statusText = `执行技能：${event.data.skillName}`
        break
      }
      case 'skill_message': {
        const msg = findOrCreateAgentMessage(run, 'skill_executor', '技能执行员')
        msg.content = event.data.content
        if (event.data.done) {
          ;(msg as any)._active = false
        }
        break
      }
      case 'skill_reasoning': {
        const msg = findOrCreateAgentMessage(run, 'skill_executor', '技能执行员')
        msg.reasoningContent = event.data.content
        break
      }
      case 'skill_status':
        run.statusText = event.data.status
        break
      case 'skill_tool_call': {
        const msg = findOrCreateAgentMessage(run, 'skill_executor', '技能执行员')
        msg.toolCalls.push({
          toolName: event.data.toolName,
          args: event.data.args,
          result: event.data.result,
          loading: false
        })
        break
      }
      case 'skill_done': {
        deactivateAgent(run, 'skill_executor')
        run.statusText = ''
        break
      }
      // ProtoForge：沉淀出新需求 → 挂到当前活跃的需求搭档气泡上
      case 'requirement': {
        const msg = findOrCreateAgentMessage(run, 'receptionist', agentName('receptionist'))
        const card = { id: event.data.id, title: event.data.title, status: event.data.status || 'proposed' }
        msg.requirements = [...(msg.requirements || []), card]
        // 需求被修订（revise_requirement）：刷新需求面板，让文档/状态更新
        if (event.data.revised) reqPanelNonce.value++
        break
      }
      // ContentForge：沉淀/更新文章（或自动建系列）→ 挂到内容搭档气泡上
      case 'article': {
        if (event.data.kind === 'series') {
          planPanelNonce.value++
          break
        }
        const msg = findOrCreateAgentMessage(run, 'receptionist', agentName('receptionist'))
        const exists = (msg.articles || []).some((a) => a.id === event.data.id)
        const card = {
          id: event.data.id,
          title: event.data.title,
          status: event.data.status || 'topic',
          kind: 'article' as const,
          revised: !!event.data.revised,
          published: !!event.data.published,
        }
        msg.articles = exists
          ? (msg.articles || []).map((a) => (a.id === card.id ? { ...a, ...card } : a))
          : [...(msg.articles || []), card]
        planPanelNonce.value++
        break
      }
      case 'channel_versions': {
        planPanelNonce.value++
        break
      }
      case 'pool_item': {
        const msg = findOrCreateAgentMessage(run, 'receptionist', agentName('receptionist'))
        const card = { id: event.data.id, title: event.data.title, status: event.data.poolStatus || 'raw' }
        msg.poolItems = [...(msg.poolItems || []), card]
        poolPanelNonce.value++
        refreshPoolCount()
        break
      }
      case 'design_decision': {
        const msg = findOrCreateAgentMessage(run, 'receptionist', agentName('receptionist'))
        const card = { id: event.data.id, topic: event.data.topic }
        msg.decisions = [...(msg.decisions || []), card]
        decisionPanelNonce.value++
        break
      }
      case 'aborted':
        run.isStreaming = false
        run.statusText = '已中断'
        pendingSkillId.value = null
        for (const m of run.messages) (m as any)._active = false
        break
      case 'done': {
        const d = event.data
        let effectiveCid = cid
        if (d?.conversationId && d.conversationId !== cid) {
          // 新对话首次发消息，服务端返回真实 id，迁移 run
          runs.value.set(d.conversationId, { ...run, conversationId: d.conversationId })
          runs.value.delete(cid)
          if (currentConversationId.value === cid) currentConversationId.value = d.conversationId
          effectiveCid = d.conversationId
        }
        if (d?.projectId) {
          currentProjectId.value = d.projectId
          expandedProjectId.value = d.projectId
        }
        if (d?.stage === 'complete') {
          finishRun(effectiveCid)
        }
        return effectiveCid
      }
      case 'error':
        run.isStreaming = false
        run.statusText = ''
        pendingSkillId.value = null
        for (const m of run.messages) (m as any)._active = false
        run.messages.push({
          id: nextId(), role: 'agent', agentRole: 'receptionist',
          agentName: '系统提示', content: `❌ ${event.data.message}`,
          toolCalls: [], timestamp: Date.now()
        })
        break
    }

    return cid
  }

  /** run 结束：从运行态移除，重载历史（落库后的最终消息） */
  async function finishRun(cid: string) {
    const wasCurrent = currentConversationId.value === cid
    runs.value.delete(cid)
    if (wasCurrent) {
      try { await loadMessages(cid) } catch { /* ignore */ }
    }
    loadAll()
    if (currentProjectId.value) loadProjectDetail()
  }

  // ---------- 发送 / 中断 ----------
  async function send(text: string, attachmentMetas?: any[], refArts?: Array<{ id: string; title: string; status?: string; seriesTitle?: string }>) {
    const content = text.trim()
    if (!content && (!attachmentMetas || attachmentMetas.length === 0)) return
    // 快照待执行技能：新建对话时 currentConversationId 变化会触发 UI 的 watch 清空选中，
    // 这里先保住它，创建完恢复，请求里用快照值，避免新对话首条消息丢失技能意图
    const skillIdSnapshot = pendingSkillId.value
    // 目标对话：当前对话，或新建
    let cid = currentConversationId.value
    if (!cid) {
      cid = await ensureConversation()
    }
    if (skillIdSnapshot) pendingSkillId.value = skillIdSnapshot
    if (!cid || runs.value.has(cid)) return // 该对话已在跑

    // 用户气泡：文字 + 附件合成一条
    const userMsg: ChatMessage = {
      id: nextId(), role: 'user', content, toolCalls: [], timestamp: Date.now()
    }
    if (attachmentMetas?.length) {
      userMsg.attachments = attachmentMetas.map((a) => ({
        id: a.id, filename: a.filename,
        category: a.category, categoryLabel: a.categoryLabel,
        sizeBytes: a.sizeBytes, sourceUrl: a.sourceUrl || null
      }))
    }
    // 本条消息选中的选题（内容计划文章）
    if (refArts?.length) {
      userMsg.refArticles = refArts.map((a) => ({
        id: a.id, title: a.title, status: a.status, seriesTitle: a.seriesTitle
      }))
    }

    // 取该对话现有历史作为 run 缓冲起点（运行中能看到历史+新流）
    let base: ChatMessage[] = []
    if (loadedMessages.value.length && currentConversationId.value === cid) {
      base = [...loadedMessages.value]
    } else {
      try {
        const stored = await api.getMessages(cid)
        base = stored.map(parseStored)
      } catch { /* ignore */ }
    }

    abortController = new AbortController()
    const run: ConversationRun = {
      conversationId: cid,
      messages: [...base, userMsg],
      isStreaming: true,
      statusText: '思考中…',
      abortController
    }
    runs.value.set(cid, run)
    inputText.value = ''

    try {
      const reader = await api.sendMessage(
        content, abortController.signal,
        currentProjectId.value, cid,
        attachmentMetas,
        skillIdSnapshot || undefined,
        refArts
      )
      await pumpSSE(reader, cid)
    } catch (e: any) {
      const r = runs.value.get(cid)
      if (e.name !== 'AbortError' && r) {
        r.isStreaming = false
        r.statusText = ''
        r.messages.push({
          id: nextId(), role: 'agent', agentRole: 'receptionist',
          agentName: '系统提示', content: `❌ 连接失败：${e.message}`,
          toolCalls: [], timestamp: Date.now()
        })
      }
    } finally {
      abortController = null
    }
  }

  /** 读取 SSE 流并按 conversationId 分发事件，支持新对话 id 迁移；
   *  连接意外中断时自动检测后端是否仍在运行，是则自动续传。 */
  async function pumpSSE(reader: ReadableStreamDefaultReader<Uint8Array>, initialCid: string) {
    const decoder = new TextDecoder()
    let buffer = ''
    let activeCid = initialCid
    let streamEnded = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data: ')) continue
          try { activeCid = handleSSE(activeCid, JSON.parse(t.slice(6))) } catch (e) { console.error(e) }
        }
      }
      streamEnded = true
    } catch (e: any) {
      // 主动中止（用户点停止）：向上抛，不重连
      if (e?.name === 'AbortError') throw e
      // 其他错误（网络中断等）：fall through 到自动重连检查
    }
    // 流结束或中断：检查后端是否仍在跑该评估，是则自动续传
    const stillRunning = streamEnded ? await isRunningOnServer(activeCid) : true
    const r = runs.value.get(activeCid)
    if (stillRunning && r && r.isStreaming) {
      r.statusText = '重新连接中…'
      await new Promise(res => setTimeout(res, 800))
      try {
        const controller = new AbortController()
        r.abortController = controller
        const resumeReader = await api.resumeChat(activeCid, controller.signal)
        await pumpSSE(resumeReader, activeCid)
      } catch {
        // 重连失败，保持 isStreaming 让用户可以手动刷新
      }
    }
  }

  /** 查询后端该对话是否有正在跑的评估 */
  async function isRunningOnServer(cid: string): Promise<boolean> {
    try {
      const { conversationIds } = await api.getRunningConversations()
      return conversationIds.includes(cid)
    } catch { return false }
  }

  /** 刷新/切回后接回正在运行的评估：建 run，回放历史 + 续传实时流 */
  async function resumeRun(cid: string) {
    if (runs.value.has(cid)) return
    let base: ChatMessage[] = []
    try {
      base = (await api.getMessages(cid)).map(parseStored)
    } catch { base = [] }
    const controller = new AbortController()
    runs.value.set(cid, {
      conversationId: cid,
      messages: base,
      isStreaming: true,
      statusText: '评估进行中…',
      abortController: controller
    })
    try {
      const reader = await api.resumeChat(cid, controller.signal)
      await pumpSSE(reader, cid)
    } catch (e: any) {
      const r = runs.value.get(cid)
      if (e.name !== 'AbortError' && r) {
        r.isStreaming = false
        r.statusText = ''
      }
    }
  }

  /** 上传文件到服务器，返回附件元信息（不写用户消息到 DB）。
   *  供发送时先上传附件、再连同文本一起写一条用户消息使用。 */
  async function uploadFileOnly(file: File): Promise<{
    id: string; filename: string; categoryLabel: string; sizeBytes: number
  } | null> {
    if (file.size > 50 * 1024 * 1024) {
      ElMessage.error('文件不能超过 50MB')
      return null
    }
    if (!currentConversationId.value) await ensureConversation()
    const cid = currentConversationId.value
    if (!cid) return null
    const meta = await api.uploadConversationAttachment(cid, file)
    return {
      id: meta.id, filename: meta.filename,
      categoryLabel: meta.categoryLabel, sizeBytes: meta.sizeBytes
    }
  }

  /** 贴链接：抓取网页正文落库为网页附件，返回附件元信息（供发送时带上） */
  async function createWebAttachmentOnly(url: string): Promise<{
    id: string; filename: string; category: string; categoryLabel: string;
    sizeBytes: number; sourceUrl: string | null
  } | null> {
    if (!currentConversationId.value) await ensureConversation()
    const cid = currentConversationId.value
    if (!cid) return null
    try {
      const meta = await api.createWebAttachment(cid, url)
      return {
        id: meta.id, filename: meta.filename,
        category: meta.category, categoryLabel: meta.categoryLabel,
        sizeBytes: meta.sizeBytes, sourceUrl: meta.sourceUrl || url
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || '网页抓取失败'
      ElMessage.warning(`链接抓取失败：${msg}（链接仍会随消息发出）`)
      return null
    }
  }

  async function uploadChatFile(file: File) {
    if (file.size > 50 * 1024 * 1024) {
      ElMessage.error('文件不能超过 50MB')
      return
    }

    if (!currentConversationId.value) await ensureConversation()
    const cid = currentConversationId.value
    if (!cid) return

    // 文件气泡加到当前对话：运行中加进 run 缓冲，否则加进历史并落库
    const placeholder: ChatMessage = {
      id: nextId(), role: 'user', content: '',
      toolCalls: [], timestamp: Date.now(),
      attachments: [{ id: 'pending', filename: file.name, categoryLabel: '上传中…', sizeBytes: file.size }]
    }
    const run = runs.value.get(cid)
    if (run) run.messages.push(placeholder)
    else loadedMessages.value.push(placeholder)

    try {
      const meta = await api.uploadConversationAttachment(cid, file)
      const attInfo = {
        id: meta.id, filename: meta.filename,
        categoryLabel: meta.categoryLabel, sizeBytes: meta.sizeBytes
      }
      placeholder.attachments = [attInfo]
      await api.appendUserMessage(cid, { attachments: [attInfo] })
      await loadAll()
      if (currentProjectId.value) loadProjectDetail()
    } catch (e: any) {
      placeholder.content = '❌ 上传失败：' + (e.message || '')
    }
  }

  function setPendingSkill(id: string | null) {
    pendingSkillId.value = id
  }

  async function stop() {
    const cid = currentConversationId.value
    const run = cid ? runs.value.get(cid) : null
    if (run) {
      run.abortController.abort()
      try { await api.abortChat(cid) } catch { /* ignore */ }
      run.statusText = '正在中断…'
    }
  }

  return {
    projects, unassignedConversations, currentProjectId, expandedProjectId, currentConversationId,
    projectDetail, messages, isStreaming, inputText, statusText, runningIds, skills, pendingSkillId, mainTab,
    openReqId, openReqNonce, reqPanelNonce, mapPanelNonce, decisionPanelNonce, poolPanelNonce, attachmentNonce, bumpAttachments, poolCount, refreshPoolCount, requestOpenRequirement, previewRequirement, closeReqPreview,
    planPanelNonce, publishPanelNonce, subjectPanelNonce,
    openArticleId, openArticleNonce, requestOpenArticle,
    reqPreviewId, reqPreviewNonce, selectProjectFixed, attachmentPanelNonce,
    currentProject, isUnassigned, hasDraft,
    loadProjects, loadUnassigned, loadAll, init,
    selectProject, toggleProject, newProject, renameProject, removeProject,
    newConversation, newConversationInProject,
    selectUnassignedConversation, selectConversation, deleteConversation, renameConversation,
    archiveConversation, uploadChatFile, uploadFileOnly, createWebAttachmentOnly,
    send, stop, setPendingSkill
  }
})
