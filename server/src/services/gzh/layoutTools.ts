// ============================================
// 公众号排版 · 组件工具 + GzhBuilder
// LLM 只调这些工具搭文章，不碰任何 HTML/样式。
// 每次调用即时校验并累积成 GzhBlock；返回结果给模型，错了当场返工。
// ============================================

import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { GzhBlock, GzhDoc, Inline } from './types.js';

/** 行内片段：plain 文本或带 mark 语义（under/strong/mark/code/strike） */
interface Seg {
  s: string;
  mark?: 'under' | 'strong' | 'mark' | 'code' | 'strike';
}

function toInline(segs: Seg[] | undefined): Inline[] {
  if (!Array.isArray(segs)) return [];
  return segs
    .filter((x) => x && typeof x.s === 'string' && x.s.length)
    .map((x) => (x.mark ? { t: x.mark, c: x.s } : x.s) as Inline);
}

const SEGMENTS_DESC = {
  type: 'array',
  description: '行内片段序列；每个片段 s 是文字，mark 可选（under=橙下划线关键词，strong=加粗，mark=浅底高亮，code=行内代码，strike=删除线）。省略 mark 即普通文字。',
  items: {
    type: 'object',
    properties: {
      s: { type: 'string', description: '片段文字' },
      mark: { type: 'string', enum: ['under', 'strong', 'mark', 'code', 'strike'] },
    },
    required: ['s'],
  },
};

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
  };
}

export const LAYOUT_TOOLS: ChatCompletionTool[] = [
  fn(
    'add_editor_note',
    '添加开头「写在前面」编者按（全文第一个组件、仅一处）。多段落用 paragraphs，每段是行内片段序列。',
    {
      label: { type: 'string', description: '标题条文字，默认「写在前面」' },
      paragraphs: {
        type: 'array',
        description: '编者按段落（可多段），每段是行内片段序列',
        items: SEGMENTS_DESC,
      },
    },
    ['paragraphs']
  ),
  fn(
    'start_section',
    '开始一个编号章节（01/02/03 自动编号）。标题中文，en 为英文副标题。',
    {
      title: { type: 'string' },
      en: { type: 'string', description: '英文副标题，如 THE MOST DECENT EXCUSE' },
    },
    ['title']
  ),
  fn(
    'end_section',
    '开始结尾章节，编号固定 ∞ / THE END。仅用于全文最后一章。',
    {
      title: { type: 'string' },
      en: { type: 'string' },
    },
    ['title']
  ),
  fn(
    'add_paragraph',
    '添加一个正文段落。必须主动为每段挑选 1-3 个关键短语，用 mark=under 标橙下划线。',
    { segments: SEGMENTS_DESC },
    ['segments']
  ),
  fn(
    'add_bullets',
    '添加无序列表（简单并列条目）。每个 item 是一段行内片段。',
    { items: { type: 'array', items: SEGMENTS_DESC } },
    ['items']
  ),
  fn(
    'add_keypoint',
    '添加重点观点卡：point 为橙色下划线加粗的核心短语，extra 为其后的补充说明。',
    { point: SEGMENTS_DESC, extra: SEGMENTS_DESC },
    ['point']
  ),
  fn(
    'add_action_guide',
    '添加行动指南卡（深色标题条 + 编号步骤）。每个 step 是一条行内片段。',
    {
      label: { type: 'string', description: '默认「行动指南」' },
      steps: { type: 'array', items: SEGMENTS_DESC },
    },
    ['steps']
  ),
  fn(
    'add_compare',
    '添加左右对比摘要卡（A vs B）：left 深底、right 浅底。',
    {
      leftTitle: { type: 'string' },
      leftDesc: { type: 'string' },
      rightTitle: { type: 'string' },
      rightDesc: { type: 'string' },
    },
    ['leftTitle', 'leftDesc', 'rightTitle', 'rightDesc']
  ),
  fn(
    'add_pills',
    '添加路线胶囊组：一排阶段标签。',
    {
      label: { type: 'string' },
      items: { type: 'array', items: { type: 'string' } },
    },
    ['items']
  ),
  fn('add_dots', '添加三色圆点分隔符。', {}, []),
  fn(
    'add_closing',
    '添加暗色 CLOSING 金句边框（全文结尾仅一处）。',
    { segments: SEGMENTS_DESC },
    ['segments']
  ),
];

export class GzhBuilder {
  private blocks: GzhBlock[] = [];
  private sectionCount = 0;
  private editorNoteUsed = false;
  private endSectionUsed = false;
  private closingUsed = false;

  /** 处理一次工具调用，返回给模型的结果文本 */
  handle(name: string, args: Record<string, unknown>): string {
    try {
      switch (name) {
        case 'add_editor_note': {
          if (this.editorNoteUsed) return '错误：编者按已添加过，全文仅一处。';
          const paragraphs = (args.paragraphs as Seg[][]) || [];
          const ps = paragraphs.map(toInline).filter((p) => p.length);
          if (!ps.length) return '错误：编者按段落为空。';
          // 多段落用 \n\n 串到一个 editorNote（toParagraphs 会还原）
          const joined: Inline[] = [];
          ps.forEach((p, i) => {
            if (i > 0) joined.push('\n\n');
            joined.push(...p);
          });
          this.blocks.push({ kind: 'editorNote', label: args.label as string, text: joined });
          this.editorNoteUsed = true;
          return `ok：编者按已添加（${ps.length} 段），当前共 ${this.blocks.length} 个组件。`;
        }
        case 'start_section': {
          if (this.endSectionUsed) return '错误：结尾章节之后不能再加普通章节。';
          this.sectionCount += 1;
          this.blocks.push({
            kind: 'section',
            title: String(args.title || ''),
            en: args.en as string,
          });
          return `ok：第 ${String(this.sectionCount).padStart(2, '0')} 章「${args.title}」已开始。`;
        }
        case 'end_section': {
          this.endSectionUsed = true;
          this.blocks.push({
            kind: 'endSection',
            title: String(args.title || ''),
            en: args.en as string,
          });
          return `ok：结尾章节 ∞「${args.title}」已开始。`;
        }
        case 'add_paragraph': {
          const text = toInline(args.segments as Seg[]);
          if (!text.length) return '错误：段落内容为空。';
          this.blocks.push({ kind: 'paragraph', text });
          return `ok：正文段落已添加，当前共 ${this.blocks.length} 个组件。`;
        }
        case 'add_bullets': {
          const items = ((args.items as Seg[][]) || []).map(toInline).filter((x) => x.length);
          if (!items.length) return '错误：列表条目为空。';
          this.blocks.push({ kind: 'bullets', items });
          return `ok：列表已添加（${items.length} 条）。`;
        }
        case 'add_keypoint': {
          const point = toInline(args.point as Seg[]);
          if (!point.length) return '错误：重点观点为空。';
          const extra = toInline(args.extra as Seg[]);
          this.blocks.push({
            kind: 'keyPoint',
            point,
            extra: extra.length ? extra : undefined,
          });
          return 'ok：重点观点卡已添加。';
        }
        case 'add_action_guide': {
          const steps = ((args.steps as Seg[][]) || []).map(toInline).filter((x) => x.length);
          if (!steps.length) return '错误：行动步骤为空。';
          this.blocks.push({
            kind: 'actionGuide',
            label: args.label as string,
            steps,
          });
          return `ok：行动指南已添加（${steps.length} 步）。`;
        }
        case 'add_compare': {
          this.blocks.push({
            kind: 'compare',
            left: { title: String(args.leftTitle || ''), desc: String(args.leftDesc || '') },
            right: { title: String(args.rightTitle || ''), desc: String(args.rightDesc || '') },
          });
          return 'ok：对比卡已添加。';
        }
        case 'add_pills': {
          const items = ((args.items as string[]) || []).map(String).filter(Boolean);
          if (!items.length) return '错误：胶囊项为空。';
          this.blocks.push({ kind: 'pills', label: args.label as string, items });
          return `ok：胶囊组已添加（${items.length} 项）。`;
        }
        case 'add_dots': {
          this.blocks.push({ kind: 'dots' });
          return 'ok：圆点分隔已添加。';
        }
        case 'add_closing': {
          if (this.closingUsed) return '错误：CLOSING 金句已添加，全文仅一处。';
          const quote = toInline(args.segments as Seg[]);
          if (!quote.length) return '错误：金句内容为空。';
          this.blocks.push({ kind: 'closing', quote });
          this.closingUsed = true;
          return 'ok：CLOSING 金句已添加。';
        }
        default:
          return `错误：未知工具 ${name}`;
      }
    } catch (e) {
      return `错误：工具执行异常 ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  build(signoff?: GzhDoc['signoff']): GzhDoc {
    return { blocks: this.blocks, signoff };
  }

  get count(): number {
    return this.blocks.length;
  }
}
