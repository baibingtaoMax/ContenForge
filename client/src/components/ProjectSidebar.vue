<template>
  <div class="project-sidebar">
    <!-- 全局新对话（游离，不隶属项目） -->
    <el-button class="new-conv-btn" type="primary" @click="onNewConversation">
      <AppIcon name="plus" :size="15" :stroke-width="2.4" /> 新对话
    </el-button>

    <div class="scroll">
      <!-- 未归档对话 -->
      <div v-if="store.unassignedConversations.length > 0" class="section">
        <div class="section-title">未归档</div>
        <div
          v-for="c in store.unassignedConversations"
          :key="c.id"
          class="conv-item unassigned"
          :class="{ active: c.id === store.currentConversationId && !store.currentProjectId, running: store.runningIds.includes(c.id) }"
          @click="store.selectUnassignedConversation(c.id)"
        >
          <AppIcon name="chat" tint="sky" :size="20" class="conv-icon" />
          <span class="conv-title">{{ c.title }}</span>
          <el-icon v-if="store.runningIds.includes(c.id)" class="running-icon"><Loading /></el-icon>
          <span v-else class="conv-actions">
            <AppIcon name="edit" :size="13" class="conv-act" @click.stop="onRenameConversation(c.id, c.title)" />
            <AppIcon name="trash" :size="13" class="conv-del" @click.stop="onDeleteConversation(c.id)" />
          </span>
        </div>
      </div>

      <!-- 项目列表 -->
      <div v-if="store.projects.length > 0" class="section">
        <div class="section-title">项目</div>
        <div v-for="p in store.projects" :key="p.id" class="project-item">
          <div
            class="project-header"
            :class="{ active: p.id === store.currentProjectId }"
            @click="store.toggleProject(p.id)"
          >
            <AppIcon name="chevron-right" :size="12" class="arrow" :class="{ expanded: p.id === store.expandedProjectId }" />
            <AppIcon name="folder" tint="amber" :size="20" />
            <span class="project-name" :title="p.name">{{ p.name }}</span>
            <el-dropdown trigger="click" @command="(cmd: string) => onProjectCommand(cmd, p)">
              <span class="more-btn" @click.stop>
                <el-icon><MoreFilled /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">
                    <AppIcon name="edit" :size="13" /> 重命名
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <AppIcon name="trash" :size="13" /> 删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>

          <!-- 展开后的固定条目 + 对话列表 -->
          <div v-if="p.id === store.expandedProjectId" class="conversation-list">
            <!-- 固定条目：内容计划 / 发布台账 / 主体档案（常驻、不可删改） -->
            <div
              class="conv-item fixed-item"
              :class="{ active: store.mainTab === 'plan' && !store.currentConversationId }"
              @click="store.selectProjectFixed('plan')"
            >
              <AppIcon name="list" tint="indigo" :size="20" class="conv-icon" />
              <span class="conv-title">内容计划</span>
            </div>
            <div
              class="conv-item fixed-item"
              :class="{ active: store.mainTab === 'publishes' && !store.currentConversationId }"
              @click="store.selectProjectFixed('publishes')"
            >
              <AppIcon name="check" tint="emerald" :size="20" class="conv-icon" />
              <span class="conv-title">发布台账</span>
            </div>
            <div
              class="conv-item fixed-item"
              :class="{ active: store.mainTab === 'subject' && !store.currentConversationId }"
              @click="store.selectProjectFixed('subject')"
            >
              <AppIcon name="user" tint="amber" :size="20" class="conv-icon" />
              <span class="conv-title">主体档案</span>
            </div>
            <div
              class="conv-item fixed-item"
              :class="{ active: store.mainTab === 'attachments' && !store.currentConversationId }"
              @click="store.selectProjectFixed('attachments')"
            >
              <AppIcon name="paperclip" tint="sky" :size="20" class="conv-icon" />
              <span class="conv-title">项目附件</span>
            </div>
            <div class="fixed-divider"></div>
            <div
              v-for="c in conversations"
              :key="c.id"
              class="conv-item"
              :class="{ active: c.id === store.currentConversationId, running: store.runningIds.includes(c.id) }"
              @click="store.selectConversation(c.id)"
            >
              <AppIcon name="chat" tint="sky" :size="20" class="conv-icon" />
              <span class="conv-title">{{ c.title }}</span>
              <el-icon v-if="store.runningIds.includes(c.id)" class="running-icon"><Loading /></el-icon>
              <span v-else class="conv-actions">
                <AppIcon name="edit" :size="13" class="conv-act" @click.stop="onRenameConversation(c.id, c.title)" />
                <AppIcon name="trash" :size="13" class="conv-del" @click.stop="onDeleteConversation(c.id)" />
              </span>
            </div>
            <div class="new-conv-in-project" @click="store.newConversationInProject(p.id)">
              <AppIcon name="plus" :size="13" :stroke-width="2.4" /> 在此项目中新对话
            </div>
          </div>
        </div>
      </div>

      <div v-if="store.projects.length === 0 && store.unassignedConversations.length === 0" class="empty">
        还没有对话，点击上方「新对话」开始
      </div>
    </div>

    <!-- 新建项目入口 -->
    <div class="new-project-btn" @click="onNewProject">
      <AppIcon name="plus" :size="14" :stroke-width="2.4" /> 新建项目
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { MoreFilled, Loading } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import AppIcon from './AppIcon.vue'

const store = useChatStore()

const conversations = computed(() => store.projectDetail?.conversations || [])

function onNewConversation() {
  store.newConversation()
}

async function onNewProject() {
  try {
    const { value } = await ElMessageBox.prompt('推广主体名称（产品 / 公众号 / 个人 IP / 服务等）', '新建推广主体', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空'
    })
    await store.newProject(value!)
  } catch { /* cancelled */ }
}

async function onProjectCommand(cmd: string, p: { id: string; name: string }) {
  if (cmd === 'rename') {
    try {
      const { value } = await ElMessageBox.prompt('新名称', '重命名项目', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        inputValue: p.name
      })
      await store.renameProject(p.id, value!)
    } catch { /* cancelled */ }
  } else if (cmd === 'delete') {
    try {
      await ElMessageBox.confirm(`确定删除项目「${p.name}」及其所有对话？`, '删除项目', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消'
      })
      await store.removeProject(p.id)
      ElMessage.success('已删除')
    } catch { /* cancelled */ }
  }
}

async function onDeleteConversation(id: string) {
  try {
    await ElMessageBox.confirm('确定删除这个对话？删除后不可恢复。', '删除对话', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    await store.deleteConversation(id)
    ElMessage.success('已删除')
  } catch { /* cancelled */ }
}

async function onRenameConversation(id: string, oldTitle: string) {
  try {
    const { value } = await ElMessageBox.prompt('新的对话名称', '重命名对话', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputValue: oldTitle,
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空'
    })
    await store.renameConversation(id, value!.trim())
  } catch { /* cancelled */ }
}
</script>

<style scoped lang="scss">
.project-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;

  .new-conv-btn {
    width: 100%;
    margin-bottom: 14px;
    flex-shrink: 0;
    height: 36px;
    border-radius: var(--pf-r-md);
    font-weight: 500;
    :deep(.el-icon) { margin-right: 2px; }
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
    margin: 0 -4px;
    padding: 0 4px;
  }

  .section {
    margin-bottom: 12px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--pf-text-3);
    letter-spacing: 0.6px;
    padding: 6px 8px;
  }

  .project-item { margin-bottom: 2px; }

  .project-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    border-radius: var(--pf-r-md);
    cursor: pointer;
    transition: background 0.15s;
    position: relative;

    &:hover { background: var(--pf-bg-hover); }
    &.active { background: var(--pf-primary-50); }

    .arrow {
      color: var(--pf-text-3);
      transition: transform 0.2s;
      flex-shrink: 0;
      &.expanded { transform: rotate(90deg); }
    }
    .project-name {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--pf-text-1);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .more-btn {
      opacity: 0;
      color: var(--pf-text-3);
      font-size: 14px;
      transition: opacity 0.15s;
      flex-shrink: 0;
      display: inline-flex;
      padding: 2px;
      border-radius: 4px;
      cursor: pointer;
      &:hover { color: var(--pf-text-1); background: var(--pf-bg-hover); }
    }
    &:hover .more-btn { opacity: 1; }
  }

  .conversation-list {
    padding-left: 14px;
    margin: 2px 0;
  }

  .conv-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    margin: 1px 0;
    border-radius: var(--pf-r-md);
    cursor: pointer;
    font-size: 12.5px;
    color: var(--pf-text-2);
    position: relative;
    transition: background 0.15s, color 0.15s;

    &:hover { background: var(--pf-bg-hover); color: var(--pf-text-1); }
    &.active {
      background: var(--pf-primary-50);
      color: var(--pf-primary-active);
      font-weight: 600;
      &::before {
        content: '';
        position: absolute;
        left: -4px;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 16px;
        border-radius: 2px;
        background: var(--pf-primary);
      }
    }
    &.running .conv-title { color: var(--pf-primary); font-weight: 500; }
    .running-icon {
      flex-shrink: 0;
      font-size: 14px;
      color: var(--pf-primary);
      animation: spin 1.2s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    &.unassigned { padding-left: 8px; }
    .conv-icon { flex-shrink: 0; }
    .conv-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .conv-actions {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .conv-act, .conv-del {
      color: var(--pf-text-3);
      transition: color 0.15s;
      padding: 2px;
      border-radius: 4px;
      &:hover { color: var(--pf-primary); background: var(--pf-bg-hover); }
    }
    .conv-del:hover { color: var(--pf-danger); }
    &:hover .conv-actions { opacity: 1; }
  }

  .fixed-item {
    font-weight: 500;
  }
  .fixed-divider {
    height: 1px;
    background: var(--pf-border);
    margin: 8px 10px;
  }

  .new-conv-in-project {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    margin: 2px 0;
    font-size: 12px;
    color: var(--pf-text-3);
    cursor: pointer;
    border-radius: var(--pf-r-md);
    transition: all 0.15s;
    &:hover { color: var(--pf-primary); background: var(--pf-primary-50); }
  }

  .new-project-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    margin-top: 8px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--pf-text-2);
    cursor: pointer;
    border-radius: var(--pf-r-md);
    border: 1px dashed var(--pf-border-strong);
    justify-content: center;
    transition: all 0.15s;
    &:hover {
      color: var(--pf-primary);
      border-color: var(--pf-primary-200);
      background: var(--pf-primary-50);
    }
  }

  .empty {
    text-align: center;
    color: var(--pf-text-3);
    font-size: 12.5px;
    padding: 24px 12px;
    line-height: 1.6;
  }
}
</style>
