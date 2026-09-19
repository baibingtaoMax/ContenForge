<template>
  <div class="img-tool">
    <!-- ========== 空态：拖放区 ========== -->
    <div
      v-if="!loaded"
      class="dropzone"
      :class="{ dragging }"
      @click="pickFile"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <input ref="fileInput" type="file" accept="image/*,.heic,.heif" hidden @change="onFileChange" />
      <span class="dz-icon"><AppIcon name="upload-cloud" tint="indigo" :size="52" /></span>
      <div class="dz-title">点击选择图片，或直接拖到这里</div>
      <div class="dz-sub">支持 JPG · PNG · WebP · BMP · GIF · HEIC（苹果照片），单张处理</div>
      <div class="dz-note">全程本地转换，图片不会上传到任何服务器</div>
      <div v-if="loadError" class="dz-error">{{ loadError }}</div>
    </div>

    <!-- ========== 工作态 ========== -->
    <template v-else>
      <!-- 工具条 -->
      <div class="tool-bar">
        <div class="format-group">
          <button
            v-for="f in FORMATS"
            :key="f.id"
            class="fmt-btn"
            :class="{ active: format === f.id }"
            @click="format = f.id"
          >
            {{ f.label }}
          </button>
        </div>

        <div class="quality" v-if="qualityVisible">
          <span class="q-label">质量</span>
          <el-slider v-model="qualityPct" :min="30" :max="100" :step="5" class="q-slider" />
          <span class="q-val">{{ qualityPct }}%</span>
        </div>

        <div class="bar-right">
          <el-button size="small" @click="reset">
            <AppIcon name="refresh" :size="13" /> 换一张
          </el-button>
          <el-button size="small" type="primary" :loading="converting" @click="download">
            <AppIcon name="download" :size="13" /> 下载 {{ format.toUpperCase() }}
          </el-button>
        </div>
      </div>

      <div class="compare-grid">
        <!-- 原图 -->
        <div class="img-card">
          <div class="card-head">
            <span class="head-title">原图 · {{ loaded.decodedFromHeic ? 'HEIC' : srcExt }}</span>
            <span v-if="loaded.decodedFromHeic" class="heic-badge">苹果 HEIC 已解码</span>
          </div>
          <div class="preview-box">
            <img :src="originalUrl" alt="原图" />
          </div>
          <div class="meta">
            <span>{{ loaded.width }} × {{ loaded.height }}</span>
            <span>{{ formatBytes(srcSize) }}</span>
          </div>
        </div>

        <!-- 结果 -->
        <div class="img-card">
          <div class="card-head">
            <span class="head-title">转换结果 · {{ formatLabel }}</span>
            <span v-if="result" class="size-delta" :class="deltaClass">
              {{ deltaText }}
            </span>
          </div>
          <div class="preview-box result">
            <div v-if="converting" class="converting">
              <el-icon class="spin"><Loading /></el-icon>
              <span>正在转换…</span>
            </div>
            <template v-else-if="result">
              <img v-if="previewOk" :src="result.url" alt="转换结果" @error="previewOk = false" />
              <div v-else class="ico-note">
                <AppIcon name="check" :size="16" />
                ICO 文件已生成（浏览器不便预览，点右上角下载即可使用）
              </div>
            </template>
          </div>
          <div class="meta">
            <span v-if="result">{{ result.width }} × {{ result.height }}</span>
            <span v-if="result">{{ formatBytes(resultSize) }}</span>
          </div>
        </div>
      </div>

      <p v-if="format === 'ico'" class="tip-line">
        ICO 用于网站 favicon：自动把图片缩成 16/32/48… 多尺寸打进一个文件；只缩小不放大。
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import AppIcon from '@/components/AppIcon.vue'
import {
  loadImageFile,
  convertImage,
  replaceExt,
  formatBytes,
  supportsQuality,
  extOf,
  type OutFormat,
  type LoadedImage,
  type ConvertResult,
} from '@/utils/imageConvert'

const FORMATS: { id: OutFormat; label: string }[] = [
  { id: 'png', label: 'PNG' },
  { id: 'jpeg', label: 'JPG' },
  { id: 'webp', label: 'WebP' },
  { id: 'bmp', label: 'BMP' },
  { id: 'ico', label: 'ICO' },
]

const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)
const loadError = ref('')

const srcFile = ref<File | null>(null)
const originalUrl = ref('')
const srcSize = ref(0)
const srcExt = ref('')
const loaded = ref<LoadedImage | null>(null)

const format = ref<OutFormat>('png')
const qualityPct = ref(90)
const converting = ref(false)
const result = ref<ConvertResult | null>(null)
const resultSize = ref(0)
const previewOk = ref(true)
let runToken = 0

const formatLabel = computed(() => FORMATS.find((f) => f.id === format.value)?.label ?? '')
const qualityVisible = computed(() => supportsQuality(format.value))
const quality = computed(() => qualityPct.value / 100)

const deltaText = computed(() => {
  if (!resultSize.value || !srcSize.value) return ''
  const pct = Math.round((resultSize.value / srcSize.value - 1) * 100)
  if (pct === 0) return '大小相同'
  return pct > 0 ? `大了 ${pct}%` : `小了 ${-pct}%`
})
const deltaClass = computed(() => {
  if (!resultSize.value || !srcSize.value) return ''
  return resultSize.value <= srcSize.value ? 'smaller' : 'bigger'
})

function pickFile() {
  fileInput.value?.click()
}

function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) handleFile(f)
}

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) handleFile(f)
  ;(e.target as HTMLInputElement).value = ''
}

async function handleFile(file: File) {
  loadError.value = ''
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
  srcFile.value = file
  srcSize.value = file.size
  srcExt.value = (file.name.split('.').pop() || '').toUpperCase()
  originalUrl.value = URL.createObjectURL(file)
  loaded.value = null
  result.value = null
  try {
    loaded.value = await loadImageFile(file)
    runConvert()
  } catch (e) {
    originalUrl.value && URL.revokeObjectURL(originalUrl.value)
    originalUrl.value = ''
    srcFile.value = null
    loadError.value = /heic|hei(f|c)/i.test(file.name)
      ? 'HEIC 解码失败，文件可能已损坏或不是标准苹果照片'
      : '图片读取失败，请确认是常见图片格式'
  }
}

async function runConvert() {
  if (!loaded.value) return
  const token = ++runToken
  converting.value = true
  previewOk.value = true
  try {
    const r = await convertImage(loaded.value, format.value, quality.value)
    if (token !== runToken) {
      URL.revokeObjectURL(r.url)
      return
    }
    if (result.value) URL.revokeObjectURL(result.value.url)
    result.value = r
    resultSize.value = r.blob.size
  } catch (e) {
    if (token === runToken) ElMessage.error('转换失败，换个格式或图片试试')
  } finally {
    if (token === runToken) converting.value = false
  }
}

watch([format, qualityPct], () => {
  if (loaded.value) runConvert()
})

function download() {
  if (!result.value || !srcFile.value) return
  const a = document.createElement('a')
  a.href = result.value.url
  a.download = replaceExt(srcFile.value.name, extOf(format.value))
  a.click()
}

function reset() {
  runToken++
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
  if (result.value) URL.revokeObjectURL(result.value.url)
  originalUrl.value = ''
  loaded.value = null
  result.value = null
  srcFile.value = null
  format.value = 'png'
  qualityPct.value = 90
  loadError.value = ''
}

onBeforeUnmount(() => {
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
  if (result.value) URL.revokeObjectURL(result.value.url)
})
</script>

<style scoped lang="scss">
.img-tool {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 拖放区 */
.dropzone {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 2px dashed var(--pf-border-strong, #d6d9e2);
  border-radius: var(--pf-r-xl, 14px);
  background: var(--pf-bg-surface);
  cursor: pointer;
  transition: all .18s;
  text-align: center;
  padding: 24px;
  &:hover, &.dragging {
    border-color: var(--pf-primary, #6366f1);
    background: rgba(99,102,241,.04);
  }
  .dz-title { font-size: 15px; font-weight: 700; color: var(--pf-text-1); margin-top: 10px; }
  .dz-sub { font-size: 13px; color: var(--pf-text-2); }
  .dz-note { font-size: 12px; color: var(--pf-text-3); }
  .dz-error {
    margin-top: 8px;
    font-size: 13px;
    color: #b42318;
    background: #fef3f2;
    border: 1px solid #fecdca;
    border-radius: 8px;
    padding: 8px 14px;
  }
}

/* 工具条 */
.tool-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  .bar-right { margin-left: auto; display: flex; gap: 8px; }
}
.format-group {
  display: inline-flex;
  background: var(--pf-bg-subtle, #f3f4fa);
  border-radius: 9px;
  padding: 3px;
  gap: 2px;
}
.fmt-btn {
  border: 0;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-text-2);
  padding: 6px 16px;
  border-radius: 7px;
  cursor: pointer;
  transition: all .15s;
  &:hover { color: var(--pf-text-1); }
  &.active {
    background: var(--pf-bg-surface, #fff);
    color: var(--pf-primary, #6366f1);
    box-shadow: 0 1px 4px rgba(17,24,39,.1);
  }
}
.quality {
  display: flex;
  align-items: center;
  gap: 8px;
  .q-label { font-size: 12.5px; color: var(--pf-text-2); font-weight: 600; }
  .q-slider { width: 130px; margin: 0; }
  .q-val { font-size: 12.5px; color: var(--pf-text-1); font-weight: 700; width: 38px; font-variant-numeric: tabular-nums; }
}

/* 对比 */
.compare-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.img-card {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  overflow: hidden;
}
.card-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--pf-border);
  .head-title { font-size: 13px; font-weight: 700; color: var(--pf-text-1); }
  .heic-badge {
    font-size: 11px;
    font-weight: 600;
    color: #b45309;
    background: #fef3c7;
    border-radius: 6px;
    padding: 2px 8px;
  }
  .size-delta {
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    &.smaller { color: #059669; }
    &.bigger { color: #d97706; }
  }
}
.preview-box {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background:
    linear-gradient(45deg, #f0f1f5 25%, transparent 25%),
    linear-gradient(-45deg, #f0f1f5 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #f0f1f5 75%),
    linear-gradient(-45deg, transparent 75%, #f0f1f5 75%);
  background-size: 18px 18px;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
  background-color: #fafbfc;
  overflow: hidden;
  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
    box-shadow: 0 2px 12px rgba(17,24,39,.12);
  }
  &.result { position: relative; }
}
.converting {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(255,255,255,.75);
  color: var(--pf-text-2);
  font-size: 13px;
  .spin { animation: pf-spin 1s linear infinite; font-size: 22px; color: var(--pf-primary, #6366f1); }
}
@keyframes pf-spin { to { transform: rotate(360deg); } }
.ico-note {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #059669;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 10px;
  padding: 14px 18px;
  text-align: center;
  line-height: 1.6;
}
.meta {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  padding: 9px 14px;
  border-top: 1px solid var(--pf-border);
  font-size: 12.5px;
  color: var(--pf-text-3);
  font-variant-numeric: tabular-nums;
}
.tip-line {
  flex-shrink: 0;
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--pf-text-3);
}
</style>
