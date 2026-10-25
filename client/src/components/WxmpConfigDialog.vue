<template>
  <el-dialog v-model="visible" title="公众号设置" width="560px">
    <el-form label-width="104px">
      <el-form-item label="AppID">
        <el-input v-model="form.appId" placeholder="wx 开头的公众号 AppID" />
      </el-form-item>
      <el-form-item label="AppSecret">
        <el-input v-model="form.appSecret" type="password" show-password placeholder="不修改请留空" />
        <div class="field-hint">在公众号后台「设置与开发 → 基本配置」获取，仅保存在本机凭据文件，不会上传他处。</div>
      </el-form-item>
    </el-form>

    <!-- 连接 / 白名单状态 -->
    <div class="conn-box">
      <div class="conn-head">
        <span class="conn-title">连接与 IP 白名单</span>
        <el-button text size="small" :loading="testing" @click="runTest">
          <AppIcon name="sparkle" :size="13" /> 重新检测
        </el-button>
      </div>

      <el-alert v-if="testRes?.ok" type="success" :closable="false" show-icon
        :title="testRes.message || '连接正常，出口 IP 已在白名单'" />

      <template v-else-if="testRes && testRes.stage === 'whitelist'">
        <el-alert type="error" :closable="false" show-icon
          title="出口 IP 不在公众号白名单（错误码 40164）">
          <template #default>
            <div class="ip-line">当前出口 IP：<span class="ip-val">{{ testRes.currentIp }}</span>
              <el-button text size="small" @click="copyIp">复制</el-button>
            </div>
            <div class="guide">{{ testRes.guide }}</div>
          </template>
        </el-alert>
      </template>

      <el-alert v-else-if="testRes && testRes.stage === 'credentials'" type="error" :closable="false" show-icon
        :title="testRes.error || 'AppID 或 AppSecret 不正确'" />

      <el-alert v-else-if="testRes && testRes.stage === 'config'" type="warning" :closable="false" show-icon
        :title="testRes.error || '尚未配置 AppID / AppSecret'" />

      <el-alert v-else-if="testRes" type="info" :closable="false" show-icon :title="testRes.error || '检测失败'" />

      <div v-else class="conn-idle">点「重新检测」可验证凭据与白名单是否生效。</div>
    </div>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import AppIcon from './AppIcon.vue'
import { getWxmpConfig, updateWxmpConfig, testWxmpConfig } from '@/api'
import type { WxmpTestResult } from '@/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const visible = ref(props.modelValue)
const saving = ref(false)
const testing = ref(false)
const form = ref({ appId: '', appSecret: '' })
const testRes = ref<WxmpTestResult | null>(null)

watch(() => props.modelValue, async (v) => {
  visible.value = v
  if (v) {
    form.value = { appId: '', appSecret: '' }
    testRes.value = null
    try {
      const cfg = await getWxmpConfig()
      form.value.appId = cfg.appId || ''
    } catch { /* ignore */ }
    runTest()
  }
})
watch(visible, (v) => emit('update:modelValue', v))

async function runTest() {
  testing.value = true
  try {
    testRes.value = await testWxmpConfig()
  } catch (e: any) {
    testRes.value = { ok: false, stage: 'unknown', error: e?.response?.data?.error || e.message || '检测失败' }
  } finally {
    testing.value = false
  }
}

async function copyIp() {
  if (testRes.value?.currentIp) {
    await navigator.clipboard.writeText(testRes.value.currentIp)
    ElMessage.success('IP 已复制')
  }
}

async function save() {
  const payload: { appId?: string; appSecret?: string } = {}
  if (form.value.appId.trim()) payload.appId = form.value.appId.trim()
  if (form.value.appSecret.trim()) payload.appSecret = form.value.appSecret.trim()
  if (!payload.appId && !payload.appSecret) {
    ElMessage.warning('没有需要保存的改动')
    return
  }
  saving.value = true
  try {
    await updateWxmpConfig(payload)
    ElMessage.success('配置已保存')
    form.value.appSecret = ''
    await runTest()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e.message || '保存失败')
  } finally {
    saving.value = false
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
.conn-box {
  margin-top: 6px;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-md);
  padding: 12px 14px;
  background: var(--pf-bg-subtle);
}
.conn-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.conn-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--pf-text-1);
}
.conn-idle {
  font-size: 12.5px;
  color: var(--pf-text-3);
}
.ip-line {
  font-size: 13px;
  margin-bottom: 6px;
}
.ip-val {
  font-family: 'SF Mono', Menlo, monospace;
  font-weight: 700;
  color: var(--pf-danger, #dc2626);
  font-size: 14px;
}
.guide {
  font-size: 12px;
  line-height: 1.7;
  color: var(--pf-text-2);
}
</style>
