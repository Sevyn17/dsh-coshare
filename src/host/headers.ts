/** 转发时的请求/响应头处理（网关与本机代理共用）。 */
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

const HOP = ['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

/**
 * 复制请求头：去掉逐跳头、Cookie、Host（由调用方重设）。
 * upgrade=true 时保留 Upgrade 并把 Connection 设为 Upgrade（WebSocket 握手）。
 */
export function forwardRequestHeaders(src: IncomingHttpHeaders, upgrade: boolean): Record<string, string | string[]> {
  const drop = new Set([...HOP, 'cookie', 'host']);
  for (const t of String(src.connection ?? '').split(',')) {
    const n = t.trim().toLowerCase();
    if (n && n !== 'upgrade') drop.add(n);
  }
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || drop.has(k)) continue;
    out[k] = v;
  }
  if (upgrade && typeof src.upgrade === 'string') {
    out.connection = 'Upgrade';
    out.upgrade = src.upgrade;
  }
  return out;
}

/**
 * 复制响应头：去逐跳头与全部 Set-Cookie（A 的登录态只留在 A 的网关里，
 * 浏览器侧 Cookie 不分端口，放行会挤掉 B 自己的登录）。
 * embed=true 时再去掉禁止内嵌的头（X-Frame-Options、CSP frame-ancestors）与 HSTS。
 */
export function forwardResponseHeaders(src: IncomingHttpHeaders, embed: boolean): OutgoingHttpHeaders {
  const drop = new Set([...HOP, 'set-cookie']);
  if (embed) {
    drop.add('x-frame-options');
    drop.add('strict-transport-security');
  }
  const out: OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || drop.has(k)) continue;
    if (embed && (k === 'content-security-policy' || k === 'content-security-policy-report-only')) {
      const kept = (Array.isArray(v) ? v : [v])
        .map((p) => p.split(';').filter((d) => !/^\s*frame-ancestors\b/i.test(d)).join(';').trim())
        .filter((p) => p.replace(/;/g, '').trim().length > 0);
      if (kept.length > 0) (out as Record<string, string[]>)[k] = kept;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** 手写 HTTP/1.1 请求头块（WebSocket 升级走原始套接字）。 */
export function rawRequestHead(method: string, url: string, headers: Record<string, string | string[]>): string {
  const lines = [`${method} ${url} HTTP/1.1`];
  for (const [k, v] of Object.entries(headers)) {
    for (const one of Array.isArray(v) ? v : [v]) {
      if (/[\r\n]/.test(k) || /[\r\n]/.test(one)) continue;
      lines.push(`${k}: ${one}`);
    }
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/** 读取 Cookie 头里的单个值（不做通用解码）。 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const seg of (header ?? '').split(';')) {
    const at = seg.indexOf('=');
    if (at > 0 && seg.slice(0, at).trim() === name) return seg.slice(at + 1).trim();
  }
  return undefined;
}
