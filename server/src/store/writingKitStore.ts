// ============================================
// ContentForge 写作规范包存储层
// 独立规范包（账号定位/写作工艺/标题工程/传播框架 + 署名模板 + 内容线），
// 推广主体通过 projects.kit_id 挂载。内置模板 is_builtin=1 不可删。
// ============================================

import { getDb, touchProject } from './database.js';

export interface ContentLine {
  /** 稳定 key，如 classic / practice */
  key: string;
  /** 线名，如「真知·经典线」 */
  label: string;
  /** 取材源 */
  source?: string;
  /** 落点/覆盖题材 */
  focus?: string;
}

export interface WritingKitRow {
  id: string;
  name: string;
  description: string;
  positioning_md: string;
  writing_md: string;
  title_md: string;
  spread_md: string;
  signoff: string;
  content_lines_json: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

export interface WritingKitInput {
  name?: string;
  description?: string;
  positioningMd?: string;
  writingMd?: string;
  titleMd?: string;
  spreadMd?: string;
  signoff?: string;
  contentLines?: ContentLine[];
}

const BUILTIN_KITS: Array<{
  id: string;
  name: string;
  description: string;
  signoff: string;
  lines: ContentLine[];
  positioningMd: () => string;
  writingMd: () => string;
  titleMd: () => string;
  spreadMd: () => string;
}> = [];

// 内置模板在文件末尾 registerBuiltinKits() 时填充（内容长，放独立常量文件）
import { builtinKits as builtinDefs } from './writingKitBuiltins.js';

function rowToKit(r: WritingKitRow): WritingKitRow & { contentLines: ContentLine[] } {
  let lines: ContentLine[] = [];
  try {
    const parsed = JSON.parse(r.content_lines_json);
    if (Array.isArray(parsed)) lines = parsed.filter((x) => x && typeof x.key === 'string');
  } catch { /* ignore */ }
  return { ...r, is_builtin: r.is_builtin ? 1 : 0, contentLines: lines };
}

export type WritingKit = ReturnType<typeof rowToKit>;

export function listKits(): WritingKit[] {
  const rows = getDb()
    .prepare('SELECT * FROM cf_writing_kits ORDER BY is_builtin DESC, created_at')
    .all() as unknown as WritingKitRow[];
  return rows.map(rowToKit);
}

export function getKit(id: string): WritingKit | undefined {
  const r = getDb().prepare('SELECT * FROM cf_writing_kits WHERE id=?').get(id) as WritingKitRow | undefined;
  return r ? rowToKit(r) : undefined;
}

/** 取主体挂载的规范包（未挂载返回 undefined） */
export function getProjectKit(projectId: string): WritingKit | undefined {
  const row = getDb().prepare('SELECT kit_id FROM projects WHERE id=?').get(projectId) as
    | { kit_id: string | null }
    | undefined;
  return row?.kit_id ? getKit(row.kit_id) : undefined;
}

export function mountKit(projectId: string, kitId: string | null): void {
  getDb()
    .prepare('UPDATE projects SET kit_id=?, updated_at=? WHERE id=?')
    .run(kitId, new Date().toISOString(), projectId);
  touchProject(projectId);
}

export function createKit(input: WritingKitInput & { name: string }): WritingKit {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO cf_writing_kits
         (id, name, description, positioning_md, writing_md, title_md, spread_md, signoff, content_lines_json, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      id,
      input.name.trim(),
      input.description ?? '',
      input.positioningMd ?? '',
      input.writingMd ?? '',
      input.titleMd ?? '',
      input.spreadMd ?? '',
      input.signoff ?? '',
      JSON.stringify(input.contentLines ?? []),
      now,
      now
    );
  return getKit(id)!;
}

export function updateKit(id: string, patch: WritingKitInput): WritingKit | undefined {
  const existing = getKit(id);
  if (!existing) return undefined;
  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Array<[keyof WritingKitInput, string]> = [
    ['name', 'name'],
    ['description', 'description'],
    ['positioningMd', 'positioning_md'],
    ['writingMd', 'writing_md'],
    ['titleMd', 'title_md'],
    ['spreadMd', 'spread_md'],
    ['signoff', 'signoff'],
  ];
  for (const [inp, col] of map) {
    const v = patch[inp];
    if (typeof v === 'string') {
      fields.push(`${col}=?`);
      values.push(v);
    }
  }
  if (Array.isArray(patch.contentLines)) {
    fields.push('content_lines_json=?');
    values.push(JSON.stringify(patch.contentLines.filter((l) => l?.key)));
  }
  if (fields.length === 0) return existing;
  fields.push('updated_at=?');
  values.push(new Date().toISOString());
  values.push(id);
  getDb().prepare(`UPDATE cf_writing_kits SET ${fields.join(', ')} WHERE id=?`).run(...(values as any[]));
  return getKit(id);
}

export function deleteKit(id: string): { ok: boolean; error?: string } {
  const kit = getKit(id);
  if (!kit) return { ok: false, error: '规范包不存在' };
  if (kit.is_builtin) return { ok: false, error: '内置模板不能删除（可复制后改）' };
  // 解除挂载再删
  getDb().prepare("UPDATE projects SET kit_id=NULL WHERE kit_id=?").run(id);
  getDb().prepare('DELETE FROM cf_writing_kits WHERE id=?').run(id);
  return { ok: true };
}

/** 基于现有规范包（含内置模板）复制一份可编辑副本 */
export function duplicateKit(id: string, newName?: string): WritingKit | undefined {
  const src = getKit(id);
  if (!src) return undefined;
  return createKit({
    name: (newName || `${src.name} 副本`).trim(),
    description: src.description,
    positioningMd: src.positioning_md,
    writingMd: src.writing_md,
    titleMd: src.title_md,
    spreadMd: src.spread_md,
    signoff: src.signoff,
    contentLines: src.contentLines,
  });
}

/**
 * 启动时播种内置模板（已存在同名内置模板则跳过，内容更新走显式升级）。
 */
export function seedBuiltinKits(force = false): void {
  const d = getDb();
  for (const def of builtinDefs) {
    const existing = d
      .prepare('SELECT id FROM cf_writing_kits WHERE id=?')
      .get(def.id) as { id: string } | undefined;
    if (existing && !force) continue;
    const now = new Date().toISOString();
    const payload = {
      id: def.id,
      name: def.name,
      description: def.description,
      positioning_md: def.positioningMd,
      writing_md: def.writingMd,
      title_md: def.titleMd,
      spread_md: def.spreadMd,
      signoff: def.signoff,
      content_lines_json: JSON.stringify(def.lines),
    };
    if (existing) {
      d.prepare(
        `UPDATE cf_writing_kits SET name=:name, description=:description, positioning_md=:positioning_md,
           writing_md=:writing_md, title_md=:title_md, spread_md=:spread_md, signoff=:signoff,
           content_lines_json=:content_lines_json, updated_at=:now WHERE id=:id`
      ).run({ ...payload, now });
    } else {
      d.prepare(
        `INSERT INTO cf_writing_kits
           (id, name, description, positioning_md, writing_md, title_md, spread_md, signoff, content_lines_json, is_builtin, created_at, updated_at)
         VALUES (:id, :name, :description, :positioning_md, :writing_md, :title_md, :spread_md, :signoff, :content_lines_json, 1, :now, :now)`
      ).run({ ...payload, now });
    }
  }
}

// 保持 BUILTIN_KITS 引用占位（类型完整性）
void BUILTIN_KITS;
