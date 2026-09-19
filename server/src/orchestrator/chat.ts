// ============================================
// 聊天编排：前台接待员 + 路由到风控专家
// 归属：项目（文件夹）→ 对话
// ============================================

import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { getConfig, getModelForRole } from '../config/index.js';
// ContentForge：接待员换成内容运营搭档（风控/需求顾问留盘不接线）
import { contentAdvisor as receptionist } from '../agents/contentAdvisor.js';
import { runAssessment } from './engine.js';
import { runSkill } from './skillRunner.js';
import { listSkillSummaries } from '../skills/loader.js';
import { getEnterpriseList, executeTool, getRoleMcpTools } from '../tools/index.js';
import {
  upsertExternalEnterprise,
  createRequirement,
  ensureParentModule,
  listRequirements,
  getRequirement,
  updateRequirement,
  setLatestAssistantReqIds,
  setLatestAssistantDecisionIds,
  setLatestAssistantPoolIds,
  snapshotRequirement,
} from '../store/database.js';
import {
  getSubjectType,
  getSubjectProfile,
  updateSubject,
  ensureSeries,
  createSeries,
  listSeries,
  createArticle,
  batchCreateArticles,
  listArticles,
  getArticle,
  updateArticle,
  createPublish,
  listChannelVersions,
  listPublishesByArticle,
  setLatestAssistantArticleIds,
  type SubjectType,
  type ChannelKey,
} from '../store/contentStore.js';
import { adaptArticleChannels } from '../services/channelAdapter.js';
import { getProjectKit, type WritingKit, type ContentLine } from '../store/writingKitStore.js';
import {
  createDecision,
  anchorIsVerbatim,
  type RejectedOption,
} from '../store/decisionStore.js';
import {
  createProject,
  getProject,
  listProjects,
  createConversation,
  getConversation,
  appendMessage,
  appendAgentMessages,
  getMessages,
  addProjectEntity,
  listProjectEntities,
  renameConversation,
  assignConversationToProject,
} from '../store/database.js';
import { buildCompressedHistory, maybeSummarizeAsync } from '../services/summarizer.js';
import { saveMemory, searchProjectMemory, formatSearchResults } from '../services/memory.js';
import type { LLMMessage, AbortedError as AbortErr } from '../llm/client.js';
import { AbortedError } from '../llm/client.js';
import type { SSEEvent, ProjectEntityRole } from '../types/index.js';

type SendSSE = (event: SSEEvent) => void;

function makeTitle(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 20 ? clean.slice(0, 20) + '…' : clean || '新对话';
}

function safeJSON(text: string): any | null {
  try { return JSON.parse(text); } catch { /* continue */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

/** 项目实体角色中文映射 */
const ROLE_LABELS: Record<string, string> = {
  borrower: '被保证人',
  beneficiary: '受益人',
  guarantor: '反担保人',
  related: '关联企业',
  other: '其他',
};

/** 构造规范包写作约束文本（无规范包返回空串） */
function buildKitRules(kit: WritingKit | undefined, opts?: { compact?: boolean }): string {
  if (!kit) return '';
  const blocks: string[] = [];
  if (kit.contentLines.length) {
    const lines = kit.contentLines
      .map((l: ContentLine) => `- ${l.label}（key=${l.key}）${l.source ? `，取材：${l.source}` : ''}${l.focus ? `，覆盖：${l.focus}` : ''}`)
      .join('\n');
    blocks.push(`【内容线】这个号分 ${kit.contentLines.length} 条内容线，选题/写稿时先判断归属哪条线：\n${lines}`);
  }
  if (kit.positioning_md?.trim()) blocks.push(`【账号定位与内容线规范】\n${kit.positioning_md.trim()}`);
  if (kit.writing_md?.trim()) blocks.push(`【写作语言规范（写每一篇主稿都必须遵守）】\n${kit.writing_md.trim()}`);
  if (kit.title_md?.trim()) blocks.push(`【起标题规范（选题名、主稿标题、渠道标题都按它来）】\n${kit.title_md.trim()}`);
  if (kit.spread_md?.trim()) blocks.push(`【读者反馈三维度框架（选题时先想主攻维度：转发/评论/点赞；发布后用来复盘数据）】\n${kit.spread_md.trim()}`);
  if (kit.signoff?.trim()) blocks.push(`【文末署名（渠道适配时原样挂在文末，不要自己另编署名/口号）】\n${kit.signoff.trim()}`);
  if (blocks.length === 0) return '';
  const head = opts?.compact ? '' : '## 本主体挂载了写作规范包，以下规范具有最高优先级：所有选题、标题、主稿都必须遵守，与你的默认写法冲突时以规范为准。\n';
  return head + blocks.join('\n\n');
}

/** 构造推广主体档案上下文，喂给内容搭档 */
function buildProjectContext(projectId: string): string {
  const project = getProject(projectId);
  if (!project) return '';

  const type = getSubjectType(projectId);
  const p = getSubjectProfile(projectId);
  const kit = getProjectKit(projectId);
  const typeLabels: Record<string, string> = {
    product: '软件/实体产品',
    official_account: '公众号/账号',
    personal_ip: '个人 IP',
    service: '服务/课程',
    event: '活动',
    community: '社群',
    other: '其他',
  };
  const lines: string[] = [];
  lines.push(`【当前推广主体：${project.name}】类型：${typeLabels[type] || type}${project.description ? `；${project.description}` : ''}`);
  if (p.positioning) lines.push(`- 定位：${p.positioning}`);
  if (p.audience) lines.push(`- 目标读者：${p.audience}`);
  if (p.pains) lines.push(`- 受众痛点：${p.pains}`);
  if (Array.isArray(p.sellingPoints) && p.sellingPoints.length) lines.push(`- 卖点：${p.sellingPoints.join('；')}`);
  if (p.difference) lines.push(`- 差异点：${p.difference}`);
  if (p.cta) lines.push(`- CTA：${p.cta}${p.ctaTarget ? `（${p.ctaTarget}）` : ''}`);
  if (p.tone) lines.push(`- 语气：${p.tone}`);
  if (kit) lines.push(`- 已挂载写作规范包：${kit.name}（选题/写稿/起名/复盘必须按规范包执行）`);
  const out = [lines.join('\n')];
  const kitRules = buildKitRules(kit);
  if (kitRules) out.push(kitRules);
  return out.join('\n\n');
}

/** 构造内容台账上下文（系列+文章现状，防重复沉淀、回答进度问题） */
function buildContentListSystem(projectId: string): string {
  const series = listSeries(projectId);
  const articles = listArticles(projectId);
  if (articles.length === 0) return '当前内容计划还是空的，还没有任何选题。';
  const statusLabels: Record<string, string> = { topic: '选题', writing: '写作中', final: '定稿', published: '已发' };
  const lines: string[] = [];
  for (const s of series) {
    const items = articles.filter((a) => a.series_id === s.id);
    lines.push(`\n系列「${s.title}」(id=${s.id})，共 ${items.length} 篇：`);
    const kit = getProjectKit(projectId);
    const lineLabel = new Map((kit?.contentLines || []).map((l) => [l.key, l.label]));
    for (const a of items) {
      const line = a.content_line ? `，${lineLabel.get(a.content_line) || a.content_line}` : '';
      lines.push(`  - 「${a.title}」(id=${a.id}, ${statusLabels[a.status] || a.status}${line}${a.angle ? `，角度：${a.angle}` : ''})`);
    }
  }
  const loose = articles.filter((a) => !a.series_id);
  if (loose.length) {
    lines.push('\n未归系列：');
    for (const a of loose) {
      lines.push(`  - 「${a.title}」(id=${a.id}, ${statusLabels[a.status] || a.status}${a.angle ? `，角度：${a.angle}` : ''})`);
    }
  }
  const counts = articles.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(counts).map(([k, v]) => `${statusLabels[k] || k} ${v}`).join('、');
  return `当前内容计划台账（总计 ${articles.length} 篇：${summary}）：${lines.join('\n')}\n以上已存在，不要重复沉淀；更新已有文章用 update_article 并带对应 id。`;
}

/**
 * 构造「本条消息 @ 引用的需求」上下文：把被 @ 的模块/页面完整文档喂给模型，
 * 并给出聚焦指令（新页面归属被@模块、修订被@页面直接带 id）。
 */
function buildRefRequirementContext(refReqIds: string[]): string {
  const refs = refReqIds
    .map((id) => getRequirement(id))
    .filter((r): r is NonNullable<typeof r> => !!r);
  if (refs.length === 0) return '';

  const blocks: string[] = [];
  for (const r of refs) {
    const kind = r.kind === 'page' ? '页面' : '模块';
    let head = `【用户 @ 引用了${kind}：${r.title}】(id=${r.id}, 状态=${r.status === 'confirmed' ? '已确认' : '待确认'})`;
    // 页面带上归属模块文档，让上下文完整
    let parentDoc = '';
    if (r.kind === 'page' && r.parent_id) {
      const parent = getRequirement(r.parent_id);
      if (parent) {
        parentDoc = `\n\n[归属模块：${parent.title}]\n${parent.doc_md || ''}`;
      }
    }
    blocks.push(`${head}\n${r.doc_md || ''}${parentDoc}`);
  }

  const titles = refs.map((r) => `「${r.title}」`).join('、');
  return (
    `【本条消息 @ 聚焦了以下需求：${titles}】\n` +
    `用户接下来在围绕这些需求聊，请据此聚焦：\n` +
    `- 用户要在被 @ 的${refs.some((r) => r.kind === 'module') ? '模块' : '需求'}下聊新页面/补充内容时，沉淀页面请直接带上对应模块的 module_id（见下方文档里的 id），不要再猜归属。\n` +
    `- 用户在细化/修改被 @ 的页面或模块时，修订请用 revise_requirement 并带上对应 id；聊出来的新内容属于这些需求的补全。\n` +
    `- 如果用户说的内容跟被 @ 需求无关（开了新话题），正常按新话题处理，不要硬套。\n\n` +
    blocks.join('\n\n---\n\n')
  );
}
function buildSkillDoneGuide(skillRecord: { result?: string; skillMeta?: { skillId?: string; skillName?: string } }): string {
  const skillId = skillRecord.skillMeta?.skillId || '';
  const tail = '你可以直接在下方追问，或把结论同步到需求文档后再生成/调整原型。';
  switch (skillId) {
    case 'requirement-health-check':
      return `体检结果见上方。缺项和追问问题都列出来了——你逐条答我，我帮你把内容补进需求文档；补完后确认需求，就能生成或重做原型。${tail}`;
    case 'screenshot-to-requirement':
      return `截图要素清单见上方。图上的东西我都提出来了，末尾「待确认的业务问题」麻烦你答一下；确认后我可以直接帮你沉淀成页面需求。${tail}`;
    case 'acceptance-case-generator':
      return `验收用例见上方，照着逐条点原型就行。发现不符合预期的地方，直接在原型上贴标注意见，我会改；标「需求未定义」的条目，先跟我确认规则再验收。${tail}`;
    case 'diagram-flow':
      return `流程图见上方。驳回/重提这类回头路和需求没写死的分支我都列在「待确认」里了——你确认或纠正后，我可以帮你把流程同步进需求文档。${tail}`;
    case 'diagram-architecture':
      return `功能架构图见上方，模块和页面的确认状态、缺口都标在图里和盘点里了。待确认/待生成的页面确认后，我可以帮你沉淀或推进原型生成。${tail}`;
    case 'requirement-change-impact':
      return `影响清单见上方。确认按这个范围改的话，我可以先帮你改需求文档，你确认后再贴标注或重做对应页面；要调整范围直接说。${tail}`;
    case 'competitor-benchmark':
      return `对标结果见上方。标「建议纳入」的功能点，你拍板后我可以帮你逐条沉淀成模块/页面需求；标「可做可不做/决策点」的（比如 MCP 市场、在线沙箱）你定了方向再往下聊。${tail}`;
    default:
      return `技能执行完成，结果见上方。${tail}`;
  }
}

/**
 * 处理一轮用户对话
 */
export async function handleChat(params: {
  projectId: string | undefined;
  conversationId: string | undefined;
  message: string;
  attachments?: unknown[];
  /** 本条消息 @ 引用的需求 id 列表（模块/页面） */
  refRequirements?: unknown[];
  forceSkillId?: string | null;
  sendSSE: SendSSE;
  signal?: AbortSignal;
}): Promise<{ projectId: string | null; conversationId: string }> {
  const { message, attachments = [], sendSSE, signal, forceSkillId, refRequirements = [] } = params;
  let { projectId, conversationId } = params;

  // 1. 项目是可选的。没有 projectId 就是游离对话，不自动建项目；
  //    只有触发评估（需要归档结论/企业/附件）时才自动建项目。

  // 2. 确保对话存在（projectId 可为 null）
  if (!conversationId || !getConversation(conversationId)) {
    conversationId = conversationId || uuidv4();
    createConversation(conversationId, projectId || null, makeTitle(message));
  } else if (getMessages(conversationId).length === 0) {
    renameConversation(conversationId, makeTitle(message));
  }
  const convId: string = conversationId;

  sendSSE({ type: 'done', data: { projectId: projectId || null, conversationId: convId, stage: 'session' } });

  // 注意：旧的 /skill 直连旁路已封陈。前端选技能后改为传 forceSkillId，
  // 统一走接待员，由接待员做上下文补全/追问后调 invoke_skill，技能执行员保持无状态。

  // 3. 持久化用户消息（携带已上传的附件元信息 + @ 引用的需求）
  appendMessage(convId, 'user', message, attachments, { refRequirements: refRequirements as any });


  // 4. 构造上下文（项目档案 + 历史摘要 + 最近消息）
  const projectContext = projectId ? buildProjectContext(projectId) : '';

  // 内容台账现状（防重复沉淀、回答进度），上下文重建时复用
  const contentListSystem = projectId ? buildContentListSystem(projectId) : '';

  // 选中技能的引导指令（整轮不变，提前算好，上下文重建时复用）
  let skillGuideSystem = '';
  if (forceSkillId) {
    let skillName = forceSkillId;
    let skillDesc = '';
    try {
      const found = (await listSkillSummaries()).find((s) => s.id === forceSkillId);
      if (found) { skillName = found.name; skillDesc = found.description; }
    } catch { /* ignore */ }
    skillGuideSystem =
      `【重要指令】用户当前已在界面选中了「${skillName}」这个技能（说明：${skillDesc}）。本轮请严格按以下规则处理：\n` +
      `1. 如果用户是在问这个技能怎么用/能做什么/是什么（例如“这个技能怎么用”“怎么操作”），**不要调用任何工具（不要调 list_skills、不要调 invoke_skill）**，直接用中文简洁回答：说明「${skillName}」的用途和适用场景，并给 1-2 个可以直接照着说的例句（例句要具体到某个模块/页面/截图，例如“给审核工作台这条需求做个体检”）。回答只围绕「${skillName}」，不要提其他技能。\n` +
      `2. 如果用户是要执行具体任务（例如“体检一下台账管理模块”“照这张截图理需求”“画个审核流程”），你必须调用 invoke_skill 工具（skillId=${forceSkillId}），并在 task 里补全关键信息：具体是哪条需求/哪个模块/哪个页面/哪张附件，让执行员不用再猜；信息不足或指代有歧义时先追问，不要猜测。\n` +
      `用户的问题是：${message}`;
  }

  // 组装喂给模型的完整上下文；keepRecent 控制最近保留原文的消息条数（上下文超限时砍半重建用）
  const buildMessages = (keepRecent: number): LLMMessage[] => {
    const { summarySystem, messages: recentMessages } = buildCompressedHistory(convId, { keepRecent });
    const base: LLMMessage[] = [{ role: 'system', content: receptionist.systemPrompt }];
    if (projectContext) base.push({ role: 'system', content: projectContext });
    if (contentListSystem) base.push({ role: 'system', content: contentListSystem });
    if (summarySystem) base.push({ role: 'system', content: summarySystem });
    base.push(...recentMessages);
    if (skillGuideSystem) base.push({ role: 'system', content: skillGuideSystem });
    return base;
  };

  // 当前保留的最近消息条数；上下文超限会逐次砍半（12 → 6 → 3）
  let currentKeepRecent = 12;
  let shrinkCount = 0;
  let messages = buildMessages(currentKeepRecent);
  // 初始基础上下文长度（system + 历史）；本轮工具调用产生的消息在这之后，砍半重建时要保留
  let baseLen = messages.length;

  const cfg = getConfig();
  const receptionistModel = getModelForRole('receptionist');
  const client = new OpenAI({
    apiKey: cfg.llm.apiKey,
    baseURL: cfg.llm.baseUrl,
  });

  sendSSE({
    type: 'agent_start',
    data: { agentName: receptionist.name, agentRole: receptionist.role },
  });

  // 5. 带工具的对话循环
  const MAX_TOOL_ROUNDS = 6;
  let finalAnswer = '';
  const createdReqIds: string[] = []; // 本轮沉淀出的需求 id
  const revisedReqIds: string[] = []; // 本轮修订（打回待确认）的需求 id，也要挂卡片让 PM 复核
  const createdDecisionIds: string[] = []; // 本轮记录的设计决策 id
  const createdPoolIds: string[] = []; // 本轮收入需求池的 idea id
  const touchedArticleIds: string[] = []; // ContentForge：本轮沉淀/更新的文章 id
  // 跨轮累积的接待员回复：模型常在「调工具（如沉淀需求）之前」先输出分析，
  // 而 accumulated 每轮重置、只存最后一轮，会导致工具前的那段分析刷新后丢失。
  // 这里把每轮（工具调用前）的文本跨轮拼起来，SSE 实时推送和最终落库都用完整文本。
  let assistantFull = '';
  // 同理跨轮累积思考过程（reasoning_content），实时推给前端「思考中」展示，避免思考时屏幕干等显慢
  let reasoningFull = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal?.aborted) throw new AbortedError();

    // idle 超时：60s 没收到 chunk 就中止，用已有内容继续
    const idleCtl = new AbortController();
    let idleTimer: NodeJS.Timeout | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idleCtl.abort(), 60_000);
    };
    const onExternalAbort = () => idleCtl.abort();
    signal?.addEventListener('abort', onExternalAbort);

    // 上下文超限自愈：400 context_length_exceeded 时，把最近保留消息砍半重建（保留本轮已产生的工具消息）重试
    let stream;
    while (true) {
      try {
        stream = await client.chat.completions.create(
          {
            model: receptionistModel,
            messages,
            tools: [
              ...receptionist.tools,
              ...getRoleMcpTools('receptionist'),
            ] as any,
            temperature: 0.4,
            stream: true,
          },
          { signal: idleCtl.signal as any }
        );
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isContextOverflow =
          /context_length_exceeded|context length|maximum context|too long|token/i.test(msg) &&
          /context|token|length/i.test(msg);
        if (!isContextOverflow || currentKeepRecent <= 2 || shrinkCount >= 2) {
          if (isContextOverflow) {
            // 砍到最小还超：给友好提示，不裸奔英文错误
            throw new Error('对话上下文太长了，已压缩到最近几条仍超限。建议新开一个话题，或把关键结论沉淀成需求后再继续。');
          }
          throw e;
        }
        shrinkCount += 1;
        currentKeepRecent = Math.max(2, Math.floor(currentKeepRecent / 2));
        const toolMessages = messages.slice(baseLen); // 本轮已产生的 assistant(tool_calls)/tool 消息
        messages = [...buildMessages(currentKeepRecent), ...toolMessages];
        baseLen = messages.length - toolMessages.length;
        sendSSE({
          type: 'agent_message',
          data: { agentRole: receptionist.role, content: `（上下文较长，已自动压缩到最近 ${currentKeepRecent} 条消息重试…）` },
        });
      }
    }

    let accumulated = '';
    let reasoningRound = '';
    const toolCallsBuf: Array<{
      id: string;
      function: { name: string; arguments: string };
      type: 'function';
    }> = [];

    resetIdle();
    try {
      for await (const chunk of stream) {
        resetIdle();
        if (signal?.aborted) {
          stream.controller.abort();
          throw new AbortedError();
        }
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallsBuf[idx]) {
              toolCallsBuf[idx] = {
                id: tc.id ?? '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (tc.id) toolCallsBuf[idx].id = tc.id;
            if (tc.function?.name) toolCallsBuf[idx].function.name += tc.function.name;
            if (tc.function?.arguments)
              toolCallsBuf[idx].function.arguments += tc.function.arguments;
          }
        }

        // 推理模型的思考过程（doubao-seed / ark-code 输出 reasoning_content）：实时推「思考中」，避免干等显慢
        const r = (delta as any).reasoning_content;
        if (r) {
          reasoningRound += r;
          sendSSE({
            type: 'reasoning',
            data: { agentRole: receptionist.role, content: (reasoningFull + reasoningRound).trim() },
          });
        }

        if (delta.content) {
          accumulated += delta.content;
          // 实时推送完整文本（跨轮累积 + 本轮），避免工具前的分析被后续轮覆盖
          sendSSE({
            type: 'agent_message',
            data: { agentRole: receptionist.role, content: (assistantFull + accumulated).trim() },
          });
        }
      }
    } catch (e) {
      if (!signal?.aborted && e instanceof Error && e.name === 'AbortError') {
        // idle 超时，用已有内容继续
      } else if (signal?.aborted) {
        throw new AbortedError();
      } else {
        throw e;
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      signal?.removeEventListener('abort', onExternalAbort);
    }

    const validToolCalls = toolCallsBuf.filter(Boolean);
    if (validToolCalls.length === 0) {
      // 最后一轮：跨轮累积 + 本轮 = 完整回复/思考
      if (reasoningRound.trim()) reasoningFull += (reasoningFull ? '\n\n' : '') + reasoningRound.trim();
      finalAnswer = (assistantFull + (assistantFull && accumulated.trim() ? '\n\n' : '') + accumulated.trim()).trim();
      break;
    }
    // 有工具调用、还要继续：把本轮（工具调用前）的分析/思考拼进跨轮累积，下轮重置也不丢
    if (accumulated.trim()) assistantFull += (assistantFull ? '\n\n' : '') + accumulated.trim();
    if (reasoningRound.trim()) reasoningFull += (reasoningFull ? '\n\n' : '') + reasoningRound.trim();

    messages.push({
      role: 'assistant',
      content: accumulated || null,
      tool_calls: validToolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });
    // 注意：baseLen 不在这里更新——本轮的 assistant(tool_calls)+tool 结果都属于“工具消息段”，
    // 下次超限时 slice(baseLen) 要把它们整段保住；baseLen 只在重建时重算。

    let assessmentDone = false;

    for (const tc of validToolCalls) {
      if (signal?.aborted) throw new AbortedError();
      const args = safeJSON(tc.function.arguments) || {};
      let toolResult = '';

      // ===== ContentForge：内容台账工具 =====
      if (tc.function.name === 'list_content') {
        if (!projectId) {
          toolResult = '当前对话还未归档到推广主体。请先在左侧新建一个推广主体并把对话归档进去。';
        } else {
          const type = getSubjectType(projectId);
          const p = getSubjectProfile(projectId);
          const typeLabels: Record<string, string> = {
            product: '软件/实体产品', official_account: '公众号/账号', personal_ip: '个人 IP',
            service: '服务/课程', event: '活动', community: '社群', other: '其他',
          };
          const head = [
            `【推广主体档案】类型：${typeLabels[type] || type}`,
            p.positioning ? `定位：${p.positioning}` : '',
            p.audience ? `目标读者：${p.audience}` : '',
            p.pains ? `痛点：${p.pains}` : '',
            Array.isArray(p.sellingPoints) && p.sellingPoints.length ? `卖点：${p.sellingPoints.join('；')}` : '',
            p.difference ? `差异点：${p.difference}` : '',
            p.cta ? `CTA：${p.cta}${p.ctaTarget ? `（${p.ctaTarget}）` : ''}` : '',
            p.tone ? `语气：${p.tone}` : '',
          ].filter(Boolean).join('\n');
          const kitNow = getProjectKit(projectId);
          toolResult = head + '\n\n' + buildContentListSystem(projectId) + (kitNow ? `\n\n已挂载写作规范包「${kitNow.name}」：沉淀文章时用 content_line 传归属内容线 key（${(kitNow.contentLines || []).map((l) => l.key).join('/') || '无'}），不分线留空；选题/写稿/起名必须遵守该规范包。` : '');
        }
      } else if (tc.function.name === 'save_subject_profile') {
        if (!projectId) {
          toolResult = '当前对话还未归档到推广主体，无法保存档案。';
        } else {
          const subjectType = String(args.subjectType || '').trim() as SubjectType;
          const prev = getSubjectProfile(projectId);
          const profile = { ...prev };
          for (const k of ['positioning', 'audience', 'pains', 'difference', 'cta', 'ctaTarget', 'tone', 'notes'] as const) {
            if (typeof args[k] === 'string' && String(args[k]).trim()) profile[k] = String(args[k]).trim();
          }
          if (Array.isArray(args.sellingPoints)) {
            profile.sellingPoints = (args.sellingPoints as unknown[]).map((x) => String(x).trim()).filter(Boolean);
          }
          updateSubject(projectId, {
            ...(subjectType ? { subjectType } : {}),
            profile,
          });
          toolResult = `已保存推广主体档案（${subjectType || '类型不变'}）。写稿和渠道适配都会基于这份档案。建议让运营者在左侧「主体档案」里核对一遍。`;
        }
      } else if (tc.function.name === 'propose_article') {
        const title = String(args.title || '').trim();
        const angle = String(args.angle || '').trim();
        const docMd = String(args.doc_md || '').trim();
        const rawStatus = String(args.status || 'topic').trim();
        const status = (['topic', 'writing', 'final'].includes(rawStatus) ? rawStatus : 'topic') as 'topic' | 'writing' | 'final';
        const seriesTitle = String(args.series_title || '').trim();
        const seriesIdArg = String(args.series_id || '').trim();
        if (!title) {
          toolResult = '沉淀失败：title 为空。';
        } else if (!projectId) {
          toolResult = '当前对话还未归档到推广主体，无法沉淀选题。请先归档对话。';
        } else {
          const { seriesId, createdSeries } = ensureSeries(projectId, {
            seriesId: seriesIdArg || undefined,
            seriesTitle: seriesTitle || undefined,
            fallbackTitle: title,
          });
          if (createdSeries) {
            sendSSE({ type: 'article', data: { id: createdSeries.id, title: createdSeries.title, kind: 'series' } });
          }
          const contentLine = String(args.content_line || '').trim();
          const article = createArticle({
            projectId,
            seriesId,
            title,
            angle,
            docMd,
            status,
            contentLine,
            sourceConversationId: convId,
          });
          touchedArticleIds.push(article.id);
          sendSSE({ type: 'article', data: { id: article.id, title: article.title, status: article.status, kind: 'article' } });
          toolResult =
            `已沉淀${status === 'topic' ? '选题' : status === 'writing' ? '写作中的文章' : '定稿文章'}「${title}」(id=${article.id})。` +
            (createdSeries ? ` 系列「${createdSeries.title}」不存在，已自动创建。` : seriesId ? ' 已挂到对应系列下。' : '');
        }
      } else if (tc.function.name === 'batch_topics') {
        const items = Array.isArray(args.items) ? args.items : [];
        const seriesTitle = String(args.series_title || '').trim();
        const seriesIdArg = String(args.series_id || '').trim();
        const parsed = items
          .map((it: any) => ({
            title: String(it?.title || '').trim(),
            angle: String(it?.angle || '').trim(),
          }))
          .filter((it: { title: string }) => it.title);
        if (!projectId) {
          toolResult = '当前对话还未归档到推广主体，无法铺选题。';
        } else if (parsed.length === 0) {
          toolResult = '铺选题失败：items 为空或没有合法 title。';
        } else {
          const { seriesId, createdSeries } = ensureSeries(projectId, {
            seriesId: seriesIdArg || undefined,
            seriesTitle: seriesTitle || undefined,
            fallbackTitle: '未命名系列',
          });
          if (!seriesId) {
            toolResult = '铺选题失败：必须给系列名（series_title）。';
          } else {
            if (createdSeries) {
              sendSSE({ type: 'article', data: { id: createdSeries.id, title: createdSeries.title, kind: 'series' } });
            }
            const batchLine = String(args.content_line || '').trim();
            const created = batchCreateArticles(projectId, parsed.map((it: { title: string; angle: string }) => ({
              title: it.title, angle: it.angle, seriesId, contentLine: batchLine,
            })));
            for (const a of created) {
              touchedArticleIds.push(a.id);
              sendSSE({ type: 'article', data: { id: a.id, title: a.title, status: a.status, kind: 'article' } });
            }
            toolResult =
              `已在系列${createdSeries ? `「${createdSeries.title}」（自动创建）` : ''}下铺了 ${created.length} 个选题(id 区间见台账)。` +
              ' 记得把选题清单整理给运营者勾选/调整。';
          }
        }
      } else if (tc.function.name === 'update_article') {
        const articleId = String(args.articleId || '').trim();
        const target = articleId && projectId ? getArticle(articleId) : null;
        if (!projectId) {
          toolResult = '当前对话未归档到推广主体，无法更新文章。';
        } else if (!target || target.project_id !== projectId) {
          toolResult = `更新失败：找不到 id=${articleId} 的文章。请先用 list_content 查清单里的 id。`;
        } else {
          const title = String(args.title || '').trim();
          const angle = String(args.angle || '').trim();
          const docMd = String(args.doc_md || '').trim();
          const rawStatus = String(args.status || '').trim();
          const status = (['writing', 'final'].includes(rawStatus) ? rawStatus : undefined) as 'writing' | 'final' | undefined;
          if (!docMd && !title && !angle && !status) {
            toolResult = '更新失败：没有任何要更新的内容（title/angle/doc_md/status 至少给一个）。';
          } else {
            const contentLine = String(args.content_line ?? '').trim();
            const updated = updateArticle(articleId, {
              ...(title ? { title } : {}),
              ...(angle ? { angle } : {}),
              ...(docMd ? { docMd } : {}),
              ...(status ? { status } : {}),
              ...(Object.prototype.hasOwnProperty.call(args, 'content_line') ? { contentLine } : {}),
            })!;
            touchedArticleIds.push(updated.id);
            sendSSE({ type: 'article', data: { id: updated.id, title: updated.title, status: updated.status, kind: 'article', revised: true } });
            toolResult = `已更新文章「${updated.title}」(id=${updated.id})，当前状态：${({ topic: '选题', writing: '写作中', final: '定稿', published: '已发' } as Record<string, string>)[updated.status]}。`;
          }
        }
      } else if (tc.function.name === 'adapt_channels') {
        const articleId = String(args.articleId || '').trim();
        const target = articleId && projectId ? getArticle(articleId) : null;
        const want = Array.isArray(args.channels)
          ? (args.channels as unknown[]).map((x) => String(x)).filter((x) => ['wechat', 'xhs', 'markdown'].includes(x)) as ChannelKey[]
          : [];
        const requirement = String(args.requirement || '').trim();
        if (!projectId) {
          toolResult = '当前对话未归档到推广主体，无法适配渠道。';
        } else if (!target || target.project_id !== projectId) {
          toolResult = `适配失败：找不到 id=${articleId} 的文章。请先用 list_content 查 id。`;
        } else {
          sendSSE({ type: 'agent_message', data: { agentRole: receptionist.role, content: (assistantFull ? assistantFull + '\n\n' : '') + '正在生成渠道版本（公众号/小红书/掘金知乎），主稿越长越慢，请稍等…' } });
          const result = await adaptArticleChannels(projectId, articleId, want, requirement);
          if (result.ok) {
            const labelMap: Record<string, string> = { wechat: '公众号', xhs: '小红书', markdown: '掘金/知乎' };
            sendSSE({ type: 'channel_versions', data: { articleId, channels: result.channels } });
            toolResult = `渠道版本已生成并落库：${result.channels.map((c) => labelMap[c]).join('、')}。提醒运营者到文章详情里检查、一键复制，手动发布。不要在对话里复述全文。`;
          } else {
            toolResult = `渠道适配失败：${result.error || '未知原因'}。已完成：${result.channels.join('、') || '无'}。可以让运营者稍后重试。`;
          }
        }
      } else if (tc.function.name === 'record_publish') {
        const articleId = String(args.articleId || '').trim();
        const channel = String(args.channel || '').trim() as ChannelKey;
        const target = articleId && projectId ? getArticle(articleId) : null;
        if (!projectId) {
          toolResult = '当前对话未归档到推广主体，无法记录发布。';
        } else if (!target || target.project_id !== projectId) {
          toolResult = `记录失败：找不到 id=${articleId} 的文章。`;
        } else if (!['wechat', 'xhs', 'markdown'].includes(channel)) {
          toolResult = '记录失败：channel 必须是 wechat/xhs/markdown。';
        } else {
          const url = String(args.url || '').trim();
          const note = String(args.note || '').trim();
          const m = (args.metrics && typeof args.metrics === 'object') ? args.metrics : {};
          const metrics: Record<string, number> = {};
          for (const k of ['views', 'likes', 'comments', 'collects', 'shares']) {
            const v = (m as Record<string, unknown>)[k];
            if (typeof v === 'number' && Number.isFinite(v)) metrics[k] = v;
          }
          createPublish({ articleId, projectId, channel, url, metrics, note });
          // 至少一个渠道已发 → 文章状态置为已发
          if (target.status !== 'published') updateArticle(articleId, { status: 'published' });
          touchedArticleIds.push(articleId);
          sendSSE({ type: 'article', data: { id: articleId, title: target.title, status: 'published', kind: 'article', published: true } });
          toolResult = `已记录「${target.title}」在${{ wechat: '公众号', xhs: '小红书', markdown: '掘金/知乎' }[channel]}的发布${url ? `：${url}` : ''}，文章状态已置为「已发」。可结合数据给后续选题建议。`;
        }
      } else if (tc.function.name === 'add_to_pool') {
        // ===== ProtoForge：收入需求池（未成形的想法） =====
        const title = String(args.title || '').trim();
        const summary = String(args.summary || '').trim();
        const proposer = String(args.proposer || '').trim();
        const detailMd = String(args.detail_md || '').trim();
        const poolStatus = String(args.poolStatus || 'raw') === 'ready' ? 'ready' : 'raw';
        const relatedModuleTitle = String(args.relatedModuleTitle || '').trim();
        const relatedModuleIdArg = String(args.relatedModuleId || '').trim();
        const urgent = Boolean(args.urgent);
        const important = Boolean(args.important);
        if (!title) {
          toolResult = '入池失败：title 为空。';
        } else if (!projectId) {
          toolResult = '当前对话还未归档到项目，无法收入需求池。请先把对话归档到某个项目。';
        } else {
          // 解析软关联模块：id 优先，其次按同名模块找
          let relatedModuleId: string | null = null;
          if (relatedModuleIdArg) {
            const m = listRequirements(projectId).find((r) => r.id === relatedModuleIdArg && r.kind !== 'page');
            if (m) relatedModuleId = m.id;
          }
          if (!relatedModuleId && relatedModuleTitle) {
            const m = listRequirements(projectId).find(
              (r) => r.kind === 'module' && r.title === relatedModuleTitle
            );
            if (m) relatedModuleId = m.id;
          }
          const idea = createRequirement({
            id: uuidv4(),
            projectId,
            title,
            kind: 'idea',
            docMd: detailMd,
            summary,
            poolStatus,
            urgent,
            important,
            relatedModuleId,
            proposer,
            sourceConversationId: convId,
          }) as { id: string; title: string };
          createdPoolIds.push(idea.id);
          sendSSE({ type: 'pool_item', data: { id: idea.id, title: idea.title, poolStatus } });
          toolResult =
            `已把「${title}」收入需求池(id=${idea.id})，状态：${poolStatus === 'ready' ? '可转需求' : '待澄清'}。` +
            (relatedModuleId ? ' 已软关联到相关模块。' : relatedModuleTitle ? ' 没找到同名模块，软关联留空，PM 转正时再选归属。' : '') +
            ' 聊成熟后 PM 会在需求池里一键转成模块/页面。';
        }
      } else if (tc.function.name === 'propose_requirement') {
        const title = String(args.title || '').trim();
        const docMd = String(args.doc_md || '').trim();
        const kind = String(args.kind || 'module').trim() === 'page' ? 'page' : 'module';
        const moduleId = String(args.module_id || '').trim();
        const moduleTitle = String(args.module_title || '').trim();
        const moduleDoc = String(args.module_doc || '').trim();
        if (!title) {
          toolResult = '沉淀失败：title 为空。';
        } else if (!projectId) {
          toolResult = '当前对话还未归档到项目，无法沉淀需求。请先把对话归档到某个项目（顶栏“归档到项目”），再沉淀。';
        } else {
          let parentId: string | null = null;
          let createdModuleTitle = '';
          if (kind === 'page') {
            const { parentId: pid, createdModule } = ensureParentModule(projectId, {
              moduleId: moduleId || undefined,
              moduleTitle: moduleTitle || undefined,
              fallbackTitle: title.replace(/(页面|登记|列表|详情|工作台|看板)$/, ''),
              moduleDoc: moduleDoc || undefined,
              sourceConversationId: convId,
            });
            parentId = pid;
            if (createdModule) {
              createdModuleTitle = createdModule.title;
              sendSSE({ type: 'requirement', data: { id: createdModule.id, title: createdModule.title, status: 'proposed' } });
            }
          }
          const req = createRequirement({
            id: uuidv4(),
            projectId,
            title,
            kind,
            parentId,
            docMd,
            sourceConversationId: convId,
            status: 'proposed',
          }) as { id: string; title: string };
          createdReqIds.push(req.id);
          sendSSE({ type: 'requirement', data: { id: req.id, title: req.title, status: 'proposed' } });
          toolResult =
            `已沉淀${kind === 'page' ? '页面' : '模块'}需求「${title}」(id=${req.id})，状态：待确认。` +
            (createdModuleTitle ? ` 归属模块「${createdModuleTitle}」不存在，已自动创建。` : parentId ? ' 已挂到对应模块下。' : '');
        }
      } else if (tc.function.name === 'revise_requirement') {
        // ===== ProtoForge：根据评审意见修订需求文档 =====
        const reqId = String(args.requirementId || '').trim();
        const docMd = String(args.doc_md || '').trim();
        const title = String(args.title || '').trim();
        const changeNote = String(args.changeNote || '').trim();
        const target = reqId ? listRequirements(projectId || '').find((r) => r.id === reqId) : null;
        if (!projectId) {
          toolResult = '当前对话未归档到项目，无法修订需求。';
        } else if (!target) {
          toolResult = `修订失败：找不到 id=${reqId} 的需求。请从系统提供的需求清单 id 中选择。`;
        } else if (!docMd) {
          toolResult = '修订失败：doc_md 为空。';
        } else {
          const updated = updateRequirement(reqId, {
            docMd,
            ...(title ? { title } : {}),
            status: 'proposed', // 修订后打回待确认，PM 复核
          }, 'ai:revise_requirement') as { id: string; title: string };
          // 状态没变（原本就待确认）时自动快照不触发，这里补一版；有状态快照则内容相同自动去重
          snapshotRequirement(reqId, 'ai', { actor: 'ai:revise_requirement', note: changeNote ? changeNote.slice(0, 80) : '' });
          // 推送需求更新事件（前端刷新清单/详情）
          sendSSE({ type: 'requirement', data: { id: updated.id, title: updated.title, status: 'proposed', revised: true } });
          revisedReqIds.push(updated.id);
          toolResult =
            `已修订需求「${updated.title}」(id=${updated.id})，状态打回「待确认」等 PM 复核。` +
            (changeNote ? ` 修订说明：${changeNote}` : '');
        }
      } else if (tc.function.name === 'record_decision') {
        // ===== ProtoForge：沉淀设计决策（决策脉络） =====
        const topic = String(args.topic || '').trim();
        const point = String(args.point || '').trim();
        const anchorText = String(args.anchorText || '').trim();
        const conclusion = String(args.conclusion || '').trim();
        const rationale = String(args.rationale || '').trim();
        const sourceType = String(args.sourceType || 'chat') === 'meeting' ? 'meeting' : 'chat';
        const sourceLabel = String(args.sourceLabel || '').trim();
        const sourceExcerpt = String(args.sourceExcerpt || '').trim();
        const rejected: RejectedOption[] = Array.isArray(args.rejected)
          ? (args.rejected as unknown[])
              .map((x) => ({
                option: String((x as Record<string, unknown>)?.option ?? '').trim(),
                reason: String((x as Record<string, unknown>)?.reason ?? '').trim(),
              }))
              .filter((x) => x.option)
          : [];
        const requirementIds = Array.isArray(args.requirementIds)
          ? (args.requirementIds as unknown[]).map((x) => String(x)).filter(Boolean)
          : [];
        // 服务端原话兼底：anchorText 必须是关联需求文档里的逐字原话，
        // AI 改写/编造的一律置空（走「未归位」），防止高亮钉在错句子上。
        let anchorWarn = '';
        let safeAnchor = anchorText;
        if (anchorText && !anchorIsVerbatim(anchorText, requirementIds)) {
          safeAnchor = '';
          anchorWarn = ' 提示：你给的锚文本在关联需求文档里找不到逐字原话（不能改写/编造），已清空锚文本，这条决策先挂需求点。等文档补上原话后再补锚文本。';
        }
        if (!topic || !conclusion) {
          toolResult = '记录失败：topic（议题）和 conclusion（结论）必填。';
        } else if (!rationale) {
          toolResult = '记录失败：rationale（为什么这么定）必填，决策脉络的价值就在理由上。请补上理由再记录。';
        } else if (!projectId) {
          toolResult = '当前对话还未归档到项目，无法记录决策。请先把对话归档到某个项目（顶栏“归档到项目”）。';
        } else {
          try {
            const decision = createDecision({
              projectId,
              topic,
              point,
              anchorText: safeAnchor,
              conclusion,
              rationale,
              rejected,
              sourceType,
              sourceLabel,
              sourceExcerpt,
              sourceConversationId: convId,
              requirementIds,
            });
            sendSSE({ type: 'design_decision', data: { id: decision.id, topic: decision.topic } });
            createdDecisionIds.push(decision.id);
            toolResult =
              `已记录设计决策「${topic}」(id=${decision.id})。` +
              (decision.requirementIds.length ? ` 已关联 ${decision.requirementIds.length} 条需求。` : ' 注意：未关联到具体需求，只在项目决策列表可见；能确定归属请补上需求 id。') +
              (point ? '' : ' 提示：没填需求点（point），这条会归为整条需求的通用决策；如果它针对某个具体设计点，下次记得带上文档章节标题。') +
              anchorWarn +
              (sourceType === 'meeting' ? ' 来源：' + (sourceLabel || '会议纪要') : '');
          } catch (e) {
            toolResult = `记录决策失败：${e instanceof Error ? e.message : String(e)}`;
          }
        }
      } else if (tc.function.name === 'register_external_enterprise') {
        const { name, creditCode, legalPerson, registeredCapital, establishDate, industry } = args as {
          name: string; creditCode: string; legalPerson?: string;
          registeredCapital?: string; establishDate?: string; industry?: string;
        };
        if (!name || !creditCode) {
          toolResult = '错误：name 和 creditCode 必填。';
        } else {
          const enterpriseId = `EXT-${creditCode.slice(-8)}`;
          upsertExternalEnterprise({
            enterprise_id: enterpriseId,
            name,
            credit_code: creditCode,
            legal_person: legalPerson || null,
            registered_capital: registeredCapital || null,
            establish_date: establishDate || null,
            industry: industry || null,
            source: 'mcp',
            raw_json: JSON.stringify({ name, creditCode, legalPerson, registeredCapital, establishDate, industry }),
          });
          toolResult = JSON.stringify({
            enterpriseId,
            name,
            creditCode,
            message: `企业「${name}」已登记，enterpriseId=${enterpriseId}。现在可以调用 start_assessment 启动评估。`,
          });
        }
      } else if (tc.function.name === 'list_enterprises') {
        const list = getEnterpriseList();
        toolResult = JSON.stringify(
          list.map((e) => ({
            id: e.id,
            name: e.name,
            legalPerson: e.legalPerson,
            industry: e.industry,
          }))
        );
      } else if (tc.function.name === 'add_project_entity') {
        const { enterpriseId, entityRole } = args;
        if (!projectId) {
          toolResult = '当前对话还未归档到项目。你可以直接进行评估；等用户把对话归档到项目后，企业会自动加入项目。';
        } else {
          addProjectEntity(projectId, enterpriseId, (entityRole as ProjectEntityRole) || 'related');
          const ent = getEnterpriseList().find((e) => e.id === enterpriseId);
          const entName = ent?.name || enterpriseId;
          const roleLabel = ROLE_LABELS[entityRole as string] || '相关企业';
          toolResult = `已将「${entName}」加入当前项目，角色：${roleLabel}。`;
          // G 打底：实体关系自动入记忆
          void saveMemory({
            projectId,
            sourceType: 'entity',
            sourceId: `${enterpriseId}-${entityRole || 'related'}`,
            memoryType: 'relationship',
            content: `[项目关系] ${entName}（${enterpriseId}）在本项目中的角色是：${roleLabel}`,
            metadata: { enterpriseId, enterpriseName: entName, role: entityRole || 'related' },
          });
        }
      } else if (tc.function.name === 'list_project_requirements') {
        // 读取当前项目全部需求（含完整文档）：体检/给建议/一致性核对都靠它，
        // 透传 projectId（走全局工具注册表，跟技能链路同一个 handler）
        toolResult = await executeTool('list_project_requirements', args, { projectId, conversationId: convId });
      } else if (tc.function.name === 'get_prototype_overview') {
        // 原型概况：变更影响分析/架构图场景读页面与数据集结构
        toolResult = await executeTool('get_prototype_overview', args, { projectId, conversationId: convId });
      } else if (tc.function.name === 'list_project_attachments') {
        // 透传项目/对话上下文（游离对话时查对话级附件）
        toolResult = await executeTool('list_project_attachments', {}, { projectId, conversationId: convId });
      } else if (tc.function.name === 'read_attachment') {
        // 前台读取附件全文：透传项目/对话上下文
        toolResult = await executeTool('read_attachment', args, { projectId, conversationId: convId });
      } else if (tc.function.name === 'read_webpage') {
        // 读取网页正文（竞品/参考链接）
        toolResult = await executeTool('read_webpage', args, { projectId, conversationId: convId });
      } else if (tc.function.name === 'search_memory') {
        const query = args.query as string;
        if (!query) {
          toolResult = '错误：缺少 query 参数。';
        } else if (!projectId) {
          toolResult = '当前对话未归档到项目，暂无项目记忆可供检索。';
        } else {
          try {
            const results = await searchProjectMemory({
              projectId,
              query,
              topK: (args.topK as number) || 6,
              type: args.type as string | undefined,
            });
            toolResult = formatSearchResults(results);
          } catch (e) {
            toolResult = `记忆检索出错：${e instanceof Error ? e.message : String(e)}`;
          }
        }
      } else if (tc.function.name === 'list_skills') {
        const skills = await listSkillSummaries();
        if (skills.length === 0) {
          toolResult = '当前没有可用的技能。';
        } else {
          toolResult = JSON.stringify(skills.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            keywords: s.keywords,
          })), null, 2);
        }
      } else if (tc.function.name === 'invoke_skill') {
        const { skillId, task, enterpriseId: skillEntId } = args as { skillId?: string; task?: string; enterpriseId?: string };
        if (!skillId || !task) {
          toolResult = '错误：缺少 skillId 或 task 参数。';
        } else {
          const skill = (await listSkillSummaries()).find((s) => s.id === skillId);
          if (!skill) {
            toolResult = `错误：未找到技能「${skillId}」。请先用 list_skills 查看可用技能。`;
          } else {
            sendSSE({
              type: 'agent_message',
              data: {
                agentRole: receptionist.role,
                content: (assistantFull || `好的，正在调用「${skill.name}」技能执行任务。`) +
                  `\n\n*技能执行员开始工作…*`,
              },
            });
            try {
              const skillRecord = await runSkill({
                skillId,
                task,
                enterpriseId: skillEntId,
                projectId: projectId || null,
                conversationId: convId,
                sendSSE,
                signal,
              });
              // 技能过程落库，刷新可还原
              appendAgentMessages(convId, [{
                agentRole: 'skill_executor',
                agentName: '技能执行员',
                content: skillRecord.result,
                reasoningContent: skillRecord.reasoningContent,
                toolCalls: skillRecord.toolCalls,
                skillMeta: skillRecord.skillMeta,
              }]);
              const guide = buildSkillDoneGuide(skillRecord);
              const closingFull = (assistantFull ? assistantFull + '\n\n' : '') + guide;
              sendSSE({ type: 'agent_start', data: { agentName: receptionist.name, agentRole: receptionist.role } });
              sendSSE({ type: 'agent_message', data: { agentRole: receptionist.role, content: closingFull } });
              finalAnswer = closingFull;
              assessmentDone = true;
            } catch (e) {
              if (e instanceof AbortedError) throw e;
              toolResult = `技能执行出错：${e instanceof Error ? e.message : String(e)}`;
            }
          }
        }
        if (assessmentDone) break;
      } else if (tc.function.name === 'start_assessment') {
        const enterpriseId = args.enterpriseId;
        if (!enterpriseId) {
          toolResult = '错误：缺少 enterpriseId。';
        } else {
          const ent = getEnterpriseList().find((e) => e.id === enterpriseId);
          sendSSE({
            type: 'agent_message',
            data: {
              agentRole: receptionist.role,
              content: (assistantFull || `好的，正在对「${ent?.name || enterpriseId}」启动三角色智能评估。`) +
                '\n\n*调查员、审查官、决策官开始工作，请稍候…*',
            },
          });
          try {
            const { decision } = await runAssessment({
              enterpriseId,
              sendSSE,
              signal,
              projectId,
              conversationId: convId,
            });
            if (decision) {
              // 决策卡是权威结论，不再调接待员转述；用固定引导语收尾
              const guide =
                '评估已完成，结论见上方决策卡。如需了解某项原因的细节或评估其他企业，可直接在下方追问。';
              const closingFull = (assistantFull ? assistantFull + '\n\n' : '') + guide;
              sendSSE({
                type: 'agent_start',
                data: { agentName: receptionist.name, agentRole: receptionist.role },
              });
              sendSSE({
                type: 'agent_message',
                data: { agentRole: receptionist.role, content: closingFull },
              });
              finalAnswer = closingFull;
              assessmentDone = true;
            } else {
              toolResult = '评估已中断或未产生结论。';
            }
          } catch (e) {
            if (e instanceof AbortedError) throw e;
            toolResult = `评估出错：${e instanceof Error ? e.message : String(e)}`;
          }
          if (assessmentDone) break;
        }
      } else if (tc.function.name.startsWith('mcp__')) {
        // MCP 外部工具调用，路由到 executeTool
        const mcpCtx = { projectId: projectId || null, conversationId: convId };
        toolResult = await executeTool(tc.function.name, args, mcpCtx);
      } else {
        toolResult = `未知工具：${tc.function.name}`;
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
    }

    if (assessmentDone) break;
  }

  if (!finalAnswer) {
    finalAnswer = '抱歉，我暂时无法处理这个请求。';
    sendSSE({ type: 'agent_message', data: { agentRole: receptionist.role, content: finalAnswer } });
  }

  appendMessage(convId, 'assistant', finalAnswer, [], {
    agentRole: 'receptionist',
    agentName: receptionist.name,
    reasoningContent: reasoningFull.trim() || undefined,
  });
  // ProtoForge：把本轮沉淀的需求 id 记到最新 assistant 消息上（刷新后可还原卡片）
  const touchedReqIds = [...new Set([...createdReqIds, ...revisedReqIds])];
  if (touchedReqIds.length > 0) {
    setLatestAssistantReqIds(convId, touchedReqIds);
  }
  if (createdDecisionIds.length > 0) {
    setLatestAssistantDecisionIds(convId, [...new Set(createdDecisionIds)]);
  }
  if (createdPoolIds.length > 0) {
    setLatestAssistantPoolIds(convId, [...new Set(createdPoolIds)]);
  }
  // ContentForge：把本轮沉淀/更新的文章 id 记到最新 assistant 消息（刷新还原卡片）
  if (touchedArticleIds.length > 0) {
    setLatestAssistantArticleIds(convId, [...new Set(touchedArticleIds)]);
  }
  // 异步检查是否需要压缩早期对话（不阻塞响应）
  maybeSummarizeAsync(convId);
  sendSSE({ type: 'done', data: { projectId: projectId || null, conversationId: convId, stage: 'complete' } });
  return { projectId: projectId || null, conversationId: convId };
}

export { listProjects };
