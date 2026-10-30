// 无头 Chrome：先用 B 的 token 地址登录，再打开 B 主端口子路径 /dsh-coshare/peer/<id>/，截图并统计 WS/错误
// 用法：node scripts/dev/subpath-shot.mjs <B token 地址> <deviceId> <out.png> [width,height]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [bUrl, id, out, size = '1280,800'] = process.argv.slice(2);
const origin = new URL(bUrl).origin;
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const port = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), 'shot-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${size}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch { /* 等待 */ }
    await sleep(200);
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const pending = new Map();
  const wsOpened = []; const wsFail = []; const httpFail = []; const consoleErr = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === 'Network.webSocketHandshakeResponseReceived') wsOpened.push(d.params.response.status);
    if (d.method === 'Network.webSocketCreated') wsFail.push(['created', d.params.url]);
    if (d.method === 'Network.loadingFailed') httpFail.push(d.params.errorText);
    if (d.method === 'Network.responseReceived' && d.params.response.status >= 400) httpFail.push(`${d.params.response.status} ${d.params.response.url}`);
    if (d.method === 'Runtime.exceptionThrown') consoleErr.push(d.params.exceptionDetails.exception?.description?.slice(0, 200));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErr.push(d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++n; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: bUrl });
  await sleep(3000);
  await send('Page.navigate', { url: `${origin}/dsh-coshare/peer/${id}/` });
  await sleep(9000);
  console.log('location', await ev('location.href'));
  console.log('title', await ev('document.title'));
  console.log('text', JSON.stringify(await ev('document.body.innerText.slice(0,300)')));
  console.log('ws created', JSON.stringify(wsFail));
  console.log('ws handshakes', JSON.stringify(wsOpened));
  console.log('http fail', JSON.stringify(httpFail.slice(0, 10)));
  console.log('errors', JSON.stringify(consoleErr.slice(0, 8)));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally { proc.kill(); }
