'use strict';

const state = { projects: [], groups: [], search: '', noteEditing: false, groupEditing: false, dragging: false, paletteOpen: false };
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// —— 主题切换（深色 / 亮色，localStorage 持久化，默认跟随系统） ——
function syncThemeButton() {
  const btn = $('#btn-theme');
  if (!btn) return;
  // 按钮图标显示"将要切换到"的模式
  const light = document.documentElement.dataset.theme === 'light';
  btn.textContent = light ? '🌙' : '☀️';
  btn.title = light ? '切换到深色模式' : '切换到亮色模式';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('wb-theme', theme);
  } catch { /* 忽略 */ }
  syncThemeButton();
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATUS_META = {
  running: { label: '运行中', cls: 'ok' },
  stopped: { label: '已停止', cls: 'off' },
  starting: { label: '启动中', cls: 'warn' },
  unknown: { label: '未知', cls: 'warn2' },
  idle: { label: '静态', cls: 'info' },
};

const TYPE_LABEL = { script: '脚本', docker: 'Docker', static: '静态' };

let toastTimer = null;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 4000 : 2500);
}

async function refresh() {
  try {
    const [pData, gData] = await Promise.all([API.list(), API.groups()]);
    state.projects = pData.projects;
    state.groups = gData.groups;
    $('#poll-state').textContent = `5s 自动刷新 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    // 正在编辑名字备注/分组名、拖拽中或调色盘展开时不重绘，避免打断操作
    if (!state.noteEditing && !state.groupEditing && !state.dragging && !state.paletteOpen) render();
  } catch (e) {
    $('#poll-state').textContent = '刷新失败，重试中…';
  }
}

function find(id) {
  return state.projects.find((p) => p.id === id);
}

function filtered() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.projects;
  return state.projects.filter((p) =>
    [p.name, p.description, p.notes, ...(p.tags || []), ...(p.dependencies || [])]
      .join(' ')
      .toLowerCase()
      .includes(q)
  );
}

function portChips(p) {
  const entries = p.status && p.status.ports
    ? Object.entries(p.status.ports).map(([k, v]) => [k, v])
    : (p.ports || []).map((x) => [x, null]);
  if (!entries.length) return '';
  return `<div class="chips">${entries
    .map(
      ([port, up]) =>
        `<span class="chip port ${up === true ? 'up' : up === false ? 'down' : 'unknown'}" title="${up === true ? '端口开放' : up === false ? '端口未监听' : '状态未知'}">${esc(port)}<i></i></span>`
    )
    .join('')}</div>`;
}

function chipList(items, cls) {
  if (!items || !items.length) return '';
  return `<div class="chips">${items.map((x) => `<span class="chip ${cls}">${esc(x)}</span>`).join('')}</div>`;
}

const PALETTE = [
  ['red', '红'], ['orange', '橙'], ['yellow', '黄'], ['green', '绿'],
  ['cyan', '青'], ['blue', '蓝'], ['purple', '紫'],
];

function cardHTML(p) {
  const st = STATUS_META[p.status.status] || STATUS_META.unknown;
  const cap = p.capabilities || {};
  const buttons = [];

  if (cap.canStart) buttons.push(['start', '▶ 启动', '']);
  if (cap.canStop) buttons.push(['stop', '■ 停止', '']);
  if (cap.canRestart) buttons.push(['restart', '⟳ 重启', '']);
  if (cap.canUpdate) buttons.push(['update', '⬇ 更新', '']);
  if (cap.canOpen) buttons.push(['open', '↗ 打开', 'accent']);
  buttons.push(['logs', '☰ 日志', '']);
  const paletteHTML = `<span class="palette-wrap">
    <button class="btn sm ghost" data-act="palette" type="button" title="背景颜色">🎨</button>
    <span class="palette-pop" hidden>
      <button class="swatch sw-none${p.color ? '' : ' active'}" data-swatch="" type="button" title="默认"></button>
      ${PALETTE.map(([c, t]) => `<button class="swatch sw-${c}${p.color === c ? ' active' : ''}" data-swatch="${c}" type="button" title="${t}"></button>`).join('')}
    </span>
  </span>`;
  buttons.push(['edit', '✎ 编辑', 'ghost']);
  buttons.push(['delete', '🗑', 'ghost danger']);

  const lastExit =
    p.status.status === 'stopped' && p.status.lastExit
      ? `<span class="last-exit" title="${esc(p.status.lastExit.at)}">上次退出 code=${esc(p.status.lastExit.code)}</span>`
      : '';

  const markRow =
    p.status.status === 'unknown'
      ? `<div class="mark-row">实际状态：<button class="btn mini" data-act="mark-running">运行中</button><button class="btn mini" data-act="mark-stopped">已停止</button>${p.status.reason ? `<span class="reason" title="${esc(p.status.reason)}">ⓘ</span>` : ''}</div>`
      : '';

  return `
<article class="card${p.status.status === 'running' ? ' running' : ''}${p.color ? ' c-' + p.color : ''}" draggable="true" data-id="${esc(p.id)}">
  <div class="card-head">
    <span class="dot ${st.cls}" title="${st.label}"></span>
    <h3 class="name" title="${esc(p.id)}">${esc(p.name)}</h3>
    <span class="type-badge">${esc(TYPE_LABEL[p.type] || p.type)}</span>
    <span class="status-label ${st.cls}">${st.label}</span>
  </div>
  <input class="name-note" type="text" maxlength="200" spellcheck="false"
         placeholder="名字备注…（回车保存）" value="${esc(p.nameNote || '')}"
         data-orig="${esc(p.nameNote || '')}" data-namenote="${esc(p.id)}">
  ${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
  ${p.path ? `<div class="path" data-copy="${esc(p.path)}" title="点击复制路径">📁 <code>${esc(p.path)}</code></div>` : ''}
  ${portChips(p)}
  ${chipList(p.dependencies, 'dep')}
  ${chipList(p.tags, 'tag')}
  ${p.notes ? `<p class="notes" title="${esc(p.notes)}">📝 ${esc(p.notes)}</p>` : ''}
  ${markRow}
  ${lastExit}
  <div class="card-actions">
    ${paletteHTML}
    ${buttons.map(([act, label, cls]) => `<button class="btn sm ${cls}" data-act="${act}" type="button">${label}</button>`).join('')}
  </div>
</article>`;
}

function render() {
  const list = filtered();
  const searching = state.search.trim() !== '';
  // 分组区块：按 order 排序的组 + 固定在最后的"未分组"
  const sections = [...state.groups]
    .sort((a, b) => a.order - b.order)
    .map((g) => ({ id: g.id, name: g.name, cards: list.filter((p) => p.groupId === g.id) }));
  sections.push({
    id: '',
    name: '未分组',
    cards: list.filter((p) => !p.groupId || !state.groups.some((g) => g.id === p.groupId)),
    ungrouped: true,
  });
  // 排序：运行中优先置顶，其次按 order 升序（拖拽排序写入），未拖过的按原相对顺序
  for (const s of sections) {
    const tier = (p) => (p.status.status === 'running' ? 0 : 1);
    s.cards.sort((a, b) => tier(a) - tier(b) || (a.order ?? Infinity) - (b.order ?? Infinity));
  }
  const visible = searching ? sections.filter((s) => s.cards.length) : sections;
  $('#empty').hidden = visible.some((s) => s.cards.length);
  $('#grid').innerHTML = visible.map(sectionHTML).join('');
}

function sectionHTML(s) {
  const head = s.ungrouped
    ? `<div class="group-head" data-group="">
        <span class="group-name-static">未分组</span>
        <span class="group-count">${s.cards.length}</span>
      </div>`
    : `<div class="group-head" draggable="true" data-group="${esc(s.id)}" title="拖动可调整分组顺序">
        <span class="grip">⠿</span>
        <input class="group-name-input" value="${esc(s.name)}" maxlength="60" spellcheck="false"
               data-group="${esc(s.id)}" data-orig="${esc(s.name)}" title="点击重命名分组">
        <span class="group-count">${s.cards.length}</span>
        <span class="group-actions">
          <button class="btn mini ghost danger" data-gact="dissolve" data-group="${esc(s.id)}"
                  title="解散分组，组内项目移回未分组">解散</button>
        </span>
      </div>`;
  return `<section class="group${s.cards.length ? '' : ' empty-group'}" data-group="${esc(s.id)}">
    ${head}
    <div class="grid">${s.cards.map(cardHTML).join('')}</div>
  </section>`;
}

async function doAction(id, act) {
  const btnLabel = { start: '启动', stop: '停止', restart: '重启', update: '更新', open: '打开' }[act] || act;
  try {
    const r = await API.action(id, act);
    toast(r.message || `${btnLabel}成功`);
  } catch (e) {
    toast(`${btnLabel}失败: ${e.message}`, true);
  }
  refresh();
}

async function onCardAction(id, act) {
  const p = find(id);
  if (!p) return;
  switch (act) {
    case 'edit':
      openEditDialog(p);
      break;
    case 'logs':
      openLogDialog(p);
      break;
    case 'delete':
      if (!confirm(`确定删除项目「${p.name}」？\n仅移除工作台记录，不会删除磁盘上的文件。`)) return;
      try {
        await API.remove(id);
        toast('已删除');
      } catch (e) {
        toast(e.message, true);
      }
      refresh();
      break;
    case 'mark-running':
    case 'mark-stopped': {
      const status = act === 'mark-running' ? 'running' : 'stopped';
      try {
        const r = await API.mark(id, status);
        toast(r.message);
      } catch (e) {
        toast(e.message, true);
      }
      refresh();
      break;
    }
    default:
      doAction(id, act);
  }
}

// —— 名字备注：就地编辑。保存路径有三条（互为备份，兼容不发焦点事件的环境）：
// 输入停顿 800ms 自动保存 / 回车立即保存 / 失焦保存；Esc 还原到上次保存值 ——
let nameNoteTimer = null;

async function commitNameNote(input) {
  clearTimeout(nameNoteTimer);
  const id = input.closest('.card')?.dataset.id;
  if (!id) return;
  const val = input.value.trim();
  const orig = input.dataset.orig ?? '';
  if (val !== orig) {
    try {
      await API.patch(id, { nameNote: val });
      const p = find(id);
      if (p) p.nameNote = val;
      input.dataset.orig = val;
      toast('名字备注已保存');
    } catch (e) {
      toast(e.message, true);
    }
  }
  // 仍聚焦说明用户可能继续输入：保持编辑态（暂停轮询重绘），等失焦再恢复
  if (document.activeElement !== input) {
    state.noteEditing = false;
    refresh();
  }
}

function onNameNoteInput(e) {
  state.noteEditing = true;
  clearTimeout(nameNoteTimer);
  nameNoteTimer = setTimeout(() => commitNameNote(e.target), 800);
}

// —— 分组：就地重命名 / 解散 / 新建 / 拖拽 ——
let groupNameTimer = null;

async function commitGroupName(input) {
  clearTimeout(groupNameTimer);
  const id = input.dataset.group;
  if (!id) return;
  const val = input.value.trim();
  const orig = input.dataset.orig ?? '';
  if (val !== orig) {
    if (!val) {
      input.value = orig;
      return;
    }
    try {
      const r = await API.updateGroup(id, { name: val });
      const g = state.groups.find((x) => x.id === id);
      if (g) g.name = r.group.name;
      input.dataset.orig = r.group.name;
      toast('分组已重命名');
    } catch (e) {
      toast(e.message, true);
      input.value = orig;
    }
  }
  if (document.activeElement !== input) {
    state.groupEditing = false;
    refresh();
  }
}

function onGroupNameInput(e) {
  state.groupEditing = true;
  clearTimeout(groupNameTimer);
  groupNameTimer = setTimeout(() => commitGroupName(e.target), 800);
}

async function onCreateGroup() {
  const name = prompt('分组名称：', '新建分组');
  if (name === null) return;
  const n = name.trim();
  if (!n) return toast('分组名不能为空', true);
  try {
    await API.createGroup(n);
    toast('分组已创建，把项目拖进来吧');
    refresh();
  } catch (e) {
    toast(e.message, true);
  }
}

async function onDissolveGroup(id) {
  const g = state.groups.find((x) => x.id === id);
  if (!g) return;
  const count = state.projects.filter((p) => p.groupId === id).length;
  if (!confirm(`解散分组「${g.name}」？${count ? `组内 ${count} 个项目将移回未分组。` : ''}`)) return;
  try {
    await API.removeGroup(id);
    toast('分组已解散');
  } catch (e) {
    toast(e.message, true);
  }
  refresh();
}

// —— 拖拽：卡片拖入/拖出分组、组内拖动排序；分组头部拖动排序 ——
let dragProjectId = null;
let dropMark = null; // { el, cls }

function clearDrop() {
  if (dropMark) dropMark.el.classList.remove(dropMark.cls);
  dropMark = null;
}

function setDropMark(el, cls) {
  if (dropMark && dropMark.el === el && dropMark.cls === cls) return;
  clearDrop();
  dropMark = { el, cls };
  el.classList.add(cls);
}

function onDragStart(e) {
  // 输入框区域不发起拖拽（否则无法用鼠标选中框内文字）
  if (e.target.closest && e.target.closest('input, textarea, select')) {
    e.preventDefault();
    return;
  }
  const groupHead = e.target.closest('.group-head[draggable="true"]');
  const card = e.target.closest('.card[draggable="true"]');
  if (groupHead) {
    e.dataTransfer.setData('text/x-wb-group', groupHead.dataset.group);
    state.dragging = true;
  } else if (card) {
    dragProjectId = card.dataset.id;
    e.dataTransfer.setData('text/x-wb-project', dragProjectId);
    state.dragging = true;
  }
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  const types = [...e.dataTransfer.types];
  const isProject = types.includes('text/x-wb-project');
  const isGroup = types.includes('text/x-wb-group');
  if (!isProject && !isGroup) return;

  if (isProject) {
    // 悬停在其他卡片上：按鼠标在上/下半区决定插到目标卡前/后
    const cardEl = e.target.closest('.card[draggable="true"]');
    if (cardEl && cardEl.dataset.id !== dragProjectId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = cardEl.getBoundingClientRect();
      setDropMark(cardEl, e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
      return;
    }
  }
  const section = e.target.closest('.group');
  if (isProject && section) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropMark(section, 'drop-target-group');
    return;
  }
  if (isGroup) {
    const head = e.target.closest('.group-head[data-group]:not([data-group=""])');
    if (head && head.dataset.group) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropMark(head, 'drop-target-head');
    }
  }
}

async function onDrop(e) {
  clearDrop();
  const section = e.target.closest('.group');
  const projectId = e.dataTransfer.getData('text/x-wb-project');
  if (projectId) {
    e.preventDefault();
    const cardEl = e.target.closest('.card[draggable="true"]');
    if (cardEl && cardEl.dataset.id !== projectId) {
      // 插到目标卡前/后：重建目标卡所在区块的卡片顺序
      const targetId = cardEl.dataset.id;
      const sectionEl = cardEl.closest('.group');
      const rect = cardEl.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      const ids = [...sectionEl.querySelectorAll('.card')].map((c) => c.dataset.id).filter((id) => id !== projectId);
      ids.splice(ids.indexOf(targetId) + (before ? 0 : 1), 0, projectId);
      const currentGroup = find(projectId)?.groupId ?? null;
      const targetGroup = sectionEl.dataset.group || null;
      try {
        await API.reorderProjects(ids);
        if ((currentGroup || null) !== targetGroup) await API.patch(projectId, { groupId: targetGroup });
        toast('已调整位置');
      } catch (err) {
        toast(err.message, true);
      }
      state.dragging = false;
      dragProjectId = null;
      refresh();
      return;
    }
    if (section) {
      // 落在组内空白处：移动分组（服务端自动排到该组末尾）
      e.preventDefault();
      const gid = section.dataset.group || null;
      try {
        await API.patch(projectId, { groupId: gid });
        toast(gid ? '已移入分组' : '已移出分组');
      } catch (err) {
        toast(err.message, true);
      }
      state.dragging = false;
      dragProjectId = null;
      refresh();
      return;
    }
  }
  const groupId = e.dataTransfer.getData('text/x-wb-group');
  const head = e.target.closest('.group-head[data-group]');
  if (groupId && head && head.dataset.group && head.dataset.group !== groupId) {
    e.preventDefault();
    const order = [...state.groups].sort((a, b) => a.order - b.order).map((g) => g.id);
    order.splice(order.indexOf(groupId), 1);
    order.splice(order.indexOf(head.dataset.group), 0, groupId);
    try {
      await API.reorderGroups(order);
      toast('分组已移动');
    } catch (err) {
      toast(err.message, true);
    }
    state.dragging = false;
    refresh();
  }
}

// —— 复制路径 ——
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制');
  }
}

// —— 添加 / 编辑弹窗 ——
const PATH_LABEL = { script: '脚本 / 程序路径（bat/cmd/exe…）', docker: 'Compose 文件所在目录', static: 'HTML 文件路径（可留空，改用打开地址）' };

function openEditDialog(p = null) {
  const dlg = $('#edit-dialog');
  $('#edit-title').textContent = p ? '编辑项目' : '添加项目';
  $('#f-id-field').hidden = !!p;
  $('#f-name').value = p?.name || '';
  $('#f-type').value = p?.type || 'script';
  $('#f-desc').value = p?.description || '';
  $('#f-path').value = p?.path || '';
  $('#f-command').value = p?.options?.command || '';
  $('#f-cwd').value = p?.options?.cwd || '';
  $('#f-processMatch').value = p?.options?.processMatch || '';
  $('#f-encoding').value = p?.options?.encoding || '';
  $('#f-console').checked = p?.options?.console === true;
  $('#f-composeFile').value = p?.options?.composeFile || '';
  $('#f-ports').value = (p?.ports || []).join(', ');
  $('#f-urls').value = (p?.urls || []).join('\n');
  // 所属分组下拉框
  const groupSel = $('#f-group');
  groupSel.innerHTML =
    '<option value="">未分组</option>' +
    state.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
  groupSel.value = p?.groupId || '';
  $('#f-deps').value = (p?.dependencies || []).join(', ');
  $('#f-tags').value = (p?.tags || []).join(', ');
  $('#f-notes').value = p?.notes || '';
  $('#f-id').value = p?.id || '';
  $('#edit-form').dataset.editId = p?.id || '';
  syncTypeFields();
  dlg.showModal();
}

// 按类型显示对应字段
function syncTypeFields() {
  const type = $('#f-type').value;
  $$('#edit-form .field[data-for]').forEach((el) => {
    const forTypes = (el.dataset.for || '').split(',');
    el.hidden = !forTypes.includes(type);
  });
  $('#f-path-label').textContent = PATH_LABEL[type] || '路径';
}

function collectForm() {
  const csv = (s) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  const lines = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const nums = (s) => csv(s).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  const type = $('#f-type').value;
  const payload = {
    name: $('#f-name').value.trim(),
    type,
    description: $('#f-desc').value.trim(),
    path: $('#f-path').value.trim(),
    groupId: $('#f-group').value || null,
    ports: nums($('#f-ports').value),
    urls: lines($('#f-urls').value),
    dependencies: csv($('#f-deps').value),
    tags: csv($('#f-tags').value),
    notes: $('#f-notes').value,
    options: {},
  };
  if (type === 'script') {
    for (const [field, key] of [['#f-command', 'command'], ['#f-cwd', 'cwd'], ['#f-processMatch', 'processMatch'], ['#f-encoding', 'encoding']]) {
      const v = $(field).value.trim();
      if (v) payload.options[key] = v;
    }
    if ($('#f-console').checked) payload.options.console = true;
  }
  if (type === 'docker') {
    const cf = $('#f-composeFile').value.trim();
    if (cf) payload.options.composeFile = cf;
  }
  return payload;
}

async function onSave(e) {
  e.preventDefault();
  const editId = $('#edit-form').dataset.editId;
  const payload = collectForm();
  if (!payload.name) return toast('请填写项目名', true);
  if (!editId && $('#f-id').value.trim()) payload.id = $('#f-id').value.trim();
  try {
    if (editId) {
      await API.patch(editId, payload);
      toast('已保存');
    } else {
      await API.create(payload);
      toast('已添加');
    }
    $('#edit-dialog').close();
    refresh();
  } catch (err) {
    toast(err.message, true);
  }
}

// —— 日志弹窗 ——
let logTimer = null;
async function loadLogs(id) {
  try {
    const r = await API.logs(id, 500); // 与后端环形缓冲上限一致，复制时更完整
    const pre = $('#log-pre');
    pre.innerHTML = r.lines
      .map((l) => {
        const t = new Date(l.ts).toLocaleTimeString('zh-CN', { hour12: false });
        return `<span class="lg-${esc(l.stream)}">[${t}] ${esc(l.text)}</span>`;
      })
      .join('\n');
    pre.scrollTop = pre.scrollHeight;
  } catch (e) {
    $('#log-pre').textContent = '日志加载失败: ' + e.message;
  }
}

function openLogDialog(p) {
  $('#log-title').textContent = `日志 · ${p.name}`;
  loadLogs(p.id);
  $('#log-dialog').showModal();
  clearInterval(logTimer);
  logTimer = setInterval(() => {
    if ($('#log-follow').checked && $('#log-dialog').open) loadLogs(p.id);
    else if (!$('#log-dialog').open) clearInterval(logTimer);
  }, 2000);
}

// —— 事件绑定 ——
function bindEvents() {
  $('#btn-theme').addEventListener('click', toggleTheme);
  $('#btn-group').addEventListener('click', onCreateGroup);
  $('#btn-add').addEventListener('click', () => openEditDialog(null));
  $('#btn-add-empty').addEventListener('click', () => openEditDialog(null));
  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    render();
  });

  $('#grid').addEventListener('focusin', (e) => {
    if (e.target.matches('.name-note')) state.noteEditing = true;
    if (e.target.matches('.group-name-input')) state.groupEditing = true;
  });
  $('#grid').addEventListener('focusout', (e) => {
    if (e.target.matches('.name-note')) commitNameNote(e.target);
    if (e.target.matches('.group-name-input')) commitGroupName(e.target);
  });
  $('#grid').addEventListener('input', (e) => {
    if (e.target.matches('.name-note')) onNameNoteInput(e);
    if (e.target.matches('.group-name-input')) onGroupNameInput(e);
  });
  $('#grid').addEventListener('keydown', (e) => {
    const isNote = e.target.matches('.name-note');
    const isGroupName = e.target.matches('.group-name-input');
    if (!isNote && !isGroupName) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      isNote ? commitNameNote(e.target) : commitGroupName(e.target);
      e.target.blur();
    } else if (e.key === 'Escape') {
      e.target.value = e.target.dataset.orig ?? '';
      isNote ? commitNameNote(e.target) : commitGroupName(e.target);
      e.target.blur();
    }
  });

  // 拖拽：项目拖入/拖出分组；分组头部拖动排序
  $('#grid').addEventListener('dragstart', onDragStart);
  $('#grid').addEventListener('dragover', onDragOver);
  $('#grid').addEventListener('drop', onDrop);
  $('#grid').addEventListener('dragend', () => {
    state.dragging = false;
    dragProjectId = null;
    clearDrop();
  });

  $('#grid').addEventListener('click', async (e) => {
    const pathEl = e.target.closest('.path');
    if (pathEl && pathEl.dataset.copy) return copyText(pathEl.dataset.copy);
    // 背景调色盘：展开/收起
    const palBtn = e.target.closest('button[data-act="palette"]');
    if (palBtn) {
      const pop = palBtn.closest('.palette-wrap').querySelector('.palette-pop');
      const wasHidden = pop.hidden;
      $$('.palette-pop').forEach((p) => (p.hidden = true));
      pop.hidden = !wasHidden;
      state.paletteOpen = !pop.hidden;
      return;
    }
    // 选择颜色：立即持久化
    const swatch = e.target.closest('.swatch');
    if (swatch) {
      const id = swatch.closest('.card')?.dataset.id;
      if (!id) return;
      try {
        await API.patch(id, { color: swatch.dataset.swatch });
        const p = find(id);
        if (p) p.color = swatch.dataset.swatch;
        $$('.palette-pop').forEach((x) => (x.hidden = true));
        state.paletteOpen = false;
      } catch (err) {
        toast(err.message, true);
      }
      refresh();
      return;
    }
    const gbtn = e.target.closest('button[data-gact]');
    if (gbtn && gbtn.dataset.gact === 'dissolve') return onDissolveGroup(gbtn.dataset.group);
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.closest('.card')?.dataset.id;
    if (id) onCardAction(id, btn.dataset.act);
  });

  // 点击调色盘以外区域时收起
  document.addEventListener('click', (e) => {
    if (state.paletteOpen && !e.target.closest('.palette-wrap')) {
      $$('.palette-pop').forEach((p) => (p.hidden = true));
      state.paletteOpen = false;
    }
  });

  $('#edit-form').addEventListener('submit', onSave);
  $('#btn-cancel').addEventListener('click', () => $('#edit-dialog').close());
  $('#f-type').addEventListener('change', syncTypeFields);
  $('#btn-log-copy').addEventListener('click', async () => {
    const text = $('#log-pre').innerText;
    if (!text.trim()) return toast('日志为空，没有可复制的内容', true);
    await copyText(text);
  });
  $('#btn-log-close').addEventListener('click', () => {
    clearInterval(logTimer);
    $('#log-dialog').close();
  });
}

async function init() {
  syncThemeButton();
  try {
    const h = await API.health();
    $('#ver').textContent = `v${h.version}`;
  } catch {
    /* 后端未启动时忽略 */
  }
  bindEvents();
  await refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 5000);
}

init();
