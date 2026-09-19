/**
 * Axure 注入码生成
 * runtime 源码以 ?raw 内联，剥掉 export/注释后压成 javascript: 单行，
 * 保证工具里预览的效果 = 贴进 Axure 的效果（同一份渲染代码）。
 * 两种载荷：
 *  - { mode:'wizard', cfg }  → mountChart，CFG 驱动
 *  - { mode:'custom', source } → mountCustomSource，源码求值（支持 formatter 等函数）后渲染
 */
import runtimeSource from './chartRuntime.js?raw'
import type { WizardCfg, CustomChartConfig } from './chartTypes'

/** 去掉块注释、行首尾空白、换行；代码全部显式分号，拼接安全 */
function compactRuntime(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('')
    .replace(/export\s+/g, '')
}

const RUNTIME = compactRuntime(runtimeSource)

function commonShell(payloadJson: string, mountCall: string): string {
  const body = `(function(){
var PAYLOAD=${payloadJson};
var RUNTIME=function(){
${RUNTIME}
return { mountChart: mountChart, mountCustom: mountCustom, mountCustomSource: mountCustomSource, crEvalOption: crEvalOption };
}();
function mount(){
  if (typeof echarts === 'undefined') { alert('ECharts 未加载：请先在发布页引入 echarts.min.js'); return; }
  var el = (window.jQuery && jQuery('[data-label="' + PAYLOAD.label + '"]')[0]) ||
           document.querySelector('[data-label="' + PAYLOAD.label + '"]');
  if (!el) { alert('找不到 Axure 元件：' + PAYLOAD.label); return; }
  ${mountCall}
}
function start(){ setTimeout(mount, 800); }
if (document.readyState === 'complete') { start(); }
else { window.addEventListener('load', start); }
})();`
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('')
}

/** 向导模式注入码（v3：按 family 分发的任意族配置） */
export function buildBookmarklet(cfg: WizardCfg): string {
  const payload = JSON.stringify({ label: cfg.label, mode: 'wizard', cfg })
  const oneLine = commonShell(payload, 'RUNTIME.mountChart(el, echarts, PAYLOAD.cfg);')
  return 'javascript:' + oneLine
}

/** 自定义 option 模式注入码（source 是 JS 对象字面量源码，可含函数） */
export function buildCustomBookmarklet(custom: CustomChartConfig): string {
  const payload = JSON.stringify({ label: custom.label, mode: 'custom', source: custom.source })
  const oneLine = commonShell(payload, 'RUNTIME.mountCustomSource(el, echarts, PAYLOAD.source);')
  return 'javascript:' + oneLine
}
