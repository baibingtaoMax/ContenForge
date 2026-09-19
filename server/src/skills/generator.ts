// ============================================
// AI 起草 SKILL.md
// 用户描述需求 → LLM 生成技能说明书草稿
// ============================================

import OpenAI from 'openai';
import { getConfig, getModelForRole } from '../config/index.js';
import { buildToolCatalogForPrompt } from './toolCatalog.js';

export interface GenerateSkillInput {
  /** 用户对技能的描述：用途、步骤、输出等 */
  description: string;
  /** 可选：技能名称提示 */
  name?: string;
}

export interface GenerateSkillResult {
  /** 建议的技能 id（kebab-case） */
  id: string;
  name: string;
  description: string;
  keywords: string[];
  /** AI 选出的该技能需要的工具函数名（来自工具目录，可包含 MCP 工具） */
  tools: string[];
  /** 完整 SKILL.md 文本（含 frontmatter） */
  raw: string;
}

function buildSystemPrompt(): string {
  return `你是 ProtoForge（需求-原型工作台）的"技能说明书"撰写专家。
平台的"技能"是一份 Markdown 说明书（SKILL.md），指导"技能执行员"智能体按固定 SOP 完成产品经理日常的套路活：读取项目材料（上传的需求文档/截图/表格、竞品网页、已沉淀的需求清单、已生成的原型、项目历史记忆）→ 按固定维度做结构化分析 → 输出标准化成果（体检清单、要素核对表、字段表、验收用例、变更影响分析、规范化文档等）。
技能不是自由问答，价值在于"检查单不遗漏、输出格式固定可复用"。

可用工具（技能执行员能调用）：
${buildToolCatalogForPrompt()}

输出要求：
1. 只输出一个 JSON 对象，不要任何额外文字、不要 markdown 代码块包裹。
2. JSON 字段：
   - id：kebab-case 英文标识（如 requirement-health-check）
   - name：中文技能名
   - description：一句话说明用途和触发场景
   - keywords：3-6 个中文关键词数组
   - tools：该技能执行时需要调用的工具函数名数组（从上面“可用工具”清单里选，只选步骤里真正会用到的，名字必须与清单完全一致；纯分析、不读材料就留空数组）
   - body：SKILL.md 正文（不含 frontmatter），Markdown，必须包含“## 角色定位”“## 执行步骤”“## 输出格式”“## 注意事项”四个章节
3. description 除了说用途，还要写清**触发场景**（PM 怎么说、什么时候该用这个技能），供意图匹配。
4. 写作质量要求（参照平台内置技能风格）：
   - 角色定位：一句话说清"你是谁、专门在什么环节做什么、你的价值是什么"（例如价值是挑漏项，不是夸成果）。
   - 执行步骤：按执行先后编号，具体到"先调用哪个工具读什么材料 → 按什么维度/检查单逐项分析 → 每一项怎么判断（有/模糊/缺的判定口径）"；需要工具的步骤用 \`工具名\` 反引号写出，工具名必须与上面清单完全一致，**严禁编造清单里不存在的工具**。
   - 输出格式：给出可直接套用的成品模板（Markdown 表格或固定章节），不要只说"输出一份报告"。
   - 注意事项：写清边界——不替 PM 编造需求内容、推断的内容要标注"建议确认"、材料不足时明确说缺什么。
5. 全程中文，措辞面向产品经理，不要出现金融风控领域的专属概念（征信、担保圈、授信等），除非用户的需求描述本身明确涉及。`;
}

export async function generateSkillDraft(input: GenerateSkillInput): Promise<GenerateSkillResult> {
  const cfg = getConfig();
  const model = getModelForRole('receptionist');
  const client = new OpenAI({ apiKey: cfg.llm.apiKey, baseURL: cfg.llm.baseUrl });

  const userPrompt = [
    `请帮我起草一个技能。`,
    input.name ? `建议名称：${input.name}` : '',
    `技能需求描述：${input.description}`,
    '',
    '请严格按系统要求输出 JSON。',
  ].filter(Boolean).join('\n');

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userPrompt },
    ],
  });

  const text = resp.choices[0]?.message?.content?.trim() || '';
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI 返回的内容不是合法 JSON，无法生成技能草稿');
  }

  const id = String(parsed.id || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!id) throw new Error('AI 未生成有效的技能 ID');
  const name = String(parsed.name || '').trim();
  const description = String(parsed.description || '').trim();
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map((k: any) => String(k)) : [];
  const tools = Array.isArray(parsed.tools) ? parsed.tools.map((t: any) => String(t)).filter(Boolean) : [];
  const body = String(parsed.body || '').trim();

  // 组装完整 SKILL.md（含 frontmatter）
  const raw = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `keywords: [${keywords.join(', ')}]`,
    `tools: [${tools.join(', ')}]`,
    `enabled: true`,
    '---',
    '',
    body,
    '',
  ].join('\n');

  return { id, name, description, keywords, tools, raw };
}
