// ============================================
// 在渲染后的需求文档章节标题（h2/h3）旁注入「决策胶囊」
// 读哪段、看哪段为什么这么定；点击滚动定位到决策脉络对应需求点分组
// ============================================

import { nextTick, watch, type Ref } from 'vue'
import type { DesignDecision } from '@/types'
import { extractHeadings, matchHeading } from '@/utils/decisionPoints'

const FLAG_PATH =
  '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/></svg>'

export function useHeadingDecisionPills(opts: {
  /** 文档渲染容器 ref（v-html 的那个 .doc-render） */
  containerRef: Ref<HTMLElement | null>
  docMd: Ref<string>
  decisions: Ref<DesignDecision[]>
  onFocusPoint: (point: string) => void
  /** 额外重绘触发器（如编辑态切回、tab 切换） */
  refreshTick?: Ref<unknown>
}) {
  function refresh() {
    const root = opts.containerRef.value
    if (!root) return
    root.querySelectorAll('.doc-decision-pill').forEach((n) => n.remove())

    const headings = extractHeadings(opts.docMd.value)
    if (!headings.length || !opts.decisions.value.length) return

    // point → 条数（只统计能归位的，未归位的在文末脉络区提示）
    const pointCount = new Map<string, number>()
    for (const d of opts.decisions.value) {
      if (!d.point) continue
      pointCount.set(d.point, (pointCount.get(d.point) || 0) + 1)
    }

    root.querySelectorAll('h2, h3').forEach((h) => {
      const title = (h.textContent || '').trim()
      let hitPoint: string | null = null
      for (const p of pointCount.keys()) {
        if (matchHeading(p, [title])) { hitPoint = p; break }
      }
      if (!hitPoint) return
      const n = pointCount.get(hitPoint)!
      const pill = document.createElement('button')
      pill.type = 'button'
      pill.className = 'doc-decision-pill'
      pill.dataset.point = hitPoint
      pill.title = `「${hitPoint}」有 ${n} 条设计决策，点击查看脉络`
      pill.innerHTML = `${FLAG_PATH}<span>${n}</span>`
      h.appendChild(pill)
    })
  }

  function onClick(e: MouseEvent) {
    const pill = (e.target as HTMLElement).closest('.doc-decision-pill') as HTMLElement | null
    if (!pill) return
    e.preventDefault()
    const point = pill.dataset.point
    if (point) opts.onFocusPoint(point)
  }

  watch(
    [opts.containerRef, opts.docMd, opts.decisions],
    () => nextTick(refresh),
    { immediate: true }
  )
  if (opts.refreshTick) {
    watch(opts.refreshTick, () => nextTick(refresh))
  }

  return { refresh, onClick }
}
