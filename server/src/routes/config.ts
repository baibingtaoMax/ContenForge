// ============================================
// 模型配置路由
// ============================================

import type { FastifyInstance } from 'fastify';
import { getMaskedConfig, updateLLMConfig, getConfig } from '../config/index.js';
import { countMemoryChunks, clearMemoryChunks } from '../store/database.js';

export async function configRoutes(app: FastifyInstance) {
  // 获取模型配置（脱敏），附带向量记忆条数
  app.get('/api/config/models', async () => {
    return { ...getMaskedConfig(), memoryChunkCount: countMemoryChunks() };
  });

  // 更新模型配置
  app.put<{
    Body: { baseUrl?: string; apiKey?: string; model?: string; embeddingModel?: string };
  }>('/api/config/models', async (request, reply) => {
    const { baseUrl, apiKey, model, embeddingModel } = request.body || {};

    // 如果 apiKey 是脱敏后的值（包含 ****），说明前端没改 key，不传
    const updates: { baseUrl?: string; apiKey?: string; model?: string; embeddingModel?: string } = {};
    if (baseUrl) updates.baseUrl = baseUrl;
    if (apiKey && !apiKey.includes('****')) updates.apiKey = apiKey;
    if (model) updates.model = model;
    if (embeddingModel && embeddingModel.trim()) updates.embeddingModel = embeddingModel.trim();

    if (Object.keys(updates).length === 0) {
      return reply.status(400).send({ error: '没有需要更新的配置' });
    }

    // 检测向量模型是否变更（用于前端提示重建记忆库）
    const embChanged =
      !!updates.embeddingModel &&
      updates.embeddingModel !== getConfig().llm.embeddingModel;

    const newConfig = updateLLMConfig(updates);
    return {
      message: '配置已更新',
      config: {
        baseUrl: newConfig.llm.baseUrl,
        model: newConfig.llm.model,
        embeddingModel: newConfig.llm.embeddingModel,
      },
      // 向量模型变了且库里有旧向量 → 提示前端需要清空重建（维度可能不匹配）
      embeddingModelChanged: embChanged,
      memoryChunkCount: countMemoryChunks(),
    };
  });

  // 清空向量记忆（切换 embedding 模型后维度不匹配，需重建；原始对话/附件不受影响）
  app.post('/api/config/memory/rebuild', async () => {
    const removed = clearMemoryChunks();
    return { ok: true, removed };
  });
}
