// ============================================
// 靶向补丁：按定位路径（buildPath 生成）在 HTML 片段上做子树替换
// 零依赖：针对我们自己的 path 格式（tag:nth-of-type(n) 链）做精准定位，
// 不引通用 DOM 库。路径外内容一个字节不动。
// ============================================

// 页面片段内的元素定位路径："div:nth-of-type(1)[文本] > section:nth-of-type(1) > button:nth-of-type(1)"
// 文本锚点 [...] 仅给人看，定位只认 tag + nth-of-type。
export interface PathSeg {
  tag: string;
  nth: number;
}

export function parsePath(path: string): PathSeg[] {
  const segs: PathSeg[] = [];
  for (const part of path.split('>')) {
    const m = part.trim().match(/^([a-zA-Z][\w-]*):nth-of-type\((\d+)\)/);
    if (m) segs.push({ tag: m[1].toLowerCase(), nth: parseInt(m[2], 10) });
  }
  return segs;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TAGS = new Set(['script', 'style', 'textarea']);

interface Frame {
  tag: string;
  start: number;       // 开标签 < 的位置
  nth: number;         // 在父级下同 tag 序号
  counts: Map<string, number>; // 该元素下各 tag 子元素计数
}

interface Range {
  start: number;
  end: number; // outerHTML 结束（闭标签 > 之后）
}

// 标签 token 正则：处理引号属性里的 >
const TAG_RE = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g;

/** 在 html 里定位路径对应的元素 outerHTML 范围；找不到返回 null */
export function locatePath(html: string, segs: PathSeg[]): Range | null {
  if (!segs.length) return null;
  const rootCounts = new Map<string, number>();
  const stack: Frame[] = [];
  let matchDepth = 0; // 已匹配到路径第几段
  let matchStart = -1;
  let result: Range | null = null;

  // RAW 标签内容跳过
  let rawTag: string | null = null;

  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html))) {
    const full = m[0];
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClose = m[4] === '/' || VOID_TAGS.has(tag);

    if (rawTag) {
      if (isClose && tag === rawTag) {
        // RAW 内容结束：开标签时 frame 已入栈，这里必须同步弹出，否则栈永久深一层
        const frame = stack.pop();
        if (frame && (frame as any)._isTarget) {
          result = { start: frame.start, end: m.index + full.length };
        }
        rawTag = null;
      }
      continue;
    }

    if (!isClose) {
      // 开标签
      const parentCounts = stack.length ? stack[stack.length - 1].counts : rootCounts;
      const nth = (parentCounts.get(tag) || 0) + 1;
      parentCounts.set(tag, nth);

      const seg = segs[stack.length]; // 该深度期望的路径段
      const isMatchSeg =
        matchDepth === stack.length && seg && seg.tag === tag && seg.nth === nth;

      const frame: Frame = { tag, start: m.index, nth, counts: new Map() };
      if (isMatchSeg) {
        matchDepth = stack.length + 1;
        if (matchDepth === 1) matchStart = m.index;
        if (matchDepth === segs.length) {
          // 完整匹配到目标元素
          if (selfClose) {
            result = { start: m.index, end: m.index + full.length };
          } else {
            // 记录起点，等闭标签
            frame.start = m.index;
            (frame as any)._isTarget = true;
          }
        }
      }

      if (!selfClose) {
        stack.push(frame);
        if (RAW_TAGS.has(tag)) rawTag = tag;
      }
    } else {
      // 闭标签
      const frame = stack.pop();
      if (frame && (frame as any)._isTarget) {
        result = { start: frame.start, end: m.index + full.length };
      }
      // 离开一个元素：如果它在匹配链上但不是目标，匹配深度回退
      if (frame && matchDepth > stack.length + 1) {
        // 正常闭合，不影响（匹配深度表示当前最深匹配）
      }
    }
  }
  return result;
}

export interface Patch {
  path: string;
  newHtml: string;
}

export interface PatchResult {
  html: string;
  applied: string[];   // 成功应用的 path
  failed: { path: string; reason: string }[];
}

/**
 * 在页面 HTML 上应用多个子树补丁。
 * 全部基于原始 html 定位，再从后往前替换（避免索引偏移）。
 */
export function applySubtreePatches(html: string, patches: Patch[]): PatchResult {
  const jobs: { range: Range; newHtml: string; path: string }[] = [];
  const failed: { path: string; reason: string }[] = [];

  for (const p of patches) {
    const segs = parsePath(p.path);
    if (!segs.length) { failed.push({ path: p.path, reason: '路径为空' }); continue; }
    const range = locatePath(html, segs);
    if (!range) { failed.push({ path: p.path, reason: '定位不到目标元素（页面可能已重写）' }); continue; }
    jobs.push({ range, newHtml: p.newHtml, path: p.path });
  }

  // 从后往前替换
  jobs.sort((a, b) => b.range.start - a.range.start);
  let out = html;
  const applied: string[] = [];
  for (const j of jobs) {
    out = out.slice(0, j.range.start) + j.newHtml + out.slice(j.range.end);
    applied.push(j.path);
  }
  return { html: out, applied, failed };
}
