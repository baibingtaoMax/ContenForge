<template>
  <div class="md-block">
    <div class="mb-toolbar">
      <el-button size="small" :disabled="disabled" @click="pickFile">
        <el-icon style="margin-right:4px"><Upload /></el-icon>导入 .md 文件
      </el-button>
      <span class="mb-count">{{ (modelValue || '').length }} 字</span>
      <input ref="fileRef" type="file" accept=".md,.markdown,.txt,text/markdown" hidden @change="onFile" />
    </div>
    <el-input
      :model-value="modelValue"
      type="textarea"
      :rows="20"
      :disabled="disabled"
      :placeholder="placeholder"
      class="mb-textarea"
      @update:model-value="(v: string) => emit('update:modelValue', v)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'

const props = defineProps<{
  modelValue: string
  disabled?: boolean
  placeholder?: string
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'import', text: string): void
}>()

const fileRef = ref<HTMLInputElement | null>(null)

function pickFile() {
  fileRef.value?.click()
}

async function onFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning('文件过大（>2MB）')
    return
  }
  const text = await file.text()
  emit('update:modelValue', text)
  emit('import', text)
  ElMessage.success(`已导入 ${file.name}`)
  input.value = ''
}

void props
</script>

<style scoped lang="scss">
.md-block { padding: 10px 0 18px; }
.mb-toolbar {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
  .mb-count { font-size: 12px; color: var(--pf-text-3); }
}
.mb-textarea {
  :deep(textarea) {
    font-family: var(--pf-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 12.5px; line-height: 1.7;
  }
}
</style>
