'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

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

module.exports = { init, list, get, add, replace, remove, genId };
