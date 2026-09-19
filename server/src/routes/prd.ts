// PRD 导出：前端组装好完整 HTML，后端用本机 Chrome 无头打印为矢量 PDF。
import type { FastifyInstance } from 'fastify';
import { renderHtmlToPdf, findChrome } from '../services/pdfRender.js';

export async function prdRoutes(app: FastifyInstance) {
  // GET  能力探测：本机是否可用（前端可据此提示）
  app.get('/api/prd/pdf-capability', async () => ({
    pdfAvailable: !!findChrome(),
  }));

  // POST /api/prd/export-pdf  body: { html: string, fileName?: string }
  app.post('/api/prd/export-pdf', async (request, reply) => {
    const body = (request.body || {}) as { html?: string; fileName?: string };
    if (!body.html || typeof body.html !== 'string' || body.html.length < 50) {
      return reply.status(400).send({ error: '缺少 html 内容' });
    }
    // 只接受完整 HTML 文档
    if (!/<html[\s>]/i.test(body.html) || !/<!doctype html/i.test(body.html)) {
      return reply.status(400).send({ error: 'html 必须是完整文档' });
    }

    try {
      const { pdf } = await renderHtmlToPdf(body.html);
      const safeName = (body.fileName || 'PRD').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
      reply.header('Content-Type', 'application/pdf');
      reply.header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.pdf`,
      );
      return reply.send(pdf);
    } catch (err) {
      request.log.error(err, 'PDF 渲染失败');
      return reply.status(500).send({ error: (err as Error).message || 'PDF 渲染失败' });
    }
  });
}
