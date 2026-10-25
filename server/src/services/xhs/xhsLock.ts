// ============================================
// 小红书 xhs extra_json 每篇文章串行锁
// --------------------------------------------
// 与 gzhLock 同构：cardDeck 的变更是「读整条 → 改字段 → 写整条」，
// 逐张渲染走 Chrome 截图较慢，连点/并发会拿旧快照互覆，按 articleId 排队。
// 单独成锁，不与公众号 wechat 版本互相阻塞。
// ============================================

const xhsLocks = new Map<string, Promise<unknown>>();

export function withXhsLock<T>(articleId: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = xhsLocks.get(articleId) || Promise.resolve();
  let next!: Promise<T>;
  next = prev
    .then(() => fn())
    .finally(() => {
      if (xhsLocks.get(articleId) === next) xhsLocks.delete(articleId);
    });
  xhsLocks.set(articleId, next);
  return next;
}
