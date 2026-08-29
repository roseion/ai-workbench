'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { isPidAlive } = require('./probe');

// 进程与日志管理：
// - 跟踪由工作台启动的进程 PID（tracked pids）
// - stdout/stderr 写入内存环形缓冲（前端查看）并落盘 data/logs/<id>.log
// - 记录最近一次退出信息，作为"无端口项目"的状态依据

const buffers = new Map(); // id -> [{ts, stream, text}]
const logStreams = new Map(); // id -> fs.WriteStream
const runtimes = new Map(); // id -> {pids:Set, lastExit, startRequestedAt, markedStatus}

function rt(id) {
  let r = runtimes.get(id);
  if (!r) {
    r = { pids: new Set(), lastExit: null, startRequestedAt: null, markedStatus: null };
    runtimes.set(id, r);
  }
  return r;
}

function logStream(id) {
  let s = logStreams.get(id);
  if (!s) {
    s = fs.createWriteStream(path.join(config.logsDir, `${id}.log`), { flags: 'a' });
    s.on('error', () => { /* 磁盘问题时仅丢日志，不影响服务 */ });
    logStreams.set(id, s);
  }
  return s;
}

function logLine(id, stream, text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return;
  let buf = buffers.get(id);
  if (!buf) {
    buf = [];
    buffers.set(id, buf);
  }
  const fs2 = logStream(id);
  for (const line of lines) {
    const entry = { ts: Date.now(), stream, text: line };
    buf.push(entry);
    if (buf.length > config.logBufferLines) buf.splice(0, buf.length - config.logBufferLines);
    fs2.write(`${new Date(entry.ts).toISOString()} [${stream}] ${line}\n`);
  }
}

function decodeChunk(dec, chunk) {
  if (dec) return dec.decode(chunk, { stream: true });
  return chunk.toString('utf8');
}

// 跟踪一个 spawn 出来的子进程，捕获其输出
function attach(id, child, { encoding } = {}) {
  const r = rt(id);
  r.pids.add(child.pid);
  r.lastExit = null;
  let dec = null;
  if (encoding) {
    try {
      dec = new TextDecoder(encoding);
    } catch { /* 未知编码回退 utf8 */ }
  }
  if (child.stdout) child.stdout.on('data', (d) => logLine(id, 'out', decodeChunk(dec, d)));
  if (child.stderr) child.stderr.on('data', (d) => logLine(id, 'err', decodeChunk(dec, d)));
  child.on('exit', (code, signal) => {
    r.pids.delete(child.pid);
    r.lastExit = { code, signal, at: new Date().toISOString() };
    logLine(id, 'sys', `进程退出 code=${code} signal=${signal || '-'}`);
  });
  child.on('error', (e) => logLine(id, 'err', `进程错误: ${e.message}`));
  return child;
}

// 外部命令（如 docker compose）的输出并入项目日志
function appendExternal(id, text) {
  if (text) logLine(id, 'out', text);
}

function getRuntime(id) {
  const r = rt(id);
  const pids = [...r.pids].filter(isPidAlive);
  r.pids = new Set(pids); // 顺带清掉已退出的
  return {
    pids,
    lastExit: r.lastExit,
    startRequestedAt: r.startRequestedAt,
    markedStatus: r.markedStatus,
  };
}

const setStartRequested = (id) => { rt(id).startRequestedAt = Date.now(); };
const clearStartRequested = (id) => { rt(id).startRequestedAt = null; };
const setMarked = (id, status) => { rt(id).markedStatus = status; };
const clearTracking = (id) => { rt(id).pids.clear(); };

// 删除项目时清理内存与日志句柄（日志文件保留在磁盘上）
function purge(id) {
  const s = logStreams.get(id);
  if (s) {
    try { s.end(); } catch { /* 忽略 */ }
    logStreams.delete(id);
  }
  buffers.delete(id);
  runtimes.delete(id);
}

module.exports = {
  attach,
  appendExternal,
  getRuntime,
  setStartRequested,
  clearStartRequested,
  setMarked,
  clearTracking,
  purge,
  // 仅供前端日志查看
  getLogs(id, lines = 200) {
    const buf = buffers.get(id) || [];
    return buf.slice(-lines);
  },
};
