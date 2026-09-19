// ============================================
// 无头需求同步（ProtoForge）
// 原型站点上业务类意见，不经过对话 UI，后台直接让需求搭档把规则同步进需求文档。
// 非流式、只带 propose/revise 两个工具，落库后打回「待确认」由 PM 复核。
// ============================================

import OpenAI from 'openai';
import { getConfig, getModelForRole } from '../config/index.js';
import { reqAdvisor } from '../agents/reqAdvisor.js';
import { listRequirements, createRequirement, updateRequirement, ensureParentModule, getAnnotation, clearAnnotationNeedsReq, getPrototype, upsertPrototype, snapshotRequirement } from '../store/database.js';
import { attachRequirementSnapshots } from './prototypeGenerator.js';
import { v4 as uuidv4 } from 'uuid';

export interface SyncResult {
  ok: boolean
  error?: string
  revised: Array<{ id: string; title: string }>
  created: Array<{ id: string; title: string }>
  answer: string
}

interface SyncAnnotation {
  id: string
  page_title: string
  target_label: string
  target_kind: string
  content: string
  author: string
}

/**
 * 把业务类评审意见同步进需求文档（无头：无对话、无 SSE）。
 * @param annotationIds 要同步的标注 id（needs_req=1 的业务类意见）
 */
export async function syncRequirementsFromAnnotations(
  projectId: string,
  annotationIds: string[],
): Promise<SyncResult> {
  const annots: SyncAnnotation[] = annotationIds
    .map((id) => getAnnotation(id))
    .filter((a) => a && a.project_id === projectId)
    .map((a) => ({
      id: a.id,
      page_title: a.page_title || '',
      target_label: a.target_label || '',
      target_kind: a.target_kind || '',
      content: a.content || '',
      author: a.author || '',
    }));

  if (annots.length === 0) {
    return { ok: false, error: '没有待同步的业务意见', revised: [], created: [], answer: '' };
  }

  const existing = listRequirements(projectId);
  const reqList = existing.length
    ? existing
        .map((r) => {
          const kind = r.kind === 'page' ? '页面' : '模块';
          const parent = r.parent_id ? existing.find((m) => m.id === r.parent_id) : null;
          return `「${r.title}」(id=${r.id}, ${kind}${parent ? `, 归属模块=${parent.title}` : ''}, 状态=${r.status === 'confirmed' ? '已确认' : '待确认'})`;
        })
        .join('、')
    : '（暂无需求）';

  const opinionText = annots
    .map((a, i) => {
      const kindMap: Record<string, string> = { field: '字段', action: '按钮', icon: '图标', section: '区块', page: '整页' };
      const kind = kindMap[a.target_kind] || '区块';
      const tgt = a.target_label ? `（${kind}：${a.target_label}）` : '';
      return `${i + 1}. [页面「${a.page_title}」${tgt}] ${a.content}${a.author ? ` —— ${a.author}` : ''}`;
    })
    .join('\n');

  // 只保留 propose / revise 两个需求编辑工具
  const editTools = reqAdvisor.tools.filter((t) =>
    t.function?.name === 'propose_requirement' || t.function?.name === 'revise_requirement'
  );

  const cfg = getConfig();
  const client = new OpenAI({ apiKey: cfg.llm.apiKey, baseURL: cfg.llm.baseUrl });
  const model = getModelForRole('receptionist');

  const messages: any[] = [
    { role: 'system', content: reqAdvisor.systemPrompt },
    {
      role: 'system',
      content:
        '当前需求清单已有：' + reqList +
        '。修订已有需求用 revise_requirement（带对应 id、提交完整 doc_md），清单里没有对应模块才用 propose_requirement 新建。修订后需求会打回「待确认」由 PM 复核，这是预期行为。',
    },
    {
      role: 'user',
      content:
        `原型已经按下面这些评审意见改好了，现在请把这些【业务规则/数据口径】同步进需求文档，让需求文档跟原型保持一致。\n` +
        `合理的就修订（revise_requirement，给完整文档），如果某条跟现有规则冲突或不合理，就不用改。\n\n` +
        opinionText,
    },
  ];

  const revised: Array<{ id: string; title: string }> = [];
  const created: Array<{ id: string; title: string }> = [];
  let answer = '';

  for (let round = 0; round < 6; round++) {
    const resp = await client.chat.completions.create({
      model,
      messages,
      tools: editTools as any,
      temperature: 0.3,
    });
    const msg = resp.choices[0]?.message;
    if (!msg) break;
    messages.push(msg);

    const toolCalls = msg.tool_calls || [];
    if (toolCalls.length === 0) {
      answer = msg.content || '';
      break;
    }

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args: any = {};
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* ignore */ }
      let toolResult = '';

      if (name === 'propose_requirement') {
        const title = String(args.title || '').trim();
        const docMd = String(args.doc_md || '').trim();
        const kind = String(args.kind || 'module').trim() === 'page' ? 'page' : 'module';
        const moduleId = String(args.module_id || '').trim();
        const moduleTitle = String(args.module_title || '').trim();
        if (!title || !docMd) {
          toolResult = '沉淀失败：title 或 doc_md 为空。';
        } else {
          let parentId: string | null = null;
          let createdModuleTitle = '';
          if (kind === 'page') {
            const { parentId: pid, createdModule } = ensureParentModule(projectId, {
              moduleId: moduleId || undefined,
              moduleTitle: moduleTitle || undefined,
              fallbackTitle: title.replace(/(页面|登记|列表|详情|工作台|看板)$/, ''),
            });
            parentId = pid;
            if (createdModule) createdModuleTitle = createdModule.title;
          }
          const req = createRequirement({
            id: uuidv4(), projectId, title, kind, parentId, docMd,
            sourceConversationId: null, status: 'proposed',
          }) as { id: string; title: string };
          created.push({ id: req.id, title: req.title });
          toolResult =
            `已新建${kind === 'page' ? '页面' : '模块'}需求「${title}」(id=${req.id})，状态：待确认。` +
            (createdModuleTitle ? ` 归属模块「${createdModuleTitle}」已自动创建。` : '');
        }
      } else if (name === 'revise_requirement') {
        const reqId = String(args.requirementId || '').trim();
        const docMd = String(args.doc_md || '').trim();
        const title = String(args.title || '').trim();
        const target = reqId ? listRequirements(projectId).find((r) => r.id === reqId) : null;
        if (!target) {
          toolResult = `修订失败：找不到 id=${reqId} 的需求，请从清单 id 中选择，或改用 propose_requirement 新建。`;
        } else if (!docMd) {
          toolResult = '修订失败：doc_md 为空。';
        } else {
          const updated = updateRequirement(reqId, {
            docMd,
            ...(title ? { title } : {}),
            status: 'proposed',
          }, 'ai:requirementSync') as { id: string; title: string };
          snapshotRequirement(reqId, 'ai', { actor: 'ai:requirementSync', note: '原型意见同步进文档' });
          revised.push({ id: updated.id, title: updated.title });
          toolResult = `已修订需求「${updated.title}」(id=${updated.id})，状态打回待确认。`;
        }
      } else {
        toolResult = `工具 ${name} 在无头同步里不可用，只用 propose_requirement / revise_requirement。`;
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
    }
  }

  // 同步成功：把这些业务意见的 needs_req 标记清掉并关闭
  for (const a of annots) {
    clearAnnotationNeedsReq(a.id);
  }

  // 需求文档已修订：刷新已生成原型里的需求快照，保持原型自带文档最新
  const proto = getPrototype(projectId);
  if (proto && proto.status === 'ready' && proto.spec_json) {
    try {
      const spec = typeof proto.spec_json === 'string' ? JSON.parse(proto.spec_json) : proto.spec_json;
      attachRequirementSnapshots(spec, projectId);
      upsertPrototype(projectId, { specJson: JSON.stringify(spec), status: 'ready', error: null });
    } catch { /* 原型刷新失败不影响同步结果 */ }
  }

  return { ok: true, revised, created, answer };
}
