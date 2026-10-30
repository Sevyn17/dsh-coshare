/**
 * dsh-coshare 宿主入口（D18）：A 端 TLS-PSK 网关 + B 端本机代理 + 本机 RPC（管理界面用）。
 * 宿主能力只用 inject 声明的服务：credentials（设备密钥）、webServer（RPC 路由）、connection（鉴权、启动令牌地址）。
 */
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import Schema from '@deepseek-ai/schemastery';
import { ShareStore, type DeviceKeys, type SecretBackend } from './store.js';
import { UpstreamAuth } from './upstream.js';
import { ShareService, PEER_PREFIX } from './service.js';

/** 宿主前端用到的 WebSocket 路径（宿主 upgrade 只支持精确路径，子路径挂载要逐个注册）。 */
const PEER_WS_PATHS = [
  '/api/events.mux', '/api/events.host', '/api/remote.mux',
  // dsh-better-sidebar
  '/sidebar/ws/terminal', '/sidebar/ws/agent-opens', '/sidebar/ws/agent-terminals', '/sidebar/ws/fs-watch', '/sidebar/ws/sidechat',
];
const PEER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const name = 'dsh-coshare';
export const inject = ['credentials', 'webServer', 'connection'] as const;

export interface ShareConfig {
  enabled: boolean;
  listenHost: string;
  port: number;
  allowedCidrs: string[];
  advertiseHosts: string[];
  inviteTtlMinutes: number;
  stateFile: string;
}

export const Config: Schema<ShareConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('插件总开关'),
  listenHost: Schema.string().default('0.0.0.0').description('网关监听地址'),
  port: Schema.number().default(0).description('网关端口；0 = 沿用上次端口（首次随机）'),
  allowedCidrs: Schema.array(Schema.string())
    .default(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'])
    .description('允许连接网关的来源网段（回环始终允许）'),
  advertiseHosts: Schema.array(Schema.string()).default([]).description('邀请码里公布的本机地址；留空 = 自动取本机局域网 IPv4'),
  inviteTtlMinutes: Schema.number().min(1).max(60).default(10).description('邀请码有效期（分钟）'),
  stateFile: Schema.string().default('').description('状态文件；留空 = $DSH_HOME/dsh-coshare/state.json'),
});

type Rec = { kind: string; payload?: unknown };
export interface HostCtx {
  logger?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void };
  credentials: {
    readRecord(key: string): Promise<Rec | undefined>;
    modifyRecord(key: string, mutate: (cur: Rec | undefined) => Promise<Rec | undefined>): Promise<unknown>;
  };
  webServer: {
    register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void;
    getOrigin(): string;
    registerUpgrade(route: { path: string; handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void> }): () => void;
  };
  connection: {
    requestRejection(req: { headers: IncomingMessage['headers'] }): 401 | 403 | undefined;
    authenticatedUrl(base: string): string;
  };
  effect(fn: () => (() => void | Promise<void>) | void, label?: string): unknown;
}

export const RPC_PATH = '/dsh-coshare/rpc';
export const SECRET_KEY = 'dsh-coshare/device-keys';
const MAX_BODY = 64 * 1024;

function secretBackend(ctx: HostCtx): SecretBackend {
  return {
    async read() {
      const rec = await ctx.credentials.readRecord(SECRET_KEY);
      return rec?.kind === 'grant' ? rec.payload : undefined;
    },
    async write(value: DeviceKeys) {
      await ctx.credentials.modifyRecord(SECRET_KEY, async () => ({ kind: 'grant', payload: value }));
    },
  };
}

const str = (b: Record<string, unknown>, k: string): string => {
  const v = b[k];
  if (typeof v !== 'string' || v.length === 0 || v.length > 4096) throw new Error('MALFORMED');
  return v;
};

/** 本机 RPC 方法表（浏览器管理界面调用）。 */
export function rpcMethods(svc: ShareService): Record<string, (b: Record<string, unknown>) => unknown> {
  return {
    state: () => svc.snapshot(),
    'self.rename': (b) => svc.rename(str(b, 'name')),
    'gateway.set': (b) => svc.setGateway(b.enabled === true),
    'invite.create': () => svc.createInvite(),
    'invite.inspect': (b) => svc.inspectInvite(str(b, 'code')),
    'request.confirm': (b) => svc.confirmRequest(str(b, 'requestId')),
    'request.reject': (b) => svc.rejectRequest(str(b, 'requestId')),
    'incoming.revoke': (b) => svc.revokeIncoming(str(b, 'deviceId')),
    'incoming.rename': (b) => svc.renameIncoming(str(b, 'deviceId'), str(b, 'name')),
    'pair.start': async (b) => {
      const a = await svc.startPair(str(b, 'code'));
      return { attemptId: a.attemptId, name: a.name, code: a.code, status: a.status };
    },
    'attempt.dismiss': (b) => svc.dismissAttempt(str(b, 'attemptId')),
    'outgoing.remove': (b) => svc.removeOutgoing(str(b, 'deviceId')),
    'outgoing.rename': (b) => svc.renameOutgoing(str(b, 'deviceId'), str(b, 'name')),
    'outgoing.ping': (b) => svc.ping(str(b, 'deviceId')),
    'outgoing.open': (b) => svc.open(str(b, 'deviceId')),
  };
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body ?? null);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

export async function apply(ctx: HostCtx, config: ShareConfig): Promise<void> {
  const log = (m: string): void => ctx.logger?.info?.(`[dsh-coshare] ${m}`);
  if (!config.enabled) {
    log('disabled');
    return;
  }
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
  const file = config.stateFile || path.join(home, 'dsh-coshare', 'state.json');
  const store = new ShareStore(file, secretBackend(ctx), (m) => ctx.logger?.warn?.(`[dsh-coshare] ${m}`));
  await store.load(os.hostname().slice(0, 64) || 'DSH');

  const upstream = new UpstreamAuth(
    () => ctx.webServer.getOrigin(),
    (base) => ctx.connection.authenticatedUrl(base),
  );
  const svc = new ShareService({
    store,
    upstream,
    log,
    config: {
      listenHost: config.listenHost,
      port: config.port,
      allowedCidrs: config.allowedCidrs,
      advertiseHosts: config.advertiseHosts,
      inviteTtlMinutes: config.inviteTtlMinutes,
    },
  });
  try {
    await svc.start();
  } catch (e) {
    // 网关起不来不阻塞插件加载：状态里带 error，界面可见
    ctx.logger?.warn?.(`[dsh-coshare] ${(e as Error).message}`);
  }
  const methods = rpcMethods(svc);

  const disposeRoute = ctx.webServer.register({
    kind: 'prefix',
    path: RPC_PATH,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) {
        res.statusCode = rejection;
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' }).end();
        return;
      }
      // 只收 JSON：挡住跨站表单提交
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        sendJson(res, 415, { error: 'MALFORMED' });
        return;
      }
      const raw = await readBody(req);
      if (raw === null) {
        sendJson(res, 413, { error: 'TOO_LARGE' });
        return;
      }
      let body: Record<string, unknown>;
      try {
        const v: unknown = raw.length > 0 ? JSON.parse(raw) : {};
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error('x');
        body = v as Record<string, unknown>;
      } catch {
        sendJson(res, 400, { error: 'MALFORMED' });
        return;
      }
      const method = new URL(req.url ?? '/', 'http://x').pathname.slice(RPC_PATH.length + 1);
      const fn = Object.hasOwn(methods, method) ? methods[method] : undefined;
      if (!fn) {
        sendJson(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      try {
        sendJson(res, 200, { result: (await fn(body)) ?? null });
      } catch (e) {
        sendJson(res, 200, { error: (e as Error).message });
      }
    },
  });

  // 子路径挂载：B 主端口 /dsh-coshare/peer/<id>/… → 对方设备（手机经 dsh-mobile 访问时用，不暴露 127 端口）
  const disposePeer = ctx.webServer.register({
    kind: 'prefix',
    path: PEER_PREFIX,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) {
        res.statusCode = rejection;
        res.end();
        return;
      }
      const url = req.url ?? '/';
      const rest = url.slice(PEER_PREFIX.length + 1); // <id>/…
      const slash = rest.indexOf('/');
      const id = slash < 0 ? rest.split('?')[0]! : rest.slice(0, slash);
      if (!PEER_ID_RE.test(id) || !svc.outgoingIds().includes(id)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('dsh-coshare: 未配对的设备。');
        return;
      }
      if (slash < 0) {
        // 必须带结尾斜杠，页面里的相对地址（<base href="./">）才能落到前缀下
        const q = url.indexOf('?');
        res.writeHead(308, { location: `${PEER_PREFIX}/${id}/${q < 0 ? '' : url.slice(q)}` }).end();
        return;
      }
      try {
        const h = await svc.proxyFor(id);
        h.serve(req, res, rest.slice(slash));
      } catch (e) {
        if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`dsh-coshare: ${(e as Error).message}`);
      }
    },
  });
  const wsRoutes = new Map<string, () => void>();
  const syncWs = (): void => {
    const want = new Set<string>();
    for (const id of svc.outgoingIds()) {
      if (!PEER_ID_RE.test(id)) continue;
      for (const p of PEER_WS_PATHS) want.add(`${PEER_PREFIX}/${id}${p}`);
    }
    for (const [p, dispose] of wsRoutes) if (!want.has(p)) { dispose(); wsRoutes.delete(p); }
    for (const p of want) {
      if (wsRoutes.has(p)) continue;
      const id = p.slice(PEER_PREFIX.length + 1).split('/')[0]!;
      const aPath = p.slice(PEER_PREFIX.length + 1 + id.length);
      try {
        wsRoutes.set(p, ctx.webServer.registerUpgrade({
          path: p,
          handler: async (req, socket, head) => {
            if (ctx.connection.requestRejection(req) !== undefined) {
              socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
              return;
            }
            const q = (req.url ?? '').indexOf('?');
            const h = await svc.proxyFor(id);
            h.upgrade(req, socket, head, aPath + (q < 0 ? '' : (req.url ?? '').slice(q)));
          },
        }));
      } catch (e) {
        ctx.logger?.warn?.(`[dsh-coshare] ws ${p}: ${(e as Error).message}`);
      }
    }
  };
  syncWs();
  const wsTimer = setInterval(syncWs, 3000);
  wsTimer.unref();

  ctx.effect(() => async () => {
    clearInterval(wsTimer);
    for (const d of wsRoutes.values()) d();
    wsRoutes.clear();
    disposePeer();
    disposeRoute();
    await svc.stop();
  }, 'dsh-coshare: runtime');
  log(`ready (rpc ${RPC_PATH})`);
}
