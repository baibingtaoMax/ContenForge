/** 灯箱：点击图全屏查看，滚轮/按钮缩放，Esc 或点遮罩关闭 */
function openLightbox(svgHtml: string) {
  const overlay = document.createElement('div')
  overlay.className = 'mermaid-lightbox'
  overlay.innerHTML = `
    <div class="ml-toolbar">
      <button type="button" data-act="zoomout" title="缩小">－</button>
      <span class="ml-scale">100%</span>
      <button type="button" data-act="zoomin" title="放大">＋</button>
      <button type="button" data-act="reset" title="重置">⟲</button>
      <button type="button" data-act="close" title="关闭">✕</button>
    </div>
    <div class="ml-stage"><div class="ml-canvas">${svgHtml}</div></div>
  `
  document.body.appendChild(overlay)
  const canvas = overlay.querySelector<HTMLElement>('.ml-canvas')!
  const scaleLabel = overlay.querySelector<HTMLElement>('.ml-scale')!
  // mermaid 给 svg 加了内联 max-width:<原始宽>px，会把图钉死在原始尺寸、
  // 放大画布时图不跟着变大（内联样式优先级高于外部 CSS）。清掉内联 style，
  // 靠外部 CSS .ml-canvas svg{width:100%;max-width:none} 让图跟随画布宽。
  const svgEl = canvas.querySelector('svg')
  if (svgEl) svgEl.removeAttribute('style')
  // 基准宽度：scale=1 时的布局宽度。用改 width 而不是 transform: scale，
  // 因为 transform 是视觉变换、不撑大滚动区域，放大后超出部分滚/拖不到
  // 平移状态：用 transform 位移画布，不靠滚动条——缩小时图比视口小、
  // 没有滚动余量，改 scrollLeft 根本拖不动
  const stage = overlay.querySelector<HTMLElement>('.ml-stage')!
  let panX = 0, panY = 0
  const clampPan = () => {
    // 至少留 80px 在视口内，别把图完全拖丢
    const maxX = Math.max(0, (canvas.offsetWidth + stage.clientWidth) / 2 - 80)
    const maxY = Math.max(0, (canvas.offsetHeight + stage.clientHeight) / 2 - 80)
    panX = Math.min(maxX, Math.max(-maxX, panX))
    panY = Math.min(maxY, Math.max(-maxY, panY))
  }
  const applyPan = () => { clampPan(); canvas.style.transform = `translate(${panX}px, ${panY}px)` }

  const baseW = canvas.offsetWidth || 1000
  let scale = 1
  const apply = () => {
    canvas.style.width = `${Math.round(baseW * scale)}px`
    scaleLabel.textContent = `${Math.round(scale * 100)}%`
    applyPan() // 尺寸变了重新夹取
  }
  const setScale = (v: number) => { scale = Math.min(4, Math.max(0.3, v)); apply() }
  overlay.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act')
    if (act === 'zoomin') setScale(scale + 0.25)
    else if (act === 'zoomout') setScale(scale - 0.25)
    else if (act === 'reset') { panX = 0; panY = 0; setScale(1) }
    else if (act === 'close' || e.target === overlay || (e.target as HTMLElement).classList.contains('ml-stage')) close()
  })
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault()
    setScale(scale + (e.deltaY < 0 ? 0.15 : -0.15))
  }, { passive: false })

  // 按住拖拽平移（pointer 事件，鼠标/触屏统一）
  canvas.addEventListener('dragstart', (e) => e.preventDefault())
  stage.style.userSelect = 'none'
  let dragging = false, moved = false, didDrag = false
  let sx = 0, sy = 0, spx = 0, spy = 0
  const onDown = (e: PointerEvent) => {
    dragging = true; moved = false
    sx = e.clientX; sy = e.clientY; spx = panX; spy = panY
    stage.classList.add('grabbing')
    try { stage.setPointerCapture(e.pointerId) } catch { /* noop */ }
    e.preventDefault()
  }
  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    if (Math.abs(e.clientX - sx) > 4 || Math.abs(e.clientY - sy) > 4) moved = true
    panX = spx + (e.clientX - sx)
    panY = spy + (e.clientY - sy)
    applyPan()
  }
  const onUp = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    stage.classList.remove('grabbing')
    didDrag = moved // 拖拽后的 click 会误触发「点空白关闭」，捕获阶段吞掉
    try { stage.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }
  stage.addEventListener('pointerdown', onDown)
  stage.addEventListener('pointermove', onMove)
  stage.addEventListener('pointerup', onUp)
  stage.addEventListener('pointercancel', onUp)
  overlay.addEventListener('click', (e) => {
    if (didDrag) { e.stopPropagation(); didDrag = false }
  }, true)

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onKey)
  function close() {
    document.removeEventListener('keydown', onKey)
    overlay.remove()
  }
}

/** 渲染好的图：hover 提示 + 点击放大 */
function bindZoom(pre: HTMLElement, svgHtml: string) {
  pre.style.cursor = 'zoom-in'
  pre.title = '点击放大查看'
  pre.addEventListener('click', () => openLightbox(svgHtml))
}

// mermaid 渲染：把 marked 产出的 ```mermaid 代码块替换成 SVG
import mermaid from 'mermaid'

let initialized = false
let counter = 0

function initMermaid() {
  if (initialized) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'neutral',
    securityLevel: 'strict', // 严格模式，防 SVG 里的注入
    fontFamily: 'inherit',
    flowchart: { htmlLabels: true, curve: 'basis', padding: 12 },
    themeVariables: {
      fontSize: '15px',
      fontFamily: 'inherit',
    },
  })
  initialized = true
}

/**
 * 扫描容器内的 mermaid 代码块（marked 输出 pre > code.language-mermaid），渲染成 SVG。
 * 已处理的块会打 data-mermaid-done 标记，不重复渲染。
 */
export async function renderMermaidBlocks(root: HTMLElement): Promise<void> {
  initMermaid()
  const codes = root.querySelectorAll<HTMLElement>('code.language-mermaid')
  for (const code of Array.from(codes)) {
    const pre = code.closest<HTMLElement>('pre')
    if (!pre) continue
    if (pre.dataset.mermaidDone === 'done') continue
    // 流式过程中语法不完整，先不渲染（等下次完整内容再来）
    if (pre.dataset.mermaidDone === 'pending') continue
    pre.dataset.mermaidDone = 'pending'

    const src = code.textContent || ''
    try {
      const id = `mmd-${Date.now()}-${counter++}`
      const { svg } = await mermaid.render(id, src)
      pre.classList.add('mermaid-rendered')
      pre.innerHTML = svg
      pre.dataset.mermaidDone = 'done'
      bindZoom(pre, svg)
    } catch (e) {
      // 失败：保留源码 + 错误提示；去掉 pending 标记允许后续完整内容重试
      delete pre.dataset.mermaidDone
      pre.classList.add('mermaid-error')
      const oldNote = pre.querySelector('.mermaid-err-msg')
      if (!oldNote) {
        const note = document.createElement('div')
        note.className = 'mermaid-err-msg'
        note.textContent = `图渲染失败（${e instanceof Error ? e.message.split('\n')[0] : '语法错误'}），已显示源码`
        pre.appendChild(note)
      }
    }
  }
}
