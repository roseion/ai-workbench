'use strict';
const { openUrls } = require('./base');

// static 启动器：纯静态页面（本地 HTML 文件或 URL），没有启动/停止的概念
const capabilities = { canStart: false, canStop: false, canRestart: false, canOpen: true };

async function getStatus() {
  return { status: 'idle', detail: '静态页面，无需启动' };
}

const notApplicable = async () => ({ ok: false, message: '静态页面项目无需此操作' });

module.exports = { capabilities, start: notApplicable, stop: notApplicable, restart: notApplicable, getStatus, openUrls };
