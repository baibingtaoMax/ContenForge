<template>
  <!-- 小红书知识卡片工坊：右侧浮动胶囊 + 无遮罩抽屉，自包含 -->
  <div class="xhs-fab-stack" :class="{ shifted: open }">
    <button type="button" class="xhs-fab" :class="{ on: open }" @click="toggle">
      <AppIcon name="palette" :size="17" />
      <span class="xhs-fab-label">卡片</span>
      <span v-if="totalCount" class="xhs-fab-badge">{{ totalCount }}</span>
      <span v-if="allRendered" class="xhs-fab-dot" />
    </button>
  </div>

  <el-drawer
    v-model="open"
    :modal="false"
    :lock-scroll="false"
    :with-header="false"
    direction="rtl"
    size="560px"
    class="xhs-studio-drawer"
  >
    <div class="xs-panel">
      <!-- 顶部工具条 -->
      <div class="xs-toolbar">
        <div class="xs-toolbar-row">
          <span class="xs-title">知识卡片轮播 · 3:4</span>
          <div class="xs-toolbar-actions">
            <el-button size="small" type="primary" plain :loading="generating" @click="generate">
              {{ deck ? '重新出方案' : '生成卡片方案' }}
            </el-button>
            <el-button size="small" :disabled="!deck" :loading="saving" @click="savePlan">保存文案</el-button>
            <el-button size="small" type="warning" plain :disabled="!deck" :loading="renderingAll" @click="renderAll">
              全部出图{{ deck ? `（${renderedCount}/${totalCount}）` : '' }}
            </el-button>
          </div>
        </div>
        <p class="xs-tip">AI 读稿把文章拆成「封面＋{{ CARD_HINT }}张正文＋结尾」的滑动卡片，文字可改，出图是模板精确排版（零错字）。改完文案点「渲染本张」。</p>

        <!-- 风格库 -->
        <div class="xs-stylebar">
          <div class="xs-style-items">
            <button
              v-for="s in styles"
              :key="s.id"
              type="button"
              class="xs-swatch"
              :class="{ on: deck && deck.styleId === s.id, dim: deck && deck.styleId !== s.id }"
              :disabled="!deck || switchingStyle === s.id"
              :title="s.description"
              @click="pickStyle(s.id)"
            >
              <span class="xs-swatch-dots">
                <i :style="{ background: s.colors.bg }"></i>
                <i :style="{ background: s.colors.ink }"></i>
                <i :style="{ background: s.colors.accent }"></i>
              </span>
              <span class="xs-swatch-name">{{ s.name }}</span>
              <span v-if="!s.builtin" class="xs-swatch-del" @click="removeStyle(s, $event)">×</span>
            </button>
          </div>
          <el-button size="small" text type="primary" @click="showAi = !showAi">✨ AI 设计新风格</el-button>
        </div>
        <div v-if="showAi" class="xs-airow">
          <el-input v-model="aiBrief" size="small" placeholder="描述感觉，如：治愈莫兰迪、温柔手帐风 / 黑金高级感、财经评论" @keyup.enter="aiDesign" />
          <el-button size="small" type="primary" :loading="designing" @click="aiDesign">生成并存库</el-button>
        </div>

        <div v-if="deck" class="xs-meta-row">
          <label>栏目<input v-model="deck.kicker" maxlength="8" /></label>
          <label>期号<input v-model="deck.issue" maxlength="4" /></label>
          <el-button size="small" text :loading="downloadingAll" @click="downloadAll">打包下载全部 PNG</el-button>
        </div>
      </div>

      <!-- 空态 -->
      <div v-if="!deck" class="xs-empty">
        <AppIcon name="palette" :size="30" />
        <p>还没有卡片方案</p>
        <span>点「生成卡片方案」，AI 一次出整套 3:4 卡片文案，再逐张出图下载</span>
      </div>

      <!-- 卡片列表 -->
      <div v-else class="xs-list">
        <!-- 封面卡 -->
        <div class="xs-card">
          <div class="xs-card-head"><el-tag type="warning" effect="dark">封面</el-tag><span class="xs-card-id">cover</span></div>
          <div class="xs-card-body">
            <div class="xs-preview" @click="deck.cover.render && download(deck.cover.render.url, 'cover.png')">
              <img v-if="deck.cover.render" :src="deck.cover.render.url" alt="封面卡" />
              <div v-else class="xs-preview-empty">未出图</div>
            </div>
            <div class="xs-fields">
              <label>大标题（\n 分行）<textarea v-model="deck.cover.title" rows="2"></textarea></label>
              <label>高亮原词<input v-model="deck.cover.hl" maxlength="12" /></label>
              <label>副述<input v-model="deck.cover.deck" maxlength="60" /></label>
              <div class="xs-card-actions">
                <el-button size="small" type="primary" :loading="renderingId === 'cover'" @click="renderOne('cover')">渲染本张</el-button>
                <el-button size="small" plain :disabled="!deck.cover.render" @click="deck.cover.render && download(deck.cover.render.url, 'cover.png')">下载</el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 正文卡 -->
        <div v-for="(c, i) in deck.cards" :key="c.id" class="xs-card">
          <div class="xs-card-head">
            <el-tag effect="plain">正文 {{ i + 1 }}</el-tag>
            <span class="xs-card-id">{{ c.id }}</span>
            <el-button text size="small" type="danger" class="xs-card-del" @click="removePointCard(i)">删卡</el-button>
          </div>
          <div class="xs-card-body">
            <div class="xs-preview" @click="c.render && download(c.render.url, `${c.id}.png`)">
              <img v-if="c.render" :src="c.render.url" alt="正文卡" />
              <div v-else class="xs-preview-empty">未出图</div>
            </div>
            <div class="xs-fields">
              <label>核心观点<input v-model="c.title" maxlength="40" /></label>
              <label>高亮原词<input v-model="c.hl" maxlength="12" /></label>
              <div class="xs-points">
                <span class="xs-points-label">要点</span>
                <div v-for="(pt, pi) in c.points" :key="pi" class="xs-point-row">
                  <input v-model="c.points[pi]" maxlength="60" />
                  <el-button text size="small" type="danger" @click="c.points.splice(pi, 1)">删</el-button>
                </div>
                <el-button size="small" text :disabled="c.points.length >= 4" @click="c.points.push('')">＋ 加要点</el-button>
              </div>
              <div class="xs-card-actions">
                <el-button size="small" type="primary" :loading="renderingId === c.id" @click="renderOne(c.id)">渲染本张</el-button>
                <el-button size="small" plain :disabled="!c.render" @click="c.render && download(c.render.url, `${c.id}.png`)">下载</el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 结尾卡 -->
        <div class="xs-card">
          <div class="xs-card-head"><el-tag type="success" effect="dark">结尾</el-tag><span class="xs-card-id">closing</span></div>
          <div class="xs-card-body">
            <div class="xs-preview" @click="deck.closing.render && download(deck.closing.render.url, 'closing.png')">
              <img v-if="deck.closing.render" :src="deck.closing.render.url" alt="结尾卡" />
              <div v-else class="xs-preview-empty">未出图</div>
            </div>
            <div class="xs-fields">
              <label>金句<textarea v-model="deck.closing.quote" rows="2"></textarea></label>
              <label>高亮原词<input v-model="deck.closing.quoteHl" maxlength="12" /></label>
              <label>关注引导<input v-model="deck.closing.cta" maxlength="60" /></label>
              <div class="xs-card-actions">
                <el-button size="small" type="primary" :loading="renderingId === 'closing'" @click="renderOne('closing')">渲染本张</el-button>
                <el-button size="small" plain :disabled="!deck.closing.render" @click="deck.closing.render && download(deck.closing.render.url, 'closing.png')">下载</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import AppIcon from './AppIcon.vue'
import {
  getXhsDeck,
  generateXhsDeck,
  saveXhsDeck,
  renderXhsCard,
  listXhsStyles,
  designXhsStyle,
  deleteXhsStyle,
  type XhsCardDeck,
  type XhsStyle,
} from '@/api'

const props = defineProps<{ articleId: string }>()

const CARD_HINT = '6-9'

const open = ref(false)
const deck = ref<XhsCardDeck | null>(null)
const styles = ref<XhsStyle[]>([])
const generating = ref(false)
const saving = ref(false)
const renderingAll = ref(false)
const renderingId = ref('')
const downloadingAll = ref(false)
const switchingStyle = ref('')
const showAi = ref(false)
const aiBrief = ref('')
const designing = ref(false)

async function loadStyles() {
  try {
    const r = await listXhsStyles()
    styles.value = r.styles || []
  } catch { /* ignore */ }
}

async function pickStyle(id: string) {
  if (!deck.value || deck.value.styleId === id) return
  switchingStyle.value = id
  try {
    const r = await saveXhsDeck(props.articleId, { styleId: id } as Partial<XhsCardDeck>)
    if (r.ok && r.deck) {
      deck.value = r.deck
      ElMessage.success('已换风格，旧成图清空，重新出图即可')
    } else ElMessage.error(r.error || '切换失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '切换失败')
  } finally {
    switchingStyle.value = ''
  }
}

async function aiDesign() {
  const brief = aiBrief.value.trim()
  if (!brief) { ElMessage.warning('先说一句想要的感觉，比如「治愈莫兰迪、温柔手帐风」'); return }
  designing.value = true
  try {
    const r = await designXhsStyle(brief, props.articleId)
    if (r.ok && r.style) {
      styles.value = [...styles.value, r.style]
      aiBrief.value = ''
      showAi.value = false
      ElMessage.success(`AI 设计了「${r.style.name}」，已存库，正在切换…`)
      await pickStyle(r.style.id)
    } else ElMessage.error(r.error || '设计失败，换个说法重试')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || 'AI 设计失败')
  } finally {
    designing.value = false
  }
}

async function removeStyle(s: XhsStyle, ev: Event) {
  ev.stopPropagation()
  if (s.builtin) return
  if (!window.confirm(`删除自定义风格「${s.name}」？`)) return
  try {
    await deleteXhsStyle(s.id)
    styles.value = styles.value.filter((x) => x.id !== s.id)
    ElMessage.success('已删除')
  } catch { ElMessage.error('删除失败') }
}

const totalCount = computed(() => (deck.value ? deck.value.cards.length + 2 : 0))
const renderedCount = computed(() => {
  if (!deck.value) return 0
  let n = deck.value.cover.render ? 1 : 0
  n += deck.value.cards.filter((c) => c.render).length
  n += deck.value.closing.render ? 1 : 0
  return n
})
const allRendered = computed(() => !!deck.value && renderedCount.value === totalCount.value)

async function load() {
  try {
    const r = await getXhsDeck(props.articleId)
    deck.value = r.deck
  } catch { /* 首次无方案 */ }
}
onMounted(() => { load(); loadStyles() })
watch(() => props.articleId, load)

function toggle() {
  open.value = !open.value
}

async function generate() {
  generating.value = true
  ElMessage.info('正在通读主稿拆卡片，约 1-3 分钟…')
  try {
    const r = await generateXhsDeck(props.articleId)
    if (r.ok && r.deck) {
      deck.value = r.deck
      ElMessage.success(`已出 ${r.deck.cards.length} 张正文卡 + 封面/结尾，可改文案后出图`)
    } else {
      ElMessage.error(r.error || '生成失败，可重试')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '生成失败，可重试')
  } finally {
    generating.value = false
  }
}

async function savePlan() {
  if (!deck.value) return
  saving.value = true
  try {
    const r = await saveXhsDeck(props.articleId, deck.value)
    if (r.ok && r.deck) deck.value = r.deck
    ElMessage.success('文案已保存（如改过文字，记得重新渲染对应卡片）')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '保存失败')
  } finally {
    saving.value = false
  }
}

async function renderOne(cardId: string) {
  renderingId.value = cardId
  try {
    const r = await renderXhsCard(props.articleId, cardId)
    if (r.ok && r.deck) deck.value = r.deck
    else ElMessage.error(r.error || '渲染失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '渲染失败，可重试')
  } finally {
    renderingId.value = ''
  }
}

async function renderAll() {
  renderingAll.value = true
  ElMessage.info('逐张截图出图，约需 1 分钟…')
  try {
    const r = await renderXhsCard(props.articleId)
    if (r.deck) deck.value = r.deck
    if (r.ok) ElMessage.success(`全部 ${r.rendered} 张出图完成`)
    else ElMessage.warning(`完成 ${r.rendered} 张，失败：${(r.failed || []).join('、')}`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '批量渲染失败')
  } finally {
    renderingAll.value = false
  }
}

function removePointCard(i: number) {
  if (!deck.value) return
  deck.value.cards.splice(i, 1)
}

async function download(url: string, filename: string) {
  try {
    const resp = await fetch(url)
    const blob = await resp.blob()
    const obj = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = obj
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(obj)
  } catch {
    ElMessage.error('下载失败')
  }
}

function allRenders(): Array<{ url: string; name: string }> {
  if (!deck.value) return []
  const items: Array<{ url: string; name: string }> = []
  if (deck.value.cover.render) items.push({ url: deck.value.cover.render.url, name: '01-cover.png' })
  deck.value.cards.forEach((c, i) => {
    if (c.render) items.push({ url: c.render.url, name: `${String(i + 2).padStart(2, '0')}-${c.id}.png` })
  })
  if (deck.value.closing.render) items.push({ url: deck.value.closing.render.url, name: `${String(deck.value.cards.length + 2).padStart(2, '0')}-closing.png` })
  return items
}

async function downloadAll() {
  if (!deck.value || renderedCount.value === 0) { ElMessage.warning('还没有已出图的卡片，先渲染'); return }
  downloadingAll.value = true
  try {
    const items = allRenders()
    for (const item of items) {
      // 逐张触发下载（浏览器可能询问多文件下载权限）
      // eslint-disable-next-line no-await-in-loop
      await download(item.url, item.name)
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 350))
    }
    ElMessage.success(`已触发 ${renderedCount.value} 张下载；若浏览器拦截请允许本站下载多个文件`)
  } finally {
    downloadingAll.value = false
  }
}
</script>

<style scoped lang="scss">
/* 浮动胶囊 */
.xhs-fab-stack {
  position: fixed; right: 18px; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 10px; z-index: 2200; transition: right .22s ease;
}
.xhs-fab-stack.shifted { right: 580px; }
@media (max-width: 640px) { .xhs-fab-stack.shifted { right: 18px; } }
.xhs-fab {
  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; width: 52px; min-height: 54px; padding: 6px 0;
  border: 1px solid var(--pf-border-strong, #d8d6cc); border-radius: 14px;
  background: #fff; color: var(--pf-text-2); cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.10); transition: all .15s;
  &:hover { color: var(--pf-primary, #ed7b2f); border-color: var(--pf-primary, #ed7b2f); transform: translateY(-1px); }
  &.on { color: #fff; background: var(--pf-primary, #ed7b2f); border-color: var(--pf-primary, #ed7b2f); }
}
.xhs-fab-label { font-size: 11px; line-height: 1; }
.xhs-fab-badge {
  position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 700; color: #fff; background: var(--pf-primary, #ed7b2f);
  border-radius: 9px; border: 2px solid #fff; box-sizing: content-box;
}
.xhs-fab-dot { position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border-radius: 50%; background: #22c55e; border: 2px solid #fff; box-sizing: content-box; }

/* 抽屉内部 */
.xs-panel { display: flex; flex-direction: column; height: 100%; background: #faf8f2; }
.xs-toolbar { padding: 14px 16px; background: #fff; border-bottom: 1px solid var(--pf-border, #e6e4dc); flex-shrink: 0; }
.xs-toolbar-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.xs-title { font-weight: 700; font-size: 15px; }
.xs-toolbar-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.xs-tip { font-size: 11.5px; color: var(--pf-text-3); line-height: 1.6; margin: 8px 0 0; }

/* 风格库 */
.xs-stylebar { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.xs-style-items { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
.xs-swatch {
  position: relative; display: inline-flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 7px 10px 6px; border: 1.5px solid var(--pf-border-strong, #d8d6cc); border-radius: 9px;
  background: #fff; cursor: pointer; transition: all .13s; min-width: 64px;
}
.xs-swatch:hover { border-color: var(--pf-primary, #ed7b2f); transform: translateY(-1px); }
.xs-swatch.on { border-color: var(--pf-primary, #ed7b2f); box-shadow: 0 0 0 2px rgba(237,123,47,.18); }
.xs-swatch.dim { opacity: .62; }
.xs-swatch:disabled { cursor: default; }
.xs-swatch-dots { display: inline-flex; gap: 3px; }
.xs-swatch-dots i { width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(0,0,0,.12); display: block; }
.xs-swatch-name { font-size: 11px; line-height: 1; color: var(--pf-text-2); white-space: nowrap; }
.xs-swatch-del {
  position: absolute; top: -7px; right: -7px; width: 17px; height: 17px; line-height: 15px; text-align: center;
  border-radius: 50%; background: #e0563f; color: #fff; font-size: 12px; font-weight: 700; border: 2px solid #fff;
}
.xs-airow { display: flex; gap: 8px; margin-top: 8px; }
.xs-airow .el-input { flex: 1; }
.xs-meta-row { display: flex; align-items: center; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
.xs-meta-row label { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--pf-text-2); }
.xs-meta-row input { width: 90px; height: 28px; padding: 0 8px; border: 1px solid var(--pf-border-strong, #d8d6cc); border-radius: 6px; font-size: 12.5px; }

.xs-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--pf-text-3); padding: 40px; text-align: center; }
.xs-empty p { font-size: 14px; font-weight: 600; margin: 6px 0 0; }
.xs-empty span { font-size: 12px; line-height: 1.7; max-width: 280px; }

.xs-list { flex: 1; overflow-y: auto; padding: 14px 16px 30px; display: flex; flex-direction: column; gap: 14px; }
.xs-card { background: #fff; border: 1px solid var(--pf-border, #e6e4dc); border-radius: 10px; padding: 12px; }
.xs-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.xs-card-id { font-family: var(--pf-font-mono, monospace); font-size: 11px; color: var(--pf-text-3); }
.xs-card-del { margin-left: auto; }
.xs-card-body { display: flex; gap: 14px; align-items: flex-start; }
.xs-preview {
  flex: 0 0 168px; width: 168px; aspect-ratio: 3 / 4; border-radius: 6px; overflow: hidden;
  background: #141416; border: 1px solid var(--pf-border-strong, #d8d6cc); cursor: zoom-in;
  display: flex; align-items: center; justify-content: center;
}
.xs-preview img { width: 100%; height: 100%; object-fit: cover; display: block; }
.xs-preview-empty { color: #8a857b; font-size: 12px; }
.xs-fields { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.xs-fields label { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--pf-text-3); }
.xs-fields input, .xs-fields textarea {
  width: 100%; padding: 6px 8px; border: 1px solid var(--pf-border-strong, #d8d6cc);
  border-radius: 6px; font-size: 12.5px; font-family: inherit; resize: vertical; color: var(--pf-text-1);
}
.xs-points { display: flex; flex-direction: column; gap: 4px; }
.xs-points-label { font-size: 11.5px; color: var(--pf-text-3); }
.xs-point-row { display: flex; align-items: center; gap: 4px; }
.xs-point-row input { flex: 1; }
.xs-card-actions { display: flex; gap: 6px; margin-top: 4px; }

@media (max-width: 640px) {
  .xs-card-body { flex-direction: column; }
  .xs-preview { flex-basis: auto; width: 100%; max-width: 240px; }
}
</style>

<!-- el-drawer teleport 到 body，外壳样式需非 scoped -->
<style lang="scss">
.xhs-studio-drawer.el-drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 560px; max-width: 94vw; height: 100% !important; margin: 0;
  border-radius: 14px 0 0 14px; box-shadow: -10px 0 36px rgba(0,0,0,.16);
  background: #faf8f2; z-index: 2100;
}
.xhs-studio-drawer .el-drawer__body { padding: 0; height: 100%; overflow: hidden; }
@media (max-width: 640px) {
  .xhs-studio-drawer.el-drawer { width: 100% !important; max-width: 100%; border-radius: 0; }
}
</style>
