'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const store = require('./store');
const launchers = require('./launchers');
const { router: projectsRouter } = require('./routes/projects');
const { router: actionsRouter } = require('./routes/actions');
const { router: groupsRouter } = require('./routes/groups');
const SCHEMA = require('./schema');
const { now } = require('./util');
const pkg = require('../package.json');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// 可选鉴权：设置 WORKBENCH_TOKEN 后，非只读请求需携带 Bearer token
app.use('/api', (req, res, next) => {
  if (!config.token) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.get('x-workbench-token') || '';
  if (token && token === config.token) return next();
  return res.status(401).json({ error: { message: '需要鉴权：Authorization: Bearer <token> 或 X-Workbench-Token' } });
});

app.get('/api/v1/health', (req, res) =>
  res.json({ ok: true, name: 'ai-workbench', version: pkg.version, uptime: process.uptime(), types: launchers.types() })
);
app.get('/api/v1/types', (req, res) => res.json({ types: launchers.types(), capabilities: Object.fromEntries(launchers.types().map((t) => [t, launchers.capabilities(t)])) }));
app.get('/api/v1/schema/project', (req, res) => res.json(SCHEMA));

app.use('/api/v1/projects', projectsRouter);
app.use('/api/v1/projects', actionsRouter);
app.use('/api/v1/groups', groupsRouter);

app.use('/api', (req, res) => res.status(404).json({ error: { message: '接口不存在，可用接口见 GET /api/v1/schema/project 与 docs/API.md' } }));

// 静态前端 + 开源文档（docs/API.md 等）。no-cache = 使用前必须协商缓存，
// 保证前端文件更新后浏览器立刻拿到新版（命中则 304，不浪费带宽）
app.use('/docs', express.static(path.join(config.root, 'docs')));
app.use(
  express.static(config.publicDir, {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: { message: err.message || '服务器内部错误' } });
});

store.init();

// 自举：把工作台自身注册成一张卡片（幂等，克隆本仓库即得）
function registerSelf() {
  const selfBat = path.join(config.root, 'scripts', '启动工作台.bat');
  if (!fs.existsSync(selfBat) || store.get('ai-workbench')) return;
  const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host;
  store.add({
    id: 'ai-workbench',
    name: 'AI 工作台',
    type: 'script',
    description: '工作台自身 —— 你正在看的这个页面的后台服务',
    path: selfBat,
    ports: [config.port],
    urls: [`http://${host}:${config.port}`],
    dependencies: ['Node.js'],
    tags: ['工作台'],
    notes: '启动脚本是幂等的：已在运行则只打开浏览器。「停止」会让工作台自行退出（需再次运行脚本启动）；「重启」会自动拉起新实例。',
    options: {},
    createdAt: now(),
    updatedAt: now(),
  });
  console.log('[ai-workbench] 已将工作台自身注册为项目卡片');
}
registerSelf();

const server = app.listen(config.port, config.host, () => {
  console.log(`[ai-workbench] 已启动: http://${config.host}:${config.port}`);
  console.log(`[ai-workbench] 启动器类型: ${launchers.types().join(', ')}`);
  if (config.token) console.log('[ai-workbench] 已启用 token 鉴权（写操作）');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[ai-workbench] 端口 ${config.port} 已被占用，可用环境变量 WORKBENCH_PORT 更换端口后重试`);
    process.exit(1);
  }
  throw e;
});

// 导出以便测试进程内启动
module.exports = { app, server };
