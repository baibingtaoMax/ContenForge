// ============================================
// 决策「锚文本」行内高亮
// 决策带一句从 doc_md 逐字摘的原话（anchorText），渲染文档时把这句话
// 像超链接一样包起来；点击就地弹小卡片看结论/理由（看完即走）。
// 原话可能跨 <strong>/表格等多个文本节点，用文本节点索引 + Range 分段包裹。
// ============================================

import { nextTick, ref, watch, onBeforeUnmount, type Ref } from 'vue'
import { useZIndex } from 'element-plus'
import type { DesignDecision } from '@/types'
import { normalizePoint } from '@/utils/decisionPoints'

export interface AnchorPopoverState {
  visible: boolean
  left: number
  top: number
  /** 朝上还是朝下弹（空间不够时翻转） */
  placement: 'bottom' | 'top'
  maxHeight: number
  zIndex: number
  point: string
  decisions: DesignDecision[]
}

interface TextSeg {
  node: Text
  start: number // 在全文中的起始 offset
  end: number
}

const ANCHOR_CLASS = 'dd-inline-anchor'

/**
 * 与 utils/decisionPoints.normalizePoint 同一套归一规则（去章节序号/标点/空白、小写），
 * 但同时产出「归一化下标 → 原文下标」映射，供行内定位用。
 */
function normalizeWithMap(raw: string): { norm: string; map: number[] } {
  const stripped = raw.replace(/^\d+(\.\d+)*[.、\s]*/, '')
  const offset = raw.length - stripped.length
  let norm = ''
  const map: number[] = []
  const punct = /[\s\u3000\u00b7\u2022\-\u2014_/\\:\uff1a,\uff0c.\u3002\u3001\uff08\uff09()\u3010\u3011\[\]]/
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i].toLowerCase()
    if (punct.test(ch)) continue
    norm += ch
    map.push(i + offset)
  }
  return { norm, map }
}

export function useDecisionAnchors(opts: {
  containerRef: Ref<HTMLElement | null>
  docMd: Ref<string>
  decisions: Ref<DesignDecision[]>
}) {
  const POP_WIDTH = 340
  const { nextZIndex } = useZIndex()
  const popover = ref<AnchorPopoverState>({
    visible: false, left: 0, top: 0, placement: 'bottom', maxHeight: 320, zIndex: 3000, point: '', decisions: [],
  })
  /** 锚文本非空但在当前文档里匹配不上的决策 id（文档重写后失效） */
  const brokenAnchorIds = ref<Set<string>>(new Set())
  /** 当前打开弹卡所锚定的元素，滚动时跟随重定位 */
  let activeEl: HTMLElement | null = null
  let groups: DesignDecision[][] = [] // groupIdx → 同锚文本的决策

  /** 拆掉旧高亮（保留内部节点） */
  function unwrapOld(root: HTMLElement) {
    root.querySelectorAll(`.${ANCHOR_CLASS}`).forEach((el) => {
      const parent = el.parentNode
      if (!parent) return
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
    })
  }

  function collectTextNodes(root: HTMLElement): { segs: TextSeg[]; raw: string } {
    const segs: TextSeg[] = []
    let raw = ''
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const el = n.parentElement
        if (!el || !n.nodeValue) return NodeFilter.FILTER_REJECT
        if (el.closest('.doc-decision-pill') || el.closest('script,style')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    let n: Node | null
    while ((n = walker.nextNode())) {
      const text = n as Text
      const start = raw.length
      raw += text.nodeValue || ''
      segs.push({ node: text, start, end: raw.length })
    }
    return { segs, raw }
  }

  /** 在 [rawStart, rawEnd) 覆盖到的每个文本节点上切片包 span；每次重新采集，避免前一次 splitText 使旧偏移失效 */
  function wrapRange(rawStart: number, rawEnd: number, groupIdx: number): boolean {
    const { segs } = collectTextNodes(opts.containerRef.value!)
    const hit = segs.filter((s) => s.end > rawStart && s.start < rawEnd)
    if (!hit.length) return false
    if (hit.some((s) => s.node.parentElement?.classList.contains(ANCHOR_CLASS))) return false
    // 每个命中节点独立切片，顺序无所谓（不同文本节点）；重新采集后偏移是最新的
    for (const s of hit) {
      const from = Math.max(0, rawStart - s.start)
      const to = Math.min(s.node.nodeValue!.length, rawEnd - s.start)
      if (to <= from) continue
      let target = s.node
      if (from > 0) target = target.splitText(from) // target = [from, end)
      if (to - from < target.nodeValue!.length) target.splitText(to - from) // target 现为 [from, to)
      const span = document.createElement('span')
      span.className = ANCHOR_CLASS
      span.dataset.group = String(groupIdx)
      target.parentNode!.insertBefore(span, target)
      span.appendChild(target)
    }
    return true
  }

  function highlight() {
    const root = opts.containerRef.value
    if (!root) return
    unwrapOld(root)

    const anchored = opts.decisions.value.filter((d) => d.anchorText && d.anchorText.trim())
    if (!anchored.length) { groups = []; brokenAnchorIds.value = new Set(); return }

    // 同锚文本聚成一组；长锚优先匹配，避免短锚抢占
    const byAnchor = new Map<string, DesignDecision[]>()
    for (const d of anchored) {
      const key = normalizePoint(d.anchorText)
      if (!byAnchor.has(key)) byAnchor.set(key, [])
      byAnchor.get(key)!.push(d)
    }
    const entries = [...byAnchor.entries()].sort(
      (a, b) => (b[1][0].anchorText?.length || 0) - (a[1][0].anchorText?.length || 0)
    )

    const { raw } = collectTextNodes(root)
    const { norm, map } = normalizeWithMap(raw)
    const claimed: Array<[number, number]> = []
    groups = []
    const broken = new Set<string>()

    for (const [, ds] of entries) {
      const anchorNorm = normalizePoint(ds[0].anchorText)
      if (!anchorNorm) { groups.push([]); continue }
      const idx = norm.indexOf(anchorNorm)
      if (idx < 0) {
        groups.push([])
        ds.forEach((d) => broken.add(d.id))
        continue
      }
      let rawStart = map[idx]
      let rawEnd = map[idx + anchorNorm.length - 1] + 1
      // 补全锚尾被归一化去掉的标点（如「）」），让高亮包住整句
      const tailChar = /[\s\u3000\u00b7\u2022\-\u2014_/\\:\uff1a,\uff0c.\u3002\u3001\uff08\uff09()\u3010\u3011\[\]]/
      while (rawEnd < raw.length && tailChar.test(raw[rawEnd])) rawEnd++
      if (claimed.some(([a, b]) => rawStart < b && rawEnd > a)) { groups.push([]); continue }
      const groupIdx = groups.length
      if (wrapRange(rawStart, rawEnd, groupIdx)) {
        claimed.push([rawStart, rawEnd])
        groups.push(ds)
      } else {
        groups.push([])
        ds.forEach((d) => broken.add(d.id))
      }
    }
    brokenAnchorIds.value = broken
  }

  function closePopover() {
    activeEl = null
    if (popover.value.visible) popover.value = { ...popover.value, visible: false }
  }

  /** 跟随当前锚元素重新定位；滚出视口则关闭。用 Element Plus 的动态 zIndex 压住抽屉。 */
  function reposition() {
    if (!popover.value.visible || !activeEl || !document.contains(activeEl)) {
      closePopover()
      return
    }
    const popEl = document.querySelector('.dd-anchor-pop') as HTMLElement | null
    const rect = activeEl.getBoundingClientRect()
    const vh = window.innerHeight
    // 完全滚出视口才关（上下各留 8px），轻微滚动只重定位
    if (rect.bottom < -8 || rect.top > vh + 8) { closePopover(); return }
    const margin = 12
    const gap = 8
    const spaceBelow = vh - rect.bottom - margin
    const spaceAbove = rect.top - margin
    // 内容真实高度（scrollHeight 不受 maxHeight 裁剪影响）
    const contentH = popEl ? popEl.scrollHeight : 240
    const wantH = Math.min(contentH, vh - margin * 2)
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - POP_WIDTH - margin)
    let placement: 'bottom' | 'top' = 'bottom'
    let top: number
    let maxHeight: number
    if (spaceBelow >= wantH) {
      placement = 'bottom'
      top = rect.bottom + gap
      maxHeight = spaceBelow - gap
    } else if (spaceAbove >= wantH) {
      placement = 'top'
      top = rect.top - gap - wantH
      maxHeight = spaceAbove - gap
    } else {
      // 两侧都放不下：选高的一侧贴边，内部滚动
      placement = spaceBelow >= spaceAbove ? 'bottom' : 'top'
      if (placement === 'bottom') { top = rect.bottom + gap; maxHeight = spaceBelow - gap }
      else { top = margin; maxHeight = spaceAbove - gap }
    }
    top = Math.max(margin, top)
    popover.value = { ...popover.value, left, top, placement, maxHeight: Math.max(120, maxHeight) }
  }

  function onClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest(`.${ANCHOR_CLASS}`) as HTMLElement | null
    if (!el) { closePopover(); return }
    const idx = Number(el.dataset.group)
    const ds = groups[idx] || []
    if (!ds.length) return
    activeEl = el
    const zIndex = nextZIndex()
    popover.value = {
      visible: true, left: 0, top: 0, placement: 'bottom', maxHeight: 320, zIndex, point: ds[0]?.point || '', decisions: ds,
    }
    nextTick(reposition)
  }

  watch(
    [opts.containerRef, opts.docMd, opts.decisions],
    () => { closePopover(); nextTick(highlight) },
    { immediate: true }
  )
  if (typeof window !== 'undefined') {
    // 滚动/缩放：跟随锚点重定位，不再一滚就关；用 passive 不卡滚动
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
  }

  onBeforeUnmount(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('scroll', reposition, true)
    window.removeEventListener('resize', reposition)
  })

  return { highlight, onClick, popover, closePopover, brokenAnchorIds }
}
