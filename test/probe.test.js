'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const probe = require('../server/probe');

test('probePort 探测监听中的端口', async () => {
  const srv = net.createServer(() => {}).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port;
  assert.strictEqual(await probe.probePort(port), true);
  srv.close();
  await new Promise((r) => srv.on('close', r));
  assert.strictEqual(await probe.probePort(port), false);
});

test('findPidsByPort 反查监听进程', async () => {
  const srv = net.createServer(() => {}).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port;
  const pids = await probe.findPidsByPort(port);
  assert.ok(pids.includes(process.pid), `应找到本进程 ${process.pid}，实际: ${pids}`);
  srv.close();
  await new Promise((r) => srv.on('close', r));
});

test('isPidAlive 基本判定', () => {
  assert.strictEqual(probe.isPidAlive(process.pid), true);
  assert.strictEqual(probe.isPidAlive(999999), false);
});
