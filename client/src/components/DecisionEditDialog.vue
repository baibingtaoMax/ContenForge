<template>
  <el-dialog
    :model-value="modelValue"
    :title="form.id ? '编辑设计决策' : '补记设计决策'"
    width="560px"
    append-to-body
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @closed="reset"
  >
    <el-form label-position="top" class="dd-form" @submit.prevent>
      <el-form-item required label="议题（在决定什么）">
        <el-input v-model="form.topic" placeholder="如：台账状态枚举设计" maxlength="80" show-word-limit />
      </el-form-item>
      <el-form-item label="需求点（这条决策针对文档里的哪个设计点/章节）">
        <el-select
          v-model="form.point"
          filterable
          allow-create
          default-first-option
          clearable
          :reserve-keyword="false"
          placeholder="选本文档章节，或输入自拟需求点（≤12字）；留空=整条需求通用"
          style="width: 100%"
        >
          <el-option label="— 整条需求的通用决策 —" value="" />
          <el-option v-for="h in headings" :key="h" :label="h" :value="h" />
        </el-select>
      </el-form-item>
      <el-form-item label="锚定原文（可选，文档里那句话的原话）">
        <el-input v-model="form.anchorText" type="textarea" :rows="2"
          placeholder="从需求文档里逐字摘一句这条决策针对的原话（10-40字），这句在文档里会行内高亮；没有对应句子就留空" />
      </el-form-item>
      <el-form-item required label="结论（拍板的结果）">
        <el-input v-model="form.conclusion" type="textarea" :rows="2"
          placeholder="如：待审核 / 复核中 / 通过 / 驳回；驳回必须填原因" />
      </el-form-item>
      <el-form-item required label="理由（为什么这么定——决策脉络最有价值的部分）">
        <el-input v-model="form.rationale" type="textarea" :rows="3"
          placeholder="如：业务员被驳回后要能修改重新提交，不能直接作废；复核中是双岗审批要求" />
      </el-form-item>
      <el-form-item label="被否决的备选方案">
        <div v-for="(r, i) in form.rejected" :key="i" class="reject-row">
          <el-input v-model="r.option" placeholder="被否的方案" class="rej-opt" />
          <el-input v-model="r.reason" placeholder="为什么被否" class="rej-reason" />
          <el-button link type="danger" @click="form.rejected.splice(i, 1)"><AppIcon name="trash" :size="15" /></el-button>
        </div>
        <el-button link type="primary" size="small" @click="form.rejected.push({ option: '', reason: '' })">
          <AppIcon name="plus" :size="13" :stroke-width="2.6" /> 添加被否方案
        </el-button>
      </el-form-item>
      <el-form-item label="来源">
        <div class="source-row">
          <el-select v-model="form.sourceType" style="width: 120px">
            <el-option label="会议" value="meeting" />
            <el-option label="对话" value="chat" />
            <el-option label="手动" value="manual" />
          </el-select>
          <el-input v-if="form.sourceType === 'meeting'" v-model="form.sourceLabel"
            placeholder="会议名，如：09-09 需求评审会" />
          <span v-else-if="form.sourceType === 'manual'" class="source-hint">手动补录</span>
          <span v-else class="source-hint">对话拍板</span>
        </div>
      </el-form-item>
      <el-form-item label="原文片段（凭证，可选）">
        <el-input v-model="form.sourceExcerpt" type="textarea" :rows="2"
          placeholder="纪要原文或对话原句，截取关键部分即可，不用整篇" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :disabled="!canSave" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { DesignDecision } from '@/types'
import { createDecision, updateDecision } from '@/api'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  modelValue: boolean
  projectId: string
  requirementId: string
  /** 该需求文档里的章节标题（## / ###），供需求点选择 */
  headings?: string[]
  presetPoint?: string
  decision?: DesignDecision | null
}>()
const emit = defineEmits<{
  'update:modelValue': [v: boolean]
  saved: []
}>()

interface FormState {
  id: string
  topic: string
  point: string
  anchorText: string
  conclusion: string
  rationale: string
  rejected: Array<{ option: string; reason: string }>
  sourceType: 'meeting' | 'chat' | 'manual'
  sourceLabel: string
  sourceExcerpt: string
}

const empty = (): FormState => ({
  id: '', topic: '', point: '', anchorText: '', conclusion: '', rationale: '',
  rejected: [], sourceType: 'manual', sourceLabel: '', sourceExcerpt: '',
})
const form = reactive<FormState>(empty())
const saving = ref(false)

const canSave = () => form.topic.trim() && form.conclusion.trim() && form.rationale.trim()

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    if (props.decision) {
      Object.assign(form, {
        id: props.decision.id,
        topic: props.decision.topic,
        point: props.decision.point || '',
        anchorText: props.decision.anchorText || '',
        conclusion: props.decision.conclusion,
        rationale: props.decision.rationale,
        rejected: props.decision.rejected.map((r) => ({ ...r })),
        sourceType: props.decision.sourceType,
        sourceLabel: props.decision.sourceLabel,
        sourceExcerpt: props.decision.sourceExcerpt,
      })
    } else {
      Object.assign(form, empty())
      if (props.presetPoint) form.point = props.presetPoint
    }
  }
)

function reset() {
  Object.assign(form, empty())
}

async function save() {
  if (!canSave()) {
    ElMessage.warning('议题、结论、理由都要填——理由是决策脉络的价值所在')
    return
  }
  saving.value = true
  try {
    const payload = {
      topic: form.topic.trim(),
      point: form.point.trim().slice(0, 30),
      anchorText: form.anchorText.trim().slice(0, 120),
      conclusion: form.conclusion.trim(),
      rationale: form.rationale.trim(),
      rejected: form.rejected.filter((r) => r.option.trim()),
      sourceType: form.sourceType,
      sourceLabel: form.sourceLabel.trim(),
      sourceExcerpt: form.sourceExcerpt.trim(),
      requirementIds: [props.requirementId],
    }
    if (form.id) await updateDecision(form.id, payload)
    else await createDecision(props.projectId, payload)
    ElMessage.success(form.id ? '已更新决策' : '已补记决策')
    emit('saved')
    emit('update:modelValue', false)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped lang="scss">
.reject-row { display: flex; gap: 8px; width: 100%; margin-bottom: 8px; }
.rej-opt { flex: 0 0 38%; }
.rej-reason { flex: 1 1 auto; }
.source-row { display: flex; gap: 10px; align-items: center; width: 100%; }
.source-hint { font-size: 12.5px; color: var(--pf-text-3); }
</style>
