'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.WORKBENCH_DATA_DIR || path.join(ROOT, 'data');

module.exports = {
  root: ROOT,
  // 工作台自身监听地址与端口（默认仅本机回环，不对外网开放）
  host: process.env.WORKBENCH_HOST || '127.0.0.1',
  port: Number.parseInt(process.env.WORKBENCH_PORT, 10) || 8787,
  // 可选鉴权 token：设置后所有写操作需携带 Authorization: Bearer <token>
  token: process.env.WORKBENCH_TOKEN || '',
  dataDir: DATA_DIR,
  projectsFile: path.join(DATA_DIR, 'projects.json'),
  groupsFile: path.join(DATA_DIR, 'groups.json'),
  logsDir: path.join(DATA_DIR, 'logs'),
  exampleFile: path.join(ROOT, 'data', 'projects.example.json'),
  publicDir: path.join(ROOT, 'public'),
  // start 后视为"启动中"的宽限期（毫秒），超时仍未探测到端口则回落到 stopped
  startGraceMs: 15000,
  // 每个项目在内存中保留的日志行数（同时落盘到 data/logs/<id>.log）
  logBufferLines: 500,
};
