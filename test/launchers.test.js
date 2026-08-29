'use strict';
const test = require('node:test');
const assert = require('node:assert');
const launchers = require('../server/launchers');

test('注册表包含三种内置启动器', () => {
  assert.deepStrictEqual(launchers.types().sort(), ['docker', 'script', 'static']);
});

test('capabilities 按类型区分，前端按钮据此渲染', () => {
  assert.strictEqual(launchers.capabilities('static').canStart, false);
  assert.strictEqual(launchers.capabilities('static').canOpen, true);
  assert.strictEqual(launchers.capabilities('script').canStart, true);
  assert.strictEqual(launchers.capabilities('docker').canUpdate, true);
  assert.strictEqual(launchers.capabilities('nope'), null);
});

test('自定义类型可注册（扩展机制）', () => {
  launchers.register('mock', {
    capabilities: { canStart: true, canStop: false, canRestart: false, canOpen: false },
    start: async () => ({ ok: true }),
  });
  assert.strictEqual(launchers.capabilities('mock').canStop, false);
  assert.ok(launchers.types().includes('mock'));
});

test('static getStatus 返回 idle', async () => {
  const st = await launchers.get('static').getStatus({});
  assert.strictEqual(st.status, 'idle');
});
