// ============================================
// 网页抓取服务：fetch URL → 标题 + 正文 markdown
// 零依赖：Node 24 内置 fetch + 手写轻量 HTML→文本转换。
// 用途：
//   1. read_webpage 工具（需求搭档/技能执行员聊天中实时读网页）
//   2. 网页附件（PM 贴链接时自动抓取沉淀为项目材料）
// 说明：只处理静态/SSR 页面正文；纯 JS 渲染的 SPA 内页可能抓不到内容。
// ============================================

export interface WebPageResult {
  url: string;
  title: string;
  markdown: string;
  /** 正文字符数（截断前） */
  textLength: number;
  /** 抓取失败时的错误信息（成功时为空） */
  error?: string;
}

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 3 * 1024 * 1024; // 3MB 上限
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ProtoForge/1.0';

/** 轻量 SSRF 防护：只允许 http/https，拒绝内网/回环地址（主机名层面粗筛） */
function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('链接格式不正确');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('只支持 http/https 链接');
  }
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /\.local$/.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new Error('不支持抓取内网/本机地址');
  }
  return u;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * 轻量 HTML → markdown/纯文本。
 * 不求全（表格/嵌套列表简化），只求正文可读、结构大致保留。
 * 保留超链接为 [文字](绝对URL)，方便对标类技能跟进子页面。
 */
function htmlToMarkdown(html: string, baseUrl: string): { title: string; body: string } {
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim());

  // 去掉 head / script / style / noscript / 注释
  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head[\s\S]*?<\/head>/i, ' ')
    .replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(nav|footer|header|aside|form|svg|iframe)[^>]*>/gi, ' ');

  // 超链接转 markdown 链接（在抹标签前处理，保留 href；相对路径转绝对）
  body = body.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    if (!text) return '';
    let abs = href.trim();
    try {
      abs = new URL(href, baseUrl).href;
    } catch {
      return text;
    }
    if (!/^https?:/i.test(abs)) return text;
    return `[${text}](${abs})`;
  });

  // 块级元素转换行
  body = body
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|section|article|tr|ul|ol|dl|table|h[1-6])[^>]*>/gi, '\n')
    .replace(/<h1[^>]*>/gi, '\n# ')
    .replace(/<h2[^>]*>/gi, '\n## ')
    .replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<h[4-6][^>]*>/gi, '\n#### ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/t[dh][^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ''); // 其余标签全部抹掉

  body = decodeEntities(body);
  // 压缩空白：每行 trim，连续空行压成一个
  const lines = body
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter((l, i, arr) => l !== '' || arr[i - 1] !== '');
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, body: text };
}

/**
 * 抓取网页并提取正文。
 * 失败不抛异常（返回 result.error），调用方决定如何展示。
 */
export async function fetchWebPage(rawUrl: string, maxChars = 12_000): Promise<WebPageResult> {
  let url: URL;
  try {
    url = assertSafeUrl(rawUrl);
  } catch (e) {
    return { url: rawUrl, title: '', markdown: '', textLength: 0, error: e instanceof Error ? e.message : '链接无效' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) {
      return { url: res.url || url.href, title: '', markdown: '', textLength: 0, error: `网页返回 ${res.status}` };
    }
    const contentType = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      return { url: res.url || url.href, title: '', markdown: '', textLength: 0, error: `不是网页（${contentType.split(';')[0] || '未知类型'}），无法提取正文` };
    }

    // 限制下载体积
    const reader = res.body?.getReader();
    let html = '';
    if (reader) {
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_HTML_BYTES) break;
        html += Buffer.from(value).toString('utf-8');
      }
    } else {
      html = await res.text();
    }

    const { title, body } = htmlToMarkdown(html, res.url || url.href);
    if (body.length < 40) {
      return {
        url: res.url || url.href,
        title: title || url.hostname,
        markdown: body,
        textLength: body.length,
        error: '页面正文几乎为空，可能是纯 JS 渲染的页面（抓不到动态内容）',
      };
    }
    const markdown = body.length > maxChars ? body.slice(0, maxChars) + '\n\n…（正文过长，已截断）' : body;
    return { url: res.url || url.href, title: title || url.hostname, markdown, textLength: body.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      url: url.href,
      title: '',
      markdown: '',
      textLength: 0,
      error: msg.includes('abort') || msg.includes('timed out') ? '抓取超时（15 秒）' : `抓取失败：${msg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 从一段文本里提取 http(s) 链接（去重，保序，限上限） */
export function extractUrls(text: string, limit = 3): string[] {
  const re = /https?:\/\/[^\s，。；、）)】\]'"<>]+/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    let u = m[0].replace(/[.,!?;:]+$/, '');
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}
