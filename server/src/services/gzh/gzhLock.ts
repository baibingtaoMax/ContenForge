// ============================================
// 公众号 wechat extra_json 每篇文章串行锁
// --------------------------------------------
// wechat 渠道版本的 extra_json 是单条 JSON 行，配图(shots)、封面(cover)、
// 排版(layoutHtml) 的变更是「读整条 → 改一个字段 → 写整条」。逐条生图耗时
// 50-60s，用户常连点多张 / 同时设封面，并发请求各拿旧快照、后写覆盖先写。
// 所有对同一篇文章 extra_json 的变更都排队执行，从根上消除该竞态。
// ============================================

const gzhLocks = new Map<string, Promise<unknown>>();

export function withGzhLock<T>(articleId: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = gzhLocks.get(articleId) || Promise.resolve();
  let next!: Promise<T>;
  next = prev
    .then(() => fn())
    .finally(() => {
      // 仅当队尾仍是自己时清理，避免 Map 无限增长；后到的任务会顶掉该键
      if (gzhLocks.get(articleId) === next) gzhLocks.delete(articleId);
    });
  gzhLocks.set(articleId, next);
  return next;
}
