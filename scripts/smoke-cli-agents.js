'use strict';
// dsh / pi 卡片全链路冒烟：启动（弹新终端窗口）→ 状态识别为运行中 → 停止 → 已停止
const BASE = 'http://127.0.0.1:8787/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function status(id) {
  return (await (await fetch(`${BASE}/projects/${id}/status`)).json()).status;
}

async function waitFor(id, want, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await status(id)) === want) return true;
    await sleep(800);
  }
  return false;
}

(async () => {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['dsh', 'pi'];
  for (const id of ids) {
    console.log(`[${id}] 启动前状态:`, await status(id));
    const s = await (await fetch(`${BASE}/projects/${id}/start`, { method: 'POST' })).json();
    console.log(`[${id}] start:`, JSON.stringify(s));
    const up = await waitFor(id, 'running', 40000);
    console.log(`[${id}] 识别为运行中:`, up ? 'OK' : 'FAIL (当前: ' + (await status(id)) + ')');
    const p = await (await fetch(`${BASE}/projects/${id}/stop`, { method: 'POST' })).json();
    console.log(`[${id}] stop:`, JSON.stringify(p));
    const down = await waitFor(id, 'stopped', 20000);
    console.log(`[${id}] 回到已停止:`, down ? 'OK' : 'FAIL (当前: ' + (await status(id)) + ')');
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
