'use strict';
const express = require('express');
const store = require('../store');
const { asyncH } = require('../util');

// 分组路由：增删改查 + 拖拽排序
const router = express.Router();

const sorted = () => store.listGroups().slice().sort((a, b) => a.order - b.order);

router.get('/', (req, res) => res.json({ groups: sorted() }));

router.post('/', (req, res) => {
  const name = typeof (req.body || {}).name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: { message: 'name 必填' } });
  if (name.length > 60) return res.status(400).json({ error: { message: 'name 最长 60 字符' } });
  res.status(201).json({ group: store.addGroup(name) });
});

// 前端拖拽排序：提交完整 id 顺序
router.post('/reorder', (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.map(String) : null;
  if (!ids) return res.status(400).json({ error: { message: 'ids 必须是字符串数组' } });
  const all = store.listGroups();
  if (ids.length !== all.length || !all.every((g) => ids.includes(g.id))) {
    return res.status(400).json({ error: { message: 'ids 必须恰好包含所有分组' } });
  }
  res.json({ groups: store.reorderGroups(ids) });
});

router.patch('/:id', (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return res.status(400).json({ error: { message: 'name 不能为空' } });
    if (name.length > 60) return res.status(400).json({ error: { message: 'name 最长 60 字符' } });
    patch.name = name;
  }
  if (body.order !== undefined) {
    if (!Number.isInteger(body.order)) return res.status(400).json({ error: { message: 'order 必须是整数' } });
    patch.order = body.order;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: { message: '没有可更新的字段（name / order）' } });
  const group = store.updateGroup(req.params.id, patch);
  if (!group) return res.status(404).json({ error: { message: `分组不存在: ${req.params.id}` } });
  res.json({ group });
});

// 解散分组：组内项目移回未分组
router.delete('/:id', asyncH(async (req, res) => {
  const r = store.removeGroup(req.params.id);
  if (!r) return res.status(404).json({ error: { message: `分组不存在: ${req.params.id}` } });
  res.json({ ok: true, unassigned: r.unassigned });
}));

module.exports = { router };
