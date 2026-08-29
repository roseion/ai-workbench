'use strict';
const { spawn } = require('child_process');
const { fileURLToPath } = require('url');

// 所有启动器共享的"打开"实现：用系统默认程序打开 URL / 本地文件
function openTarget(target) {
  let t = target;
  if (/^file:/i.test(target)) {
    try { t = fileURLToPath(target); } catch { /* 非法 file URL 则原样尝试 */ }
  }
  const child = spawn('cmd.exe', ['/d', '/c', 'start', '', t], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function openUrls(project) {
  const targets =
    project.urls && project.urls.length ? project.urls : project.path ? [project.path] : [];
  for (const u of targets) openTarget(u);
  return {
    ok: targets.length > 0,
    message: targets.length ? `已请求打开 ${targets.length} 个地址` : '该项目没有配置打开地址',
  };
}

module.exports = { openUrls, openTarget };
