/* ============================================
 * PF 站外标注器（验证版）
 * 用法：bookmarklet 加载本脚本后调 window.__pfAnnotator.start({projectId})
 * 或直接在控制台：__pfAnnotator.start({projectId:'xxx'})
 * 依赖：目标页可访问 PF 后端（CORS 已开 origin:true）
 * ============================================ */
(function () {
  // Chrome 扩展环境检测（content script 注入时存在）
  var IN_EXT = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  if (window.__pfAnnotator && window.__pfAnnotator.__installed) {
    if (!IN_EXT) { window.__pfAnnotator.toggle(); return; }
    // 扩展热重载后旧标签页：旧注入器已失效，只回明确提示，让用户刷新页面
    var STALE = '扩展刚更新过，请刷新这个页面后再试';
    chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      if (!msg || !msg.type) return;
      if (msg.type === 'pf-ping') { sendResponse({ ok: true, stale: true }); return; }
      sendResponse({ ok: false, error: STALE, stale: true });
      return;
    });
    return;
  }

  var PF_BASE = window.__PF_BASE__ || 'http://localhost:3100';
  var projectId = window.__PF_PROJECT__ || '';
  var enabled = false;
  var hoverEl = null;
  var overlay = null;
  var bar = null;
  var badges = [];
  var notes = [];

  var KIND_CN = { field: '字段', action: '按钮', icon: '图标', section: '区块', element: '元素' };

  function elText(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }
  function $(id) { return document.getElementById(id); }

  // 采集到的真实页面卡片常无 class，靠内联 style 画（border+圆角+背景）。
  // 识别这种容器：同时有边框、圆角、不透明背景，且内含多个子块（挡掉徽章/标签/输入框）。
  function isInlineCard(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName.toLowerCase();
    if (['div', 'section', 'article', 'li', 'aside'].indexOf(tag) === -1) return false;
    var st = getComputedStyle(el);
    if (!st) return false;
    var bw = parseFloat(st.borderTopWidth || '0') || 0;
    var radius = parseFloat(st.borderTopLeftRadius || '0') || 0;
    var bg = st.backgroundColor || '';
    var hasBg = !!bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\.?0*\)/.test(bg);
    if (!(bw > 0 && radius >= 4 && hasBg)) return false;
    if (el.children.length < 2) return false;
    if (el.querySelectorAll('*').length < 3) return false;
    if (elText(el).length < 6) return false;
    return true;
  }

  // 无 class 内联卡没有 h/.title，从「非绝对定位 + 加粗 + 字号最大 + 非纯数字」的文本节点里提标题
  function bestInlineTitle(el) {
    var best = '', bestSize = 0;
    Array.prototype.forEach.call(el.querySelectorAll('*'), function (n) {
      var cs = getComputedStyle(n);
      if (cs.position === 'absolute') return;
      var own = Array.prototype.filter.call(n.childNodes, function (nd) { return nd.nodeType === 3 && nd.textContent.trim(); })
        .map(function (nd) { return nd.textContent.trim(); }).join('');
      if (!own || own.length > 20 || /^\d+$/.test(own)) return;
      var fw = parseInt(cs.fontWeight, 10) || 400;
      if (fw < 600) return;
      var fs = parseFloat(cs.fontSize) || 0;
      if (fs > bestSize) { bestSize = fs; best = own; }
    });
    return best;
  }

  function classify(el) {
    if (!el || el.nodeType !== 1) return null;
    var tag = el.tagName.toLowerCase();
    var cls = (el.className && typeof el.className === 'string') ? el.className : '';
    if (el.closest('#pf-ann-root')) return null; // 不标自己
    if (tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button' ||
        /pf-btn|\bbtn\b/.test(cls) || el.hasAttribute('onclick')) return 'action';
    var cpText = elText(el);
    if (/cursor-pointer|cursor-pointer/.test(cls) && (cpText ? cpText.length <= 10 : !!el.querySelector('svg,img,i'))) return 'action';
    if (['svg', 'img', 'i'].indexOf(tag) !== -1 ||
        (el.querySelector('svg,img,i') && !cpText)) return 'icon';
    if (tag === 'th' || tag === 'label' || tag === 'td' || ['input', 'select', 'textarea'].indexOf(tag) !== -1) return 'field';
    if (tag === 'dt' || tag === 'dd') return 'field';
    if (/\bcard\b|\bpanel\b|\bsection\b|el-card/.test(cls) || tag === 'table' || tag === 'form') return 'section';
    if (isInlineCard(el)) return 'section';
    return null;
  }

  function genericLabel(el) {
    return (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) ||
      (el.querySelector && (el.querySelector('img[alt]') || {}).alt) ||
      elText(el).slice(0, 20) || '';
  }

  // 从目标向上找最合理的语义元素
  function pickTarget(target) {
    var node = target;
    var fallback = target;
    while (node && node !== document.body && node.nodeType === 1) {
      if (node.closest && node.closest('#pf-ann-root')) break;
      var k = classify(node);
      if (k) return { el: node, kind: k, label: pickLabel(node, k) };
      if (elText(node) && !fallback.dataset.pfFallback) fallback = node;
      node = node.parentNode;
    }
    return { el: fallback, kind: 'element', label: genericLabel(fallback) };
  }

  function pickLabel(el, kind) {
    var tag = el.tagName.toLowerCase();
    if (kind === 'icon') return genericLabel(el) || '图标';
    if (kind === 'action') return elText(el).slice(0, 20) || genericLabel(el) || '按钮';
    if (kind === 'field') {
      if (tag === 'th' || tag === 'label') return elText(el) || '字段';
      if (['input', 'select', 'textarea'].indexOf(tag) !== -1) {
        return el.getAttribute('placeholder') || el.getAttribute('aria-label') ||
          (el.id && document.querySelector('label[for="' + el.id + '")') ? elText(document.querySelector('label[for="' + el.id + '"]')) : '') || '输入框';
      }
      return elText(el).slice(0, 16) || '字段';
    }
    if (kind === 'section') {
      // 优先卡片/面板的标题区，再找内部第一个 title/name/heading 语义节点，避免整块正文截断当标题
      var h = el.querySelector('h1,h2,h3,h4,.el-card__header,legend,caption,[class*=card-header],[class*=panel-header],[class*=title],[class*=heading],[class*=name]');
      if (h && elText(h) && elText(h).length <= 20) return elText(h);
      var firstBold = el.querySelector('b,strong,[class*=title],[class*=font-weight]');
      if (firstBold && elText(firstBold) && elText(firstBold).length <= 20) return elText(firstBold);
      // 无 class 内联卡：按加粗字号提真正标题，避免回退成整块正文
      if (isInlineCard(el)) {
        var it = bestInlineTitle(el);
        if (it) return it;
      }
      return elText(el).slice(0, 12) || '区块';
    }
    return genericLabel(el);
  }

  // 定位路径（与 proto-shell 同构，便于以后统一）
  function buildPath(el) {
    var parts = [];
    var node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      var tag = node.tagName.toLowerCase();
      var parent = node.parentNode;
      var idx = 1;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        idx = sibs.indexOf(node) + 1;
      }
      var txt = elText(node).slice(0, 12);
      parts.unshift(tag + ':nth-of-type(' + idx + ')' + (txt ? '[' + txt + ']' : ''));
      node = parent;
    }
    return parts.join(' > ');
  }

  function api(path, opts) {
    opts = opts || {};
    // 扩展环境：content script 不直接跨域，交给 background（有 host_permissions，无 CORS 问题）
    if (IN_EXT) {
      return new Promise(function (resolve, reject) {
        chrome.runtime.sendMessage({ type: 'pf-api', pfBase: PF_BASE, path: path, method: opts.method || 'GET', body: opts.body || null }, function (resp) {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.ok) resolve(resp.data);
          else reject(new Error((resp && resp.error) || '请求失败'));
        });
      });
    }
    return fetch(PF_BASE + path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
    }, opts)).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); });
      return r.json();
    });
  }

  function ensureDom() {
    if (overlay) return;
    var style = document.createElement('style');
    style.textContent =
      '#pf-ann-root *{box-sizing:border-box;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}' +
      '.pfx-overlay{position:fixed;border:2px solid #f97316;background:rgba(249,115,22,.08);z-index:2147483645;pointer-events:none;border-radius:3px;transition:all .06s}' +
      '.pfx-bar{position:fixed;z-index:2147483646;display:none;align-items:center;gap:8px;background:#1f2430;color:#fff;border-radius:8px;padding:6px 10px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:80vw}' +
      '.pfx-bar b{color:#fdba74;font-weight:600;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.pfx-bar .hint{color:#9aa0ad}' +
      '.pfx-badge{position:fixed;z-index:2147483644;min-width:18px;height:18px;border-radius:9px;background:#f97316;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);transform:translate(6px,-6px)}' +
      '.pfx-badge.done{background:#94a0b4}' +
      '.pfx-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483646;display:flex;justify-content:flex-end}' +
      '.pfx-panel{width:380px;max-width:92vw;background:#fff;height:100%;display:flex;flex-direction:column;box-shadow:-8px 0 30px rgba(0,0,0,.15)}' +
      '.pfx-head{padding:16px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:flex-start}' +
      '.pfx-head .t{font-size:15px;font-weight:700;color:#1a1d29}.pfx-head .s{font-size:12px;color:#8a8f9c;margin-top:3px}' +
      '.pfx-x{border:none;background:none;font-size:22px;line-height:1;color:#8a8f9c;cursor:pointer;padding:0 2px}' +
      '.pfx-body{flex:1;overflow-y:auto;padding:16px 20px}.pfx-body label{font-size:13px;color:#4a4f5a;display:block;margin-bottom:5px}' +
      '.pfx-input{width:100%;border:1px solid #dcdfe7;border-radius:8px;padding:8px 10px;font-size:13px;outline:none;margin-bottom:14px}' +
      'textarea.pfx-input{resize:vertical;min-height:90px}' +
      '.pfx-input:focus{border-color:#f97316}' +
      '.pfx-foot{padding:12px 20px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px}' +
      '.pfx-btn{height:34px;padding:0 16px;border-radius:8px;border:1px solid #dcdfe7;background:#fff;font-size:13px;cursor:pointer;color:#4a4f5a}' +
      '.pfx-btn.primary{background:#f97316;border-color:#f97316;color:#fff}.pfx-btn.primary:disabled{opacity:.6}' +
      '.pfx-toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#1f2430;color:#fff;padding:9px 18px;border-radius:8px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.3)}' +
      '.pfx-fab{position:fixed;right:20px;bottom:20px;z-index:2147483646;background:#f97316;color:#fff;border:none;border-radius:22px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 18px rgba(249,115,22,.4)}';
    document.head.appendChild(style);

    var root = document.createElement('div');
    root.id = 'pf-ann-root';
    document.body.appendChild(root);

    overlay = document.createElement('div');
    overlay.className = 'pfx-overlay';
    overlay.style.display = 'none';
    root.appendChild(overlay);

    bar = document.createElement('div');
    bar.className = 'pfx-bar';
    root.appendChild(bar);
  }

  function moveOverlay(el) {
    var r = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.left = (r.left - 2) + 'px';
    overlay.style.top = (r.top - 2) + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
  }

  function showBar(t) {
    var r = t.el.getBoundingClientRect();
    bar.innerHTML = '<b>' + esc(KIND_CN[t.kind] + (t.label ? '：' + t.label : '')) + '</b>' +
      '<span class="hint">点击贴意见 · Esc 退出</span>';
    bar.style.display = 'flex';
    var top = r.bottom + 8;
    if (top + 38 > window.innerHeight) top = r.top - 42;
    bar.style.left = Math.min(r.left, window.innerWidth - bar.offsetWidth - 12) + 'px';
    bar.style.top = Math.max(8, top) + 'px';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function onOver(e) {
    if (!enabled) return;
    var t = e.target;
    if (!t || !(t instanceof Element)) return;
    var p = pickTarget(t);
    hoverEl = p;
    moveOverlay(p.el);
    showBar(p);
  }
  function onClick(e) {
    if (!enabled) return;
    var t = e.target;
    if (!t || !(t instanceof Element) || t.closest('#pf-ann-root')) return;
    e.preventDefault();
    e.stopPropagation();
    var p = hoverEl || pickTarget(t);
    openDraft(p);
  }
  function onKey(e) {
    if (e.key === 'Escape') setEnabled(false);
  }

  function openDraft(t) {
    hideOverlay();
    var author = localStorage.getItem('pfx-author') || '';
    var mask = document.createElement('div');
    mask.className = 'pfx-mask';
    mask.innerHTML =
      '<div class="pfx-panel">' +
      '  <div class="pfx-head"><div><div class="t">贴一条评审意见</div><div class="s">' + esc(KIND_CN[t.kind] + (t.label ? '：' + t.label : '')) + '</div></div><button class="pfx-x" data-a="x">×</button></div>' +
      '  <div class="pfx-body">' +
      '    <label>你的称呼（可选）</label><input class="pfx-input" data-a="author" placeholder="如：王总" value="' + esc(author) + '">' +
      '    <label>意见内容</label><textarea class="pfx-input" data-a="content" placeholder="要改什么、改成什么样…"></textarea>' +
      '  </div>' +
      '  <div class="pfx-foot"><button class="pfx-btn" data-a="cancel">取消</button><button class="pfx-btn primary" data-a="submit">提交意见</button></div>' +
      '</div>';
    document.getElementById('pf-ann-root').appendChild(mask);
    var ta = mask.querySelector('[data-a=content]');
    setTimeout(function () { ta.focus(); }, 50);
    function close() { mask.remove(); if (enabled) { overlay.style.display = 'block'; } }
    mask.addEventListener('click', function (e) { if (e.target === mask || e.target.dataset.a === 'x' || e.target.dataset.a === 'cancel') close(); });
    mask.querySelector('[data-a=submit]').addEventListener('click', function () {
      var content = ta.value.trim();
      var au = mask.querySelector('[data-a=author]').value.trim();
      if (!content) { toast('先写意见内容'); return; }
      var btn = mask.querySelector('[data-a=submit]');
      btn.disabled = true;
      localStorage.setItem('pfx-author', au);
      api('/api/external/annotations', {
        method: 'POST',
        body: JSON.stringify({
          projectId: projectId,
          pageUrl: location.href,
          pageTitle: document.title,
          targetKind: t.kind,
          targetLabel: t.label || '',
          targetPath: buildPath(t.el),
          content: content,
          author: au,
        }),
      }).then(function () {
        mask.remove();
        toast('意见已提交到 ProtoForge');
        loadBadges();
      }).catch(function (err) {
        btn.disabled = false;
        toast('提交失败：' + err.message);
      });
    });
  }

  function hideOverlay() {
    overlay.style.display = 'none';
    bar.style.display = 'none';
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'pfx-toast';
    t.textContent = msg;
    document.getElementById('pf-ann-root').appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // 已有意见：在页面元素上打角标（按 path 解析，解析不到不显示）
  function resolvePath(path) {
    var node = document.body;
    var segs = path.split(' > ');
    for (var i = 0; i < segs.length; i++) {
      var m = segs[i].match(/^([\w-]+):nth-of-type\((\d+)\)/);
      if (!m) return null;
      var tag = m[1], n = parseInt(m[2], 10);
      var sibs = Array.prototype.filter.call(node.children || [], function (c) { return c.tagName && c.tagName.toLowerCase() === tag; });
      node = sibs[n - 1] || null;
      if (!node) return null;
    }
    return node;
  }

  function renderBadges() {
    badges.forEach(function (b) { b.remove(); });
    badges = [];
    if (!enabled) return;
    notes.forEach(function (a) {
      if (!a.target_path) return;
      var el = resolvePath(a.target_path);
      if (!el) return;
      var r = el.getBoundingClientRect();
      var b = document.createElement('div');
      b.className = 'pfx-badge' + (a.status !== 'open' ? ' done' : '');
      b.textContent = a.status === 'open' ? notes.filter(function (x) { return x.status === 'open'; }).length && '!' : '✓';
      b.title = (a.target_label || '') + '：' + a.content;
      b.style.left = (r.right - 4) + 'px';
      b.style.top = (r.top - 6) + 'px';
      b.addEventListener('click', function (e) { e.stopPropagation(); toast((a.target_label ? a.target_label + '：' : '') + a.content); });
      document.getElementById('pf-ann-root').appendChild(b);
      badges.push(b);
    });
  }

  function loadBadges() {
    if (!projectId) return;
    api('/api/external/annotations?projectId=' + encodeURIComponent(projectId) + '&url=' + encodeURIComponent(location.origin + location.pathname + location.search))
      .then(function (d) { notes = d.annotations || []; renderBadges(); })
      .catch(function () {});
  }

  window.addEventListener('scroll', function () { if (enabled) renderBadges(); }, true);
  window.addEventListener('resize', function () { if (enabled) renderBadges(); });

  function setEnabled(on) {
    enabled = on;
    if (on) {
      ensureDom();
      document.addEventListener('mouseover', onOver, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      loadBadges();
      toast('标注模式：点击任意元素贴意见');
    } else {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      if (overlay) hideOverlay();
      badges.forEach(function (b) { b.remove(); });
      badges = [];
    }
  }

  window.__pfAnnotator = {
    __installed: true,
    start: function (opts) {
      opts = opts || {};
      if (opts.pfBase) PF_BASE = opts.pfBase;
      if (opts.projectId) projectId = opts.projectId;
      if (!projectId) { toast('先传 projectId：__pfAnnotator.start({projectId:"..."})'); return; }
      ensureDom();
      setEnabled(!enabled);
    },
    toggle: function () { setEnabled(!enabled); },
    stop: function () { setEnabled(false); },
    setProject: function (id) { projectId = id; if (enabled) loadBadges(); },
    capture: function () { return captureDom(); },
    status: function () {
      var count = 0;
      if (projectId) {
        // 同步返回已知缓存数；异步精确数由 loadBadges 后消息推送
      }
      return { enabled: enabled, projectId: projectId, noteCount: notes.length, url: location.href };
    },
    refreshCount: function (pid) {
      var p = pid || projectId;
      if (!p) return Promise.resolve(0);
      return api('/api/external/annotations?projectId=' + encodeURIComponent(p) + '&url=' + encodeURIComponent(location.origin + location.pathname + location.search))
        .then(function (d) { notes = d.annotations || []; return notes.length; })
        .catch(function () { return 0; });
    },
  };

  // ============================================
  // DOM 采集：渲染后页面 → 精简结构化 HTML（喂给 PF 重建）
  // ============================================
  var STYLE_PROPS = ['display', 'flex-direction', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'grid-template-rows', 'color', 'background-color',
    'font-size', 'font-weight', 'line-height', 'text-align', 'border-radius',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'white-space'];
  var KEEP_ATTRS = { class: 1, type: 1, name: 1, placeholder: 1, href: 1, src: 1, alt: 1,
    title: 1, role: 1, colspan: 1, rowspan: 1, for: 1, 'aria-label': 1, disabled: 1,
    checked: 1, selected: 1, value: 1 };
  var DROP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, LINK: 1, META: 1, BR: 1 };
  // 浮层/弹层：默认不采（弹窗/抽屉/下拉/气泡/全局提示）。
  // 这些是“瞬时状态”，混进主页面结构会干扰重建；以后多快照功能单独采弹窗。
  var OVERLAY_RE = /(^|\s)(el-overlay|el-dialog|el-drawer|el-popper|el-select-dropdown|el-cascader__dropdown|el-color-picker__panel|el-message|el-notification|el-image-viewer|v-modal|pfx-)([\w-]*)?/;
  var NODE_BUDGET = 2500;

  function absUrl(u) {
    try { return new URL(u, location.href).href; } catch (e) { return u; }
  }
  function compactText(s) {
    s = (s || '').replace(/\s+/g, ' ').trim();
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  }
  function escA(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function isVisible(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  // Element Plus 组件类型提示（靠 class 识别，帮 AI 转译）
  function elCompHint(el) {
    var cls = (el.className && typeof el.className === 'string') ? el.className : '';
    var map = [
      [/el-button--primary|el-button--success|el-button--warning|el-button--danger/, 'el-btn-variant'],
      [/\bel-button\b/, 'el-button'], [/\bel-input\b/, 'el-input'], [/\bel-select\b/, 'el-select'],
      [/\bel-table\b/, 'el-table'], [/\bel-form\b/, 'el-form'], [/\bel-tabs?\b/, 'el-tabs'],
      [/\bel-dialog\b/, 'el-dialog'], [/\el-card\b/, 'el-card'], [/\el-tag\b/, 'el-tag'],
      [/\el-radio\b/, 'el-radio'], [/\el-checkbox\b/, 'el-checkbox'], [/\el-pagination\b/, 'el-pagination'],
      [/\el-menu\b/, 'el-menu'], [/\el-dropdown\b/, 'el-dropdown'], [/\el-switch\b/, 'el-switch'],
      [/\el-date-editor\b/, 'el-date-picker'],
    ];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(cls)) return map[i][1];
    return '';
  }

  function captureDom() {
    var nodeCount = 0;
    var truncated = false;

    // 默认值黑名单：等于这些的值一律不输出（浏览器/computed 默认，纯噪音）
    var STYLE_DEFAULTS = {
      'display': ['block'],
      'flex-direction': ['row'],
      'justify-content': ['normal', 'flex-start'],
      'align-items': ['normal', 'stretch'],
      'gap': ['normal', '0px'],
      'grid-template-columns': ['none'],
      'grid-template-rows': ['none'],
      'color': ['rgb(0, 0, 0)', 'rgb(30, 41, 59)'],
      'background-color': ['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)', 'rgb(248, 250, 252)'],
      'font-size': ['16px'],
      'font-weight': ['400', 'normal'],
      'line-height': ['normal'],
      'text-align': ['start', 'left'],
      'border-radius': ['0px'],
      'white-space': ['normal'],
      'padding-top': ['0px'], 'padding-right': ['0px'],
      'padding-bottom': ['0px'], 'padding-left': ['0px'],
    };
    function styleOf(el) {
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { return ''; }
      var out = [];
      for (var i = 0; i < STYLE_PROPS.length; i++) {
        var k = STYLE_PROPS[i], v = cs.getPropertyValue(k);
        if (!v) continue;
        var bad = STYLE_DEFAULTS[k];
        if (bad && bad.indexOf(v) !== -1) continue;
        out.push(k + ':' + v);
      }
      return out.join(';');
    }

    function cleanAttrs(el, tag) {
      var parts = [];
      var attrs = el.attributes || [];
      for (var i = 0; i < attrs.length; i++) {
        var a = attrs[i];
        if (!KEEP_ATTRS[a.name]) continue;
        var v = a.value;
        if ((a.name === 'src' || a.name === 'href') && v) v = absUrl(v);
        if (a.name === 'class') v = v.replace(/\s+/g, ' ').trim().slice(0, 200);
        if (a.name === 'value' && (tag === 'INPUT' || tag === 'SELECT') && !v) continue;
        parts.push(a.name + '="' + escA(v) + '"');
      }
      return parts.join(' ');
    }

    function walk(el, depth) {
      if (truncated) return '';
      if (el.id === 'pf-ann-root') return '';
      var tag = el.tagName;
      if (DROP_TAGS[tag]) return '';
      // 弹层/浮层节点整棵跳过（含其遮罩）
      var elCls = (el.className && typeof el.className === 'string') ? el.className : '';
      if (OVERLAY_RE.test(elCls)) return '';
      if (depth > 2 && !isVisible(el)) return '';
      if (++nodeCount > NODE_BUDGET) { truncated = true; return '<!-- 节点超预算截断 -->'; }

      var low = tag.toLowerCase();
      // svg 内部压成占位，保留其外层尺寸线索
      if (low === 'svg') return '<svg-icon />';
      if (low === 'canvas') {
        var cr = el.getBoundingClientRect();
        return '<canvas-chart style="width:' + Math.round(cr.width) + 'px;height:' + Math.round(cr.height) + 'px" />';
      }
      if (low === 'img') {
        var src = el.getAttribute('src') || '';
        return '<img src="' + escA(absUrl(src)) + '" alt="' + escA(el.getAttribute('alt') || '') + '" />';
      }

      var hint = elCompHint(el);
      var st = depth <= 8 ? styleOf(el) : '';
      var attrStr = cleanAttrs(el, tag);
      var open = '<' + low;
      if (hint) open += ' data-el="' + hint + '"';
      if (st) open += ' style="' + escA(st) + '"';
      if (attrStr) open += ' ' + attrStr;

      var inner = '';
      var kids = el.children;
      for (var k = 0; k < kids.length; k++) inner += walk(kids[k], depth + 1);

      // 叶子元素补文本
      if (!inner) {
        var t = compactText(el.textContent);
        if (t) inner += t.slice(0, 120);
      }
      if (!inner && !/^(input|hr|img|svg-icon|canvas-chart)/.test(low)) {
        // 空容器（如纯图标包裹层）保留但不报错
      }
      var selfClose = inner ? '' : '';
      return open + '>' + inner + '</' + low + '>';
    }

    // 遍历 body 子节点拼成中性根 div（不能出现 body 标签，PF 只收 HTML 片段）
    var inner = '';
    for (var ci = 0; ci < document.body.children.length; ci++) {
      inner += walk(document.body.children[ci], 0);
    }
    // 布局线索：顶栏横菜单（门户式后台） vs 左侧菜单。原站自带顶栏时重建为全屏页，不套 PF 侧栏壳感
    var layoutHint = 'sidebar';
    var hMenu = document.querySelector('.el-menu--horizontal, header [class*=menu], .app-header [class*=menu]');
    var aside = document.querySelector('.el-aside, aside, [class*=sidebar]');
    var header = document.querySelector('header, .el-header, .app-header');
    // 沿祖先链采样第一个不透明背景（class 定义的底色 computed 常挂在父节点上）
    var chromeBg = '', chromeFg = '';
    function sampleChrome(el) {
      var node = el;
      for (var i = 0; i < 4 && node && node !== document.documentElement; i++) {
        var cs = getComputedStyle(node);
        var bg = cs.backgroundColor || '';
        if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\s*\)/.test(bg)) {
          // 判定深浅：深色背景配白字
          var mm = bg.match(/rgba?\(([^)]+)\)/);
          if (mm) {
            var parts = mm[1].split(',').map(function (x) { return parseInt(x, 10); });
            var lum = 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2];
            return { bg: bg, dark: lum < 140 };
          }
        }
        node = node.parentElement;
      }
      return null;
    }
    if (header && hMenu && !(aside && aside.getBoundingClientRect().width > 120)) {
      layoutHint = 'topnav';
      var chrome = sampleChrome(header);
      if (chrome) {
        chromeBg = chrome.bg;
        chromeFg = chrome.dark ? 'light' : 'dark';
      }
    }
    // ===== 视觉规格采样：给重建提供真实字号/间距/圆角/排布 + 站点色板（按组件角色各取一个样本，天然去重）=====
    function sampleVisualSpec() {
      var rootCS = getComputedStyle(document.documentElement);
      var bodyCS = getComputedStyle(document.body);
      function cv(n) { var v = rootCS.getPropertyValue(n); return v ? v.trim() : ''; };
      function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } };
      function box(el) { if (!el) return null; var r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
      var spec = {};

      // --- 色板：优先 Element Plus / Ant 主题变量，元素采样兜底 ---
      var pal = {};
      var EP = {
        primary: '--el-color-primary', primaryHover: '--el-color-primary-light-3', primarySoft: '--el-color-primary-light-9',
        success: '--el-color-success', warning: '--el-color-warning', danger: '--el-color-danger',
        text1: '--el-text-color-primary', text2: '--el-text-color-regular', text3: '--el-text-color-secondary',
        placeholder: '--el-text-color-placeholder', border: '--el-border-color', borderLight: '--el-border-color-light',
        surface: '--el-fill-color-blank', bg: '--el-bg-color', bgPage: '--el-bg-color-page',
      };
      Object.keys(EP).forEach(function (k) { var v = cv(EP[k]); if (v) pal[k] = v; });
      var pb = q('.el-button--primary:not(.is-plain):not(.is-text), .ant-btn-primary');
      if (!pal.primary && pb) pal.primary = getComputedStyle(pb).backgroundColor;
      if (!pal.text1) pal.text1 = bodyCS.color;
      if (!pal.bgPage) pal.bgPage = bodyCS.backgroundColor;
      if (Object.keys(pal).length) spec.palette = pal;
      if (chromeBg) spec.chrome = { bg: chromeBg, fg: chromeFg || 'light' };

      // --- 基础排版 ---
      spec.base = { fontSize: bodyCS.fontSize, lineHeight: bodyCS.lineHeight, fontFamily: (bodyCS.fontFamily || '').split(',')[0].trim() };

      // --- 卡片 ---
      var card = q('.el-card, .ant-card, .card, [class*=panel][class*=card]');
      if (card) {
        var cc = getComputedStyle(card);
        spec.card = {
          radius: cc.borderTopLeftRadius,
          border: cc.borderTopWidth !== '0px' ? (cc.borderTopWidth + ' ' + cc.borderTopStyle + ' ' + cc.borderTopColor) : 'none',
          shadow: cc.boxShadow === 'none' ? 'none' : 'has-shadow',
          size: box(card),
        };
        var cbody = q('.el-card__body, .ant-card-body') || card;
        var cbc = getComputedStyle(cbody);
        spec.card.bodyPadding = cbc.padding;
        var chead = q('.el-card__header, .ant-card-head');
        if (chead) { var chc = getComputedStyle(chead); spec.card.headerPadding = chc.padding; spec.card.titleFont = chc.fontSize + '/' + chc.fontWeight; }
      }

      // --- 表单 ---
      var form = q('.el-form, form');
      if (form) {
        var m = (form.className || '').match(/el-form--label-(top|left|right)/);
        spec.form = { labelPos: m ? m[1] : 'right' };
      }
      var label = q('.el-form-item__label, .ant-form-item-label > label');
      if (label) {
        var lc = getComputedStyle(label);
        spec.form = spec.form || {};
        spec.form.label = { w: box(label).w, align: lc.textAlign, fontSize: lc.fontSize, color: lc.color, lineHeight: lc.lineHeight, padR: lc.paddingRight };
      }
      var fi = q('.el-form-item, .ant-form-item');
      if (fi) { spec.form = spec.form || {}; spec.form.rowGap = getComputedStyle(fi).marginBottom; }
      var c12 = document.querySelectorAll('.el-col-12, .ant-col-12').length;
      var c8 = document.querySelectorAll('.el-col-8, .ant-col-8').length;
      if (spec.form) { if (c12) spec.form.colsPerRow = 2; else if (c8) spec.form.colsPerRow = 3; else spec.form.colsPerRow = 1; }

      // --- 输入框 ---
      var inp = q('.el-input__wrapper, .ant-input-affix-wrapper, .el-textarea__inner, .ant-input, input[type=text], input:not([type])');
      if (inp) {
        var ic = getComputedStyle(inp), ib = box(inp);
        spec.input = {
          h: ib ? ib.h : null, radius: ic.borderTopLeftRadius, padding: ic.padding,
          border: ic.borderTopWidth !== '0px' ? (ic.borderTopWidth + ' ' + ic.borderTopStyle + ' ' + ic.borderTopColor) : 'box-shadow',
          fontSize: ic.fontSize,
        };
      }

      // --- 按钮 ---
      var btn = pb || q('.el-button, .ant-btn, button');
      if (btn) { var bc = getComputedStyle(btn), bb = box(btn); spec.button = { h: bb ? bb.h : null, radius: bc.borderTopLeftRadius, fontSize: bc.fontSize, fontWeight: bc.fontWeight, padX: bc.paddingLeft }; }

      // --- 顶栏 / 内容区 ---
      if (header) spec.navbar = box(header);
      var main = q('.el-main, .ant-layout-content, main, [class*=app-main], [class*=page-container], [class*=content]');
      if (main) { var mc = getComputedStyle(main), mb = box(main); spec.content = { padding: mc.padding, w: mb ? mb.w : null }; }

      return spec;
    }
    var visualSpec = sampleVisualSpec();

    var html = '<div data-page-root="true" data-layout="' + layoutHint + '"' +
      (chromeBg ? ' data-chrome-bg="' + chromeBg.replace(/"/g, '') + '" data-chrome-fg="' + chromeFg + '"' : '') +
      ' style="min-height:100vh;background:' +
      (getComputedStyle(document.body).backgroundColor || '') + ';color:' +
      (getComputedStyle(document.body).color || '') + ';font-size:' +
      (getComputedStyle(document.body).fontSize || '') + '">' + inner + '</div>';
    return {
      url: location.origin + location.pathname + location.search,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      layoutHint: layoutHint,
      chromeBg: chromeBg,
      chromeFg: chromeFg,
      nodeCount: nodeCount,
      truncated: truncated,
      visualSpec: visualSpec,
      html: html,
    };
  }

  // ---- Chrome 扩展：等 popup 指挥，不自动启动 ----
  if (IN_EXT) {
    chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      if (!msg || !msg.type) return;
      if (msg.type === 'pf-ping') { sendResponse({ ok: true, enabled: enabled }); return; }
      if (msg.type === 'pf-config') {
        if (msg.pfBase) PF_BASE = msg.pfBase;
        if (msg.projectId) projectId = msg.projectId;
        sendResponse({ ok: true });
      } else if (msg.type === 'pf-enable') {
        if (msg.pfBase) PF_BASE = msg.pfBase;
        if (msg.projectId) projectId = msg.projectId;
        if (!projectId) { sendResponse({ ok: false, error: '未选择项目' }); return; }
        ensureDom();
        setEnabled(true);
        sendResponse({ ok: true });
      } else if (msg.type === 'pf-disable') {
        setEnabled(false);
        sendResponse({ ok: true });
      } else if (msg.type === 'pf-capture') {
        if (msg.pfBase) PF_BASE = msg.pfBase;
        if (msg.projectId) projectId = msg.projectId;
        try {
          var pack = captureDom();
          sendResponse({ ok: true, pack: pack });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return;
      } else if (msg.type === 'pf-status') {
        window.__pfAnnotator.refreshCount(msg.projectId).then(function (n) {
          sendResponse({ enabled: enabled, noteCount: n, url: location.href, title: document.title });
        });
        return true; // 异步响应
      }
    });
  }
})();
