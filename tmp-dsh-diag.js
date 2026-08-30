/* eslint-disable */
// 临时诊断：捕获 dsh web 的真实输出（跑完即删）
const { execSync } = require('child_process');
const fs = require('fs');

const LOG = 'D:/ai/DeepSeek Harness/dsh-diag.log';
try { fs.unlinkSync(LOG); } catch { /* 无所谓 */ }

const child = require('child_process').spawn('cmd.exe', ['/d', '/c', 'dsh web > "' + LOG + '" 2>&1'], {
  cwd: 'D:/ai/DeepSeek Harness',
  windowsHide: true,
  stdio: 'ignore',
});
child.on('exit', (code) => {
  let content = '(无输出)';
  try { content = fs.readFileSync(LOG, 'utf8'); } catch { /* 无 */ }
  console.log('进程退出 code=' + code);
  console.log('--- dsh 输出 ---');
  console.log(content.slice(0, 800));
  try {
    const ns = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    console.log('--- 3080:', ns.split(/\r?\n/).some((l) => l.includes(':3080') && /LISTENING/i.test(l)) ? 'LISTENING' : '未监听');
  } catch { /* 忽略 */ }
  process.exit(0);
});
