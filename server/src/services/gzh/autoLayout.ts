// ============================================
// 公众号 AI 排版编排
// 读主稿 Markdown → LLM 调组件工具搭结构 → 确定性渲染橄榄手记成品。
// 模型全程不写 HTML/样式，只做内容理解与组件选择。
// ============================================

import { chatCompletionWithTools } from '../../llm/client.js';
import { renderGzh } from './renderer.js';
import { validateLayoutHtml } from './validate.js';
import { GzhBuilder, LAYOUT_TOOLS } from './layoutTools.js';
import type { GzhDoc, GzhSignoff } from './types.js';

export interface AutoLayoutResult {
  ok: boolean;
  html?: string;
  /** 无图结构稿基线，供「采用配图」按锚点幂等合并 */
  doc?: GzhDoc;
  leafCount?: number;
  error?: string;
  componentCount?: number;
  /** 模型的旁白/决策说明，供界面展示 */
  narration?: string;
}

function buildSystemPrompt(): string {
  return `你是公众号「橄榄手记」风格的资深排版师。你的任务是把作者给的主稿，用一批"组件工具"搭成一篇排版成品。

## 你怎么干活

1. 先通读主稿，理清结构：开头场景/引言、章节怎么切、哪些是核心观点、金句、对比、行动步骤。
2. 然后按文章顺序，**一件一件调组件工具**把文章搭出来。你全程不写任何 HTML 标签、不碰样式——这些平台会自动渲染。
3. 组件选择参考下面的"组件用法"，要贴合内容，不要堆砌、不要漏内容。原文的每一个段落、每一层意思都要搭进去，不得增删实质内容。

## 组件用法

- **add_editor_note**：全文第一个组件，开头的场景/引言/编者按，仅一处。可多段。
- **start_section**：每个大章节开头，编号自动生成。标题用原文的小标题；en 给一个贴切的英文副标题。
- **end_section**：全文最后一章（结语/总结），编号固定 ∞。
- **add_paragraph**：普通正文段落。**每个正文段落都必须主动挑 1-3 个最关键的短语**，用 mark=under 标橙下划线——这是本风格的核心。优先标核心观点、结论、关键数据、专有名词；短语 4-15 字。整段确实无要点可不标。
- **add_bullets**：简单并列条目。
- **add_keypoint**：需要独立强调的重点观点卡。
- **add_action_guide**：可执行的行动步骤清单。
- **add_compare**：二元对比（A vs B），左深右浅。
- **add_pills**：阶段/路线标签。
- **add_dots**：轻松的圆点分隔。
- **add_closing**：结尾最强金句边框，全文仅一处。

## 铁律

- **标点一律用中文全角**（，。！？：；""''——…），不要半角。但原文里的英文专名/代码内部保持原样。
- 锚点层最强强调（keypoint/closing）全文克制，不要到处都是。
- 每个工具调用都会立即校验，返回"错误：…"就按提示修正后重试，不要带着错往下走。
- 全部组件搭完后，用一句话说明你的排版决策（章节结构、关键标记思路），不要复述原文。`;
}

export async function autoLayoutGzh(params: {
  docMd: string;
  title?: string;
  signoff?: GzhSignoff;
}): Promise<AutoLayoutResult> {
  // plan 网关偶发：模型首轮不发起任何 tool_calls 直接回文本。零组件时自动重试一次。
  const MAX_ATTEMPTS = 2;
  let builder = new GzhBuilder();
  let narration = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    builder = new GzhBuilder();

    const toolHandlers: Record<string, (args: Record<string, unknown>) => string> = {
      add_editor_note: (a) => builder.handle('add_editor_note', a),
      start_section: (a) => builder.handle('start_section', a),
      end_section: (a) => builder.handle('end_section', a),
      add_paragraph: (a) => builder.handle('add_paragraph', a),
      add_bullets: (a) => builder.handle('add_bullets', a),
      add_keypoint: (a) => builder.handle('add_keypoint', a),
      add_action_guide: (a) => builder.handle('add_action_guide', a),
      add_compare: (a) => builder.handle('add_compare', a),
      add_pills: (a) => builder.handle('add_pills', a),
      add_dots: (a) => builder.handle('add_dots', a),
      add_closing: (a) => builder.handle('add_closing', a),
    };

    const messages = [
      { role: 'system' as const, content: buildSystemPrompt() },
      {
        role: 'user' as const,
        content: `请把下面这篇主稿排版成橄榄手记成品，逐件调用组件工具。\n\n# ${params.title || ''}\n\n${params.docMd}`,
      },
    ];
    if (attempt > 1) {
      messages.push({
        role: 'user' as const,
        content:
          '上一轮你没有调用任何组件工具。严禁直接输出正文或说明文字——必须从调用 add_editor_note 开始，逐件调用组件工具把全文搭完，最后再给一句话说明。',
      });
    }

    narration = await chatCompletionWithTools({
      messages,
      tools: LAYOUT_TOOLS,
      toolHandlers,
      maxRounds: 120,
      temperature: 0.3,
    });

    if (builder.count > 0) break;
  }

  if (builder.count === 0) {
    return { ok: false, error: '模型未搭出任何组件（已自动重试）', narration };
  }

  const doc = builder.build(params.signoff);
  const html = renderGzh(doc);
  const { errors, leafCount } = validateLayoutHtml(html);
  if (errors.length) {
    return { ok: false, error: `成品未通过校验：${errors.join('；')}`, leafCount, componentCount: builder.count, narration };
  }

  return { ok: true, html, doc, leafCount, componentCount: builder.count, narration };
}
