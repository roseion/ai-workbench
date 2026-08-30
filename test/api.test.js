'use strict';
// API 集成测试：进程内启动工作台，走通 增删改查 + 启动→状态→停止 全链路。
// 用 test/fixtures/fixture-start.bat 模拟真实世界 bat（内部 start 拉起孙进程后立即退出），
// 以此验证"端口反查杀进程树"这一核心停止策略。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.WORKBENCH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-api-'));
process.env.WORKBENCH_PORT = '8799';
const { server } = require('../server/index.js');
const BASE = 'http://127.0.0.1:8799/api/v1';
const FIXTURE_BAT = path.join(__dirname, 'fixtures', 'fixture-start.bat').replace(/\\/g, '/');
const FIXTURE_PORT = 8917;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.after(() => new Promise((r) => server.close(r)));

async function jf(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function waitPort(up, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await jf('GET', `/projects/e2e-fixture/status`);
    const listening = data.ports && data.ports[FIXTURE_PORT] === true;
    if (listening === up) return true;
    await sleep(400);
  }
  return false;
}

test('health 与类型清单', async () => {
  const h = await jf('GET', '/health');
  assert.strictEqual(h.status, 200);
  assert.strictEqual(h.data.ok, true);
  assert.ok(h.data.types.includes('script'));
});

test('种子项目列表带实时状态与能力', async () => {
  const r = await jf('GET', '/projects');
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.count >= 5);
  const docker = r.data.projects.find((p) => p.type === 'docker');
  assert.strictEqual(docker.capabilities.canUpdate, true);
});

test('创建 → 启动 → 运行中 → 停止 → 已停止（全链路）', async () => {
  // 清理可能残留的夹具进程，保证起点干净
  const probe = require('../server/probe');
  for (const pid of await probe.findPidsByPort(FIXTURE_PORT)) await probe.killTree(pid);
  await sleep(500);

  // 1. 创建
  const created = await jf('POST', '/projects', {
    id: 'e2e-fixture',
    name: 'E2E Fixture',
    type: 'script',
    path: FIXTURE_BAT,
    ports: [FIXTURE_PORT],
    description: '启动/停止链路测试',
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.data));

  // 2. 启动（bat 内部 start 孙进程并立即退出，tracked PID 随之失效）
  const started = await jf('POST', '/projects/e2e-fixture/start');
  assert.strictEqual(started.status, 200, JSON.stringify(started.data));
  assert.strictEqual(started.data.ok, true);

  // 3. 端口探测变为运行中（验证孙进程确实被拉起）
  assert.ok(await waitPort(true), '启动后端口 8917 应处于监听');

  // 4. 停止（必须靠端口反查 PID 才能杀到孙进程）
  const stopped = await jf('POST', '/projects/e2e-fixture/stop');
  assert.strictEqual(stopped.status, 200, JSON.stringify(stopped.data));
  assert.strictEqual(stopped.data.ok, true, JSON.stringify(stopped.data));

  // 5. 端口释放
  assert.ok(await waitPort(false), '停止后端口 8917 应释放');

  // 6. 删除
  const del = await jf('DELETE', '/projects/e2e-fixture');
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await jf('GET', '/projects/e2e-fixture')).status, 404);
});

test('upsert 部分字段合并保留原值', async () => {
  const first = await jf('POST', '/projects?upsert=true', {
    id: 'upsert-t', name: 'U', type: 'static', path: 'C:/a.html', tags: ['x'],
  });
  assert.ok([200, 201].includes(first.status));
  const second = await jf('POST', '/projects?upsert=true', {
    id: 'upsert-t', notes: '备注更新',
  });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.data.upserted, true);
  assert.strictEqual(second.data.project.notes, '备注更新');
  assert.strictEqual(second.data.project.name, 'U', '未提交的 name 应保留');
  assert.deepStrictEqual(second.data.project.tags, ['x'], '未提交的 tags 应保留');
  await jf('DELETE', '/projects/upsert-t');
});

test('分组：创建 → 项目入组 → 重命名 → 排序 → 解散归还项目', async () => {
  const g1 = await jf('POST', '/groups', { name: '测试组' });
  assert.strictEqual(g1.status, 201);
  const gid = g1.data.group.id;

  // 项目带 groupId 入组；不存在的分组被拒绝
  const p = await jf('POST', '/projects', {
    id: 'grp-fixture', name: 'GrpP', type: 'static', path: 'C:/g.html', groupId: gid,
  });
  assert.strictEqual(p.status, 201, JSON.stringify(p.data));
  assert.strictEqual(p.data.project.groupId, gid);
  const bad = await jf('POST', '/projects', { name: 'BadG', type: 'static', path: 'C:/b.html', groupId: '不存在' });
  assert.strictEqual(bad.status, 400);

  // 移出分组
  const out = await jf('PATCH', '/projects/grp-fixture', { groupId: null });
  assert.strictEqual(out.data.project.groupId, null);
  const back = await jf('PATCH', '/projects/grp-fixture', { groupId: gid });
  assert.strictEqual(back.data.project.groupId, gid);

  // 重命名
  const ren = await jf('PATCH', `/groups/${gid}`, { name: '改名组' });
  assert.strictEqual(ren.status, 200);
  assert.strictEqual(ren.data.group.name, '改名组');

  // 排序：新建第二组并放到最前
  const g2 = await jf('POST', '/groups', { name: '第二组' });
  const ro = await jf('POST', '/groups/reorder', { ids: [g2.data.group.id, gid] });
  assert.strictEqual(ro.status, 200);
  assert.strictEqual(ro.data.groups[0].id, g2.data.group.id);

  // 解散：项目归还未分组
  const del = await jf('DELETE', `/groups/${gid}`);
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.data.unassigned, 1);
  const after = await jf('GET', '/projects/grp-fixture');
  assert.strictEqual(after.data.project.groupId, null);

  // 清理
  await jf('DELETE', '/projects/grp-fixture');
  await jf('DELETE', `/groups/${g2.data.group.id}`);
});

test('校验失败返回 400 与明细', async () => {
  const r = await jf('POST', '/projects', { name: 'Bad', type: 'script' });
  assert.strictEqual(r.status, 400);
  assert.ok(Array.isArray(r.data.error.details));
});
