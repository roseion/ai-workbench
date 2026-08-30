/* eslint-disable */
// 临时：验证凭证修复后 dsh web 能否启动（跑完即删）
const { spawn } = require('child_process');

async function main() {
  const child = spawn('cmd.exe', ['/d', '/c', 'dsh web'], {
    cwd: 'D:/ai/DeepSeek Harness',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d.toString('utf8')));
  child.stderr.on('data', (d) => (err += d.toString('utf8')));
  const result = await new Promise((resolve) => {
    const t = setTimeout(() => resolve({ timeout: true }), 25000);
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code, out: out.slice(0, 500), err: err.slice(0, 500) });
    });
  });
  console.log(JSON.stringify(result, null, 1));
  const net = require('child_process').execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  console.log('3080:', net.split(/\r?\n/).some((l) => l.includes(':3080') && /LISTENING/i.test(l)) ? 'LISTENING' : '未监听');
  process.exit(0);
}
main();
