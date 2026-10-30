// 实测：B 调 outgoing.open → 顶层打开代理 → 在 A 的原版页面发消息 → 等回复。
// node scripts/d18-send.mjs <B带token的URL> <deviceId> <marker> [out.png]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [bUrl, deviceId, marker, out = '.shot/d18/send.png'] = process.argv.slice(2);
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const port = 9700 + Math.floor(Math.random() * 100);
const dir = mkdtempSync(join(tmpdir(), 'shot-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let code = 1;
try {
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (list.length) break; } catch {}
    await sleep(200);
  }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable');
  await send('Page.navigate', { url: bUrl });
  await sleep(3000);
  const url = await ev(`fetch('dsh-coshare/rpc/outgoing.open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:${JSON.stringify(deviceId)}})}).then(r=>r.json()).then(j=>j.result?.url ?? JSON.stringify(j))`);
  console.log('open ->', url);
  await send('Page.navigate', { url });
  await sleep(5000);
  const focus = await ev(`(()=>{const e=document.querySelector('textarea,[contenteditable=true],[contenteditable=""]');if(!e)return 'NO INPUT';e.focus();return e.tagName})()`);
  console.log('input:', focus);
  await send('Input.insertText', { text: process.env.PROMPT ?? `请只回复 ${marker}` });
  await sleep(500);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  const t0 = Date.now();
  let got = false;
  const count = () => ev(`document.body.innerText.split(${JSON.stringify(marker)}).length-1`);
  await sleep(3000);
  const base = await count(); // 标题+侧栏+用户气泡
  console.log('baseline', base);
  let approved = 0;
  while (Date.now() - t0 < 90000) {
    if (process.env.APPROVE) {
      // 审批卡：点「允许/批准/同意」类按钮（只点一次性授权）
      const c = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/^(允许|批准|同意|仅本次|允许一次|Allow)/.test((e.textContent||'').trim()));if(!b)return '';const t=b.textContent.trim();b.click();return t})()`);
      if (c) { approved++; console.log('approval clicked:', c); await sleep(1500); continue; }
    }
    // 回复完成时消息下方出现「用量」行（新会话页面里此前不存在）
    if (await ev(`[...document.querySelectorAll('*')].some(e=>e.children.length===0&&/^用量/.test((e.textContent||'').trim()))`)) { got = true; break; }
    const n = await count();
    if (n > base) { got = true; break; }
    await sleep(1000);
  }
  console.log('reply:', got ? `收到 (${Math.round((Date.now() - t0) / 1000)}s)` : '超时', '| page:', await ev('location.href'));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  code = got ? 0 : 1;
} finally {
  proc.kill();
}
process.exit(code);
