/**
 * TLS-PSK 参数（D18）：TLS 1.2 + PSK 套件，零证书。实测 DSH 运行时 Node 24.21 / BoringSSL
 * 协商到 ECDHE-PSK-CHACHA20-POLY1305（scripts/psk-probe.mjs）。
 * 身份串两类：`inv:<inviteId>`（邀请码里的一次性密钥，仅能配对）与 `dev:<deviceId>`（长期设备密钥）。
 */
import type { ConnectionOptions, SecureVersion } from 'node:tls';

export const PSK_CIPHERS = 'ECDHE-PSK-CHACHA20-POLY1305:ECDHE-PSK-AES128-CBC-SHA256:PSK-AES256-GCM-SHA384:PSK-AES128-GCM-SHA256';
const V12: SecureVersion = 'TLSv1.2';

export const TLS_BASE = { ciphers: PSK_CIPHERS, minVersion: V12, maxVersion: V12 };

export const INVITE_PREFIX = 'inv:';
export const DEVICE_PREFIX = 'dev:';

/** 客户端连接选项（https.Agent / tls.connect 通用）。 */
export function clientPsk(identity: string, key: Buffer): ConnectionOptions {
  return {
    ...TLS_BASE,
    pskCallback: () => ({ psk: key, identity }),
    checkServerIdentity: () => undefined,
  };
}

/** 网关私有路径前缀（不转发给宿主）。 */
export const CONTROL_PREFIX = '/__dsh_share/';
