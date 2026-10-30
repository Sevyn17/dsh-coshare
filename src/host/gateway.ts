/**
 * A 端网关（D18「进」）：TLS-PSK 监听，只接受两类身份——
 *  - `inv:<inviteId>`：邀请码里的一次性密钥，只能调用配对控制接口；
 *  - `dev:<deviceId>`：已配对设备的长期密钥，请求原样转发给本机宿主（服务端附加宿主登录 Cookie）。
 * 撤销设备：删密钥并立即销毁该身份的全部连接。
 */
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import type { TLSSocket } from 'node:tls';
import { constants } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { CONTROL_PREFIX, DEVICE_PREFIX, INVITE_PREFIX, TLS_BASE } from './tls-psk.js';
import { forwardRequestHeaders, forwardResponseHeaders, rawRequestHead } from './headers.js';
import type { UpstreamAuth } from './upstream.js';

const IDENTITY = Symbol('dsh-coshare.identity');
type Tagged = TLSSocket & { [IDENTITY]?: string };

export interface GatewayHooks {
  /** 按 PSK 身份查密钥；未知身份返回 undefined（握手失败）。 */
  keyFor(identity: string): Buffer | undefined;
  /** 控制接口（配对等）；返回 JSON 结果，抛错即 400 { error }。 */
  control(identity: string, path: string, body: Record<string, unknown>): Promise<unknown>;
  allowRemote(address: string): boolean;
  log(message: string): void;
}

export interface GatewayHandle {
  port: number;
  /** 断开某身份的全部连接（撤销时用）。 */
  drop(identity: string): void;
  close(): Promise<void>;
}

const MAX_CONTROL_BODY = 16 * 1024;

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_CONTROL_BODY) {
        reject(new Error('TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const v: unknown = text.length > 0 ? JSON.parse(text) : {};
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('MALFORMED');
        resolve(v as Record<string, unknown>);
      } catch {
        reject(new Error('MALFORMED'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export function startGateway(opts: { host: string; port: number; upstream: UpstreamAuth; hooks: GatewayHooks }): Promise<GatewayHandle> {
  const { upstream, hooks } = opts;
  const sockets = new Map<string, Set<Duplex>>();
  const track = (identity: string, s: Duplex): void => {
    let set = sockets.get(identity);
    if (!set) sockets.set(identity, (set = new Set()));
    set.add(s);
    s.once('close', () => set.delete(s));
  };

  const server = https.createServer({
    ...TLS_BASE,
    pskIdentityHint: 'dsh-coshare',
    // 禁止会话恢复：恢复的会话不会再调 pskCallback，身份标记会丢失（实测 403）
    secureOptions: constants.SSL_OP_NO_TICKET,
    sessionTimeout: 1,
    pskCallback: (socket: TLSSocket, identity: string) => {
      const key = hooks.keyFor(identity);
      if (key === undefined) return null;
      (socket as Tagged)[IDENTITY] = identity;
      track(identity, socket);
      return key;
    },
  });
  server.keepAliveTimeout = 30_000;

  server.on('connection', (sock: net.Socket) => {
    const addr = (sock.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (!hooks.allowRemote(addr)) sock.destroy();
  });
  server.on('tlsClientError', (e, sock) => {
    hooks.log(`tls rejected ${sock.remoteAddress ?? '?'}: ${e.message}`);
  });

  server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    const identity = (req.socket as Tagged)[IDENTITY];
    // 握手后再次核对（撤销后的残余 keep-alive 连接也会在这里被挡）
    if (identity === undefined || hooks.keyFor(identity) === undefined) {
      res.writeHead(403).end();
      req.socket.destroy();
      return;
    }
    const url = req.url ?? '/';
    if (url.startsWith(CONTROL_PREFIX)) {
      void (async () => {
        try {
          const body = req.method === 'POST' ? await readJson(req) : {};
          sendJson(res, 200, { result: await hooks.control(identity, url.slice(CONTROL_PREFIX.length).split('?')[0]!, body) });
        } catch (e) {
          sendJson(res, 400, { error: (e as Error).message });
        }
      })();
      return;
    }
    if (!identity.startsWith(DEVICE_PREFIX)) {
      // 邀请身份只能配对
      res.writeHead(403).end();
      return;
    }
    void forwardHttp(req, res);
  });

  const forwardHttp = async (req: http.IncomingMessage, res: http.ServerResponse, retried = false): Promise<void> => {
    let cookie: string;
    try {
      cookie = await upstream.cookieHeader();
    } catch (e) {
      hooks.log(`upstream auth failed: ${(e as Error).message}`);
      if (!res.headersSent) res.writeHead(502).end();
      return;
    }
    const base = upstream.upstreamOrigin();
    const headers = forwardRequestHeaders(req.headers, false);
    headers.host = base.host;
    headers.cookie = cookie;
    if (headers.origin !== undefined) headers.origin = base.origin;
    if (typeof headers.referer === 'string') {
      try {
        const r = new URL(headers.referer);
        headers.referer = `${base.origin}${r.pathname}${r.search}`;
      } catch {
        delete headers.referer;
      }
    }
    const up = http.request(
      { hostname: base.hostname.replace(/^\[|\]$/g, ''), port: Number(base.port), method: req.method, path: req.url, headers },
      (upRes) => {
        if (upRes.statusCode === 401 && !retried && (req.method === 'GET' || req.method === 'HEAD')) {
          // 宿主登录 Cookie 失效：重新换一次再试
          upRes.resume();
          upstream.invalidate();
          void forwardHttp(req, res, true);
          return;
        }
        res.writeHead(upRes.statusCode ?? 502, forwardResponseHeaders(upRes.headers, false));
        upRes.pipe(res);
      },
    );
    up.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on('close', () => up.destroy());
    req.pipe(up);
  };

  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const identity = (req.socket as Tagged)[IDENTITY];
    if (identity === undefined || !identity.startsWith(DEVICE_PREFIX) || hooks.keyFor(identity) === undefined) {
      socket.destroy();
      return;
    }
    void (async () => {
      let cookie: string;
      try {
        cookie = await upstream.cookieHeader();
      } catch {
        socket.destroy();
        return;
      }
      const base = upstream.upstreamOrigin();
      const headers = forwardRequestHeaders(req.headers, true);
      headers.host = base.host;
      headers.cookie = cookie;
      if (headers.origin !== undefined) headers.origin = base.origin;
      const up = net.connect({ host: base.hostname.replace(/^\[|\]$/g, ''), port: Number(base.port) }, () => {
        up.write(rawRequestHead(req.method ?? 'GET', req.url ?? '/', headers));
        if (head.length > 0) up.write(head);
        up.pipe(socket);
        socket.pipe(up);
      });
      track(identity, up);
      const kill = (): void => {
        up.destroy();
        socket.destroy();
      };
      up.on('error', kill);
      socket.on('error', kill);
      up.on('close', kill);
      socket.on('close', kill);
    })();
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      server.on('error', (e) => hooks.log(`gateway error: ${e.message}`));
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        drop(identity) {
          for (const s of sockets.get(identity) ?? []) s.destroy();
          sockets.delete(identity);
        },
        close: () =>
          new Promise<void>((r) => {
            for (const set of sockets.values()) for (const s of set) s.destroy();
            sockets.clear();
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}

/** IPv4 CIDR 判断；非 IPv4（含 IPv6）只放行回环。 */
export function cidrAllows(cidrs: readonly string[], address: string): boolean {
  const ip = ipv4ToInt(address);
  if (ip === undefined) return address === '::1';
  return cidrs.some((c) => {
    const [net4, bitsText] = c.split('/');
    const base = ipv4ToInt(net4 ?? '');
    const bits = Number(bitsText ?? '32');
    if (base === undefined || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((ip & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

function ipv4ToInt(a: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return undefined;
  const p = m.slice(1).map(Number);
  if (p.some((n) => n > 255)) return undefined;
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

export { INVITE_PREFIX };
