// ============================================
// 站外采集页重建编排：external_captures 行 → PF spec 页
// 无需求项目：spec 无 datasets，页面不绑 requirementId，nav 按 URL 路径归组
// ============================================

import {
  getExternalCapture,
  updateExternalCaptureStatus,
  getPrototype,
  upsertPrototype,
  getProject,
  listExternalAnnotations,
} from '../store/database.js';
import { buildExternalPageHtml, emptySpec, checkPageHtml } from './prototypeCodeGen.js';

function slugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() || 'page';
    const base = seg.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'page';
    return `ext-${base}`;
  } catch {
    return 'ext-page';
  }
}

function uniquePageId(base: string, existing: Set<string>): string {
  let id = base;
  let n = 2;
  while (existing.has(id)) id = `${base}-${n++}`;
  return id;
}

function titleFromRow(row: any): string {
  if (row.page_title) {
    // 「编辑规则策略 - 融资风控业务平台」→ 取破折号前
    return String(row.page_title).split(/\s*[-–—|]\s*/)[0].trim() || row.page_title;
  }
  return '未命名页面';
}

function kindGuess(title: string, domHtml: string): 'list' | 'form' | 'detail' {
  const t = title + ' ' + domHtml.slice(0, 3000);
  if (/编辑|新增|配置|录入|表单/.test(title) || /el-form/.test(domHtml.slice(0, 5000))) return 'form';
  if (/详情|查看/.test(title)) return 'detail';
  return 'list';
}

export async function rebuildFromCapture(captureId: string): Promise<{ pageId: string; title: string; length: number }> {
  const cap = getExternalCapture(captureId);
  if (!cap) throw new Error('采集包不存在');
  const projectId = cap.project_id;
  const project = getProject(projectId);
  if (!project) throw new Error('项目不存在');

  updateExternalCaptureStatus(captureId, { status: 'rebuilding', error: null });

  try {
    const opinions = listExternalAnnotations(projectId, cap.page_url)
      .filter((a) => a.status === 'open')
      .map((a) => `${a.target_kind === 'page' ? '整页' : a.target_label || '元素'}：${a.content}`);

    const title = titleFromRow(cap);
    const isTopnav = cap.layout_hint === 'topnav';
    let visualSpec: any = null;
    try { visualSpec = cap.visual_spec ? JSON.parse(cap.visual_spec) : null; } catch { visualSpec = null; }
    const html = await buildExternalPageHtml({
      title,
      url: cap.page_url,
      domHtml: cap.dom_html,
      opinions,
      layoutHint: cap.layout_hint || 'sidebar',
      visualSpec,
    });

    // ---- 写 spec ----
    const row = getPrototype(projectId);
    let spec: any;
    let isNew = false;
    if (row?.spec_json) {
      spec = JSON.parse(row.spec_json);
    } else {
      spec = emptySpec();
      spec.appName = project.name;
      spec.theme = 'finance';
      isNew = true;
    }
    spec.version = 2;
    spec.pages = spec.pages || [];
    spec.nav = spec.nav || [];
    spec.pageStatus = spec.pageStatus || {};

    const existingIds = new Set<string>(spec.pages.map((p: any) => String(p.id)));
    // 同一 URL 已重建过 → 覆盖该页
    let page = spec.pages.find((p: any) => p.source?.url === cap.page_url);
    const pageId = page ? page.id : uniquePageId(slugFromUrl(cap.page_url), existingIds);
    if (!page) {
      page = { id: pageId };
      spec.pages.push(page);
    }
    page.title = title;
    page.kind = kindGuess(title, cap.dom_html);
    page.immersive = isTopnav;
    page.html = html;
    page.group = '站外采集';
    page.source = { type: 'external', url: cap.page_url, capturedAt: cap.updated_at || new Date().toISOString() };
    spec.pageStatus[pageId] = 'ready';

    // nav：有则更新，无则加（外部重建页都进导航，便于打开查看）
    let navItem = spec.nav.find((n: any) => n.pageId === pageId);
    if (!navItem) {
      navItem = { pageId, title, group: '站外采集' };
      spec.nav.push(navItem);
    } else {
      navItem.title = title;
    }

    const warn = checkPageHtml(html, spec, pageId);
    spec.patchedAt = new Date().toISOString();
    upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'ready', error: warn ? `重建校验警告：${warn}` : null });
    updateExternalCaptureStatus(captureId, { status: 'ready', specPageId: pageId, error: warn });

    console.log(`[外部重建] ${cap.page_url} → ${pageId}，${html.length} 字符${warn ? `（警告：${warn}）` : ''}${isNew ? '，新建 spec' : ''}`);
    return { pageId, title, length: html.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateExternalCaptureStatus(captureId, { status: 'error', error: msg });
    // 原型状态不覆盖已有的 ready
    const row2 = getPrototype(projectId);
    if (row2?.spec_json) upsertPrototype(projectId, { status: 'ready', error: `外部页重建失败：${msg}` });
    else upsertPrototype(projectId, { status: 'error', error: `外部页重建失败：${msg}` });
    throw e;
  }
}
