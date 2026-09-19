// ============================================
// 配置管理
// 优先级：数据库 > 环境变量 > 默认值
// ============================================

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getModelConfig, saveModelConfig, initDatabase } from '../store/database.js';
import type { ModelConfigRow } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载 .env 文件（server 根目录）
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/** 应用配置接口 */
export interface AppConfig {
  port: number;
  nodeEnv: string;
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** 向量/嵌入模型名（记忆检索）；默认 doubao-embedding-vision */
    embeddingModel: string;
    /** 各角色可单独覆盖模型名，未配置则回落 model */
    roleModels: RoleModels;
  };
}

/** 可单独配置模型的角色槽位 */
export type ModelRole =
  | 'receptionist'
  | 'investigator'
  | 'reviewer'
  | 'decision_maker'
  | 'worker'
  | 'vision';

export type RoleModels = Partial<Record<ModelRole, string>>;

/** 默认配置 */
const defaults: AppConfig = {
  port: 3200,
  nodeEnv: 'development',
  llm: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    apiKey: '',
    model: 'doubao-seed-2.0-pro',
    embeddingModel: 'doubao-embedding-vision',
    roleModels: {},
  },
};

/** 从环境变量读取角色模型覆盖（ARK_MODEL_<ROLE>） */
function loadRoleModelsFromEnv(): RoleModels {
  const map: Record<ModelRole, string> = {
    receptionist: process.env.ARK_MODEL_RECEPTIONIST || '',
    investigator: process.env.ARK_MODEL_INVESTIGATOR || '',
    reviewer: process.env.ARK_MODEL_REVIEWER || '',
    decision_maker: process.env.ARK_MODEL_DECISION_MAKER || '',
    worker: process.env.ARK_MODEL_WORKER || '',
    vision: process.env.ARK_MODEL_VISION || '',
  };
  const out: RoleModels = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && v.trim()) out[k as ModelRole] = v.trim();
  }
  return out;
}

/** 从环境变量加载配置 */
function loadFromEnv(): AppConfig {
  return {
    port: Number(process.env.PORT) || defaults.port,
    nodeEnv: process.env.NODE_ENV || defaults.nodeEnv,
    llm: {
      baseUrl: process.env.ARK_BASE_URL || defaults.llm.baseUrl,
      apiKey: process.env.ARK_API_KEY || defaults.llm.apiKey,
      model: process.env.ARK_MODEL || defaults.llm.model,
      embeddingModel: process.env.ARK_EMBEDDING_MODEL || defaults.llm.embeddingModel,
      roleModels: loadRoleModelsFromEnv(),
    },
  };
}

/** 缓存的运行时配置 */
let cachedConfig: AppConfig | null = null;

/**
 * 初始化配置：建库 → 读取数据库配置 → 与环境变量合并
 * 在应用启动时调用一次。
 */
export function initConfig(): AppConfig {
  // 先确保数据库表已创建
  initDatabase();

  const envConfig = loadFromEnv();

  // 读取数据库中的模型配置（如果存在则覆盖）
  const dbConfig = getModelConfig();

  const merged: AppConfig = {
    ...envConfig,
    llm: {
      baseUrl: dbConfig?.base_url || envConfig.llm.baseUrl,
      apiKey: dbConfig?.api_key || envConfig.llm.apiKey,
      model: dbConfig?.model_name || envConfig.llm.model,
      embeddingModel: dbConfig?.embedding_model || envConfig.llm.embeddingModel,
      roleModels: envConfig.llm.roleModels,
    },
  };

  cachedConfig = merged;
  return merged;
}

/** 获取当前配置（必须先调用 initConfig） */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    return initConfig();
  }
  return cachedConfig;
}

/**
 * 按角色取模型名：角色有单独配置则用它，否则回落全局默认模型。
 * 注意：env 配置的角色模型仅在启动时读取，运行期改 env 需重启。
 */
export function getModelForRole(role?: ModelRole): string {
  const cfg = getConfig();
  if (role && cfg.llm.roleModels[role]) return cfg.llm.roleModels[role]!;
  return cfg.llm.model;
}

/** 原型生成/局部修改专用模型：吐大段结构化 JSON，用快模型（worker 槽显式配了优先，否则默认 turbo/flash 类快模型） */
const PROTOTYPE_DEFAULT_MODEL = 'deepseek-v4-flash-ga-260731';
export function getPrototypeModel(): string {
  const cfg = getConfig();
  return cfg.llm.roleModels.worker || PROTOTYPE_DEFAULT_MODEL;
}

/**
 * 更新模型配置（同时写入数据库并刷新缓存）
 */
export function updateLLMConfig(updates: Partial<{ baseUrl: string; apiKey: string; model: string; embeddingModel: string }>): AppConfig {
  const current = getConfig();

  const newLLM = {
    baseUrl: updates.baseUrl ?? current.llm.baseUrl,
    apiKey: updates.apiKey ?? current.llm.apiKey,
    model: updates.model ?? current.llm.model,
    embeddingModel: updates.embeddingModel ?? current.llm.embeddingModel,
    roleModels: current.llm.roleModels,
  };

  // 持久化到数据库
  saveModelConfig({
    base_url: newLLM.baseUrl,
    api_key: newLLM.apiKey,
    model_name: newLLM.model,
    embedding_model: newLLM.embeddingModel,
  });

  // 刷新缓存
  cachedConfig = { ...current, llm: newLLM };
  return cachedConfig;
}

/**
 * 获取脱敏后的模型配置（隐藏完整 API Key）
 */
export function getMaskedConfig() {
  const cfg = getConfig();
  const key = cfg.llm.apiKey;
  const maskedKey = key
    ? key.length > 12
      ? key.slice(0, 8) + '****' + key.slice(-4)
      : '****'
    : '';

  return {
    baseUrl: cfg.llm.baseUrl,
    apiKey: maskedKey,
    model: cfg.llm.model,
    embeddingModel: cfg.llm.embeddingModel,
  };
}
