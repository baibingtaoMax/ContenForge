<template>
  <div class="kit-panel">
    <div class="head">
      <div class="title">写作规范</div>
      <div class="head-actions">
        <el-button size="small" @click="onCreate">+ 新建规范包</el-button>
      </div>
    </div>
    <div class="hint">
      规范是每篇稿子都必须遵守的法律（账号定位、写法、起标题、传播打法、文末署名），跟「项目附件」里按需翻阅的范例不一样。
      挂载后，内容搭档选题/写稿/起名和三渠道适配都会强制按它来。
    </div>

    <!-- 挂载区 -->
    <div class="mount-box">
      <div class="mount-label">当前主体挂载</div>
      <el-select
        :model-value="mountedId"
        placeholder="不使用规范包（通用写法）"
        clearable
        style="width: 320px"
        @change="onMountChange"
      >
        <el-option v-for="k in kits" :key="k.id" :value="k.id" :label="k.name">
          <span>{{ k.name }}</span>
          <span v-if="k.isBuiltin" class="opt-tag">内置</span>
        </el-option>
      </el-select>
      <div v-if="mountedKit" class="mount-desc">{{ mountedKit.description }}</div>
    </div>

    <template v-if="activeKit">
      <div class="editor-card">
        <div class="ec-head">
          <div class="ec-title">
            {{ activeKit.name }}
            <el-tag v-if="activeKit.isBuiltin" size="small" type="info" effect="plain">内置模板·只读</el-tag>
          </div>
          <div class="ec-actions">
            <el-button v-if="activeKit.isBuiltin" size="small" type="primary" @click="onDuplicate">复制为我的规范包再改</el-button>
            <template v-else>
              <el-button size="small" @click="onDuplicate">复制</el-button>
              <el-button size="small" type="danger" plain @click="onDelete">删除</el-button>
            </template>
          </div>
        </div>

        <el-tabs v-model="activeTab" class="kit-tabs">
          <el-tab-pane label="账号定位" name="positioning">
            <MdBlock
              :model-value="form.positioningMd"
              :disabled="readonly"
              placeholder="账号定位、内容线、简介、Slogan、视觉自称统一……"
              @update:model-value="(v: string) => (form.positioningMd = v)"
              @import="(t: string) => (form.positioningMd = t)"
            />
          </el-tab-pane>
          <el-tab-pane label="写作语言" name="writing">
            <MdBlock
              :model-value="form.writingMd"
              :disabled="readonly"
              placeholder="语言配比、画面感/代入感、人称铁律、成稿自检清单……"
              @update:model-value="(v: string) => (form.writingMd = v)"
              @import="(t: string) => (form.writingMd = t)"
            />
          </el-tab-pane>
          <el-tab-pane label="起标题" name="title">
            <MdBlock
              :model-value="form.titleMd"
              :disabled="readonly"
              placeholder="标题尺子、认知爆破点、句式骨架、动词技巧、标题自检……"
              @update:model-value="(v: string) => (form.titleMd = v)"
              @import="(t: string) => (form.titleMd = t)"
            />
          </el-tab-pane>
          <el-tab-pane label="传播框架" name="spread">
            <MdBlock
              :model-value="form.spreadMd"
              :disabled="readonly"
              placeholder="转发/评论/点赞动机拆解、选题主攻维度、发布后数据复盘口径……"
              @update:model-value="(v: string) => (form.spreadMd = v)"
              @import="(t: string) => (form.spreadMd = t)"
            />
          </el-tab-pane>
          <el-tab-pane label="署名与内容线" name="meta">
            <div class="meta-form">
              <label>文末署名模板（公众号/知乎版自动挂文末，原样使用）</label>
              <el-input
                v-model="form.signoff"
                type="textarea"
                :rows="3"
                :disabled="readonly"
                placeholder="——「有点真知」&#10;不追热点，不灌鸡汤。向经典取真知，向实战取真章。"
              />
              <label>内容线（选题可归属到线；key 用英文，如 classic/practice）</label>
              <div class="lines">
                <div v-for="(l, i) in form.contentLines" :key="i" class="line-row">
                  <el-input v-model="l.key" placeholder="key" :disabled="readonly" style="width: 120px" />
                  <el-input v-model="l.label" placeholder="线名，如 真知·经典线" :disabled="readonly" style="width: 180px" />
                  <el-input v-model="l.source" placeholder="取材源" :disabled="readonly" style="width: 200px" />
                  <el-input v-model="l.focus" placeholder="覆盖题材/落点" :disabled="readonly" style="flex: 1" />
                  <el-button v-if="!readonly" size="small" text type="danger" @click="form.contentLines.splice(i, 1)">删</el-button>
                </div>
                <el-button v-if="!readonly" size="small" @click="form.contentLines.push({ key: '', label: '' })">+ 加一条内容线</el-button>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>

        <div v-if="!readonly" class="ec-foot">
          <el-button type="primary" :loading="saving" @click="onSave">保存规范包</el-button>
          <span class="save-tip">保存即对本主体新生成的稿子/渠道版生效</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listWritingKits, createWritingKit, updateWritingKit, deleteWritingKit,
  duplicateWritingKit, mountWritingKit, getSubject,
} from '@/api'
import type { WritingKit, ContentLine } from '@/types'
import MdBlock from './WritingKitMdBlock.vue'

const props = defineProps<{ projectId: string }>()

const kits = ref<WritingKit[]>([])
const mountedId = ref<string | null>(null)
const activeId = ref<string>('')
const saving = ref(false)
const activeTab = ref('positioning')

const form = reactive({
  name: '',
  description: '',
  signoff: '',
  positioningMd: '',
  writingMd: '',
  titleMd: '',
  spreadMd: '',
  contentLines: [] as ContentLine[],
})

const activeKit = computed(() => kits.value.find((k) => k.id === activeId.value))
const mountedKit = computed(() => kits.value.find((k) => k.id === mountedId.value))
const readonly = computed(() => !!activeKit.value?.isBuiltin)

function loadForm(k: WritingKit) {
  form.name = k.name
  form.description = k.description
  form.signoff = k.signoff
  form.positioningMd = k.positioningMd
  form.writingMd = k.writingMd
  form.titleMd = k.titleMd
  form.spreadMd = k.spreadMd
  form.contentLines = k.contentLines.map((l) => ({ ...l }))
}

async function reload(selectId?: string, mounted?: string | null) {
  kits.value = await listWritingKits()
  if (mounted !== undefined) mountedId.value = mounted
  if (selectId) activeId.value = selectId
  else if (!activeId.value && kits.value.length) activeId.value = mountedId.value || kits.value[0].id
  const k = kits.value.find((x) => x.id === activeId.value)
  if (k) loadForm(k)
}

onMounted(async () => {
  kits.value = await listWritingKits()
  // 自己读当前挂载状态（Tab 是 lazy 渲染，父组件拿不到本组件 ref）
  try {
    const info = await getSubject(props.projectId)
    mountedId.value = info.kitId || null
  } catch { /* ignore */ }
  activeId.value = mountedId.value || kits.value[0]?.id || ''
  const k = kits.value.find((x) => x.id === activeId.value)
  if (k) loadForm(k)
})

async function onMountChange(v: string | undefined) {
  const kitId = v || null
  await mountWritingKit(props.projectId, kitId)
  mountedId.value = kitId
  ElMessage.success(kitId ? '已挂载规范包' : '已取消挂载')
  if (kitId && !activeId.value) {
    activeId.value = kitId
    loadForm(kits.value.find((k) => k.id === kitId)!)
  }
}

async function onCreate() {
  try {
    const { value } = await ElMessageBox.prompt('新规范包名称', '新建规范包', {
      confirmButtonText: '创建', cancelButtonText: '取消', inputPlaceholder: '如：XX 号写作法',
    })
    const k = await createWritingKit({
      name: value.trim(),
      description: '',
      signoff: '',
      positioningMd: '', writingMd: '', titleMd: '', spreadMd: '',
      contentLines: [],
    })
    await reload(k.id)
    ElMessage.success('已创建，在各 Tab 里粘贴或导入规范')
  } catch { /* 取消 */ }
}

async function onDuplicate() {
  if (!activeKit.value) return
  const k = await duplicateWritingKit(activeKit.value.id, `${activeKit.value.name} 副本`)
  await reload(k.id)
  ElMessage.success('已复制为可编辑副本')
}

async function onDelete() {
  if (!activeKit.value) return
  try {
    await ElMessageBox.confirm(`删除规范包「${activeKit.value.name}」？挂载它的主体会自动取消挂载。`, '确认删除', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
    await deleteWritingKit(activeKit.value.id)
    if (mountedId.value === activeKit.value.id) mountedId.value = null
    activeId.value = ''
    await reload()
  } catch { /* 取消 */ }
}

async function onSave() {
  if (!activeKit.value) return
  if (!form.name.trim()) return ElMessage.warning('名称必填')
  saving.value = true
  try {
    await updateWritingKit(activeKit.value.id, {
      name: form.name.trim(),
      description: form.description,
      signoff: form.signoff,
      positioningMd: form.positioningMd,
      writingMd: form.writingMd,
      titleMd: form.titleMd,
      spreadMd: form.spreadMd,
      contentLines: form.contentLines.filter((l) => l.key.trim()),
    })
    await reload(activeKit.value.id)
    ElMessage.success('规范包已保存')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.kit-panel {
  max-width: 860px;
  margin: 0 auto;
  padding: 22px 26px 60px;
  height: 100%;
  overflow-y: auto;
}
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
  .title { font-size: 17px; font-weight: 700; color: var(--pf-text-1); }
}
.hint { font-size: 12.5px; color: var(--pf-text-3); line-height: 1.7; margin-bottom: 16px; }
.mount-box {
  border: 1px solid var(--pf-border); border-radius: 10px; padding: 14px 16px; margin-bottom: 18px;
  background: var(--pf-bg-subtle, #fafaff);
  .mount-label { font-size: 12.5px; font-weight: 600; color: var(--pf-text-2); margin-bottom: 8px; }
  .mount-desc { font-size: 12px; color: var(--pf-text-3); margin-top: 8px; line-height: 1.6; }
  .opt-tag { float: right; font-size: 11px; color: var(--pf-text-3); }
}
.editor-card {
  border: 1px solid var(--pf-border); border-radius: 12px; overflow: hidden; background: #fff;
}
.ec-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--pf-border);
  .ec-title { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
}
.kit-tabs { padding: 6px 18px 0; }
.ec-foot {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px 16px; border-top: 1px solid var(--pf-border);
  .save-tip { font-size: 12px; color: var(--pf-text-3); }
}
.meta-form {
  display: flex; flex-direction: column; gap: 8px; padding: 8px 0 16px;
  label { font-size: 12.5px; font-weight: 600; color: var(--pf-text-2); margin-top: 6px; }
}
.lines { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.line-row { display: flex; gap: 8px; align-items: center; }
</style>
