// 模拟手机：经 B 的 dsh-mobile 网关配对拿 Cookie，再用无头 Chrome 打开网关首页的共享面板截图
// 用法：node scripts/dev/gw-panel.mjs <B token 地址> <网关 origin> <out.png>
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const [bUrl, gw, out] = process.argv.slice(2);
const bOrigin = new URL(bUrl).origin;
const ck = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const r0 = await fetch(bUrl, { redirect: 'manual' });
const bCookie = ck(r0).join('; ');
const op = await fetch(`${bOrigin}/api/mobile-access/lan/pairing/open`, { method: 'POST', headers: { cookie: bCookie, 'content-type': 'application/json', origin: bOrigin }, body: '{}' });
const opened = await op.json();
const token = opened.token ?? new URLSearchParams(String(opened.pairUrl ?? '').split('#')[1] ?? '').get('token');
const pr = await fetch(`${gw}/mobile-access/auth/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: gw, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ token, label: 'coshare-shot' }) });
const jar = ck(pr);
console.log('pair', pr.status, jar.map((c) => c.split('=')[0]).join(','));
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const port = 9300 + Math.floor(Math.random() * 500);
const dir = mkdtempSync(join(tmpdir(), 'shot-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1280,800', '--hide-scrollbars', '--ignore-certificate-errors', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let list;
  for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {} await sleep(200); }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const pending = new Map(); const wsSt = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === 'Network.webSocketHandshakeResponseReceived') wsSt.push(d.params.response.status); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++n; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable'); await send('Network.enable');
  for (const c of jar) { const [name, ...v] = c.split('='); await send('Network.setCookie', { name, value: v.join('='), url: gw, secure: true }); }
  await send('Page.navigate', { url: `${gw}/` });
  await sleep(6000);
  console.log('loc', await ev('location.href'));
  const clicked = await ev(`(()=>{const e=[...document.querySelectorAll('*')].filter(x=>x.children.length===0&&(x.textContent||'').trim()==='协作共享').map(x=>x.closest('button,a,[role=button],[role=menuitem],li')||x)[0];if(!e)return 'NOT FOUND';e.click();return 'clicked '+(e.getAttribute('title')||e.textContent).slice(0,30)})()`);
  console.log('click', clicked);
  await sleep(8000);
  console.log('frames', JSON.stringify(await ev(`[...document.querySelectorAll('iframe.dsh-share-frame')].map(f=>f.getAttribute('src'))`)));
  console.log('text', JSON.stringify(await ev(`(document.querySelector('.dsh-share-panel')||document.body).innerText.slice(0,300)`)));
  await sleep(6000); console.log('frameText', JSON.stringify(await ev(`(()=>{const f=document.querySelector('iframe.dsh-share-frame');try{return f.contentDocument.body.innerText.slice(0,400)}catch(e){return 'ERR '+e.message}})()`)));
  console.log('ws', JSON.stringify(wsSt));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally { proc.kill(); }
