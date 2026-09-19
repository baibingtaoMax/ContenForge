<template>
  <div class="mcp-view">
    <header class="page-header">
      <div class="header-left">
        <el-button text :icon="ArrowLeft" @click="goChat">返回对话</el-button>
        <div class="header-title">
          <AppIcon name="database" tint="indigo" :size="40" />
          <div>
            <h1>外部数据源（MCP）</h1>
            <p>接入外部数据（MCP），供需求顾问和技能调用</p>
          </div>
        </div>
      </div>
      <div class="header-right">
        <el-button @click="loadServers"><AppIcon name="refresh" :size="15" class="btn-icon" />刷新</el-button>
        <el-button type="primary" @click="openCreate"><AppIcon name="plus" :size="15" :stroke-width="2.4" class="btn-icon" />添加数据源</el-button>
      </div>
    </header>

    <!-- 数据源列表 -->
    <div class="server-list">
      <div v-if="servers.length === 0" class="empty-state">
        <div class="empty-icon"><AppIcon name="database" tint="indigo" :size="56" /></div>
        <h3>还没有接入外部数据源</h3>
        <p>接入 MCP 数据源后，需求顾问和技能就能查询工商、征信等外部数据</p>
        <el-button type="primary" size="large" @click="openCreate">
          <AppIcon name="plus" :size="16" :stroke-width="2.4" class="btn-icon" />添加第一个数据源
        </el-button>
      </div>
      <el-card v-for="s in servers" :key="s.id" class="server-card" shadow="never">
        <div class="server-head">
          <div class="server-title">
            <span class="dot" :class="s.status"></span>
            <strong>{{ s.name }}</strong>
            <el-tag size="small" type="info" effect="plain">{{ s.slug }}</el-tag>
            <el-tag size="small" :type="s.enabled ? 'success' : 'info'" effect="plain">
              {{ s.enabled ? '已启用' : '已停用' }}
            </el-tag>
            <el-tag size="small" :type="statusType(s.status)" effect="plain">
              {{ statusLabel(s.status) }}
            </el-tag>
          </div>
          <div class="server-actions">
            <el-button size="small" @click="onTest(s)"><AppIcon name="plug" :size="14" class="btn-icon" />测试连接</el-button>
            <el-button size="small" @click="onRefresh(s)"><AppIcon name="refresh" :size="14" class="btn-icon" />刷新工具</el-button>
            <el-button size="small" @click="openEdit(s)"><AppIcon name="edit" :size="14" class="btn-icon" />编辑</el-button>
            <el-popconfirm title="确定删除该数据源？" @confirm="onDelete(s)">
              <template #reference>
                <el-button size="small" type="danger" text><AppIcon name="trash" :size="14" class="btn-icon" />删除</el-button>
              </template>
            </el-popconfirm>
          </div>
        </div>
        <div class="server-url">{{ s.url }}</div>
        <div v-if="s.last_error" class="server-error">错误：{{ s.last_error }}</div>
        <div class="server-meta">
          <el-button link type="primary" @click="toggleTools(s)">
            <AppIcon :name="expanded === s.id ? 'chevron-down' : 'chevron-right'" :size="13" class="btn-icon" />{{ expanded === s.id ? '收起' : '查看' }}工具（{{ s.tool_count }}）
          </el-button>
        </div>

        <!-- 工具列表（白名单 + 角色绑定） -->
        <div v-if="expanded === s.id" class="tool-panel">
          <div v-loading="loadingTools[s.id]">
            <div v-if="toolsOfServer(s.id).length === 0" class="tool-empty">
              暂无工具，点「刷新工具」从数据源拉取。
            </div>
            <el-table v-else :data="toolsOfServer(s.id)" size="small" stripe>
              <el-table-column label="启用" width="70">
                <template #default="{ row }">
                  <el-switch
                    :model-value="row.enabled === 1"
                    @change="(v: boolean) => onToggleTool(row, v)"
                  />
                </template>
              </el-table-column>
              <el-table-column label="工具" min-width="300">
                <template #default="{ row }">
                  <div class="tool-name">
                    <el-input
                      :model-value="row.display_name"
                      size="small"
                      placeholder="显示名称"
                      style="max-width: 200px"
                      @change="(v: string) => onRenameTool(row, v)"
                    />
                  </div>
                  <div class="tool-raw">{{ row.tool_name }}</div>
                  <div class="tool-desc">{{ row.description || '—' }}</div>
                </template>
              </el-table-column>
              <el-table-column label="绑定角色（哪些智能体可调）" min-width="320">
                <template #default="{ row }">
                  <el-select
                    :model-value="row.boundRoles"
                    multiple
                    collapse-tags
                    collapse-tags-tooltip
                    placeholder="选择可调用的角色"
                    style="width: 100%"
                    @change="(v: string[]) => onBindRoles(row, v)"
                  >
                    <el-option v-for="r in roleOptions" :key="r.value" :label="r.label" :value="r.value" />
                  </el-select>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 调用日志 -->
    <div v-if="logs.length > 0" class="log-section">
      <h2>调用日志</h2>
      <el-table :data="logs" size="small" stripe max-height="360">
        <el-table-column prop="created_at" label="时间" width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column prop="server_name" label="数据源" width="120" />
        <el-table-column prop="tool_name" label="工具" min-width="220" show-overflow-tooltip />
        <el-table-column label="结果" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.success ? 'success' : 'danger'">
              {{ row.success ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="duration_ms" label="耗时" width="90">
          <template #default="{ row }">{{ row.duration_ms }}ms</template>
        </el-table-column>
        <el-table-column label="参数/结果预览" min-width="300">
          <template #default="{ row }">
            <div class="log-preview">
              <span class="log-args">参数：{{ JSON.stringify(row.args) }}</span>
              <span v-if="row.error_text" class="log-err">{{ row.error_text }}</span>
              <span v-else class="log-result">{{ (row.result_preview || '').slice(0, 160) }}</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>
    <div v-else class="log-section log-section--empty">
      <AppIcon name="history" :size="15" class="btn-icon" />
      调用日志会在数据源被调用后自动出现在这里
    </div>

    <!-- 添加/编辑弹窗 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑数据源' : '添加数据源'" width="560px">
      <el-form :model="form" label-width="92px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如：产业e数据" />
        </el-form-item>
        <el-form-item label="标识 slug" required>
          <el-input v-model="form.slug" placeholder="小写字母/数字/短横，如 chanyedata（用于工具前缀）" />
        </el-form-item>
        <el-form-item label="URL" required>
          <el-input v-model="form.url" placeholder="https://xxx/mcp" />
        </el-form-item>
        <el-form-item label="鉴权头">
          <el-input
            v-model="authToken"
            placeholder="Authorization 值（如 Bearer xxx 或直接填 key）"
            show-password
          />
          <div class="form-hint">填入后会作为 Authorization 请求头发送。留空表示不修改（编辑时）。</div>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
        <el-form-item>
          <el-button :loading="testing" @click="onTestForm"><AppIcon name="plug" :size="14" class="btn-icon" />测试连接</el-button>
          <span v-if="testResult" class="test-result" :class="{ ok: testResult.connected, err: !testResult.connected }">
            <template v-if="testResult.connected"><AppIcon name="check-circle" :size="14" class="btn-icon" />连接成功，发现 {{ testResult.toolCount }} 个工具</template>
            <template v-else><AppIcon name="x" :size="14" class="btn-icon" />{{ testResult.error }}</template>
          </span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  listMcpServers, createMcpServer, updateMcpServer, deleteMcpServer,
  testMcpConnection, refreshMcpServer, listMcpToolsByServer,
  updateMcpTool, listMcpLogs, testMcpServerById,
  type McpServer, type McpTool, type McpCallLog,
} from '@/api'

const router = useRouter()
const goChat = () => router.push('/')

const servers = ref<McpServer[]>([])
const tools = ref<McpTool[]>([])
const logs = ref<McpCallLog[]>([])
const expanded = ref<string | null>(null)
const loadingTools = reactive<Record<string, boolean>>({})

const roleOptions = [
  { value: 'receptionist', label: '接待员' },
  { value: 'investigator', label: '调查主管' },
  { value: 'worker_business', label: '工商调查员' },
  { value: 'worker_credit', label: '征信调查员' },
  { value: 'worker_financial', label: '财务调查员' },
  { value: 'worker_litigation', label: '司法调查员' },
  { value: 'worker_tax', label: '税务调查员' },
  { value: 'skill_executor', label: '技能执行员' },
]

const statusLabel = (s: string) =>
  ({ unknown: '未连接', connecting: '连接中', connected: '已连接', error: '连接失败' }[s] || s)
const statusType = (s: string) =>
  ({ connected: 'success', error: 'danger', connecting: 'warning' }[s] || 'info')

async function loadServers() {
  servers.value = await listMcpServers()
  tools.value = []
  for (const s of servers.value) {
    if (s.tool_count > 0) {
      // 不自动全部加载，按需展开
    }
  }
}

function toolsOfServer(id: string) {
  return tools.value.filter((t) => t.server_id === id)
}

async function toggleTools(s: McpServer) {
  if (expanded.value === s.id) {
    expanded.value = null
    return
  }
  expanded.value = s.id
  if (toolsOfServer(s.id).length === 0) {
    loadingTools[s.id] = true
    try {
      const list = await listMcpToolsByServer(s.id)
      tools.value = tools.value.filter((t) => t.server_id !== s.id).concat(list)
    } finally {
      loadingTools[s.id] = false
    }
  }
}

async function onTest(s: McpServer) {
  ElMessage.info('正在测试连接…')
  const res = await testMcpServerById(s.id)
  if (res.connected) ElMessage.success(`连接成功，发现 ${res.toolCount} 个工具`)
  else ElMessage.error(`连接失败：${res.error}`)
}

async function onRefresh(s: McpServer) {
  try {
    const res = await refreshMcpServer(s.id)
    ElMessage.success(`已刷新，发现 ${res.toolCount} 个工具`)
    tools.value = tools.value.filter((t) => t.server_id !== s.id)
    await loadServers()
    const { loadMcpToolNames } = await import('@/composables/useMcpToolNames')
    loadMcpToolNames(true)
  } catch (e) {
    ElMessage.error('刷新失败：' + (e as Error).message)
  }
}

async function onToggleTool(row: McpTool, v: boolean) {
  await updateMcpTool(row.id, { enabled: v })
  row.enabled = v ? 1 : 0
  ElMessage.success(v ? '已启用' : '已停用')
}

async function onBindRoles(row: McpTool, roles: string[]) {
  const res = await updateMcpTool(row.id, { boundRoles: roles })
  row.boundRoles = res.tool.boundRoles
  ElMessage.success('角色绑定已更新')
}

async function onRenameTool(row: McpTool, name: string) {
  const trimmed = name.trim()
  if (!trimmed) { ElMessage.warning('显示名称不能为空'); return }
  if (trimmed === row.display_name) return
  const res = await updateMcpTool(row.id, { displayName: trimmed })
  row.display_name = res.tool.display_name
  // 刷新全局工具名映射
  const { loadMcpToolNames } = await import('@/composables/useMcpToolNames')
  loadMcpToolNames(true)
  ElMessage.success('显示名称已更新')
}

async function onDelete(s: McpServer) {
  await deleteMcpServer(s.id)
  ElMessage.success('已删除')
  await loadServers()
}

// ---- 弹窗 ----
const dialogVisible = ref(false)
const editing = ref<McpServer | null>(null)
const saving = ref(false)
const testing = ref(false)
const authToken = ref('')
const testResult = ref<{ connected: boolean; toolCount?: number; error?: string } | null>(null)
const form = reactive({ name: '', slug: '', url: '', enabled: true })

function buildHeaders(): Record<string, string> {
  return authToken.value ? { Authorization: authToken.value } : {}
}

function openCreate() {
  editing.value = null
  Object.assign(form, { name: '', slug: '', url: '', enabled: true })
  authToken.value = ''
  testResult.value = null
  dialogVisible.value = true
}

function openEdit(s: McpServer) {
  editing.value = s
  Object.assign(form, { name: s.name, slug: s.slug, url: s.url, enabled: s.enabled === 1 })
  authToken.value = '' // 留空表示不改
  testResult.value = null
  dialogVisible.value = true
}

async function onTestForm() {
  if (!form.url) return ElMessage.warning('请先填 URL')
  testing.value = true
  testResult.value = null
  try {
    const res = await testMcpConnection({ url: form.url, headers: buildHeaders() })
    testResult.value = res
  } finally {
    testing.value = false
  }
}

async function onSave() {
  if (!form.name || !form.slug || !form.url) return ElMessage.warning('名称、slug、URL 必填')
  saving.value = true
  try {
    const payload = {
      name: form.name, slug: form.slug, url: form.url, enabled: form.enabled,
      headers: authToken.value ? { Authorization: authToken.value } : undefined,
    }
    if (editing.value) {
      await updateMcpServer(editing.value.id, payload)
      ElMessage.success('已保存')
    } else {
      const res = await createMcpServer(payload)
      if (res.connectError) ElMessage.warning(`数据源已保存，但连接失败：${res.connectError}`)
      else ElMessage.success(`已添加，发现 ${res.toolCount} 个工具`)
    }
    dialogVisible.value = false
    await loadServers()
  } catch (e) {
    ElMessage.error('保存失败：' + (e as Error).message)
  } finally {
    saving.value = false
  }
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { hour12: false })
}

async function loadLogs() {
  logs.value = await listMcpLogs({ limit: 50 })
}

onMounted(async () => {
  await loadServers()
  await loadLogs()
})
</script>

<style lang="scss" scoped>
.mcp-view {
  max-width: 1100px;
  margin: 0 auto;
  padding: 20px 24px 40px;
  min-height: 100vh;
  background: var(--pf-bg-app);
}
.btn-icon {
  margin-right: 5px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.header-title { display: flex; align-items: center; gap: 12px; }
.header-title h1 { font-size: 18px; font-weight: 700; color: var(--pf-text-1); margin: 0; }
.header-title p { margin: 2px 0 0; color: var(--pf-text-3); font-size: 12.5px; }
.empty-state {
  background: var(--pf-bg-surface);
  border: 1px dashed var(--pf-border-strong);
  border-radius: var(--pf-r-xl);
  padding: 64px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.empty-icon {
  margin-bottom: 18px;
  :deep(.app-icon) {
    width: 84px !important;
    height: 84px !important;
    border-radius: 26px !important;
  }
  :deep(.app-icon svg) {
    width: 42px !important;
    height: 42px !important;
  }
}
.empty-state h3 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--pf-text-1);
}
.empty-state p {
  margin: 0 0 22px;
  font-size: 13px;
  color: var(--pf-text-3);
  max-width: 420px;
  line-height: 1.7;
}
.server-card {
  margin-bottom: 14px;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  transition: box-shadow 0.18s, border-color 0.18s;
  &:hover { box-shadow: var(--pf-shadow-sm); border-color: var(--pf-border-strong); }
}
.server-head { display: flex; align-items: center; justify-content: space-between; }
.server-title { display: flex; align-items: center; gap: 8px; color: var(--pf-text-1); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--pf-text-3); display: inline-block; }
.dot.connected { background: var(--pf-success); }
.dot.error { background: var(--pf-danger); }
.dot.connecting { background: var(--pf-warning); }
.server-actions { display: flex; gap: 6px; }
.server-url { color: var(--pf-text-3); font-size: 12px; margin-top: 8px; word-break: break-all; }
.server-error { color: var(--pf-danger-text); font-size: 12px; margin-top: 6px; }
.server-meta { margin-top: 10px; }
.tool-panel { margin-top: 12px; border-top: 1px dashed var(--pf-border); padding-top: 12px; }
.tool-empty { color: var(--pf-text-3); font-size: 13px; padding: 16px 0; text-align: center; }
.tool-name { margin-bottom: 2px; }
.tool-raw { font-family: 'SF Mono', 'Menlo', monospace; font-size: 11px; color: var(--pf-text-3); }
.tool-desc { color: var(--pf-text-3); font-size: 12px; margin-top: 2px; }
.log-section {
  margin-top: 24px;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-xl);
  padding: 16px 18px;
}
.log-section h2 { font-size: 16px; font-weight: 700; color: var(--pf-text-1); margin: 0 0 12px; }
.log-section--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--pf-text-3);
  font-size: 13px;
  padding: 22px;
  border-style: dashed;
}
.log-preview { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
.log-args { color: var(--pf-text-3); }
.log-result { color: var(--pf-text-2); word-break: break-all; }
.log-err { color: var(--pf-danger-text); }
.form-hint { color: var(--pf-text-3); font-size: 12px; margin-top: 4px; }
.test-result {
  margin-left: 12px;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
}
.test-result.ok { color: var(--pf-success-text); }
.test-result.err { color: var(--pf-danger-text); }
</style>
