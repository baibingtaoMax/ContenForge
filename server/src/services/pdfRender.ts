// HTML → 矢量 PDF：调用本机 Chrome/Chromium 的无头打印。
// 文字可选、背景精确、真分页；不引 puppeteer（零依赖）。
// Chrome 路径解析顺序：环境变量 CHROME_PATH / PUPPETEER_EXECUTABLE_PATH → 平台常见路径。
// 桌面打包时把自带 chromium 路径通过 CHROME_PATH 注入即可。
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  accessSync,
  statSync,
  constants,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function candidatePaths(): string[] {
  const env = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  const paths = env ? [env] : [];
  switch (process.platform) {
    case 'darwin':
      paths.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      );
      break;
    case 'win32':
      paths.push(
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      );
      break;
    default:
      paths.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  return paths;
}

export function findChrome(): string | null {
  for (const p of candidatePaths()) {
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

export interface PdfRenderResult {
  pdf: Buffer;
}

/**
 * 渲染 HTML 为 PDF。
 * @param html 完整 HTML 文档字符串
 * @param timeoutMs 超时（默认 30s）
 */
export function renderHtmlToPdf(html: string, timeoutMs = 30_000): Promise<PdfRenderResult> {
  return new Promise((resolve, reject) => {
    const chrome = findChrome();
    if (!chrome) {
      reject(new Error('未找到 Chrome/Chromium，请设置环境变量 CHROME_PATH 指向浏览器可执行文件'));
      return;
    }

    const work = mkdtempSync(join(tmpdir(), 'pf-pdf-'));
    const htmlPath = join(work, 'doc.html');
    const pdfPath = join(work, 'out.pdf');
    const userData = join(work, 'ud');
    writeFileSync(htmlPath, html, 'utf8');

    const args = [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      `--user-data-dir=${userData}`,
      '--print-to-pdf-no-header',
      '--no-pdf-header-footer',
      '--virtual-time-budget=10000',
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ];

    // detached：便于打印完成后杀掉整个 Chrome 进程组（headless=new 打印完不会自己退出）
    const child = spawn(chrome, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    let settled = false;

    function cleanup() {
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }

    function killTree() {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else if (child.pid) {
          process.kill(-child.pid, 'SIGKILL'); // 负号 = 整个进程组
        }
      } catch {
        /* ignore */
      }
    }

    function fail(msg: string) {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      clearTimeout(timer);
      killTree();
      cleanup();
      reject(new Error(msg));
    }

    function finish() {
      if (settled) return;
      settled = true;
      clearInterval(poller);
      clearTimeout(timer);
      try {
        const pdf = readFileSync(pdfPath);
        killTree();
        cleanup();
        if (pdf.length < 1000) throw new Error('PDF 文件过小');
        resolve({ pdf });
      } catch {
        killTree();
        cleanup();
        reject(new Error(`Chrome 打印失败：${stderr.slice(-500) || '未生成 PDF'}`));
      }
    }

    const timer = setTimeout(() => fail('PDF 渲染超时'), timeoutMs);

    // headless=new 下 print-to-pdf 完成后进程不退出，轮询输出文件：出现且大小稳定即成功
    let lastSize = -1;
    let stableTicks = 0;
    const poller = setInterval(() => {
      let size = 0;
      try {
        size = statSync(pdfPath).size;
      } catch {
        return;
      }
      if (size > 1000) {
        if (size === lastSize) {
          stableTicks++;
          if (stableTicks >= 2) finish(); // 连续两次（~700ms）大小不变 = 写完
        } else {
          stableTicks = 0;
          lastSize = size;
        }
      }
    }, 350);

    child.on('error', (err) => fail(err.message));
  });
}
