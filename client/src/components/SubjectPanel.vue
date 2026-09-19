<template>
  <div class="subject-wrap">
    <el-tabs v-model="tab" class="subject-tabs">
      <el-tab-pane label="主体档案" name="profile">
<div class="subject-panel">
    <div class="head">
      <div class="title">推广主体档案</div>
      <el-button type="primary" size="small" :loading="saving" @click="onSave">保存档案</el-button>
    </div>
    <div class="hint">所有选题、成稿和渠道版本都基于这份档案长出来。跟内容搭档聊时它也会帮你填，但建议在这里定稿。</div>

    <div class="form">
      <div class="row">
        <label>主体类型</label>
        <el-select v-model="form.subjectType" style="width: 260px">
          <el-option v-for="t in TYPES" :key="t.value" :label="t.label" :value="t.value" />
        </el-select>
      </div>
      <div class="row">
        <label>一句话定位</label>
        <el-input v-model="form.positioning" placeholder="如：PM 用的需求文档一键生成可点原型的工作台" />
      </div>
      <div class="row">
        <label>目标读者</label>
        <el-input v-model="form.audience" type="textarea" :rows="2" placeholder="内容给谁看：人群、身份、场景" />
      </div>
      <div class="row">
        <label>受众痛点</label>
        <el-input v-model="form.pains" type="textarea" :rows="2" placeholder="目标读者最头疼的事，越具体越好" />
      </div>
      <div class="row">
        <label>核心卖点</label>
        <div class="tags">
          <el-tag v-for="(s, i) in (form.sellingPoints || [])" :key="i" closable @close="form.sellingPoints?.splice(i, 1)" type="primary">
            {{ s }}
          </el-tag>
          <el-input
            v-if="tagInputVisible"
            ref="tagInputRef"
            v-model="tagInput"
            size="small"
            style="width: 200px"
            @keyup.enter="addTag"
            @blur="addTag"
          />
          <el-button v-else size="small" @click="tagInputVisible = true">+ 添加卖点</el-button>
        </div>
      </div>
      <div class="row">
        <label>差异点</label>
        <el-input v-model="form.difference" type="textarea" :rows="2" placeholder="凭什么是你：和同类做法/竞品的关键不同" />
      </div>
      <div class="row two-col">
        <div>
          <label>行动指令 CTA</label>
          <el-input v-model="form.cta" placeholder="如：点击免费试用 / 关注公众号" />
        </div>
        <div>
          <label>转化落点</label>
          <el-input v-model="form.ctaTarget" placeholder="链接 / 公众号名 / 微信号" />
        </div>
      </div>
      <div class="row">
        <label>语气风格</label>
        <el-input v-model="form.tone" placeholder="如：专业但不端着，像同行分享，拒绝广告腔" />
      </div>
      <div class="row">
        <label>其他补充</label>
        <el-input v-model="form.notes" type="textarea" :rows="3" placeholder="数据、案例、禁忌词等写稿时要参考的信息" />
      </div>
    </div>
</div>
      </el-tab-pane>
      <el-tab-pane label="写作规范" name="kit" lazy>
        <WritingKitPanel :project-id="props.projectId" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getSubject, saveSubject } from '@/api'
import type { SubjectType, SubjectProfile } from '@/types'
import WritingKitPanel from './WritingKitPanel.vue'

const props = defineProps<{ projectId: string }>()

const tab = ref('profile')

const TYPES: Array<{ value: SubjectType; label: string }> = [
  { value: 'product', label: '软件/实体产品' },
  { value: 'official_account', label: '公众号/账号' },
  { value: 'personal_ip', label: '个人 IP' },
  { value: 'service', label: '服务/课程' },
  { value: 'event', label: '活动' },
  { value: 'community', label: '社群' },
  { value: 'other', label: '其他' },
]

const saving = ref(false)
const form = reactive<{ subjectType: SubjectType } & SubjectProfile>({
  subjectType: 'product',
  positioning: '', audience: '', pains: '', sellingPoints: [],
  difference: '', cta: '', ctaTarget: '', tone: '', notes: '',
})
const tagInputVisible = ref(false)
const tagInput = ref('')
const tagInputRef = ref<{ input: HTMLInputElement } | null>(null)

function addTag() {
  const v = tagInput.value.trim()
  if (v && !(form.sellingPoints || []).includes(v)) form.sellingPoints = [...(form.sellingPoints || []), v]
  tagInput.value = ''
  tagInputVisible.value = false
}

onMounted(async () => {
  try {
    const info = await getSubject(props.projectId)
    form.subjectType = info.subjectType
    Object.assign(form, info.profile)
    if (!Array.isArray(form.sellingPoints)) form.sellingPoints = []
  } catch { /* 新主体空档案 */ }
})

async function onSave() {
  saving.value = true
  try {
    const { subjectType, ...profile } = form
    await saveSubject(props.projectId, {
      subjectType,
      profile: {
        positioning: profile.positioning, audience: profile.audience, pains: profile.pains,
        sellingPoints: profile.sellingPoints, difference: profile.difference, cta: profile.cta,
        ctaTarget: profile.ctaTarget, tone: profile.tone, notes: profile.notes,
      },
    })
    ElMessage.success('档案已保存')
  } catch (e) {
    ElMessage.error('保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.subject-wrap {
  height: 100%;
  :deep(.subject-tabs) { height: 100%; display: flex; flex-direction: column; }
  :deep(.subject-tabs > .el-tabs__header) { margin: 0 26px; }
  :deep(.subject-tabs > .el-tabs__content) { flex: 1; min-height: 0; overflow-y: auto; }
  :deep(.subject-tabs > .el-tabs__content > .el-tab-pane) { height: 100%; }
}
.subject-panel {
  max-width: 760px;
  margin: 0 auto;
  padding: 22px 26px 60px;
}
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;
  .title { font-size: 17px; font-weight: 700; color: var(--pf-text-1); }
}
.hint { font-size: 12.5px; color: var(--pf-text-3); line-height: 1.7; margin-bottom: 18px; }
.form { display: flex; flex-direction: column; gap: 14px; }
.row {
  display: flex; flex-direction: column; gap: 6px;
  label { font-size: 12.5px; font-weight: 600; color: var(--pf-text-2); }
  &.two-col { flex-direction: row; gap: 14px;
    > div { flex: 1; display: flex; flex-direction: column; gap: 6px; }
  }
}
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
</style>
