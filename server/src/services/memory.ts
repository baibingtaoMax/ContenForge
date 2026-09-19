// ============================================
// 项目记忆服务：写入 / 向量检索 / FTS 兜底
// ============================================

import { randomUUID } from 'node:crypto';
import {
  insertMemoryChunks,
  listMemoryChunksWithEmbedding,
  listConversations,
  getMessages,
  memoryChunkExists,
} from '../store/database.js';
import {
  embedBatch,
  embedText,
  f32ToBuffer,
  bufferToF32,
  cosineSimilarity,
} from './embedding.js';
import type {
  MemoryChunkInput,
  MemorySearchResult,
  MemoryChunkRow,
} from '../types/index.js';

/** 写入一批记忆（自动批量算 embedding）。失败不抛错，只打日志，避免影响主流程。 */
export async function saveMemories(chunks: MemoryChunkInput[]): Promise<void> {
  if (chunks.length === 0) return;
  try {
    const embeddings = await embedBatch(chunks.map((c) => c.content));
    const rows = chunks.map((c, i) => ({
      ...c,
      id: randomUUID(),
      embedding: f32ToBuffer(embeddings[i]),
    }));
    insertMemoryChunks(rows);
  } catch (e) {
    console.error('[memory] 写入记忆失败:', e);
  }
}

/** 写入单条记忆 */
export async function saveMemory(chunk: MemoryChunkInput): Promise<void> {
  return saveMemories([chunk]);
}

/** 安全检查同一来源是否已存在记忆，避免重复写（评估重复触发场景） */
export async function saveMemoryOnce(chunk: MemoryChunkInput): Promise<void> {
  if (memoryChunkExists(chunk.projectId, chunk.sourceType, chunk.sourceId)) return;
  return saveMemory(chunk);
}

interface RawHit {
  row: MemoryChunkRow;
  score: number;
}

/**
 * 向量检索：query → embedding，项目内全表余弦相似度 Top-K。
 * 项目记忆量级预期 <1000 条，全表扫毫秒级，无需向量索引。
 */
function vectorSearch(
  projectId: string,
  queryVec: Float32Array,
  topK: number,
  typeFilter?: string
): RawHit[] {
  const rows = listMemoryChunksWithEmbedding(projectId);
  const hits: RawHit[] = [];
  for (const row of rows) {
    if (typeFilter && row.memory_type !== typeFilter) continue;
    if (!row.embedding) continue;
    const vec = bufferToF32(row.embedding as unknown as Buffer);
    const score = cosineSimilarity(queryVec, vec);
    hits.push({ row, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

/**
 * FTS 兜底：在项目内所有对话的原始消息里 LIKE 搜（消息量不大，LIKE 够用）。
 * 只搜 user / assistant / 评估完成后的 agent 消息，跳过 worker 碎念。
 */
function rawMessageFallback(
  projectId: string,
  query: string,
  topK: number
): Array<{ content: string; source: string; createdAt: string; score: number }> {
  const terms = query.trim().split(/\s+/).filter((t) => t.length >= 2);
  if (terms.length === 0) return [];

  // 项目内所有对话
  const convs = listConversations(projectId);
  const results: Array<{ content: string; source: string; createdAt: string; score: number }> = [];

  for (const conv of convs) {
    const msgs = getMessages(conv.id).filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        m.content &&
        m.content.trim().length > 0
    );
    for (const m of msgs) {
      const content = m.content;
      // 简单词频打分：每个词命中 +1，命中越多次分越高
      let score = 0;
      for (const term of terms) {
        const occurrences = content.split(term).length - 1;
        score += occurrences;
      }
      if (score > 0) {
        const preview = content.length > 300 ? content.slice(0, 300) + '…' : content;
        results.push({
          content: preview,
          source: `对话消息（${conv.title}）`,
          createdAt: m.created_at,
          score,
        });
      }
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

function parseMetadata(row: MemoryChunkRow): Record<string, unknown> {
  try {
    return JSON.parse(row.metadata);
  } catch {
    return {};
  }
}

const SOURCE_LABELS: Record<string, string> = {
  assessment: '评估结论',
  enterprise_profile: '企业档案',
  entity: '项目关系',
  attachment: '附件摘要',
  extracted: '对话提取',
  design_decision: '设计决策',
};

/**
 * 统一检索：向量召回记忆库 + FTS 兜底原始消息，合并去重。
 * 返回结果已是格式化文本，可直接作为 tool result 返回给 LLM。
 */
export async function searchProjectMemory(params: {
  projectId: string;
  query: string;
  topK?: number;
  type?: string;
}): Promise<MemorySearchResult[]> {
  const { projectId, query, topK = 6, type } = params;
  const q = query.trim();
  if (!q) return [];

  // 向量召回；embedding 服务不可用（订阅不含 embedding 模型/网络错误）时降级为纯关键词检索，
  // 不把错误甩给调用方（技能/顾问）——记忆检索是锦上添花，不该阻断主流程。
  const results: MemorySearchResult[] = [];
  try {
    const queryVec = await embedText(q);
    const vecHits = vectorSearch(projectId, queryVec, topK, type);
    for (const { row, score } of vecHits) {
      results.push({
        id: row.id,
        content: row.content,
        sourceType: row.source_type,
        memoryType: row.memory_type,
        metadata: parseMetadata(row),
        score,
        createdAt: row.created_at,
      });
    }
  } catch (e) {
    console.error('[memory] 向量检索失败，降级为关键词(FTS)检索:', e instanceof Error ? e.message : e);
  }

  // 如果向量结果不足，用 FTS 兜底补充
  if (results.length < topK) {
    const need = topK - results.length;
    const ftsHits = rawMessageFallback(projectId, q, need);
    for (const h of ftsHits) {
      results.push({
        id: `fts-${h.createdAt}`,
        content: h.content,
        sourceType: 'extracted',
        memoryType: 'fact',
        metadata: { source: h.source, fallback: true },
        score: h.score * 0.5, // FTS 命中权重低于向量
        createdAt: h.createdAt,
      });
    }
  }

  return results.slice(0, topK);
}

/** 把检索结果格式化成给 LLM 看的文本（tool result） */
export function formatSearchResults(results: MemorySearchResult[]): string {
  if (results.length === 0) return '未找到相关记忆。';
  return results
    .map((r, i) => {
      const label = SOURCE_LABELS[r.sourceType] || r.sourceType;
      const meta = r.metadata?.enterpriseName ? `（${r.metadata.enterpriseName}）` : '';
      return `[${i + 1}] ${label}${meta}\n${r.content}`;
    })
    .join('\n\n---\n\n');
}
