<template>
  <div class="chat-input">
    <!-- 待发送附件预览（粘贴/选择后先暂存，不立即上传） -->
    <div v-if="pendingFiles.length || refArticles.length" class="pending-files">
      <!-- 选中的选题 chips -->
      <div v-for="a in refArticles" :key="a.id" class="pending-file ref-chip article-chip">
        <span class="ref-icon fi-art"><AppIcon name="bookmark" :size="14" /></span>
        <div class="pending-meta">
          <span class="pending-name">{{ a.title }}</span>
          <span class="pending-size">选题{{ a.status ? ' · ' + articleStatusLabel(a.status) : '' }}</span>
        </div>
        <el-icon class="pending-remove" @click="removeArticle(a.id)"><Close /></el-icon>
      </div>
      <div v-for="f in pendingFiles" :key="f.id" class="pending-file">
        <img v-if="f.preview" :src="f.preview" class="pending-thumb" />
        <div v-else class="pending-icon"><AppIcon name="file" :size="20" /></div>
        <div class="pending-meta">
          <span class="pending-name">{{ f.file.name }}</span>
          <span class="pending-size">{{ formatSize(f.file.size) }}</span>
        </div>
        <el-icon class="pending-remove" @click="removePending(f.id)"><Close /></el-icon>
      </div>
    </div>

    <div class="input-wrapper">
      <!-- 技能选择 -->
      <el-popover
        placement="top-start"
        :width="320"
        trigger="click"
        :visible="skillPopVisible"
        :disabled="store.isStreaming || uploading"
        @update:visible="(v: boolean) => (skillPopVisible = v)"
      >
        <template #reference>
          <el-button
            class="skill-btn"
            text
            :disabled="store.isStreaming || uploading"
            :class="{ 'is-active': !!selectedSkill }"
            title="选择技能"
          ><AppIcon name="zap" :size="17" :stroke-width="2" /></el-button>
        </template>
        <div class="skill-popover">
            <div class="skill-pop-title">选择技能</div>
            <div v-if="store.skills.length === 0" class="skill-empty">暂无可用技能</div>
            <div
              v-for="s in store.skills"
              :key="s.id"
              class="skill-item"
              :class="{ 'is-selected': selectedSkill?.id === s.id }"
              @click="selectSkill(s)"
            >
              <div class="skill-item-head">
                <span class="skill-item-name"><AppIcon name="zap" :size="13" :stroke-width="2" /> {{ s.name }}</span>
                <span v-if="selectedSkill?.id === s.id" class="skill-check"><AppIcon name="check" :size="13" :stroke-width="2.6" /></span>
              </div>
              <div class="skill-item-desc">{{ s.description }}</div>
            </div>
            <div v-if="selectedSkill" class="skill-clear" @click="selectSkill(null)">清除选择</div>
          </div>
      </el-popover>

      <el-upload
        :show-file-list="false"
        :before-upload="beforePick"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.gif,.webp"
      >
        <el-button
          class="attach-btn"
          text
          :disabled="store.isStreaming || uploading"
          title="上传附件"
        ><AppIcon name="paperclip" :size="17" :stroke-width="2" /></el-button>
      </el-upload>
      <!-- # 引用选题（内容计划文章） -->
      <el-popover
        placement="top-start"
        :width="360"
        trigger="click"
        :visible="articlePopVisible"
        :disabled="store.isStreaming || projectArticles.length === 0"
        @update:visible="(v: boolean) => (articlePopVisible = v)"
      >
        <template #reference>
          <el-button
            class="attach-btn article-btn"
            text
            :class="{ 'is-active': refArticles.length > 0, 'is-disabled': store.isStreaming || projectArticles.length === 0 }"
            :disabled="store.isStreaming || projectArticles.length === 0"
            :title="projectArticles.length ? '选择内容计划里的选题' : '当前项目内容计划还没有选题'"
          ><AppIcon name="bookmark" :size="16" :stroke-width="2" /></el-button>
        </template>
        <div class="ref-popover">
          <div class="ref-pop-title">选择选题（内容计划）</div>
          <el-input v-model="articleQuery" size="small" placeholder="搜索选题标题…" class="ref-search" clearable>
            <template #prefix><AppIcon name="search" :size="13" /></template>
          </el-input>
          <div v-if="filteredArticleGroups.length === 0" class="ref-empty">没有匹配的选题</div>
          <div v-else class="ref-list article-list">
            <template v-for="g in filteredArticleGroups" :key="g.seriesId || '__loose__'">
              <div v-if="g.seriesId" class="article-group-name"><AppIcon name="layers" :size="12" /> {{ g.seriesTitle }}</div>
              <div
                v-for="a in g.items"
                :key="a.id"
                class="ref-item article-item"
                :class="{ 'is-selected': isArticleSelected(a.id) }"
                @click="toggleArticle(a)"
              >
                <span class="article-dot" :class="a.status"></span>
                <span class="ref-item-name">{{ a.title }}</span>
                <span class="article-status">{{ articleStatusLabel(a.status) }}</span>
                <AppIcon v-if="isArticleSelected(a.id)" name="check" :size="13" class="ref-check" />
              </div>
            </template>
          </div>
        </div>
      </el-popover>
      <el-input
        ref="inputRef"
        v-model="store.inputText"
        type="textarea"
        :rows="1"
        :autosize="{ minRows: 1, maxRows: 4 }"
        :placeholder="placeholder"
        resize="none"
        @keydown.enter.exact.prevent="onSend"
        @paste="onPaste"
      />
      <button
        v-if="store.isStreaming || uploading"
        class="send-btn stop"
        :disabled="uploading"
        title="中断生成"
        @click="store.stop"
      ><AppIcon name="stop" :size="15" :stroke-width="2.4" /></button>
      <button
        v-else
        class="send-btn"
        :disabled="!canSend"
        title="发送"
        @click="onSend"
      ><AppIcon name="send" :size="16" :stroke-width="2" /></button>
    </div>
    <div v-if="selectedSkill" class="selected-skill-bar">
      <span class="selected-skill-tag"><AppIcon name="zap" :size="13" :stroke-width="2.2" /> {{ selectedSkill.name }}</span>
      <span class="selected-skill-hint">{{ selectedSkill.description }}</span>
      <el-icon class="selected-skill-remove" @click="selectSkill(null)"><Close /></el-icon>
    </div>
    <div class="input-hint">Enter 发送 · Shift+Enter 换行 · 添加附件 · 选择技能 · Ctrl+V 粘贴截图 · 生成中可点中断</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { listArticles, listSeries } from '@/api'
import type { SkillSummary, Article, Series } from '@/types'
import AppIcon from './AppIcon.vue'

const store = useChatStore()
const inputRef = ref<any>(null)

const selectedSkill = ref<SkillSummary | null>(null)
const skillPopVisible = ref(false)

// ===== # 引用选题（内容计划文章）=====
const articlePopVisible = ref(false)
const articleQuery = ref('')
const refArticles = ref<Array<{ id: string; title: string; status?: string; seriesTitle?: string }>>([])
const projectArticles = ref<Article[]>([])
const projectSeries = ref<Series[]>([])

const ARTICLE_STATUS_LABEL: Record<string, string> = {
  topic: '选题', writing: '写作中', final: '定稿', published: '已发',
}
function articleStatusLabel(s?: string) { return (s && ARTICLE_STATUS_LABEL[s]) || '选题' }

async function loadArticles() {
  const pid = store.currentProjectId
  if (!pid) { projectArticles.value = []; projectSeries.value = []; return }
  try {
    const [arts, sers] = await Promise.all([listArticles(pid), listSeries(pid)])
    projectArticles.value = arts
    projectSeries.value = sers
  } catch { projectArticles.value = []; projectSeries.value = [] }
}
watch(() => store.currentProjectId, () => { refArticles.value = []; loadArticles() }, { immediate: true })
watch(articlePopVisible, (v) => { if (v) loadArticles() })

const filteredArticleGroups = computed(() => {
  const q = articleQuery.value.trim().toLowerCase()
  const match = (t: string) => !q || t.toLowerCase().includes(q)
  const groups: Array<{ seriesId: string | null; seriesTitle: string; items: Article[] }> = []
  for (const s of projectSeries.value) {
    const items = projectArticles.value.filter((a) => a.series_id === s.id && match(a.title))
    if (items.length) groups.push({ seriesId: s.id, seriesTitle: s.title, items })
  }
  const loose = projectArticles.value.filter((a) => !a.series_id && match(a.title))
  if (loose.length) groups.push({ seriesId: null, seriesTitle: '未归系列', items: loose })
  return groups
})
function isArticleSelected(id: string) { return refArticles.value.some((a) => a.id === id) }
function toggleArticle(a: Article) {
  const idx = refArticles.value.findIndex((x) => x.id === a.id)
  if (idx >= 0) refArticles.value.splice(idx, 1)
  else {
    const seriesTitle = a.series_id ? projectSeries.value.find((s) => s.id === a.series_id)?.title : undefined
    refArticles.value.push({ id: a.id, title: a.title, status: a.status, seriesTitle })
  }
}
function removeArticle(id: string) {
  const idx = refArticles.value.findIndex((x) => x.id === id)
  if (idx >= 0) refArticles.value.splice(idx, 1)
}

// 选中技能同步到 store：接待员追问期间保持，技能真正开跑（skill_start）后由 store 清除
function selectSkill(s: SkillSummary | null) {
  selectedSkill.value = s
  store.setPendingSkill(s ? s.id : null)
  skillPopVisible.value = false
  nextTick(() => inputRef.value?.focus?.())
}

interface PendingFile {
  id: string
  file: File
  preview?: string
}
const pendingFiles = ref<PendingFile[]>([])
const uploading = ref(false)

const canSend = computed(
  () => !store.isStreaming && !uploading.value &&
    (store.inputText.trim().length > 0 || pendingFiles.value.length > 0 || !!selectedSkill.value || refArticles.value.length > 0)
)

const placeholder = computed(() => {
  if (store.isStreaming) return 'AI 正在回复，可以先输入下一条，回复结束后发送…'
  if (selectedSkill.value) return `描述要让「${selectedSkill.value.name}」执行的任务…`
  return store.currentConversationId
    ? '说说你想做什么系统/页面，或粘贴截图、添加需求文档等附件'
    : '聊选题、写成稿，或粘贴产品资料/截图等附件'
})

// 主动切换到另一个已有对话时，清掉未发送的附件预览和技能选择，避免串对话。
// 注意：从 undefined → id 是“首条消息创建了对话”，不能清（会把用户刚选的技能冲掉）。
watch(() => store.currentConversationId, (newId, oldId) => {
  if (oldId && oldId !== newId) {
    clearPending()
    selectSkill(null)
    refArticles.value = []
  }
})

// 技能真正开跑后（store.pendingSkillId 被清空）同步清除本地选中态
watch(() => store.pendingSkillId, (id) => {
  if (!id) selectedSkill.value = null
  else if (!selectedSkill.value || selectedSkill.value.id !== id) {
    // 从 store 恢复（如接待员追问后、或刷新后）
    const found = store.skills.find((s) => s.id === id)
    if (found) selectedSkill.value = found
  }
})

function onSend() {
  if (!canSend.value) return
  void doSend()
}

async function doSend() {
  const text = store.inputText.trim()
  const files = pendingFiles.value.map((f) => f.file)
  const arts = refArticles.value.slice()
  if (!text && files.length === 0 && !selectedSkill.value && arts.length === 0) return

  // 有附件（文件或链接）：先处理拿到元信息（只传不写消息），
  // 然后把文字 + 附件元信息合成一条用户消息发送
  let attachmentMetas: any[] = []
  const hasLinks = extractUrls(text).length > 0
  if (files.length > 0 || hasLinks) {
    uploading.value = true
    try {
      for (const file of files) {
        const meta = await store.uploadFileOnly(file)
        if (meta) attachmentMetas.push(meta)
      }
      // 文本里的网页链接：自动抓取正文，沉淀为网页附件（最多 3 个）
      for (const url of extractUrls(text)) {
        const meta = await store.createWebAttachmentOnly(url)
        if (meta) attachmentMetas.push(meta)
      }
      clearPending()
    } finally {
      uploading.value = false
    }
  }

  // 技能模式：不再拼 /skill 直连，而是作为普通消息发送；
  // store 里的 pendingSkillId 会随请求带给后端，接待员负责补全/追问后调 invoke_skill
  const content = text

  store.inputText = ''
  const sentArticles = refArticles.value.slice()
  refArticles.value = []
  await store.send(content, attachmentMetas, sentArticles)
}

function addPending(file: File) {
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.error('文件不能超过 50MB')
    return false
  }
  const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const pf: PendingFile = { id, file }
  if (file.type.startsWith('image/')) {
    pf.preview = URL.createObjectURL(file)
  }
  pendingFiles.value.push(pf)
  return true
}

function removePending(id: string) {
  const idx = pendingFiles.value.findIndex((f) => f.id === id)
  if (idx >= 0) {
    const pf = pendingFiles.value[idx]
    if (pf.preview) URL.revokeObjectURL(pf.preview)
    pendingFiles.value.splice(idx, 1)
  }
}

function clearPending() {
  for (const pf of pendingFiles.value) {
    if (pf.preview) URL.revokeObjectURL(pf.preview)
  }
  pendingFiles.value = []
}

// 📎 按钮选择文件：拦截 el-upload，改为加入待发送预览，不立即上传
function beforePick(file: File) {
  if (store.isStreaming || uploading.value) return false
  addPending(file)
  return false // 阻止 el-upload 自动上传
}

// Ctrl/Cmd+V 粘贴图片：加入待发送预览，不立即上传
function onPaste(e: ClipboardEvent) {
  if (store.isStreaming || uploading.value) return
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file) continue
      const ext = file.type.split('/')[1] || 'png'
      const named = new File([file], `pasted-image-${Date.now()}.${ext}`, { type: file.type })
      e.preventDefault()
      addPending(named)
      return
    }
  }
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// 从文本提取 http(s) 链接（去重保序，最多 3 个），用于贴链接自动抓取
function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s，。；、）)】\]'"<>]+/gi
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(re)) {
    const u = m[0].replace(/[.,!?;:]+$/, '')
    if (seen.has(u)) continue
    seen.add(u)
    out.push(u)
    if (out.length >= 3) break
  }
  return out
}
</script>

<style scoped lang="scss">
.chat-input {
  padding: 12px 28px 16px;
  background: #fff;
  border-top: 1px solid #e4e7ed;

  .pending-files {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }

  .pending-file {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px 6px 6px;
    background: #f5f9ff;
    border: 1px solid #d9ecff;
    border-radius: 8px;
    max-width: 260px;
    position: relative;

    .pending-thumb {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: var(--pf-r-sm);
      flex-shrink: 0;
    }
    .pending-icon {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--pf-text-3);
      background: var(--pf-bg-hover);
      border-radius: var(--pf-r-sm);
      flex-shrink: 0;
    }
    .pending-meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }
    .pending-name {
      font-size: 12.5px;
      color: var(--pf-text-1);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pending-size {
      font-size: 11px;
      color: var(--pf-text-3);
    }
    .pending-remove {
      cursor: pointer;
      color: var(--pf-text-3);
      font-size: 14px;
      flex-shrink: 0;
      &:hover { color: var(--pf-danger); }
    }
  }

  // 引用类 chip（选题复用；原 @需求 入口已移除）
  .ref-chip {
    background: #fffaf2;
    border-color: #f5e0c0;
    .ref-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--pf-r-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      &.fi-amber { background: var(--pf-tint-amber-bg, #fef3e2); color: var(--pf-tint-amber, #d97706); }
      &.fi-sky { background: var(--pf-tint-sky-bg); color: var(--pf-tint-sky); }
      &.fi-art { background: #e6f7ee; color: #047857; }
    }
  }
  .article-chip { background: #f3fbf6; border-color: #bfe6d2; }

  .input-wrapper {
    display: flex;
    gap: 6px;
    align-items: flex-end;
    background: var(--pf-bg-surface);
    border: 1px solid var(--pf-border-strong);
    border-radius: var(--pf-r-xl);
    box-shadow: var(--pf-shadow-sm);
    padding: 8px 8px 8px 10px;
    transition: border-color 0.15s, box-shadow 0.15s;
    &:focus-within {
      border-color: var(--pf-primary-200);
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12), var(--pf-shadow-sm);
    }
    :deep(.el-textarea__inner) {
      border: none;
      box-shadow: none !important;
      padding: 6px 4px;
      font-size: 13.5px;
      background: transparent;
      resize: none;
    }
  }

  .attach-btn, .skill-btn {
    flex-shrink: 0;
    height: 32px !important;
    width: 32px !important;
    border-radius: 8px !important;
    color: var(--pf-text-3);
    &:hover:not(:disabled) {
      color: var(--pf-text-1);
      background: var(--pf-bg-hover) !important;
    }
  }
  .skill-btn.is-active {
    color: var(--pf-violet-text);
    background: var(--pf-violet-bg) !important;
  }
  // 选择选题按钮
  .article-btn.is-active {
    color: #047857 !important;
    background: #e6f7ee !important;
  }

  .send-btn {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    border-radius: 10px;
    border: none;
    background: var(--pf-primary);
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
    transition: all 0.15s;
    &:hover:not(:disabled) { background: var(--pf-primary-hover); }
    &:disabled {
      background: var(--pf-bg-hover);
      color: var(--pf-text-3);
      box-shadow: none;
      cursor: not-allowed;
    }
    &.stop {
      background: var(--pf-danger);
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
      &:hover { background: #dc2626; }
    }
  }

  .selected-skill-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    padding: 6px 12px;
    background: var(--pf-violet-bg);
    border: 1px solid #ddd0fb;
    border-radius: var(--pf-r-lg);
    .selected-skill-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--pf-violet-text);
      white-space: nowrap;
    }
    .selected-skill-hint {
      font-size: 12px;
      color: var(--pf-text-2);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .selected-skill-remove {
      cursor: pointer;
      color: var(--pf-text-3);
      font-size: 14px;
      flex-shrink: 0;
      &:hover { color: var(--pf-danger); }
    }
  }

  .input-hint {
    font-size: 11.5px;
    color: var(--pf-text-3);
    margin-top: 8px;
    text-align: center;
  }
}

.skill-popover {
  max-height: 60vh;
  overflow-y: auto;
  .skill-pop-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--pf-text-1);
    margin-bottom: 8px;
  }
  .skill-empty {
    font-size: 13px;
    color: var(--pf-text-3);
    text-align: center;
    padding: 16px 0;
  }
  .skill-item {
    padding: 8px 10px;
    border-radius: var(--pf-r-md);
    cursor: pointer;
    margin-bottom: 4px;
    &:hover { background: var(--pf-bg-hover); }
    &.is-selected { background: var(--pf-violet-bg); }
    .skill-item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      .skill-item-name {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--pf-text-1);
      }
      .skill-check { color: var(--pf-violet-text); font-weight: 700; display: inline-flex; }
    }
    .skill-item-desc {
      font-size: 12px;
      color: var(--pf-text-3);
      margin-top: 2px;
      line-height: 1.4;
    }
  }
  .skill-clear {
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--pf-border);
    font-size: 12.5px;
    color: var(--pf-danger);
    text-align: center;
    cursor: pointer;
    &:hover { opacity: 0.8; }
  }
}

.ref-popover {
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  .ref-pop-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--pf-text-1);
  }
  .ref-search { margin-bottom: 2px; }
  .ref-empty {
    font-size: 12.5px;
    color: var(--pf-text-3);
    text-align: center;
    padding: 14px 0;
  }
  .ref-list {
    max-height: 300px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ref-item {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 9px;
    border-radius: var(--pf-r-md);
    cursor: pointer;
    &:hover { background: var(--pf-bg-hover); }
    &.is-selected { background: var(--pf-tint-amber-bg, #fef3e2); }
    &.page { padding-left: 30px; }
    .ref-item-ic {
      display: inline-flex;
      color: var(--pf-tint-amber, #d97706);
      flex-shrink: 0;
    }
    &.page .ref-item-ic { color: var(--pf-tint-sky, #2f7de1); }
    .ref-item-name {
      font-size: 13px;
      color: var(--pf-text-1);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ref-tag {
      font-size: 10.5px;
      color: var(--pf-tint-amber, #d97706);
      background: rgba(217, 119, 6, 0.1);
      border-radius: 4px;
      padding: 1px 6px;
      flex-shrink: 0;
      &.sky {
        color: var(--pf-tint-sky, #2f7de1);
        background: rgba(47, 125, 225, 0.1);
      }
    }
    .ref-check { color: var(--pf-tint-amber, #d97706); font-weight: 700; flex-shrink: 0; }
  }

  // 选题选择器
  .article-group-name {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    font-weight: 700;
    color: var(--pf-text-3);
    padding: 8px 9px 3px;
  }
  .article-item {
    &.is-selected { background: #e6f7ee; }
    .article-dot {
      width: 7px; height: 7px; border-radius: 50%;
      flex-shrink: 0;
      background: #9ca3af;
      &.topic { background: #6366f1; }
      &.writing { background: #b45309; }
      &.final { background: #047857; }
      &.published { background: #15803d; }
    }
    .article-status {
      font-size: 10.5px;
      color: #047857;
      background: rgba(4, 120, 87, 0.1);
      border-radius: 4px;
      padding: 1px 6px;
      flex-shrink: 0;
    }
    &.is-selected .ref-check { color: #047857; }
  }
}
</style>
