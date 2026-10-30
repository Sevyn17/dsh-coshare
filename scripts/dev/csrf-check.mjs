// 模拟手机经 dsh-mobile 网关：子路径首页是否注入 CSRF 脚本；POST 带/不带 CSRF 头的结果
const [bUrl, id, gw] = process.argv.slice(2);
const bOrigin = new URL(bUrl).origin;
const ck = (r) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);
const r0 = await fetch(bUrl, { redirect: 'manual' });
const bCookie = ck(r0).join('; ');
const op = await (await fetch(`${bOrigin}/api/mobile-access/lan/pairing/open`, { method: 'POST', headers: { cookie: bCookie, 'content-type': 'application/json', origin: bOrigin }, body: '{}' })).json();
const pr = await fetch(`${gw}/mobile-access/auth/pair`, { method: 'POST', headers: { 'content-type': 'application/json', origin: gw, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ token: op.token, label: 'csrf-test' }) });
const jar = ck(pr); const cookie = jar.join('; ');
const csrf = jar.find((c) => c.startsWith('dsh_ma_csrf='))?.split('=')[1];
const base = `${gw}/dsh-coshare/peer/${id}/`;
const html = await (await fetch(base, { headers: { cookie, 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'document' } })).text();
console.log('injected', html.includes('x-dsh-mobile-csrf'));
for (const withH of [false, true]) {
  const h = { cookie, origin: gw, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  if (withH) h['x-dsh-mobile-csrf'] = csrf;
  const r = await fetch(base + 'api/remotes.list', { method: 'POST', headers: h, body: '{}' });
  console.log('POST', withH ? 'with csrf' : 'no csrf', r.status);
}
