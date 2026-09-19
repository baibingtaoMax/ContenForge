<template>
  <div class="proto-panel">
    <!-- 工具栏 -->
    <div class="proto-toolbar">
      <div class="toolbar-left">
        <el-button
          type="primary"
          :loading="status === 'generating'"
          :disabled="!projectId"
          @click="generate"
        >
          <AppIcon v-if="!status || status === 'empty'" name="sparkle" :size="14" :stroke-width="2.2" />
          <AppIcon v-else name="refresh" :size="14" />
          {{ status === 'ready' ? '重新生成原型' : '基于需求清单生成原型' }}
        </el-button>
        <el-dropdown trigger="click" :disabled="status === 'generating'" @command="changeLayout">
          <el-button :disabled="status === 'generating'">
            <AppIcon :name="layout === 'topnav' ? 'layout-topnav' : 'layout-sidebar'" :size="14" />
            {{ layout === 'topnav' ? '顶部导航' : '侧边导航' }}
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="l in LAYOUTS"
                :key="l.key"
                :command="l.key"
                :class="{ 'theme-current': layout === l.key }"
              >
                <AppIcon :name="l.icon" :size="13" style="margin-right:8px;color:var(--pf-text-3)" />
                {{ l.name }}
                <span class="theme-check" v-if="layout === l.key">✓</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button v-if="hasProto" @click="openInNewWindow">
          <AppIcon name="external-link" :size="14" /> 新窗口打开
        </el-button>
        <el-dropdown v-if="hasProto" trigger="click" @command="changeTheme">
          <el-button>
            <AppIcon name="palette" :size="14" /> 主题
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="t in THEMES"
                :key="t.key"
                :command="t.key"
                :class="{ 'theme-current': theme === t.key }"
              >
                <span class="theme-dot" :style="{ background: t.dot }"></span>{{ t.name }}
                <span v-if="theme === t.key" class="theme-check">✓</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <span v-if="hasProto && updatedAt" class="updated-at">
          更新于 {{ formatTime(updatedAt) }}
        </span>
      </div>
      <div v-if="status === 'generating'" class="generating-tip">
        <el-icon class="is-loading"><Loading /></el-icon>
        AI 正在读需求文档生成原型，骨架出来后页面逐页长出…
      </div>
    </div>

    <!-- 原型站（shell 自己处理 empty/error/generating/ready 全部状态） -->
    <iframe
      v-if="projectId"
      :key="iframeNonce"
      :src="iframeSrc"
      class="proto-iframe"
      title="原型预览"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { Loading, ArrowDown } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import AppIcon from './AppIcon.vue'

const THEMES = [
  { key: 'saas', name: '明亮 SaaS', dot: '#6366F1' },
  { key: 'dark', name: '深色科技', dot: '#0EA5E9' },
  { key: 'finance', name: '金融稳重', dot: '#1E3A5F' },
  { key: 'consumer', name: '消费活力', dot: '#FF6B5B' },
] as const

const LAYOUTS = [
  { key: 'sidebar', name: '侧边导航', icon: 'layout-sidebar' },
  { key: 'topnav', name: '顶部导航', icon: 'layout-topnav' },
] as const

type ThemeKey = typeof THEMES[number]['key']
type LayoutKey = typeof LAYOUTS[number]['key']

const props = defineProps<{ projectId?: string }>()

const status = ref<'empty' | 'generating' | 'ready' | 'error'>('empty')
const error = ref<string | null>(null)
const updatedAt = ref<string | null>(null)
const hasProto = ref(false)
const theme = ref<ThemeKey>('saas')
const layout = ref<LayoutKey>('sidebar')
const iframeNonce = ref(0)
let pollTimer: ReturnType<typeof setInterval> | null = null

const iframeSrc = computed(() =>
  props.projectId ? `/proto/${props.projectId}?t=${iframeNonce.value}` : ''
)

async function fetchStatus() {
  if (!props.projectId) return
  try {
    const { data } = await axios.get(`/api/projects/${props.projectId}/prototype`)
    status.value = data.status
    error.value = data.error
    updatedAt.value = data.updatedAt
    hasProto.value = !!data.spec || data.status === 'generating'
    if (data.spec?.theme) theme.value = data.spec.theme
    if (data.spec?.layout === 'topnav' || data.spec?.layout === 'sidebar') layout.value = data.spec.layout
    if (data.status === 'generating') startPolling()
    else stopPolling()
  } catch {
    // 静默
  }
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(fetchStatus, 4000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function generate() {
  if (!props.projectId) return
  status.value = 'generating'
  error.value = null
  hasProto.value = true
  iframeNonce.value++ // 重新挂 iframe，shell 自己轮询
  startPolling()
  try {
    await axios.post(`/api/projects/${props.projectId}/prototype/generate`, { layout: layout.value })
  } catch (e: any) {
    stopPolling()
    hasProto.value = true
    ElMessage.error(e?.response?.data?.error || '生成触发失败')
  }
}

function openInNewWindow() {
  if (props.projectId) window.open(`/proto/${props.projectId}`, '_blank')
}

async function changeTheme(key: string) {
  if (!props.projectId || key === theme.value) return
  try {
    await axios.post(`/api/projects/${props.projectId}/prototype/theme`, { theme: key })
    theme.value = key as ThemeKey
    iframeNonce.value++ // 重载 iframe，壳按新主题渲染（不重新生成）
    ElMessage.success('主题已切换')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '主题切换失败')
  }
}

async function changeLayout(key: string) {
  if (!props.projectId || key === layout.value) return
  const next = key as LayoutKey
  // 还没生成：只记住选择，随下次生成带给后端
  if (!hasProto.value) { layout.value = next; return }
  try {
    await axios.post(`/api/projects/${props.projectId}/prototype/layout`, { layout: key })
    layout.value = next
    iframeNonce.value++ // 重载 iframe，壳按新布局渲染（不重新生成）
    ElMessage.success('布局已切换')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '布局切换失败')
  }
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

watch(() => props.projectId, fetchStatus, { immediate: false })
onMounted(fetchStatus)
onUnmounted(stopPolling)
</script>

<style scoped lang="scss">
.proto-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--pf-bg-app);
}
.proto-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  background: var(--pf-bg-surface);
  border-bottom: 1px solid var(--pf-border);
  flex-shrink: 0;
}
.toolbar-left { display: flex; align-items: center; gap: 10px; }
.updated-at { font-size: 12px; color: var(--pf-text-3); }
.generating-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--pf-primary);
  font-weight: 500;
}
.proto-iframe {
  flex: 1;
  width: 100%;
  border: none;
  background: #fff;
}
:deep(.theme-dot) {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
}
:deep(.theme-current) {
  font-weight: 600;
  color: var(--pf-primary);
}
:deep(.theme-check) {
  margin-left: auto;
  padding-left: 12px;
  color: var(--pf-primary);
  font-weight: 700;
}
</style>
