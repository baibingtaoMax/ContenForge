// ============================================
// SQLite 数据库初始化和操作（Node 24 内置 node:sqlite）
// ============================================

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  AssessmentRow,
  AssessmentStatus,
  DecisionType,
  ModelConfigRow,
  RiskLevel,
  ProjectRow,
  ProjectEntityRow,
  ProjectEntityRole,
  ConversationRow,
  MessageRow,
  ArchiveAssessment,
  AttachmentRow,
  MemoryChunkRow,
  MemoryChunkInput,
} from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'contentforge.db');

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return db;
}

export function initDatabase(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS assessments (
      id TEXT PRIMARY KEY,
      enterprise_id TEXT NOT NULL,
      project_id TEXT,
      conversation_id TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      created_at TEXT NOT NULL,
      completed_at TEXT,
      decision TEXT,
      risk_level TEXT,
      reasons TEXT,
      suggestions TEXT,
      summary TEXT,
      full_log TEXT NOT NULL DEFAULT '[]'
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS model_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      model_name TEXT NOT NULL,
      embedding_model TEXT
    );
  `);
  // 迁移：向量模型名可配置
  ensureColumn(d, 'model_config', 'embedding_model', 'TEXT');

  // 项目（文件夹）
  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      archive TEXT NOT NULL DEFAULT '{"assessments":[],"keyFacts":[]}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // 项目企业成员（一个项目可含多家企业，各带角色）
  d.exec(`
    CREATE TABLE IF NOT EXISTS project_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      enterprise_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'related',
      created_at TEXT NOT NULL,
      UNIQUE(project_id, enterprise_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  // 对话（可游离：project_id 允许 NULL，表示未归档）
  d.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL DEFAULT '新对话',
      summary TEXT,
      last_summary_msg_id INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  // 迁移：旧库 project_id 为 NOT NULL，重建为可空
  migrateConversationsNullable(d);
  // 迁移：对话摘要（上下文压缩）
  ensureColumn(d, 'conversations', 'summary', 'TEXT');
  ensureColumn(d, 'conversations', 'last_summary_msg_id', 'INTEGER NOT NULL DEFAULT 0');

  // 消息
  d.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);
  // 迁移：旧表无 attachments 列
  ensureMessagesColumn(d, 'attachments', "TEXT NOT NULL DEFAULT '[]'");
  // 迁移：agent 过程持久化（调查员/worker/审查官/决策官气泡）
  ensureMessagesColumn(d, 'agent_role', 'TEXT');
  ensureMessagesColumn(d, 'agent_name', 'TEXT');
  ensureMessagesColumn(d, 'tool_calls', "TEXT DEFAULT '[]'");
  ensureMessagesColumn(d, 'review_feedback', 'TEXT');
  ensureMessagesColumn(d, 'decision', 'TEXT');
  ensureMessagesColumn(d, 'assessment_id', 'TEXT');
  ensureMessagesColumn(d, 'reasoning_content', 'TEXT');
  ensureMessagesColumn(d, 'skill_meta', 'TEXT');
  // ContentForge：本条消息选中的内容计划选题（文章）
  ensureMessagesColumn(d, 'ref_articles', "TEXT DEFAULT '[]'");
  d.exec(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);`);

  // ContentForge：projects 复用为「推广主体」，加类型与结构化档案
  ensureColumn(d, 'projects', 'subject_type', "TEXT NOT NULL DEFAULT 'product'"); // product|official_account|personal_ip|service|event|community|other
  ensureColumn(d, 'projects', 'profile_json', "TEXT NOT NULL DEFAULT '{}'"); // 推广主体档案（定位/用户/痛点/卖点/CTA 等）

  // 附件
  d.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      conversation_id TEXT,
      filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      summary TEXT NOT NULL DEFAULT '',
      extracted_text TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      uploader TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL
    );
  `);
  // 迁移：旧 attachments.project_id 为 NOT NULL，重建为可空；旧表补充 conversation_id
  migrateAttachmentsNullable(d);
  ensureColumn(d, 'assessments', 'conversation_id', 'TEXT');
  ensureColumn(d, 'attachments', 'conversation_id', 'TEXT');
  // 网页快照附件：原始链接
  ensureColumn(d, 'attachments', 'source_url', 'TEXT');
  // 注：annotations 的列迁移必须在该表 CREATE 之后（全新库否则 no such table），已挪到下方建表后

  // 记忆片段（项目级语义记忆）
  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      embedding BLOB,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_chunks(project_id, memory_type);`);

  // ============================================
  // 需求清单（ProtoForge：对话沉淀 + 手动新建）
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'module',
      parent_id TEXT,
      status TEXT NOT NULL DEFAULT 'proposed',
      doc_md TEXT NOT NULL DEFAULT '',
      source_conversation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_req_project ON requirements(project_id, updated_at DESC);`);
  // 模块/页面两层结构迁移（2026-09-03）：kind=module|page，page 挂在 module 下
  ensureColumn(d, 'requirements', 'kind', "TEXT NOT NULL DEFAULT 'module'");
  ensureColumn(d, 'requirements', 'parent_id', 'TEXT');
  // 需求池（2026-09-09）：kind='idea' 的缓冲条目，未成形为模块/页面
  ensureColumn(d, 'requirements', 'summary', "TEXT NOT NULL DEFAULT ''"); // 需求池一句话描述（idea 用，正式需求留空）
  ensureColumn(d, 'requirements', 'pool_status', "TEXT NOT NULL DEFAULT ''"); // raw 待澄清 | ready 可转需求 | shelved 搁置
  ensureColumn(d, 'requirements', 'urgent', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'requirements', 'important', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'requirements', 'related_module_id', 'TEXT'); // AI 猜的软关联模块（仅提示/过滤，转正时才变 parent_id）
  ensureColumn(d, 'requirements', 'proposer', "TEXT NOT NULL DEFAULT ''"); // 需求池：提出人（客户/同事/PM，自由文本）

  // ============================================
  // 需求文档版本（2026-09-10）：状态变更自动存 + 手动存，全留
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS requirement_versions (
      id TEXT PRIMARY KEY,
      requirement_id TEXT NOT NULL,
      version_no INTEGER NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      doc_md TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'proposed',
      trigger TEXT NOT NULL DEFAULT 'manual', -- create|status|manual|restore
      actor TEXT NOT NULL DEFAULT '',         -- user|ai:<工具名>|空
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_req_ver ON requirement_versions(requirement_id, version_no);`);

  // ============================================
  // ContentForge：内容系列（如「30篇冷启动系列」）
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS cf_series (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cf_series_project ON cf_series(project_id, sort_order);`);

  // ============================================
  // ContentForge：文章（选题 → 写作中 → 定稿 → 已发）
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS cf_articles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      series_id TEXT,
      title TEXT NOT NULL,
      angle TEXT NOT NULL DEFAULT '',
      doc_md TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'topic',
      sort_order INTEGER NOT NULL DEFAULT 0,
      source_conversation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (series_id) REFERENCES cf_series(id) ON DELETE SET NULL
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cf_articles_project ON cf_articles(project_id, updated_at DESC);`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cf_articles_series ON cf_articles(series_id, sort_order);`);

  // ============================================
  // ContentForge：渠道版本（一文多版：公众号/小红书/掘金知乎）
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS cf_channel_versions (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      extra_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(article_id, channel),
      FOREIGN KEY (article_id) REFERENCES cf_articles(id) ON DELETE CASCADE
    );
  `);

  // ============================================
  // ContentForge：发布记录（手动回填链接与数据）
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS cf_publishes (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      metrics_json TEXT NOT NULL DEFAULT '{}',
      note TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (article_id) REFERENCES cf_articles(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cf_pub_article ON cf_publishes(article_id);`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_cf_pub_project ON cf_publishes(project_id, created_at DESC);`);

  // ============================================
  // ContentForge：写作规范包（账号宪法/写作工艺/标题工程/传播框架 + 署名模板）
  // 独立于项目存在，主体通过 projects.kit_id 挂载；is_builtin=1 为内置模板。
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS cf_writing_kits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      positioning_md TEXT NOT NULL DEFAULT '',
      writing_md TEXT NOT NULL DEFAULT '',
      title_md TEXT NOT NULL DEFAULT '',
      spread_md TEXT NOT NULL DEFAULT '',
      signoff TEXT NOT NULL DEFAULT '',
      content_lines_json TEXT NOT NULL DEFAULT '[]',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn(d, 'projects', 'kit_id', 'TEXT'); // 挂载的写作规范包 id
  ensureColumn(d, 'cf_articles', 'content_line', "TEXT NOT NULL DEFAULT ''"); // 内容线 key，如 classic/practice
  // 消息迁移：该条 assistant 消息收入需求池的 idea id 列表（JSON 数组）
  ensureMessagesColumn(d, 'pool_ids', "TEXT DEFAULT '[]'");
  // ContentForge：该条 assistant 消息沉淀/更新的文章 id 列表（JSON 数组）
  ensureMessagesColumn(d, 'article_ids', "TEXT DEFAULT '[]'");
  // 消息迁移：记录该条 assistant 消息沉淀出的需求 id 列表（JSON 数组）
  ensureMessagesColumn(d, 'req_ids', "TEXT DEFAULT '[]'");
  // 消息迁移：记录该条 assistant 消息记录的设计决策 id 列表（JSON 数组）
  ensureMessagesColumn(d, 'decision_ids', "TEXT DEFAULT '[]'");

  // ============================================
  // 原型（ProtoForge：需求文档 → 可点原型 JSON，一个项目一份）
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS prototypes (
      project_id TEXT PRIMARY KEY,
      spec_json TEXT,
      status TEXT NOT NULL DEFAULT 'empty',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);

  // ============================================
  // 原型标注（ProtoForge：原型站点上贴的意见，按页面关联）
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      page_title TEXT NOT NULL DEFAULT '',
      target_kind TEXT NOT NULL DEFAULT 'page',
      target_label TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      proto_applied INTEGER NOT NULL DEFAULT 0,
      needs_req INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_annot_project ON annotations(project_id, status);`);
  // annotations 列迁移（表建好后执行；顺序敏感，勿挪回建表前）
  ensureColumn(d, 'annotations', 'proto_applied', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(d, 'annotations', 'needs_req', 'INTEGER NOT NULL DEFAULT 0');
  // 圈选式标注：元素定位路径（页面内 DOM 定位描述，靶向修改的靶点）
  ensureColumn(d, 'annotations', 'target_path', 'TEXT');
  // 站外标注（Chrome 扩展/注入器）：按 URL 认页面，origin 区分来源
  ensureColumn(d, 'annotations', 'page_url', 'TEXT');
  ensureColumn(d, 'annotations', 'origin', "TEXT NOT NULL DEFAULT 'shell'");
  // 评审意见附图（JSON 数组：[{id,url,name,size,mime}]），供多模态照图修改
  ensureColumn(d, 'annotations', 'images', "TEXT NOT NULL DEFAULT '[]'");
  // 补丁未落实原因（治谎报）：没真正改成的意见保持 open，并记下为什么改不了
  ensureColumn(d, 'annotations', 'apply_error', 'TEXT');

  // ============================================
  // 站外页面采集包（Chrome 扩展采的渲染后 DOM，用于重建 PF 原生页）
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS external_captures (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_url TEXT NOT NULL,
      page_title TEXT NOT NULL DEFAULT '',
      viewport TEXT NOT NULL DEFAULT '',
      node_count INTEGER NOT NULL DEFAULT 0,
      truncated INTEGER NOT NULL DEFAULT 0,
      dom_html TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'captured', -- captured|rebuilding|ready|error
      spec_page_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_capture_url ON external_captures(project_id, page_url);`);
  ensureColumn(d, 'external_captures', 'layout_hint', "TEXT NOT NULL DEFAULT 'sidebar'");
  ensureColumn(d, 'external_captures', 'visual_spec', 'TEXT');

  // ============================================
  // 设计决策（ProtoForge：回答「这个设计当时为什么这么定」）
  // 会议/对话/附件只是决策的来源标签，会议本身不做实体
  // ============================================
  d.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      point TEXT NOT NULL DEFAULT '',
      anchor_text TEXT NOT NULL DEFAULT '',
      conclusion TEXT NOT NULL DEFAULT '',
      rationale TEXT NOT NULL DEFAULT '',
      rejected_json TEXT NOT NULL DEFAULT '[]',
      source_type TEXT NOT NULL DEFAULT 'chat',
      source_label TEXT NOT NULL DEFAULT '',
      source_conversation_id TEXT,
      source_excerpt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, created_at DESC);`);
  // 决策 ↔ 需求 多对多（一条决策可影响多个需求）
  d.exec(`
    CREATE TABLE IF NOT EXISTS decision_links (
      decision_id TEXT NOT NULL,
      requirement_id TEXT NOT NULL,
      PRIMARY KEY (decision_id, requirement_id),
      FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
      FOREIGN KEY (requirement_id) REFERENCES requirements(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_decision_links_req ON decision_links(requirement_id);`);

  // 老库迁移：决策补「需求点」字段（决策挂到文档里的设计点/章节，而非整篇文档）
  ensureColumn(d, 'decisions', 'point', "TEXT NOT NULL DEFAULT ''");
  // 老库迁移：决策补「锚文本」（从需求文档摘的原句，行内高亮用）
  ensureColumn(d, 'decisions', 'anchor_text', "TEXT NOT NULL DEFAULT ''");

  // ============================================
  // MCP 数据源
  // ============================================

  // MCP 数据源配置
  d.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      transport TEXT NOT NULL DEFAULT 'http',
      url TEXT NOT NULL,
      headers_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_error TEXT,
      tool_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // MCP 工具（发现到的工具 + 白名单 + 角色绑定）
  d.exec(`
    CREATE TABLE IF NOT EXISTS mcp_tools (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      input_schema_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 0,
      bound_roles_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(server_id, tool_name),
      FOREIGN KEY (server_id) REFERENCES mcp_servers(id) ON DELETE CASCADE
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_tools_server ON mcp_tools(server_id);`);

  // MCP 调用日志（留痕可追溯）
  d.exec(`
    CREATE TABLE IF NOT EXISTS mcp_call_logs (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      server_name TEXT NOT NULL DEFAULT '',
      tool_name TEXT NOT NULL,
      bound_tool_name TEXT NOT NULL,
      args_json TEXT NOT NULL DEFAULT '{}',
      result_preview TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      error_text TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      project_id TEXT,
      conversation_id TEXT,
      enterprise_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_logs_created ON mcp_call_logs(created_at DESC);`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_logs_server ON mcp_call_logs(server_id, created_at DESC);`);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_logs_project ON mcp_call_logs(project_id, created_at DESC);`);

  // 外部企业（通过 MCP 等外部数据源检索到的企业，登记后可进入评估流程）
  d.exec(`
    CREATE TABLE IF NOT EXISTS external_enterprises (
      enterprise_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      credit_code TEXT,
      legal_person TEXT,
      registered_capital TEXT,
      establish_date TEXT,
      industry TEXT,
      source TEXT NOT NULL DEFAULT 'mcp',
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  d.exec(`CREATE INDEX IF NOT EXISTS idx_ext_ent_credit ON external_enterprises(credit_code);`);
}

// ============================================
// 模型配置
// ============================================
export function getModelConfig(): ModelConfigRow | undefined {
  return getDb().prepare('SELECT * FROM model_config WHERE id = 1').get() as ModelConfigRow | undefined;
}

export function saveModelConfig(config: { base_url: string; api_key: string; model_name: string; embedding_model?: string | null }): void {
  const d = getDb();
  const emb = config.embedding_model ?? null;
  d.exec(
    `INSERT INTO model_config (id, base_url, api_key, model_name, embedding_model)
     VALUES (1, '${config.base_url.replace(/'/g, "''")}', '${config.api_key.replace(/'/g, "''")}', '${config.model_name.replace(/'/g, "''")}', ${emb === null ? 'NULL' : "'" + String(emb).replace(/'/g, "''") + "'"})
     ON CONFLICT(id) DO UPDATE SET base_url=excluded.base_url, api_key=excluded.api_key, model_name=excluded.model_name, embedding_model=excluded.embedding_model`
  );
}

/** 向量记忆条数（判断换 embedding 模型后是否需要重建） */
export function countMemoryChunks(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM memory_chunks').get() as { n: number };
  return row?.n ?? 0;
}

/** 清空全部向量记忆（切换 embedding 模型后维度不匹配，需重建；原始对话/附件不受影响） */
export function clearMemoryChunks(): number {
  const info = getDb().prepare('DELETE FROM memory_chunks').run();
  return Number(info.changes);
}

/** 按来源删除记忆片段（设计决策删除/更新时同步清理） */
export function deleteMemoryChunksBySource(sourceType: string, sourceId: string): number {
  const info = getDb()
    .prepare('DELETE FROM memory_chunks WHERE source_type=? AND source_id=?')
    .run(sourceType, sourceId);
  return Number(info.changes);
}

// ============================================
// 评估记录
// ============================================
export function createAssessment(
  id: string,
  enterpriseId: string,
  projectId: string | null,
  conversationId: string | null,
  fullLog: unknown[]
): void {
  getDb()
    .prepare(
      `INSERT INTO assessments (id, enterprise_id, project_id, conversation_id, status, created_at, full_log)
       VALUES (?, ?, ?, ?, 'running', ?, ?)`
    )
    .run(id, enterpriseId, projectId, conversationId, new Date().toISOString(), JSON.stringify(fullLog));
}

export function completeAssessment(params: {
  id: string;
  status: AssessmentStatus;
  decision: DecisionType | null;
  riskLevel: RiskLevel | null;
  reasons: string[] | null;
  suggestions: string[] | null;
  summary: string | null;
  fullLog: unknown[];
}): void {
  getDb()
    .prepare(
      `UPDATE assessments
       SET status=?, completed_at=?, decision=?, risk_level=?, reasons=?, suggestions=?, summary=?, full_log=?
       WHERE id=?`
    )
    .run(
      params.status,
      new Date().toISOString(),
      params.decision,
      params.riskLevel,
      params.reasons ? JSON.stringify(params.reasons) : null,
      params.suggestions ? JSON.stringify(params.suggestions) : null,
      params.summary,
      JSON.stringify(params.fullLog),
      params.id
    );
}

export function listAssessments(): AssessmentRow[] {
  return getDb()
    .prepare('SELECT * FROM assessments ORDER BY created_at DESC')
    .all() as unknown as AssessmentRow[];
}

export function getAssessment(id: string): AssessmentRow | undefined {
  return getDb().prepare('SELECT * FROM assessments WHERE id = ?').get(id) as
    | AssessmentRow
    | undefined;
}

// ============================================
// 项目（文件夹）
// ============================================
export function createProject(id: string, name: string, description: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, description, now, now);
}

export function listProjects(): ProjectRow[] {
  return getDb().prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as unknown as ProjectRow[];
}

export function getProject(id: string): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
}

export function renameProject(id: string, name: string, description: string): void {
  getDb()
    .prepare('UPDATE projects SET name=?, description=?, updated_at=? WHERE id=?')
    .run(name, description, new Date().toISOString(), id);
}

export function deleteProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export function touchProject(id: string): void {
  getDb().prepare('UPDATE projects SET updated_at=? WHERE id=?').run(new Date().toISOString(), id);
}

/** 向项目档案追加一条评估沉淀 */
export function appendProjectAssessment(projectId: string, record: ArchiveAssessment): void {
  const d = getDb();
  const row = d.prepare('SELECT archive FROM projects WHERE id=?').get(projectId) as
    | { archive: string }
    | undefined;
  let archive: { assessments: ArchiveAssessment[]; keyFacts: string[] };
  try {
    archive = row ? JSON.parse(row.archive) : { assessments: [], keyFacts: [] };
  } catch {
    archive = { assessments: [], keyFacts: [] };
  }
  archive.assessments.push(record);
  d.prepare('UPDATE projects SET archive=?, updated_at=? WHERE id=?').run(
    JSON.stringify(archive),
    new Date().toISOString(),
    projectId
  );
}

/** 读取项目档案 */
export function getProjectArchive(projectId: string): {
  assessments: ArchiveAssessment[];
  keyFacts: string[];
} {
  const row = getDb().prepare('SELECT archive FROM projects WHERE id=?').get(projectId) as
    | { archive: string }
    | undefined;
  try {
    return row ? JSON.parse(row.archive) : { assessments: [], keyFacts: [] };
  } catch {
    return { assessments: [], keyFacts: [] };
  }
}

// ============================================
// 项目企业成员
// ============================================
export function addProjectEntity(
  projectId: string,
  enterpriseId: string,
  role: ProjectEntityRole
): void {
  getDb()
    .prepare(
      `INSERT INTO project_entities (project_id, enterprise_id, role, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(project_id, enterprise_id) DO UPDATE SET role=excluded.role`
    )
    .run(projectId, enterpriseId, role, new Date().toISOString());
}

export function listProjectEntities(projectId: string): ProjectEntityRow[] {
  return getDb()
    .prepare('SELECT * FROM project_entities WHERE project_id=?')
    .all(projectId) as unknown as ProjectEntityRow[];
}

export function removeProjectEntity(projectId: string, enterpriseId: string): void {
  getDb()
    .prepare('DELETE FROM project_entities WHERE project_id=? AND enterprise_id=?')
    .run(projectId, enterpriseId);
}

// ============================================
// 对话
// ============================================
/** 迁移：旧库 conversations.project_id 为 NOT NULL，重建为可空（保留数据） */
function migrateConversationsNullable(d: DatabaseSync): void {
  const cols = d.prepare("PRAGMA table_info(conversations)").all() as Array<{
    name: string; notnull: number;
  }>;
  const pidCol = cols.find((c) => c.name === 'project_id');
  if (pidCol && pidCol.notnull === 1) {
    d.exec(`
      CREATE TABLE conversations_new (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL DEFAULT '新对话',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      INSERT INTO conversations_new SELECT id, project_id, title, created_at, updated_at FROM conversations;
      DROP TABLE conversations;
      ALTER TABLE conversations_new RENAME TO conversations;
    `);
  }
}

export function createConversation(id: string, projectId: string | null, title: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      'INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, projectId, title, now, now);
  if (projectId) touchProject(projectId);
}

export function listConversations(projectId: string): ConversationRow[] {
  return getDb()
    .prepare('SELECT * FROM conversations WHERE project_id=? ORDER BY updated_at DESC')
    .all(projectId) as unknown as ConversationRow[];
}

/** 列出所有未归档（project_id 为 NULL）的对话 */
export function listUnassignedConversations(): ConversationRow[] {
  return getDb()
    .prepare('SELECT * FROM conversations WHERE project_id IS NULL ORDER BY updated_at DESC')
    .all() as unknown as ConversationRow[];
}

/** 将对话归入某项目（或传 null 取消归档）。
 *  级联：把该对话下的评估、附件关联到项目，评估结论沉淀进项目档案。 */
export function assignConversationToProject(conversationId: string, projectId: string | null): void {
  const d = getDb();
  const now = new Date().toISOString();
  d.exec('BEGIN');
  try {
    d.prepare('UPDATE conversations SET project_id=?, updated_at=? WHERE id=?')
      .run(projectId, now, conversationId);
    if (projectId) {
      // 附件、评估关联到项目（仅原本未归属的）
      d.prepare('UPDATE attachments SET project_id=? WHERE conversation_id=? AND project_id IS NULL')
        .run(projectId, conversationId);
      d.prepare('UPDATE assessments SET project_id=? WHERE conversation_id=? AND project_id IS NULL')
        .run(projectId, conversationId);
      // 评估结论沉淀进项目档案 + 企业加入项目
      const rows = d.prepare(
        "SELECT * FROM assessments WHERE conversation_id=? AND status='completed' AND decision IS NOT NULL"
      ).all(conversationId) as unknown as AssessmentRow[];
      for (const a of rows) {
        addProjectEntity(projectId, a.enterprise_id, 'borrower');
        if (a.summary) {
          appendProjectAssessment(projectId, {
            assessmentId: a.id,
            enterpriseId: a.enterprise_id,
            enterpriseName: a.enterprise_id,
            decision: a.decision as any,
            riskLevel: a.risk_level as any,
            reasons: a.reasons ? JSON.parse(a.reasons) : [],
            suggestions: a.suggestions ? JSON.parse(a.suggestions) : [],
            summary: a.summary,
            assessedAt: a.completed_at || a.created_at,
          });
        }
      }
      touchProject(projectId);
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function getConversation(id: string): ConversationRow | undefined {
  return getDb()
    .prepare('SELECT * FROM conversations WHERE id=?')
    .get(id) as unknown as ConversationRow | undefined;
}

export function renameConversation(id: string, title: string): void {
  getDb()
    .prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=?')
    .run(title, new Date().toISOString(), id);
}

/** 取对话摘要 */
export function getConversationSummary(id: string): { summary: string; lastSummaryMsgId: number } {
  const row = getDb()
    .prepare('SELECT summary, last_summary_msg_id FROM conversations WHERE id=?')
    .get(id) as { summary?: string | null; last_summary_msg_id?: number } | undefined;
  return {
    summary: row?.summary || '',
    lastSummaryMsgId: row?.last_summary_msg_id || 0,
  };
}

/** 更新对话摘要 */
export function updateConversationSummary(
  id: string, summary: string, lastSummaryMsgId: number
): void {
  getDb()
    .prepare('UPDATE conversations SET summary=?, last_summary_msg_id=?, updated_at=? WHERE id=?')
    .run(summary, lastSummaryMsgId, new Date().toISOString(), id);
}

export function deleteConversation(id: string): void {
  getDb().prepare('DELETE FROM conversations WHERE id=?').run(id);
}

/** 迁移：为旧表补充缺失的列（通用） */
function ensureColumn(d: DatabaseSync, table: string, col: string, def: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === col)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

/** 迁移：旧 attachments.project_id 为 NOT NULL，重建为可空（保留数据） */
function migrateAttachmentsNullable(d: DatabaseSync): void {
  const cols = d.prepare("PRAGMA table_info(attachments)").all() as Array<{
    name: string; notnull: number;
  }>;
  if (cols.length === 0) return;
  const pidCol = cols.find((c) => c.name === 'project_id');
  if (pidCol && pidCol.notnull === 1) {
    d.exec(`
      CREATE TABLE attachments_new (
        id TEXT PRIMARY KEY, project_id TEXT, conversation_id TEXT,
        filename TEXT NOT NULL, stored_path TEXT NOT NULL, mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'other',
        summary TEXT NOT NULL DEFAULT '', extracted_text TEXT NOT NULL DEFAULT '',
        uploader TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL
      );
      INSERT INTO attachments_new SELECT id, project_id, NULL, filename, stored_path, mime_type, size_bytes, category, summary, extracted_text, uploader, created_at FROM attachments;
      DROP TABLE attachments;
      ALTER TABLE attachments_new RENAME TO attachments;
    `);
  }
}

/** 迁移：为旧表补充缺失的列 */
function ensureMessagesColumn(d: DatabaseSync, col: string, def: string): void {
  ensureColumn(d, 'messages', col, def);
}

// ============================================
// 消息
// ============================================
export function appendMessage(
  conversationId: string,
  role: string,
  content: string,
  attachments: unknown[] = [],
  opts: { agentRole?: string; agentName?: string; refArticles?: unknown[]; reasoningContent?: string } = {}
): void {
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(
    'INSERT INTO messages (conversation_id, role, content, attachments, agent_role, agent_name, ref_articles, reasoning_content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    conversationId,
    role,
    content,
    JSON.stringify(attachments),
    opts.agentRole || null,
    opts.agentName || null,
    JSON.stringify(opts.refArticles || []),
    opts.reasoningContent || null,
    now
  );
  d.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now, conversationId);
}

export function getMessages(conversationId: string): MessageRow[] {
  return getDb()
    .prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY id ASC')
    .all(conversationId) as unknown as MessageRow[];
}

/** 一条 agent 消息（调查员/worker/审查官/决策官）的持久化结构 */
export interface AgentMessageRecord {
  assessmentId?: string;
  agentRole: string;
  agentName: string;
  content: string;
  reasoningContent?: string;
  toolCalls?: unknown[];
  reviewFeedback?: unknown;
  decision?: unknown;
  skillMeta?: unknown;
}

/** 批量插入 agent 过程消息（评估结束/中断时调用） */
export function appendAgentMessages(
  conversationId: string,
  records: AgentMessageRecord[]
): void {
  if (records.length === 0) return;
  const d = getDb();
  const now = new Date().toISOString();
  const stmt = d.prepare(
    `INSERT INTO messages
       (conversation_id, role, content, attachments, agent_role, agent_name, tool_calls, review_feedback, decision, assessment_id, reasoning_content, skill_meta, created_at)
     VALUES (?, 'agent', ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  d.exec('BEGIN');
  try {
    for (const r of records) {
      stmt.run(
        conversationId,
        r.content || '',
        r.agentRole,
        r.agentName,
        JSON.stringify(r.toolCalls || []),
        r.reviewFeedback ? JSON.stringify(r.reviewFeedback) : null,
        r.decision ? JSON.stringify(r.decision) : null,
        r.assessmentId || null,
        r.reasoningContent || null,
        r.skillMeta ? JSON.stringify(r.skillMeta) : null,
        now
      );
    }
    d.prepare('UPDATE conversations SET updated_at=? WHERE id=?').run(now, conversationId);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

// ============================================
// 附件
// ============================================
export function addAttachment(row: {
  id: string;
  project_id: string | null;
  conversation_id: string | null;
  filename: string;
  stored_path: string;
  mime_type: string;
  size_bytes: number;
  category: string;
  summary: string;
  extracted_text: string;
  source_url?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO attachments (id, project_id, conversation_id, filename, stored_path, mime_type, size_bytes, category, summary, extracted_text, source_url, uploader, created_at)
       VALUES (@id, @project_id, @conversation_id, @filename, @stored_path, @mime_type, @size_bytes, @category, @summary, @extracted_text, @source_url, 'user', @created_at)`
    )
    .run({ source_url: null, ...row, created_at: new Date().toISOString() } as any);
}

/** 按对话列出附件（调查员/前台在对话内查阅） */
export function listAttachmentsByConversation(conversationId: string): AttachmentRow[] {
  return getDb()
    .prepare('SELECT * FROM attachments WHERE conversation_id=? ORDER BY created_at DESC')
    .all(conversationId) as unknown as AttachmentRow[];
}

/** 按项目列出附件（项目文件柜） */
export function listAttachments(projectId: string): AttachmentRow[] {
  return getDb()
    .prepare('SELECT * FROM attachments WHERE project_id=? ORDER BY created_at DESC')
    .all(projectId) as unknown as AttachmentRow[];
}

export function getAttachment(id: string): AttachmentRow | undefined {
  return getDb().prepare('SELECT * FROM attachments WHERE id=?').get(id) as AttachmentRow | undefined;
}

export function updateAttachmentClassification(
  id: string,
  category: string,
  summary: string
): void {
  getDb()
    .prepare('UPDATE attachments SET category=?, summary=? WHERE id=?')
    .run(category, summary, id);
}

export function updateAttachmentText(id: string, text: string): void {
  getDb()
    .prepare('UPDATE attachments SET extracted_text=? WHERE id=?')
    .run(text, id);
}

// ============================================
// 记忆片段（项目级语义记忆）
// ============================================

/** 批量插入记忆片段，embedding 以 Buffer 存入 */
export function insertMemoryChunks(chunks: Array<MemoryChunkInput & { id: string; embedding: Buffer | null }>): void {
  if (chunks.length === 0) return;
  const d = getDb();
  const stmt = d.prepare(
    `INSERT INTO memory_chunks
       (id, project_id, source_type, source_id, memory_type, content, metadata, embedding, created_at)
     VALUES (@id, @project_id, @source_type, @source_id, @memory_type, @content, @metadata, @embedding, @created_at)`
  );
  d.exec('BEGIN');
  try {
    for (const c of chunks) {
      stmt.run({
        id: c.id,
        project_id: c.projectId,
        source_type: c.sourceType,
        source_id: c.sourceId,
        memory_type: c.memoryType,
        content: c.content,
        metadata: JSON.stringify(c.metadata || {}),
        embedding: c.embedding,
        created_at: new Date().toISOString(),
      });
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** 列出项目内所有带 embedding 的记忆（用于内存向量检索） */
export function listMemoryChunksWithEmbedding(projectId: string): MemoryChunkRow[] {
  return getDb()
    .prepare('SELECT * FROM memory_chunks WHERE project_id=? AND embedding IS NOT NULL ORDER BY created_at DESC')
    .all(projectId) as unknown as MemoryChunkRow[];
}

/** 列出项目内全部记忆（含无 embedding 的，备用） */
export function listMemoryChunks(projectId: string): MemoryChunkRow[] {
  return getDb()
    .prepare('SELECT * FROM memory_chunks WHERE project_id=? ORDER BY created_at DESC')
    .all(projectId) as unknown as MemoryChunkRow[];
}

/** 按 source_type + source_id 去重检查（避免重复写同一评估结论） */
export function memoryChunkExists(projectId: string, sourceType: string, sourceId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM memory_chunks WHERE project_id=? AND source_type=? AND source_id=? LIMIT 1')
    .get(projectId, sourceType, sourceId);
  return !!row;
}

// ============================================
// 外部企业（通过 MCP 检索到，登记后可评估）
// ============================================

export interface ExternalEnterprise {
  enterprise_id: string;
  name: string;
  credit_code: string | null;
  legal_person: string | null;
  registered_capital: string | null;
  establish_date: string | null;
  industry: string | null;
  source: string;
  raw_json: string;
  created_at: string;
}

export function getExternalEnterprise(enterpriseId: string): ExternalEnterprise | undefined {
  return getDb()
    .prepare('SELECT * FROM external_enterprises WHERE enterprise_id=?')
    .get(enterpriseId) as unknown as ExternalEnterprise | undefined;
}

export function findExternalEnterpriseByCreditCode(creditCode: string): ExternalEnterprise | undefined {
  return getDb()
    .prepare('SELECT * FROM external_enterprises WHERE credit_code=? ORDER BY created_at DESC LIMIT 1')
    .get(creditCode) as unknown as ExternalEnterprise | undefined;
}

export function upsertExternalEnterprise(e: Omit<ExternalEnterprise, 'created_at'>): ExternalEnterprise {
  const existing = getExternalEnterprise(e.enterprise_id);
  const ts = new Date().toISOString();
  if (existing) {
    getDb()
      .prepare(
        `UPDATE external_enterprises SET name=?, credit_code=?, legal_person=?, registered_capital=?,
          establish_date=?, industry=?, source=?, raw_json=? WHERE enterprise_id=?`
      )
      .run(e.name, e.credit_code, e.legal_person, e.registered_capital, e.establish_date,
        e.industry, e.source, e.raw_json, e.enterprise_id);
  } else {
    getDb()
      .prepare(
        `INSERT INTO external_enterprises
          (enterprise_id, name, credit_code, legal_person, registered_capital,
           establish_date, industry, source, raw_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(e.enterprise_id, e.name, e.credit_code, e.legal_person, e.registered_capital,
        e.establish_date, e.industry, e.source, e.raw_json, ts);
  }
  return getExternalEnterprise(e.enterprise_id)!;
}

// ============================================
// 需求清单（ProtoForge）
// ============================================
export function createRequirement(row: {
  id: string;
  projectId: string;
  title: string;
  kind?: 'module' | 'page' | 'idea';
  parentId?: string | null;
  status?: 'proposed' | 'confirmed';
  docMd: string;
  sourceConversationId?: string | null;
  /** 需求池字段（kind='idea' 时） */
  summary?: string;
  poolStatus?: '' | 'raw' | 'ready' | 'shelved';
  urgent?: boolean;
  important?: boolean;
  relatedModuleId?: string | null;
  proposer?: string;
}): Record<string, unknown> {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO requirements
         (id, project_id, title, kind, parent_id, status, doc_md, source_conversation_id, summary, pool_status, urgent, important, related_module_id, proposer, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.projectId,
      row.title,
      row.kind || 'module',
      row.parentId || null,
      row.status || 'proposed',
      row.docMd,
      row.sourceConversationId || null,
      row.summary || '',
      row.poolStatus || (row.kind === 'idea' ? 'raw' : ''),
      row.urgent ? 1 : 0,
      row.important ? 1 : 0,
      row.relatedModuleId || null,
      row.proposer || '',
      now,
      now
    );
  touchProject(row.projectId);
  snapshotRequirement(row.id, 'create', { actor: row.proposer ? `proposer:${row.proposer}` : '' }); // v1 基线
  return getRequirement(row.id)!;
}

export function listRequirements(projectId: string, opts: { includeIdeas?: boolean } = {}): any[] {
  // 默认排除需求池条目（原型生成/需求同步等消费方只看模块/页面）；需求池列表显式 includeIdeas
  const sql = opts.includeIdeas
    ? 'SELECT * FROM requirements WHERE project_id=? ORDER BY updated_at DESC'
    : "SELECT * FROM requirements WHERE project_id=? AND kind != 'idea' ORDER BY updated_at DESC";
  return getDb()
    .prepare(sql)
    .all(projectId) as unknown as any[];
}

/**
 * 沉淀页面需求时解析父模块：
 * moduleId 命中已有模块 → 直接挂；否则按模块名找同名模块；都没有 → 自动建模块。
 * 返回 parentId 和可能新建的模块。
 */
export function ensureParentModule(
  projectId: string,
  opts: { moduleId?: string; moduleTitle?: string; fallbackTitle?: string; moduleDoc?: string; sourceConversationId?: string | null }
): { parentId: string; createdModule?: { id: string; title: string } } {
  const existing = listRequirements(projectId);
  const byId = opts.moduleId ? existing.find((m) => m.id === opts.moduleId && m.kind !== 'page') : null;
  if (byId) return { parentId: byId.id };
  const modName = (opts.moduleTitle || opts.fallbackTitle || '未命名模块').trim();
  const dup = existing.find((m) => m.kind !== 'page' && m.title === modName);
  if (dup) return { parentId: dup.id };
  const mod = createRequirement({
    id: crypto.randomUUID(),
    projectId,
    title: modName,
    kind: 'module',
    docMd: opts.moduleDoc || `## 功能概述\n${modName}模块。\n## 使用角色\n（待补充）\n## 业务流程\n（待补充）`,
    sourceConversationId: opts.sourceConversationId ?? null,
    status: 'proposed',
  }) as { id: string; title: string };
  return { parentId: mod.id, createdModule: { id: mod.id, title: mod.title } };
}

export function getRequirement(id: string): any | undefined {
  return getDb().prepare('SELECT * FROM requirements WHERE id=?').get(id) as any | undefined;
}

// ============================================
// 需求文档版本快照
// ============================================
export interface RequirementVersionRow {
  id: string;
  requirement_id: string;
  version_no: number;
  title: string;
  doc_md: string;
  status: string;
  trigger: string;
  actor: string;
  note: string;
  created_at: string;
}

/** 存一版快照。内容与状态与上一版完全相同则跳过（手动存版避免重复），返回版本号或 null */
export function snapshotRequirement(
  id: string,
  trigger: 'create' | 'status' | 'manual' | 'restore' | 'ai',
  opts: { actor?: string; note?: string } = {}
): number | null {
  const req = getRequirement(id);
  if (!req) return null;
  const db = getDb();
  const last = db
    .prepare('SELECT * FROM requirement_versions WHERE requirement_id=? ORDER BY version_no DESC LIMIT 1')
    .get(id) as RequirementVersionRow | undefined;
  if (last && trigger !== 'restore') {
    const sameDoc = last.doc_md === req.doc_md;
    const sameStatus = last.status === req.status;
    // 纯状态翻转（确认↔打回）即使文档一个字没改也必须存版——否则打回记录凭空消失，周报抓不到
    if (trigger === 'status') {
      if (sameStatus) return null;
    } else if (sameDoc) {
      return null; // manual/ai/create：无内容变化不产生碎版本
    }
  }
  const versionNo = (last?.version_no || 0) + 1;
  db.prepare(
    `INSERT INTO requirement_versions (id, requirement_id, version_no, title, doc_md, status, trigger, actor, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(), id, versionNo, req.title, req.doc_md, req.status,
    trigger, opts.actor || '', opts.note || '', new Date().toISOString()
  );
  return versionNo;
}

export function listRequirementVersions(requirementId: string): RequirementVersionRow[] {
  return getDb()
    .prepare('SELECT * FROM requirement_versions WHERE requirement_id=? ORDER BY version_no DESC')
    .all(requirementId) as unknown as RequirementVersionRow[];
}

export function getRequirementVersion(versionId: string): RequirementVersionRow | undefined {
  return getDb()
    .prepare('SELECT * FROM requirement_versions WHERE id=?')
    .get(versionId) as RequirementVersionRow | undefined;
}

export function updateRequirement(
  id: string,
  patch: {
    title?: string; status?: 'proposed' | 'confirmed'; docMd?: string;
    kind?: 'module' | 'page' | 'idea'; parentId?: string | null;
    summary?: string; poolStatus?: '' | 'raw' | 'ready' | 'shelved';
    urgent?: boolean; important?: boolean; relatedModuleId?: string | null;
    proposer?: string;
  },
  actor = ''
): any | undefined {
  const prev = getRequirement(id) as { status?: string } | undefined;
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) { fields.push('title=?'); values.push(patch.title); }
  if (patch.status !== undefined) { fields.push('status=?'); values.push(patch.status); }
  if (patch.docMd !== undefined) { fields.push('doc_md=?'); values.push(patch.docMd); }
  if (patch.kind !== undefined) { fields.push('kind=?'); values.push(patch.kind); }
  if (patch.parentId !== undefined) { fields.push('parent_id=?'); values.push(patch.parentId); }
  if (patch.summary !== undefined) { fields.push('summary=?'); values.push(patch.summary); }
  if (patch.poolStatus !== undefined) { fields.push('pool_status=?'); values.push(patch.poolStatus); }
  if (patch.urgent !== undefined) { fields.push('urgent=?'); values.push(patch.urgent ? 1 : 0); }
  if (patch.important !== undefined) { fields.push('important=?'); values.push(patch.important ? 1 : 0); }
  if (patch.relatedModuleId !== undefined) { fields.push('related_module_id=?'); values.push(patch.relatedModuleId); }
  if (patch.proposer !== undefined) { fields.push('proposer=?'); values.push(patch.proposer); }
  fields.push('updated_at=?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE requirements SET ${fields.join(', ')} WHERE id=?`).run(...(values as any[]));
  const req = getRequirement(id);
  if (req) touchProject(req.project_id);
  // 状态变更（确认/打回）自动存版；纯文档/字段编辑不产生版本。
  // 注意：同时改文档+状态的 AI 修订链路由调用方显式 snapshotRequirement('ai')，会与本快照去重（内容相同跳过）。
  if (patch.status !== undefined && prev && prev.status !== patch.status) {
    snapshotRequirement(id, 'status', { actor });
  }
  return req;
}

export function deleteRequirement(id: string): void {
  const req = getRequirement(id);
  const db = getDb();
  // 删模块时，其下页面一起删；删页面不影响模块
  const childIds = (db.prepare('SELECT id FROM requirements WHERE parent_id=?').all(id) as Array<{ id: string }>).map((r) => r.id);
  for (const cid of childIds) db.prepare('DELETE FROM requirement_versions WHERE requirement_id=?').run(cid);
  db.prepare('DELETE FROM requirement_versions WHERE requirement_id=?').run(id);
  db.prepare('DELETE FROM requirements WHERE parent_id=?').run(id);
  // 需求池条目软关联该模块也要清掉，避免悬空引用
  db.prepare("UPDATE requirements SET related_module_id=NULL WHERE related_module_id=? AND kind='idea'").run(id);
  db.prepare('DELETE FROM requirements WHERE id=?').run(id);
  if (req) touchProject(req.project_id);
}

// ============================================
// 原型（ProtoForge）
// ============================================
export function getPrototype(projectId: string): any | undefined {
  return getDb().prepare('SELECT * FROM prototypes WHERE project_id=?').get(projectId) as any | undefined;
}

/** 写入/更新原型（status: empty|generating|ready|error） */
export function upsertPrototype(
  projectId: string,
  patch: { specJson?: string | null; status?: string; error?: string | null }
): void {
  const now = new Date().toISOString();
  const existing = getPrototype(projectId);
  if (!existing) {
    getDb()
      .prepare(
        `INSERT INTO prototypes (project_id, spec_json, status, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        projectId,
        patch.specJson ?? null,
        patch.status ?? 'empty',
        patch.error ?? null,
        now,
        now
      );
  } else {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (patch.specJson !== undefined) { fields.push('spec_json=?'); values.push(patch.specJson); }
    if (patch.status !== undefined) { fields.push('status=?'); values.push(patch.status); }
    if (patch.error !== undefined) { fields.push('error=?'); values.push(patch.error); }
    fields.push('updated_at=?');
    values.push(now);
    values.push(projectId);
    getDb().prepare(`UPDATE prototypes SET ${fields.join(', ')} WHERE project_id=?`).run(...(values as any[]));
  }
  touchProject(projectId);
}

// ============================================
// 原型标注（ProtoForge）
// ============================================
export function createAnnotation(row: {
  id: string;
  projectId: string;
  pageId: string;
  pageTitle?: string;
  targetKind?: string;
  targetLabel?: string;
  targetPath?: string;
  content: string;
  author?: string;
  pageUrl?: string;
  origin?: string;
  images?: Array<{ id?: string; url: string; name?: string; size?: number; mime?: string }>;
}): Record<string, unknown> {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO annotations
         (id, project_id, page_id, page_title, target_kind, target_label, target_path, content, author, status, created_at, page_url, origin, images)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.projectId,
      row.pageId,
      row.pageTitle || '',
      row.targetKind || 'page',
      row.targetLabel || '',
      row.targetPath || null,
      row.content,
      row.author || '',
      now,
      row.pageUrl || null,
      row.origin || 'shell',
      JSON.stringify(row.images || [])
    );
  touchProject(row.projectId);
  return getAnnotation(row.id)!;
}

export function listAnnotations(projectId: string, onlyOpen = false): any[] {
  const sql = onlyOpen
    ? 'SELECT * FROM annotations WHERE project_id=? AND status=\'open\' ORDER BY created_at DESC'
    : 'SELECT * FROM annotations WHERE project_id=? ORDER BY created_at DESC';
  return getDb().prepare(sql).all(projectId) as unknown as any[];
}

// 站外标注：按项目 + 页面 URL 查询（origin != shell）
export function listExternalAnnotations(projectId: string, pageUrl: string, onlyOpen = false): any[] {
  const sql = onlyOpen
    ? "SELECT * FROM annotations WHERE project_id=? AND page_url=? AND status='open' ORDER BY created_at DESC"
    : 'SELECT * FROM annotations WHERE project_id=? AND page_url=? ORDER BY created_at DESC';
  return getDb().prepare(sql).all(projectId, pageUrl) as unknown as any[];
}

// ---- 站外页面采集包 ----
export function upsertExternalCapture(row: {
  projectId: string;
  pageUrl: string;
  pageTitle?: string;
  viewport?: string;
  nodeCount?: number;
  truncated?: boolean;
  domHtml: string;
  layoutHint?: string;
  visualSpec?: any;
}): any {
  const now = new Date().toISOString();
  const existing = getDb()
    .prepare('SELECT * FROM external_captures WHERE project_id=? AND page_url=?')
    .get(row.projectId, row.pageUrl) as any | undefined;
  if (existing) {
    getDb()
      .prepare(`UPDATE external_captures SET page_title=?, viewport=?, node_count=?, truncated=?, dom_html=?, layout_hint=?, visual_spec=?, status='captured', spec_page_id=NULL, error=NULL, updated_at=? WHERE id=?`)
      .run(row.pageTitle || '', row.viewport || '', row.nodeCount || 0, row.truncated ? 1 : 0, row.domHtml, row.layoutHint || 'sidebar', row.visualSpec ? JSON.stringify(row.visualSpec) : null, now, existing.id);
    touchProject(row.projectId);
    return getDb().prepare('SELECT * FROM external_captures WHERE id=?').get(existing.id);
  }
  const id = crypto.randomUUID();
  getDb()
    .prepare(`INSERT INTO external_captures (id, project_id, page_url, page_title, viewport, node_count, truncated, dom_html, layout_hint, visual_spec, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?, ?)`)
    .run(id, row.projectId, row.pageUrl, row.pageTitle || '', row.viewport || '', row.nodeCount || 0, row.truncated ? 1 : 0, row.domHtml, row.layoutHint || 'sidebar', row.visualSpec ? JSON.stringify(row.visualSpec) : null, now, now);
  touchProject(row.projectId);
  return getDb().prepare('SELECT * FROM external_captures WHERE id=?').get(id);
}

export function listExternalCaptures(projectId: string): any[] {
  return getDb()
    .prepare('SELECT id, project_id, page_url, page_title, node_count, truncated, status, spec_page_id, error, created_at, updated_at FROM external_captures WHERE project_id=? ORDER BY updated_at DESC')
    .all(projectId) as unknown as any[];
}

export function getExternalCapture(id: string): any | undefined {
  return getDb().prepare('SELECT * FROM external_captures WHERE id=?').get(id) as any | undefined;
}

export function updateExternalCaptureStatus(id: string, patch: { status: string; specPageId?: string | null; error?: string | null }): void {
  const now = new Date().toISOString();
  getDb()
    .prepare('UPDATE external_captures SET status=?, spec_page_id=COALESCE(?, spec_page_id), error=?, updated_at=? WHERE id=?')
    .run(patch.status, patch.specPageId ?? null, patch.error ?? null, now, id);
}

// 删站外页时级联清采集包（按项目 + 重建产出的 spec 页 id）。返回删除条数。
// 评审意见不在此删除（按 project+page_url 独立保留，重新采集后仍可用）。
export function deleteExternalCaptureBySpecPage(projectId: string, specPageId: string): number {
  const info = getDb()
    .prepare('DELETE FROM external_captures WHERE project_id=? AND spec_page_id=?')
    .run(projectId, specPageId);
  return Number(info.changes);
}

export function getAnnotation(id: string): any | undefined {
  return getDb().prepare('SELECT * FROM annotations WHERE id=?').get(id) as any | undefined;
}

export function resolveAnnotation(id: string): any | undefined {
  const now = new Date().toISOString();
  getDb().prepare("UPDATE annotations SET status='resolved', resolved_at=? WHERE id=?").run(now, id);
  return getAnnotation(id);
}

export function reopenAnnotation(id: string): any | undefined {
  // 重开 = 要重新处理：复位 proto_applied，让它能再次进入应用队列
  getDb().prepare("UPDATE annotations SET status='open', resolved_at=NULL, proto_applied=0 WHERE id=?").run(id);
  return getAnnotation(id);
}

export function updateAnnotationContent(id: string, content: string, author?: string): any | undefined {
  if (content && content.trim()) {
    getDb().prepare('UPDATE annotations SET content=? WHERE id=?').run(content.trim(), id);
  }
  if (author !== undefined && author.trim()) {
    getDb().prepare('UPDATE annotations SET author=? WHERE id=?').run(author.trim(), id);
  }
  return getAnnotation(id);
}

export function deleteAnnotation(id: string): void {
  getDb().prepare('DELETE FROM annotations WHERE id=?').run(id);
}

/**
 * 原型 patch 后更新标注：
 * - 纯界面类（needReq=false）：原型已改，直接标记解决
 * - 业务规则类（needReq=true）：原型已改但需求文档待同步，保持 open、置 needs_req=1
 * 落实成功一律清空上次的未落实原因。
 */
export function markAnnotationProtoApplied(id: string, needReq: boolean): void {
  const now = new Date().toISOString();
  if (needReq) {
    getDb()
      .prepare("UPDATE annotations SET proto_applied=1, needs_req=1, apply_error=NULL WHERE id=?")
      .run(id);
  } else {
    getDb()
      .prepare("UPDATE annotations SET proto_applied=1, needs_req=0, apply_error=NULL, status='resolved', resolved_at=? WHERE id=?")
      .run(now, id);
  }
}

/**
 * 补丁跑完但这条意见没真正落实（治谎报）：
 * 保持 open、不置 resolved、proto_applied 维持 0，记下为什么改不了，供前端诚实回显与重试。
 */
export function markAnnotationNotApplied(id: string, reason: string): void {
  getDb()
    .prepare("UPDATE annotations SET proto_applied=0, apply_error=? WHERE id=?")
    .run((reason || '').slice(0, 500), id);
}

/** 需求文档同步完成后，把业务类意见关闭 */
export function clearAnnotationNeedsReq(id: string): void {
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE annotations SET needs_req=0, status='resolved', resolved_at=? WHERE id=?")
    .run(now, id);
}

/** 把某对话最新一条 assistant 消息标记为沉淀了哪些需求 */
export function setLatestAssistantReqIds(conversationId: string, reqIds: string[]): void {
  getDb()
    .prepare(
      `UPDATE messages SET req_ids=?
       WHERE id = (SELECT id FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY id DESC LIMIT 1)`
    )
    .run(JSON.stringify(reqIds), conversationId);
}

/** 把某对话最新一条 assistant 消息标记为记录了哪些设计决策 */
export function setLatestAssistantDecisionIds(conversationId: string, decisionIds: string[]): void {
  getDb()
    .prepare(
      `UPDATE messages SET decision_ids=?
       WHERE id = (SELECT id FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY id DESC LIMIT 1)`
    )
    .run(JSON.stringify(decisionIds), conversationId);
}

/** 把某对话最新一条 assistant 消息标记为收入了哪些需求池条目 */
export function setLatestAssistantPoolIds(conversationId: string, poolIds: string[]): void {
  getDb()
    .prepare(
      `UPDATE messages SET pool_ids=?
       WHERE id = (SELECT id FROM messages WHERE conversation_id=? AND role='assistant' ORDER BY id DESC LIMIT 1)`
    )
    .run(JSON.stringify(poolIds), conversationId);
}
