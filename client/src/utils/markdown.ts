import { marked } from 'marked'

// 配置 marked
marked.setOptions({
  breaks: true, // \n 转 <br>
  gfm: true,    // 表格、删除线等 GFM 语法
})

/**
 * 渲染 Markdown 为 HTML。
 * 内容来自模型输出，做最基本的 XSS 防护：移除 <script> 标签和 on* 事件属性。
 */
export function renderMarkdown(text: string): string {
  if (!text) return ''
  const raw = marked.parse(text, { async: false }) as string
  return raw
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '')
}
