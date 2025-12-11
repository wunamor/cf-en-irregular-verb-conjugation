// ==========================================
// ⚙️ 全局配置 (前端设置)
// ==========================================
const CONFIG = {
  // 批量导入时，每次向后端发送的数据条数
  BATCH_SIZE: 500,

  // --- 手机端设置 (< 768px) ---
  MOBILE_PAGE_SIZE: 3,         // 手机默认显示条数
  MOBILE_OPTIONS: [3, 6, 12],  // 手机可选条数

  // --- PC 端设置 (>= 768px) ---
  PC_PAGE_SIZE: 10,            // PC 默认显示条数
  PC_OPTIONS: [5, 10, 20, 50], // PC 可选条数

  // 搜索请求的防抖延迟 (毫秒)
  DEBOUNCE_MS: 300
};

// ==========================================
// 🚀 核心逻辑
// ==========================================

// --- 核心变量 ---
let currentPage = 1;
let totalPages = 1;
let selectedIds = new Set();
let csvData = [];

window.onload = async () => {
  // 1. 优先从后端加载配置 (覆盖默认值)
  await loadRemoteConfig();

  // 2. 恢复管理员状态
  if (localStorage.getItem('adminKey')) toggleAdmin(true);

  // 3. 动态生成“每页显示”的选项 (此时 CONFIG 已经是最新值)
  initPageSizeSelect();

  // 4. 执行首次搜索
  doSearch();
};

/**
 * 从后端获取环境变量配置
 */
async function loadRemoteConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const remote = await res.json();
      // 遍历后端返回的配置，只有非空的值才覆盖本地默认值
      for (const key in remote) {
        if (remote[key] !== undefined && remote[key] !== null) {
          CONFIG[key] = remote[key];
        }
      }
      console.log("Config loaded:", CONFIG);
    }
  } catch (e) {
    console.warn("Failed to load remote config, using defaults.");
  }
}


/**
 * 根据设备类型初始化分页下拉框
 * 读取 CONFIG 中的配置来生成 <option>
 */
function initPageSizeSelect() {
  const select = document.getElementById('pageSize');
  if (!select) return;

  // 检测是否为手机端
  const isMobile = window.innerWidth < 768;

  // 获取对应的配置
  const options = isMobile ? CONFIG.MOBILE_OPTIONS : CONFIG.PC_OPTIONS;
  const defaultSize = isMobile ? CONFIG.MOBILE_PAGE_SIZE : CONFIG.PC_PAGE_SIZE;

  // 清空 HTML 中硬编码的 option
  select.innerHTML = '';

  // 动态生成 option 标签
  options.forEach(opt => {
    const el = document.createElement('option');
    el.value = opt;
    el.innerText = opt;
    // 如果等于默认值，设为选中
    if (opt === defaultSize) {
      el.selected = true;
    }
    select.appendChild(el);
  });

  // 强制设置当前值为默认值 (双重保险)
  select.value = defaultSize;
}

// --- 1. 搜索与渲染列表 ---
function resetSearch() {
  currentPage = 1;
  selectedIds.clear();
  doSearch();
}

async function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  const limit = document.getElementById('pageSize').value; // 这里获取的就是动态生成的值
  const mode = document.querySelector('input[name="mode"]:checked').value;

  document.getElementById('resultArea').classList.remove('hidden');

  try {
    const res = await fetch(
      `/api/search?q=${encodeURIComponent(q)}&page=${currentPage}&limit=${limit}&mode=${mode}`
    );
    const json = await res.json();

    totalPages = Math.ceil((json.total || 0) / limit);
    renderTable(json.data);
    renderPagination(totalPages);
  } catch (e) {
    console.error(e);
  }
}

function renderTable(data) {
  const div = document.getElementById('tableContainer');
  if (!data || data.length === 0) {
    div.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-sub)">暂无数据</div>';
    return;
  }
  const isAdmin = !!localStorage.getItem('adminKey');

  let th = `<thead><tr>`;
  if (isAdmin) th += `<th style="width:40px"><input type="checkbox" id="selectAll" onclick="toggleAll()"></th>`;
  th += `<th>原形</th><th>过去式</th><th>过去分词</th><th>释义</th><th>备注</th>`;
  if (isAdmin) {
    const delBtn =
      selectedIds.size > 0
        ? `<button class="btn btn-danger" style="padding:2px 8px; font-size:0.8rem" onclick="batchDeleteClick()">删 (${selectedIds.size})</button>`
        : `<span>操作</span>`;
    th += `<th style="width:140px; text-align:right">${delBtn}</th>`;
  }
  th += `</tr></thead>`;

  let rows = data
    .map((item) => {
      const json = JSON.stringify(item).replace(/"/g, '&quot;');
      const checked = selectedIds.has(item.id) ? 'checked' : '';

      let tr = `<tr>`;
      if (isAdmin)
        tr += `<td data-label="选择"><input type="checkbox" class="row-cb" value="${item.id}" ${checked} onclick="toggleRow(${item.id})"></td>`;
      tr += `
        <td data-label="原形" class="text-primary" style="font-weight:bold">${item.base_word}</td>
        <td data-label="过去式">${item.past_tense}</td>
        <td data-label="过去分词">${item.past_participle}</td>
        <td data-label="释义">${item.definition || ''}</td>
        <td data-label="备注" style="color:var(--text-sub); font-size:0.85rem">${item.note || ''}</td>
    `;
      if (isAdmin)
        tr += `
        <td data-label="操作" style="text-align:right">
            <button class="btn btn-outline btn-sm" onclick="editItem(${json})">改</button>
            <button class="btn btn-danger btn-sm" style="margin-left:5px" onclick="delItemClick(${item.id})">删</button>
        </td>
    `;
      tr += `</tr>`;
      return tr;
    })
    .join('');

  div.innerHTML = `<table>${th}<tbody>${rows}</tbody></table>`;

  if (isAdmin && document.getElementById('selectAll')) {
    const allRows = document.querySelectorAll('.row-cb');
    if (allRows.length > 0 && Array.from(allRows).every((cb) => cb.checked)) {
      document.getElementById('selectAll').checked = true;
    }
  }
}

// --- 2. 批量操作逻辑 ---
function toggleAll() {
  const master = document.getElementById('selectAll');
  document.querySelectorAll('.row-cb').forEach((cb) => {
    cb.checked = master.checked;
    const id = parseInt(cb.value);
    if (master.checked) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  doSearch();
}

function toggleRow(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  doSearch();
}

function batchDeleteClick() {
  showConfirmModal(`确定要删除选中的 ${selectedIds.size} 个单词吗？`, async () => {
    const ids = Array.from(selectedIds);
    await fetch('/api/batch_delete', {
      method: 'POST',
      headers: { 'Admin-Key': localStorage.getItem('adminKey') },
      body: JSON.stringify({ ids }),
    });
    showToast('批量删除成功');
    selectedIds.clear();
    doSearch();
  });
}

function delItemClick(id) {
  showConfirmModal('确定删除这个单词吗？', async () => {
    await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Admin-Key': localStorage.getItem('adminKey') },
      body: JSON.stringify({ id }),
    });
    showToast('已删除');
    doSearch();
  });
}

// --- 3. 弹窗控制 ---
function showConfirmModal(msg, actionCallback, isHtml = false) {
  const modal = document.getElementById('confirmModal');
  const msgDiv = document.getElementById('confirmMsg');

  if (isHtml) {
    msgDiv.innerHTML = msg;
  } else {
    msgDiv.innerText = msg;
  }

  modal.classList.remove('hidden');

  const btn = document.getElementById('confirmActionBtn');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', () => {
    actionCallback();
    closeModal('confirmModal');
  });
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// --- 4. 分页逻辑 ---
function renderPagination(total) {
  const el = document.getElementById('pagination');
  let html = '';

  const cur = parseInt(currentPage) || 1;
  const totalPg = parseInt(total) || 1;

  html += `<div class="page-btn" onclick="changePage(${cur - 1})">‹</div>`;

  let start = Math.max(1, cur - 2);
  let end = Math.min(totalPg, cur + 2);

  if (end - start < 4) {
    if (start === 1) end = Math.min(totalPg, start + 4);
    else if (end === totalPg) start = Math.max(1, end - 4);
  }

  if (start > 1) {
    html += `<div class="page-btn ${1 === cur ? 'active' : ''}" onclick="changePage(1)">1</div>`;
    if (start > 2)
      html += `<span style="color:var(--text-sub); padding:0 5px; display:flex; align-items:flex-end;">...</span>`;
  }

  for (let i = start; i <= end; i++) {
    const isActive = i === cur ? 'active' : '';
    html += `<div class="page-btn ${isActive}" onclick="changePage(${i})">${i}</div>`;
  }

  if (end < totalPg) {
    if (end < totalPg - 1)
      html += `<span style="color:var(--text-sub); padding:0 5px; display:flex; align-items:flex-end;">...</span>`;
    html += `<div class="page-btn ${totalPg === cur ? 'active' : ''
      }" onclick="changePage(${totalPg})">${totalPg}</div>`;
  }

  html += `<div class="page-btn" onclick="changePage(${cur + 1})">›</div>`;
  html += `<input class="input page-input" id="jumpInput" placeholder="Go" onkeydown="if(event.key==='Enter') jumpPage()">`;

  el.innerHTML = html;
}

function changePage(p) {
  if (p < 1 || p > totalPages) return;
  currentPage = p;
  doSearch();
}
function jumpPage() {
  const p = parseInt(document.getElementById('jumpInput').value);
  if (p) changePage(p);
}

// --- 5. 导入逻辑 ---
function handleDelim() {
  const val = document.getElementById('delimSelect').value;
  const custom = document.getElementById('customDelim');
  if (val === 'custom') {
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.value = val;
  }
  parseFile();
}

function parseFile() {
  const fileInput = document.getElementById('fileInput');
  const file = fileInput.files[0];

  if (!file) {
    csvData = [];
    document.getElementById('mappingArea').classList.add('hidden');
    document.getElementById('mappingContainer').innerHTML = '';
    return;
  }

  const delim = document.getElementById('customDelim').value;
  if (!delim) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    csvData = lines.map((l) => l.split(delim).map((c) => c.trim()));
    if (csvData.length > 0) renderMapping(csvData[0]);
  };
  reader.readAsText(file);
}

function renderMapping(previewRow) {
  document.getElementById('mappingArea').classList.remove('hidden');
  const container = document.getElementById('mappingContainer');
  container.innerHTML = '';

  const fields = [
    { k: 'base', t: '单词原形 (Base)' },
    { k: 'past', t: '过去式 (Past)' },
    { k: 'part', t: '过去分词' },
    { k: 'def', t: '中文释义' },
    { k: 'note', t: '备注' },
  ];
  let opts = `<option value="">(忽略此字段)</option>`;
  previewRow.forEach((v, i) => { opts += `<option value="${i}">列 ${i + 1}: ${v.substring(0, 15)}...</option>`; });
  fields.forEach((f, idx) => {
    const selected = idx < previewRow.length ? `value="${idx}" selected` : '';
    container.innerHTML += `
            <div class="mapping-row">
                <div class="mapping-label">${f.t}</div>
                <select class="input map-select" data-key="${f.k}">${opts.replace(`value="${idx}"`, selected)}</select>
            </div>`;
  });
}

async function executeImport() {
  const selects = document.querySelectorAll('.map-select');
  const map = {};
  selects.forEach((s) => { if (s.value) map[s.dataset.key] = s.value; });
  if (!map.base) return showToast('必须映射原形字段', 'error');

  const mode = document.querySelector('input[name="importMode"]:checked').value;
  const payload = csvData.map((r) => ({
    base: r[map.base] || '', past: r[map.past] || '', part: r[map.part] || '',
    def: r[map.def] || '', note: r[map.note] || '',
  })).filter((i) => i.base);

  const btn = document.getElementById('btnStartImport');
  const status = document.getElementById('importStatus');
  const pBar = document.getElementById('importProgressBar');
  const pFill = document.getElementById('importProgressFill');

  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.innerText = '导入中...';
  pBar.classList.remove('hidden');
  pFill.style.width = '0%';
  status.innerText = '准备开始...';

  // 使用 CONFIG 中的配置
  const BATCH = CONFIG.BATCH_SIZE;
  let processedCount = 0;

  try {
    for (let i = 0; i < payload.length; i += BATCH) {
      const chunk = payload.slice(i, i + BATCH);

      await fetch('/api/batch_add', {
        method: 'POST',
        headers: { 'Admin-Key': localStorage.getItem('adminKey') },
        body: JSON.stringify({ rows: chunk, mode }),
      });

      processedCount += chunk.length;
      const percent = Math.min(100, Math.round((processedCount / payload.length) * 100));
      pFill.style.width = percent + '%';
      status.innerText = `正在处理: ${percent}% (${processedCount}/${payload.length})`;
    }

    status.innerText = `完成！共 ${payload.length} 条`;
    showToast('导入成功');
    setTimeout(() => {
      resetSearch();
      document.getElementById('fileInput').value = '';
      parseFile();
      pBar.classList.add('hidden');
      status.innerText = '';
    }, 1500);
  } catch (e) {
    console.error(e);
    status.innerText = '上传中断，请检查网络';
    showToast('导入失败', 'error');
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.innerText = '开始导入';
  }
}

// --- 6. 通用管理 ---
function switchTab(t) {
  document.getElementById('tab-single').classList.toggle('hidden', t !== 'single');
  document.getElementById('tab-batch').classList.toggle('hidden', t !== 'batch');
}
function editItem(item) {
  document.getElementById('editId').value = item.id;
  document.getElementById('base').value = item.base_word;
  document.getElementById('past').value = item.past_tense;
  document.getElementById('part').value = item.past_participle;
  document.getElementById('def').value = item.definition;
  document.getElementById('note').value = item.note || '';
  document.getElementById('adminPanel').classList.remove('hidden');
  switchTab('single');
  document.getElementById('cancelEdit').classList.remove('hidden');
  document.getElementById('adminPanel').scrollIntoView({ behavior: 'smooth' });
}

async function saveSingle() {
  const id = document.getElementById('editId').value;
  const body = {
    id,
    base: document.getElementById('base').value.trim(),
    past: document.getElementById('past').value.trim(),
    part: document.getElementById('part').value.trim(),
    def: document.getElementById('def').value.trim(),
    note: document.getElementById('note').value.trim(),
  };

  if (!body.base || !body.past || !body.part) {
    return showToast('请填写完整 (原形/过去式/过去分词)', 'error');
  }

  if (id) {
    await fetch('/api/update', {
      method: 'POST',
      headers: { 'Admin-Key': localStorage.getItem('adminKey') },
      body: JSON.stringify(body),
    });
    showToast('修改成功');
    resetSearch();
    resetForm();
    return;
  }

  const searchRes = await fetch(`/api/search?q=${encodeURIComponent(body.base)}&mode=exact`);
  const searchJson = await searchRes.json();

  const duplicate = searchJson.data.find(
    (item) =>
      item.base_word.toLowerCase() === body.base.toLowerCase() &&
      item.past_tense.toLowerCase() === body.past.toLowerCase()
  );

  const doAdd = async (mode) => {
    await fetch('/api/batch_add', {
      method: 'POST',
      headers: { 'Admin-Key': localStorage.getItem('adminKey') },
      body: JSON.stringify({ rows: [body], mode: mode }),
    });
    showToast(mode === 'update' ? '已覆盖并保存' : '保存成功');
    resetSearch();
    resetForm();
  };

  if (duplicate) {
    const tableHtml = `
            <div style="margin-bottom:10px; color:var(--text-main)">检测到已存在的单词形式，是否覆盖？</div>
            <table style="width:100%; border:1px solid var(--border); font-size:0.9rem;">
                <tr style="background:var(--bg-body); color:var(--text-sub)">
                    <th style="padding:8px">字段</th>
                    <th style="padding:8px">当前存在 (Old)</th>
                    <th style="padding:8px; color:var(--primary)">准备提交 (New)</th>
                </tr>
                <tr>
                    <td style="padding:8px; color:var(--text-sub)">原形</td>
                    <td style="padding:8px">${duplicate.base_word}</td>
                    <td style="padding:8px; font-weight:bold">${body.base}</td>
                </tr>
                <tr>
                    <td style="padding:8px; color:var(--text-sub)">过去式</td>
                    <td style="padding:8px">${duplicate.past_tense}</td>
                    <td style="padding:8px; font-weight:bold">${body.past}</td>
                </tr>
                <tr>
                    <td style="padding:8px; color:var(--text-sub)">过去分词</td>
                    <td style="padding:8px">${duplicate.past_participle}</td>
                    <td style="padding:8px; color:${duplicate.past_participle !== body.part ? 'var(--primary)' : 'inherit'}">${body.part}</td>
                </tr>
                <tr>
                    <td style="padding:8px; color:var(--text-sub)">释义</td>
                    <td style="padding:8px">${duplicate.definition || '-'}</td>
                    <td style="padding:8px; color:${(duplicate.definition || '') !== body.def ? 'var(--primary)' : 'inherit'}">${body.def}</td>
                </tr>
                <tr>
                    <td style="padding:8px; color:var(--text-sub)">备注</td>
                    <td style="padding:8px">${duplicate.note || '-'}</td>
                    <td style="padding:8px; color:${(duplicate.note || '') !== body.note ? 'var(--primary)' : 'inherit'}">${body.note}</td>
                </tr>
            </table>
            <div style="margin-top:10px; font-size:0.8rem; color:var(--danger)">注意：覆盖操作不可撤销。</div>
        `;

    showConfirmModal(tableHtml, () => doAdd('update'), true);
    document.getElementById('confirmActionBtn').innerText = '覆盖保存';
  } else {
    await doAdd('skip');
  }
}

function resetForm() {
  document.getElementById('editId').value = '';
  document.querySelectorAll('#tab-single input').forEach((i) => (i.value = ''));
  document.getElementById('cancelEdit').classList.add('hidden');
}

function showLogin() {
  document.getElementById('loginModal').classList.remove('hidden');
}

async function confirmLogin() {
  const pass = document.getElementById('modalPass').value;
  const btn = document.querySelector('#loginModal .btn-primary');
  const originalText = btn.innerText;
  btn.innerText = '验证中...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass }),
    });

    const data = await res.json();

    if (res.ok && data.success) {
      localStorage.setItem('adminKey', pass);
      closeModal('loginModal');
      toggleAdmin(true);
      showToast('登录成功');
      document.getElementById('modalPass').value = '';
    } else {
      showToast('密码错误', 'error');
      localStorage.removeItem('adminKey');
    }
  } catch (e) {
    console.error(e);
    showToast('网络请求失败', 'error');
  } finally {
    btn.innerText = originalText;
    btn.disabled = false;
  }
}

function confirmLogout() {
  showConfirmModal('确定要退出登录吗？', () => {
    localStorage.removeItem('adminKey');
    toggleAdmin(false);
    showToast('已退出登录');
  });
}

function logout() {
  localStorage.removeItem('adminKey');
  toggleAdmin(false);
}
function toggleAdmin(show) {
  document.getElementById('adminPanel').classList.toggle('hidden', !show);
  document.getElementById('loginBtn').classList.toggle('hidden', show);
  document.getElementById('logoutBtn').classList.toggle('hidden', !show);
  if (document.querySelector('table')) doSearch();
}
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.className = `toast show ${type || ''}`;
  setTimeout(() => (t.className = 'toast'), 2000);
}

// --- 7. 导出功能 ---

function showExportModal() {
  document.getElementById('exportModal').classList.remove('hidden');
  document.getElementById('exportDelimSelect').value = ',';
  toggleExportCustom();
}

function toggleExportCustom() {
  const val = document.getElementById('exportDelimSelect').value;
  const customInput = document.getElementById('exportCustomDelim');
  if (val === 'custom') {
    customInput.classList.remove('hidden');
    customInput.focus();
  } else {
    customInput.classList.add('hidden');
  }
}

async function executeExport() {
  const btn = document.getElementById('btnExecuteExport');
  const originalText = btn.innerText;
  btn.disabled = true;
  btn.innerText = '正在下载...';

  try {
    const q = document.getElementById('searchInput').value.trim();
    const mode = document.querySelector('input[name="mode"]:checked').value;

    const selectVal = document.getElementById('exportDelimSelect').value;
    let delim = selectVal;
    if (selectVal === 'custom') {
      delim = document.getElementById('exportCustomDelim').value;
    }
    if (!delim) {
      showToast('请输入分隔符', 'error');
      return;
    }

    const res = await fetch(`/api/export?q=${encodeURIComponent(q)}&mode=${mode}&delim=${encodeURIComponent(delim)}`);

    if (!res.ok) throw new Error('导出失败');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const ext = selectVal === '	' ? 'txt' : 'csv';
    const fileNamePrefix = q ? `verbs_search_${q}` : `verbs_all`;

    link.setAttribute('href', url);
    link.setAttribute('download', `${fileNamePrefix}_${date}.${ext}`);

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(url), 100);

    showToast('导出成功');
    closeModal('exportModal');

  } catch (e) {
    console.error(e);
    showToast('导出失败，请重试', 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = originalText;
  }
}