'use strict';
const path = require('path');
const { spawn } = require('child_process');const config = require('../config');
const procman = require('../procman');
const probe = require('../probe');
const { sleep } = require('../util');
const { openUrls } = require('./base');

// script 启动器：bat/cmd 脚本或任意命令行。
// 现实约束：bat 内常用 `start` 拉起孙进程，脚本退出后进程树断裂、无法直接跟踪，
// 因此停止采用三层策略：tracked PID → 端口反查 PID → options.processMatch 命令行匹配。

const capabilities = { canStart: true, canStop: true, canRestart: true, canOpen: true };

// 启动方案：bat/cmd 用 args 数组（Node 不会转义路径引号，cmd /d /c 的引号规则可正确处理空格）；
// 任意命令串用 shell:true（Node 原样传给 cmd，避免双重转义）
function spawnPlan(project) {
  const opt = project.options || {};
  if (opt.command) return { kind: 'shell', command: opt.command };
  const p = project.path;
  if (!p) return null;
  const normalized = path.win32.normalize(p.trim());
  if (/\.(bat|cmd)$/i.test(normalized)) return { kind: 'bat', file: normalized };
  return { kind: 'shell', command: normalized };
}

async function start(project) {
  const plan = spawnPlan(project);
  if (!plan) return { ok: false, message: '缺少 path 或 options.command，无法启动' };
  const opt = project.options || {};
  const cwd = opt.cwd || (project.path ? path.dirname(project.path) : undefined);
  const env = { ...process.env, ...(opt.env || {}) };

  procman.setStartRequested(project.id);
  procman.setMarked(project.id, null);

  const child =
    plan.kind === 'bat'
      ? spawn('cmd.exe', ['/d', '/c', plan.file], {
          cwd,
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      : spawn(plan.command, [], {
          cwd,
          env,
          windowsHide: true,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
  procman.attach(project.id, child, { encoding: opt.encoding });

  // 给 spawn 一点时间，尽早暴露"可执行文件不存在"之类的问题
  await sleep(300);
  if (child.exitCode !== null && child.exitCode !== 0 && !(child.pid && probe.isPidAlive(child.pid))) {
    procman.clearStartRequested(project.id);
    return { ok: false, message: `启动命令已立即退出（code=${child.exitCode}），请查看日志` };
  }
  return { ok: true, message: `已启动（PID ${child.pid}）`, pid: child.pid };
}

async function stop(project) {
  const killed = new Set();
  const attempt = async (pid) => {
    if (!pid || killed.has(pid)) return;
    killed.add(pid);
    await probe.killTree(pid);
  };

  const runtime = procman.getRuntime(project.id);
  for (const pid of runtime.pids) await attempt(pid);

  for (const port of project.ports || []) {
    for (const pid of await probe.findPidsByPort(port)) await attempt(pid);
  }

  const match = project.options && project.options.processMatch;
  if (match) {
    for (const pid of await probe.findPidsByCommandline(match)) await attempt(pid);
  }

  procman.clearTracking(project.id);
  procman.clearStartRequested(project.id);
  procman.setMarked(project.id, 'stopped');

  if (killed.size > 0) {
    return { ok: true, message: `已结束 ${killed.size} 个进程` };
  }
  return { ok: false, message: '未发现运行中的进程（可能未启动，或由工作台外部启动且无法识别）' };
}

async function restart(project) {
  await stop(project);
  // 等端口释放再启动，避免新实例绑定失败
  for (let i = 0; i < 20; i++) {
    const ports = project.ports || [];
    if (!ports.length) break;
    const st = await probe.probePorts(ports);
    if (!Object.values(st).some(Boolean)) break;
    await sleep(300);
  }
  return start(project);
}

// 状态判定优先级：端口探测 > tracked PID > 手动标记 > 启动宽限期 > unknown/stopped
async function getStatus(project) {
  const runtime = procman.getRuntime(project.id);
  const ports = project.ports || [];
  let portStatus = null;
  if (ports.length) {
    portStatus = await probe.probePorts(ports);
    if (Object.values(portStatus).some(Boolean)) {
      return { status: 'running', ports: portStatus };
    }
  }
  if (runtime.pids.length > 0) return { status: 'running', ports: portStatus };
  if (runtime.markedStatus === 'running') return { status: 'running', ports: portStatus, marked: true };
  if (runtime.startRequestedAt && Date.now() - runtime.startRequestedAt < config.startGraceMs) {
    return { status: 'starting', ports: portStatus };
  }
  if (!ports.length && !runtime.lastExit) {
    // 无端口且从未跟踪过（也没有退出记录）——可能正被外部启动，无法判断
    if (runtime.markedStatus === 'stopped') return { status: 'stopped', ports: portStatus };
    return { status: 'unknown', ports: null, reason: '无端口且进程未被跟踪，可能由工作台外部启动' };
  }
  return { status: 'stopped', ports: portStatus, lastExit: runtime.lastExit || undefined };
}

module.exports = { capabilities, start, stop, restart, getStatus, openUrls };
