// 经 B 的 dsh-mobile 网关（测试端口 3643）访问 /dsh-coshare/peer/<id>/：模拟已配对手机
// 用法：NODE_EXTRA_CA_CERTS=<ca.pem> node scripts/dev/mobile-check.mjs <B token 地址> <deviceId> <网关 origin>
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
const [bUrl, id, gw] = process.argv.slice(2);
const bOrigin = new URL(bUrl).origin;
const ck = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
// 1) B 本机登录
const r0 = await fetch(bUrl, { redirect: 'manual' });
const bCookie = ck(r0).join('; ');
// 2) B 本机开配对窗口
const op = await fetch(`${bOrigin}/api/mobile-access/lan/pairing/open`, {
  method: 'POST', headers: { cookie: bCookie, 'content-type': 'application/json', origin: bOrigin }, body: '{}',
});
const opened = await op.json().catch(() => ({}));
console.log('pairing/open', op.status, Object.keys(opened).join(','));
const token = opened.token ?? new URLSearchParams(String(opened.pairUrl ?? '').split('#')[1] ?? '').get('token');
if (!token) { console.log(JSON.stringify(opened).slice(0, 300)); process.exit(1); }
// 3) "手机" 在网关上配对
const pr = await fetch(`${gw}/mobile-access/auth/pair`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: gw, 'sec-fetch-site': 'same-origin' },
  body: JSON.stringify({ token, label: 'coshare-test' }),
});
const pj = await pr.json().catch(() => ({}));
const jar = ck(pr);
console.log('pair', pr.status, pj.paired, 'cookies', jar.map((c) => c.split('=')[0]).join(','));
const cookie = jar.join('; ');
const H = { cookie, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
// 4) 子路径首页与资源
const base = `${gw}/dsh-coshare/peer/${id}/`;
const idx = await fetch(base, { headers: H, redirect: 'manual' });
const html = await idx.text();
console.log('index', idx.status, html.length, /<base href="\.\/">/.test(html) ? 'base ok' : 'NO base', /__DSH_MOBILE_FRONTEND__/.test(html) ? 'mobile-rewritten' : 'not-rewritten');
const js = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
if (js) { const r = await fetch(base + js, { headers: { cookie, 'sec-fetch-site': 'same-origin' } }); console.log('asset', r.status, (await r.arrayBuffer()).byteLength); }
const boot = html.match(/"url":"(plugins\/[^"]+)"/)?.[1];
if (boot) { const r = await fetch(base + boot.replace(/\\u0026/g, '&'), { headers: { cookie, 'sec-fetch-site': 'same-origin' } }); console.log('plugin entry', r.status); }
// 5) WebSocket（原始握手，看网关是否放行）
const g = new URL(gw);
const ca = process.env.NODE_EXTRA_CA_CERTS ? readFileSync(process.env.NODE_EXTRA_CA_CERTS) : undefined;
for (const p of [`/dsh-coshare/peer/${id}/api/remote.mux`, '/api/remote.mux']) {
  await new Promise((res) => {
    const s = tls.connect({ host: g.hostname, port: Number(g.port), ca, servername: g.hostname }, () => {
      s.write(`GET ${p} HTTP/1.1\r\nHost: ${g.host}\r\nOrigin: ${gw}\r\nCookie: ${cookie}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    });
    let buf = '';
    const done = (m) => { console.log('ws', p, '→', m); s.destroy(); res(); };
    s.on('data', (d) => { buf += d.toString('latin1'); if (buf.includes('\r\n\r\n')) done(buf.split('\r\n')[0]); });
    s.on('error', (e) => done('error ' + e.message));
    s.on('close', () => { if (!buf) done('closed'); });
    setTimeout(() => done('timeout'), 6000);
  });
}
