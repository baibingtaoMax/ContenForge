// ============================================
// 对话上下文压缩：渐进式摘要
// - 早期 user/assistant 消息用 LLM 压缩成摘要
// - 最近 KEEP_RECENT 轮保留原文
// - 每次助手回复后异步检查是否需要新增摘要
// ============================================

import OpenAI from 'openai';
import { getConfig, getModelForRole } from '../config/index.js';
import {
  getMessages,
  getConversationSummary,
  updateConversationSummary,
  getConversation,
  getRequirement,
} from '../store/database.js';
import { saveMemories } from './memory.js';
import type { MessageRow } from '../types/index.js';

/** 保留最近多少条 user/assistant 消息不压缩（按消息条数，不是轮数） */
const KEEP_RECENT = 12;
/** 累计超过这么多条未摘要消息时，触发一次压缩 */
const SUMMARY_TRIGGER = KEEP_RECENT + 6;

const SUMMARY_PROMPT = `你是一个需求讨论的摘要助手。请把 PM 与需求搭档的对话压缩，并提取可长期记忆的信息。

严格输出以下 JSON 格式（不要输出其他内容）：
{
  "summary": "简洁摘要，不超过300字，用中文第三人称叙述，保留：在做什么系统/产品、已聊清楚的模块和页面、已确认的字段/业务规则/流程、待 PM 拍板的决策点、参考的竞品或材料。如果已有摘要，把新内容合并进去。",
  "memories": [
    {"content": "跨对话仍有价值的持久事实或业务规则，一条一条写", "type": "rule"}
  ]
}

记忆提取规则：
- fact：具体事实（项目背景、要做的系统、参考的竞品/材料、已确认的数据、用户偏好）
- rule：业务规则、字段口径、流程定义、权限差异（如“台账状态只有待提交/待审核/已通过/已驳回”）
- 只提取跨对话仍有价值的持久信息，不提取“好的”“收到”等过程性内容
- 不提取当前对话就能回答的临时信息
- 如果没有值得记忆的内容，memories 返回空数组
- 不要编造对话中没有的信息`;

interface SummaryState {
  summary: string;
  lastSummaryMsgId: number;
}

/**
 * 构造进给接待员的上下文消息：摘要 + 最近消息
 */
export function buildCompressedHistory(
  convId: string,
  opts: { keepRecent?: number } = {},
): { messages: Array<{ role: 'user' | 'assistant'; content: string }>; summarySystem: string | null } {
  const keep = Math.max(2, opts.keepRecent ?? KEEP_RECENT);
  const all = getMessages(convId).filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  );

  const { summary, lastSummaryMsgId } = getConversationSummary(convId);

  // 未摘要的消息（id > lastSummaryMsgId）
  const unsummarized = all.filter((m) => m.id > lastSummaryMsgId);

  // 如果未摘要消息不多，全部保留原文
  if (unsummarized.length <= keep) {
    return {
      summarySystem: summary ? `【之前对话摘要】\n${summary}` : null,
      messages: unsummarized.map(formatMsg),
    };
  }

  // 否则：摘要 + 最近 keep 条
  const recent = unsummarized.slice(-keep);
  return {
    summarySystem: summary ? `【之前对话摘要】\n${summary}` : null,
    messages: recent.map(formatMsg),
  };
}

function formatMsg(m: MessageRow): { role: 'user' | 'assistant'; content: string } {
  let content = m.content;
  // user 消息带附件时追加提示
  if (m.role === 'user' && m.attachments) {
    try {
      const atts = JSON.parse(m.attachments);
      if (Array.isArray(atts) && atts.length > 0) {
        const names = atts.map((a: any) => a.filename).filter(Boolean).join('、');
        const webCount = atts.filter((a: any) => a.category === 'webpage' || a.sourceUrl).length;
        let hint = `\n\n[本条消息附带了${atts.length}个附件：${names}。如需查看附件内容，请调用 list_project_attachments 获取附件 ID，再用 read_attachment 读取。]`;
        if (webCount > 0) {
          hint += `（其中${webCount}个是网页链接快照，正文已抓取好，直接用 read_attachment 即可读到网页全文，不用再自己联网打开。）`;
        }
        content += hint;
      }
    } catch { /* ignore */ }
  }
  // user 消息 @ 了需求：提示模型当时聚焦的模块/页面（仅标题，不含全文，避免历史肨胀）
  if (m.role === 'user') {
    try {
      const refRaw = (m as any).ref_requirements;
      if (refRaw) {
        const ids = JSON.parse(refRaw) as Array<{ id?: string } | string>;
        const titles = ids
          .map((r) => (typeof r === 'string' ? getRequirement(r) : r?.id ? getRequirement(r.id) : null))
          .filter(Boolean)
          .map((r: any) => `${r.kind === 'page' ? '页面' : '模块'}《${r.title}》`);
        if (titles.length > 0) {
          content += `\n\n[本条消息 @ 聚焦了：${titles.join('、')}。需要这些需求的完整文档时用 list_project_requirements 获取。]`;
        }
      }
    } catch { /* ignore */ }
  }
  return { role: m.role as 'user' | 'assistant', content };
}

/**
 * 异步检查是否需要压缩，如果需要就执行摘要更新。
 * 在接待员回复完成后调用，不阻塞响应。
 */
export function maybeSummarizeAsync(convId: string): void {
  // 不 await，后台跑
  void maybeSummarize(convId).catch((e) => {
    console.error('[summary] 压缩失败:', e);
  });
}

async function maybeSummarize(convId: string): Promise<void> {
  const all = getMessages(convId).filter(
    (m) => m.role === 'user' || m.role === 'assistant'
  );
  if (all.length === 0) return;

  const { summary: existingSummary, lastSummaryMsgId } = getConversationSummary(convId);
  const unsummarized = all.filter((m) => m.id > lastSummaryMsgId);

  // 未摘要消息不够多，不触发
  if (unsummarized.length < SUMMARY_TRIGGER) return;

  // 需要新摘要的消息：除了最近 KEEP_RECENT 条，其余全压
  const toSummarize = unsummarized.slice(0, unsummarized.length - KEEP_RECENT);
  if (toSummarize.length === 0) return;

  const lastMsgId = toSummarize[toSummarize.length - 1].id;

  const cfg = getConfig();
  const model = getModelForRole('receptionist');
  const client = new OpenAI({
    apiKey: cfg.llm.apiKey,
    baseURL: cfg.llm.baseUrl,
  });

  const conversationText = toSummarize
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n\n');

  const userContent = existingSummary
    ? `【已有摘要】\n${existingSummary}\n\n【以下是需要合并的新对话内容】\n${conversationText}\n\n请把新内容合并到已有摘要中，输出更新后的完整摘要。`
    : `【对话内容】\n${conversationText}`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: userContent },
    ],
  });

  const raw = resp.choices[0]?.message?.content?.trim() || '';
  let newSummary = '';
  let extractedMemories: Array<{ content: string; type: string }> = [];
  try {
    const parsed = JSON.parse(raw);
    newSummary = (parsed.summary || '').trim();
    if (Array.isArray(parsed.memories)) {
      extractedMemories = parsed.memories
        .filter((m: any) => m && typeof m.content === 'string' && m.content.trim())
        .map((m: any) => ({ content: m.content.trim(), type: m.type === 'rule' ? 'rule' : 'fact' }));
    }
  } catch {
    // 模型未按 JSON 输出，降级为纯文本摘要
    newSummary = raw;
  }

  if (newSummary) {
    updateConversationSummary(convId, newSummary, lastMsgId);
    console.log(`[summary] 对话 ${convId} 已压缩到消息 #${lastMsgId}，摘要 ${newSummary.length} 字`);
  }

  // E 增量：摘要顺便抽出的事实/规则写入项目记忆（不增加额外 LLM 调用）
  if (extractedMemories.length > 0) {
    const conv = getConversation(convId);
    if (conv?.project_id) {
      await saveMemories(
        extractedMemories.map((m) => ({
          projectId: conv.project_id!,
          sourceType: 'extracted' as const,
          sourceId: `summary-${convId}-${lastMsgId}`,
          memoryType: (m.type === 'rule' ? 'rule' : 'fact') as 'rule' | 'fact',
          content: m.type === 'rule' ? `[业务规则] ${m.content}` : `[事实] ${m.content}`,
          metadata: { conversationId: convId, extractedAt: new Date().toISOString() },
        }))
      );
    }
  }
}
