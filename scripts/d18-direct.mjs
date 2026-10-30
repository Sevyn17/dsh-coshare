// 诊断：B 页面里调 outgoing.open 拿票据，然后顶层打开代理地址，收集控制台错误与失败请求。
// node scripts/d18-direct.mjs <B带token的URL> <deviceId> [out.png]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [bUrl, deviceId, out = '.shot/d18/direct.png'] = process.argv.slice(2);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const port = 9800 + Math.floor(Math.random() * 100);
const dir = mkdtempSync(join(tmpdir(), 'shot-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(`console.${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
    if (d.method === 'Runtime.exceptionThrown') logs.push(`exception: ${(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 400)}`);
    if (d.method === 'Network.responseReceived' && d.params.response.status >= 400) logs.push(`http ${d.params.response.status} ${d.params.response.url}`);
    if (d.method === 'Network.loadingFailed') logs.push(`fail ${d.params.errorText} ${d.params.type}`);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Page.navigate', { url: bUrl });
  await sleep(3000);
  const url = await ev(`fetch('dsh-coshare/rpc/outgoing.open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:${JSON.stringify(deviceId)}})}).then(r=>r.json()).then(j=>j.result?.url ?? JSON.stringify(j))`);
  console.log('open ->', url);
  logs.length = 0;
  await send('Page.navigate', { url });
  await sleep(8000);
  console.log('location:', await ev('location.href'));
  console.log('title:', await ev('document.title'), '| body len:', await ev('document.body?.innerText.length'), '| boot:', await ev('typeof window.__DSH_BOOT__'));
  console.log(logs.slice(0, 30).join('\n'));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally {
  proc.kill();
}
