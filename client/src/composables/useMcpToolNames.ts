import { ref } from 'vue'
import { getMcpToolNames } from '@/api'

/** 内部工具名 -> { name, server } 的全局缓存 */
const nameMap = ref<Record<string, { name: string; server: string }>>({})
let loading: Promise<void> | null = null
let loaded = false

/** 拉取 MCP 工具名映射（带缓存，多次调用只请求一次） */
export function loadMcpToolNames(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve()
  if (loading && !force) return loading
  loading = getMcpToolNames()
    .then((m) => { nameMap.value = m; loaded = true })
    .catch(() => { /* 静默失败，卡片回退英文原名 */ })
    .finally(() => { loading = null })
  return loading
}

/** 查询某个内部工具名的中文显示名；MCP 工具返回「中文名」，非 MCP 返回 undefined */
export function useMcpToolNames() {
  if (!loaded) loadMcpToolNames()
  return { nameMap, loadMcpToolNames }
}
