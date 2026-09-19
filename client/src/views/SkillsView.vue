<template>
  <div class="skills-view">
    <!-- 顶部页头 -->
    <header class="page-header">
      <div class="header-left">
        <el-button text :icon="ArrowLeft" @click="goChat">返回对话</el-button>
        <div class="header-title">
          <AppIcon name="zap" tint="amber" :size="40" />
          <div>
            <h1>技能中心</h1>
            <p>管理、安装和创建 AI 技能</p>
          </div>
        </div>
      </div>
      <div class="header-right">
        <el-upload :show-file-list="false" :before-upload="onUpload" accept=".md,.markdown">
          <el-button :loading="uploading"><AppIcon name="upload" :size="15" class="btn-icon" />上传 SKILL.md</el-button>
        </el-upload>
        <el-button type="primary" plain @click="aiDrawer = true" :loading="generating">
          <AppIcon name="sparkle" :size="15" class="btn-icon" /> AI 起草
        </el-button>
        <el-button type="primary" @click="onCreate">
          <AppIcon name="plus" :size="15" :stroke-width="2.4" class="btn-icon" /> 新建技能
        </el-button>
      </div>
    </header>

    <!-- 工具栏：搜索 + Tab -->
    <div class="toolbar">
      <el-input
        v-model="keyword"
        class="search"
        :placeholder="tab === 'tools' ? '搜索工具名称 / 说明' : '搜索技能名称 / ID / 关键词'"
        clearable
      >
        <template #prefix><AppIcon name="search" :size="15" /></template>
      </el-input>
      <el-radio-group v-model="tab" class="tab-switch" @change="onTabChange">
        <el-radio-button value="installed">我的技能 ({{ installed.length }})</el-radio-button>
        <el-radio-button value="library">技能市场 ({{ uninstalledCount }})</el-radio-button>
        <el-radio-button value="tools">可用工具 ({{ tools.length }})</el-radio-button>
      </el-radio-group>
      <div class="toolbar-spacer"></div>
    </div>

    <!-- 卡片网格，铺满 -->
    <div v-loading="loading" class="card-grid">
      <template v-if="tab === 'installed'">
        <div
          v-for="s in filteredInstalled"
          :key="s.id"
          class="skill-card"
          :class="{ disabled: !s.enabled }"
          @click="openDetail(s.id)"
        >
          <div class="card-top">
            <span class="card-name"><AppIcon name="zap" tint="amber" :size="26" class="card-icon" />{{ s.name }}</span>
            <el-tag v-if="!s.enabled" size="small" type="info" effect="plain">已禁用</el-tag>
          </div>
          <div class="card-id mono">{{ s.id }}</div>
          <div class="card-desc">{{ s.description || '（无描述）' }}</div>
          <div v-if="s.keywords?.length" class="card-kws">
            <el-tag v-for="k in s.keywords.slice(0, 3)" :key="k" size="small" effect="plain" round>{{ k }}</el-tag>
            <span v-if="s.keywords.length > 3" class="kw-more">+{{ s.keywords.length - 3 }}</span>
          </div>
        </div>
      </template>

      <template v-else-if="tab === 'library'">
        <div
          v-for="s in filteredLibrary"
          :key="s.id"
          class="skill-card"
          @click="openDetail(s.id)"
        >
          <div class="card-top">
            <span class="card-name"><AppIcon name="zap" tint="amber" :size="26" class="card-icon" />{{ s.name }}</span>
            <el-tag v-if="s.installed" size="small" type="success" effect="plain">已安装</el-tag>
          </div>
          <div class="card-id mono">{{ s.id }}</div>
          <div class="card-desc">{{ s.description }}</div>
          <div v-if="s.keywords?.length" class="card-kws">
            <el-tag v-for="k in s.keywords.slice(0, 3)" :key="k" size="small" effect="plain" round>{{ k }}</el-tag>
          </div>
        </div>
      </template>

      <template v-else>
        <div
          v-for="t in filteredTools"
          :key="t.name"
          class="tool-card"
          @click="copyTool(t.name)"
        >
          <div class="tool-top">
            <span class="tool-label"><AppIcon name="wrench" tint="sky" :size="26" class="card-icon" />{{ t.label }}</span>
            <el-tag size="small" effect="plain" :type="groupType(t.group)">{{ t.group }}</el-tag>
          </div>
          <div class="tool-name mono">{{ t.name }}</div>
          <div class="tool-summary">{{ t.summary }}</div>
          <div class="tool-returns">
            <span class="returns-label">返回：</span>{{ t.returns }}
          </div>
          <div class="tool-foot">
            <el-tag v-if="t.needsEnterpriseId" size="small" type="warning" effect="plain">需企业 ID</el-tag>
            <span class="tool-hint">点击复制工具名</span>
          </div>
        </div>
      </template>

      <el-empty
        v-if="tab !== 'tools' && !loading && (tab === 'installed' ? filteredInstalled.length === 0 : filteredLibrary.length === 0)"
        :description="keyword ? '没有匹配的技能' : (tab === 'installed' ? '还没有技能，新建或去市场安装' : '市场暂无技能')"
        class="grid-empty"
      />
      <el-empty
        v-else-if="tab === 'tools' && filteredTools.length === 0"
        description="没有匹配的工具"
        class="grid-empty"
      />
    </div>

    <!-- 详情 / 编辑 抽屉 -->
    <el-drawer
      :model-value="detailOpen"
      :size="mode === 'edit' ? '72%' : '520px'"
      :title="mode === 'edit' ? (editingId ? '编辑技能' : '新建技能') : (selected?.name || '技能详情')"
      direction="rtl"
      :before-close="handleDrawerClose"
    >
      <template v-if="selected && mode === 'view'">
        <div class="detail-view">
          <div class="detail-actions">
            <template v-if="tab === 'installed'">
              <el-switch
                :model-value="(selected as SkillDetail).enabled"
                active-text="启用"
                inactive-text="禁用"
                inline-prompt
                @change="(v: boolean) => onToggle(selected as SkillDetail, v)"
              />
              <el-button @click="onEdit"><AppIcon name="edit" :size="15" class="btn-icon" />编辑</el-button>
              <el-button type="danger" plain @click="onDelete(selected as SkillDetail)"><AppIcon name="trash" :size="15" class="btn-icon" />删除</el-button>
            </template>
            <template v-else>
              <el-button
                v-if="!isInstalled(selected.id)"
                type="primary"
                @click="onInstall(selected as LibrarySkill)"
              ><AppIcon name="download" :size="15" class="btn-icon" />安装到我的技能</el-button>
              <el-tag v-else type="success" effect="plain">已安装</el-tag>
            </template>
          </div>

          <el-tag size="small" effect="plain" type="info" class="mono detail-id">{{ selected.id }}</el-tag>
          <p class="detail-description">{{ selected.description || '（无描述）' }}</p>

          <div v-if="selected.keywords?.length" class="detail-keywords">
            <el-tag v-for="k in selected.keywords" :key="k" effect="plain" round size="small">{{ k }}</el-tag>
          </div>

          <el-divider />

          <div v-if="tab === 'installed' && (selected as SkillDetail).body" class="markdown-body skill-doc" v-html="renderMarkdown((selected as SkillDetail).body)"></div>
          <el-alert
            v-else-if="tab === 'library'"
            type="info"
            :closable="false"
            show-icon
            title="这是内置技能库中的技能。安装后即可在对话中由接待员自动召唤，或通过输入框技能按钮手动执行。"
          />
          <el-empty v-else description="该技能没有说明书内容" :image-size="60" />
        </div>
      </template>

      <div v-else-if="mode === 'edit'" class="detail-edit">
        <el-form :model="form" label-position="top" class="edit-form">
          <div class="edit-fields">
            <el-form-item label="技能 ID" required>
              <el-input
                v-model="form.id"
                :disabled="!!editingId"
                placeholder="kebab-case，保存后不可改"
              />
            </el-form-item>
            <el-form-item label="名称" required>
              <el-input v-model="form.name" placeholder="展示名称" />
            </el-form-item>
            <el-form-item label="关键词（逗号分隔）">
              <el-input v-model="keywordsText" placeholder="如：字段核对, 一致性检查, 生成前检查" />
            </el-form-item>
          </div>
          <el-form-item label="一句话描述">
            <el-input v-model="form.description" type="textarea" :rows="2" placeholder="接待员靠它判断何时召唤该技能" />
          </el-form-item>
          <el-form-item>
            <template #label>
              <div class="editor-label">
                <span>授权工具</span>
                <el-tooltip placement="top" content="勾选该技能执行时允许调用的工具。内置工具默认可用；外部数据源工具未全局绑定给技能执行员时，需在这里声明后才能调用。">
                  <el-icon class="help-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </div>
            </template>
            <div class="tools-auth">
              <div v-for="grp in toolGroups" :key="grp.name" class="tools-auth-group">
                <div class="tag-group-name">{{ grp.name }}</div>
                <el-checkbox-group v-model="form.tools!" class="tools-auth-list">
                  <el-checkbox v-for="t in grp.tools" :key="t.name" :value="t.name" border size="small">
                    <span class="ta-label">{{ t.label }}</span>
                    <span class="ta-name mono">{{ t.name }}</span>
                  </el-checkbox>
                </el-checkbox-group>
              </div>
            </div>
          </el-form-item>
          <el-form-item>
            <template #label>
              <div class="editor-label">
                <span>技能说明书（Markdown，左编辑 / 右预览）</span>
                <el-popover
                  v-model:visible="insertPopVisible"
                  placement="bottom-end"
                  :width="360"
                  trigger="click"
                  @show="insertSearch = ''"
                >
                  <template #reference>
                    <el-button size="small"><AppIcon name="wrench" :size="14" class="btn-icon" />插入工具</el-button>
                  </template>
                  <div class="insert-tool-pop">
                    <el-input
                      v-model="insertSearch"
                      size="small"
                      placeholder="搜索工具名称 / 说明"
                      clearable
                    >
                      <template #prefix><AppIcon name="search" :size="14" /></template>
                    </el-input>
                    <div class="insert-tool-list">
                      <div
                        v-for="t in filteredInsertTools"
                        :key="t.name"
                        class="it-item"
                        @click="insertTool(t.name)"
                      >
                        <div class="it-head">
                          <span class="mono it-name">{{ t.name }}</span>
                          <el-tag size="small" effect="plain" :type="groupType(t.group)">{{ t.group }}</el-tag>
                        </div>
                        <div class="it-summary">{{ t.summary }}</div>
                      </div>
                      <div v-if="filteredInsertTools.length === 0" class="it-empty">无匹配工具</div>
                    </div>
                  </div>
                </el-popover>
              </div>
            </template>
            <div class="md-editor">
              <textarea
                ref="bodyTextarea"
                v-model="form.body"
                class="md-input"
                spellcheck="false"
                placeholder="## 角色定位&#10;## 执行步骤&#10;## 输出格式&#10;## 注意事项"
              ></textarea>
              <div class="md-preview markdown-body" v-html="renderMarkdown(form.body || '')"></div>
            </div>
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <div v-if="mode === 'edit'" class="drawer-footer">
          <el-button @click="cancelEdit">取消</el-button>
          <el-button type="primary" :loading="saving" @click="onSave">保存技能</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- AI 起草抽屉 -->
    <el-drawer v-model="aiDrawer" title="AI 起草技能" size="480px" direction="rtl">
      <div class="ai-drawer">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
          用大白话描述你想要的套路活，AI 会生成包含「角色定位 / 执行步骤 / 输出格式 / 注意事项」的说明书草稿，生成后可在编辑器里调整保存。约需 1-2 分钟。
        </el-alert>
        <el-input
          v-model="aiDesc"
          type="textarea"
          :rows="10"
          placeholder="例如：在生成原型前，把一条页面需求跟原型里已有的页面、数据集对一遍，检查字段有没有漏、状态枚举对不对、按钮操作有没有对应的页面去向，输出差异清单和修改建议。"
        />
        <div class="ai-tip">
          <p><AppIcon name="lightbulb" :size="15" class="tip-icon" />描述越具体越好，可以提到：</p>
          <ul>
            <li>要分析什么材料（已沉淀的需求 / 上传的文档截图 / 竞品网页 / 已有原型）</li>
            <li>按什么步骤、哪些维度逐项检查或判断</li>
            <li>希望输出什么格式（表格 / 清单 / 固定章节报告）</li>
          </ul>
        </div>
      </div>
      <template #footer>
        <div class="ai-footer">
          <el-button @click="aiDrawer = false">取消</el-button>
          <el-button type="primary" :loading="generating" @click="doGenerate">生成草稿</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, QuestionFilled } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  listSkills, getSkill, createSkill, updateSkill, toggleSkill, deleteSkill,
  listLibrary, installFromLibrary, uploadSkill, generateSkill, listSkillTools,
  type SkillDetail, type SkillInput, type LibrarySkill, type SkillTool,
} from '@/api'
import { renderMarkdown } from '@/utils/markdown'

const router = useRouter()

const tab = ref<'installed' | 'library' | 'tools'>('installed')
const keyword = ref('')
const loading = ref(false)
const uploading = ref(false)

// 工具目录
const tools = ref<SkillTool[]>([])
const bodyTextarea = ref<HTMLTextAreaElement | null>(null)
// 插入工具弹层
const insertPopVisible = ref(false)
const insertSearch = ref('')

// 数据
const installed = ref<SkillDetail[]>([])
const library = ref<LibrarySkill[]>([])
const selectedId = ref<string | null>(null)
const detailOpen = ref(false)
const mode = ref<'view' | 'edit'>('view')

// 编辑器
const editingId = ref<string | null>(null)
const saving = ref(false)
const form = ref<SkillInput>({ id: '', name: '', description: '', keywords: [], body: '', enabled: true })
const keywordsText = ref('')

// AI 起草
const aiDrawer = ref(false)
const aiDesc = ref('')
const generating = ref(false)

const uninstalledCount = computed(() => library.value.filter((s) => !s.installed).length)

const selected = computed<SkillDetail | LibrarySkill | null>(() => {
  if (!selectedId.value) return null
  if (tab.value === 'installed') return installed.value.find((s) => s.id === selectedId.value) || null
  return library.value.find((s) => s.id === selectedId.value) || null
})

const filteredInstalled = computed(() => filterSkills(installed.value))
const filteredLibrary = computed(() => filterSkills(library.value))
const filteredInsertTools = computed(() => {
  const kw = insertSearch.value.trim().toLowerCase()
  if (!kw) return tools.value
  return tools.value.filter((t) =>
    t.name.toLowerCase().includes(kw) ||
    t.label.toLowerCase().includes(kw) ||
    t.summary.toLowerCase().includes(kw)
  )
})
const filteredTools = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return tools.value
  return tools.value.filter((t) =>
    t.name.toLowerCase().includes(kw) ||
    t.label.toLowerCase().includes(kw) ||
    t.summary.toLowerCase().includes(kw) ||
    t.returns.toLowerCase().includes(kw)
  )
})

// 授权工具按分组聚合（编辑器里勾选）
const toolGroups = computed(() => {
  const map = new Map<string, SkillTool[]>()
  for (const t of tools.value) {
    if (!map.has(t.group)) map.set(t.group, [])
    map.get(t.group)!.push(t)
  }
  return [...map.entries()].map(([name, tools]) => ({ name, tools }))
})

function filterSkills<T extends { name: string; id: string; description?: string; keywords?: string[] }>(list: T[]): T[] {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter((s) =>
    s.name.toLowerCase().includes(kw) ||
    s.id.toLowerCase().includes(kw) ||
    (s.description || '').toLowerCase().includes(kw) ||
    (s.keywords || []).some((k) => k.toLowerCase().includes(kw))
  )
}

function groupType(group: string): '' | 'success' | 'warning' | 'info' {
  if (group === '企业取数') return 'success'
  if (group === '项目材料') return 'warning'
  return 'info'
}

function isInstalled(id: string): boolean {
  return installed.value.some((s) => s.id === id)
}

function goChat() {
  router.push('/')
}

onMounted(async () => {
  await Promise.all([loadInstalled(), loadLibrary(), loadTools()])
})

function onTabChange() {
  closeDetail()
}

async function openDetail(id: string) {
  selectedId.value = id
  mode.value = 'view'
  detailOpen.value = true
  if (tab.value === 'installed') {
    const fresh = await getSkill(id).catch(() => null)
    if (fresh) {
      const idx = installed.value.findIndex((s) => s.id === id)
      if (idx >= 0) installed.value[idx] = fresh
    }
  }
}

function closeDetail() {
  detailOpen.value = false
  selectedId.value = null
  editingId.value = null
  mode.value = 'view'
}

function handleDrawerClose(done: () => void) {
  closeDetail()
  done()
}

async function loadInstalled() {
  loading.value = true
  try {
    installed.value = await listSkills(true)
  } catch (e: any) {
    ElMessage.error(e.message || '加载已安装技能失败')
  } finally {
    loading.value = false
  }
}

async function loadLibrary() {
  try {
    library.value = await listLibrary()
  } catch (e: any) {
    ElMessage.error(e.message || '加载技能市场失败')
  }
}

async function loadTools() {
  try {
    tools.value = await listSkillTools()
  } catch (e: any) {
    ElMessage.error(e.message || '加载工具目录失败')
  }
}

function onCreate() {
  tab.value = 'installed'
  editingId.value = null
  selectedId.value = null
  form.value = { id: '', name: '', description: '', keywords: [], tools: [], body: defaultBody(), enabled: true }
  keywordsText.value = ''
  mode.value = 'edit'
  detailOpen.value = true
}

function onEdit() {
  if (!selected.value || tab.value !== 'installed') return
  const s = selected.value as SkillDetail
  editingId.value = s.id
  form.value = { id: s.id, name: s.name, description: s.description, keywords: [...s.keywords], tools: s.tools ? [...s.tools] : [], body: s.body, enabled: s.enabled }
  keywordsText.value = s.keywords.join(', ')
  mode.value = 'edit'
}

function cancelEdit() {
  if (editingId.value) {
    mode.value = 'view'
  } else {
    closeDetail()
  }
}

async function onSave() {
  if (!form.value.name?.trim()) { ElMessage.warning('请填写名称'); return }
  if (!editingId.value && !form.value.id?.trim()) { ElMessage.warning('请填写技能 ID'); return }
  const keywords = keywordsText.value.split(/[,，]/).map((k) => k.trim()).filter(Boolean)
  saving.value = true
  try {
    if (editingId.value) {
      const updated = await updateSkill(editingId.value, { ...form.value, keywords, tools: form.value.tools || [] })
      ElMessage.success('已保存')
      const idx = installed.value.findIndex((s) => s.id === editingId.value)
      if (idx >= 0) installed.value[idx] = updated
      selectedId.value = editingId.value
    } else {
      const created = await createSkill({ ...form.value, id: form.value.id!.trim(), keywords, tools: form.value.tools || [] })
      ElMessage.success('已创建')
      editingId.value = created.id
      await loadInstalled()
      await loadLibrary()
      selectedId.value = created.id
    }
    mode.value = 'view'
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function onToggle(s: SkillDetail, enabled: boolean) {
  try {
    await toggleSkill(s.id, enabled)
    s.enabled = enabled
    ElMessage.success(enabled ? '已启用' : '已禁用')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e.message || '操作失败')
  }
}

async function onDelete(s: SkillDetail | LibrarySkill) {
  try {
    await ElMessageBox.confirm(`确定删除技能「${s.name}」？该操作会删除 SKILL.md 文件且不可恢复。`, '删除确认', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
  } catch { return }
  try {
    await deleteSkill(s.id)
    ElMessage.success('已删除')
    closeDetail()
    await loadInstalled()
    await loadLibrary()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e.message || '删除失败')
  }
}

async function onInstall(s: LibrarySkill) {
  try {
    await installFromLibrary(s.id)
    ElMessage.success(`已安装：${s.name}`)
    s.installed = true
    await loadInstalled()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e.message || '安装失败')
  }
}

async function onUpload(file: File) {
  if (!file.name.toLowerCase().endsWith('.md')) {
    ElMessage.warning('请上传 .md 文件（SKILL.md）')
    return false
  }
  uploading.value = true
  try {
    const skill = await uploadSkill(file)
    ElMessage.success(`已安装：${skill.name}`)
    tab.value = 'installed'
    await loadInstalled()
    await loadLibrary()
    openDetail(skill.id)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e.message || '上传安装失败')
  } finally {
    uploading.value = false
  }
  return false
}

async function doGenerate() {
  if (!aiDesc.value.trim()) { ElMessage.warning('请描述技能需求'); return }
  generating.value = true
  try {
    const draft = await generateSkill(aiDesc.value.trim())
    ElMessage.success('草稿已生成，可在编辑器中调整后保存')
    aiDrawer.value = false
    tab.value = 'installed'
    editingId.value = null
    selectedId.value = null
    form.value = {
      id: draft.id,
      name: draft.name,
      description: draft.description,
      keywords: draft.keywords,
      tools: draft.tools || [],
      body: extractBody(draft.raw),
      enabled: true,
    }
    keywordsText.value = draft.keywords.join(', ')
    mode.value = 'edit'
    detailOpen.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e.message || '生成失败')
  } finally {
    generating.value = false
  }
}

/** 在说明书光标处插入工具调用语句 */
function insertTool(name: string) {
  const insert = `调用 \`${name}\` 工具`
  const current = form.value.body || ''
  const ta = bodyTextarea.value
  if (!ta) {
    form.value.body = current + (current ? '\n' : '') + insert
  } else {
    const start = ta.selectionStart ?? current.length
    const end = ta.selectionEnd ?? current.length
    form.value.body = current.slice(0, start) + insert + current.slice(end)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + insert.length
      ta.setSelectionRange(pos, pos)
    })
  }
  insertPopVisible.value = false
}

async function copyTool(name: string) {
  try {
    await navigator.clipboard.writeText(name)
    ElMessage.success(`已复制：${name}`)
  } catch {
    ElMessage.warning('复制失败，请手动复制')
  }
}

function extractBody(raw: string): string {
  const m = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)$/)
  return m ? m[1].trim() : raw
}

function defaultBody() {
  return `# 技能名称

## 角色定位
你是……

## 执行步骤
1. 调用 XX 工具获取……
2. ……

## 输出格式
（定义最终输出的结构）

## 注意事项
- 数据不足时标注"数据不足"，不要编造。
`
}
</script>

<style scoped lang="scss">
.skills-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--pf-bg-app);
}

.btn-icon {
  margin-right: 5px;
}

.page-header {
  height: 72px;
  flex-shrink: 0;
  background: var(--pf-bg-surface);
  border-bottom: 1px solid var(--pf-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;

  .header-left { display: flex; align-items: center; gap: 16px; }
  .header-title {
    display: flex;
    align-items: center;
    gap: 12px;
    h1 { font-size: 18px; font-weight: 700; color: var(--pf-text-1); margin: 0; line-height: 1.2; }
    p { font-size: 12.5px; color: var(--pf-text-3); margin: 2px 0 0; }
  }
  .header-right { display: flex; align-items: center; gap: 10px; }
}

.toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 28px 14px;
  .search { width: 320px; }
  .toolbar-spacer { flex: 1; }
}

.card-grid {
  flex: 1;
  overflow-y: auto;
  padding: 4px 28px 28px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  align-content: start;
}

.grid-empty {
  grid-column: 1 / -1;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  padding: 40px 0;
}

.card-icon {
  margin-right: 8px;
  vertical-align: middle;
}

.skill-card {
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  padding: 18px;
  cursor: pointer;
  transition: all 0.18s;
  display: flex;
  flex-direction: column;
  min-height: 150px;

  &:hover {
    border-color: var(--pf-primary-200);
    box-shadow: var(--pf-shadow-sm);
    transform: translateY(-2px);
  }
  &.disabled { opacity: 0.6; background: var(--pf-bg-subtle); }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    .card-name { font-size: 15px; font-weight: 600; color: var(--pf-text-1); display: flex; align-items: center; }
  }
  .card-id { font-size: 11px; color: var(--pf-text-3); margin-top: 6px; }
  .card-desc {
    font-size: 13px;
    color: var(--pf-text-2);
    line-height: 1.55;
    margin-top: 10px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    flex: 1;
  }
  .card-kws {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    .kw-more { font-size: 11px; color: var(--pf-text-3); }
  }
}

.tool-card {
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  padding: 18px;
  cursor: pointer;
  transition: all 0.18s;
  display: flex;
  flex-direction: column;

  &:hover {
    border-color: var(--pf-primary-200);
    box-shadow: var(--pf-shadow-sm);
    transform: translateY(-2px);
  }
  .tool-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    .tool-label { font-size: 15px; font-weight: 600; color: var(--pf-text-1); display: flex; align-items: center; }
  }
  .tool-name { font-size: 12px; color: var(--pf-text-3); margin-top: 6px; word-break: break-all; }
  .tool-summary {
    font-size: 13px;
    color: var(--pf-text-2);
    line-height: 1.55;
    margin-top: 10px;
    flex: 1;
  }
  .tool-returns {
    font-size: 12px;
    color: var(--pf-text-2);
    line-height: 1.5;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed var(--pf-border);
    .returns-label { color: var(--pf-text-3); }
  }
  .tool-foot {
    margin-top: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    .tool-hint { font-size: 11.5px; color: var(--pf-text-3); }
  }
}

.mono { font-family: 'SF Mono', 'Menlo', monospace; }

/* 抽屉内容 */
.detail-view {
  display: flex;
  flex-direction: column;
  gap: 12px;

  .detail-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  .detail-id { align-self: flex-start; }
  .detail-description {
    font-size: 14.5px;
    color: var(--pf-text-2);
    line-height: 1.65;
    margin: 0;
  }
  .detail-keywords {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .skill-doc { margin-top: 4px; }
}

.detail-edit {
  .edit-fields {
    display: grid;
    grid-template-columns: 1fr 1fr 1.2fr;
    gap: 14px;
  }
  .editor-label {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .help-icon {
    color: var(--pf-text-3);
    cursor: help;
    font-size: 15px;
  }
  .tools-auth {
    width: 100%;
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--pf-border);
    border-radius: var(--pf-r-md);
    padding: 10px 12px;
    .tools-auth-group {
      margin-bottom: 8px;
      &:last-child { margin-bottom: 0; }
      .tag-group-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--pf-text-3);
        margin-bottom: 6px;
      }
      .tools-auth-list {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        .el-checkbox {
          margin-right: 0;
          height: auto;
          padding: 4px 8px;
          display: inline-flex;
          align-items: center;
          .ta-label { font-size: 12.5px; color: var(--pf-text-1); }
          .ta-name {
            font-size: 10.5px;
            color: var(--pf-text-3);
            margin-left: 6px;
            word-break: break-all;
          }
        }
      }
    }
  }
  .md-editor {
    display: flex;
    gap: 12px;
    width: 100%;
    height: 460px;
    border: 1px solid var(--pf-border-strong);
    border-radius: var(--pf-r-md);
    overflow: hidden;
    .md-input {
      flex: 1;
      border: none;
      outline: none;
      resize: none;
      padding: 14px;
      font-family: 'SF Mono', 'Menlo', monospace;
      font-size: 13px;
      line-height: 1.65;
      background: var(--pf-bg-surface);
      color: var(--pf-text-1);
    }
    .md-preview {
      flex: 1;
      border-left: 1px solid var(--pf-border);
      padding: 14px 18px;
      overflow-y: auto;
      background: var(--pf-bg-subtle);
      font-size: 13.5px;
      line-height: 1.7;
    }
  }
}

.insert-tool-pop {
  .insert-tool-list {
    margin-top: 10px;
    max-height: 360px;
    overflow-y: auto;
  }
  .it-item {
    padding: 8px 10px;
    border-radius: var(--pf-r-sm);
    cursor: pointer;
    transition: background 0.15s;
    &:hover { background: var(--pf-primary-50); }
    .it-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      .it-name { font-size: 12px; color: var(--pf-text-1); word-break: break-all; }
    }
    .it-summary {
      font-size: 11.5px;
      color: var(--pf-text-3);
      line-height: 1.5;
      margin-top: 4px;
    }
  }
  .it-empty { text-align: center; color: var(--pf-text-3); font-size: 12.5px; padding: 16px 0; }
}

.drawer-footer, .ai-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}

.ai-drawer {
  .ai-tip {
    margin-top: 16px;
    padding: 14px 16px;
    background: var(--pf-violet-bg);
    border-radius: var(--pf-r-md);
    font-size: 13px;
    color: var(--pf-text-2);
    p { margin: 0 0 6px; font-weight: 600; display: flex; align-items: center; }
    .tip-icon { margin-right: 6px; color: var(--pf-violet); flex-shrink: 0; }
    ul { margin: 0; padding-left: 18px; line-height: 1.8; }
  }
}

.markdown-body {
  :deep(h1), :deep(h2), :deep(h3) { margin: 18px 0 10px; font-weight: 600; color: var(--pf-text-1); }
  :deep(h1) { font-size: 20px; padding-bottom: 8px; border-bottom: 1px solid var(--pf-border); }
  :deep(h2) { font-size: 16.5px; }
  :deep(h3) { font-size: 14.5px; }
  :deep(p) { margin: 8px 0; color: var(--pf-text-2); }
  :deep(ul), :deep(ol) { padding-left: 22px; margin: 8px 0; color: var(--pf-text-2); }
  :deep(li) { margin: 4px 0; }
  :deep(code) { background: var(--pf-bg-hover); padding: 2px 6px; border-radius: 4px; font-size: 12.5px; }
  :deep(pre) { background: var(--pf-bg-subtle); border: 1px solid var(--pf-border); padding: 12px; border-radius: var(--pf-r-md); overflow-x: auto; }
  :deep(pre code) { background: none; padding: 0; }
  :deep(table) { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  :deep(th), :deep(td) { border: 1px solid var(--pf-border); padding: 7px 11px; text-align: left; }
  :deep(th) { background: var(--pf-bg-subtle); font-weight: 600; }
  :deep(blockquote) {
    border-left: 4px solid var(--pf-border-strong);
    padding: 4px 14px;
    color: var(--pf-text-2);
    margin: 10px 0;
    background: var(--pf-bg-subtle);
  }
}
</style>
