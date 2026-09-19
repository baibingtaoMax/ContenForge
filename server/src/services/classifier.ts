// ============================================
// 附件分类标签（ProtoForge：需求/原型参考材料）
// 不在上传时调模型分类——类别只用于展示，需求顾问读内容时自己判断。
// ============================================

import type { AttachmentCategory } from '../types/index.js';

const CATEGORY_LABELS: Record<string, string> = {
  doc: '需求/参考文档',
  screenshot: '截图/图片',
  form: '表格/清单',
  prototype: '原型/设计稿',
  contract: '合同/协议',
  report: '报告',
  data: '数据样例',
  webpage: '网页链接',
  embed: '文档内嵌图',
  other: '其他',
  // 旧分类（RAP 风控材料体系）兼容：老附件显示中文而不是英文 key
  financial: '需求/参考文档',
  credit: '需求/参考文档',
  business_license: '需求/参考文档',
  litigation: '需求/参考文档',
  tax: '需求/参考文档',
  id_document: '其他',
};

/** 按文件名关键词粗略推断类别（仅展示用，不准也无所谓） */
export function inferCategoryFromFilename(filename: string): AttachmentCategory {
  const name = filename.toLowerCase();
  // 关键词优先于扩展名（原型图/数据样例常以图片/表格形式存在）
  if (/原型|设计稿|figma|mockup|wireframe|prototype/.test(filename)) return 'prototype';
  if (/数据|样例|导出|data|sample/.test(filename)) return 'data';
  if (/合同|协议|contract|agreement/.test(filename)) return 'contract';
  if (/报告|报表|总结|report/.test(filename)) return 'report';
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name) || /截图|截屏|screenshot|图片/.test(filename))
    return 'screenshot';
  if (/\.(xlsx?|csv)$/.test(name) || /表|清单|台账|字段/.test(filename)) return 'form';
  if (/\.(pdf|docx?|md|txt|pptx?|key)$/.test(name) || /需求|说明|文档|prd|spec|方案|流程/.test(filename)) return 'doc';
  return 'other';
}

export { CATEGORY_LABELS };
