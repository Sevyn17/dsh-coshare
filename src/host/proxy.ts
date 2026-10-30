/**
 * B 端本机代理（D18「出」）：每台可访问设备一个 127.0.0.1 端口，浏览器 → 代理（http）→ A 网关（TLS-PSK）。
 *  - 浏览器鉴权：B 的 RPC 签发一次性票据，`/__dsh_share/enter?t=…` 换本地会话 Cookie（每设备不同名，
 *    因为 Cookie 不分端口），之后每个请求都要带它；转发前删掉浏览器的全部 Cookie。
 *  - 响应去掉禁止内嵌的头与全部 Set-Cookie（A 的登录态只留在 A 的网关里）。
 */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { clientPsk, CONTROL_PREFIX } from './tls-psk.js';
import { forwardRequestHeaders, forwardResponseHeaders, rawRequestHead, readCookie } from './headers.js';
import { parseEndpoint } from './invite.js';

export interface ProxyTarget {
  deviceId: string;
  identity: string;
  key: Buffer;
  endpoints: string[];
}

export interface ProxyHandle {
  port: number;
  /** 签发一次性进入票据（60 秒内有效）。 */
  ticket(): string;
  /** 子路径挂载（B 主端口 /dsh-coshare/peer/<id>/…）：调用方已鉴权，path 为去前缀后的 A 侧路径。 */
  serve(req: http.IncomingMessage, res: http.ServerResponse, path: string): void;
  upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, path: string): void;
  close(): Promise<void>;
}

const TICKET_TTL_MS = 60_000;
const SESSION_TTL_S = 12 * 3600;

export function cookieNameFor(deviceId: string): string {
  return `dsh_share_${deviceId.replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`;
}

function eq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 原始 URL 去掉 A 侧 path 后剩下的就是挂载前缀。 */
function mountOf(req: http.IncomingMessage, path: string): string {
  const url = req.url ?? '/';
  return url.endsWith(path) ? url.slice(0, url.length - path.length) : '';
}

export function startProxy(opts: { target: ProxyTarget; port: number; log: (m: string) => void }): Promise<ProxyHandle> {
  const { target, log } = opts;
  const cookieName = cookieNameFor(target.deviceId);
  const sessions = new Set<string>();
  const tickets = new Map<string, number>();
  const live = new Set<Duplex>();
  let preferred = 0;

  const endpoints = target.endpoints.map(parseEndpoint).filter((e): e is { host: string; port: number } => e !== undefined);
  const agents = endpoints.map(
    (ep) => new https.Agent({ ...clientPsk(target.identity, target.key), host: ep.host, port: ep.port, keepAlive: true, maxSockets: 32, maxCachedSessions: 0 }),
  );

  const authed = (req: http.IncomingMessage): boolean => {
    const v = readCookie(req.headers.cookie, cookieName);
    if (v === undefined) return false;
    for (const s of sessions) if (eq(s, v)) return true;
    return false;
  };

  const enter = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    const u = new URL(req.url ?? '/', 'http://x');
    const t = u.searchParams.get('t') ?? '';
    const exp = tickets.get(t);
    tickets.delete(t);
    if (exp === undefined || exp < Date.now()) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('dsh-coshare: 进入票据无效或已过期，请从共享面板重新打开。');
      return;
    }
    const sid = randomBytes(24).toString('base64url');
    sessions.add(sid);
    const next = u.searchParams.get('next') ?? '/';
    const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    res.writeHead(303, {
      location: safeNext,
      'set-cookie': `${cookieName}=${sid}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=${SESSION_TTL_S}`,
      'cache-control': 'no-store',
    });
    res.end();
  };

  const forward = (req: http.IncomingMessage, res: http.ServerResponse, idx: number, path: string = req.url ?? '/', mount = ''): void => {
    const ep = endpoints[idx];
    const agent = agents[idx];
    if (ep === undefined || agent === undefined) {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('dsh-coshare: 对方设备不可达（网关未开启或网络不通）。');
      return;
    }
    const headers = forwardRequestHeaders(req.headers, false);
    headers.host = `${ep.host}:${ep.port}`;
    const up = https.request({ host: ep.host, port: ep.port, method: req.method, path, headers, agent }, (upRes) => {
      preferred = idx;
      const out = forwardResponseHeaders(upRes.headers, true);
      // 子路径挂载：A 返回的绝对跳转（Location: /x）要加上挂载前缀
      if (mount && typeof out.location === 'string' && out.location.startsWith('/') && !out.location.startsWith('//')) out.location = mount + out.location;
      res.writeHead(upRes.statusCode ?? 502, out);
      upRes.pipe(res);
    });
    let sent = false;
    up.on('socket', (s) => s.once('secureConnect', () => (sent = true)));
    up.on('error', (e) => {
      // 连接阶段失败且请求体还没开始发：换下一个地址（只对无请求体的方法重试）
      const idempotent = req.method === 'GET' || req.method === 'HEAD';
      if (!sent && idempotent && !res.headersSent && idx + 1 < endpoints.length) {
        forward(req, res, idx + 1, path, mount);
        return;
      }
      log(`proxy ${target.deviceId} → ${ep.host}:${ep.port}: ${e.message}`);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('dsh-coshare: 对方设备不可达（网关未开启或网络不通）。');
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  };

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith(`${CONTROL_PREFIX}enter`)) {
      enter(req, res);
      return;
    }
    if (!authed(req)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }).end('dsh-coshare: 请从共享面板打开。');
      return;
    }
    if (url.startsWith(CONTROL_PREFIX)) {
      res.writeHead(404).end();
      return;
    }
    forward(req, res, preferred);
  });

  const pipeUpgrade = (req: http.IncomingMessage, socket: Duplex, head: Buffer, path: string): void => {
    const ep = endpoints[preferred];
    if (ep === undefined) {
      socket.destroy();
      return;
    }
    const headers = forwardRequestHeaders(req.headers, true);
    headers.host = `${ep.host}:${ep.port}`;
    const up = tls.connect({ ...clientPsk(target.identity, target.key), host: ep.host, port: ep.port }, () => {
      up.write(rawRequestHead(req.method ?? 'GET', path, headers));
      if (head.length > 0) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    live.add(up);
    live.add(socket);
    const kill = (): void => {
      up.destroy();
      socket.destroy();
      live.delete(up);
      live.delete(socket);
    };
    up.on('error', kill);
    socket.on('error', kill);
    up.on('close', kill);
    socket.on('close', kill);
  };

  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!authed(req)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    pipeUpgrade(req, socket, head, req.url ?? '/');
  });

  const listen = (port: number): Promise<void> =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });

  return (async () => {
    try {
      await listen(opts.port);
    } catch (e) {
      if (opts.port === 0) throw e;
      await listen(0); // 上次的端口被占用：换一个
    }
    server.on('error', (e) => log(`proxy error: ${e.message}`));
    const port = (server.address() as net.AddressInfo).port;
    return {
      port,
      ticket() {
        const now = Date.now();
        for (const [k, v] of tickets) if (v < now) tickets.delete(k);
        const t = randomBytes(24).toString('base64url');
        tickets.set(t, now + TICKET_TTL_MS);
        return t;
      },
      serve: (req, res, path) => forward(req, res, preferred, path, mountOf(req, path)),
      upgrade: (req, socket, head, path) => pipeUpgrade(req, socket, head, path),
      close: () =>
        new Promise<void>((r) => {
          for (const s of live) s.destroy();
          live.clear();
          for (const a of agents) a.destroy();
          server.closeAllConnections();
          server.close(() => r());
        }),
    };
  })();
}
