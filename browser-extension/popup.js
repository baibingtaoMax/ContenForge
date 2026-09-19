const $ = (id) => document.getElementById(id);

async function sendBg(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function showErr(text) {
  const el = $('err');
  if (!text) { el.style.display = 'none'; return; }
  el.textContent = text;
  el.style.display = 'block';
}

async function loadProjects(pfBase) {
  const sel = $('project');
  const resp = await sendBg({ type: 'pf-fetch-projects', pfBase });
  if (!resp || !resp.ok) {
    sel.innerHTML = '<option value="">项目加载失败</option>';
    throw new Error(resp?.error || '项目加载失败');
  }
  const projects = resp.data.projects || [];
  if (!projects.length) {
    sel.innerHTML = '<option value="">PF 里还没有项目</option>';
    return [];
  }
  sel.innerHTML = projects.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  return projects;
}

async function refreshStatus() {
  const pfBase = $('pfBase').value.trim();
  const projectId = $('project').value;
  if (!projectId) { $('count').textContent = '–'; return; }
  const resp = await sendBg({ type: 'pf-popup-cmd', cmd: 'pf-status', pfBase, projectId });
  if (resp && resp.ok !== false) {
    $('enabled').checked = !!resp.enabled;
    $('count').textContent = String(resp.noteCount ?? 0);
  } else {
    $('enabled').checked = false;
    $('count').textContent = '0';
  }
}

async function init() {
  const saved = await chrome.storage.local.get(['pfBase', 'projectId']);
  if (saved.pfBase) $('pfBase').value = saved.pfBase;

  try {
    await loadProjects($('pfBase').value.trim());
    if (saved.projectId) {
      const exists = [...$('project').options].some((o) => o.value === saved.projectId);
      if (exists) $('project').value = saved.projectId;
    }
  } catch (e) {
    showErr('连不上 PF：' + e.message + '（确认后端在跑、地址正确）');
  }
  refreshStatus();
}

// 保存配置
$('pfBase').addEventListener('change', async () => {
  await chrome.storage.local.set({ pfBase: $('pfBase').value.trim() });
  showErr('');
  try {
    await loadProjects($('pfBase').value.trim());
    refreshStatus();
  } catch (e) {
    showErr('连不上 PF：' + e.message);
  }
});
$('project').addEventListener('change', async () => {
  await chrome.storage.local.set({ projectId: $('project').value });
  refreshStatus();
});

// 标注开关
$('enabled').addEventListener('change', async () => {
  const on = $('enabled').checked;
  const pfBase = $('pfBase').value.trim();
  const projectId = $('project').value;
  if (!projectId) {
    showErr('先选择归属项目');
    $('enabled').checked = false;
    return;
  }
  showErr('');
  const resp = await sendBg({
    type: 'pf-popup-cmd',
    cmd: on ? 'pf-enable' : 'pf-disable',
    pfBase,
    projectId,
  });
  if (!resp || resp.ok === false) {
    showErr(resp?.error || '操作失败');
    $('enabled').checked = false;
  } else {
    // 开启后小延迟关闭 popup，让用户直接开始标注
    if (on) setTimeout(() => window.close(), 400);
  }
  refreshStatus();
});

$('collect').addEventListener('click', async () => {
  const pfBase = $('pfBase').value.trim();
  const projectId = $('project').value;
  const msg = $('collectMsg');
  if (!projectId) { showErr('先选择归属项目'); return; }
  const btn = $('collect');
  btn.disabled = true;
  btn.textContent = '采集中…';
  msg.style.display = 'none';
  const resp = await sendBg({ type: 'pf-collect-page', pfBase, projectId });
  btn.disabled = false;
  btn.textContent = '📥 采集本页到 PF';
  if (!resp || resp.ok === false) {
    msg.style.display = 'block';
    msg.style.color = '#e5484d';
    msg.textContent = '采集失败：' + (resp?.error || '未知错误');
  } else {
    msg.style.display = 'block';
    msg.style.color = '#16a34a';
    msg.textContent = '已采集：' + (resp.data.nodeCount || '?') + ' 个节点' + (resp.data.truncated ? '（超限截断）' : '') + '，后台开始重建';
  }
});

init();
