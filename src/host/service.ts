/**
 * dsh-coshare 核心（D18）：一个类同时承担 A（网关、邀请、确认、撤销）与 B（配对请求、本机代理、打开）两侧。
 * 不依赖宿主类型：宿主能力经 ServiceDeps 注入，测试可直接驱动。
 */
import { randomBytes, randomUUID } from 'node:crypto';
import https from 'node:https';
import os from 'node:os';
import { startGateway, cidrAllows, type GatewayHandle } from './gateway.js';
import { startProxy, type ProxyHandle } from './proxy.js';
import { decodeInvite, encodeInvite, parseEndpoint, verifyCode, type Invite } from './invite.js';
import { clientPsk, CONTROL_PREFIX, DEVICE_PREFIX, INVITE_PREFIX } from './tls-psk.js';
import type { ShareStore } from './store.js';
import type { UpstreamAuth } from './upstream.js';

export interface ServiceConfig {
  listenHost: string;
  /** 固定网关端口；0 = 沿用上次端口（首次随机）。 */
  port: number;
  allowedCidrs: string[];
  advertiseHosts: string[];
  inviteTtlMinutes: number;
}

export interface ServiceDeps {
  store: ShareStore;
  upstream: UpstreamAuth;
  config: ServiceConfig;
  log: (m: string) => void;
  /** 测试注入：本机地址列表。 */
  localAddresses?: () => string[];
}

interface LiveInvite {
  invite: Invite;
  key: Buffer;
  /** 已发起的请求（一个邀请码只接受一个请求方）。 */
  requestId?: string;
}

/** A 侧：等待人工确认的配对请求。 */
export interface PendingRequest {
  requestId: string;
  inviteId: string;
  name: string;
  instanceId: string;
  code: string;
  address: string;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected';
  /** 批准后待 B 取走的设备凭据 */
  grant?: { deviceId: string; key: string };
}

/** B 侧：进行中的配对。 */
export interface PairAttempt {
  attemptId: string;
  name: string;
  instanceId: string;
  code: string;
  status: 'waiting' | 'approved' | 'rejected' | 'failed';
  error?: string;
  invite: Invite;
  requestId: string;
  /** 批准后的本地设备 id（界面据此自动打开） */
  deviceId?: string;
}

/** B 主端口上挂载对方设备的子路径前缀：/dsh-coshare/peer/<deviceId>/… */
export const PEER_PREFIX = '/dsh-coshare/peer';

const PAIR_POLL_MS = 1500;
const REQUEST_TTL_MS = 10 * 60_000;

export class ShareService {
  private gateway: GatewayHandle | undefined;
  private gatewayError: string | undefined;
  private readonly invites = new Map<string, LiveInvite>();
  private readonly requests = new Map<string, PendingRequest>();
  private readonly attempts = new Map<string, PairAttempt>();
  private readonly proxies = new Map<string, Promise<ProxyHandle>>();
  private pollTimer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly deps: ServiceDeps) {}

  get store(): ShareStore {
    return this.deps.store;
  }

  async start(): Promise<void> {
    if (this.store.state.gateway.enabled) await this.openGateway();
    this.pollTimer = setInterval(() => void this.pollAttempts(), PAIR_POLL_MS);
    this.pollTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    await this.closeGateway();
    const ps = [...this.proxies.values()];
    this.proxies.clear();
    await Promise.all(ps.map((p) => p.then((h) => h.close(), () => undefined)));
  }

  // ---------------- 网关（A） ----------------

  private async openGateway(): Promise<void> {
    if (this.gateway) return;
    const want = this.deps.config.port || this.store.state.gateway.port || 0;
    const hooks = {
      keyFor: (id: string) => this.keyFor(id),
      control: (id: string, path: string, body: Record<string, unknown>) => this.control(id, path, body),
      allowRemote: (addr: string) => addr === '127.0.0.1' || addr === '::1' || cidrAllows(this.deps.config.allowedCidrs, addr),
      log: this.deps.log,
    };
    try {
      try {
        this.gateway = await startGateway({ host: this.deps.config.listenHost, port: want, upstream: this.deps.upstream, hooks });
      } catch (e) {
        if (want === 0 || this.deps.config.port !== 0) throw e;
        this.gateway = await startGateway({ host: this.deps.config.listenHost, port: 0, upstream: this.deps.upstream, hooks });
      }
      this.gatewayError = undefined;
      if (this.store.state.gateway.port !== this.gateway.port) {
        this.store.state.gateway.port = this.gateway.port;
        this.store.save();
      }
      this.deps.log(`gateway listening on ${this.deps.config.listenHost}:${this.gateway.port}`);
    } catch (e) {
      this.gatewayError = (e as Error).message;
      this.deps.log(`gateway failed: ${this.gatewayError}`);
      throw new Error(`GATEWAY_FAILED: ${this.gatewayError}`);
    }
  }

  private async closeGateway(): Promise<void> {
    const g = this.gateway;
    this.gateway = undefined;
    this.invites.clear();
    if (g) await g.close();
  }

  async setGateway(enabled: boolean): Promise<void> {
    this.store.state.gateway.enabled = enabled;
    this.store.save();
    if (enabled) await this.openGateway();
    else await this.closeGateway();
  }

  private keyFor(identity: string): Buffer | undefined {
    if (identity.startsWith(INVITE_PREFIX)) {
      const live = this.invites.get(identity.slice(INVITE_PREFIX.length));
      if (!live) return undefined;
      const now = Date.now();
      // 邀请过期后，已发起的请求仍可在请求有效期内查询结果
      const req = live.requestId === undefined ? undefined : this.requests.get(live.requestId);
      if (live.invite.expiresAt < now && !(req && req.createdAt + REQUEST_TTL_MS > now)) return undefined;
      return live.key;
    }
    if (identity.startsWith(DEVICE_PREFIX)) {
      const k = this.store.keys.incoming[identity.slice(DEVICE_PREFIX.length)];
      return k === undefined ? undefined : Buffer.from(k, 'base64url');
    }
    return undefined;
  }

  /** 本机地址：primary = 真实局域网网卡（公布进邀请码），other = 虚拟网卡（WSL/Hyper-V 等，只在界面折叠显示）。 */
  localEndpoints(port: number): { primary: string[]; other: string[] } {
    const fmt = (hs: string[]): string[] => hs.slice(0, 8).map((h) => (h.includes(':') ? `[${h}]:${port}` : `${h}:${port}`));
    if (this.deps.config.advertiseHosts.length > 0) return { primary: fmt(this.deps.config.advertiseHosts), other: [] };
    if (this.deps.localAddresses) return { primary: fmt(this.deps.localAddresses()), other: [] };
    const a = lanAddresses();
    return { primary: fmt(a.primary), other: fmt(a.other) };
  }

  /** 预览邀请码（B 侧，发起前给用户确认对方是谁）。 */
  inspectInvite(code: string): { name: string; instanceId: string; endpoints: string[]; expiresAt: number } {
    const inv = decodeInvite(code);
    if (inv.instanceId === this.store.state.self.instanceId) throw new Error('SELF_PAIR');
    return { name: inv.name, instanceId: inv.instanceId, endpoints: inv.endpoints, expiresAt: inv.expiresAt };
  }

  createInvite(): { code: string; expiresAt: number; endpoints: string[] } {
    if (!this.gateway) throw new Error('GATEWAY_OFF');
    const local = this.localEndpoints(this.gateway.port);
    // 没有真实网卡时才退而公布虚拟网卡地址
    const endpoints = local.primary.length > 0 ? local.primary : local.other;
    if (endpoints.length === 0) throw new Error('NO_LAN_ADDRESS');
    const key = randomBytes(32);
    const invite: Invite = {
      v: 1,
      name: this.store.state.self.name,
      instanceId: this.store.state.self.instanceId,
      endpoints,
      inviteId: randomBytes(9).toString('base64url'),
      key: key.toString('base64url'),
      expiresAt: Date.now() + this.deps.config.inviteTtlMinutes * 60_000,
    };
    this.invites.set(invite.inviteId, { invite, key });
    return { code: encodeInvite(invite), expiresAt: invite.expiresAt, endpoints };
  }

  /** 网关控制接口（对端经 TLS-PSK 调用）。 */
  private async control(identity: string, path: string, body: Record<string, unknown>): Promise<unknown> {
    if (path === 'ping') return { name: this.store.state.self.name, instanceId: this.store.state.self.instanceId };
    if (identity.startsWith(INVITE_PREFIX)) {
      const live = this.invites.get(identity.slice(INVITE_PREFIX.length));
      if (!live) throw new Error('INVITE_GONE');
      if (path === 'pair/request') return this.onPairRequest(live, body);
      if (path === 'pair/status') return this.onPairStatus(live, body);
      throw new Error('NOT_FOUND');
    }
    if (identity.startsWith(DEVICE_PREFIX) && path === 'unpair') {
      this.revokeIncoming(identity.slice(DEVICE_PREFIX.length));
      return { ok: true };
    }
    throw new Error('NOT_FOUND');
  }

  private onPairRequest(live: LiveInvite, body: Record<string, unknown>): unknown {
    const name = typeof body.name === 'string' ? body.name.slice(0, 64) : '';
    const instanceId = typeof body.instanceId === 'string' ? body.instanceId.slice(0, 64) : '';
    if (!name || !instanceId) throw new Error('MALFORMED');
    if (instanceId === this.store.state.self.instanceId) throw new Error('SELF_PAIR');
    if (live.requestId !== undefined) {
      const prev = this.requests.get(live.requestId);
      // 同一请求方重复提交（网络重试）返回同一请求；其他人用同一邀请码一律拒绝
      if (prev && prev.instanceId === instanceId && prev.status === 'pending') return { requestId: prev.requestId, code: prev.code };
      throw new Error('INVITE_USED');
    }
    const req: PendingRequest = {
      requestId: randomUUID(),
      inviteId: live.invite.inviteId,
      name,
      instanceId,
      code: verifyCode(live.key, instanceId),
      address: typeof body.address === 'string' ? body.address.slice(0, 80) : '',
      createdAt: Date.now(),
      status: 'pending',
    };
    live.requestId = req.requestId;
    this.requests.set(req.requestId, req);
    this.deps.log(`pair request from ${name} (${instanceId.slice(0, 8)}) code ${req.code}`);
    return { requestId: req.requestId, code: req.code };
  }

  private onPairStatus(live: LiveInvite, body: Record<string, unknown>): unknown {
    const req = this.requests.get(String(body.requestId ?? ''));
    if (!req || req.inviteId !== live.invite.inviteId) throw new Error('NOT_FOUND');
    if (req.status === 'pending') return { status: 'pending' };
    if (req.status === 'rejected') {
      this.burn(req);
      return { status: 'rejected' };
    }
    const grant = req.grant!;
    // 凭据只交付一次，随即作废邀请
    this.burn(req);
    return { status: 'approved', deviceId: grant.deviceId, key: grant.key, name: this.store.state.self.name, instanceId: this.store.state.self.instanceId };
  }

  private burn(req: PendingRequest): void {
    this.invites.delete(req.inviteId);
    this.requests.delete(req.requestId);
  }

  async confirmRequest(requestId: string): Promise<void> {
    const req = this.requests.get(requestId);
    if (!req || req.status !== 'pending') throw new Error('NOT_FOUND');
    const deviceId = randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
    const key = randomBytes(32).toString('base64url');
    this.store.keys.incoming[deviceId] = key;
    await this.store.saveKeys();
    // 同一实例重新配对：替换旧条目
    for (const old of this.store.state.incoming.filter((d) => d.instanceId === req.instanceId)) this.revokeIncoming(old.deviceId);
    this.store.state.incoming.push({ deviceId, name: req.name, instanceId: req.instanceId, pairedAt: new Date().toISOString() });
    this.store.save();
    req.status = 'approved';
    req.grant = { deviceId, key };
  }

  rejectRequest(requestId: string): void {
    const req = this.requests.get(requestId);
    if (!req || req.status !== 'pending') throw new Error('NOT_FOUND');
    req.status = 'rejected';
  }

  revokeIncoming(deviceId: string): void {
    const had = this.store.keys.incoming[deviceId] !== undefined;
    delete this.store.keys.incoming[deviceId];
    this.store.state.incoming = this.store.state.incoming.filter((d) => d.deviceId !== deviceId);
    this.store.save();
    void this.store.saveKeys();
    this.gateway?.drop(DEVICE_PREFIX + deviceId);
    if (had) this.deps.log(`device ${deviceId} revoked`);
  }

  renameIncoming(deviceId: string, name: string): void {
    const d = this.store.state.incoming.find((x) => x.deviceId === deviceId);
    if (!d) throw new Error('NOT_FOUND');
    d.name = name.slice(0, 64);
    this.store.save();
  }

  // ---------------- 配对（B） ----------------

  async startPair(code: string): Promise<PairAttempt> {
    const invite = decodeInvite(code);
    if (invite.instanceId === this.store.state.self.instanceId) throw new Error('SELF_PAIR');
    const key = Buffer.from(invite.key, 'base64url');
    const r = await callControl(invite.endpoints, INVITE_PREFIX + invite.inviteId, key, 'pair/request', {
      name: this.store.state.self.name,
      instanceId: this.store.state.self.instanceId,
    });
    const res = r.result as { requestId?: unknown; code?: unknown };
    if (typeof res.requestId !== 'string' || typeof res.code !== 'string') throw new Error('MALFORMED');
    if (res.code !== verifyCode(key, this.store.state.self.instanceId)) throw new Error('CODE_MISMATCH');
    const attempt: PairAttempt = {
      attemptId: randomUUID(),
      name: invite.name,
      instanceId: invite.instanceId,
      code: res.code,
      status: 'waiting',
      invite: { ...invite, endpoints: r.endpoint ? [r.endpoint, ...invite.endpoints.filter((e) => e !== r.endpoint)] : invite.endpoints },
      requestId: res.requestId,
    };
    this.attempts.set(attempt.attemptId, attempt);
    return attempt;
  }

  private polling = false;
  private async pollAttempts(): Promise<void> {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      for (const a of this.attempts.values()) {
        if (a.status !== 'waiting') continue;
        if (a.invite.expiresAt + REQUEST_TTL_MS < Date.now()) {
          a.status = 'failed';
          a.error = 'EXPIRED';
          continue;
        }
        try {
          const r = await callControl(a.invite.endpoints, INVITE_PREFIX + a.invite.inviteId, Buffer.from(a.invite.key, 'base64url'), 'pair/status', {
            requestId: a.requestId,
          });
          const s = r.result as { status?: string; deviceId?: unknown; key?: unknown; name?: unknown };
          if (s.status === 'rejected') a.status = 'rejected';
          else if (s.status === 'approved' && typeof s.deviceId === 'string' && typeof s.key === 'string') {
            await this.addOutgoing(a, s.deviceId, s.key, typeof s.name === 'string' ? s.name : a.name);
            a.deviceId = s.deviceId;
            a.status = 'approved';
          }
        } catch (e) {
          const m = (e as Error).message;
          // 握手失败（邀请被作废/网关关闭）视为失败；网络抖动下次再试
          if (/INVITE_GONE|NOT_FOUND|PSK|handshake|alert/i.test(m)) {
            a.status = 'failed';
            a.error = m;
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private async addOutgoing(a: PairAttempt, deviceId: string, key: string, name: string): Promise<void> {
    for (const old of this.store.state.outgoing.filter((d) => d.instanceId === a.instanceId)) await this.removeOutgoing(old.deviceId, false);
    this.store.keys.outgoing[deviceId] = key;
    await this.store.saveKeys();
    this.store.state.outgoing.push({ deviceId, name, instanceId: a.instanceId, endpoints: a.invite.endpoints, pairedAt: new Date().toISOString() });
    this.store.save();
  }

  dismissAttempt(attemptId: string): void {
    this.attempts.delete(attemptId);
  }

  async removeOutgoing(deviceId: string, notify = true): Promise<void> {
    const dev = this.store.state.outgoing.find((d) => d.deviceId === deviceId);
    const key = this.store.keys.outgoing[deviceId];
    if (notify && dev && key !== undefined) {
      // 后台尽量通知对方删掉密钥，不等待：对方 IP 变了时逐个地址超时会让界面卡很久。
      // 通知不到也安全：本机密钥马上删除，对方再也连不进来。
      void callControl(dev.endpoints, DEVICE_PREFIX + deviceId, Buffer.from(key, 'base64url'), 'unpair', {}).catch(() => undefined);
    }
    delete this.store.keys.outgoing[deviceId];
    this.store.state.outgoing = this.store.state.outgoing.filter((d) => d.deviceId !== deviceId);
    this.store.save();
    await this.store.saveKeys();
    const p = this.proxies.get(deviceId);
    this.proxies.delete(deviceId);
    if (p) await p.then((h) => h.close(), () => undefined);
  }

  renameOutgoing(deviceId: string, name: string): void {
    const d = this.store.state.outgoing.find((x) => x.deviceId === deviceId);
    if (!d) throw new Error('NOT_FOUND');
    d.name = name.slice(0, 64);
    this.store.save();
  }

  async ping(deviceId: string): Promise<{ online: boolean; name?: string; error?: string }> {
    const dev = this.store.state.outgoing.find((d) => d.deviceId === deviceId);
    const key = this.store.keys.outgoing[deviceId];
    if (!dev || key === undefined) throw new Error('NOT_FOUND');
    try {
      const r = await callControl(dev.endpoints, DEVICE_PREFIX + deviceId, Buffer.from(key, 'base64url'), 'ping', {});
      return { online: true, name: String((r.result as { name?: unknown }).name ?? '') };
    } catch (e) {
      return { online: false, error: (e as Error).message };
    }
  }

  /** 打开设备：确保本机代理，返回一次性进入地址。 */
  async open(deviceId: string): Promise<{ url: string; port: number; mount: string }> {
    const h = await this.proxyFor(deviceId);
    return { url: `http://127.0.0.1:${h.port}${CONTROL_PREFIX}enter?t=${h.ticket()}`, port: h.port, mount: `${PEER_PREFIX}/${deviceId}/` };
  }

  /** 已配对设备的 id 列表（子路径 WS 精确注册用）。 */
  outgoingIds(): string[] {
    return this.store.state.outgoing.map((d) => d.deviceId);
  }

  /** 确保某设备的本机代理已启动并返回句柄。 */
  async proxyFor(deviceId: string): Promise<ProxyHandle> {
    const dev = this.store.state.outgoing.find((d) => d.deviceId === deviceId);
    const key = this.store.keys.outgoing[deviceId];
    if (!dev || key === undefined) throw new Error('NOT_FOUND');
    let p = this.proxies.get(deviceId);
    if (!p) {
      p = startProxy({
        target: { deviceId, identity: DEVICE_PREFIX + deviceId, key: Buffer.from(key, 'base64url'), endpoints: dev.endpoints },
        port: dev.proxyPort ?? 0,
        log: this.deps.log,
      });
      this.proxies.set(deviceId, p);
      p.catch(() => this.proxies.delete(deviceId));
    }
    const h = await p;
    if (dev.proxyPort !== h.port) {
      dev.proxyPort = h.port;
      this.store.save();
    }
    return h;
  }

  snapshot(): unknown {
    const s = this.store.state;
    return {
      self: s.self,
      gateway: {
        enabled: s.gateway.enabled,
        running: this.gateway !== undefined,
        port: this.gateway?.port ?? s.gateway.port,
        endpoints: this.gateway ? this.localEndpoints(this.gateway.port).primary : [],
        otherEndpoints: this.gateway ? this.localEndpoints(this.gateway.port).other : [],
        error: this.gatewayError,
      },
      incoming: s.incoming,
      outgoing: s.outgoing.map((d) => ({ deviceId: d.deviceId, name: d.name, instanceId: d.instanceId, endpoints: d.endpoints, pairedAt: d.pairedAt })),
      requests: [...this.requests.values()]
        .filter((r) => r.status === 'pending' && r.createdAt + REQUEST_TTL_MS > Date.now())
        .map(({ requestId, name, instanceId, code, address, createdAt }) => ({ requestId, name, instanceId, code, address, createdAt })),
      attempts: [...this.attempts.values()].map(({ attemptId, name, instanceId, code, status, error, deviceId }) => ({ attemptId, name, instanceId, code, status, error, deviceId })),
    };
  }

  rename(name: string): void {
    const n = name.trim().slice(0, 64);
    if (!n) throw new Error('MALFORMED');
    this.store.state.self.name = n;
    this.store.state.self.renamed = true;
    this.store.save();
  }
}

/** 虚拟网卡（对方通常连不上）：WSL/Hyper-V/VMware/VirtualBox/Docker 等。 */
const VIRTUAL_NIC = /vEthernet|WSL|Hyper-?V|VMware|VirtualBox|vbox|docker|br-|veth|virbr|Loopback/i;

function lanAddresses(): { primary: string[]; other: string[] } {
  const primary: string[] = [];
  const other: string[] = [];
  for (const [nic, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      (VIRTUAL_NIC.test(nic) || a.address.startsWith('169.254.') ? other : primary).push(a.address);
    }
  }
  return { primary, other };
}

/** 依次尝试地址候选调用网关控制接口；返回结果和成功的地址。 */
export async function callControl(
  endpoints: string[],
  identity: string,
  key: Buffer,
  path: string,
  body: Record<string, unknown>,
): Promise<{ result: unknown; endpoint: string }> {
  let last: Error = new Error('UNREACHABLE');
  for (const ep of endpoints) {
    const e = parseEndpoint(ep);
    if (!e) continue;
    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        const text = JSON.stringify(body);
        const req = https.request(
          {
            ...clientPsk(identity, key),
            host: e.host,
            port: e.port,
            method: 'POST',
            path: CONTROL_PREFIX + path,
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) },
            agent: false,
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              try {
                const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { result?: unknown; error?: string };
                if (res.statusCode === 200) resolve(v.result);
                else reject(new Error(v.error ?? `HTTP ${String(res.statusCode)}`));
              } catch {
                reject(new Error(`HTTP ${String(res.statusCode)}`));
              }
            });
          },
        );
        req.setTimeout(5000, () => req.destroy(new Error('TIMEOUT')));
        req.on('error', reject);
        req.end(text);
      });
      return { result, endpoint: ep };
    } catch (err) {
      last = err as Error;
      // 应用层错误（握手已成功）不必再试其他地址
      if (!/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|TIMEOUT|ECONNRESET/.test(last.message)) break;
    }
  }
  throw last;
}
