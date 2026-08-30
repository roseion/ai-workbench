'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const launchers = require('../server/launchers');
const probe = require('../server/probe');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const script = launchers.get('script');

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

// —— 无端口项目的 processMatch 状态判定（命令行 Agent 类卡片的接入基础）——

test('无端口 + processMatch：外部启动的进程能识别为运行中，结束后为已停止', async () => {
  const KEY = 'wb-status-sentinel-kq7z';
  // 用 -e 脚本内嵌唯一关键字：该子进程的命令行会包含 KEY，模拟"终端里手动启动的 TUI 工具"
  const child = spawn(process.execPath, ['-e', `/*${KEY}*/ setInterval(() => {}, 1000)`], {
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    const project = { id: 't-match-run', type: 'script', path: '', ports: [], options: { processMatch: KEY } };
    let st = null;
    for (let i = 0; i < 20 && (st = await script.getStatus(project)).status !== 'running'; i++) await sleep(400);
    assert.strictEqual(st.status, 'running');
  } finally {
    await probe.killTree(child.pid);
  }
  // 进程结束 → 主动确认无匹配 → 如实回到 stopped（而非 unknown）
  const project2 = { id: 't-match-run', type: 'script', path: '', ports: [], options: { processMatch: KEY } };
  let st2 = null;
  for (let i = 0; i < 20 && (st2 = await script.getStatus(project2)).status !== 'stopped'; i++) await sleep(400);
  assert.strictEqual(st2.status, 'stopped');
});

test('无端口 + processMatch：无匹配进程时判为已停止（不显示未知）', async () => {
  const st = await script.getStatus({
    id: 't-match-none',
    type: 'script',
    path: '',
    ports: [],
    options: { processMatch: 'wb-no-such-process-xyz' },
  });
  assert.strictEqual(st.status, 'stopped');
});

test('无端口且无 processMatch：保持 unknown（外部启动无法识别）', async () => {
  const st = await script.getStatus({ id: 't-no-match', type: 'script', path: '', ports: [], options: {} });
  assert.strictEqual(st.status, 'unknown');
});
