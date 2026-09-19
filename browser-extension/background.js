// MV3 service worker：API 代理（绕开页面 CORS/混合内容）+ 按需注入 content script

const DEFAULT_PF = 'http://localhost:3100';

async function pfApi(pfBase, path, method, body) {
  const res = await fetch(pfBase + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body || undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

// content script 的所有 API 请求走这里
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'pf-api') {
    pfApi(msg.pfBase || DEFAULT_PF, msg.path, msg.method, msg.body)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // 异步
  }
});

// popup 请求：确保 content script 已注入，再转发消息
async function ensureInjected(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'pf-ping' });
    if (pong && pong.stale) return 'stale';
    return true;
  } catch {
    // 没注入过 → 注入
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'pf-ping' });
    if (pong && pong.stale) return 'stale';
    return true;
  }
}

// 旧标签页（扩展更新前注入过）：刷新后等加载完成，重新注入新版
async function reloadAndInject(tabId) {
  await chrome.tabs.reload(tabId);
  await new Promise((resolve) => {
    function listener(updatedId, info) {
      if (updatedId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 800); // 给 SPA 首屏一点时间
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function sendToPage(tabId, msg) {
  let state = await ensureInjected(tabId);
  if (state === 'stale') {
    await reloadAndInject(tabId);
  }
  return chrome.tabs.sendMessage(tabId, msg);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'pf-popup-cmd') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) {
        sendResponse({ ok: false, error: '当前页面不支持注入（需 http/https 页面）' });
        return;
      }
      try {
        const resp = await sendToPage(tab.id, {
          type: msg.cmd, // pf-enable / pf-disable / pf-status / pf-config
          pfBase: msg.pfBase,
          projectId: msg.projectId,
        });
        sendResponse(resp || { ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // popup 采集按钮：先让 content 抽 DOM，再直接 POST 到 PF
  if (msg.type === 'pf-collect-page') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) throw new Error('找不到当前标签页');
        const cap = await sendToPage(tab.id, {
          type: 'pf-capture', pfBase: msg.pfBase, projectId: msg.projectId,
        });
        if (!cap || !cap.ok) throw new Error((cap && cap.error) || '采集失败');
        const data = await pfApi(msg.pfBase || DEFAULT_PF, '/api/external/collect', 'POST', JSON.stringify({
          projectId: msg.projectId,
          pageUrl: cap.pack.url,
          pageTitle: cap.pack.title,
          viewport: cap.pack.viewport,
          nodeCount: cap.pack.nodeCount,
          truncated: cap.pack.truncated,
          layoutHint: cap.pack.layoutHint,
          visualSpec: cap.pack.visualSpec,
          domHtml: cap.pack.html,
        }));
        sendResponse({ ok: true, data });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (msg.type === 'pf-fetch-projects') {
    pfApi(msg.pfBase || DEFAULT_PF, '/api/projects', 'GET')
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
