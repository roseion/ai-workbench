'use strict';
const config = require('../config');
const procman = require('../procman');
const probe = require('../probe');
const exe = require('../exe');
const { tail } = require('../util');
const { openUrls } = require('./base');

// docker 启动器：以项目 path 为工作目录执行 docker compose 子命令。
// 「更新」动作对应 pull + up -d（freellmapi 等项目的标准更新流程）。

const capabilities = { canStart: true, canStop: true, canRestart: true, canOpen: true, canUpdate: true };

function composeArgs(project, extra) {
  const args = ['compose'];
  const cf = project.options && project.options.composeFile;
  if (cf) args.push('-f', cf);
  args.push(...extra);
  return args;
}

// compose ps 结果做 2 秒缓存，避免 5 秒轮询时频繁起 docker 进程
let psCache = { key: '', at: 0, value: null };

async function getStatus(project) {
  const runtime = procman.getRuntime(project.id);
  if (runtime.startRequestedAt && Date.now() - runtime.startRequestedAt < config.startGraceMs) {
    return { status: 'starting', ports: null };
  }
  const key = `${project.id}|${project.path}|${(project.options || {}).composeFile || ''}`;
  if (psCache.key === key && Date.now() - psCache.at < 2000) {
    return { ...psCache.value, runtimePids: runtime.pids };
  }

  const r = await exe.run('docker', composeArgs(project, ['ps', '--services', '--status', 'running']), {
    cwd: project.path,
    timeoutMs: 20000,
  });
  let value;
  if (!r.err && r.stdout.trim()) {
    value = { status: 'running', services: r.stdout.trim().split(/\r?\n/).filter(Boolean) };
    // 附带逐端口探测结果，前端端口指示灯才有点亮/熄灭的依据
    if ((project.ports || []).length) {
      value.ports = await probe.probePorts(project.ports);
    }
  } else if (!r.err) {
    value = { status: 'stopped' };
    if ((project.ports || []).length) {
      value.ports = await probe.probePorts(project.ports);
    }
  } else {
    // docker 不可用或目录缺 compose 文件：退回端口探测
    const ports = project.ports || [];
    if (ports.length) {
      const st = await probe.probePorts(ports);
      value = Object.values(st).some(Boolean)
        ? { status: 'running', ports: st }
        : { status: 'stopped', ports: st };
    } else {
      value = { status: 'unknown', reason: 'docker 命令不可用且未配置端口' };
    }
  }
  psCache = { key, at: Date.now(), value };
  return { ...value, runtimePids: runtime.pids };
}

async function compose(project, extra, timeoutMs) {
  procman.setStartRequested(project.id);
  procman.setMarked(project.id, null);
  const r = await exe.run('docker', composeArgs(project, extra), {
    cwd: project.path,
    timeoutMs,
  });
  procman.appendExternal(project.id, `$ docker compose ${extra.join(' ')}\n${[r.stdout, r.stderr].filter(Boolean).join('\n')}`);
  return r;
}

async function start(project) {
  const r = await compose(project, ['up', '-d'], 180000);
  if (r.code === 0) return { ok: true, message: 'docker compose up 完成' };
  return { ok: false, message: `启动失败: ${tail(r.stderr || r.stdout)}` };
}

async function stop(project) {
  procman.clearStartRequested(project.id);
  const r = await exe.run('docker', composeArgs(project, ['stop']), { cwd: project.path, timeoutMs: 120000 });
  procman.appendExternal(project.id, `$ docker compose stop\n${[r.stdout, r.stderr].filter(Boolean).join('\n')}`);
  procman.setMarked(project.id, 'stopped');
  if (r.code === 0) return { ok: true, message: 'docker compose stop 完成' };
  return { ok: false, message: `停止失败: ${tail(r.stderr || r.stdout)}` };
}

async function restart(project) {
  const r = await compose(project, ['restart'], 120000);
  if (r.code === 0) return { ok: true, message: 'docker compose restart 完成' };
  return { ok: false, message: `重启失败: ${tail(r.stderr || r.stdout)}` };
}

async function update(project) {
  const pull = await compose(project, ['pull'], 600000);
  if (pull.code !== 0) return { ok: false, message: `拉取镜像失败: ${tail(pull.stderr || pull.stdout)}` };
  const up = await compose(project, ['up', '-d'], 180000);
  if (up.code === 0) return { ok: true, message: '镜像已更新并重新拉起' };
  return { ok: false, message: `更新后启动失败: ${tail(up.stderr || up.stdout)}` };
}

module.exports = { capabilities, start, stop, restart, update, getStatus, openUrls };
