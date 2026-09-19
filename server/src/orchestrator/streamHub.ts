// ============================================
// 流式事件中心
// 每个运行中的对话评估对应一个 Hub：
// - 缓冲所有已发出的 SSE 事件（供刷新后回放）
// - 支持多个订阅者（原始连接 + 刷新后的续传连接）
// - 客户端断开只移除订阅者，不中止评估
// - 评估结束标记 finished，回放完缓冲后结束续传流
// ============================================

import type { SSEEvent } from '../types/index.js';

type Subscriber = (event: SSEEvent) => void;

interface Hub {
  events: SSEEvent[];
  subscribers: Set<Subscriber>;
  finished: boolean;
  createdAt: number;
}

const hubs = new Map<string, Hub>();

/** 获取或创建某个对话的事件中心 */
function getHub(key: string): Hub {
  let hub = hubs.get(key);
  if (!hub) {
    hub = { events: [], subscribers: new Set(), finished: false, createdAt: Date.now() };
    hubs.set(key, hub);
  }
  return hub;
}

/** 发出一个事件：入缓冲 + 广播给所有订阅者 */
export function emitToHub(key: string, event: SSEEvent): void {
  const hub = getHub(key);
  hub.events.push(event);
  for (const sub of hub.subscribers) {
    try {
      sub(event);
    } catch {
      /* 订阅者写入失败，忽略 */
    }
  }
}

/** 订阅：先回放已有缓冲事件，再接收实时事件；返回取消订阅函数 */
export function subscribeHub(
  key: string,
  onEvent: Subscriber,
  onDone?: () => void
): () => void {
  const hub = getHub(key);
  // 回放缓冲
  for (const e of hub.events) {
    try {
      onEvent(e);
    } catch {
      /* ignore */
    }
  }
  if (hub.finished) {
    // 已结束，回放完直接收尾
    onDone?.();
    return () => {};
  }
  hub.subscribers.add(onEvent);
  return () => {
    hub.subscribers.delete(onEvent);
  };
}

/** 标记评估结束：通知所有订阅者流结束，并在稍后清理 */
export function finishHub(key: string): void {
  const hub = hubs.get(key);
  if (!hub) return;
  hub.finished = true;
  // 真正的 done complete 事件已由 handleChat 发出，这里不再重复合成
  hub.subscribers.clear();
  // 保留缓冲 60 秒，供刚刷新的连接回放，之后清理
  setTimeout(() => {
    hubs.delete(key);
  }, 60_000);
}

/**
 * 重置某个 hub：新一轮对话开始时调用。
 * 清掉上一轮的事件缓冲和 finished 状态，避免旧事件被回放给新连接。
 */
export function resetHub(key: string): void {
  const hub = hubs.get(key);
  if (!hub) return;
  hub.events = [];
  hub.finished = false;
  hub.subscribers.clear();
}

/** 把 hub 从旧 key 迁移到新 key（新对话拿到真实 conversationId 时） */
export function migrateHub(oldKey: string, newKey: string): void {
  if (oldKey === newKey) return;
  const hub = hubs.get(oldKey);
  if (!hub) return;
  hubs.set(newKey, hub);
  hubs.delete(oldKey);
}

/** 某对话是否有正在运行的 hub */
export function isHubRunning(key: string): boolean {
  const hub = hubs.get(key);
  return !!hub && !hub.finished;
}

/** 当前所有运行中的对话 key */
export function listRunningHubs(): string[] {
  const result: string[] = [];
  for (const [key, hub] of hubs) {
    if (!hub.finished) result.push(key);
  }
  return result;
}
