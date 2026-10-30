// 两测试实例实测（只连 3211/3212）：node scripts/d18-live.mjs <A_URL> <B_URL>
import http from 'node:http';

const [aUrl, bUrl] = process.argv.slice(2);
if (!aUrl || !bUrl) throw new Error('usage: d18-live.mjs <A_URL with token> <B_URL with token>');

function req(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers, agent: false }, (res) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function login(url) {
  const r = await req(url);
  if (r.status !== 303) throw new Error(`login ${url} → ${r.status}`);
  const cookie = [].concat(r.headers['set-cookie'] ?? []).map((s) => s.split(';', 1)[0]).join('; ');
  const origin = new URL(url).origin;
  return async (method, params = {}) => {
    const res = await req(`${origin}/dsh-coshare/rpc/${method}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin },
      body: JSON.stringify(params),
    });
    let j;
    try { j = JSON.parse(res.body); } catch { throw new Error(`${method}: HTTP ${res.status} ${res.body.slice(0, 200)}`); }
    if (j.error) throw new Error(`${method}: ${j.error}`);
    return j.result;
  };
}

const step = (m) => console.log('STEP', m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = await login(aUrl);
const B = await login(bUrl);

step('A 开网关');
await A('gateway.set', { enabled: true });
let sa = await A('state');
console.log('  gateway', JSON.stringify(sa.gateway));
step('A 生成邀请码');
const inv = await A('invite.create');
console.log('  code len', inv.code.length);
step('B 发起配对');
const at = await B('pair.start', { code: inv.code });
console.log('  B 校验码', at.code);
sa = await A('state');
const rq = sa.requests.at(-1);
console.log('  A 校验码', rq?.code, rq?.code === at.code ? '一致' : '不一致!');
step('A 确认');
await A('request.confirm', { requestId: rq.requestId });
let dev;
for (let i = 0; i < 20 && !dev; i++) {
  await sleep(500);
  const sb = await B('state');
  dev = sb.outgoing.find((d) => sb.attempts.find((x) => x.attemptId === at.attemptId)?.status === 'approved' && d.instanceId === sa.self.instanceId);
}
if (!dev) throw new Error('B 没拿到设备');
console.log('  B 设备', dev.name, dev.deviceId);
step('B ping');
console.log('  ', JSON.stringify(await B('outgoing.ping', { deviceId: dev.deviceId })));
step('B 打开');
const op = await B('outgoing.open', { deviceId: dev.deviceId });
const ent = await req(op.url);
const pc = [].concat(ent.headers['set-cookie'] ?? [])[0]?.split(';', 1)[0];
console.log('  enter', ent.status, pc?.split('=')[0]);
const page = await req(`http://127.0.0.1:${op.port}/`, { headers: { cookie: pc } });
console.log('  首页', page.status, /<html/i.test(page.body) ? 'HTML' : page.body.slice(0, 120), 'XFO=', page.headers['x-frame-options'] ?? '无');
console.log('URL_FOR_BROWSER', op.url);
console.log('DEVICE', dev.deviceId, 'PORT', op.port);
console.log('ALL PASS');
