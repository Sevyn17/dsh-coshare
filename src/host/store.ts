/**
 * 插件状态（D18 / S3）：
 *  - 设备密钥 → 宿主 `ctx.credentials`（键 `dsh-coshare/device-keys`，记录 kind 'grant'）
 *  - 其余（本机身份、网关开关与端口、设备列表）→ JSON 文件，原子写
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SelfInfo {
  instanceId: string;
  name: string;
  /** 用户改过名（否则界面提示起名） */
  renamed?: boolean;
}

/** 可访问我的设备（我是 A，网关放行它）。 */
export interface IncomingDevice {
  deviceId: string;
  name: string;
  instanceId: string;
  pairedAt: string;
}

/** 我可访问的设备（我是 B，本机代理连它）。 */
export interface OutgoingDevice {
  deviceId: string;
  name: string;
  instanceId: string;
  endpoints: string[];
  pairedAt: string;
  /** 上次使用的本机代理端口（尽量复用，保持对方页面的本地存储）。 */
  proxyPort?: number;
}

export interface FileState {
  v: 1;
  self: SelfInfo;
  gateway: { enabled: boolean; port: number };
  incoming: IncomingDevice[];
  outgoing: OutgoingDevice[];
}

export interface DeviceKeys {
  incoming: Record<string, string>;
  outgoing: Record<string, string>;
}

export interface SecretBackend {
  read(): Promise<unknown>;
  write(value: DeviceKeys): Promise<void>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class ShareStore {
  state: FileState;
  keys: DeviceKeys = { incoming: {}, outgoing: {} };
  private secretChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly secrets: SecretBackend,
    private readonly onError: (message: string) => void,
  ) {
    this.state = { v: 1, self: { instanceId: randomUUID(), name: 'DSH' }, gateway: { enabled: false, port: 0 }, incoming: [], outgoing: [] };
  }

  async load(defaultName: string): Promise<void> {
    let fresh = true;
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (isObj(raw) && raw.v === 1 && isObj(raw.self)) {
        const r = raw as unknown as FileState;
        this.state = {
          v: 1,
          self: { instanceId: String(r.self.instanceId), name: String(r.self.name), ...(r.self.renamed === true ? { renamed: true } : {}) },
          gateway: { enabled: r.gateway?.enabled === true, port: Number(r.gateway?.port) || 0 },
          incoming: Array.isArray(r.incoming) ? r.incoming : [],
          outgoing: Array.isArray(r.outgoing) ? r.outgoing : [],
        };
        fresh = false;
      }
    } catch {
      /* 首次启动或文件损坏：从空开始 */
    }
    if (fresh) {
      this.state.self.name = defaultName;
      this.save();
    }
    const k = await this.secrets.read();
    if (isObj(k)) {
      this.keys = {
        incoming: isObj(k.incoming) ? (k.incoming as Record<string, string>) : {},
        outgoing: isObj(k.outgoing) ? (k.outgoing as Record<string, string>) : {},
      };
    }
    // 丢掉缺密钥的设备（凭据丢失时不能留下打不开的条目）
    this.state.incoming = this.state.incoming.filter((d) => this.keys.incoming[d.deviceId] !== undefined);
    this.state.outgoing = this.state.outgoing.filter((d) => this.keys.outgoing[d.deviceId] !== undefined);
  }

  save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (e) {
      this.onError(`state file write failed: ${(e as Error).message}`);
    }
  }

  /** 串行写凭据，返回本次写入完成的 Promise。 */
  saveKeys(): Promise<void> {
    const snapshot: DeviceKeys = { incoming: { ...this.keys.incoming }, outgoing: { ...this.keys.outgoing } };
    this.secretChain = this.secretChain
      .then(() => this.secrets.write(snapshot))
      .catch((e: unknown) => this.onError(`device key write failed: ${(e as Error).message}`));
    return this.secretChain;
  }
}
