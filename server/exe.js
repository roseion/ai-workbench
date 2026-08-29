'use strict';
const cp = require('child_process');

// 中文 Windows 上 netstat/tasklist/powershell 等输出可能是 GBK：
// utf8 解码出现替换符时尝试按 GBK 重新解码
function decodeOutput(buf) {
  if (!buf) return '';
  let text = buf.toString('utf8');
  if (text.includes('\uFFFD')) {
    try {
      text = new TextDecoder('gbk').decode(buf);
    } catch {
      /* 保留 utf8 结果 */
    }
  }
  return text;
}

// 统一的子进程执行封装：永不 reject，失败信息走返回值，方便启动器逐层兜底
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    cp.execFile(
      cmd,
      args,
      {
        windowsHide: true,
        encoding: 'buffer',
        timeout: opts.timeoutMs || 20000,
        maxBuffer: 16 * 1024 * 1024,
        cwd: opts.cwd,
        env: opts.env,
      },
      (err, stdout, stderr) => {
        resolve({
          code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
          stdout: decodeOutput(stdout),
          stderr: decodeOutput(stderr),
          err,
        });
      }
    );
  });
}

module.exports = { run, decodeOutput };
