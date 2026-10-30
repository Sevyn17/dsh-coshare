/**
 * 邀请码（D18）：A 生成，带一次性 PSK、地址候选、过期时间。邀请码本身即密钥，
 * 但仅能发起配对请求；A 端仍需人工确认（双方核对 6 位校验码）。
 */
import { createHash } from 'node:crypto';

export const INVITE_TAG = 'DSHS1.';

export interface Invite {
  v: 1;
  /** A 的设备名 */
  name: string;
  /** A 的实例 id */
  instanceId: string;
  /** host:port 候选 */
  endpoints: string[];
  inviteId: string;
  /** base64url 一次性密钥 */
  key: string;
  expiresAt: number;
}

export function encodeInvite(inv: Invite): string {
  return INVITE_TAG + Buffer.from(JSON.stringify(inv), 'utf8').toString('base64url');
}

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** 解析并校验；错误码 NOT_INVITE / MALFORMED / EXPIRED。 */
export function decodeInvite(code: string, now = Date.now()): Invite {
  const text = code.trim().replace(/\s+/g, '');
  if (!text.startsWith(INVITE_TAG)) throw new Error('NOT_INVITE');
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(text.slice(INVITE_TAG.length), 'base64url').toString('utf8'));
  } catch {
    throw new Error('MALFORMED');
  }
  const o = raw as Record<string, unknown> | null;
  if (
    o === null || typeof o !== 'object' || o.v !== 1 ||
    !isStr(o.name, 64) || !isStr(o.instanceId, 64) || !isStr(o.inviteId, 64) || !isStr(o.key, 64) ||
    typeof o.expiresAt !== 'number' || !Array.isArray(o.endpoints) || o.endpoints.length === 0 || o.endpoints.length > 8 ||
    !o.endpoints.every((e) => isStr(e, 80) && parseEndpoint(e) !== undefined) ||
    Buffer.from(o.key, 'base64url').length !== 32
  ) throw new Error('MALFORMED');
  if (o.expiresAt < now) throw new Error('EXPIRED');
  return { v: 1, name: o.name, instanceId: o.instanceId, endpoints: o.endpoints as string[], inviteId: o.inviteId, key: o.key, expiresAt: o.expiresAt };
}

/** `host:port`（IPv4 或主机名；IPv6 用 [addr]:port）。 */
export function parseEndpoint(ep: string): { host: string; port: number } | undefined {
  const m = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/.exec(ep);
  if (!m) return undefined;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return undefined;
  return { host: m[1]!.replace(/^\[|\]$/g, ''), port };
}

/** 双方屏幕显示的 6 位校验码：由一次性密钥与请求方实例 id 派生，中间人无法伪造相同值。 */
export function verifyCode(key: Buffer, requesterInstanceId: string): string {
  const h = createHash('sha256').update(key).update('|').update(requesterInstanceId).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
