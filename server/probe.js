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

// PowerShell 按命令行关键字匹配进程 PID。
// 排除 powershell 自身（其命令行必然含关键字）与工作台进程。
async function findPidsByCommandline(keyword) {
  const kw = String(keyword || '').replace(/'/g, "''");
  const script =
    `$ErrorActionPreference='SilentlyContinue'; ` +
    `Get-CimInstance Win32_Process | Where-Object { ` +
    `$_.CommandLine -like '*${kw}*' -and ` +
    `$_.Name -notmatch '^(powershell|pwsh|cmd)\\.exe$' -and ` +
    `$_.ProcessId -ne ${process.pid} } | ` +
    `ForEach-Object { $_.ProcessId }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 20000 });
  if (r.err && !r.stdout) return [];
  return r.stdout
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
    .filter(Number.isInteger);
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

module.exports = { probePort, probePorts, findPidsByPort, findPidsByCommandline, killTree, pidMatchesCommandline, isPidAlive };
