// ============================================
// Embedding 服务（火山方舟 doubao-embedding-vision，OpenAI 兼容）
// - 单条/批量文本转向量
// - 向量以 Float32Array 内存表示，存盘时转 Buffer
// ============================================

import OpenAI from 'openai';
import { getConfig } from '../config/index.js';

/** 默认向量模型（配置未填时回落） */
const DEFAULT_EMBEDDING_MODEL = 'doubao-embedding-vision';
/** 当前生效的向量模型名（读配置；换平台在模型设置里改） */
function embeddingModel(): string {
  return getConfig().llm.embeddingModel || DEFAULT_EMBEDDING_MODEL;
}
const BATCH_SIZE = 16;

let _client: OpenAI | null = null;
let _clientSig = '';
function client(): OpenAI {
  const cfg = getConfig();
  // 用 baseUrl+apiKey 做签名：配置（模型设置里改 key/网关）变化后重建 client，
  // 避免进程早期用旧 key 建的 client 被缓存住、一直用错账号。
  const sig = `${cfg.llm.baseUrl}|${cfg.llm.apiKey}`;
  if (!_client || _clientSig !== sig) {
    _client = new OpenAI({ apiKey: cfg.llm.apiKey, baseURL: cfg.llm.baseUrl });
    _clientSig = sig;
  }
  return _client;
}

/** 单条文本转向量 */
export async function embedText(text: string): Promise<Float32Array> {
  const [v] = await embedBatch([text]);
  return v;
}

/** 批量转向量（自动分批） */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.trim() || ' ');
    const resp = await client().embeddings.create({
      model: embeddingModel(),
      input: batch as any,
    });
    // 返回顺序与 input 一致
    const sorted = resp.data.sort((a, b) => a.index - b.index);
    for (const d of sorted) out.push(new Float32Array(d.embedding));
  }
  return out;
}

/** Float32Array -> Buffer（存盘） */
export function f32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/** Buffer -> Float32Array（读取） */
export function bufferToF32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** 余弦相似度 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
