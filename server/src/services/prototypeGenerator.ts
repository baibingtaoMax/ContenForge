// ============================================
// 原型生成入口（ProtoForge v2：AI 生成页面代码）
// 生成逻辑见 prototypeCodeGen.ts；局部修改见 prototypePatcher.ts
// ============================================

import { upsertPrototype, getPrototype as getPrototypeRow, listRequirements } from '../store/database.js';
import { generatePrototypePipeline, generateModulePipeline, regeneratePagePipeline, attachRequirementSnapshots } from './prototypeCodeGen.js';
import type { ProtoLayout } from './prototypeCodeGen.js';

// 兼容旧引用（requirementSync 等）
export { attachRequirementSnapshots };

interface ReqRow {
  id: string;
  title: string;
  doc_md: string;
  status: string;
  kind?: string;
  parent_id?: string | null;
}

function loadReqs(projectId: string) {
  // 闸门：只用【已确认】的需求生成原型（待确认文档还会改，生成出来是错的）
  return listRequirements(projectId)
    .filter((r: ReqRow) => r.status === 'confirmed' && (r.doc_md || '').trim().length > 20)
    .map((r: ReqRow) => ({ id: r.id, title: r.title, doc_md: r.doc_md, status: r.status, kind: r.kind, parent_id: r.parent_id }));
}

/** 生成前检查：返回错误信息（空串 = 可以生成） */
export function checkGenerateReady(projectId: string): string {
  const confirmed = listRequirements(projectId).filter((r: ReqRow) => r.status === 'confirmed');
  if (confirmed.length === 0) {
    return '项目里还没有已确认的需求。请先在需求清单里确认需求——待确认的文档可能还会改，确认后再生成原型。';
  }
  if (!confirmed.some((r: ReqRow) => (r.doc_md || '').trim().length > 20)) {
    return '已确认的需求文档内容为空，先把需求文档补充完整。';
  }
  const pages = confirmed.filter((r: ReqRow) => r.kind === 'page');
  if (pages.length === 0) {
    return '还没有已确认的【页面】需求。原型按页面需求生成（一条页面需求 = 一个原型页），请先在对话里聊清楚页面并沉淀、确认。';
  }
  return '';
}

/** 单页重生成前检查：该页面需求必须已确认。返回错误信息（空串 = 可以生成） */
export function checkPageReady(projectId: string, pageReqId: string): string {
  const all = listRequirements(projectId);
  const req = all.find((r) => r.id === pageReqId);
  if (!req) return '需求不存在';
  if (req.status !== 'confirmed') return `需求「${req.title}」还没确认，确认后再生成原型`;
  return '';
}

/** 模块增量前检查：模块及其下页面必须全部已确认。返回错误信息（空串 = 可以生成） */
export function checkModuleReady(projectId: string, moduleReqId: string): string {
  const all = listRequirements(projectId);
  const mod = all.find((r) => r.id === moduleReqId);
  if (!mod) return '模块需求不存在';
  const involved = [mod, ...all.filter((r) => r.parent_id === moduleReqId)];
  const unconfirmed = involved.filter((r) => r.status !== 'confirmed');
  if (unconfirmed.length) {
    return `以下需求还没确认，确认后再生成：${unconfirmed.map((r) => `「${r.title}」`).join('、')}`;
  }
  return '';
}

/** 整套生成（异步任务，不抛到路由层）。layout 由 PM 生成前手动指定 */
export async function generatePrototype(projectId: string, layout: ProtoLayout = 'sidebar'): Promise<void> {
  try {
    upsertPrototype(projectId, { status: 'generating', error: null });
    const notReady = checkGenerateReady(projectId);
    if (notReady) {
      upsertPrototype(projectId, { status: 'error', error: notReady });
      return;
    }
    const reqs = loadReqs(projectId);
    if (reqs.length === 0) {
      upsertPrototype(projectId, { status: 'error', error: checkGenerateReady(projectId) || '没有可用的需求文档。' });
      return;
    }
    await generatePrototypePipeline(projectId, reqs, layout);
  } catch (e) {
    upsertPrototype(projectId, {
      status: 'error',
      error: `生成失败：${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/** 单页重生成（异步任务）：主原型已存在，只重做某一页对应的原型页 */
export async function regeneratePagePrototype(projectId: string, pageReqId: string): Promise<void> {
  try {
    const notReady = checkPageReady(projectId, pageReqId);
    if (notReady) {
      const existing = getPrototypeRow(projectId);
      upsertPrototype(projectId, { status: existing?.spec_json ? 'ready' : 'error', error: notReady });
      return;
    }
    upsertPrototype(projectId, { status: 'generating', error: null });
    await regeneratePagePipeline(projectId, pageReqId);
  } catch (e) {
    const existing = getPrototypeRow(projectId);
    upsertPrototype(projectId, {
      status: existing?.spec_json ? 'ready' : 'error',
      error: `页面重生成失败：${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/** 模块增量生成（异步任务） */
export async function generateModulePrototype(projectId: string, moduleReqId: string): Promise<void> {
  try {
    const reqs = listRequirements(projectId);
    const mod = reqs.find((r) => r.id === moduleReqId);
    if (!mod) throw new Error('模块需求不存在');
    const ids = [moduleReqId, ...reqs.filter((r) => r.parent_id === moduleReqId).map((r) => r.id)];
    upsertPrototype(projectId, { status: 'generating', error: null });
    await generateModulePipeline(projectId, ids);
  } catch (e) {
    const existing = getPrototypeRow(projectId);
    upsertPrototype(projectId, {
      status: existing?.spec_json ? 'ready' : 'error',
      error: `模块生成失败：${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
