// ============================================
// 公众号排版 · 结构化稿件类型
// 渲染器只认这份结构；LLM / 小弟都产出它，平台确定性渲染 HTML。
// 设计原则：内容与结构决策是输入，样式零选择——全部内建在渲染器里。
// ============================================

/** 行内片段：字符串 = 普通正文；对象 = 带语义标记 */
export type Inline =
  | string
  | { t: 'strong'; c: Inline }   // 强调加粗（术语/产品名）
  | { t: 'under'; c: Inline }    // 橙色下划线（正文关键词，默认标记）
  | { t: 'mark'; c: Inline }     // 浅底高亮框（关键信息/数据）
  | { t: 'code'; c: Inline }     // 行内代码
  | { t: 'strike'; c: Inline };  // 删除线旧词

export type InlineContent = Inline | Inline[];

export interface EditorNoteBlock {
  kind: 'editorNote';
  label?: string;   // 默认「写在前面」
  meta?: string;    // 默认 EDITOR'S NOTE
  text: InlineContent;
}

export interface SectionBlock {
  kind: 'section';
  num?: string;     // 不传则按出现顺序自动 01/02/03
  title: string;
  en?: string;      // 英文副标题
}

export interface EndSectionBlock {
  kind: 'endSection';
  title: string;    // 编号固定 ∞ / THE END
  en?: string;
}

export interface ParagraphBlock {
  kind: 'paragraph';
  text: InlineContent;
}

export interface BulletsBlock {
  kind: 'bullets';
  items: InlineContent[];
}

export interface KeyPointBlock {
  kind: 'keyPoint';
  point: InlineContent;  // 橙色下划线加粗的重点
  extra?: InlineContent; // 补充说明
}

export interface ActionGuideBlock {
  kind: 'actionGuide';
  label?: string;   // 默认「行动指南」
  meta?: string;    // 默认 ACTION GUIDE
  steps: InlineContent[];
}

export interface CompareBlock {
  kind: 'compare';
  left: { title: string; desc: string };
  right: { title: string; desc: string };
}

export interface PillsBlock {
  kind: 'pills';
  label?: string;
  items: string[];
}

export interface DotsBlock {
  kind: 'dots';
}

export interface ClosingBlock {
  kind: 'closing';
  label?: string;   // 默认 CLOSING
  quote: InlineContent;
}

export type GzhBlock =
  | EditorNoteBlock
  | SectionBlock
  | EndSectionBlock
  | ParagraphBlock
  | BulletsBlock
  | KeyPointBlock
  | ActionGuideBlock
  | CompareBlock
  | PillsBlock
  | DotsBlock
  | ClosingBlock;

export interface GzhSignoff {
  author: string;   // 作者名
  intro: string;    // 一句话简介
}

export interface GzhDoc {
  blocks: GzhBlock[];
  signoff?: GzhSignoff;
}
