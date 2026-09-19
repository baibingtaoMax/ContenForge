// ============================================
// Skill 加载器
// 扫描 server/skills/ 目录，加载 SKILL.md，解析 frontmatter
// 提供读 + 写（新建/编辑/删除/启用禁用）能力
// ============================================

import { readdir, readFile, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/src/skills/loader.ts → server/skills/
const SKILLS_DIR = join(__dirname, '..', '..', 'skills');
// 内置技能库（随仓库分发，未安装前不生效）
const LIBRARY_DIR = join(__dirname, '..', '..', 'skills-library');

export interface SkillMeta {
  /** 技能文件夹名（kebab-case，唯一标识） */
  id: string;
  /** 展示名称 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 关键词（辅助接待员意图匹配） */
  keywords: string[];
  /** 该技能声明需要的额外工具（函数名，主要是未全局绑定给执行员的 MCP 工具） */
  tools: string[];
  /** 是否启用（禁用的技能对执行员/接待员/选择器不可见） */
  enabled: boolean;
  /** SKILL.md 正文（去掉 frontmatter） */
  body: string;
  /** 文件夹路径 */
  path: string;
}

let cache: SkillMeta[] | null = null;

/** 合法技能 ID：小写字母、数字、连字符 */
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 校验技能 ID，不合法抛错 */
function assertValidId(id: string) {
  if (!id || !ID_RE.test(id) || id.length > 64) {
    throw new Error('技能 ID 只能包含小写字母、数字、连字符（kebab-case），长度 1-64');
  }
}

/** 简易 YAML frontmatter 解析（不引依赖） */
function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };

  const fm = match[1];
  const body = match[2];
  const meta: Record<string, unknown> = {};

  for (const line of fm.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    const v = value.trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[key] = v
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      meta[key] = v.replace(/^["']|["']$/g, '');
    }
  }

  return { meta, body };
}

/** 序列化为 frontmatter + body */
function serializeSkill(input: { id: string; name: string; description: string; keywords: string[]; tools: string[]; enabled: boolean; body: string }): string {
  const fm = [
    '---',
    `name: ${input.name}`,
    `description: ${input.description}`,
    `keywords: [${input.keywords.join(', ')}]`,
    `tools: [${input.tools.join(', ')}]`,
    `enabled: ${input.enabled}`,
    '---',
    '',
  ].join('\n');
  return fm + input.body.trim() + '\n';
}

async function loadOne(dir: string): Promise<SkillMeta | null> {
  const id = dir.split('/').pop() || dir;
  const skillFile = join(dir, 'SKILL.md');
  try {
    const s = await stat(skillFile);
    if (!s.isFile()) return null;
  } catch {
    return null;
  }

  const raw = await readFile(skillFile, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);

  return {
    id,
    name: (meta.name as string) || id,
    description: (meta.description as string) || '',
    keywords: (meta.keywords as string[]) || [],
    tools: Array.isArray(meta.tools) ? (meta.tools as string[]) : [],
    // 旧技能没有 enabled 字段，默认启用
    enabled: meta.enabled === undefined ? true : meta.enabled !== 'false',
    body: body.trim(),
    path: dir,
  };
}

/** 扫描并加载所有 skill */
export async function loadSkills(force = false): Promise<SkillMeta[]> {
  if (cache && !force) return cache;

  let entries: string[] = [];
  try {
    entries = await readdir(SKILLS_DIR);
  } catch {
    cache = [];
    return cache;
  }

  const skills: SkillMeta[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const fullPath = join(SKILLS_DIR, name);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        const skill = await loadOne(fullPath);
        if (skill) skills.push(skill);
      }
    } catch {
      // skip
    }
  }

  cache = skills;
  return skills;
}

/** 按 ID 获取单个 skill */
export async function getSkill(id: string): Promise<SkillMeta | null> {
  const skills = await loadSkills();
  return skills.find((s) => s.id === id) || null;
}

/** 返回给前端的简要列表（不含 body）；includeDisabled=true 时包含禁用技能（管理页用） */
export async function listSkillSummaries(includeDisabled = false): Promise<
  Array<{ id: string; name: string; description: string; keywords: string[]; tools: string[]; enabled: boolean }>
> {
  const skills = await loadSkills();
  return skills
    .filter((s) => includeDisabled || s.enabled)
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      keywords: s.keywords,
      tools: s.tools,
      enabled: s.enabled,
    }));
}

// ============================================
// 写操作（新建/编辑/删除/启用禁用）
// ============================================

/** 解析并安全拼接技能目录，防路径穿越 */
function skillDir(id: string): string {
  assertValidId(id);
  const dir = resolve(SKILLS_DIR, id);
  const normalized = normalize(dir);
  if (!normalized.startsWith(resolve(SKILLS_DIR))) {
    throw new Error('非法技能 ID');
  }
  return normalized;
}

/** 新建技能（写 SKILL.md）。id 重复抛错。 */
export async function createSkill(input: {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  tools?: string[];
  body: string;
  enabled?: boolean;
}): Promise<SkillMeta> {
  assertValidId(input.id);
  const existing = await getSkill(input.id);
  if (existing) throw new Error(`技能 ${input.id} 已存在`);

  const dir = skillDir(input.id);
  await mkdir(dir, { recursive: true });
  const enabled = input.enabled !== false;
  await writeFile(
    join(dir, 'SKILL.md'),
    serializeSkill({ ...input, tools: input.tools || [], enabled }),
    'utf-8'
  );
  await loadSkills(true);
  return (await getSkill(input.id))!;
}

/** 更新技能（重写 SKILL.md）。id 不可改。 */
export async function updateSkill(
  id: string,
  input: { name?: string; description?: string; keywords?: string[]; tools?: string[]; body?: string; enabled?: boolean }
): Promise<SkillMeta> {
  const skill = await getSkill(id);
  if (!skill) throw new Error('技能不存在');

  const merged = {
    id: skill.id,
    name: input.name ?? skill.name,
    description: input.description ?? skill.description,
    keywords: input.keywords ?? skill.keywords,
    tools: input.tools ?? skill.tools,
    enabled: input.enabled ?? skill.enabled,
    body: input.body ?? skill.body,
  };
  await writeFile(join(skill.path, 'SKILL.md'), serializeSkill(merged), 'utf-8');
  await loadSkills(true);
  return (await getSkill(id))!;
}

/** 删除技能（删整个目录） */
export async function deleteSkill(id: string): Promise<void> {
  const skill = await getSkill(id);
  if (!skill) throw new Error('技能不存在');
  await rm(skill.path, { recursive: true, force: true });
  await loadSkills(true);
}

// ============================================
// 内置技能库（市场）
// ============================================

export interface LibrarySkill {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  installed: boolean;
}

/** 列出技能库中所有技能，标记是否已安装 */
export async function listLibrarySkills(): Promise<LibrarySkill[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(LIBRARY_DIR);
  } catch {
    return [];
  }
  const installed = await loadSkills(true);
  const installedIds = new Set(installed.map((s) => s.id));
  const result: LibrarySkill[] = [];
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    const dir = join(LIBRARY_DIR, name);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
      const raw = await readFile(join(dir, 'SKILL.md'), 'utf-8');
      const { meta } = parseFrontmatter(raw);
      result.push({
        id: name,
        name: (meta.name as string) || name,
        description: (meta.description as string) || '',
        keywords: (meta.keywords as string[]) || [],
        installed: installedIds.has(name),
      });
    } catch {
      // skip
    }
  }
  return result;
}

/** 从内置库安装技能（复制 SKILL.md 到启用目录） */
export async function installFromLibrary(libraryId: string): Promise<SkillMeta> {
  assertValidId(libraryId);
  if (await getSkill(libraryId)) throw new Error(`技能 ${libraryId} 已安装`);
  const src = join(LIBRARY_DIR, libraryId, 'SKILL.md');
  try {
    await stat(src);
  } catch {
    throw new Error(`技能库中不存在 ${libraryId}`);
  }
  const raw = await readFile(src, 'utf-8');
  const dir = skillDir(libraryId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), raw, 'utf-8');
  await loadSkills(true);
  const skill = await getSkill(libraryId);
  if (!skill) throw new Error('安装后加载失败');
  return skill;
}

/** 从上传的 SKILL.md 文本内容安装/新建技能。若 id 已存在则报错（避免覆盖，改用编辑）。 */
export async function installFromContent(
  id: string,
  rawContent: string
): Promise<SkillMeta> {
  assertValidId(id);
  if (await getSkill(id)) throw new Error(`技能 ${id} 已存在，请改用编辑`);
  // 简单校验：必须能解析出 name
  const { meta } = parseFrontmatter(rawContent);
  if (!meta.name) throw new Error('SKILL.md 缺少 frontmatter 中的 name 字段');
  const dir = skillDir(id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), rawContent, 'utf-8');
  await loadSkills(true);
  const skill = await getSkill(id);
  if (!skill) throw new Error('安装后加载失败');
  return skill;
}
