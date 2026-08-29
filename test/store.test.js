'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 每个测试文件独立进程：指向一次性临时数据目录，绝不触碰真实数据
process.env.WORKBENCH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-store-'));
const store = require('../server/store');

test('init 以示例数据为种子', () => {
  store.init();
  const list = store.list();
  assert.ok(list.length >= 5, `种子项目应不少于 5 个，实际 ${list.length}`);
  assert.ok(list.some((p) => p.id === 'writing-env'));
});

test('add / get / replace / remove 生命周期', () => {
  const p = {
    id: 't1', name: 'T1', type: 'static', path: '', ports: [], urls: ['file:///C:/x.html'],
    dependencies: [], tags: [], notes: '', description: '', options: {}, createdAt: '', updatedAt: '',
  };
  store.add(p);
  assert.strictEqual(store.get('t1').name, 'T1');
  store.replace('t1', { ...p, name: 'T1b' });
  assert.strictEqual(store.get('t1').name, 'T1b');
  assert.strictEqual(store.remove('t1').id, 't1');
  assert.strictEqual(store.get('t1'), null);
});

test('genId：去重递增与中文回退', () => {
  assert.strictEqual(store.genId('writing-env'), 'writing-env-2');
  assert.match(store.genId('中文名'), /^p/);
});
