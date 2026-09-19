import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  // mermaid 及其依赖（langly 等）是 CommonJS，强制预构建转 ESM，避免页面 import 报错
  optimizeDeps: {
    include: ['mermaid'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5175,
    open: true,
    proxy: {
      '/proto': {
        target: 'http://localhost:3200',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3200',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // SSE 流式响应：关闭 Nagle，禁止缓冲
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
          proxy.on('start', (req, res) => {
            ;(req as any).socket?.setNoDelay?.(true)
            ;(res as any).socket?.setNoDelay?.(true)
          })
        }
      }
    }
  }
})
