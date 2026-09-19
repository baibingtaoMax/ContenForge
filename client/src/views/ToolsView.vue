<template>
  <div class="tools-view">
    <!-- ========== 工具陈列网格 ========== -->
    <template v-if="!activeTool">
      <header class="page-header">
        <div class="header-left">
          <el-button text :icon="ArrowLeft" @click="goChat">返回对话</el-button>
          <div class="header-title">
            <AppIcon name="wrench" tint="sky" :size="40" />
            <div>
              <h1>工具箱</h1>
              <p>产品经理常用小工具 · 纯本地运行，数据不出浏览器</p>
            </div>
          </div>
        </div>
      </header>

      <div class="card-grid">
        <div
          v-for="t in TOOLS"
          :key="t.id"
          class="tool-card"
          @click="openTool(t.id)"
        >
          <div class="card-top">
            <span class="card-name">
              <AppIcon :name="t.icon" :tint="t.tint" :size="30" class="card-icon" />
              {{ t.name }}
            </span>
            <AppIcon name="chevron-right" :size="16" class="card-arrow" />
          </div>
          <p class="card-desc">{{ t.desc }}</p>
          <div class="card-kws">
            <span v-for="k in t.keywords.slice(0, 3)" :key="k" class="kw">{{ k }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ========== 工具工作区 ========== -->
    <template v-else>
      <header class="page-header">
        <div class="header-left">
          <el-button text :icon="ArrowLeft" @click="activeTool = null">返回工具箱</el-button>
          <div class="header-title">
            <AppIcon :name="activeTool.icon" :tint="activeTool.tint" :size="36" />
            <div>
              <h1>{{ activeTool.name }}</h1>
              <p>{{ activeTool.desc }}</p>
            </div>
          </div>
        </div>
      </header>

      <div class="tool-workspace">
        <AxureChartTool v-if="activeTool.id === 'axure-chart'" />
        <TextDiffTool v-else-if="activeTool.id === 'text-diff'" />
        <JsonTool v-else-if="activeTool.id === 'json-tool'" />
        <JsonListViewTool v-else-if="activeTool.id === 'json-list'" />
        <JsonMappingTool v-else-if="activeTool.id === 'json-mapping'" />
        <ImageConvertTool v-else-if="activeTool.id === 'image-convert'" />
        <DupCheckTool v-else-if="activeTool.id === 'dup-check'" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import AppIcon from '@/components/AppIcon.vue'
import AxureChartTool from '@/components/tools/AxureChartTool.vue'
import TextDiffTool from '@/components/tools/TextDiffTool.vue'
import JsonTool from '@/components/tools/JsonTool.vue'
import JsonListViewTool from '@/components/tools/JsonListViewTool.vue'
import JsonMappingTool from '@/components/tools/JsonMappingTool.vue'
import ImageConvertTool from '@/components/tools/ImageConvertTool.vue'
import DupCheckTool from '@/components/tools/DupCheckTool.vue'
import { TOOLS, getTool, type ToolDef } from '@/config/tools'

const router = useRouter()
const activeTool = ref<ToolDef | null>(null)

function goChat() {
  router.push('/')
}
function openTool(id: string) {
  activeTool.value = getTool(id) ?? null
}
</script>

<style scoped lang="scss">
.tools-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--pf-bg-page, #f6f7fb);
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
}

.card-grid {
  flex: 1;
  overflow-y: auto;
  padding: 22px 28px 28px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  align-content: start;
}

.tool-card {
  position: relative;
  background: var(--pf-bg-surface);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-lg);
  padding: 18px;
  cursor: pointer;
  transition: all 0.18s;
  display: flex;
  flex-direction: column;
  min-height: 148px;

  &:hover {
    border-color: var(--pf-primary-200, #c7d2fe);
    box-shadow: var(--pf-shadow-sm, 0 6px 18px rgba(17,24,39,.07));
    transform: translateY(-2px);
    .card-arrow { transform: translateX(2px); color: var(--pf-primary, #6366f1); }
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    .card-name { font-size: 15.5px; font-weight: 700; color: var(--pf-text-1); display: flex; align-items: center; gap: 10px; }
  }
  .card-arrow { color: var(--pf-text-3); transition: all .18s; flex-shrink: 0; }
  .card-desc {
    font-size: 13px;
    color: var(--pf-text-2);
    line-height: 1.6;
    margin: 12px 0 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    flex: 1;
  }
  .card-kws {
    margin-top: 14px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    .kw {
      font-size: 11px;
      color: var(--pf-text-3);
      background: var(--pf-bg-subtle, #f3f4fa);
      border-radius: 6px;
      padding: 2px 8px;
    }
  }
}

.tool-workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px 28px 22px;
  gap: 12px;
}
</style>
