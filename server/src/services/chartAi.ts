// ============================================
// 服务：AI 生成 / 调整 ECharts option（JS 源码，可含函数）
// 无状态多轮：每次请求带上「当前编辑器源码」作为上下文，
// 模型基于它按用户指令修改；用户手改过的内容也在 currentSource 里，不会丢。
// ============================================

import { chatCompletionStream, LLMMessage } from '../llm/client.js';
import { getConfig } from '../config/index.js';

const SYSTEM_PROMPT = `你是 Apache ECharts 5.5 配置专家，负责为财务/经营分析类管理后台生成图表 option。
输出格式：优先输出一个 JavaScript 对象字面量（可以被 new Function('return (' + 源码 + ')')() 直接求值），外层必须用小括号包起来。允许直接写函数，例如 tooltip.formatter、label.formatter、axisLabel.formatter 可以写 (params) => {...}。
如果用户给的是 ECharts 官网示例风格的完整脚本（含数据生成函数、option = {...} 赋值、setInterval 动态刷新），可以原样按脚本形态输出：保留其数据生成逻辑与 option = {...} 赋值，不要包小括号；动态刷新部分的 setInterval 和 myChart.setOption 可以保留。
规则（必须严格遵守）：
1. 只输出这个 JS 对象字面量本身，不要输出任何解释、前后缀文字或 markdown 代码围栏。
2. 不要写 width、height（尺寸由挂载容器决定）。
3. 使用这套财务风格配色作为默认色板：#2b5cff、#19c4c4、#ff8f1f、#1e3fd4、#aecbff、#7c5cff、#18a058。
4. 中文标签直接写中文；金额类 tooltip/轴标签用千分位或「亿」简写；百分比带 %。这些格式化优先写成函数。
5. 网格 grid 留白合理（建议 left:56,right:56,top:48,bottom:40 附近，按图型调整），图例不要与标题重叠。
5.1 容器可能较矮（常见 640×330 甚至更矮）：标题字号不超过 15、副标题谨慎使用；雷达/饼图等中心定位图型的 center/top 必须给标题和底部图例留出空间（如雷达 center 纵向 ≥58%、radius ≤62%），任何情况下标题、图例、轴名称、图形之间都不得重叠。
6. 数据必须使用用户提供的真实数据；用户没给数据时才可以编造少量贴合财务场景的演示数据，并保持数值合理。
7. 必须兼容 ECharts 5.5 的 option 结构，不使用已废弃属性。
8. 如果用户给了表格/Excel 粘贴文本，自行识别表头与行列，正确映射到系列/类目/数据点。
9. formatter 等函数只能使用 ECharts 回调传入的参数做纯计算，禁止网络请求（fetch/XMLHttpRequest）、禁止访问 document/window/localStorage、禁止加载外部脚本。
10. 不要在对象内部用 // 行注释；键名按 JS 对象字面量习惯写（可不加引号）。
再次强调：最终回复只能包含被小括号包裹的对象字面量本身。`;

/** 剥掉模型可能加的 ```js 围栏和前后废话 */
export function extractSource(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:js|javascript|json)?\s*([\s\S]*?)```/i);
  if (fence) { t = fence[1].trim(); }
  const pStart = t.indexOf('(');
  const bStart = t.indexOf('{');
  const hasScriptHint = /(^|[\s;{}])(?:var\s+|let\s+|const\s+)?option\s*=(?!=)|myChart\.setOption\s*\(/.test(t);
  // 完整示例脚本形态（含 option = {...} 赋值）：原样返回，不包括号
  if (hasScriptHint && !(pStart >= 0 && (bStart < 0 || pStart < bStart) && t.lastIndexOf(')') > pStart)) {
    return t;
  }
  // 字面量形态：容错抠出第一个完整括号对象
  let start = -1;
  if (pStart >= 0 && (bStart < 0 || pStart < bStart)) { start = pStart; }
  else if (bStart >= 0) { start = bStart; }
  const pEnd = t.lastIndexOf(')');
  const bEnd = t.lastIndexOf('}');
  let end = -1;
  if (pEnd > start && pEnd >= bEnd) { end = pEnd; }
  else if (bEnd > start) { end = bEnd; }
  if (start >= 0 && end > start) { t = t.slice(start, end + 1); }
  if (!t.startsWith('(')) { t = '(' + t; }
  if (!t.endsWith(')')) { t = t + ')'; }
  return t;
}

const SCRIPT_HINT_RE = /(^|[\s;{}])(?:var\s+|let\s+|const\s+)?option\s*=(?!=)|myChart\.setOption\s*\(/;
const SCRIPT_TAIL = '\\n;return (typeof option!=="undefined")?option:null;';

/** Node 侧校验：字面量直接求值；脚本形态只做构造期语法检查（不执行，避免注册定时器） */
export function evalOptionSource(source: string): Record<string, unknown> {
  if (SCRIPT_HINT_RE.test(source)) {
    // 只解析不运行；脚本里必须露出 option 或 setOption（hint 已保证）
    new Function('myChart', 'echarts', 'setInterval', 'setTimeout', source + SCRIPT_TAIL);
    return { __script: true } as unknown as Record<string, unknown>;
  }
  const fn = new Function('return ' + source + ';');
  const option = fn();
  if (!option || typeof option !== 'object') {
    throw new Error('求值结果不是 ECharts option 对象');
  }
  return option as Record<string, unknown>;
}

/** 静态安全检查：禁止函数体里出现网络/DOM 访问（数据部分正常文本不受影响） */
export function assertSafeSource(source: string): void {
  const forbidden = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /\bimport\s*\(/, /require\s*\(/,
    /document\./, /window\./, /localStorage/, /sessionStorage/,
    /\bWebSocket\b/, /navigator\./, /<script/i,
  ];
  for (const re of forbidden) {
    if (re.test(source)) {
      throw new Error('option 里不允许网络请求或 DOM 访问（' + re.source + '），formatter 只能用回调参数纯计算');
    }
  }
}

export interface ChartAiParams {
  /** 用户这一轮的指令（要什么图 / 怎么改） */
  prompt: string;
  /** 可粘贴的 Excel 表格 / 数字 / JSON 原始文本 */
  data?: string;
  /** 当前编辑器里的源码；首轮生成不传，追问/调整时必传 */
  currentSource?: string | null;
  signal?: AbortSignal;
}

export async function generateChartOption(params: ChartAiParams): Promise<string> {
  const cfg = getConfig();
  if (!cfg.llm.apiKey) {
    throw new ChartAiError('未配置大模型 API Key（ARK_API_KEY），AI 生成不可用');
  }

  const messages: LLMMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];

  if (params.currentSource && params.currentSource.trim()) {
    messages.push({
      role: 'user',
      content: `当前图表的 option 源码是：\n${params.currentSource}\n\n请按下面的指令修改它，输出修改后的完整源码（外层用小括号包裹，只输出源码）：\n${params.prompt}` +
        (params.data ? `\n\n可参考的数据：\n${params.data}` : ''),
    });
  } else {
    messages.push({
      role: 'user',
      content: `请生成图表 option：\n${params.prompt}` +
        (params.data ? `\n\n数据如下（可能是 Excel/表格粘贴）：\n${params.data}` : ''),
    });
  }

  const raw = await chatCompletionStream({
    messages,
    onChunk: () => {},
    temperature: 0.2,
    maxTokens: 16000,
    thinking: { type: 'disabled' },
    signal: params.signal,
  });

  return finalizeSource(raw, messages, params.signal);
}

/** 抠源码 → 安全检查 → 求值；失败自愈重试一次 */
async function finalizeSource(
  raw: string,
  messages: LLMMessage[],
  signal?: AbortSignal,
): Promise<string> {
  try {
    const source = extractSource(raw);
    assertSafeSource(source);
    const option = evalOptionSource(source);
    if (!('__script' in option) && !('series' in option) && !('xAxis' in option)) {
      throw new Error('看不出是 ECharts option（至少要有 series 或 xAxis）');
    }
    return source;
  } catch (e) {
    const fixMessages: LLMMessage[] = [
      ...messages,
      { role: 'assistant', content: raw.slice(0, 8000) },
      { role: 'user', content: `你上一条输出有问题：${(e as Error).message}。请只输出修正后的完整 ECharts option JS 对象字面量源码，外层用小括号包裹，不要任何其他内容。` },
    ];
    const fixed = await chatCompletionStream({
      messages: fixMessages,
      onChunk: () => {},
      temperature: 0,
      maxTokens: 16000,
      thinking: { type: 'disabled' },
      signal,
    });
    const source = extractSource(fixed);
    assertSafeSource(source);
    const option = evalOptionSource(source);
    if (!('__script' in option) && !('series' in option) && !('xAxis' in option)) {
      throw new ChartAiError('AI 两次输出都不是合法 ECharts option，请换个描述重试');
    }
    return source;
  }
}

export class ChartAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartAiError';
  }
}
