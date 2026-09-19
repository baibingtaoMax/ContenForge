// ============================================
// 文件文本提取服务
// 支持 PDF / Word / Excel / 纯文本 / 图片（视觉模型解析）
// ============================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { describeImage } from './vision.js';

// pdf-parse v2 / mammoth / xlsx / pdf-to-img 动态 import
let PDFParse: any = null;
let mammoth: any = null;
let XLSX: any = null;
let convertPdf: any = null;

async function ensureLibs() {
  if (!PDFParse) ({ PDFParse } = await import('pdf-parse'));
  if (!mammoth) mammoth = (await import('mammoth')).default;
  if (!XLSX) XLSX = (await import('xlsx')).default;
  if (!convertPdf) ({ pdf: convertPdf } = await import('pdf-to-img'));
}

const TEXT_EXTENSIONS = ['.txt', '.csv', '.md', '.json', '.xml', '.html', '.htm'];

/** 文字型 PDF 的最小字数阈值：低于此值判定为扫描件/图片型 PDF，走视觉模型 */
const SCANNED_PDF_TEXT_THRESHOLD = 100;
/** 扫描型 PDF 最多识别页数，防止超大文件烧钱/超时 */
const SCANNED_PDF_MAX_PAGES = 20;
/**
 * 扫描型 PDF：逐页转图片送视觉模型识别。
 * 仅在 pdf-parse 提取不到文字层时调用。
 */
async function extractScannedPdfWithVlm(filePath: string): Promise<string> {
  const doc = await convertPdf(filePath, { scale: 2 });
  const total = doc.length as number;
  const pageCount = Math.min(total, SCANNED_PDF_MAX_PAGES);
  const parts: string[] = [];

  let idx = 0;
  for await (const pageBuf of doc as AsyncIterable<Buffer>) {
    idx++;
    if (idx > SCANNED_PDF_MAX_PAGES) break;
    try {
      const pageText = await describeImage(pageBuf, 'image/png');
      parts.push(`【第 ${idx} 页】\n${pageText}`);
    } catch (e) {
      parts.push(`【第 ${idx} 页：视觉识别失败】${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await doc.destroy?.();

  let text = parts.join('\n\n');
  if (total > SCANNED_PDF_MAX_PAGES) {
    text += `\n\n…（本文件共 ${total} 页，仅识别前 ${SCANNED_PDF_MAX_PAGES} 页，其余已跳过）`;
  }
  // 标记来源，便于调试/记忆区分
  return `【扫描件视觉识别结果】\n${text}`;
}

/**
 * 从文件中提取文本内容
 * @returns 提取的文本（超长会截断）
 */
export async function extractText(
  filePath: string,
  mimeType: string
): Promise<string> {
  await ensureLibs();
  const ext = path.extname(filePath).toLowerCase();
  const MAX_TEXT = 60000; // 单个附件最多保留 6 万字，避免上下文爆炸

  try {
    let text = '';

    if (mimeType === 'application/pdf' || ext === '.pdf') {
      const buf = await fs.readFile(filePath);
      const parser = new PDFParse({ data: buf });
      const result = await parser.getText();
      text = result.text || '';
      // 文字层为空或过少 → 判定为扫描型 PDF，逐页转图走视觉模型
      if (text.trim().length < SCANNED_PDF_TEXT_THRESHOLD) {
        try {
          text = await extractScannedPdfWithVlm(filePath);
        } catch (e) {
          text = `【扫描件视觉识别失败：${e instanceof Error ? e.message : String(e)}】`;
        }
      }
    } else if (
      mimeType.includes('word') ||
      ext === '.docx'
    ) {
      const buf = await fs.readFile(filePath);
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value || '';
    } else if (
      mimeType.includes('sheet') ||
      mimeType.includes('excel') ||
      ext === '.xlsx' || ext === '.xls' || ext === '.csv'
    ) {
      const buf = await fs.readFile(filePath);
      const wb = XLSX.read(buf, { type: 'buffer' });
      const sheets: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        if (csv.trim()) {
          sheets.push(`【工作表：${sheetName}】\n${csv}`);
        }
      }
      text = sheets.join('\n\n');
    } else if (TEXT_EXTENSIONS.includes(ext) || mimeType.startsWith('text/')) {
      text = await fs.readFile(filePath, 'utf-8');
    } else if (mimeType.startsWith('image/')) {
      // 图片：用视觉模型识别内容（扫描件/截图/照片）
      try {
        text = await describeImage(filePath, mimeType);
      } catch (e) {
        text = `【图片视觉解析失败：${e instanceof Error ? e.message : String(e)}】`;
      }
    } else {
      text = `【暂不支持文本提取的文件类型：${mimeType || ext}】`;
    }

    // 清理多余空白
    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    // 截断保护
    if (text.length > MAX_TEXT) {
      text = text.slice(0, MAX_TEXT) + '\n\n…（内容过长，已截断）';
    }

    return text;
  } catch (e) {
    return `【文本提取失败：${e instanceof Error ? e.message : String(e)}】`;
  }
}
