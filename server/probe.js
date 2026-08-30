'use strict';
const net = require('net');
const exe = require('./exe');
const { run } = exe;

// TCP 端口探测：能建立连接即认为有服务在监听
function probePort(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (r) => {
      sock.destroy();
      resolve(r);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

// 并发探测多个端口 → { 8000: true, 8090: false, ... }
async function probePorts(ports) {
  const out = {};
  await Promise.all(
    (ports || []).map(async (p) => {
      out[p] = await probePort(p);
    })
  );
  return out;
}

// netstat 反查：某个端口上处于 LISTENING 的进程 PID（可能有多个，含 IPv4/IPv6）
async function findPidsByPort(port) {
  const r = await run('netstat', ['-ano', '-p', 'tcp'], { timeoutMs: 15000 });
  if (r.err && !r.stdout) return [];
  const pids = new Set();
  for (const line of r.stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 5 && /^TCP$/i.test(parts[0]) && /^LISTENING$/i.test(parts[3])) {
      if (parts[1].endsWith(':' + port)) pids.add(Number(parts[4]));
    }
  }
  return [...pids].filter(Number.isInteger);
}

// 全量进程命令行快照（PID → 进程名 + 命令行），带短 TTL 缓存与在途去重：
// 状态 5s 轮询下，多张配置了 processMatch 的卡片合并为一次 PowerShell 调用
const SNAPSHOT_TTL_MS = 4000;
let snapshot = null; // { at, promise }

function commandlineSnapshot() {
  if (snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return snapshot.promise;
  const script =
    `$ErrorActionPreference='SilentlyContinue'; ` +
    `Get-CimInstance Win32_Process | ForEach-Object { ` +
    `$t=[char]9; ''+$_.ProcessId+$t+$_.Name+$t+$_.CommandLine }`;
  const promise = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 20000 }).then(
    (r) => {
      const map = new Map();
      for (const line of (r.stdout || '').split(/\r?\n/)) {
        const pidEnd = line.indexOf('\t');
        if (pidEnd < 0) continue;
        const pid = Number(line.slice(0, pidEnd));
        if (!Number.isInteger(pid)) continue;
        const rest = line.slice(pidEnd + 1);
        const nameEnd = rest.indexOf('\t');
        map.set(pid, {
          name: nameEnd >= 0 ? rest.slice(0, nameEnd) : '',
          cmdline: nameEnd >= 0 ? rest.slice(nameEnd + 1) : '',
        });
      }
      return map;
    },
    () => {
      snapshot = null; // 失败不缓存，下次轮询重试
      return new Map();
    }
  );
  snapshot = { at: Date.now(), promise };
  return promise;
}

// 让下一次快照重新拉取（如刚结束/刚拉起进程后，避免旧缓存误导状态显示）
function invalidateCommandlineSnapshot() {
  snapshot = null;
}

// 按命令行关键字匹配进程 PID（大小写不敏感的子串匹配）。
// 排除 powershell/pwsh/cmd 自身（其命令行常含关键字）与工作台进程。
async function findPidsByCommandline(keyword) {
  const kw = String(keyword || '').trim().toLowerCase();
  if (!kw) return [];
  const map = await commandlineSnapshot();
  const pids = [];
  for (const [pid, { name, cmdline }] of map) {
    if (/^(powershell|pwsh|cmd)\.exe$/i.test(name)) continue;
    if (pid === process.pid) continue;
    if (String(cmdline || '').toLowerCase().includes(kw)) pids.push(pid);
  }
  return pids;
}

// 结束进程树（Windows：taskkill /T 连子进程一起杀）
async function killTree(pid) {
  const r = await run('taskkill', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 15000 });
  return { ok: !r.err, message: (r.stdout || r.stderr || '').trim() };
}

// 核对 PID 身份：Windows 会复用 PID，结束跟踪进程前先确认命令行指纹匹配，
// 避免把复用了旧 PID 的无辜进程（及其整棵进程树）误杀
async function pidMatchesCommandline(pid, substr) {
  if (!pid || !substr) return true; // 无指纹时保持旧行为
  const s = String(substr).replace(/'/g, "''");
  const script =
    `$ErrorActionPreference='SilentlyContinue'; ` +
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" | Select-Object -First 1; ` +
    `if ($p -and $p.CommandLine -like '*${s}*') { 'MATCH' }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 15000 });
  return r.stdout.includes('MATCH');
}

// 进程是否存活；EPERM 视为存活（权限不足但进程存在）
function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

module.exports = { probePort, probePorts, findPidsByPort, findPidsByCommandline, invalidateCommandlineSnapshot, killTree, pidMatchesCommandline, isPidAlive };
