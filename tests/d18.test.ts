/**
 * D18 端到端（进程内）：假宿主 + A 服务（网关）+ B 服务（代理），真实 TLS-PSK。
 * 覆盖：邀请→请求→校验码→A 确认→B 取得密钥→打开代理→转发（Host/Cookie 改写）→WS 升级→撤销后断开。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { ShareStore, type DeviceKeys } from '../src/host/store.ts';
import { UpstreamAuth } from '../src/host/upstream.ts';
import { ShareService } from '../src/host/service.ts';
import { decodeInvite, verifyCode } from '../src/host/invite.ts';
import { forwardResponseHeaders } from '../src/host/headers.ts';

const TOKEN = 'tok123';
const COOKIE = 'dsh-auth-x=SIGNED';

/** 假宿主：/?token= 换 303 Cookie；其余请求回显 host/cookie/origin；/ws 升级回显。 */
async function fakeHost(): Promise<{ origin: string; close: () => Promise<void>; seen: http.IncomingHttpHeaders[] }> {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    if (req.url === `/?token=${TOKEN}`) {
      res.writeHead(303, { location: '/', 'set-cookie': `${COOKIE}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600` }).end();
      return;
    }
    seen.push(req.headers);
    if (req.headers.cookie !== COOKIE) {
      res.writeHead(401).end('no auth');
      return;
    }
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'set-cookie': 'leak=1; Path=/',
    });
    res.end(JSON.stringify({ url: req.url, host: req.headers.host, origin: req.headers.origin ?? null }));
  });
  const upgraded = new Set<import('node:stream').Duplex>();
  server.on('upgrade', (req, socket) => {
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
    if (req.headers.cookie !== COOKIE) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: raw\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(`echo:${d.toString()}`));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise((r) => {
        for (const s of upgraded) s.destroy();
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

function memSecrets(): { read: () => Promise<unknown>; write: (v: DeviceKeys) => Promise<void> } {
  let v: unknown;
  return { read: async () => v, write: async (x) => void (v = structuredClone(x)) };
}

async function makeService(name: string, hostOrigin: string): Promise<ShareService> {
  const dir = mkdtempSync(path.join(os.tmpdir(), `dshs-${name}-`));
  const store = new ShareStore(path.join(dir, 'state.json'), memSecrets(), () => undefined);
  await store.load(name);
  const upstream = new UpstreamAuth(
    () => hostOrigin,
    (base) => `${base}?token=${TOKEN}`,
  );
  const svc = new ShareService({
    store,
    upstream,
    log: () => undefined,
    config: { listenHost: '127.0.0.1', port: 0, allowedCidrs: [], advertiseHosts: ['127.0.0.1'], inviteTtlMinutes: 10 },
  });
  await svc.start();
  return svc;
}

type Snap = {
  gateway: { running: boolean; port: number };
  incoming: { deviceId: string }[];
  outgoing: { deviceId: string; name: string }[];
  requests: { requestId: string; code: string; name: string }[];
  attempts: { attemptId: string; status: string; code: string }[];
};
const snap = (s: ShareService): Snap => s.snapshot() as Snap;

async function until(fn: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers, agent: false }, (res) => {
        const c: Buffer[] = [];
        res.on('data', (d: Buffer) => c.push(d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(c).toString('utf8') }));
      })
      .on('error', reject);
  });
}

async function pairAB(): Promise<{ host: Awaited<ReturnType<typeof fakeHost>>; a: ShareService; b: ShareService; deviceId: string }> {
  const host = await fakeHost();
  const a = await makeService('A', host.origin);
  const b = await makeService('B', 'http://127.0.0.1:1');
  await a.setGateway(true);
  const inv = a.createInvite();
  const attempt = await b.startPair(inv.code);
  const req = snap(a).requests[0];
  assert.ok(req, 'A 收到配对请求');
  assert.equal(req.code, attempt.code, '两边校验码一致');
  assert.equal(req.name, 'B');
  await a.confirmRequest(req.requestId);
  await until(() => snap(b).attempts[0]?.status === 'approved');
  const dev = snap(b).outgoing[0];
  assert.ok(dev);
  assert.equal(dev.name, 'A');
  assert.equal(snap(a).incoming.length, 1);
  return { host, a, b, deviceId: dev.deviceId };
}

async function teardown(...xs: { stop?: () => Promise<void>; close?: () => Promise<void> }[]): Promise<void> {
  for (const x of xs) await (x.stop ?? x.close)!.call(x);
}

test('配对 → 打开 → 转发 → WS → 撤销断开', async () => {
  const { host, a, b, deviceId } = await pairAB();
  try {
    // 邀请码只能用一次
    const opened = await b.open(deviceId);
    const base = `http://127.0.0.1:${opened.port}`;

    // 未持票据：401
    assert.equal((await get(`${base}/api/x`)).status, 401);

    // 票据换本地 cookie
    const enter = await get(opened.url.replace(/\/__dsh_share\/enter/, '/__dsh_share/enter'));
    assert.equal(enter.status, 303);
    const sc = String(enter.headers['set-cookie']?.[0] ?? '');
    const pair = sc.split(';', 1)[0]!;
    assert.match(pair, /^dsh_share_/);
    // 票据一次性
    assert.notEqual((await get(opened.url)).status, 303);

    const r = await get(`${base}/api/x?y=1`, { cookie: `${pair}; other=evil`, origin: base });
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body) as { url: string; host: string; origin: string };
    assert.equal(body.url, '/api/x?y=1');
    assert.equal(body.host, new URL(host.origin).host, 'Host 改写为 A 回环');
    assert.equal(body.origin, host.origin, 'Origin 改写为 A 回环');
    assert.equal(host.seen.at(-1)?.cookie, COOKIE, 'B 的 cookie 不外泄，A 宿主 cookie 由网关附加');
    assert.equal(r.headers['x-frame-options'], undefined, '去掉禁内嵌头');
    assert.ok(!String(r.headers['content-security-policy']).includes('frame-ancestors'));
    assert.equal(r.headers['set-cookie'], undefined, 'A 的 Set-Cookie 不进 B 浏览器');

    // WS 升级
    const echoed = await new Promise<string>((resolve, reject) => {
      const s = net.connect(opened.port, '127.0.0.1', () => {
        s.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${opened.port}\r\nConnection: Upgrade\r\nUpgrade: raw\r\nCookie: ${pair}\r\n\r\n`);
      });
      let buf = '';
      s.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('\r\n\r\n') && !buf.includes('echo:')) s.write('hi');
        if (buf.includes('echo:hi')) {
          s.destroy();
          resolve(buf);
        }
      });
      s.on('error', reject);
    });
    assert.match(echoed, /101 Switching/);

    // B 能 ping 到 A
    assert.equal((await b.ping(deviceId)).online, true);

    // A 撤销：B 再访问失败
    a.revokeIncoming(deviceId);
    const after = await get(`${base}/api/x`, { cookie: pair });
    assert.notEqual(after.status, 200);
    assert.equal((await b.ping(deviceId)).online, false);
  } finally {
    await teardown(b, a, host);
  }
});

test('拒绝、重用邀请码、自配对、关闭网关', async () => {
  const host = await fakeHost();
  const a = await makeService('A', host.origin);
  const b = await makeService('B', 'http://127.0.0.1:1');
  const c = await makeService('C', 'http://127.0.0.1:1');
  try {
    assert.throws(() => a.createInvite(), /GATEWAY_OFF/);
    await a.setGateway(true);
    const inv = a.createInvite();
    assert.equal(decodeInvite(inv.code).name, 'A');
    await assert.rejects(a.startPair(inv.code), /SELF_PAIR/);
    await b.startPair(inv.code);
    await assert.rejects(c.startPair(inv.code), /INVITE_USED/);
    a.rejectRequest(snap(a).requests[0]!.requestId);
    await until(() => snap(b).attempts[0]?.status === 'rejected');
    assert.equal(snap(b).outgoing.length, 0);
    assert.equal(snap(a).incoming.length, 0);
    // 邀请已作废
    await assert.rejects(c.startPair(inv.code));
    // 关闭网关后新邀请失败、旧连接不可达
    await a.setGateway(false);
    assert.equal(snap(a).gateway.running, false);
  } finally {
    await teardown(c, b, a, host);
  }
});

test('B 删除设备会通知 A 删掉密钥', async () => {
  const { host, a, b, deviceId } = await pairAB();
  try {
    await b.removeOutgoing(deviceId);
    assert.equal(snap(b).outgoing.length, 0);
    await until(() => snap(a).incoming.length === 0);
  } finally {
    await teardown(b, a, host);
  }
});

test('响应头过滤', () => {
  const h = forwardResponseHeaders(
    {
      'set-cookie': ['a=1'],
      'x-frame-options': 'DENY',
      'strict-transport-security': 'max-age=1',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'content-type': 'text/html',
    },
    true,
  );
  assert.equal(h['set-cookie'], undefined);
  assert.equal(h['x-frame-options'], undefined);
  assert.equal(h['strict-transport-security'], undefined);
  assert.equal(h['content-type'], 'text/html');
  assert.ok(!String(h['content-security-policy']).includes('frame-ancestors'));
});

test('邀请码过期、篡改、校验码随请求方变化', async () => {
  const host = await fakeHost();
  const a = await makeService('A', host.origin);
  try {
    await a.setGateway(true);
    const inv = a.createInvite();
    assert.throws(() => decodeInvite(inv.code, inv.expiresAt + 1), /EXPIRED/);
    assert.throws(() => decodeInvite('hello'), /NOT_INVITE/);
    assert.throws(() => decodeInvite(inv.code.slice(0, -6)), /MALFORMED|NOT_INVITE/);
    const key = Buffer.from(decodeInvite(inv.code).key, 'base64url');
    const c1 = verifyCode(key, 'inst-1');
    assert.match(c1, /^\d{6}$/);
    assert.notEqual(c1, verifyCode(key, 'inst-2'), '不同请求方校验码不同（中间人换身份会被发现）');
  } finally {
    await teardown(a, host);
  }
});

test('同一实例重新配对：替换旧设备，旧密钥失效', async () => {
  const { host, a, b, deviceId } = await pairAB();
  try {
    const inv = a.createInvite();
    await b.startPair(inv.code);
    await until(() => snap(a).requests.length === 1);
    await a.confirmRequest(snap(a).requests[0]!.requestId);
    await until(() => snap(b).outgoing.length === 1 && snap(b).outgoing[0]!.deviceId !== deviceId);
    assert.equal(snap(a).incoming.length, 1, 'A 只保留一条');
    assert.notEqual(snap(a).incoming[0]!.deviceId, deviceId);
    assert.equal((await b.ping(snap(b).outgoing[0]!.deviceId)).online, true);
  } finally {
    await teardown(b, a, host);
  }
});

test('暂停网关：已配对设备不可达，恢复后可达且配对保留', async () => {
  const { host, a, b, deviceId } = await pairAB();
  try {
    await a.setGateway(false);
    assert.equal((await b.ping(deviceId)).online, false);
    assert.equal(snap(a).incoming.length, 1);
    await a.setGateway(true);
    await until(() => snap(a).gateway.running);
    assert.equal((await b.ping(deviceId)).online, true, '恢复后沿用原端口');
  } finally {
    await teardown(b, a, host);
  }
});
