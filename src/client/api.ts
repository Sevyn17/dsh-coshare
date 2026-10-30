/**
 * 浏览器 → 本机宿主 RPC（D18）。路径相对文档，同源 cookie 鉴权；宿主侧 connection.requestRejection 把关。
 */
export interface Device {
  deviceId: string;
  name: string;
  instanceId: string;
  pairedAt: string;
  endpoints?: string[];
}
export interface PendingRequest {
  requestId: string;
  name: string;
  instanceId: string;
  code: string;
  address: string;
  createdAt: number;
}
export interface Attempt {
  attemptId: string;
  name: string;
  instanceId: string;
  code: string;
  status: 'waiting' | 'approved' | 'rejected' | 'failed';
  error?: string;
  deviceId?: string;
}
export interface InvitePreview {
  name: string;
  instanceId: string;
  endpoints: string[];
  expiresAt: number;
}
export interface ShareState {
  self: { instanceId: string; name: string; renamed?: boolean };
  gateway: { enabled: boolean; running: boolean; port: number; endpoints: string[]; otherEndpoints?: string[]; error?: string };
  incoming: Device[];
  outgoing: Device[];
  requests: PendingRequest[];
  attempts: Attempt[];
}

const BASE = 'dsh-coshare/rpc/';

export async function shareCall<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(BASE + method, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: { result?: T; error?: string } = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    /* 非 JSON */
  }
  if (json.error !== undefined) throw new Error(json.error);
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return json.result as T;
}

const ERROR_TEXT: Record<string, string> = {
  GATEWAY_OFF: '请先开启「允许其他设备访问本机」',
  GATEWAY_FAILED: '网关启动失败（端口可能被占用）',
  NO_LAN_ADDRESS: '没有找到本机局域网地址，请在配置里填写公布地址',
  NOT_INVITE: '这不是有效的邀请码',
  MALFORMED: '邀请码格式不正确',
  EXPIRED: '邀请码已过期，请让对方重新生成',
  SELF_PAIR: '不能和自己配对',
  INVITE_USED: '这个邀请码已被其他设备使用，请让对方重新生成',
  INVITE_GONE: '邀请码已失效，请让对方重新生成',
  CODE_MISMATCH: '校验码不一致，配对已中止',
  NOT_FOUND: '对象不存在或已变化，请刷新',
  UNREACHABLE: '连不上对方设备（网关未开启或网络不通）',
  ECONNREFUSED: '连不上对方设备（网关未开启或网络不通）',
  ETIMEDOUT: '连接对方设备超时',
  TIMEOUT: '对方设备响应超时',
  HTTP_401: '登录已过期，请刷新页面',
  HTTP_403: '没有权限访问',
};

/** 名称旁的 4 位短码（实例 id 前 4 位），区分同名设备。 */
export function shortId(instanceId: string): string {
  return instanceId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 4).toUpperCase();
}

export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const code = Object.keys(ERROR_TEXT).find((k) => raw.includes(k));
  if (code) return ERROR_TEXT[code]!;
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) return '连接本机服务失败';
  return raw;
}
