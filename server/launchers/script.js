'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const procman = require('../procman');
const probe = require('../probe');
const { sleep } = require('../util');
const { openUrls } = require('./base');

// 停止目标若是工作台自身进程，不能在请求处理中直接自杀：
// 先响应结果，再延迟退出（自举管理："AI 工作台"卡片就是本服务）
const SELF_PID = process.pid;

// script 启动器：bat/cmd 脚本或任意命令行。
// 现实约束：bat 内常用 `start` 拉起孙进程，脚本退出后进程树断裂、无法直接跟踪，
// 因此停止采用三层策略：tracked PID → 端口反查 PID → options.processMatch 命令行匹配。

const capabilities = { canStart: true, canStop: true, canRestart: true, canOpen: true };

// 启动方案：bat/cmd 用 args 数组（Node 不会转义路径引号，cmd /d /c 的引号规则可正确处理空格）；
// 任意命令串用 shell:true（Node 原样传给 cmd，避免双重转义）。
// console 模式：经 `start` 在新控制台窗口运行，等同双击——兼容"输出被重定向就解析错位"的
// 特殊 bat（如 chcp 65001 + 中文 REM 的组合），代价是工作台无法捕获其输出。
function spawnPlan(project) {
  const opt = project.options || {};
  const consoleMode = opt.console === true || opt.console === 'true';
  if (opt.command) return { kind: consoleMode ? 'shell-console' : 'shell', command: opt.command };
  const p = project.path;
  if (!p) return null;
  const normalized = path.win32.normalize(p.trim());
  if (/\.(bat|cmd)$/i.test(normalized)) {
    return consoleMode ? { kind: 'bat-console', file: normalized } : { kind: 'bat', file: normalized };
  }
  return consoleMode ? { kind: 'shell-console', command: normalized } : { kind: 'shell', command: normalized };
}

async function start(project) {
  const plan = spawnPlan(project);
  if (!plan) return { ok: false, message: '缺少 path 或 options.command，无法启动' };
  const opt = project.options || {};
  const cwd = opt.cwd || (project.path ? path.dirname(project.path) : undefined);
  const env = { ...process.env, ...(opt.env || {}) };

  procman.setStartRequested(project.id);
  procman.setMarked(project.id, null);

  if (plan.kind === 'bat-console' || plan.kind === 'shell-console') {
    // 新控制台窗口运行：start 的第一个引号参数是窗口标题（留空用默认）
    const inner = plan.kind === 'bat-console' ? [plan.file] : ['cmd', '/c', plan.command];
    const child = spawn('cmd.exe', ['/d', '/c', 'start', '', ...inner], {
      cwd,
      env,
      windowsHide: true,
      stdio: 'ignore',
    });
    procman.attach(project.id, child, { encoding: opt.encoding, marker: plan.file || plan.command });
    await sleep(300);
    if (child.exitCode !== null && child.exitCode !== 0) {
      procman.clearStartRequested(project.id);
      return { ok: false, message: `启动失败（code=${child.exitCode}），请检查 path 是否正确` };
    }
    return { ok: true, message: '已在新控制台窗口启动（等同双击运行，工作台不捕获其输出）' };
  }

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
  procman.attach(project.id, child, { encoding: opt.encoding, marker: plan.file || plan.command });

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
  let selfKill = false;
  const attempt = async (pid) => {
    if (!pid || killed.has(pid)) return;
    killed.add(pid);
    if (pid === SELF_PID) {
      selfKill = true; // 工作台自身：等响应发出后再退出
      return;
    }
    await probe.killTree(pid);
  };

  // 跟踪进程：先核对命令行指纹再杀——Windows 会复用 PID，指纹对不上的一律放过
  const runtime = procman.getRuntime(project.id);
  for (const { pid, marker } of runtime.pids) {
    if (!(await probe.pidMatchesCommandline(pid, marker))) continue;
    await attempt(pid);
  }

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

  if (selfKill) {
    // 给 HTTP 响应留出发送时间，然后退出自身
    setTimeout(() => process.exit(0), 600);
    return { ok: true, selfKill: true, message: '停止请求已受理，工作台将在 1 秒内退出' };
  }
  if (killed.size > 0) {
    return { ok: true, message: `已结束 ${killed.size} 个进程` };
  }
  return { ok: false, message: '未发现运行中的进程（可能未启动，或由工作台外部启动且无法识别）' };
}

async function restart(project) {
  const r = await stop(project);
  if (r.selfKill) {
    // 自举重启：分离的引导进程等旧实例退出后，运行幂等的启动脚本拉起新实例
    const bat = project.path ? path.win32.normalize(project.path.trim()) : '';
    if (bat && /\.(bat|cmd)$/i.test(bat) && fs.existsSync(bat)) {
      // 引导进程不落盘（cmd 脚本文件会被 GBK 代码页误读中文路径），参数数组经
      // CreateProcessW 以 UTF-16 传递，天然 Unicode 安全；ping 充当延时
      // （timeout 在 stdin 被重定向时会立即报错退出）
      const helper = spawn(
        'cmd.exe',
        ['/d', '/c', 'ping', '-n', '3', '127.0.0.1', '>nul', '&', 'start', '', bat],
        {
          cwd: path.dirname(bat),
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
        }
      );
      helper.unref();
      return { ok: true, message: '工作台将在 2 秒后自动重启，页面会短暂断开后恢复' };
    }
    return r;
  }
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
