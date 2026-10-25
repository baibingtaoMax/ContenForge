// HTML → PNG：调用本机 Chrome/Chromium 的无头截图。
// 与 pdfRender 共用 findChrome，但这里走 --screenshot（精确像素窗口），用于公众号封面合成。
// 零依赖（不引 puppeteer）。背景里的本地图片用 file:// 绝对地址，页面与图都在本机允许加载。
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome } from '../pdfRender.js';

export interface ShotOptions {
  width: number;
  height: number;
  /** 轮询等待出图的超时，默认 45s（封面里要等背景图解码，给足） */
  timeoutMs?: number;
  /** 输出格式，默认 png（无损，公众号封面上传 png/jpeg 均可） */
  format?: 'png' | 'jpeg';
}

export interface ShotResult {
  image: Buffer;
  format: 'png' | 'jpeg';
}

/**
 * 把完整 HTML 文档渲染成精确尺寸的图片。
 * 注意：必须 --force-device-scale-factor=1，否则 Windows 125%/150% 缩放下窗口会被放大、出图尺寸不符。
 */
export function renderHtmlToImage(html: string, opts: ShotOptions): Promise<ShotResult> {
  const { width, height, timeoutMs = 45_000, format = 'png' } = opts;
  return new Promise((resolve, reject) => {
    const chrome = findChrome();
    if (!chrome) {
      reject(new Error('未找到 Chrome/Chromium，请设置环境变量 CHROME_PATH'));
      return;
    }

    const work = mkdtempSync(join(tmpdir(), 'pf-shot-'));
    const htmlPath = join(work, 'cover.html');
    const outPath = join(work, `out.${format}`);
    const userData = join(work, 'ud');
    writeFileSync(htmlPath, html, 'utf8');
    const pageUrl = pathToFileURL(htmlPath).href;

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--high-dpi-support=1',
      '--default-background-color=00000000',
      `--user-data-dir=${userData}`,
      // 给本地 <img> 留加载/解码时间（虚拟时钟快进，不真的傻等）
      '--virtual-time-budget=8000',
      `--window-size=${width},${height}`,
      `--screenshot=${outPath}`,
      pageUrl,
    ];

    const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    let settled = false;

    const cleanup = () => { try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ } };
    const killTree = () => {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else if (child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch { /* ignore */ }
    };
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      clearTimeout(timer);
      killTree(); cleanup();
      reject(new Error(msg));
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      clearTimeout(timer);
      try {
        const image = readFileSync(outPath);
        if (image.length < 2000) throw new Error('截图文件过小');
        killTree(); cleanup();
        resolve({ image, format });
      } catch {
        killTree(); cleanup();
        reject(new Error(`Chrome 截图失败：${stderr.slice(-400) || '未生成图片'}`));
      }
    };

    const timer = setTimeout(() => fail('封面渲染超时'), timeoutMs);
    // headless=new 截图完进程不一定退出；轮询文件，出现且连续两次大小不变即写完
    let lastSize = -1;
    let stable = 0;
    const poller = setInterval(() => {
      let size = 0;
      try { size = statSync(outPath).size; } catch { return; }
      if (size > 2000) {
        if (size === lastSize) { if (++stable >= 2) finish(); }
        else { stable = 0; lastSize = size; }
      }
    }, 300);

    child.on('error', (err) => fail(err.message));
  });
}
