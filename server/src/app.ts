// ============================================
// Fastify 应用入口
// ============================================

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { initConfig, getConfig } from './config/index.js';
import { assessmentRoutes } from './routes/assessment.js';
import { configRoutes } from './routes/config.js';
import { attachmentRoutes } from './routes/attachments.js';
import { skillRoutes } from './routes/skills.js';
import { mcpRoutes } from './routes/mcp.js';
import { requirementRoutes } from './routes/requirements.js';
import { prototypeRoutes } from './routes/prototypes.js';
import { annotationRoutes } from './routes/annotations.js';
import { externalRoutes } from './routes/external.js';
import { prdRoutes } from './routes/prd.js';
import { decisionRoutes } from './routes/decisions.js';
import { weeklyReportRoutes } from './routes/weeklyReport.js';
import { chartAiRoutes } from './routes/chartAi.js';
import { contentRoutes } from './routes/content.js';
import { seedBuiltinKits } from './store/writingKitStore.js';
import { initMcpRegistry, closeAllMcpClients } from './mcp/registry.js';
import { refreshMcpTools } from './tools/index.js';

async function main() {
  // 初始化配置（含数据库）
  const config = initConfig();

  // 播种内置写作规范包模板（已存在则跳过）
  seedBuiltinKits();

  const app = Fastify({
    bodyLimit: 20 * 1024 * 1024, // PRD HTML 可能较大
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // CORS（开发阶段允许所有来源）
  await app.register(cors, {
    origin: true,
  });

  // 文件上传
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 1,
    },
  });

  // 注册路由
  await app.register(assessmentRoutes);
  await app.register(configRoutes);
  await app.register(attachmentRoutes);
  await app.register(skillRoutes);
  await app.register(mcpRoutes);
  await app.register(requirementRoutes);
  await app.register(prototypeRoutes);
  await app.register(annotationRoutes);
  await app.register(externalRoutes);
  await app.register(prdRoutes);
  await app.register(decisionRoutes);
  await app.register(weeklyReportRoutes);
  await app.register(chartAiRoutes);
  await app.register(contentRoutes);

  // 健康检查
  app.get('/api/health', async () => ({ status: 'ok' }));

  // SSE 长连接：关闭 Node 默认的请求/连接超时（默认 5 分钟会掐断长评估）
  // 必须在 listen() 之前设置
  app.server.requestTimeout = 0;
  app.server.keepAliveTimeout = 120_000;
  app.server.headersTimeout = 130_000;

  // 启动
  await app.listen({
    port: config.port,
    host: '0.0.0.0',
  });

  // 初始化 MCP 数据源连接（异步，不阻塞服务启动；单个失败不影响）
  refreshMcpTools();
  initMcpRegistry()
    .then(() => {
      refreshMcpTools();
      app.log.info('🔌 MCP 数据源初始化完成');
    })
    .catch((err) => app.log.warn({ err }, 'MCP 初始化异常'));

  // 进程退出时关闭 MCP 连接
  const shutdown = async () => {
    await closeAllMcpClients();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  app.log.info(`🚀 ContentForge 后端已启动: http://localhost:${config.port}`);
  app.log.info(`📊 当前模型: ${config.llm.model}`);
  app.log.info(`🔑 API Key: ${config.llm.apiKey ? '已配置' : '未配置'}`);
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
