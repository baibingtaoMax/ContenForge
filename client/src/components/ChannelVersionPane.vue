<template>
  <div class="cv-pane">
    <!-- 第一行：版本标题 -->
    <div class="cv-bar cv-bar-primary">
      <el-input v-model="title" size="small" class="cv-title-input" placeholder="该渠道版本标题" />
    </div>

    <!-- 第二行：生产动作（左）+ 视图/保存（右）；交付动作在预览下方 -->
    <div class="cv-bar cv-bar-actions">
      <div class="cv-group">
        <el-button size="small" @click="openAdapt">
          <AppIcon name="sparkle" :size="13" /> {{ hasVersion ? '重新 AI 生成' : 'AI 生成' }}
        </el-button>
        <el-button v-if="channel === 'wechat'" size="small" type="warning" :loading="autoLayouting" @click="runAutoLayout">
          <AppIcon name="sparkle" :size="13" /> AI 一键排版
        </el-button>
      </div>
      <div class="cv-group cv-group-right">
        <el-radio-group v-if="channel === 'wechat' && layoutHtml" v-model="wechatMode" size="small">
          <el-radio-button label="layout">成品预览</el-radio-button>
          <el-radio-button label="source">源文</el-radio-button>
        </el-radio-group>
        <el-button size="small" :loading="saving" @click="save">保存</el-button>
        <el-button v-if="channel !== 'wechat'" size="small" type="primary" @click="copyPlain">
          <AppIcon name="copy" :size="13" /> 一键复制
        </el-button>
        <el-button v-else-if="!layoutHtml" size="small" type="primary" @click="copyRich">
          <AppIcon name="copy" :size="13" /> 一键复制富文本
        </el-button>
      </div>
    </div>
    <div v-if="channel === 'wechat'" class="cv-hint">{{ wechatMode === 'layout' ? '成品为橄榄手记排版，复制后直接粘贴公众号后台即可。' : '粘贴到公众号后台编辑器会保留标题层级、加粗、引用等排版。' }}</div>
    <div v-else-if="channel === 'xhs'" class="cv-hint">纯文本直接粘贴小红书；标题候选/话题标签/封面文案在下方。</div>
    <div v-else class="cv-hint">Markdown 源码，掘金/知乎编辑器可直接粘贴。</div>

    <!-- 公众号：成品预览/源文上提（结果优先，打开即看成品） -->
    <template v-if="channel === 'wechat'">
      <div v-if="wechatMode === 'layout' && layoutHtml" class="cv-layout">
        <iframe class="cv-layout-frame" :srcdoc="layoutDoc" title="成品预览"></iframe>
      </div>
      <el-input
        v-else
        v-model="content"
        type="textarea"
        :autosize="{ minRows: 14, maxRows: 30 }"
        class="cv-textarea"
        :placeholder="placeholder"
      />

      <!-- 交付条：当前封面状态（点击进工坊）+ 复制 + 推送，紧跟预览（排版后出现） -->
      <div v-if="layoutHtml" class="cv-deliver">
        <button type="button" class="cv-cover-entry" @click="openCoverStudio">
          <div v-if="coverMeta" class="cv-cover-thumb" :title="coverMeta.filename">
            <img :src="coverMeta.url" alt="公众号封面" />
          </div>
          <div v-else class="cv-cover-none">无封面</div>
          <span class="cv-cover-txt">{{ coverMeta ? '封面管理' : '设置封面' }} ›</span>
        </button>
        <div class="cv-deliver-right">
          <el-button size="small" type="primary" @click="copyRich">
            <AppIcon name="copy" :size="13" /> {{ wechatMode === 'layout' ? '复制成品' : '一键复制富文本' }}
          </el-button>
          <el-button size="small" type="success" :loading="pushing" @click="pushDraft">
            <AppIcon name="copy" :size="13" /> 推送到草稿箱
          </el-button>
        </div>
      </div>
    </template>

    <!-- 小红书附加物料 -->
    <div v-if="channel === 'xhs' && xhsExtra" class="xhs-extra">
      <div v-if="xhsExtra.titleCandidates?.length" class="xe-block">
        <div class="xe-label">标题候选</div>
        <div class="xe-chips">
          <span v-for="(t, i) in xhsExtra.titleCandidates" :key="i" class="xe-chip" @click="title = t">{{ t }}</span>
        </div>
      </div>
      <div v-if="xhsExtra.tags?.length" class="xe-block">
        <div class="xe-label">话题标签</div>
        <div class="xe-tags">
          <el-tag v-for="(t, i) in xhsExtra.tags" :key="i" size="small" effect="plain">#{{ t }}</el-tag>
          <el-button text size="small" @click="copyTags">复制标签</el-button>
        </div>
      </div>
      <div v-if="xhsExtra.coverText" class="xe-block">
        <div class="xe-label">封面文案</div>
        <div class="xe-cover">{{ xhsExtra.coverText }}</div>
      </div>
    </div>

    <!-- 公众号素材工具：右侧浮动胶囊（配图/封面），点击开无遮罩侧边抽屉 -->
    <div v-if="channel === 'wechat'" class="cv-fab-stack" :class="{ shifted: drawerVisible }">
      <button type="button" class="cv-fab" :class="{ on: drawerVisible && drawerTab === 'shots' }" @click="openDrawer('shots')">
        <AppIcon name="palette" :size="17" />
        <span class="cv-fab-label">配图</span>
        <span v-if="shots.length" class="cv-fab-badge">{{ shots.length }}</span>
      </button>
      <button type="button" class="cv-fab" :class="{ on: drawerVisible && drawerTab === 'cover' }" @click="openDrawer('cover')">
        <AppIcon name="layers" :size="17" />
        <span class="cv-fab-label">封面</span>
        <span v-if="coverMeta || coverStudio?.chosen" class="cv-fab-dot" />
      </button>
    </div>

    <el-drawer
      v-if="channel === 'wechat'"
      v-model="drawerVisible"
      :modal="false"
      :lock-scroll="false"
      :with-header="false"
      direction="rtl"
      size="520px"
      class="cv-studio-drawer"
    >
      <el-tabs v-model="drawerTab" class="cv-drawer-tabs">
        <!-- ========== 配图 tab ========== -->
        <el-tab-pane name="shots">
          <template #label>
            <span class="cv-dtab-label"><AppIcon name="palette" :size="14" /> 配图方案<em v-if="shots.length" class="cv-dtab-count">{{ shots.length }}</em></span>
          </template>
          <div class="cv-drawer-toolbar">
            <span class="cv-drawer-tip">每篇建议 4-8 张，独立于排版；此阶段只出提示词</span>
            <el-button size="small" type="primary" plain :loading="shotsLoading" @click="generateShots">
              {{ shots.length ? '重新生成整单' : '生成配图方案' }}
            </el-button>
          </div>
          <div class="cv-drawer-body">
        <div v-if="!shots.length" class="gs-note">
          一次调用产出 4-8 条配图方案：每张给插图位置、表达意图和可直接拿去生图的小黑 IP prompt。
          这一步不生图，prompt 可手动微调，也可复制到别处生图。
        </div>

        <div v-for="(s, i) in shots" :key="s.id" class="gs-card">
          <div class="gs-card-head">
            <span class="gs-no">{{ String(i + 1).padStart(2, '0') }}</span>
            <el-tag size="small" :type="s.status === 'generated' ? 'success' : 'info'" effect="plain">
              {{ s.status === 'generated' ? '已生图' : '方案' }}
            </el-tag>
            <el-tag v-if="s.adopted" size="small" type="warning" effect="dark">已采用进正文</el-tag>
            <el-tag v-if="s.anchorMatched === false" size="small" type="warning" effect="plain">锚点待确认</el-tag>
            <el-tag v-if="s.promptAutoRewritten" size="small" type="success" effect="plain">已自动改写</el-tag>
            <span class="gs-anchor">{{ s.anchorSection || '（未标章节）' }}</span>
            <el-button text size="small" type="danger" class="gs-del" @click="removeShot(s)">删除</el-button>
          </div>
          <div class="gs-row gs-anchor-row">
            <span class="gs-k">插在这段后</span>
            <div class="gs-anchor-edit">
              <el-input
                v-model="anchorDrafts[s.id]"
                size="small"
                class="gs-anchor-input"
                placeholder="正文里该段开头的十几个字"
              />
              <el-button
                size="small"
                plain
                :loading="savingShots[s.id]"
                :disabled="!(anchorDrafts[s.id] || '').trim() || anchorDrafts[s.id] === s.afterParagraph"
                @click="saveShotAnchor(s)"
              >改位置</el-button>
            </div>
          </div>
          <!-- 实际落点反馈：让「图有没有插对地方」一眼可见 -->
          <div v-if="s.placement" class="gs-place" :class="s.placement.ok ? 'ok' : 'bad'">
            <template v-if="s.placement.ok">
              <AppIcon :name="s.placement.via === 'fuzzy' ? 'info' : 'check-circle'" :size="12" />
              <span>{{ s.placement.via === 'fuzzy' ? '排版有改写，已近似定位到：' : '实际落在：' }}「{{ s.placement.preview }}…」</span>
            </template>
            <template v-else>
              <AppIcon name="alert-triangle" :size="12" />
              <span>排版稿里没找到这段（可能被改写或删了）；采用后图会放到文章末尾，建议改上面的锚点句</span>
            </template>
          </div>
          <div class="gs-row"><span class="gs-k">意图</span><span class="gs-v">{{ s.intent }}</span></div>
          <div class="gs-row"><span class="gs-k">画面</span><span class="gs-v gs-muted">{{ s.scene }}</span></div>
          <div class="gs-row gs-prompt-row">
            <span class="gs-k">生图 prompt</span>
            <el-input
              v-model="promptDrafts[s.id]"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 6 }"
              class="gs-prompt-input"
            />
          </div>
          <!-- 生图失败常驻条（不再只靠一闪而过的 toast） -->
          <div v-if="s.lastError" class="gs-fail">
            <div class="gs-fail-head">
              <AppIcon name="alert-triangle" :size="13" />
              <span>{{ s.lastErrorKind === 'sensitive' ? '内容审核未通过' : '生图失败' }}</span>
              <span v-if="s.lastErrorAt" class="gs-fail-time">{{ new Date(s.lastErrorAt).toLocaleTimeString() }}</span>
            </div>
            <div class="gs-fail-msg">{{ s.lastError }}</div>
            <div v-if="s.lastErrorKind === 'sensitive'" class="gs-fail-hint">
              可直接改上面 prompt（血→红色颜料、武器→日常道具、死亡/暴力→温和动作、政治宗教真人→泛化角色）后点「重新生成」；也可先原样再试一次。
            </div>
          </div>
          <!-- 候选图预览 -->
          <div v-if="selectedCandidate(s)" class="gs-img-area">
            <div class="gs-thumb-wrap">
              <img :src="selectedCandidate(s)!.url" class="gs-thumb" alt="配图预览" />
              <span class="gs-thumb-size">{{ selectedCandidate(s)!.width }}×{{ selectedCandidate(s)!.height }}</span>
            </div>
            <div v-if="(s.candidates?.length || 0) > 1" class="gs-cand-strip">
              <div
                v-for="c in s.candidates"
                :key="c.relPath"
                class="gs-cand"
                :class="{ on: c.relPath === s.selected }"
                :title="`候选 ${new Date(c.createdAt).toLocaleTimeString()}`"
                @click="chooseCandidate(s, c.relPath)"
              >
                <img :src="c.url" alt="候选" />
              </div>
            </div>
          </div>

          <div class="gs-card-foot">
            <el-button
              size="small"
              :type="s.lastError ? 'danger' : 'primary'"
              :loading="generatingShots[s.id]"
              @click="generateImage(s)"
            >{{ s.lastError ? '重新生成' : (s.candidates?.length || 0) ? '换一张' : '生成图片' }}</el-button>
            <el-button
              v-if="(s.candidates?.length || 0) > 0"
              size="small"
              :type="s.adopted ? 'warning' : 'success'"
              plain
              @click="toggleAdopt(s)"
            >{{ s.adopted ? '移出正文' : '采用进正文' }}</el-button>
            <el-button size="small" @click="copyShotPrompt(s)">复制 prompt</el-button>
            <el-button
              size="small"
              plain
              :disabled="!promptDrafts[s.id] || promptDrafts[s.id] === s.prompt"
              :loading="savingShots[s.id]"
              @click="saveShotPrompt(s)"
            >保存 prompt</el-button>
          </div>
          </div>
          </div>
        </el-tab-pane>

        <!-- ========== 封面 tab ========== -->
        <el-tab-pane name="cover">
          <template #label>
            <span class="cv-dtab-label"><AppIcon name="layers" :size="14" /> AI 封面工坊<em v-if="coverMeta || coverStudio?.chosen" class="cv-dtab-ok">✓</em></span>
          </template>
          <div class="cv-drawer-toolbar">
            <span class="cv-drawer-tip">AI 读稿出文案＋两版画面，模板准确排标题，一次 4 张挑选；也可本地上传</span>
            <el-upload :show-file-list="false" :before-upload="beforeUploadCover" accept="image/*">
              <el-button size="small" :loading="coverSaving">本地上传</el-button>
            </el-upload>
            <el-button v-if="coverMeta" size="small" text type="danger" @click="removeCover">删封面</el-button>
            <el-button size="small" type="warning" plain :loading="coverPlanLoading" @click="genCoverPlan">
              {{ coverStudio ? '重出方案' : '生成封面方案' }}
            </el-button>
          </div>
          <div class="cv-drawer-body">
        <div v-if="!coverStudio" class="gs-note">
          点「生成封面方案」：AI 读主稿，给出主标题/方图短句/金句/期号 + 两版画面 prompt（小黑 IP 版、杂志抽象版）。
          文字可改；生图只画【无文字】背景，中文标题由模板精确排上去（零错字），最终出 21:9 横图 + 1:1 方图各两版。
        </div>

        <template v-else>
          <!-- 方案文字编辑 -->
          <div class="cs-plan">
            <div class="cs-plan-row">
              <label>期号</label>
              <el-input v-model="coverPlanDraft.issue" size="small" class="cs-issue" />
              <label>年份</label>
              <el-input v-model="coverPlanDraft.year" size="small" class="cs-issue" />
              <label>栏目</label>
              <el-input v-model="coverPlanDraft.kicker" size="small" class="cs-kicker" />
              <label>英文</label>
              <el-input v-model="coverPlanDraft.en" size="small" class="cs-en" />
            </div>
            <div class="cs-plan-row cs-cols">
              <div class="cs-field">
                <label>横图标题（\n 换行，≤13字/行）</label>
                <el-input v-model="coverPlanDraft.wideTitle" type="textarea" :autosize="{ minRows: 2, maxRows: 3 }" />
                <label class="cs-sub">高亮原词</label>
                <el-input v-model="coverPlanDraft.wideHl" size="small" />
              </div>
              <div class="cs-field">
                <label>方图标题（\n 换行，≤7字/行）</label>
                <el-input v-model="coverPlanDraft.squareTitle" type="textarea" :autosize="{ minRows: 2, maxRows: 3 }" />
                <label class="cs-sub">高亮原词</label>
                <el-input v-model="coverPlanDraft.squareHl" size="small" />
              </div>
            </div>
            <div class="cs-field"><label>副述 deck</label><el-input v-model="coverPlanDraft.deck" size="small" /></div>
            <div class="cs-plan-row cs-cols">
              <div class="cs-field"><label>小黑版画面 prompt</label>
                <el-input v-model="coverPlanDraft.xiaoheiBody" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" /></div>
              <div class="cs-field"><label>杂志抽象版画面 prompt</label>
                <el-input v-model="coverPlanDraft.magazineBody" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" /></div>
            </div>
            <div class="cs-plan-foot">
              <el-button size="small" :loading="coverPlanSaving" @click="savePlanDraft">保存文案</el-button>
              <el-button size="small" type="primary" plain :loading="coverRenderingAll" :disabled="coverArtCount === 0" @click="renderAll">
                合成全部封面（{{ coverArtCount }}/4 已生背景）
              </el-button>
            </div>
          </div>

          <!-- 4 个版位 -->
          <div class="cs-grid">
            <div v-for="k in COVER_ART_KEYS" :key="k" class="cs-cell">
              <div class="cs-cell-head">
                <span class="cs-cell-name">{{ COVER_LABEL[k] }}</span>
                <el-tag v-if="coverStudio.chosen === k" size="small" type="success" effect="dark">当前封面</el-tag>
              </div>
              <div class="cs-canvas">
                <img v-if="latestRender(k)" :src="latestRender(k)!.url" alt="封面成品" class="cs-render" />
                <img v-else-if="latestArt(k)" :src="latestArt(k)!.url" alt="背景" class="cs-art" />
                <div v-else class="cs-empty">{{ coverBusy[k] ? '生图中…' : '还没生背景' }}</div>
                <div v-if="coverBusy[k]" class="cs-mask"><span class="cs-spin"></span></div>
              </div>
              <div class="cs-cell-foot">
                <el-button size="small" :loading="!!coverBusy[k]" @click="genArt(k)">
                  {{ latestArt(k) ? '换背景' : '生背景' }}
                </el-button>
                <el-button size="small" plain :disabled="!latestArt(k)" :title="latestArt(k) ? '用当前文案合成封面' : '请先点「生背景」'" :loading="coverRendering === k" @click="renderOne(k)">合成</el-button>
                <el-button size="small" type="success" plain :disabled="!latestArt(k)" :title="latestRender(k) ? '把合成成品设为公众号封面' : (latestArt(k) ? '不合成，直接把这张背景图设为封面' : '请先点「生背景」')" @click="chooseOne(k)">设为封面</el-button>
              </div>
            </div>
          </div>
        </template>
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-drawer>

    <!-- 非公众号渠道的源码/纯文本编辑框（公众号的预览与源文已上提） -->
    <el-input
      v-if="channel !== 'wechat'"
      v-model="content"
      type="textarea"
      :autosize="{ minRows: 14, maxRows: 30 }"
      class="cv-textarea"
      :placeholder="placeholder"
    />

    <!-- 小红书知识卡片工坊（自带浮动胶囊+抽屉） -->
    <XhsCardStudio v-if="channel === 'xhs'" :article-id="articleId" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import AppIcon from './AppIcon.vue'
import XhsCardStudio from './XhsCardStudio.vue'
import { listChannelVersions, saveChannelVersion, adaptArticle, pushWxmpDraft, uploadWxmpCover, deleteWxmpCover, autoLayoutGzhApi, generateGzhShots, updateGzhShot, deleteGzhShot, generateGzhShotImage, selectGzhShotCandidate, adoptGzhShot, getCoverStudio, generateCoverPlan, saveCoverPlan, generateCoverArt, renderCover, chooseCover, COVER_ART_KEYS, type GzhShot, type GzhShotCandidate, type WxmpCover, type CoverArtKey, type CoverStudioState, type CoverStudioPlan } from '@/api'
import { renderMarkdown } from '@/utils/markdown'
import type { ChannelKey } from '@/types'

const props = defineProps<{ articleId: string; channel: ChannelKey; adaptNonce: number }>()
const emit = defineEmits<{ (e: 'adapted'): void }>()

const title = ref('')
const content = ref('')
const extra = ref<Record<string, any>>({})
const saving = ref(false)
const adapting = ref(false)
const pushing = ref(false)
const autoLayouting = ref(false)
const wechatMode = ref<'layout' | 'source'>('layout')

// 公众号封面（每篇存一张，推草稿用，避免每次手选）
const coverMeta = ref<WxmpCover | null>(null)
const coverSaving = ref(false)

// 素材侧边抽屉（配图/封面双 tab），无遮罩并排
const drawerVisible = ref(false)
const drawerTab = ref<'shots' | 'cover'>('shots')
function openDrawer(tab: 'shots' | 'cover') {
  // 同一个胶囊再点一次 = 收起
  if (drawerVisible.value && drawerTab.value === tab) {
    drawerVisible.value = false
    return
  }
  drawerTab.value = tab
  drawerVisible.value = true
}
// 从交付条点封面缩略图：打开封面 tab
function openCoverStudio() {
  openDrawer('cover')
}
const coverStudio = ref<CoverStudioState | null>(null)
const coverPlanDraft = ref<CoverStudioPlan>(emptyCoverPlan())
const coverPlanLoading = ref(false)
const coverPlanSaving = ref(false)
const coverRenderingAll = ref(false)
const coverRendering = ref<CoverArtKey | ''>('')
// 各版位生图/合成忙碌态：key -> 'art' | 时间戳
const coverBusy = ref<Record<string, boolean>>({})
const COVER_LABEL: Record<CoverArtKey, string> = {
  'xiaohei-wide': '小黑 · 横图 21:9',
  'xiaohei-square': '小黑 · 方图 1:1',
  'magazine-wide': '杂志 · 横图 21:9',
  'magazine-square': '杂志 · 方图 1:1',
}
function emptyCoverPlan(): CoverStudioPlan {
  return {
    issue: '', year: String(new Date().getFullYear()), kicker: '', en: '',
    wideTitle: '', wideHl: '', squareTitle: '', squareHl: '',
    deck: '', quote: '', quoteHl: '', xiaoheiBody: '', magazineBody: '',
  }
}
function latestArt(k: CoverArtKey) {
  const list = coverStudio.value?.art[k]
  return list && list.length ? list[list.length - 1] : null
}
function latestRender(k: CoverArtKey) {
  const list = coverStudio.value?.renders[k]
  return list && list.length ? list[list.length - 1] : null
}
const coverArtCount = computed(
  () => COVER_ART_KEYS.filter((k) => latestArt(k)).length
)

// 配图方案（独立工序，不属于排版）
const shots = ref<GzhShot[]>([])
const shotsLoading = ref(false)
const promptDrafts = ref<Record<string, string>>({})
const anchorDrafts = ref<Record<string, string>>({})
const savingShots = ref<Record<string, boolean>>({})
const generatingShots = ref<Record<string, boolean>>({})

const layoutHtml = computed(() =>
  props.channel === 'wechat' && typeof extra.value.layoutHtml === 'string' ? extra.value.layoutHtml : ''
)
const layoutDoc = computed(() =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#f3f2ec;}</style></head><body>${layoutHtml.value}</body></html>`
)

const hasVersion = computed(() => !!content.value.trim())
const xhsExtra = computed(() => props.channel === 'xhs' ? extra.value : null)
const placeholder = computed(() =>
  props.channel === 'xhs' ? '小红书正文（纯文本，emoji 断行、分点干货）……' : '适配后的版本内容……'
)

async function load() {
  const { versions } = await listChannelVersions(props.articleId)
  const v = versions.find((x) => x.channel === props.channel)
  if (v) {
    title.value = v.title
    content.value = v.content
    try { extra.value = JSON.parse(v.extra_json || '{}') } catch { extra.value = {} }
  } else {
    title.value = ''; content.value = ''; extra.value = {}
  }
  const list = Array.isArray(extra.value.shots) ? (extra.value.shots as GzhShot[]) : []
  shots.value = list
  // 已存封面（随渠道版本 extra_json 一起返回）
  coverMeta.value = (extra.value.cover as WxmpCover) || null
  // 只初始化还没有草稿的条目，避免采用/换候选触发 load 时冲掉用户未保存的 prompt 编辑
  for (const s of list) {
    if (promptDrafts.value[s.id] === undefined) promptDrafts.value[s.id] = s.prompt
    if (anchorDrafts.value[s.id] === undefined) anchorDrafts.value[s.id] = s.afterParagraph
  }
  // AI 封面工坊状态
  if (props.channel === 'wechat') {
    try {
      const r = await getCoverStudio(props.articleId)
      coverStudio.value = r.state
      if (r.state) coverPlanDraft.value = { ...emptyCoverPlan(), ...r.state.plan }
    } catch { coverStudio.value = null }
  } else {
    coverStudio.value = null
  }
}
onMounted(load)
watch(() => props.articleId, load)
watch(() => props.adaptNonce, (n) => { if (n > 0) load() })

async function generateShots() {
  shotsLoading.value = true
  ElMessage.info('正在通读主稿出配图方案，约 1-3 分钟…')
  try {
    const r = await generateGzhShots(props.articleId)
    if (r.ok && r.shots) {
      shots.value = r.shots
      extra.value.shots = r.shots
      promptDrafts.value = {}
      anchorDrafts.value = {}
      for (const s of r.shots) promptDrafts.value[s.id] = s.prompt
      openDrawer('shots')
      ElMessage.success(`已生成 ${r.shots.length} 条配图方案，可逐条微调 prompt`)
    } else {
      ElMessage.error(r.error || '配图方案生成失败，可重试')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '配图方案生成失败，可重试')
  } finally {
    shotsLoading.value = false
  }
}

async function saveShotPrompt(s: GzhShot) {
  savingShots.value[s.id] = true
  try {
    const r = await updateGzhShot(props.articleId, s.id, { prompt: promptDrafts.value[s.id] })
    if (r.ok) {
      const idx = shots.value.findIndex((x) => x.id === s.id)
      if (idx >= 0) shots.value[idx] = r.shot
      extra.value.shots = shots.value
      ElMessage.success('已保存')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '保存失败')
  } finally {
    savingShots.value[s.id] = false
  }
}

async function saveShotAnchor(s: GzhShot) {
  const v = (anchorDrafts.value[s.id] || '').trim()
  if (!v || v === s.afterParagraph) return
  savingShots.value[s.id] = true
  try {
    const r = await updateGzhShot(props.articleId, s.id, { afterParagraph: v })
    if (r.ok) {
      replaceShot(r.shot)
      anchorDrafts.value[s.id] = r.shot.afterParagraph
      await load() // 后端已重算成品，刷新预览与各条落点
      wechatMode.value = 'layout'
      const bad = r.shot.placement && r.shot.placement.ok === false
      ElMessage[bad ? 'warning' : 'success'](bad ? '锚点已保存，但排版稿里仍没对上（这段可能被排版改写/删掉），图会放文末' : '锚点已更新，图已挪到对应段落后')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '保存失败')
  } finally {
    savingShots.value[s.id] = false
  }
}

async function removeShot(s: GzhShot) {
  try {
    await deleteGzhShot(props.articleId, s.id)
    shots.value = shots.value.filter((x) => x.id !== s.id)
    extra.value.shots = shots.value
    delete promptDrafts.value[s.id]
    ElMessage.success('已删除该条')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '删除失败')
  }
}

async function copyShotPrompt(s: GzhShot) {
  await navigator.clipboard.writeText(promptDrafts.value[s.id] || s.prompt)
  ElMessage.success('prompt 已复制')
}

function selectedCandidate(s: GzhShot): GzhShotCandidate | null {
  if (!s.candidates?.length) return null
  return s.candidates.find((c) => c.relPath === s.selected) || s.candidates[s.candidates.length - 1]
}

async function generateImage(s: GzhShot) {
  generatingShots.value[s.id] = true
  const hadError = !!s.lastError
  const isFirst = !(s.candidates?.length)
  ElMessage.info(isFirst ? '正在逐条生图，约 50-60 秒…' : hadError ? '正在重新生成，约 50-60 秒…' : '换一张，约 50-60 秒…')
  try {
    // 改过 prompt 没点保存就直接生成：先把输入框内容落库，保证用的是眼前这版
    const draft = promptDrafts.value[s.id]
    if (draft && draft !== s.prompt) {
      const sv = await updateGzhShot(props.articleId, s.id, { prompt: draft })
      if (sv.ok) replaceShot(sv.shot)
    }
    const r = await generateGzhShotImage(props.articleId, s.id)
    if (r.ok && r.shot) {
      replaceShot(r.shot)
      // 后端可能自动改写过 prompt 才过审，把生效版回填到编辑框
      if (r.autoRewritten || promptDrafts.value[s.id] !== r.shot.prompt) {
        promptDrafts.value[s.id] = r.shot.prompt
      }
      ElMessage.success(
        r.autoRewritten
          ? '原 prompt 被审核拦截，已自动改写成中性版并生图成功（见输入框）'
          : isFirst ? '图已生成，满意可「采用进正文」' : '已生成新候选'
      )
    } else {
      if (r.shot) replaceShot(r.shot) // 失败原因已持久化，卡片上常驻显示
      ElMessage.error(r.error || '生图失败，可重试')
    }
  } catch (e: any) {
    // 502 响应体里带已持久化 lastError 的 shot，同步进卡片让失败条立即出现
    const data = e?.response?.data
    if (data?.shot) replaceShot(data.shot)
    ElMessage.error(data?.error || '生图失败，可重试')
  } finally {
    generatingShots.value[s.id] = false
  }
}

async function chooseCandidate(s: GzhShot, relPath: string) {
  if (s.selected === relPath) return
  try {
    const r = await selectGzhShotCandidate(props.articleId, s.id, relPath)
    if (r.ok) {
      replaceShot(r.shot)
      await load() // 已采用时后端会重渲染成品，刷新预览
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '切换候选失败')
  }
}

async function toggleAdopt(s: GzhShot) {
  const next = !s.adopted
  try {
    const r = await adoptGzhShot(props.articleId, s.id, next)
    if (r.ok && r.shot) {
      replaceShot(r.shot)
      await load() // 重新拉取含最新 layoutHtml 的版本
      wechatMode.value = 'layout'
      if (next) {
        const unmatched = r.merged?.unmatched?.length || 0
        ElMessage.success(unmatched ? `已采用 ${unmatched} 张锚点没对上、已放文末` : '已采用进正文，看下方成品预览')
      } else {
        ElMessage.success('已移出正文')
      }
    } else {
      ElMessage.error(r.error || '操作失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '操作失败')
  }
}

function replaceShot(shot: GzhShot) {
  const idx = shots.value.findIndex((x) => x.id === shot.id)
  if (idx >= 0) shots.value[idx] = shot
  extra.value.shots = shots.value
}

async function runAutoLayout() {
  autoLayouting.value = true
  ElMessage.info('AI 正在逐件装配排版，约 7-9 分钟，主稿越长越慢，可先处理别的事…')
  try {
    const r = await autoLayoutGzhApi(props.articleId)
    if (r.ok) {
      await load()
      wechatMode.value = 'layout'
      ElMessage.success(`排版完成（${r.componentCount} 个组件，${r.leafCount} 处包裹），检查后可推草稿`)
    } else {
      ElMessage.error(r.error || 'AI 排版失败，可重试')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || 'AI 排版失败，可重试')
  } finally {
    autoLayouting.value = false
  }
}

// 先把封面存到本篇（只存档、不推送）；之后推送不再要选文件
async function beforeUploadCover(file: File) {
  coverSaving.value = true
  try {
    const r = await uploadWxmpCover(props.articleId, file)
    if (r.ok && r.cover) {
      coverMeta.value = r.cover
      extra.value.cover = r.cover
      ElMessage.success('封面已保存，之后可一键推送')
    } else {
      ElMessage.error('封面保存失败')
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '封面保存失败')
  } finally {
    coverSaving.value = false
  }
  return false // 阻止 el-upload 自动上传
}

async function removeCover() {
  try {
    await ElMessageBox.confirm('删除本篇已存封面？', '删除封面', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    })
  } catch { return }
  try {
    await deleteWxmpCover(props.articleId)
    coverMeta.value = null
    delete extra.value.cover
    ElMessage.success('已删除封面')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '删除失败')
  }
}

// ===== AI 封面工坊操作 =====
async function genCoverPlan() {
  coverPlanLoading.value = true
  try {
    const r = await generateCoverPlan(props.articleId)
    if (!r.ok) throw new Error(r.error || '生成失败')
    coverStudio.value = r.state
    coverPlanDraft.value = { ...r.state.plan }
    ElMessage.success('封面方案已出，可改文案，再生背景')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '生成封面方案失败')
  } finally { coverPlanLoading.value = false }
}

// 把输入框里的草稿静默同步到后端；生背景/合成前自动调用，省掉「先点保存文案」这一步。
// 返回 false 表示保存失败，调用方应中止后续动作。
async function syncPlanDraft(silent = false): Promise<boolean> {
  if (!coverStudio.value) return false
  try {
    const r = await saveCoverPlan(props.articleId, { ...coverPlanDraft.value })
    coverStudio.value = r.state
    coverPlanDraft.value = { ...r.state.plan }
    if (!silent) ElMessage.success('文案已保存')
    return true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '文案保存失败')
    return false
  }
}

async function savePlanDraft() {
  coverPlanSaving.value = true
  try { await syncPlanDraft(false) } finally { coverPlanSaving.value = false }
}

async function genArt(k: CoverArtKey) {
  if (!coverStudio.value) return
  coverBusy.value[k] = true
  try {
    // 画面 prompt 可能刚改过，先同步再拿去生图
    if (!(await syncPlanDraft(true))) return

    const r = await generateCoverArt(props.articleId, k)
    if (!r.ok) throw new Error(r.error || '生背景失败')
    coverStudio.value = r.state
    ElMessage.success(`${COVER_LABEL[k]} 背景已出，点「合成」排标题`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '生背景失败')
  } finally { coverBusy.value[k] = false }
}

async function renderOne(k: CoverArtKey) {
  if (!coverStudio.value) return
  coverRendering.value = k
  try {
    // 关键：先把用户在框里改的标题/文案落库，否则合成仍用旧存档（表现为「点了没反应」）
    if (!(await syncPlanDraft(true))) return
    const r = await renderCover(props.articleId, k)
    if (!r.ok) throw new Error(r.error || '合成失败')
    if (r.state) coverStudio.value = r.state
    ElMessage.success(`${COVER_LABEL[k]} 已合成`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '合成失败')
  } finally { coverRendering.value = '' }
}

async function renderAll() {
  if (!coverStudio.value) return
  coverRenderingAll.value = true
  try {
    if (!(await syncPlanDraft(true))) return
    const r = await renderCover(props.articleId)
    if (!r.ok) throw new Error(r.error || '合成失败')
    if (r.state) coverStudio.value = r.state
    const done = 4 - (r.skipped?.length || 0)
    ElMessage.success(`已合成 ${done} 张${r.skipped?.length ? '，其余缺背景已跳过' : ''}`)
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '合成失败')
  } finally { coverRenderingAll.value = false }
}

async function chooseOne(k: CoverArtKey) {
  if (!latestArt(k)) return
  const usingArt = !latestRender(k)
  try {
    const r = await chooseCover(props.articleId, k)
    if (!r.ok || !r.cover) throw new Error(r.error || '设置失败')
    if (coverStudio.value) coverStudio.value = { ...coverStudio.value, chosen: k }
    coverMeta.value = {
      relPath: r.cover.relPath, url: cacheBust(r.cover.url),
      filename: r.cover.filename,
      bytes: r.cover.bytes, contentType: r.cover.contentType || 'image/jpeg', createdAt: r.cover.createdAt,
    }
    extra.value.cover = coverMeta.value
    ElMessage.success(
      usingArt ? `已直接用背景图设为封面：${COVER_LABEL[k]}（未经模板合成、无标题文字）` : `已设为公众号封面：${COVER_LABEL[k]}`
    )
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || e?.message || '设置封面失败')
  }
}
function cacheBust(u: string) { return u + (u.includes('?') ? '&' : '?') + 't=' + Date.now() }

// 一键推送：有已存封面就直接进草稿箱，不再弹选图
async function pushDraft() {
  if (!coverMeta.value) {
    ElMessage.warning('还没设置封面，先点「上传封面」存一张，之后就能一键推送')
    return
  }
  pushing.value = true
  ElMessage.info('正在推送草稿箱…')
  try {
    const r = await pushWxmpDraft(props.articleId, null, { title: title.value })
    if (r.ok) ElMessage.success(`已推入公众号草稿箱（mediaId: ${r.mediaId}）`)
    else ElMessage.error(r.error || '推送失败')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '推送失败')
  } finally {
    pushing.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await saveChannelVersion(props.articleId, props.channel, {
      title: title.value, content: content.value, extra: extra.value,
    })
    ElMessage.success('已保存')
  } finally { saving.value = false }
}

async function openAdapt() {
  adapting.value = true
  try {
    ElMessage.info('正在生成渠道版本，主稿越长越慢…')
    const r = await adaptArticle(props.articleId, { channels: [props.channel] })
    if (r.ok) { await load(); ElMessage.success('生成完成，检查后可手动微调'); emit('adapted') }
    else ElMessage.error(r.error || '生成失败，可重试')
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.error || '生成失败，可重试')
  } finally { adapting.value = false }
}

async function copyPlain() {
  const text = props.channel === 'xhs'
    ? `${title.value}\n\n${content.value}${xhsExtra.value?.tags?.length ? `\n\n${xhsExtra.value.tags.map((t: string) => `#${t}`).join(' ')}` : ''}`
    : content.value
  await navigator.clipboard.writeText(text)
  ElMessage.success('已复制，去平台粘贴吧')
}

async function copyTags() {
  const tags = (xhsExtra.value?.tags || []).map((t: string) => `#${t}`).join(' ')
  await navigator.clipboard.writeText(tags)
  ElMessage.success('标签已复制')
}

async function copyRich() {
  const richHtml = layoutHtml.value || renderMarkdown(content.value)
  const plain = content.value
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([richHtml], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' }),
      }),
    ])
    ElMessage.success(layoutHtml.value ? '成品已复制，粘贴到公众号编辑器即可' : '富文本已复制，粘贴到公众号编辑器即可')
  } catch {
    await navigator.clipboard.writeText(plain)
    ElMessage.success('浏览器不支持富文本复制，已复制源文')
  }
}
</script>

<style scoped lang="scss">
.cv-pane { display: flex; flex-direction: column; gap: 8px; }
.cv-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cv-bar-primary .cv-title-input { flex: 1 1 auto; min-width: 220px; max-width: none; }
.cv-cover-thumb {
  width: 46px; height: 46px; border-radius: 4px; overflow: hidden; flex-shrink: 0;
  border: 1px solid var(--pf-border); background: #f3f2ec;
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
}
.cv-bar-actions { justify-content: space-between; }
.cv-group { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cv-group-right { margin-left: auto; }
.cv-hint { font-size: 12px; color: var(--pf-text-3); }
.cv-layout { border: 1px solid var(--pf-border); border-radius: var(--pf-r-md); overflow: hidden; }
.cv-layout-frame { width: 100%; height: 640px; border: 0; display: block; background: #f3f2ec; }
/* 交付条：预览下方的封面入口 + 复制 + 推送 */
.cv-deliver {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  flex-wrap: wrap; padding: 10px 12px;
  border: 1px solid var(--pf-border); border-radius: var(--pf-r-md);
  background: var(--pf-primary-50, #f6f8ff);
}
.cv-cover-entry {
  display: inline-flex; align-items: center; gap: 9px; cursor: pointer;
  border: 1px dashed var(--pf-border-strong); background: #fff;
  border-radius: 8px; padding: 4px 10px 4px 4px; transition: border-color .15s;
  &:hover { border-color: var(--pf-primary); }
}
.cv-cover-none {
  width: 46px; height: 46px; border-radius: 4px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: var(--pf-text-3); background: #f3f2ec;
}
.cv-cover-txt { font-size: 12.5px; color: var(--pf-text-2); white-space: nowrap; }
.cv-deliver-right { display: flex; gap: 8px; align-items: center; margin-left: auto; flex-wrap: wrap; }

/* 右侧浮动素材入口（配图/封面） */
.cv-fab-stack {
  position: fixed; right: 18px; top: 50%; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 10px; z-index: 2200; transition: right .22s ease;
}
.cv-fab-stack.shifted { right: 540px; }
@media (max-width: 640px) { .cv-fab-stack.shifted { right: 18px; } }
.cv-fab {
  position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; width: 52px; min-height: 54px; padding: 6px 0;
  border: 1px solid var(--pf-border-strong, #d8d6cc);
  border-radius: 14px; background: #fff; color: var(--pf-text-2);
  cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.10); transition: all .15s;
  &:hover { color: var(--pf-primary, #ed7b2f); border-color: var(--pf-primary, #ed7b2f); transform: translateY(-1px); }
  &.on { color: #fff; background: var(--pf-primary, #ed7b2f); border-color: var(--pf-primary, #ed7b2f); }
}
.cv-fab-label { font-size: 11px; line-height: 1; }
.cv-fab-badge {
  position: absolute; top: -6px; right: -6px; min-width: 18px; height: 18px; padding: 0 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 700; color: #fff; background: var(--pf-primary, #ed7b2f);
  border-radius: 9px; border: 2px solid #fff; box-sizing: content-box;
}
.cv-fab-dot { position: absolute; top: -3px; right: -3px; width: 10px; height: 10px; border-radius: 50%; background: #22c55e; border: 2px solid #fff; box-sizing: content-box; }

/* 抽屉内部（tab/工具条/滚动体）；高度链在全局块（teleport 到 body） */
.cv-drawer-tabs { display: flex; flex-direction: column; height: 100%; }
:deep(.cv-drawer-tabs > .el-tabs__header) { margin: 0; padding: 0 14px; background: #fff; border-bottom: 1px solid var(--pf-border, #e6e4dc); flex-shrink: 0; }
.cv-dtab-label { display: inline-flex; align-items: center; gap: 5px; }
.cv-dtab-count { font-style: normal; font-size: 10.5px; font-weight: 700; color: var(--pf-primary, #ed7b2f); }
.cv-dtab-ok { font-style: normal; font-size: 11px; color: #22c55e; }
.cv-drawer-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--pf-border, #eee); background: #faf9f5; flex-shrink: 0; }
.cv-drawer-tip { flex: 1 1 100%; font-size: 11.5px; color: var(--pf-text-3); line-height: 1.5; }
.cv-drawer-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 14px 24px; background: var(--pf-primary-50, #faf8f2); gap: 10px; }
.xhs-extra {
  display: flex; flex-direction: column; gap: 10px;
  background: var(--pf-primary-50); border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-md); padding: 10px 12px;
}
.xe-label { font-size: 11.5px; font-weight: 600; color: var(--pf-text-2); margin-bottom: 5px; }
.xe-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.xe-chip {
  font-size: 12px; padding: 3px 10px; border-radius: 12px;
  background: #fff; border: 1px solid var(--pf-border-strong);
  cursor: pointer; color: var(--pf-text-1);
  &:hover { border-color: var(--pf-primary); color: var(--pf-primary); }
}
.xe-tags { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.xe-cover {
  font-size: 15px; font-weight: 700; color: var(--pf-text-1);
  background: #fff; border-radius: 8px; padding: 8px 12px; display: inline-block;
}
:deep(.cv-textarea textarea) { font-family: inherit; line-height: 1.75; }

/* 配图方案区（抽屉内，滚动体样式见 .cv-drawer-body） */
.gs-note { font-size: 12px; color: var(--pf-text-3); line-height: 1.7; background: #fff; border: 1px dashed var(--pf-border-strong); border-radius: 8px; padding: 8px 10px; }
.gs-card {
  background: #fff; border: 1px solid var(--pf-border);
  border-radius: var(--pf-r-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
}
.gs-card-head { display: flex; align-items: center; gap: 8px; }
.gs-no { font-family: var(--pf-font-mono, monospace); font-size: 12px; font-weight: 700; color: var(--pf-primary); }
.gs-anchor { font-size: 12.5px; font-weight: 600; color: var(--pf-text-1); }
.gs-del { margin-left: auto; }
.gs-row { display: flex; gap: 8px; font-size: 12.5px; line-height: 1.65; }
.gs-k { flex: 0 0 64px; color: var(--pf-text-3); font-size: 11.5px; padding-top: 1px; }
.gs-v { color: var(--pf-text-1); flex: 1; }
.gs-muted { color: var(--pf-text-2); }
.gs-anchor-text { font-family: var(--pf-font-mono, monospace); font-size: 12px; color: var(--pf-text-2); white-space: pre-wrap; }
.gs-anchor-row { flex-direction: column; gap: 4px; }
.gs-anchor-edit { display: flex; gap: 6px; align-items: center; }
.gs-anchor-input { flex: 1; }
:deep(.gs-anchor-input .el-input__wrapper) { padding: 2px 8px; }
:deep(.gs-anchor-input .el-input__inner) { font-size: 12px; line-height: 1.55; font-family: inherit; }
.gs-place {
  display: flex; align-items: flex-start; gap: 5px;
  font-size: 11.5px; line-height: 1.55; border-radius: 6px; padding: 6px 9px;
}
.gs-place.ok { background: #eef8ee; border: 1px solid #bfe3c0; color: #2f7d3a; }
.gs-place.bad { background: #fdf3e2; border: 1px solid #f0d39a; color: #9c6f28; }
.gs-place svg { flex-shrink: 0; margin-top: 2px; }
.gs-prompt-row { flex-direction: column; gap: 4px; }
.gs-card-foot { display: flex; gap: 8px; margin-top: 2px; flex-wrap: wrap; }
:deep(.gs-prompt-input textarea) { font-size: 12px; line-height: 1.65; font-family: inherit; }

/* 候选图预览 */
.gs-img-area { display: flex; flex-direction: column; gap: 8px; }
.gs-thumb-wrap { position: relative; border: 1px solid var(--pf-border-strong, #bfc1b7); border-radius: 6px; overflow: hidden; background: #fff; }
.gs-thumb { display: block; width: 100%; height: auto; }
.gs-thumb-size { position: absolute; right: 6px; bottom: 6px; font-size: 10px; font-family: var(--pf-font-mono, monospace); color: #fff; background: rgba(0,0,0,0.55); padding: 1px 6px; border-radius: 8px; }
.gs-cand-strip { display: flex; gap: 6px; flex-wrap: wrap; }
.gs-cand { width: 64px; height: 38px; border-radius: 4px; overflow: hidden; border: 2px solid transparent; cursor: pointer; opacity: 0.65; background: #fff; }
.gs-cand img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gs-cand:hover { opacity: 1; }
.gs-cand.on { border-color: var(--pf-primary, #ed7b2f); opacity: 1; }

/* 生图失败常驻条 */
.gs-fail {
  border: 1px solid #f0bcb4; background: #fdf3f1; border-radius: 6px;
  padding: 7px 10px; display: flex; flex-direction: column; gap: 3px;
}
.gs-fail-head { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: #c4412b; }
.gs-fail-time { margin-left: auto; font-weight: 400; font-size: 10.5px; color: #b08077; font-family: var(--pf-font-mono, monospace); }
.gs-fail-msg { font-size: 11.5px; line-height: 1.55; color: #8f3a2b; word-break: break-all; }
.gs-fail-hint { font-size: 11.5px; line-height: 1.6; color: #9c6f28; background: #fbf3e2; border-radius: 4px; padding: 5px 8px; }

/* AI 封面工坊 */
.cs-plan { background: #fff; border: 1px solid var(--pf-border, #e6e4dc); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.cs-plan-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.cs-plan-row.cs-cols { align-items: stretch; }
.cs-plan-row > label { font-size: 12px; color: var(--pf-text-3, #8a8578); white-space: nowrap; }
.cs-field { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 220px; }
.cs-field > label { font-size: 12px; color: var(--pf-text-3, #8a8578); }
.cs-field .cs-sub { margin-top: 4px; }
.cs-issue { width: 80px; }
.cs-kicker { width: 200px; }
.cs-en { flex: 1; min-width: 140px; }
.cs-plan-foot { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.cs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cs-cell { background: #fff; border: 1px solid var(--pf-border, #e6e4dc); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.cs-cell-head { display: flex; align-items: center; justify-content: space-between; }
.cs-cell-name { font-size: 12px; font-weight: 600; color: var(--pf-text-1, #2b2924); }
.cs-canvas { position: relative; width: 100%; aspect-ratio: 21 / 9; background: #141416; border-radius: 6px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.cs-cell:nth-child(2) .cs-canvas,
.cs-cell:nth-child(4) .cs-canvas { aspect-ratio: 1 / 1; }
.cs-render, .cs-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #0c0c0e; display: block; }
.cs-art { object-fit: cover; opacity: 0.9; }
.cs-empty { color: #9a948a; font-size: 12px; }
.cs-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; }
.cs-spin { width: 26px; height: 26px; border: 3px solid rgba(255,255,255,0.3); border-top-color: #ed7b2f; border-radius: 50%; animation: cs-rot 0.8s linear infinite; }
@keyframes cs-rot { to { transform: rotate(360deg); } }
.cs-cell-foot { display: flex; gap: 6px; flex-wrap: wrap; }
.cs-cell-foot .el-button { margin-left: 0; }
@media (max-width: 720px) { .cs-grid { grid-template-columns: 1fr; } }
</style>

<!-- el-drawer teleport 到 body，需非 scoped 样式：无遮罩右侧并排抽屉 -->
<style lang="scss">
.cv-studio-drawer.el-drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 520px; max-width: 94vw;
  height: 100% !important;
  margin: 0; border-radius: 14px 0 0 14px;
  box-shadow: -10px 0 36px rgba(0,0,0,0.16);
  background: #faf8f2;
  z-index: 2100;
}
.cv-studio-drawer .el-drawer__body { padding: 0; height: 100%; overflow: hidden; display: flex; flex-direction: column; }
.cv-studio-drawer .cv-drawer-tabs { height: 100%; }
.cv-studio-drawer .el-tabs__content { flex: 1 1 auto; min-height: 0; }
.cv-studio-drawer .el-tab-pane { height: 100%; display: flex; flex-direction: column; }
@media (max-width: 640px) {
  .cv-studio-drawer.el-drawer { width: 100% !important; max-width: 100%; border-radius: 0; }
}
</style>
