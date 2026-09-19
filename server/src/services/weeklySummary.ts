// ============================================
// 周报 AI 概述：只写「项目位置 + 本周收口的业务结论」
// 绝不允许：编造下周计划/建议、罗列操作流水、凑「无阻塞」废话
// 待拍板/待收口是确定性数据，由前端渲染，不经过 AI
// ============================================

import OpenAI from 'openai';
import { getConfig, getPrototypeModel } from '../config/index.js';
import type { WeeklyReport } from './weeklyReport.js';

export type WeeklyAudience = 'boss' | 'client';

const AUDIENCE_BRIEF: Record<WeeklyAudience, string> = {
  boss: `读者是老板。只写两件事：
① 项目位置：需求设计收口到什么程度（必须用带分母的说法，如「4 个模块已确认 3 个」，不能只说「确认了 1 条」）；
② 本周收口的业务结论：用产品/业务语言讲定了什么事（依据「新拍板设计决策」的结论），不要讲存版本、改文档、提了几条意见这类操作动作。
2~4 句话。禁止写「下周计划/建议/下周重点」（系统没有计划数据，写了就是编造）；禁止「整体平稳」「无阻塞」「无积压」这类没有信息量的空话；本周事少就只写一两句，不许凑长度。`,
  client: `读者是客户/甲方，交付汇报口径。按顺序写三件事：
① 项目整体确认进度（必须带分母，如「12 个模块已确认 9 个」）；
② 本期定稿了什么业务内容（用业务语言讲定了什么，不要讲改文档、存版本、提了几条意见这类操作动作）；
③ 若事实中仍有待确认需求，结尾用一句话引导客户查看后附的「待贵方确认事项」清单（数量以事实为准）；没有待确认项就不写这句。
2~4 句，客观专业。不提及内部打回、内部评审意见、操作流水；禁止写后续计划或时间承诺；禁止空话凑长度；本周事少就只写一两句。`,
};

/** 把确定性数据压成喂给模型的紧凑事实（不传全文，控 token） */
function factsDigest(report: WeeklyReport): string {
  const s = report.stats;
  const snap = report.snapshot;
  const L: string[] = [];

  // 全景分母（位置感的来源）
  L.push(
    `【项目盘子】模块共 ${snap.totalModules} 个（已确认 ${snap.confirmedModules}），` +
      `页面共 ${snap.totalPages} 个（已确认 ${snap.confirmedPages}）。` +
      (snap.pending.length
        ? `仍待确认：${snap.pending
            .slice(0, 12)
            .map((p) => `${p.kind === 'page' ? '页面' : '模块'}《${p.title}》`)
            .join('、')}`
        : '模块/页面已全部确认。')
  );

  L.push(
    `【本周操作流水（供参考，不要原样照搬这些数字和措辞）】` +
      `新增模块 ${s.newModules}、新增页面 ${s.newPages}、确认 ${s.confirmed}、打回 ${s.rejected}、` +
      `文档修订 ${s.revised}、转正 ${s.promoted}、原型新意见 ${s.newAnnotations}（未处理 ${s.openAnnotations}）。`
  );

  // 业务结论的主来源：设计决策的 conclusion
  if (report.decisions.length) {
    L.push(
      `【本周新拍板设计决策（写综述的主要素材，请用业务语言转述结论，不要照抄编号）】\n` +
        report.decisions
          .slice(0, 10)
          .map((d, i) => `${i + 1}. ${d.topic}：${d.conclusion || '（无结论描述）'}`)
          .join('\n')
    );
  }

  if (report.statusChanges.length) {
    // 只报「本周确认且当前仍处于已确认」的需求——中途确认又被取消的不算定稿
    const pendingIds = new Set(snap.pending.map((p) => p.id));
    const conf = report.statusChanges.filter(
      (x) => x.toStatus === 'confirmed' && !pendingIds.has(x.requirementId)
    );
    const undone = report.statusChanges.filter(
      (x) => x.toStatus === 'confirmed' && pendingIds.has(x.requirementId)
    );
    if (conf.length)
      L.push(`本周确认且当前仍已定稿的需求：${conf.map((x) => `《${x.title}》`).join('、')}`);
    if (undone.length)
      L.push(`（注意：${undone.map((x) => `《${x.title}》`).join('、')} 本周曾确认但当前已退回待确认，不要写成“已定稿”）`);
  }

  return L.join('\n\n');
}

export async function generateWeeklyOverview(
  report: WeeklyReport,
  audience: WeeklyAudience
): Promise<string> {
  const cfg = getConfig();
  if (!cfg.llm.apiKey) throw new Error('未配置模型 API Key');

  // 综述是短文本套话，走原型生成同款快模型（flash 类）；
  // 不能回落全局 ark-code-latest——那是推理模型，三句话先烧两百多 reasoning token，40~90s。
  const client = new OpenAI({ apiKey: cfg.llm.apiKey, baseURL: cfg.llm.baseUrl });
  const model = getPrototypeModel();

  const system = `你是 ProtoForge 需求工作台的周报撰写助手，根据给定的项目数据写周报开头的综述。
要求：
1. ${AUDIENCE_BRIEF[audience]}
2. 只能使用给定事实，不许编造数字、项目名、决策内容或计划；事实不足就少说。
3. 输出纯叙述，合成一个段落，不要列表、不要分节标题、不要任何小标题（禁止以“本周综述”开头）、不要寒暄。
4. 禁止元叙述：不要出现“依据给定事实”“根据数据”“整体判断为”这类描述写作过程的话。
5. 如果项目盘子和本周决策都为空，只输出一句“本周期内无需求变更。”`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `项目：${report.projectName}\n周期：${report.from.slice(0, 10)} ~ ${report.to.slice(0, 10)}\n\n${factsDigest(report)}` },
    ],
  });
  return (resp.choices[0]?.message?.content || '').trim();
}
