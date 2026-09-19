// ============================================
// ContentForge 渠道适配服务
// 主稿（markdown）+ 主体档案 → 公众号/小红书/掘金知乎 三渠道版本
// 无头非流式 LLM 调用，结果直接落 cf_channel_versions。
// ============================================

import OpenAI from 'openai';
import { getConfig, getModelForRole } from '../config/index.js';
import {
  getArticle,
  getSubjectProfile,
  getSubjectType,
  upsertChannelVersion,
  type ChannelKey,
  type SubjectProfile,
} from '../store/contentStore.js';
import { getProjectKit, type WritingKit } from '../store/writingKitStore.js';

export interface AdaptResult {
  ok: boolean;
  error?: string;
  channels: ChannelKey[];
}

const SUBJECT_TYPE_LABEL: Record<string, string> = {
  product: '软件/实体产品',
  official_account: '公众号/账号',
  personal_ip: '个人 IP',
  service: '服务/课程',
  event: '活动',
  community: '社群',
  other: '其他推广主体',
};

interface ChannelSpec {
  key: ChannelKey;
  label: string;
  formatNote: string;
}

const CHANNEL_SPECS: ChannelSpec[] = [
  {
    key: 'wechat',
    label: '公众号',
    formatNote:
      '微信公众号富文本版本（用 Markdown 语法排版，运营者会粘贴进公众号编辑器）：\n' +
      '- 标题有点击欲但不标题党，不超过 30 字；\n' +
      '- 开头用场景/痛点/反常识钩子抓住读者，分段短小，小标题清晰；\n' +
      '- 关键结论、金句加粗，必要处用 > 引用；\n' +
      '- 文末自然带出行动指令（CTA），不生硬广告；\n' +
      '- 正文 1500-3000 字。',
  },
  {
    key: 'xhs',
    label: '小红书',
    formatNote:
      '小红书种草版本（纯文本，运营者直接粘贴）：\n' +
      '- 正文 800 字以内，前 3 行必须抓人（痛点/结果/身份共鸣）；\n' +
      '- 口语化、分点干货、适度 emoji 断行，不要广告腔和夸张宣传；\n' +
      '- 结尾一句软引导 + 相关话题标签（# 开头，5-8 个）；\n' +
      '- 必须在 JSON extra 里给 titleCandidates（3 个标题候选，每个 ≤20 字、可带 emoji）、tags（话题标签数组，不含#）、coverText（封面大字文案建议，10 字内）。',
  },
  {
    key: 'markdown',
    label: '掘金/知乎',
    formatNote:
      '掘金/知乎专业版本（Markdown）：\n' +
      '- 标题专业克制，技术/方法论向；\n' +
      '- 结构严谨：背景 → 问题 → 方案/实操 → 效果/总结，有细节、有论据，该有代码/截图的位置用占位说明标注；\n' +
      '- 作者第一人称自然带出推广主体，不硬广，价值先行；\n' +
      '- 长度按内容需要，通常 1500-2500 字，结构完整优先于堆字数。',
  },
];

function buildProfileText(profile: SubjectProfile, subjectType: string): string {
  const lines: string[] = [`- 主体类型：${SUBJECT_TYPE_LABEL[subjectType] || subjectType}`];
  if (profile.positioning) lines.push(`- 一句话定位：${profile.positioning}`);
  if (profile.audience) lines.push(`- 目标读者：${profile.audience}`);
  if (profile.pains) lines.push(`- 受众痛点：${profile.pains}`);
  if (Array.isArray(profile.sellingPoints) && profile.sellingPoints.length) {
    lines.push(`- 核心卖点：${profile.sellingPoints.join('；')}`);
  }
  if (profile.difference) lines.push(`- 差异点：${profile.difference}`);
  if (profile.cta) lines.push(`- 行动指令（CTA）：${profile.cta}${profile.ctaTarget ? `（${profile.ctaTarget}）` : ''}`);
  if (profile.tone) lines.push(`- 语气风格：${profile.tone}`);
  if (profile.notes) lines.push(`- 其他：${profile.notes}`);
  return lines.length > 1 ? lines.join('\n') : '（主体档案尚未填写，请只基于主稿内容做通用适配，不编造卖点和数据）';
}

function safeParseJson(text: string): any | null {
  try { return JSON.parse(text); } catch { /* ignore */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

/** 规范包给渠道适配用的规则文本（标题规范 + 写作语言规范 + 署名） */
function buildKitAdaptRules(kit: WritingKit | undefined, channel: ChannelKey): string {
  if (!kit) return '';
  const blocks: string[] = [];
  if (kit.title_md?.trim()) blocks.push(`### 起标题必须遵守的规范\n${kit.title_md.trim()}`);
  if (kit.writing_md?.trim()) blocks.push(`### 改写正文必须遵守的写作语言规范\n${kit.writing_md.trim()}`);
  if (kit.positioning_md?.trim()) blocks.push(`### 账号定位（保持调性一致，不必照搬全文）\n${kit.positioning_md.trim()}`);
  if (channel !== 'xhs' && kit.signoff?.trim()) {
    blocks.push(`### 文末署名\n正文末尾原样附上以下署名（不要另编口号/署名）：\n${kit.signoff.trim()}`);
  }
  if (channel === 'xhs') blocks.push('小红书版不要带文末署名/口号。');
  return blocks.length ? `## 本主体的写作规范包（优先级高于你的默认写法）\n${blocks.join('\n\n')}` : '';
}

/**
 * 为文章生成渠道版本。
 * @param channels 要生成的渠道；空/不传 = 三个全出
 */
export async function adaptArticleChannels(
  projectId: string,
  articleId: string,
  channels: ChannelKey[] = [],
  requirement = ''
): Promise<AdaptResult> {
  const article = getArticle(articleId);
  if (!article) return { ok: false, error: '文章不存在', channels: [] };
  if (article.project_id !== projectId) return { ok: false, error: '文章不属于该推广主体', channels: [] };
  if (!article.doc_md?.trim()) return { ok: false, error: '主稿还是空的，先写成稿再适配渠道', channels: [] };

  const targets = channels.length ? CHANNEL_SPECS.filter((s) => channels.includes(s.key)) : CHANNEL_SPECS;
  if (targets.length === 0) return { ok: false, error: '没有可生成的渠道', channels: [] };

  const profile = getSubjectProfile(projectId);
  const subjectType = getSubjectType(projectId);
  const profileText = buildProfileText(profile, subjectType);
  const kit = getProjectKit(projectId);

  const cfg = getConfig();
  const client = new OpenAI({ apiKey: cfg.llm.apiKey, baseURL: cfg.llm.baseUrl });
  const model = getModelForRole('receptionist');

  const done: ChannelKey[] = [];

  // 三渠道并发生成：单个渠道失败不拖垮其他渠道
  const results = await Promise.allSettled(
    targets.map(async (spec) => {
      const isXhs = spec.key === 'xhs';
      const kitRules = buildKitAdaptRules(kit, spec.key);
      const userPrompt =
        `请把下面这篇主稿适配成【${spec.label}】版本。\n\n` +
        `## 推广主体档案\n${profileText}\n\n` +
        (kitRules ? `${kitRules}\n\n` : '') +
        `## 版本要求\n${spec.formatNote}\n` +
        (requirement ? `\n## 本次额外要求\n${requirement}\n` : '') +
        `\n## 输出格式（只输出 JSON，不要多余解释）\n` +
        (isXhs
          ? `{"title":"标题","content":"正文纯文本","extra":{"titleCandidates":["...","...","..."],"tags":["..."],"coverText":"..."}}`
          : `{"title":"标题","content":"适配后的 Markdown 正文","extra":{}}`) +
        `\n\n## 主稿\n标题：${article.title}\n\n${article.doc_md}`;

      const resp = await client.chat.completions.create({
        model,
        temperature: 0.6,
        messages: [
          {
            role: 'system',
            content:
              '你是资深内容运营，擅长把同一篇主稿改写成不同平台的爆款版本。' +
              '严格基于给定主稿和主体档案，不编造主稿里没有的数据、案例和效果；只输出要求的 JSON。' +
              (kit ? '该主体挂载了写作规范包，规范与你的默认写法冲突时以规范为准。' : ''),
          },
          { role: 'user', content: userPrompt },
        ],
      });

      const raw = resp.choices[0]?.message?.content || '';
      const parsed = safeParseJson(raw);
      if (!parsed || typeof parsed.content !== 'string' || !parsed.content.trim()) {
        throw new Error(`${spec.label}版本生成失败（模型未返回有效内容），可重试`);
      }

      let outContent = String(parsed.content);
      // 规范包署名模板：模型没自己带就原样挂文末（微信/知乎长文渠道；小红书走标签不带署名）
      if (kit?.signoff?.trim() && spec.key !== 'xhs') {
        const signoff = kit.signoff.trim();
        if (!outContent.includes(signoff.slice(0, 12))) {
          outContent = `${outContent.replace(/\n+$/, '')}\n
${signoff}\n`;
        }
      }

      upsertChannelVersion(articleId, spec.key, {
        title: String(parsed.title || article.title).slice(0, 100),
        content: outContent,
        extra: isXhs && parsed.extra && typeof parsed.extra === 'object' ? (parsed.extra as Record<string, unknown>) : {},
      });
      return spec.key;
    })
  );

  const failed: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') done.push(r.value);
    else failed.push(r.reason?.message || '未知错误');
  }

  if (done.length === 0) return { ok: false, error: failed[0] || '全部渠道生成失败', channels: [] };
  if (failed.length > 0) return { ok: false, error: `部分渠道失败：${failed.join('；')}`, channels: done };
  return { ok: true, channels: done };
}
