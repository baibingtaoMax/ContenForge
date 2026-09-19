# ContentForge · 内容运营工作台

一个"内容搭档"驱动的自媒体内容生产工作台：陪你把一个推广主体（产品 / 公众号 / 个人 IP / 服务 / 社群）的内容，从**铺选题 → 聊角度写主稿 → 一键适配多渠道 → 发布回填 → 数据复盘**跑成闭环。

核心是一个可配置的**写作规范包（Writing Kit）**：把运营者沉淀的写作方法论（账号定位、语言规范、标题工程、传播框架、文末署名、内容线）做成可复用资产，挂到主体后**强制注入**写稿和渠道适配链路，而不是靠模型临场发挥。

> 技术壳由 ProtoForge / RiskAgentPlatform 的通用多智能体工作台改造而来，后端 Fastify + node:sqlite，前端 Vue3。

## 它能做什么

- **内容搭档对话**：自然语言下指令，搭档通过工具直接操作内容台账——铺选题、写/改主稿、适配渠道、登记发布，结果即时沉淀进数据库并以卡片回显。
- **写作规范包（一期核心）**
  - 一个规范包含五块：账号定位/内容线（`positioning`）、语言规范（`writing`）、标题工程（`title`）、传播/复盘框架（`spread`）、文末署名模板（`signoff`）。
  - 可建多个、跨主体复用；内置一份「有点真知写作法」模板（`is_builtin`，只读，可"复制为我的规范包"再改）。
  - 规范全文注入写稿上下文（最高优先级）；标题+语言+定位注入三渠道适配；署名在公众号 / 掘金知乎版自动挂文末，小红书版不带。
  - **内容线**：一个账号可定义多条内容线（如经典线 `classic` / 实战线 `practice`），文章归属到线，搭档铺选题时可自动归线。
- **内容计划台账**：系列（series）→ 文章（article，topic/writing/final 三态）→ 渠道版本（wechat/xhs/markdown）→ 发布记录（publish，含阅读/点赞/评论/**转发**数）。
- **三渠道一键适配**：同一篇主稿并发生成
  - **公众号**（1500–3000 字，富文本 Markdown，钩子开头、金句加粗、文末 CTA + 署名）
  - **小红书**（≤800 字，前 3 行抓人、emoji 分点、5–8 个话题标签，另出 3 个标题候选 + 封面文案，不带署名）
  - **掘金/知乎**（方法论向，背景→问题→方案→总结，第一人称自然带主体 + 署名）
- **推广主体档案**：类型、定位、受众、痛点、卖点、差异点、CTA、语气，写稿和适配都基于档案，不编造卖点数据。
- 继承自通用壳的能力：多话题对话、长对话渐进式摘要、项目记忆（向量+全文检索）、附件上传/解析、粘贴截图（视觉模型）、数据源 MCP、界面内模型配置。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Fastify 5 + TypeScript + node:sqlite + SSE，OpenAI 兼容 SDK |
| 前端 | Vue 3 + TypeScript + Vite + Pinia + Element Plus + Sass |
| LLM | 火山引擎方舟（OpenAI 兼容网关），可换任意 OpenAI 兼容服务 |
| 浏览器扩展 | 原生 JS MV3（`browser-extension/`，站外网页圈选标注回传，非主流程） |

## 快速开始

### 环境要求

- Node.js ≥ 22.5（内置 `node:sqlite`；推荐 23/24，本机实测 v24.18）
- pnpm（`npm i -g pnpm`）

### 1. 安装依赖

```bash
cd server && pnpm install
cd ../client && pnpm install
```

### 2. 配置环境变量

```bash
cd server
cp .env.example .env
```

编辑 `server/.env`，填方舟 API Key：

```ini
ARK_API_KEY=*** Key
# 网关/模型默认已指向火山方舟；换其他 OpenAI 兼容服务改 ARK_BASE_URL / ARK_MODEL
```

> 对话/向量/视觉模型也可启动后在界面「模型配置」里改（数据库配置优先于 `.env`）。

### 3. 启动（两个终端）

```bash
# 终端 1：后端（:3200，tsx watch 热重载）
cd server && pnpm dev

# 终端 2：前端（:5175）
cd client && pnpm dev
```

浏览器打开 **http://localhost:5175**。前端已把 `/api` 代理到后端 **3200**。

### 生产构建

```bash
cd server && pnpm build && pnpm start   # tsc 编译后跑 dist/app.js
cd client && pnpm build                 # 产物在 client/dist
```

## 说明

- **数据库**：SQLite，首次启动自动建表，文件 `server/data/contentforge.db`（已被 .gitignore 忽略，不入库）。
- **附件上传目录**也在 `server/data/` 下，运行时生成。
- **内置规范包播种**：服务启动时 `seedBuiltinKits()` 会确保内置「有点真知写作法」存在（只读模板）。
- **换向量模型**：向量绑定维度，换模型后需在「模型配置 → 向量模型」清空旧向量重建（记忆是派生数据，清空零损失，检索期有全文兜底）。
- **生成耗时**：当前默认模型（ark-code-latest 等）非流式生成长文较慢，单篇主稿 / 单个长文渠道约 1–3 分钟；三渠道适配是**并发**的，总耗时取决于最慢的一个。前端适配请求超时 300s。

### 环境变量（`server/.env`）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 后端端口 | 3200 |
| `ARK_BASE_URL` | OpenAI 兼容网关地址 | 火山方舟 coding 网关 |
| `ARK_API_KEY` | API Key（必填） | — |
| `ARK_MODEL` | 全局默认对话模型 | doubao-seed-2.0-pro |
| `ARK_MODEL_RECEPTIONIST` 等 | 按角色覆盖模型名（留空用全局） | — |
| `ARK_EMBEDDING_MODEL` | 向量模型（项目记忆检索） | doubao-embedding-vision |
| `ARK_MODEL_VISION` | 视觉模型（截图理解，留空回退 ARK_MODEL） | — |

## 目录结构

```
ContentForge/
├── server/
│   ├── src/
│   │   ├── agents/        # AI 角色：contentAdvisor=内容搭档（主编排 agent）
│   │   ├── orchestrator/  # 聊天编排 chat.ts、SSE hub、摘要、技能运行
│   │   ├── routes/        # Fastify 路由：content.ts=内容台账/规范包，其余为通用壳
│   │   ├── services/      # channelAdapter 三渠道适配、记忆、embedding、文件解析…
│   │   ├── skills/        # 技能加载与工具目录
│   │   ├── tools/         # AI 可调用工具定义
│   │   ├── mcp/           # 数据源 MCP 接入
│   │   └── store/         # SQLite：database(建表)/contentStore/writingKitStore/writingKitBuiltins
│   ├── skills/            # 各技能 SKILL.md（SOP 提示词）
│   └── .env.example
├── client/
│   └── src/
│       ├── views/         # ChatView 主工作台 + 技能/数据源/工具箱
│       ├── components/    # 内容相关：SubjectPanel/WritingKitPanel/ContentPlanPanel/
│       │                  #   ArticleCard/ArticleDetail/ChannelVersionPane/PublishPanel…
│       ├── stores/        # Pinia（chat 主 store）
│       ├── api/           # 后端接口封装
│       └── router/
├── browser-extension/     # 站外标注 MV3 扩展（独立辅助工具）
└── docs/                  # 设计文档
```

更详细的接手说明、代码地图、数据模型、二三期规划见 **[HANDOFF.md](./HANDOFF.md)**。
