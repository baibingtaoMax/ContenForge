// ============================================
// 微信公众号草稿服务
// 成品 HTML →（正文图片转 mp 域名）→ 封面永久素材 → draft/add 进草稿箱。
// ============================================

import { wxmpGet, wxmpPostJson, wxmpPostForm } from './client.js';

export interface PushDraftInput {
  title: string;
  author?: string;
  digest?: string;        // 摘要；不传微信会自动取正文前 54 字
  content: string;        // 成品 HTML（橄榄手记 section 片段）
  contentSourceUrl?: string;
  cover: {
    filename: string;
    contentType: string;
    data: Buffer;
  };
}

export interface PushDraftResult {
  ok: boolean;
  mediaId?: string;       // 草稿 media_id
  error?: string;
  detail?: any;
}

/**
 * 把正文 HTML 里的外链 <img> 上传换成 mp.weixin.qq.com 域名地址。
 * 草稿正文只允许微信域名图片，外链会被拦。仅替换 http(s) 图，已是 mp 域名的跳过。
 */
async function rewriteContentImages(html: string): Promise<string> {
  const srcs = new Set<string>();
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (/^https?:\/\//i.test(u) && !/mmbiz\.qpic\.cn/i.test(u)) srcs.add(u);
  }
  const map = new Map<string, string>();
  for (const u of srcs) {
    try {
      const res = await fetch(u);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const ext = ct.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
      const form = new FormData();
      form.append('media', new Blob([buf], { type: ct }), `image.${ext}`);
      const up = await wxmpPostForm('/cgi-bin/media/uploadimg', form);
      if (up.url) map.set(u, up.url);
    } catch {
      // 单图失败不阻断，保留原地址（草稿里可能需手动处理）
    }
  }
  if (!map.size) return html;
  return html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (all, p1, u, p3) =>
    map.has(u) ? `${p1}${map.get(u)}${p3}` : all
  );
}

/** 上传封面为永久图片素材，返回 thumb_media_id */
async function uploadCover(cover: PushDraftInput['cover']): Promise<string> {
  const form = new FormData();
  form.append('media', new Blob([cover.data], { type: cover.contentType }), cover.filename);
  const r = await wxmpPostForm('/cgi-bin/material/add_material?type=image', form);
  if (!r.media_id) throw new Error(`封面永久素材上传失败: ${JSON.stringify(r)}`);
  return r.media_id as string;
}

export async function pushDraft(input: PushDraftInput): Promise<PushDraftResult> {
  const content = await rewriteContentImages(input.content);
  const thumbMediaId = await uploadCover(input.cover);

  const article = {
    title: input.title,
    author: input.author || '',
    digest: input.digest || '',
    content,
    content_source_url: input.contentSourceUrl || '',
    thumb_media_id: thumbMediaId,
    need_open_comment: 0,
    only_fans_can_comment: 0,
  };
  const r = await wxmpPostJson('/cgi-bin/draft/add', { articles: [article] });
  if (r.errcode) return { ok: false, error: `draft/add 失败 ${r.errcode}: ${r.errmsg}`, detail: r };
  return { ok: true, mediaId: r.media_id };
}
