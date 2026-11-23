/* global Treemap */

const state = {
  drives: [],
  selectedDrive: null,
  tree: null,          // 最近一次扫描的完整目录树
  currentNode: null,   // 当前正在显示的目录节点
  nodeStack: [],       // 从根到当前节点的路径
  nodeByPath: new Map(),
  parentMap: new Map(),
  allDirs: [],
  topFolders: [],
  largestFiles: [],
  scanMeta: null,      // { fileCount, dirCount, rootPath }
  rects: [],           // 当前 treemap 矩形
  apps: [],
  aiSuggestions: [],
};

// ---------- 工具 ----------
function fmtBytes(n) {
  if (n == null || isNaN(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(v >= 100 || i === 0 ? 0 : 1) + ' ' + units[i];
}

function fmtCount(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(1) + ' 亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万';
  return String(n);
}

function el(id) { return document.getElementById(id); }

let toastTimer = null;
function toast(msg, type = 'info') {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'toast ' + (type === 'info' ? '' : type);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
}

function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `rgb(${Math.round(f(0) * 255)},${Math.round(f(8) * 255)},${Math.round(f(4) * 255)})`;
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function colorFor(node, depth) {
  const hue = hashStr(node.name || '') % 360;
  const light = Math.max(30, Math.min(52, 48 - depth * 4));
  return { fill: hsl(hue, 45, light), hover: hsl(hue, 55, light + 10) };
}

// ---------- 视图切换 ----------
function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  el('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'apps') loadApps();
  if (name === 'ai') loadAIConfig();
}

// ---------- 磁盘 ----------
async function loadDrives() {
  try {
    state.drives = await window.api.listDrives();
  } catch (e) {
    toast('读取磁盘失败：' + e.message, 'error');
    state.drives = [];
  }
  renderDrives();
  if (state.drives.length > 0) {
    const first = state.drives.find((d) => d.id.toLowerCase().startsWith('c')) || state.drives[0];
    selectDrive(first);
  }
}

function renderDrives() {
  const wrap = el('drives');
  wrap.innerHTML = '';
  for (const d of state.drives) {
    const pct = d.total > 0 ? (d.used / d.total) * 100 : 0;
    const hue = pct > 90 ? 0 : pct > 75 ? 30 : 210;
    const div = document.createElement('div');
    div.className = 'drive' + (state.selectedDrive && state.selectedDrive.id === d.id ? ' active' : '');
    div.innerHTML = `
      <div class="top"><span class="id">${d.id}</span><span class="cap">${d.name}</span></div>
      <div class="bar"><i style="width:${pct.toFixed(1)}%;background:${hsl(hue, 70, 52)}"></i></div>
      <div class="meta"><span>已用 ${fmtBytes(d.used)}</span><span>可用 ${fmtBytes(d.free)}</span></div>
    `;
    div.onclick = () => selectDrive(d);
    wrap.appendChild(div);
  }
}

function selectDrive(d) {
  state.selectedDrive = d;
  renderDrives();
  el('scan-selected').disabled = false;
}

// ---------- 扫描 ----------
async function startScan(root) {
  if (!root) return;
  el('scan-cancel').classList.remove('hidden');
  el('scan-progress').classList.remove('hidden');
  el('scan-progress').innerHTML = '<div>正在扫描…</div><div class="pbar"><i></i></div>';
  el('scan-selected').disabled = true;
  el('scan-folder').disabled = true;

  const bar = el('scan-progress').querySelector('.pbar > i');
  const label = el('scan-progress').querySelector('div');

  try {
    const result = await window.api.scan(root);
    state.tree = result.tree;
    state.largestFiles = result.largestFiles || [];
    state.scanMeta = { fileCount: result.fileCount, dirCount: result.dirCount, rootPath: root };

    buildLookups();
    navigateTo(state.tree, true);
    el('empty-hint').classList.add('hidden');
    toast('扫描完成：' + fmtCount(result.fileCount || 0) + ' 个文件', 'success');
  } catch (e) {
    toast('扫描失败：' + e.message, 'error');
  } finally {
    el('scan-cancel').classList.add('hidden');
    el('scan-progress').classList.add('hidden');
    el('scan-selected').disabled = !state.selectedDrive;
    el('scan-folder').disabled = false;
  }
}

function buildLookups() {
  state.nodeByPath = new Map();
  state.parentMap = new Map();
  state.allDirs = [];
  (function walk(n) {
    state.nodeByPath.set(n.path, n);
    state.allDirs.push(n);
    for (const c of n.children) {
      state.parentMap.set(c.path, n);
      walk(c);
    }
  })(state.tree);
  state.topFolders = state.allDirs
    .filter((n) => n.path !== state.tree.path && n.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 100);
}

function navigateTo(node, isRoot) {
  state.currentNode = node;
  state.nodeStack = pathToRoot(node);
  renderBreadcrumb();
  renderStats();
  drawTreemap();
  renderLargestList();
}

function pathToRoot(node) {
  const arr = [node];
  let cur = node;
  while (state.parentMap.has(cur.path)) {
    cur = state.parentMap.get(cur.path);
    arr.unshift(cur);
  }
  return arr;
}

// ---------- 面包屑 ----------
function renderBreadcrumb() {
  const wrap = el('breadcrumb');
  wrap.innerHTML = '';
  state.nodeStack.forEach((n, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      wrap.appendChild(sep);
    }
    const b = document.createElement('button');
    b.className = 'crumb' + (i === state.nodeStack.length - 1 ? ' current' : '');
    b.textContent = n.name || n.path;
    if (i < state.nodeStack.length - 1) {
      b.onclick = () => navigateTo(n);
    }
    wrap.appendChild(b);
  });
}

function renderStats() {
  const n = state.currentNode;
  const s = state.scanMeta || {};
  el('stats').textContent =
    `${fmtCount(n.fileCount || 0)} 个文件 · ${fmtBytes(n.size)}` +
    (s.rootPath && n.path !== s.rootPath ? '' : '');
}

// ---------- Treemap 绘制 ----------
const canvas = el('treemap');
const ctx = canvas.getContext('2d');

function ensureCanvasSize() {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, Math.round(canvas.parentElement.clientWidth * dpr));
  const ch = Math.max(1, Math.round(canvas.parentElement.clientHeight * dpr));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function resizeCanvas() {
  ensureCanvasSize();
  drawTreemap();
}

function drawTreemap() {
  ensureCanvasSize();
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (!state.currentNode) return;

  const children = state.currentNode.children || [];
  if (children.length === 0) {
    el('empty-hint').classList.remove('hidden');
    el('empty-hint').innerHTML = `<p>该目录下没有子文件夹</p><p class="sub">共 ${fmtBytes(state.currentNode.size)}（含文件）</p>`;
    state.rects = [];
    return;
  }
  el('empty-hint').classList.add('hidden');

  const items = children.map((c) => ({ value: c.size, ref: c }));
  const pad = 1.5;
  state.rects = Treemap.compute(items, pad, pad, w - pad * 2, h - pad * 2);

  for (const r of state.rects) {
    const node = r.ref;
    const depth = node.path.split(/[\\/]/).length;
    const c = colorFor(node, depth);
    ctx.fillStyle = c.fill;
    ctx.fillRect(r.x, r.y, Math.max(1, r.w), Math.max(1, r.h));

    // 文本标签
    if (r.w > 36 && r.h > 18) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '12px "Segoe UI","Microsoft YaHei",sans-serif';
      const label = node.name;
      const sizeLabel = fmtBytes(node.size);
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x + 5, r.y + 4, r.w - 10, r.h - 8);
      ctx.clip();
      ctx.fillText(label, r.x + 7, r.y + 18);
      if (r.h > 38) ctx.fillText(sizeLabel, r.x + 7, r.y + 34);
      ctx.restore();
    }
  }
}

// ---------- Treemap 交互 ----------
function findRect(x, y) {
  return state.rects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
}

function onCanvasMove(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const r = findRect(x, y);
  const tip = el('tooltip');
  if (!r) { tip.classList.add('hidden'); canvas.style.cursor = 'default'; return; }
  const node = r.ref;
  canvas.style.cursor = 'pointer';
  tip.innerHTML = `
    <div class="t-name">${node.name}</div>
    <div class="t-size">${fmtBytes(node.size)}</div>
    <div class="t-path">${node.path}</div>
    <div class="t-hint">点击进入此文件夹</div>`;
  tip.classList.remove('hidden');
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const px = e.clientX + 16 + tw > window.innerWidth ? e.clientX - tw - 16 : e.clientX + 16;
  const py = e.clientY + 16 + th > window.innerHeight ? e.clientY - th - 16 : e.clientY + 16;
  tip.style.left = px + 'px';
  tip.style.top = py + 'px';
}

function onCanvasClick(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const r = findRect(x, y);
  if (r && r.ref.children) {
    navigateTo(r.ref);
  }
}

canvas.addEventListener('mousemove', onCanvasMove);
canvas.addEventListener('mouseleave', () => { el('tooltip').classList.add('hidden'); });
canvas.addEventListener('click', onCanvasClick);

// ---------- 最大文件/文件夹列表 ----------
function mergedLargest() {
  const folders = state.topFolders.slice(0, 40).map((n) => ({ kind: 'folder', path: n.path, name: n.name, size: n.size, node: n }));
  const files = state.largestFiles.slice(0, 40).map((f) => ({ kind: 'file', path: f.path, name: f.name, size: f.size }));
  const merged = folders.concat(files).sort((a, b) => b.size - a.size).slice(0, 60);
  return merged;
}

function renderLargestList() {
  const ul = el('largest-list');
  ul.innerHTML = '';
  const items = mergedLargest();
  if (items.length === 0) {
    ul.innerHTML = '<div class="hint">扫描后这里会列出最大的文件和文件夹</div>';
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'item-row';
    const ico = it.kind === 'folder' ? '📁' : '📄';
    li.innerHTML = `
      <input type="checkbox" class="ck" data-path="${escapeAttr(it.path)}" data-kind="${it.kind}" />
      <span class="ico">${ico}</span>
      <div class="body">
        <div class="nm">${escapeHtml(it.name)}</div>
        <div class="sz">${fmtBytes(it.size)}</div>
      </div>
      <div class="ops">
        <button class="btn ghost small" data-act="locate">定位</button>
        <button class="btn danger small" data-act="del">删除</button>
      </div>`;
    li.querySelector('[data-act="locate"]').onclick = () => locateItem(it);
    li.querySelector('[data-act="del"]').onclick = () => deleteItems([it]);
    ul.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

function locateItem(it) {
  if (it.kind === 'folder' && it.node) {
    navigateTo(it.node);
  } else {
    window.api.showInFolder(it.path);
  }
}

async function deleteItems(items) {
  if (!items || items.length === 0) return;
  const names = items.map((i) => i.name).slice(0, 5).join('、') + (items.length > 5 ? ` 等 ${items.length} 项` : '');
  const toTrash = el('trash-toggle').checked;
  const msg = toTrash
    ? `确认将以下 ${items.length} 项移入回收站？\n${names}`
    : `⚠️ 确认【永久删除】以下 ${items.length} 项？此操作不可恢复！\n${names}`;
  if (!confirm(msg)) return;

  const paths = items.map((i) => i.path);
  const results = toTrash
    ? await window.api.trashItems(paths, { allowProtected: true })
    : await window.api.deletePermanently(paths);
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  if (fail.length) toast(`完成：成功 ${ok}，失败 ${fail.length}（${fail[0].error}）`, 'error');
  else toast(`已处理 ${ok} 项`, 'success');
}

// ---------- 应用列表 ----------
async function loadApps() {
  const hint = el('apps-hint');
  hint.textContent = '正在读取已安装应用…';
  try {
    state.apps = await window.api.listApps();
    hint.textContent = state.apps.length ? `共 ${state.apps.length} 个应用` : '未读取到应用';
  } catch (e) {
    hint.textContent = '读取应用失败：' + e.message;
    state.apps = [];
  }
  renderApps();
}

function renderApps() {
  const ul = el('apps-list');
  const kw = el('app-search').value.trim().toLowerCase();
  ul.innerHTML = '';
  const list = state.apps.filter((a) => !kw || a.name.toLowerCase().includes(kw));
  if (list.length === 0) {
    ul.innerHTML = '<div class="hint">没有匹配的应用</div>';
    return;
  }
  for (const a of list) {
    const li = document.createElement('li');
    li.className = 'app-row';
    const meta = [a.publisher, a.version].filter(Boolean).join(' · ');
    li.innerHTML = `
      <div class="body">
        <div class="nm">${escapeHtml(a.name)}</div>
        <div class="sub">${escapeHtml(meta || '—')}</div>
      </div>
      <div class="sz">${a.size ? fmtBytes(a.size) : '大小未知'}</div>
      <button class="btn danger small" data-act="uninstall">卸载</button>`;
    li.querySelector('[data-act="uninstall"]').onclick = () => uninstall(a);
    ul.appendChild(li);
  }
}

async function uninstall(app) {
  if (!confirm(`确认卸载「${app.name}」？\n系统会启动它的卸载程序，请按提示操作。`)) return;
  const r = await window.api.uninstallApp(app);
  toast(r.message || (r.ok ? '已启动卸载' : '卸载失败'), r.ok ? 'success' : 'error');
}

// ---------- AI ----------
async function loadAIConfig() {
  try {
    const cfg = await window.api.getAIConfig();
    el('ai-key').value = cfg.apiKey || '';
    el('ai-base').value = cfg.baseUrl || 'https://api.deepseek.com';
    el('ai-model').value = cfg.model || 'deepseek-chat';
  } catch (e) { /* ignore */ }
}

async function saveAIConfig() {
  const cfg = {
    apiKey: el('ai-key').value.trim(),
    baseUrl: el('ai-base').value.trim(),
    model: el('ai-model').value.trim(),
  };
  try {
    await window.api.setAIConfig(cfg);
    toast('AI 设置已保存', 'success');
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
  }
}

async function runAI() {
  const btn = el('ai-analyze');
  btn.disabled = true;
  btn.textContent = '分析中…';
  const resultBox = el('ai-result');
  try {
    await window.api.setAIConfig({
      apiKey: el('ai-key').value.trim(),
      baseUrl: el('ai-base').value.trim(),
      model: el('ai-model').value.trim(),
    });

    // 汇总数据：磁盘 + 最大文件夹 + 最大文件 + 应用
    let apps = state.apps;
    if (!apps || apps.length === 0) {
      try { apps = await window.api.listApps(); state.apps = apps; } catch (e) { apps = []; }
    }
    const payload = {
      drives: state.drives.map((d) => ({ id: d.id, total: d.total, free: d.free, used: d.used })),
      largestFolders: state.topFolders.slice(0, 40).map((n) => ({ name: n.name, path: n.path, size: n.size })),
      largestFiles: state.largestFiles.slice(0, 40),
      apps: apps.slice(0, 40).map((a) => ({ name: a.name, size: a.size, publisher: a.publisher, version: a.version })),
      scanned: !!state.tree,
    };

    const result = await window.api.aiAnalyze(payload);
    state.aiSuggestions = (result.suggestions || []).filter(Boolean);
    el('ai-summary').textContent = result.summary || '';
    renderAISuggestions();
    resultBox.classList.remove('hidden');
    toast('AI 分析完成', 'success');
  } catch (e) {
    resultBox.classList.remove('hidden');
    el('ai-summary').textContent = '';
    el('ai-suggestions').innerHTML = '';
    toast('分析失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 开始分析';
  }
}

function renderAISuggestions() {
  const ul = el('ai-suggestions');
  ul.innerHTML = '';
  if (state.aiSuggestions.length === 0) {
    ul.innerHTML = '<div class="hint">AI 没有给出建议</div>';
    return;
  }
  const riskMap = { safe: ['safe', '安全'], medium: ['medium', '谨慎'], high: ['high', '高危'] };
  state.aiSuggestions.forEach((s, idx) => {
    const risk = riskMap[s.risk] || ['medium', '谨慎'];
    const li = document.createElement('li');
    li.className = 'app-row';
    const ico = s.type === 'app' ? '📦' : s.type === 'folder' ? '📁' : '📄';
    li.innerHTML = `
      <div class="body">
        <div class="nm">${ico} ${escapeHtml(s.name || s.path || '未命名')} <span class="badge ${risk[0]}">${risk[1]}</span></div>
        <div class="sub">${escapeHtml(s.reason || '')}</div>
        <div class="sub" style="color:#6b7486">${escapeHtml(s.path || '')}</div>
      </div>
      <div class="sz">${s.estimatedBytes ? fmtBytes(s.estimatedBytes) : ''}</div>
      <input type="checkbox" class="ck" data-idx="${idx}" ${s.risk === 'safe' ? 'checked' : ''} />`;
    ul.appendChild(li);
  });
}

async function executeAISelected() {
  const selected = [];
  el('ai-suggestions').querySelectorAll('input.ck:checked').forEach((ck) => {
    const s = state.aiSuggestions[Number(ck.dataset.idx)];
    if (s) selected.push(s);
  });
  if (selected.length === 0) { toast('请先勾选要清理的项目', 'error'); return; }

  const apps = selected.filter((s) => s.type === 'app');
  const items = selected.filter((s) => s.type !== 'app');

  if (!confirm(`确认执行清理？\n- 卸载应用 ${apps.length} 个\n- 删除文件/文件夹 ${items.length} 项（进回收站）\n\n系统关键目录会被自动跳过。`)) return;

  // 卸载应用
  for (const a of apps) {
    const target = state.apps.find((x) => x.name.toLowerCase() === (a.name || a.path || '').toLowerCase());
    if (target) await window.api.uninstallApp(target);
    else if (a.name || a.path) await window.api.uninstallApp({ name: a.name || a.path });
  }

  // 删除文件/文件夹（受保护目录自动跳过）
  if (items.length) {
    const results = await window.api.trashItems(items.map((i) => i.path), { allowProtected: false });
    const blocked = results.filter((r) => !r.ok);
    if (blocked.length) {
      toast(`清理完成，但有 ${blocked.length} 项因位于系统目录被跳过`, 'error');
    } else {
      toast('清理完成', 'success');
    }
  } else if (apps.length) {
    toast('已启动应用卸载', 'success');
  }
}

// ---------- 事件绑定 ----------
function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach((b) => (b.onclick = () => switchView(b.dataset.view)));

  el('scan-selected').onclick = () => {
    if (state.selectedDrive) startScan(state.selectedDrive.id + '\\');
  };
  el('scan-folder').onclick = async () => {
    const p = await window.api.selectFolder();
    if (p) startScan(p);
  };
  el('scan-cancel').onclick = () => window.api.scanCancel();

  el('select-all').onclick = () => {
    const cks = el('largest-list').querySelectorAll('input.ck');
    const allChecked = cks.length > 0 && Array.from(cks).every((c) => c.checked);
    cks.forEach((c) => (c.checked = !allChecked));
  };
  el('delete-selected').onclick = () => {
    const cks = Array.from(el('largest-list').querySelectorAll('input.ck:checked'));
    const paths = cks.map((c) => c.dataset.path);
    const kinds = cks.map((c) => c.dataset.kind);
    const items = paths.map((p, i) => ({ path: p, name: p.split(/[\\/]/).pop(), kind: kinds[i] }));
    deleteItems(items);
  };

  el('refresh-apps').onclick = () => loadApps();
  el('app-search').oninput = () => renderApps();

  el('ai-save').onclick = saveAIConfig;
  el('ai-analyze').onclick = runAI;
  el('ai-delete-selected').onclick = executeAISelected;

  window.api.onScanProgress((d) => {
    const box = el('scan-progress');
    if (box.classList.contains('hidden')) return;
    const label = box.querySelector('div');
    const bar = box.querySelector('.pbar > i');
    if (label) label.textContent = `扫描中… ${fmtCount(d.fileCount || 0)} 个文件 · ${d.currentPath || ''}`;
    if (bar) bar.style.width = '100%';
  });

  window.addEventListener('resize', resizeCanvas);
}

// ---------- 启动 ----------
bindEvents();
loadDrives();
loadAIConfig();
resizeCanvas();
