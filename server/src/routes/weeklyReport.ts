// 需求变更周报：返回区间内确定性变更数据 + AI 综述（AI 失败降级，不阻断）
import type { FastifyInstance } from 'fastify';
import { buildWeeklyReport } from '../services/weeklyReport.js';
import { generateWeeklyOverview, type WeeklyAudience } from '../services/weeklySummary.js';

interface WeeklyBody {
  from?: string;
  to?: string;
  audience?: string;
}

function isValidIso(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s));
}

export async function weeklyReportRoutes(app: FastifyInstance) {
  app.post('/api/projects/:projectId/weekly-report', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = (request.body || {}) as WeeklyBody;

    if (!isValidIso(body.from) || !isValidIso(body.to)) {
      return reply.status(400).send({ error: '时间范围无效（需要 ISO 时间）' });
    }
    if (new Date(body.to) <= new Date(body.from)) {
      return reply.status(400).send({ error: '结束时间必须晚于开始时间' });
    }
    // 受众只有两个真实场景：老板（内部台账）/ 客户（交付汇报）；其他值一律回退 boss
    const audience: WeeklyAudience = body.audience === 'client' ? 'client' : 'boss';

    const report = buildWeeklyReport(projectId, { from: body.from, to: body.to });

    // AI 综述是皮，不是事实；任何失败都降级为纯数据，前端照常导出
    let overview = '';
    let overviewError: string | null = null;
    try {
      overview = await generateWeeklyOverview(report, audience);
    } catch (err) {
      overviewError = (err as Error).message || 'AI 综述生成失败';
      request.log.warn({ err: overviewError }, '周报 AI 综述降级');
    }

    return { ...report, audience, overview, overviewError };
  });
}
