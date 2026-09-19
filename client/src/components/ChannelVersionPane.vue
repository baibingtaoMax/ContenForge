<template>
  <div class="cv-pane">
    <div class="cv-toolbar">
      <el-input v-model="title" size="small" class="cv-title-input" placeholder="该渠道版本标题" />
      <el-button v-if="channel === 'wechat'" size="small" type="primary" @click="copyRich">
        <AppIcon name="copy" :size="13" /> 一键复制富文本
      </el-button>
      <el-button v-else size="small" type="primary" @click="copyPlain">
        <AppIcon name="copy" :size="13" /> 一键复制
      </el-button>
      <el-button size="small" :loading="saving" @click="save">保存</el-button>
      <el-button size="small" @click="openAdapt">
        <AppIcon name="sparkle" :size="13" /> {{ hasVersion ? '重新 AI 生成' : 'AI 生成' }}
      </el-button>
    </div>
    <div v-if="channel === 'wechat'" class="cv-hint">粘贴到公众号后台编辑器会保留标题层级、加粗、引用等排版。</div>
    <div v-else-if="channel === 'xhs'" class="cv-hint">纯文本直接粘贴小红书；标题候选/话题标签/封面文案在下方。</div>
    <div v-else class="cv-hint">Markdown 源码，掘金/知乎编辑器可直接粘贴。</div>

    <!-- 小红书附加物料 -->
    <div v-if="channel === 'xhs' && xhsExtra" class="xhs-extra">
      <div v-if="xhsExtra.titleCandidates?.length" class="xe-block">
        <div class="xe-label">标题候选</div>
        <div class="xe-chips">
          <span v-for="(t, i) in xhsExtra.titleCandidates" :key="i" class="xe-chip" @click="title = t">{{ t }}</span>
        </div>
      </div>
      <div v-if="xhsExtra.tags?.length" class="xe-block">
        <div class="xe-label">话题标签</div>
        <div class="xe-tags">
          <el-tag v-for="(t, i) in xhsExtra.tags" :key="i" size="small" effect="plain">#{{ t }}</el-tag>
          <el-button text size="small" @click="copyTags">复制标签</el-button>
        </div>
      </div>
      <div v-if="xhsExtra.coverText" class="xe-block">
        <div class="xe-label">封面文案</div>
        <div class="xe-cover">{{ xhsExtra.coverText }}</div>
      </div>
    </div>

    <el-input
      v-model="content"
      type="textarea"
      :autosize="{ minRows: 14, maxRows: 30 }"
      class="cv-textarea"
      :placeholder="placeholder"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import AppIcon from './AppIcon.vue'
import { listChannelVersions, saveChannelVersion, adaptArticle } from '@/api'
import { renderMarkdown } from '@/utils/markdown'
import type { ChannelKey } from '@/types'

const props = defineProps<{ articleId: string; channel: ChannelKey; adaptNonce: number }>()
const emit = defineEmits<{ (e: 'adapted'): void }>()

const title = ref('')
const content = ref('')
const extra = ref<Record<string, any>>({})
const saving = ref(false)
const adapting = ref(false)

const hasVersion = computed(() => !!content.value.trim())
const xhsExtra = computed(() => props.channel === 'xhs' ? extra.value : null)
const placeholder = computed(() =>
  props.channel === 'xhs' ? '小红书正文（纯文本，emoji 断行、分点干货）……' : '适配后的版本内容……'
)

async function load() {
  const { versions } = await listChannelVersions(props.articleId)
  const v = versions.find((x) => x.channel === props.channel)
  if (v) {
    title.value = v.title
    content.value = v.content
    try { extra.value = JSON.parse(v.extra_json || '{}') } catch { extra.value = {} }
  } else {
    title.value = ''; content.value = ''; extra.value = {}
  }
}
onMounted(load)
watch(() => props.articleId, load)
watch(() => props.adaptNonce, (n) => { if (n > 0) load() })

async function save() {
  saving.value = true
  try {
    await saveChannelVersion(props.articleId, props.channel, {
      title: title.value, content: content.value, extra: extra.value,
    })
    ElMessage.success('已保存')
  } finally { saving.value = false }
}

async function openAdapt() {
  adapting.value = true
  try {
    ElMessage.info('正在生成渠道版本，主稿越长越慢…')
    const r = await adaptArticle(props.articleId, { channels: [props.channel] })
    if (r.ok) { await load(); ElMessage.success('生成完成，检查后可手动微调'); emit('adapted') }
    else ElMessage.error(r.error || '生成失败，可重试')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '生成失败，可重试')
  } finally { adapting.value = false }
}

async function copyPlain() {
  const text = props.channel === 'xhs'
    ? `${title.value}\n\n${content.value}${xhsExtra.value?.tags?.length ? `\n\n${xhsExtra.value.tags.map((t: string) => `#${t}`).join(' ')}` : ''}`
    : content.value
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制，去平台粘贴吧')
}

async function copyTags() {
  const tags = (xhsExtra.value?.tags || []).map((t: string) => `#${t}`).join(' ')
  await navigator.clipboard.writeText(tags)
  ElMessage.success('标签已复制')
}

async function copyRich() {
  const html = renderMarkdown(content.value)
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([content.value], { type: 'text/plain' }),
      }),
    ])
    ElMessage.success('富文本已复制，粘贴到公众号编辑器即可')
  } catch {
    await navigator.clipboard.writeText(content.value)
    ElMessage.success('浏览器不支持富文本复制，已复制 Markdown 源文')
  }
}
</script>

<style scoped lang="scss">
.cv-pane { display: flex; flex-direction: column; gap: 8px; }
.cv-toolbar { display: flex; gap: 8px; align-items: center; }
.cv-title-input { max-width: 320px; }
.cv-hint { font-size: 12px; color: var(--pf-text-3); }
.xhs-extra {
  display: flex; flex-direction: column; gap: 10px;
  background: var(--pf-primary-50); border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-md); padding: 10px 12px;
}
.xe-label { font-size: 11.5px; font-weight: 600; color: var(--pf-text-2); margin-bottom: 5px; }
.xe-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.xe-chip {
  font-size: 12px; padding: 3px 10px; border-radius: 12px;
  background: #fff; border: 1px solid var(--pf-border-strong);
  cursor: pointer; color: var(--pf-text-1);
  &:hover { border-color: var(--pf-primary); color: var(--pf-primary); }
}
.xe-tags { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.xe-cover {
  font-size: 15px; font-weight: 700; color: var(--pf-text-1);
  background: #fff; border-radius: 8px; padding: 8px 12px; display: inline-block;
}
:deep(.cv-textarea textarea) { font-family: inherit; line-height: 1.75; }
</style>
