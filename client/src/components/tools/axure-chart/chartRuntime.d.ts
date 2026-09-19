import type { WizardCfg } from './chartTypes'

export function buildWizardOption(cfg: WizardCfg, mode?: string | null): Record<string, unknown>
export function mountChart(el: HTMLElement, echarts: unknown, cfg: WizardCfg): unknown
export function mountCustom(el: HTMLElement, echarts: unknown, option: Record<string, unknown>): unknown
export function crEvalOption(source: string): Record<string, unknown>
export function crClassifySource(source: string): { kind: 'literal' | 'script'; src: string; option: Record<string, unknown> | null }
export function crCheckSource(source: string): { kind: 'literal' | 'script'; src: string; option: Record<string, unknown> | null }
export function mountCustomSource(el: HTMLElement, echarts: unknown, source: string): unknown
