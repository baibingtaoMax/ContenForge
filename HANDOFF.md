# HANDOFF · ContentForge 在家接手说明

> 写给在家换机器继续开发的人（或未来的自己）。读完这份 + [README.md](./README.md) 能把项目跑起来、改得动、知道下一步做什么。
> 最后更新：2026-09-19。

---

## 0. 一句话现状

内容运营工作台，主链路已闭环并**真实端到端跑通过**：挂写作规范包 → 一句话让"内容搭档"铺双线选题 → 挑一篇写成定稿 → 一键并发适配公众号/小红书/掘金知乎 → 发布回填数据。当前是**本地单机开发态**（SQLite + 两个 dev server），未做生产部署。

---

## 1. 在家把它跑起来（10 分钟）

### 前置

- Node.js **≥ 22.5**（用内置 `node:sqlite`；本机开发版本 v24.18，建议 23/24）。用 nvm 装。
- pnpm：`npm i -g pnpm`
- 一个**火山引擎方舟** API Key（OpenAI 兼容网关；换别家兼容服务也行，改两个环境变量）。

### 步骤

```bash
git clone https://github.com/baibingtaoMax/ContenForge.git ContentForge
cd ContentForge/server && pnpm install
cd ../client && pnpm install

cd ../server
cp .env.example .env
# 编辑 .env，至少填 ARK_API_KEY

# 终端 1
cd server && pnpm dev          # 后端 http://localhost:3200 （tsx watch 热重载）
# 终端 2
cd client && pnpm dev          # 前端 http://localhost:5175
```

浏览器开 **http://localhost:5175**。

注意端口（README 旧版曾写成 3100/5174，**实际是后端 3200、前端 5175**）：
- 后端端口由 `server/.env` 的 `PORT` 决定，代码默认值也是 3200（`src/config/index.ts`）。
- 前端 5175，`client/vite.config.ts` 把 `/api` 反代到 `http://localhost:3200`，SSE 关了缓冲。

### 首次启动会发生什么

- `server/data/contentforge.db` 自动创建、所有表 `CREATE TABLE IF NOT EXISTS` 自动建（schema 在 `src/store/database.ts`，用 `ensureColumn` 做增量加列，老库不丢数据）。
- `seedBuiltinKits()` 播种内置写作规范包「有点真知写作法」（`is_builtin=1`，只读模板）。
- 数据库和 `.env` **不入库**（.gitignore 已忽略），换机器后是一个空库，需要自己建主体/重新挂规范包。内置模板会自动有。

### 自检它确实在工作

1. 左侧新建一个推广主体，进「主体档案 → 写作规范」挂上内置模板。
2. 在对话里发："铺 4 个选题，标题按你的规范起，沉淀到内容计划"。
3. 约 1–2 分钟后左侧/卡片出现选题；挑一篇说"写成主稿定稿"，约 2–3 分钟出稿。
4. 文章详情里点适配三渠道，约 3–5 分钟（**并发**，取最慢渠道）出三个版本。

---

## 2. 整体架构

```
浏览器 (Vue3 SPA, :5175)
  └─ /api, /api/chat (SSE) ──vite proxy──► Fastify (:3200)
                                              ├─ orchestrator/chat.ts   多智能体对话主编排
                                              │    └─ agents/contentAdvisor.ts  ★内容搭档（当前主 agent）
                                              │         └─ tools/  LLM function-calling 工具
                                              ├─ routes/*.ts            REST（content.ts 是内容主线）
                                              ├─ services/              channelAdapter / memory / embedding…
                                              └─ store/ (node:sqlite)   data/contentforge.db
```

- 后端是**从通用工作台壳改造**来的，所以 `agents/`、`routes/`、`services/` 里有大量 ProtoForge/RiskAgent 时期的遗留模块（需求、原型、决策、周报、MCP、站外标注…）。**当前产品主入口已经收敛到内容运营**：`orchestrator/chat.ts` 直接把 `contentAdvisor` 当 receptionist 用（见该文件 `import { contentAdvisor as receptionist }`）。改东西时认准下面"内容主线代码地图"，遗留模块没被 UI 主路径引用的可以先无视。
- LLM 走 OpenAI 兼容 SDK，function-calling 工具结果回灌，SSE 流式吐思考过程/工具调用/正文。

---

## 3. 内容主线 · 代码地图（改这里）

### 后端

| 关注点 | 文件 |
| --- | --- |
| 内容搭档的 system prompt + **全部 LLM 工具定义** | `server/src/agents/contentAdvisor.ts` |
| 对话主编排、主体档案上下文注入、工具执行 | `server/src/orchestrator/chat.ts`（搜 `buildProjectContext` / `subject`） |
| 内容台账 + 规范包 REST 路由 | `server/src/routes/content.ts` |
| **三渠道适配**（渠道规格/prompt/署名挂载/落库） | `server/src/services/channelAdapter.ts` |
| 内容业务数据读写（系列/文章/渠道/发布） | `server/src/store/contentStore.ts` |
| 规范包读写 | `server/src/store/writingKitStore.ts` |
| **内置「有点真知」模板全文** | `server/src/store/writingKitBuiltins.ts` |
| 所有建表/加列 | `server/src/store/database.ts`（`cf_*` 表集中在文件中段） |

内容搭档的 LLM 工具（在 contentAdvisor.ts，改 prompt 行为时看这里）：
`list_content`（台账+可用内容线）、`save_subject_profile`（主体档案）、`propose_article`（单篇选题/成稿）、`batch_topics`（批量铺选题）、`update_article`（改稿/定稿/改归线）、`adapt_channels`（适配渠道）、`record_publish`（回填发布链接+数据）。

### 前端

| 关注点 | 文件（`client/src/components/`） |
| --- | --- |
| 主体档案面板（含「主体档案/写作规范」Tab） | `SubjectPanel.vue` |
| 写作规范包列表/挂载/5-Tab 编辑 | `WritingKitPanel.vue` |
| 规范单块 MD 编辑 + 导入 .md/.txt | `WritingKitMdBlock.vue` |
| 内容计划台账（系列/文章列表） | `ContentPlanPanel.vue` |
| 文章卡片 / 文章详情（含内容线下拉） | `ArticleCard.vue` / `ArticleDetail.vue` |
| 三渠道版本 Tab | `ChannelVersionPane.vue` |
| 发布回填（views/赞/评/藏/转） | `PublishPanel.vue` |
| 主工作台 | `client/src/views/ChatView.vue`；后端接口封装 `client/src/api/index.ts` |

### REST 端点（`content.ts`，全 `/api` 前缀）

- 主体档案：`GET/PUT /projects/:projectId/subject`
- 挂载规范包：`POST /projects/:projectId/mount-kit`（body `{kitId}`）
- 系列：`GET/POST /projects/:projectId/series`，`PUT/DELETE /series/:sid`
- 文章：`GET/POST /projects/:projectId/articles`，`POST /projects/:projectId/articles/batch`，`GET/PUT/DELETE /articles/:aid`
- 渠道版本：`GET /articles/:aid/channels`，`GET /articles/:aid/channels/:channel`，`POST /articles/:aid/adapt`（body `{channels:['wechat','xhs','markdown'], requirement?}`）
- 发布：`GET/POST /projects/:projectId/publishes`，`PUT/DELETE /publishes/:pid`
- 规范包：`GET /writing-kits`，`POST /writing-kits`，`GET/PUT/DELETE /writing-kits/:kid`，`POST /writing-kits/:kid/duplicate`

> 坑：REST body 用**驼峰**（`docMd`、`contentLine`），不是数据库里的下划线（`doc_md`）。用 curl 调试时发下划线会被静默忽略（这次排查踩过）。

---

## 4. 数据模型（内容部分）

SQLite，库文件 `server/data/contentforge.db`（不入库）。内容相关 5 张表 + 2 个加列：

- `cf_series`：系列（id, project_id, title, description, sort_order）。
- `cf_articles`：文章（id, project_id, series_id?, **title, angle, doc_md, status**, sort_order, 来源会话…）。
  - `status`：`topic` 选题 / `writing` 写作中 / `final` 定稿。
  - `content_line` TEXT（后加列）：内容线 key，如 `classic` / `practice`，空串=不分线。
- `cf_channel_versions`：一文多渠道版（**UNIQUE(article_id, channel)**，重复适配是 upsert 覆盖）。`channel ∈ wechat|xhs|markdown`；`extra_json` 存小红书的 titleCandidates/tags/coverText。
- `cf_publishes`：发布记录，`metrics_json` 里是 `{views, likes, comments, collects, shares}`（阅读/赞/评/藏/**转发**）。
- `cf_writing_kits`：写作规范包。五块 MD：`positioning_md` / `writing_md` / `title_md` / `spread_md`，加 `signoff`（文末署名模板）、`content_lines_json`（`[{key,label,source,focus}]`）、`is_builtin`。
- `projects.kit_id`（后加列）：主体挂载的规范包 id。

通用壳的表（projects / conversations / messages / requirements / memory_chunks / mcp_* / decisions / prototypes / annotations…）也都在同一个库，内容功能没删它们，并存。

---

## 5. 写作规范包机制（一期的核心，重点理解）

**为什么独立成表而不是写进主体档案或塞附件**：附件不保证每轮被读、渠道适配链路也绕过附件；只有结构化、每次必注入的字段才能当"法律"。

注入链路（改规范生效逻辑时认这两处）：
1. **写稿/对话**：`orchestrator/chat.ts` 的 `buildProjectContext` 把挂载规范包的四块 MD 全文 + 最高优先级声明塞进内容搭档上下文；搭档的 propose/update/batch 工具都带 `content_line` 参数，`list_content` 回传可用线 key。
2. **渠道适配**：`channelAdapter.ts` 的 `buildKitAdaptRules(kit, channel)` 带标题工程+语言规范+账号定位；`signoff` 非空时在 **wechat/markdown** 版文末自动补署名（先用正文前 12 字判重，模型已自带就不重复挂）；**xhs 不带署名**（走话题标签）。

内置模板「有点真知写作法」关键工艺（全文在 `writingKitBuiltins.ts`，要调方法论改这里并注意 `is_builtin` 只读）：
- 单号双线：经典线 classic（向好书/老智慧取真知）、实战线 practice（自己做产品/生意的真实踩坑）。
- 语言：约 60% 说理 + 40% 画面；**情绪共鸣型不用"你"**——注意边界：禁的是叙述者对读者说教的"你"，**人物对话/台词引号内的"你"允许**（成稿实测如此）。
- 标题"四把尺子"：反差、戳体感等；不允许"某某话题"占位名。
- 传播反馈三维度：转发（共鸣/价值认同，第一指标）、评论（表达欲）、点赞（轻认可）。
- 署名模板：`——「有点真知」/ 不追热点，不灌鸡汤。向经典取真知，向实战取真章。`

前端编辑：主体档案面板有「主体档案 / 写作规范」Tab；规范包支持直接粘贴或**导入 .md/.txt**；内置只读，可"复制为我的规范包"后改。

---

## 6. 已验证的事实 & 踩过的坑（省你时间）

**性能（不是 bug，是模型特性）**
- 默认模型 `ark-code-latest` 非流式生成长文很慢：最小连通探针 2.5s，但生成 800 字小红书约 **110s**、2000+ 字主稿/公众号约 **200–300s**。
- 做过对照测速：prompt 里**不注入**规范 74s，注入 6000 字规范 68s——**规范注入几乎零额外开销**，慢在模型本身，别往规范包头上赖。
- 三渠道适配服务端是 `Promise.allSettled` **并发**，单渠道失败不拖垮其它；前端适配请求超时 300s。要更快：换更快的模型，或把适配改成流式。
- 用命令行 `curl` 长连接测适配时，本地 exec 会话可能被回收导致 curl 中断（HTTP 000），但**服务端生成协程不受影响、会跑完落库**——以 `GET /articles/:id/channels` 查到为准，别误判成失败。

**前端的坑（修过）**
- Tab 用 lazy 渲染时，父组件 `onMounted` 拿不到子组件 ref → 让子组件自己 `getSubject` 读挂载状态，别依赖父传 ref。
- 窄窗口下 `.ad-head/.head` 按钮会把长标题挤成竖排 → flex 容器加 `flex-wrap + gap`，按钮 `white-space:nowrap`。
- 搭档**流式生成中输入框是锁定的**，此时程序化 set value+send 会把消息吞掉（人正常等它说完不会撞）。要支持"连发指令排队"得加输入态处理。

**环境/构建**
- Node 一定 ≥22.5，否则 `node:sqlite` 没有。
- `pnpm-workspace.yaml` 里锁了 `pdfjs-dist: 5.6.205`（pdf 渲染依赖的兼容版本，别随手升）。
- 富文本复制到非安全上下文（http 且非 localhost）会降级成纯文本，代码里已有兜底。

---

## 7. 下一步（已和需求方对齐的二三期）

**二期 · 规范从"提示约束"升级为"硬校验"**
- 结构化硬规则（禁用词、人称"你"的叙述层检测）+ AI 成稿自检清单逐条核对。规划接口 `POST /articles/:id/review`，返回每条规则通过/违背与证据。
- 文章加"传播目标"字段（主攻 转发 / 评论 / 点赞），适配和标题按目标侧重。

**三期 · 数据复盘闭环**
- `record_publish` 回填后，按三维度算转发率/评论率/点赞率（`shares` 等字段一期已就位），让搭档给复盘 + 后续选题建议。
- 范例库 few-shot：把运营者的 18 篇成稿 + 素材拆解放项目附件，写稿时按需检索引用。

**工程化（还没做）**
- 生产部署：域名、HTTPS、进程管理（pmtool/launchd/systemd）、SQLite 备份。公众号/小红书编辑器的实际粘贴兼容性（尤其富文本）还没在真实平台测过。

---

## 8. 安全 & 提交注意

- **绝不提交 `server/.env`、`server/.env.bak.*`、`server/data/`（含 db/db-wal/db-shm）**。.gitignore 已覆盖；提交前用 `git status` / 检查暂存区确认没有密钥和库文件。
- 源码里没有硬编码长密钥（已 grep 过 `sk-…` / `ark-…`）；密钥只从 `.env` 读。
- `.env.example` 只放假 key 占位。
- 运行时数据（所有人的主体/成稿）都在本地 SQLite，不进 Git，换机器是空库。

---

## 9. 这次仓库初始化做了什么

- 项目原本**不是** git 仓库，本次首次 `git init` 并推送为仓库首个提交。
- 重写了根 `README.md`（原内容还是 ProtoForge、端口也错）。
- 新增本文件 `HANDOFF.md`。
- `server/.env.example` 的端口默认值与实际对齐（3200）。
- 未改动任何业务源码逻辑。
