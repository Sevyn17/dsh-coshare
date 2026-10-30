// 撤销实测：node scripts/dev/revoke.mjs <A带token的URL> <B带token的URL> <deviceId>
// A 撤销 B 后：B 已进入的代理会话访问失败、B ping 离线。
const [aUrl, bUrl, deviceId] = process.argv.slice(2);
async function login(u) {
  const r = await fetch(u, { redirect: 'manual' });
  const ck = (r.headers.getSetCookie?.() ?? []).map((s) => s.split(';')[0]).join('; ');
  const origin = new URL(u).origin;
  return async (method, body = {}) => {
    const x = await fetch(`${origin}/dsh-coshare/rpc/${method}`, { method: 'POST', headers: { cookie: ck, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return x.json();
  };
}
const a = await login(aUrl);
const b = await login(bUrl);
const opened = (await b('outgoing.open', { deviceId })).result;
const enter = await fetch(opened.url, { redirect: 'manual' });
const pc = (enter.headers.get('set-cookie') ?? '').split(';')[0];
const proxy = new URL(opened.url).origin;
const before = await fetch(`${proxy}/`, { headers: { cookie: pc } });
console.log('撤销前代理首页', before.status);
console.log('撤销前 ping', JSON.stringify((await b('outgoing.ping', { deviceId })).result));
const inc = (await a('state')).result.incoming;
const target = inc.find((d) => d.deviceId === deviceId);
console.log('A 侧设备', target ? target.name : '无');
console.log('A 撤销', JSON.stringify(await a('incoming.revoke', { deviceId })));
const after = await fetch(`${proxy}/`, { headers: { cookie: pc } }).then((r) => r.status, (e) => `ERR ${e.message}`);
console.log('撤销后代理首页', after);
const ping = (await b('outgoing.ping', { deviceId })).result;
console.log('撤销后 ping', JSON.stringify(ping).slice(0, 120));
const ok = before.status === 200 && after !== 200 && ping?.online === false && !(await a('state')).result.incoming.some((d) => d.deviceId === deviceId);
console.log(ok ? 'REVOKE PASS' : 'REVOKE FAIL');
process.exit(ok ? 0 : 1);
