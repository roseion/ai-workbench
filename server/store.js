'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { now } = require('./util');

// projects.json 的人类可读存储层。所有写操作先落 .tmp 再 rename，避免写坏数据。
let cache = null;

function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.logsDir, { recursive: true });
}

function save(list) {
  ensureDirs();
  const tmp = config.projectsFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, config.projectsFile);
  cache = list;
}

// 首次运行：用仓库内的 projects.example.json 作为种子数据初始化
function init() {
  ensureDirs();
  if (fs.existsSync(config.projectsFile)) return;
  let seed = [];
  try {
    seed = JSON.parse(fs.readFileSync(config.exampleFile, 'utf8'));
    if (!Array.isArray(seed)) seed = [];
  } catch {
    seed = [];
  }
  save(seed);
}

function load() {
  if (cache) return cache;
  init();
  try {
    const raw = JSON.parse(fs.readFileSync(config.projectsFile, 'utf8'));
    cache = Array.isArray(raw) ? raw : [];
  } catch {
    // 数据文件损坏时备份后重建，保证工作台可用
    try {
      fs.copyFileSync(config.projectsFile, config.projectsFile + '.bak-' + Date.now());
    } catch { /* 文件可能已不存在 */ }
    cache = [];
    save(cache);
  }
  return cache;
}

const list = () => load();
const get = (id) => load().find((p) => p.id === id) || null;

function add(project) {
  load().push(project);
  save(load());
  return project;
}

function replace(id, project) {
  const arr = load();
  const i = arr.findIndex((p) => p.id === id);
  if (i < 0) return null;
  arr[i] = project;
  save(arr);
  return project;
}

function remove(id) {
  const arr = load();
  const i = arr.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const [removed] = arr.splice(i, 1);
  save(arr);
  return removed;
}

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// 中文名无法生成 slug 时回退到随机 id，保证 URL 安全
function genId(name) {
  const base = slugify(name) || 'p' + Date.now().toString(36);
  let id = base;
  let n = 2;
  while (get(id)) id = `${base}-${n++}`;
  return id;
}

// —— 分组存储（groups.json）：{id, name, order} ——

let groupsCache = null;

function loadGroups() {
  if (groupsCache) return groupsCache;
  ensureDirs();
  try {
    const raw = JSON.parse(fs.readFileSync(config.groupsFile, 'utf8'));
    groupsCache = Array.isArray(raw) ? raw : [];
  } catch {
    groupsCache = [];
  }
  return groupsCache;
}

function saveGroups(list) {
  ensureDirs();
  const tmp = config.groupsFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, config.groupsFile);
  groupsCache = list;
}

const listGroups = () => loadGroups();
const getGroup = (id) => loadGroups().find((g) => g.id === id) || null;

function addGroup(name) {
  const list = loadGroups();
  const group = {
    id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name,
    order: list.length ? Math.max(...list.map((g) => g.order || 0)) + 1 : 0,
    createdAt: now(),
  };
  list.push(group);
  saveGroups(list);
  return group;
}

function updateGroup(id, patch) {
  const list = loadGroups();
  const group = list.find((g) => g.id === id);
  if (!group) return null;
  if (patch.name !== undefined) group.name = patch.name;
  if (patch.order !== undefined) group.order = patch.order;
  saveGroups(list);
  return group;
}

// 解散分组：返回被移回未分组的项目数
function removeGroup(id) {
  const list = loadGroups();
  const i = list.findIndex((g) => g.id === id);
  if (i < 0) return null;
  const [group] = list.splice(i, 1);
  saveGroups(list);
  const projects = load();
  let unassigned = 0;
  for (const p of projects) {
    if (p.groupId === id) {
      p.groupId = null;
      p.updatedAt = now();
      unassigned++;
    }
  }
  if (unassigned) save(projects);
  return { group, unassigned };
}

function reorderGroups(ids) {
  const list = loadGroups();
  ids.forEach((id, idx) => {
    const group = list.find((g) => g.id === id);
    if (group) group.order = idx;
  });
  saveGroups(list);
  return list.slice().sort((a, b) => a.order - b.order);
}

// 卡片排序：order 为全局递增值，前端按 (运行中优先, order) 排序
function nextOrder() {
  return load().reduce((max, p) => Math.max(max, typeof p.order === 'number' ? p.order : -1), -1) + 1;
}

function setOrder(id, order) {
  const p = get(id);
  if (!p) return null;
  p.order = order;
  save(load());
  return p;
}

module.exports = {
  init,
  list,
  get,
  add,
  replace,
  remove,
  genId,
  nextOrder,
  setOrder,
  listGroups,
  getGroup,
  addGroup,
  updateGroup,
  removeGroup,
  reorderGroups,
};
