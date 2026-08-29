'use strict';
const express = require('express');
const store = require('../store');
const procman = require('../procman');
const launchers = require('../launchers');
const { validateProjectInput } = require('../validate');
const SCHEMA = require('../schema');
const { asyncH, now } = require('../util');

const router = express.Router();

// 给项目条目附加实时状态、运行时信息与能力声明
async function enrich(p) {
  const launcher = launchers.get(p.type);
  const runtime = procman.getRuntime(p.id);
  let status = { status: 'unknown', reason: `未知启动器类型: ${p.type}` };
  if (launcher) {
    try {
      status = await launcher.getStatus(p, runtime);
    } catch (e) {
      status = { status: 'unknown', reason: e.message };
    }
  }
  return { ...p, capabilities: launchers.capabilities(p.type), runtime, status };
}

const bad = (res, message, details) => res.status(400).json({ error: details ? { message, details } : { message } });

// —— 注意：具体路径要挂在 /:id 之前 ——
router.get('/schema/project', (req, res) => res.json(SCHEMA));

router.get('/', asyncH(async (req, res) => {
  const projects = await Promise.all(store.list().map(enrich));
  res.json({ projects, count: projects.length });
}));

router.post('/', asyncH(async (req, res) => {
  const upsert = req.query.upsert === 'true' || req.query.upsert === '1';
  const existing = upsert && (req.body || {}).id ? store.get(req.body.id) : null;

  // upsert 允许只提交部分字段（其余保留原值）；新建则按全量校验
  const v = validateProjectInput(req.body || {}, { partial: !!existing });
  if (!v.ok) return bad(res, '校验失败', v.errors);
  const p = v.value;

  if (existing) {
    const { createdAt: _c, updatedAt: _u, ...existingFields } = existing;
    const merged = { ...existingFields, ...p, id: existing.id };
    const rv = validateProjectInput(merged, { partial: false });
    if (!rv.ok) return bad(res, '校验失败', rv.errors);
    return res.json({
      project: store.replace(existing.id, { ...rv.value, id: existing.id, createdAt: existing.createdAt, updatedAt: now() }),
      upserted: true,
    });
  }
  if (p.id && store.get(p.id)) {
    return res.status(409).json({ error: { message: `id 已存在: ${p.id}（如需覆盖请用 ?upsert=true）` } });
  }
  if (!p.id) p.id = store.genId(p.name);
  p.createdAt = p.updatedAt = now();
  store.add(p);
  res.status(201).json({ project: p });
}));

router.get('/:id', asyncH(async (req, res) => {
  const p = store.get(req.params.id);
  if (!p) return res.status(404).json({ error: { message: `项目不存在: ${req.params.id}` } });
  res.json({ project: await enrich(p) });
}));

// 部分更新（备注、名称等）；改完做一次全量校验，保证类型前置条件仍成立
router.patch('/:id', asyncH(async (req, res) => {
  const existing = store.get(req.params.id);
  if (!existing) return res.status(404).json({ error: { message: `项目不存在: ${req.params.id}` } });
  const v = validateProjectInput(req.body || {}, { partial: true });
  if (!v.ok) return bad(res, '校验失败', v.errors);
  const { createdAt: _c, updatedAt: _u, ...existingFields } = existing;
  const merged = { ...existingFields, ...v.value, id: existing.id };
  const rv = validateProjectInput(merged, { partial: false });
  if (!rv.ok) return bad(res, '更新后校验失败', rv.errors);
  res.json({ project: store.replace(existing.id, { ...rv.value, id: existing.id, createdAt: existing.createdAt, updatedAt: now() }) });
}));

// 全量更新
router.put('/:id', asyncH(async (req, res) => {
  const existing = store.get(req.params.id);
  if (!existing) return res.status(404).json({ error: { message: `项目不存在: ${req.params.id}` } });
  const v = validateProjectInput(req.body || {}, { partial: false });
  if (!v.ok) return bad(res, '校验失败', v.errors);
  const p = { ...v.value, id: existing.id, createdAt: existing.createdAt, updatedAt: now() };
  res.json({ project: store.replace(existing.id, p) });
}));

router.delete('/:id', asyncH(async (req, res) => {
  const removed = store.remove(req.params.id);
  if (!removed) return res.status(404).json({ error: { message: `项目不存在: ${req.params.id}` } });
  procman.purge(removed.id);
  res.json({ ok: true, removed: { id: removed.id, name: removed.name } });
}));

module.exports = { router, enrich };
