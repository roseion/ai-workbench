'use strict';
const express = require('express');
const store = require('../store');
const procman = require('../procman');
const launchers = require('../launchers');
const { asyncH } = require('../util');

// 动作路由：start / stop / restart / open / update / mark + status / logs 查询
const router = express.Router();

const mustProject = (id) => {
  const p = store.get(id);
  if (!p) throw Object.assign(new Error(`项目不存在: ${id}`), { status: 404 });
  return p;
};

const needCapability = (p, action) => {
  const launcher = launchers.get(p.type);
  if (!launcher) throw Object.assign(new Error(`未知启动器类型: ${p.type}`), { status: 400 });
  const cap = launcher.capabilities || {};
  if (!cap[action]) throw Object.assign(new Error(`「${p.name}」类型为 ${p.type}，不支持该操作`), { status: 400 });
  return launcher;
};

const runAction = (fn) =>
  asyncH(async (req, res) => {
    const p = mustProject(req.params.id);
    const launcher = needCapability(p, req.actionCap);
    const runtime = procman.getRuntime(p.id);
    const result = await fn(launcher, p, runtime, req, res);
    if (result && result.ok === false) return res.status(400).json({ error: { message: result.message || '操作失败' }, result });
    res.json({ ok: true, ...result });
  });

const defineAction = (path, actionCap, fn) => {
  router.post(`/:id/${path}`, (req, res, next) => {
    req.actionCap = actionCap;
    next();
  }, runAction(fn));
};

defineAction('start', 'canStart', (launcher, p) => launcher.start(p));
defineAction('stop', 'canStop', (launcher, p) => launcher.stop(p));
defineAction('restart', 'canRestart', (launcher, p) => launcher.restart(p));
defineAction('open', 'canOpen', (launcher, p) => launcher.openUrls(p));
defineAction('update', 'canUpdate', (launcher, p) => launcher.update(p));

// 手动标记状态：用于"无端口且未跟踪"的项目（unknown）由用户确认实际状态
router.post('/:id/mark', asyncH(async (req, res) => {
  const p = mustProject(req.params.id);
  const status = (req.body || {}).status;
  if (!['running', 'stopped', 'clear'].includes(status)) {
    return res.status(400).json({ error: { message: 'status 必须是 running / stopped / clear' } });
  }
  procman.setMarked(p.id, status === 'clear' ? null : status);
  res.json({ ok: true, message: status === 'clear' ? '已清除手动标记' : `已标记为「${status === 'running' ? '运行中' : '已停止'}」` });
}));

router.get('/:id/status', asyncH(async (req, res) => {
  const p = mustProject(req.params.id);
  const launcher = launchers.get(p.type);
  const runtime = procman.getRuntime(p.id);
  let status = { status: 'unknown', reason: `未知启动器类型: ${p.type}` };
  if (launcher) {
    try { status = await launcher.getStatus(p, runtime); } catch (e) { status = { status: 'unknown', reason: e.message }; }
  }
  res.json({ id: p.id, ...status, capabilities: launchers.capabilities(p.type) });
}));

router.get('/:id/logs', asyncH(async (req, res) => {
  const p = mustProject(req.params.id);
  const lines = Math.min(Math.max(Number.parseInt(req.query.lines, 10) || 200, 1), 2000);
  res.json({ id: p.id, lines: procman.getLogs(p.id, lines) });
}));

module.exports = { router };
