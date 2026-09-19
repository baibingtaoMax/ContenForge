<template>
  <div class="tool-call-card" :class="{ loading: tool.loading }">
    <div class="tool-header" @click="expanded = !expanded">
      <AppIcon class="tool-icon" :name="iconName" :tint="iconTint" :size="20" />
      <span class="tool-name">{{ displayName }}</span>
      <span v-if="sourceTag" class="tool-source">{{ sourceTag }}</span>
      <span v-if="tool.loading" class="tool-status">
        <span class="dot-spin"></span> 查询中…
      </span>
      <span v-else class="tool-done">
        <AppIcon name="check" :size="12" :stroke-width="2.6" /> 已完成
      </span>
      <el-icon class="expand-icon" :class="{ open: expanded }">
        <ArrowDown />
      </el-icon>
    </div>

    <Transition name="fold">
      <div v-show="expanded" class="tool-body">
        <div v-if="argSummary" class="tool-section">
          <div class="section-label">查询参数</div>
          <div class="arg-chips">
            <span v-for="(v, k) in argSummary" :key="k" class="arg-chip">
              <span class="arg-key">{{ k }}</span>
              <span class="arg-val">{{ v }}</span>
            </span>
          </div>
        </div>

        <div v-if="tool.result" class="tool-section">
          <div class="section-label">
            返回结果
            <span class="result-toggle" @click.stop="showRaw = !showRaw">
              {{ showRaw ? '摘要' : '原始' }}
            </span>
          </div>
          <pre v-if="showRaw" class="result-block">{{ tool.result }}</pre>
          <div v-else class="result-summary" v-html="renderedResult"></div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowDown } from '@element-plus/icons-vue'
import type { ToolCallRecord } from '@/types'
import { renderMarkdown } from '@/utils/markdown'
import { useMcpToolNames } from '@/composables/useMcpToolNames'
import AppIcon from './AppIcon.vue'

type Tint = 'amber' | 'indigo' | 'violet' | 'sky' | 'slate' | 'rose' | 'emerald'

const props = defineProps<{
  tool: ToolCallRecord
}>()

const expanded = ref(false)
const showRaw = ref(false)

const { nameMap: mcpToolNames } = useMcpToolNames()

const TOOL_META: Record<string, { name: string; icon: string; tint: Tint }> = {
  getEnterpriseBasic: { name: '工商基本信息', icon: 'file', tint: 'slate' },
  getCreditReport: { name: '征信报告', icon: 'file', tint: 'sky' },
  getFinancialData: { name: '财报数据', icon: 'layers', tint: 'emerald' },
  getLitigationRecords: { name: '司法诉讼记录', icon: 'alert-triangle', tint: 'rose' },
  getTaxInfo: { name: '税务信息', icon: 'file', tint: 'amber' },
  list_project_attachments: { name: '项目附件清单', icon: 'paperclip', tint: 'slate' },
  read_attachment: { name: '读取附件', icon: 'file', tint: 'sky' },
  read_webpage: { name: '读取网页', icon: 'external-link', tint: 'sky' },
  dispatch_investigation: { name: '派发调查任务', icon: 'zap', tint: 'violet' },
  propose_requirement: { name: '沉淀需求', icon: 'sparkle', tint: 'indigo' },
  revise_requirement: { name: '修订需求文档', icon: 'edit', tint: 'indigo' },
  list_skills: { name: '技能列表', icon: 'zap', tint: 'amber' },
  invoke_skill: { name: '执行技能', icon: 'zap', tint: 'amber' },
  search_memory: { name: '检索记忆', icon: 'layers', tint: 'slate' },
}

/** 把 mcp__<slug>__<原名> 里的蛇形原名转成可读短名（仅作兑底） */
function humanizeMcpName(raw: string): string {
  const m = raw.match(/^mcp__(.+?)__(.+)$/)
  if (!m) return raw
  const tail = m[2]
    .replace(/^ai_industry_knowledge_companyDynamicMonitor_/, '')
    .replace(/^icp_pool_/, '')
    .replace(/company_list_|company_detail_|company_index_/g, '')
    .replace(/_/g, ' ')
    .trim()
  return tail || raw
}

const isMcp = computed(() => props.tool.toolName.startsWith('mcp__'))
const mcpInfo = computed(() => mcpToolNames.value[props.tool.toolName])
const displayName = computed(() => {
  if (TOOL_META[props.tool.toolName]) return TOOL_META[props.tool.toolName].name
  if (mcpInfo.value) return mcpInfo.value.name
  if (isMcp.value) return humanizeMcpName(props.tool.toolName)
  return props.tool.toolName
})
const iconName = computed(() => {
  if (TOOL_META[props.tool.toolName]) return TOOL_META[props.tool.toolName].icon
  if (isMcp.value) return 'database'
  return 'settings'
})
const iconTint = computed<Tint>(() => {
  if (TOOL_META[props.tool.toolName]) return TOOL_META[props.tool.toolName].tint
  if (isMcp.value) return 'sky'
  return 'slate'
})
const sourceTag = computed(() => mcpInfo.value?.server ? `外部数据·${mcpInfo.value.server}` : '')

/** 把参数对象压成简短的 key-value 展示 */
const argSummary = computed<Record<string, string | number> | null>(() => {
  const args = props.tool.args as Record<string, unknown>
  if (!args || typeof args !== 'object') return null
  const entries = Object.entries(args).filter(([, v]) => {
    if (v == null) return false
    if (typeof v === 'string') return v.length > 0
    if (Array.isArray(v)) return v.length > 0
    return true
  })
  if (!entries.length) return null
  const out: Record<string, string | number> = {}
  for (const [k, v] of entries) {
    out[k] = typeof v === 'object' ? JSON.stringify(v) : (v as string | number)
  }
  return out
})

/** 结果默认按 markdown 摘要渲染（工具返回本就是文本） */
const renderedResult = computed(() => renderMarkdown(String(props.tool.result || '')))
</script>

<style scoped lang="scss">
.tool-call-card {
  margin: 8px 0;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  background: var(--pf-bg-surface);
  overflow: hidden;
  transition: border-color 0.18s, box-shadow 0.18s;

  &.loading {
    border-color: var(--pf-primary-200);
    background: var(--pf-primary-50);
  }

  &:hover {
    box-shadow: var(--pf-shadow-xs);
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;

    .tool-icon { flex-shrink: 0; }
    .tool-name {
      font-size: 12.5px;
      color: var(--pf-text-1);
      font-weight: 600;
    }
    .tool-source {
      font-size: 11px;
      color: var(--pf-info-text);
      background: var(--pf-info-bg);
      padding: 1px 7px;
      border-radius: 10px;
      font-weight: 600;
    }
    .tool-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      margin-left: auto;
      font-size: 12px;
      color: var(--pf-primary);
      font-weight: 500;
    }
    .tool-done {
      margin-left: auto;
      font-size: 11.5px;
      color: var(--pf-success-text);
      background: var(--pf-success-bg);
      padding: 1px 8px;
      border-radius: 10px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .expand-icon {
      color: var(--pf-text-3);
      font-size: 13px;
      transition: transform 0.2s;
      margin-left: 4px;
      &.open { transform: rotate(180deg); }
    }
  }

  .tool-body {
    padding: 0 12px 12px;
    border-top: 1px dashed var(--pf-border);

    .tool-section { margin-top: 10px; }

    .section-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--pf-text-3);
      font-weight: 600;
      margin-bottom: 6px;
      letter-spacing: 0.3px;

      .result-toggle {
        color: var(--pf-primary);
        cursor: pointer;
        font-weight: 500;
        &:hover { text-decoration: underline; }
      }
    }
  }

  .arg-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    .arg-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      background: var(--pf-bg-hover);
      border-radius: 4px;
      font-size: 12px;

      .arg-key { color: var(--pf-text-3); }
      .arg-val { color: var(--pf-text-1); font-weight: 500; }
    }
  }

  .result-block {
    margin: 0;
    padding: 10px;
    background: var(--pf-bg-subtle);
    border-radius: var(--pf-r-sm);
    font-size: 12px;
    font-family: 'SF Mono', 'Menlo', monospace;
    color: var(--pf-text-1);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 320px;
    overflow-y: auto;
  }

  .result-summary {
    font-size: 12.5px;
    line-height: 1.7;
    color: var(--pf-text-1);
    max-height: 320px;
    overflow-y: auto;
    padding: 8px 10px;
    background: var(--pf-bg-subtle);
    border-radius: var(--pf-r-sm);

    :deep(ul), :deep(ol) { padding-left: 18px; margin: 4px 0; }
    :deep(p) { margin: 4px 0; }
    :deep(strong) { font-weight: 600; }
    :deep(table) { border-collapse: collapse; width: 100%; margin: 6px 0; }
    :deep(th), :deep(td) { border: 1px solid var(--pf-border); padding: 4px 8px; font-size: 12px; text-align: left; }
    :deep(th) { background: var(--pf-bg-hover); }
  }
}

.dot-spin {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--pf-primary-200);
  border-top-color: var(--pf-primary);
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.fold-enter-active,
.fold-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}
.fold-enter-from,
.fold-leave-to { opacity: 0; max-height: 0; }
.fold-enter-to,
.fold-leave-from { opacity: 1; max-height: 500px; }
</style>
