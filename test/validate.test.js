'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateProjectInput } = require('../server/validate');

test('完整合法的 script 项目通过并归一化', () => {
  const v = validateProjectInput(
    {
      name: 'X', nameNote: '名字备注', type: 'script', path: 'C:/a/b.bat',
      ports: [8000, '8090'], urls: ['http://127.0.0.1:8000'],
      tags: ['a', 'a'], options: { processMatch: 'x.js' },
    },
    { partial: false }
  );
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.strictEqual(v.value.nameNote, '名字备注');
  assert.deepStrictEqual(v.value.ports, [8000, 8090]);
  assert.deepStrictEqual(v.value.tags, ['a']);
});

test('必填缺失与未知字段被拒绝', () => {
  let v = validateProjectInput({ type: 'script' }, { partial: false });
  assert.ok(!v.ok && v.errors.some((e) => e.includes('name')));
  v = validateProjectInput({ name: 'X', type: 'script', foo: 1 }, { partial: false });
  assert.ok(v.errors.some((e) => e.includes('未知字段: foo')));
  v = validateProjectInput({ name: 'X', type: 'nope' }, { partial: false });
  assert.ok(v.errors.some((e) => e.includes('type')));
});

test('路径中的引号/换行被拒绝（防命令注入）', () => {
  const v = validateProjectInput({ name: 'X', type: 'script', path: 'C:/a" & del /q *' }, { partial: false });
  assert.ok(v.errors.some((e) => e.includes('path')));
});

test('类型前置条件：docker 要目录、static 要路径或 url、script 要路径或命令', () => {
  let v = validateProjectInput({ name: 'X', type: 'docker' }, { partial: false });
  assert.ok(v.errors.some((e) => e.includes('compose')));
  v = validateProjectInput({ name: 'X', type: 'static' }, { partial: false });
  assert.ok(v.errors.some((e) => e.includes('static')));
  v = validateProjectInput({ name: 'X', type: 'script' }, { partial: false });
  assert.ok(v.errors.some((e) => e.includes('script')));
});

test('未知 options 字段被拒绝', () => {
  const v = validateProjectInput(
    { name: 'X', type: 'static', path: 'C:/a.html', options: { hacker: true } },
    { partial: false }
  );
  assert.ok(v.errors.some((e) => e.includes('hacker')));
});

test('options.console 布尔校验', () => {
  const ok = validateProjectInput(
    { name: 'X', type: 'script', path: 'C:/a.bat', options: { console: true } },
    { partial: false }
  );
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.strictEqual(ok.value.options.console, true);
  const bad = validateProjectInput(
    { name: 'X', type: 'script', path: 'C:/a.bat', options: { console: 'yes' } },
    { partial: false }
  );
  assert.ok(bad.errors.some((e) => e.includes('console')));
});

test('groupId 缺省为未分组', () => {
  const v = validateProjectInput({ name: 'X', type: 'static', path: 'C:/a.html' }, { partial: false });
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.strictEqual(v.value.groupId, null);
});

test('color 仅接受七色色板或留空', () => {
  const ok = validateProjectInput({ name: 'X', type: 'static', path: 'C:/a.html', color: 'cyan' }, { partial: false });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.strictEqual(ok.value.color, 'cyan');
  const empty = validateProjectInput({ name: 'X', type: 'static', path: 'C:/a.html' }, { partial: false });
  assert.strictEqual(empty.value.color, '');
  const bad = validateProjectInput({ name: 'X', type: 'static', path: 'C:/a.html', color: 'pink' }, { partial: false });
  assert.ok(bad.errors.some((e) => e.includes('color')));
});
