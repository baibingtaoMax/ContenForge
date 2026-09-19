<script setup lang="ts">
// ProtoForge 品牌标：海狸（Forge = 锻造/建造本义）
// variant="full" 叼树枝全身版（≥34px：顶栏/欢迎页/空状态）
// variant="head" 头部版（favicon/小头像，16px 也清晰）
// bare=true 只渲染白色 glyph（背景由父容器渐变底提供，如消息头像）
withDefaults(defineProps<{
  variant?: 'full' | 'head'
  size?: number
  bare?: boolean
}>(), {
  variant: 'full',
  size: 34,
  bare: false,
})
</script>

<template>
  <span
    class="brand-logo"
    :class="{ 'brand-logo--bare': bare }"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size * 0.28)}px` }"
  >
    <!-- 叼树枝全身版 -->
    <svg v-if="variant === 'full'" viewBox="0 0 24.6 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 扁尾 -->
      <ellipse cx="6.6" cy="19.7" rx="5.6" ry="1.65" fill="#fff" fill-opacity=".92"/>
      <path d="M2.9 19.2c1-.45 2.3-.7 3.6-.62M2.5 20.2c1.1-.5 2.5-.78 3.9-.7" stroke="#5B54E8" stroke-width=".5" stroke-linecap="round" stroke-opacity=".38"/>
      <!-- 身体 -->
      <path d="M11.2 19.6c-.5-3.6 1.6-6.6 4.9-6.6 2.9 0 5 2.4 5 5.8 0 .5-.4.9-.9.9z" fill="#fff"/>
      <ellipse cx="18.4" cy="19.5" rx="1.8" ry="1" fill="#fff" fill-opacity=".8"/>
      <!-- 头（侧脸朝右） -->
      <path d="M14.9 9.6c.15-1.4 2.2-1.5 2.5-.15l.05.55c1.5.35 2.65 1.7 2.65 3.3 0 1.95-1.7 3.5-3.9 3.5-2.15 0-3.85-1.55-3.85-3.5 0-1.55 1.05-2.9 2.55-3.4z" fill="#fff"/>
      <!-- 耳 -->
      <circle cx="15.5" cy="7.9" r="1.35" fill="#fff"/>
      <circle cx="15.5" cy="7.9" r=".6" fill="#5B54E8" fill-opacity=".2"/>
      <!-- 眼 -->
      <circle cx="17.1" cy="11.6" r=".95" fill="#5B54E8"/>
      <circle cx="17.4" cy="11.3" r=".3" fill="#fff"/>
      <!-- 鼻 -->
      <ellipse cx="19.9" cy="12.7" rx=".95" ry=".72" fill="#5B54E8"/>
      <!-- 树枝：从嘴里向右平伸 -->
      <rect x="18.9" y="13.7" width="4.3" height="1.15" rx=".57" fill="#5B54E8"/>
      <!-- 叶子：大叶朝上、小叶朝下 -->
      <path d="M21.6 13.75c.25-1.45 1.35-2.5 2.75-2.7-.15 1.5-1.2 2.6-2.75 2.7z" fill="#fff"/>
      <path d="M21.9 14.8c-.1 1.1-.85 1.95-1.95 2.15.2-1.15.9-2 1.95-2.15z" fill="#fff" fill-opacity=".85"/>
      <!-- 小前爪扶枝 -->
      <ellipse cx="17.6" cy="15.6" rx=".9" ry=".7" fill="#5B54E8" fill-opacity=".18"/>
    </svg>

    <!-- 头部版 -->
    <svg v-else viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- 耳 -->
      <circle cx="6.9" cy="6.4" r="2.1" fill="#fff"/>
      <circle cx="6.9" cy="6.4" r=".95" fill="#5B54E8" fill-opacity=".2"/>
      <!-- 头（侧脸朝右） -->
      <path d="M6.5 8.6c.2-2.6 3.4-2.9 4.1-.6l.1.8c2.4.5 4.3 2.6 4.3 5.1 0 3-2.7 5.4-6 5.4-3.4 0-6-2.4-6-5.4 0-2.4 1.5-4.5 3.6-5.2z" fill="#fff"/>
      <!-- 眼 -->
      <circle cx="10.6" cy="11.6" r="1.35" fill="#5B54E8"/>
      <circle cx="11" cy="11.2" r=".42" fill="#fff"/>
      <!-- 鼻 -->
      <ellipse cx="14.9" cy="13.4" rx="1.4" ry="1.05" fill="#5B54E8"/>
      <!-- 门牙（两颗） -->
      <rect x="12.7" y="14.8" width="2.35" height="3.4" rx=".65" fill="#5B54E8"/>
      <path d="M13.88 15.1v2.8" stroke="#fff" stroke-width=".55" stroke-opacity=".9"/>
    </svg>
  </span>
</template>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  background: linear-gradient(135deg, #818CF8 0%, #6366F1 55%, #5B54E8 100%);
  box-shadow: 0 4px 12px rgba(99, 102, 241, .28);
  overflow: hidden;
}
.brand-logo svg { width: 78%; height: 78%; display: block; }
.brand-logo--bare {
  background: none;
  box-shadow: none;
  border-radius: 0 !important;
}
.brand-logo--bare svg { width: 100%; height: 100%; }
</style>
