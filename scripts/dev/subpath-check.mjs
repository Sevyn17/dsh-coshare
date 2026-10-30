// 子路径挂载验证：B 主端口 /dsh-coshare/peer/<id>/ → A
// 用法：node scripts/dev/subpath-check.mjs <B 的 token 地址> <deviceId>
const [bUrl, id] = process.argv.slice(2);
const origin = new URL(bUrl).origin;
const jar = new Map();
const keep = (r) => {
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(';');
    const at = kv.indexOf('=');
    jar.set(kv.slice(0, at).trim(), kv.slice(at + 1).trim());
  }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
const get = async (u, init = {}) => {
  let url = u;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { redirect: 'manual', ...init, headers: { cookie: cookie(), ...(init.headers ?? {}) } });
    keep(r);
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location'), url).href;
      continue;
    }
    return { r, url };
  }
  throw new Error('too many redirects');
};
await get(bUrl);
console.log('B cookies:', [...jar.keys()].join(','));
const base = `${origin}/dsh-coshare/peer/${id}`;
const noSlash = await fetch(base, { redirect: 'manual', headers: { cookie: cookie() } });
console.log('no-slash →', noSlash.status, noSlash.headers.get('location'));
const { r: idx, url: idxUrl } = await get(`${base}/`);
const html = await idx.text();
console.log('index', idx.status, html.length, 'final', idxUrl, /<base href="\.\/">/.test(html) ? 'base ok' : 'NO base');
const js = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
if (js) {
  const { r } = await get(`${base}/${js}`);
  console.log('asset', js, r.status, (await r.arrayBuffer()).byteLength);
}
const boot = html.match(/"url":"(plugins\/[^"]+)"/)?.[1];
if (boot) {
  const { r } = await get(`${base}/${boot.replace(/\\u0026/g, '&')}`);
  console.log('plugin entry', r.status, (await r.arrayBuffer()).byteLength);
}
const api = await get(`${base}/api/`, { method: 'GET' });
console.log('api probe', api.r.status);
// 不带 B Cookie：必须被拒
const anon = await fetch(`${base}/`, { redirect: 'manual' });
console.log('anon', anon.status);
// WebSocket：经精确注册的升级路径
const wsUrl = `${origin.replace('http', 'ws')}/dsh-coshare/peer/${id}/api/events.mux`;
await new Promise((res) => {
  const ws = new WebSocket(wsUrl, { headers: { cookie: cookie() } });
  const t = setTimeout(() => { console.log('ws timeout'); try { ws.close(); } catch {} res(); }, 6000);
  ws.onopen = () => { console.log('ws open'); clearTimeout(t); ws.close(); res(); };
  ws.onerror = (e) => { console.log('ws error', e.message ?? ''); clearTimeout(t); res(); };
});
