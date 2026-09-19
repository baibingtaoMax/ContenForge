// ============================================
// 路由：AI 生成 / 调整 ECharts option（工具箱 Axure 图表生成器）
// ============================================

import type { FastifyInstance } from 'fastify';
import { generateChartOption, ChartAiError } from '../services/chartAi.js';

interface Body {
  prompt?: string;
  data?: string;
  /** 首轮不传；追问时带编辑器当前源码（可能含函数，无法 JSON 序列化） */
  currentSource?: string | null;
}

export async function chartAiRoutes(app: FastifyInstance) {
  app.post<{ Body: Body }>('/api/chart-ai/generate', async (request, reply) => {
    const b = request.body || {};
    const prompt = (b.prompt || '').trim();
    if (!prompt) {
      return reply.status(400).send({ error: '请描述要什么图表' });
    }
    try {
      const source = await generateChartOption({
        prompt,
        data: (b.data || '').trim() || undefined,
        currentSource: b.currentSource ?? null,
      });
      return { source };
    } catch (e) {
      const msg = e instanceof ChartAiError ? e.message
        : e instanceof Error ? e.message : 'AI 生成失败';
      request.log.error({ err: e }, 'chart-ai generate failed');
      return reply.status(500).send({ error: msg });
    }
  });
}
