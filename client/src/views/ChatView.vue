<template>
  <div class="chat-view">
    <!-- 左侧项目栏 -->
    <aside class="sidebar">
      <div class="brand">
        <BrandLogo variant="full" :size="32" />
        <span class="brand-name">Content<em>Forge</em></span>
      </div>
      <div class="sidebar-scroll">
        <ProjectSidebar />
      </div>
      <!-- 游离对话保留左下角附件小窗；项目内改用固定条目「项目附件」 -->
      <AttachmentPanel
        v-if="!store.currentProjectId && store.currentConversationId"
        :conversation-id="store.currentConversationId"
      />
    </aside>

    <!-- 主区域 -->
    <main class="main">
      <header class="topbar">
        <div class="topbar-title">
            {{ store.currentProject?.name || '未归档对话' }}
          <el-dropdown
            v-if="store.isUnassigned && store.projects.length > 0"
            trigger="click" @command="onArchive"
          >
            <el-button size="small" text type="primary" class="archive-btn">
              <el-icon><FolderAdd /></el-icon> 归档到项目
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="p in store.projects" :key="p.id" :command="p.id">
                  <AppIcon name="folder" tint="amber" :size="16" /> {{ p.name }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="topbar-right">
          <button class="tbtn" @click="goTools">
            <AppIcon name="wrench" :size="15" :stroke-width="2" /> 工具箱
          </button>
          <button class="tbtn" @click="goSkills">
            <AppIcon name="zap" :size="15" :stroke-width="2" /> 技能中心
          </button>
  
          <button class="tbtn" @click="goMcp">
            <AppIcon name="database" :size="15" :stroke-width="2" /> 数据源
          </button>
          <button class="tbtn" @click="showWxmpConfig = true">
            <AppIcon name="chat" :size="15" :stroke-width="2" /> 公众号
          </button>
          <button class="tbtn" @click="showConfig = true">
            <AppIcon name="settings" :size="15" :stroke-width="2" /> 模型配置
          </button>
          <span v-if="modelName" class="model-tag">{{ modelName }}</span>
        </div>
      </header>

      <!-- 当前条目标题栏（对话名 / 需求清单 / 原型） -->
      <div v-if="store.currentProject" class="entry-bar">
        <span class="entry-pill">
          <template v-if="store.mainTab === 'chat'">
            <AppIcon name="chat" tint="sky" :size="16" /> {{ currentConvTitle }}
          </template>
          <template v-else-if="store.mainTab === 'plan'">
            <AppIcon name="list" tint="indigo" :size="16" /> 内容计划
          </template>
          <template v-else-if="store.mainTab === 'publishes'">
            <AppIcon name="check" tint="emerald" :size="16" /> 发布台账
          </template>
          <template v-else-if="store.mainTab === 'subject'">
            <AppIcon name="user" tint="amber" :size="16" /> 主体档案
          </template>
          <template v-else-if="store.mainTab === 'requirements'">
            <AppIcon name="clipboard-check" tint="indigo" :size="16" /> 需求清单
          </template>
          <template v-else-if="store.mainTab === 'pool'">
            <AppIcon name="lightbulb" tint="amber" :size="16" /> 需求池
          </template>
          <template v-else-if="store.mainTab === 'prototype'">
            <AppIcon name="monitor" tint="violet" :size="16" /> 原型
          </template>
          <template v-else-if="store.mainTab === 'attachments'">
            <AppIcon name="paperclip" tint="sky" :size="16" /> 项目附件
          </template>
          <template v-else-if="store.mainTab === 'map'">
            <AppIcon name="map" tint="emerald" :size="16" /> 需求全景
          </template>
        </span>
      </div>

      <!-- 对话 -->
      <template v-if="store.mainTab === 'chat' || !store.currentProject">
        <ChatStream />
        <ChatInput />
      </template>

      <!-- 内容计划（项目树固定条目） -->
      <div v-else-if="store.mainTab === 'plan' && store.currentProject" class="tab-body">
        <ContentPlanPanel :project-id="store.currentProjectId!" />
      </div>

      <!-- 发布台账（项目树固定条目） -->
      <div v-else-if="store.mainTab === 'publishes' && store.currentProject" class="tab-body">
        <PublishPanel :project-id="store.currentProjectId!" />
      </div>

      <!-- 主体档案（项目树固定条目） -->
      <div v-else-if="store.mainTab === 'subject' && store.currentProject" class="tab-body">
        <SubjectPanel :key="store.subjectPanelNonce" :project-id="store.currentProjectId!" />
      </div>

      <!-- 需求清单（PF 留盘，侧栏不接线） -->
      <div v-else-if="store.mainTab === 'requirements' && store.currentProject" class="tab-body">
        <RequirementPanel :key="store.reqPanelNonce" :project-id="store.currentProjectId!" />
      </div>

      <!-- 需求池（项目树固定条目）：未成形的想法列表 -->
      <div v-else-if="store.mainTab === 'pool' && store.currentProject" class="tab-body">
        <PoolPanel :key="store.poolPanelNonce" :project-id="store.currentProjectId!" />
      </div>

      <!-- 原型（项目树固定条目）：生成按钮 + iframe 预览独立原型站点 -->
      <div v-else-if="store.mainTab === 'prototype' && store.currentProject" class="tab-body prototype-tab">
        <PrototypePanel :project-id="store.currentProjectId!" />
      </div>

      <!-- 项目附件（项目树固定条目）：材料列表 + 详情抽屉 -->
      <div v-else-if="store.mainTab === 'attachments' && store.currentProject" class="tab-body">
        <AttachmentCenterPanel :key="store.attachmentPanelNonce" :project-id="store.currentProjectId!" />
      </div>

      <!-- 需求全景（模块-页面关系图） -->
      <div v-else-if="store.mainTab === 'map' && store.currentProject" class="tab-body">
        <MapPanel :key="store.mapPanelNonce" :project-id="store.currentProjectId!" />
      </div>
    </main>

    <ModelConfigDialog v-model="showConfig" />
    <WxmpConfigDialog v-model="showWxmpConfig" />

    <!-- 对话内点沉淀卡片/@ pill：需求文档只读抽屉，不离开对话 -->
    <ReqPreviewDrawer />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { FolderAdd } from '@element-plus/icons-vue'
import { useChatStore } from '@/stores/chat'
import { getModelConfig } from '@/api'
import ProjectSidebar from '@/components/ProjectSidebar.vue'
import ChatStream from '@/components/ChatStream.vue'
import ChatInput from '@/components/ChatInput.vue'
import ModelConfigDialog from '@/components/ModelConfigDialog.vue'
import WxmpConfigDialog from '@/components/WxmpConfigDialog.vue'
import AttachmentPanel from '@/components/AttachmentPanel.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import RequirementPanel from '@/components/RequirementPanel.vue'
import ContentPlanPanel from '@/components/ContentPlanPanel.vue'
import PublishPanel from '@/components/PublishPanel.vue'
import SubjectPanel from '@/components/SubjectPanel.vue'
import PoolPanel from '@/components/PoolPanel.vue'
import PrototypePanel from '@/components/PrototypePanel.vue'
import MapPanel from '@/components/MapPanel.vue'
import AttachmentCenterPanel from '@/components/AttachmentCenterPanel.vue'
import ReqPreviewDrawer from '@/components/ReqPreviewDrawer.vue'
import AppIcon from '@/components/AppIcon.vue'

const store = useChatStore()
const router = useRouter()
const showConfig = ref(false)
const showWxmpConfig = ref(false)
const modelName = ref('')

const currentConvTitle = computed(() =>
  store.projectDetail?.conversations.find((c) => c.id === store.currentConversationId)?.title || '新对话'
)

onMounted(async () => {
  await store.init()
  try {
    modelName.value = (await getModelConfig()).model
  } catch { /* ignore */ }
})

function goSkills() {
  router.push('/skills')
}
function goTools() {
  router.push('/tools')
}
function goMcp() {
  router.push('/mcp')
}

async function onArchive(projectId: string) {
  await store.archiveConversation(projectId)
}
</script>

<style scoped lang="scss">
.chat-view {
  display: flex;
  height: 100vh;
  background: var(--pf-bg-app);
}

.sidebar {
  width: 272px;
  flex-shrink: 0;
  background: var(--pf-bg-subtle);
  border-right: 1px solid var(--pf-border);
  padding: 18px 14px 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 0 4px;
    flex-shrink: 0;
    .brand-name {
      font-size: 15.5px;
      font-weight: 700;
      color: var(--pf-text-1);
      letter-spacing: 0.2px;
      em {
        font-style: normal;
        color: var(--pf-primary);
      }
    }
  }

  .sidebar-scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.topbar {
  height: 54px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--pf-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;

  .topbar-title {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--pf-text-1);
    display: flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
    flex-shrink: 0;
    margin-right: 16px;
  }
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
    flex-shrink: 0;

    .model-tag {
      font-family: 'SF Mono', Menlo, monospace;
      font-size: 11px;
      color: var(--pf-text-2);
      background: var(--pf-bg-hover);
      border: 1px solid var(--pf-border);
      padding: 3px 9px;
      border-radius: var(--pf-r-sm);
      margin-right: 8px;
    }
    .tbtn {
      display: flex;
      align-items: center;
      gap: 5px;
      height: 32px;
      padding: 0 10px;
      border-radius: var(--pf-r-md);
      color: var(--pf-text-2);
      font-size: 12.5px;
      cursor: pointer;
      border: none;
      background: transparent;
      transition: all 0.15s;
      &:hover {
        background: var(--pf-bg-hover);
        color: var(--pf-text-1);
      }
    }
  }
}

.entry-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 42px;
  padding: 0 22px;
  background: var(--pf-bg-surface);
  border-bottom: 1px solid var(--pf-border);

  .entry-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
    padding: 4px 12px 4px 6px;
    border-radius: 14px;
    background: var(--pf-primary-50);
    color: var(--pf-primary-active);
  }
}

.tab-body {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.prototype-tab {
  display: flex;
  flex-direction: column;
}
</style>
