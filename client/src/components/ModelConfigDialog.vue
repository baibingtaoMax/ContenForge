<template>
  <el-dialog v-model="visible" title="模型配置" width="540px">
    <el-form label-width="100px">
      <el-form-item label="API 地址">
        <el-input v-model="form.baseUrl" placeholder="https://ark.cn-beijing.volces.com/api/coding/v3" />
      </el-form-item>
      <el-form-item label="API Key">
        <el-input v-model="form.apiKey" type="password" show-password placeholder="不修改请留空" />
      </el-form-item>
      <el-form-item label="对话模型">
        <el-input v-model="form.model" placeholder="doubao-seed-2.0-pro" />
      </el-form-item>
      <el-form-item label="向量模型">
        <el-input v-model="form.embeddingModel" placeholder="doubao-embedding-vision" />
        <div class="field-hint">
          记忆检索（search_memory）用的嵌入模型，需与 API 地址是同一家、走 OpenAI 兼容接口。
          <template v-if="memoryCount > 0">当前记忆库有 {{ memoryCount }} 条向量。</template>
        </div>
      </el-form-item>
    </el-form>
    <el-alert
      v-if="embChanged"
      class="rebuild-alert"
      type="warning"
      :closable="false"
      show-icon
      title="向量模型已变更"
      description="不同向量模型的维度不一致（如 doubao-embedding-vision 是 2048 维，OpenAI 是 1536 维），旧记忆向量会算错相似度。建议清空旧向量记忆重建——原始对话和附件不受影响，检索期间用关键词匹配兜底，新内容会重新沉淀向量。"
    />
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        v-if="embChanged && memoryCount > 0"
        :loading="rebuilding"
        @click="doRebuild"
      >保存并清空旧向量</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getModelConfig, updateModelConfig, rebuildMemory } from '@/api'
import type { ModelConfig } from '@/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const visible = ref(props.modelValue)
const saving = ref(false)
const rebuilding = ref(false)
const memoryCount = ref(0)
const embChanged = ref(false)
const form = ref<ModelConfig>({ baseUrl: '', apiKey: '', model: '', embeddingModel: '' })

watch(() => props.modelValue, async (v) => {
  visible.value = v
  embChanged.value = false
  if (v) {
    const cfg = await getModelConfig()
    form.value = { ...cfg, apiKey: '' }
    memoryCount.value = cfg.memoryChunkCount ?? 0
  }
})
watch(visible, (v) => emit('update:modelValue', v))

async function save() {
  saving.value = true
  try {
    const res = await updateModelConfig(form.value)
    embChanged.value = !!res.embeddingModelChanged
    if (embChanged.value && (res.memoryChunkCount ?? 0) > 0) {
      // 向量模型变了且库里有旧向量：提示但不强制，留在弹窗让用户决定是否清空
      ElMessage.warning('向量模型已变更，建议清空旧向量记忆（见下方说明）')
    } else {
      ElMessage.success('配置已保存')
      visible.value = false
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function doRebuild() {
  try {
    await ElMessageBox.confirm(
      `将清空 ${memoryCount.value} 条向量记忆并切换到新向量模型。原始对话、附件、需求都不受影响，确定继续？`,
      '清空旧向量记忆',
      { type: 'warning', confirmButtonText: '清空并重建', cancelButtonText: '再想想' }
    )
  } catch {
    return
  }
  rebuilding.value = true
  try {
    const res = await rebuildMemory()
    memoryCount.value = 0
    embChanged.value = false
    ElMessage.success(`已清空 ${res.removed} 条旧向量，新对话会用新模型重新沉淀记忆`)
    visible.value = false
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '清空失败')
  } finally {
    rebuilding.value = false
  }
}
</script>

<style scoped lang="scss">
.field-hint {
  font-size: 11.5px;
  color: var(--pf-text-3);
  line-height: 1.6;
  margin-top: 4px;
}
.rebuild-alert {
  margin-top: 4px;
}
</style>
