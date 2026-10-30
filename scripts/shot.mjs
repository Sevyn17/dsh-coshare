// 无头 Chrome + CDP 截图工具：node scripts/shot.mjs <url> <out.png> [clickText] [evalJs]
// 目的：改 UI 必须亲眼看渲染，而不是只看「构建通过」。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, clickText, evalJs] = process.argv.slice(2);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const port = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), 'shot-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1280,800', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch { /* 等待启动 */ }
    await sleep(200);
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(4000);
  // clickText 支持 `a|b|c` 顺序点击；以 `~` 开头表示包含匹配
  for (const raw of (clickText ?? '').split('|').filter(Boolean)) {
    const contains = raw.startsWith('~');
    const text = contains ? raw.slice(1) : raw;
    const r = await ev(`(()=>{const t=${JSON.stringify(text)};const els=[...document.querySelectorAll('button,a,[role=button],div,span')].filter(e=>e.children.length<4&&(${contains}?(e.textContent||'').includes(t):(e.textContent||'').trim()===t));const e=els[els.length>1&&${contains}?els.length-1:0];if(!e)return 'NOT FOUND';e.click();return 'clicked '+e.tagName})()`);
    console.log('click:', raw, r);
    await sleep(1500);
  }
  if (evalJs) console.log('eval:', JSON.stringify(await ev(evalJs)));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally { proc.kill(); }
