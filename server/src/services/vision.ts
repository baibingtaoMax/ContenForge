// ============================================
// 图片视觉解析：把图片交给视觉模型转成文本
// 用于附件中的图片/扫描件（A 方向：图→文本，结果缓存进 extracted_text）
// ============================================

import fs from 'node:fs/promises';
import OpenAI from 'openai';
import { getConfig, getModelForRole } from '../config/index.js';

type ImageInput = string | Buffer;

const VISION_PROMPT = `你是一个严谨的文档信息提取助手。请仔细识别这张图片中的全部文字与关键信息，它可能是现有系统的页面截图、手绘流程图、需求文档、表格、合同或其他业务材料。

要求：
1. 尽可能完整、忠实地提取图中所有文字，保留数字、日期、金额、名称等关键信息，不要遗漏。
2. 如果是表格，用 Markdown 表格或结构化文本还原行列关系。
3. 如果有印章、手写批注、抬头，也一并说明。
4. 不要编造图片中没有的内容；看不清或无法辨认的地方标注【无法辨认】。
5. 用中文输出，直接给出提取结果，不要寒暄。`;

/**
 * 调用视觉模型解析单张图片，返回提取的文本。
 * @param source 文件路径（string）或图片二进制（Buffer）
 */
export async function describeImage(source: ImageInput, mimeType: string): Promise<string> {
  const cfg = getConfig();
  const model = getModelForRole('vision');
  const client = new OpenAI({
    apiKey: cfg.llm.apiKey,
    baseURL: cfg.llm.baseUrl,
  });

  const buf = typeof source === 'string' ? await fs.readFile(source) : source;
  const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: VISION_PROMPT },
          {
            type: 'image_url',
            image_url: { url: dataUrl },
          },
        ],
      },
    ],
  });

  const text = resp.choices[0]?.message?.content?.trim() || '';
  if (!text) return '【视觉模型未返回任何文本】';
  return text;
}
