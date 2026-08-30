/* eslint-disable */
// 临时对照实验：定位 dsh web 静默失败的环节（跑完即删）
const { spawn } = require('child_process');
const fs = require('fs');

function run(cwd, args, label, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = spawn('cmd.exe', ['/d', '/c', 'dsh ' + args], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        child.kill();
        resolve({ label, timedOut: true, head: out.slice(0, 200), errHead: err.slice(0, 200) });
      }
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (err += d.toString('utf8')));
    child.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({ label, code, outHead: out.slice(0, 250), errHead: err.slice(0, 250) });
    });
  });
}

(async () => {
  const a = await run('D:/ai/DeepSeek Harness', 'web', 'A: Harness目录下 dsh web');
  console.log(JSON.stringify(a, null, 1));
  const b = await run('C:/Users/eosin', 'web', 'B: 家目录下 dsh web');
  console.log(JSON.stringify(b, null, 1));
  const c = await run('D:/ai/DeepSeek Harness', '--profile web --help', 'C: Harness目录 dsh --profile web --help');
  console.log(JSON.stringify(c, null, 1));
  process.exit(0);
})();
