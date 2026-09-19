import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'chat',
    component: () => import('@/views/ChatView.vue'),
  },
  {
    path: '/skills',
    name: 'skills',
    component: () => import('@/views/SkillsView.vue'),
  },
  {
    path: '/mcp',
    name: 'mcp',
    component: () => import('@/views/McpView.vue'),
  },
  {
    path: '/tools',
    name: 'tools',
    component: () => import('@/views/ToolsView.vue'),
  },
  {
    path: '/versions/diff',
    name: 'version-diff',
    component: () => import('@/views/VersionDiffView.vue'),
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
