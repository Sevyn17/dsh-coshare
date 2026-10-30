/**
 * 配对管理（D18）：两个标签页。
 *  - 让别人访问我：本机信息、生成邀请码（自动开网关）→ 等待 → 确认卡、可访问本机的设备、暂停所有访问
 *  - 我访问别人：添加设备（粘贴 → 预览 → 校验码 → 自动打开）、我能访问的设备
 * 共享面板的弹窗与插件详情页（plugins.detail.section）复用同一组件。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { errorText, shareCall, shortId, type Device, type InvitePreview, type ShareState } from './api.js';

export function useShareState(intervalMs = 2000): { state: ShareState | undefined; error: string; reload: () => void } {
  const [state, setState] = useState<ShareState | undefined>(undefined);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    shareCall<ShareState>('state').then(
      (s) => {
        setState(s);
        setError('');
      },
      (e) => setError(errorText(e)),
    );
  }, []);
  useEffect(() => {
    reload();
    const t = setInterval(reload, intervalMs);
    return () => clearInterval(t);
  }, [reload, intervalMs]);
  return { state, error, reload };
}

function useAction(reload: () => void): { busy: boolean; err: string; run: (fn: () => Promise<unknown>) => Promise<boolean> } {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      return true;
    } catch (e) {
      setErr(errorText(e));
      return false;
    } finally {
      setBusy(false);
      reload();
    }
  };
  return { busy, err, run };
}

function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
};
const fmtLeft = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function DeviceName({ name, instanceId }: { name: string; instanceId: string }): React.JSX.Element {
  return (
    <span className="dsh-share-dname">
      {name}
      <span className="dsh-share-sid">{shortId(instanceId)}</span>
    </span>
  );
}

/** 页内确认条：不用 window.confirm/prompt（浏览器勾选「阻止此页弹窗」或 Electron 下会直接返回 false/不支持）。 */
type Ask = { text: string; ok: string; danger?: boolean; run: () => void };
function useAsk(): { ask: (a: Ask) => void; view: React.JSX.Element | null } {
  const [cur, setCur] = useState<Ask | undefined>(undefined);
  const view = cur ? (
    <div className="dsh-share-notice">
      <div style={{ whiteSpace: 'pre-line' }}>{cur.text}</div>
      <div className="dsh-share-row">
        <button
          className={`dsh-share-btn ${cur.danger ? 'danger' : 'primary'}`}
          onClick={() => {
            setCur(undefined);
            cur.run();
          }}
        >
          {cur.ok}
        </button>
        <button className="dsh-share-btn" onClick={() => setCur(undefined)}>
          取消
        </button>
      </div>
    </div>
  ) : null;
  return { ask: setCur, view };
}

function RenameRow({ d, kind, run, onDone }: { d: Device; kind: 'incoming' | 'outgoing'; run: (fn: () => Promise<unknown>) => Promise<boolean>; onDone: () => void }): React.JSX.Element {
  const [n, setN] = useState(d.name);
  const save = (): void => {
    const v = n.trim();
    if (!v || v === d.name) return onDone();
    void run(() => shareCall(`${kind}.rename`, { deviceId: d.deviceId, name: v })).then((ok) => ok && onDone());
  };
  return (
    <div className="dsh-share-row">
      <input className="dsh-share-input" value={n} maxLength={64} autoFocus onChange={(e) => setN(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' ? onDone() : undefined)} />
      <button className="dsh-share-btn primary" onClick={save}>
        保存
      </button>
      <button className="dsh-share-btn" onClick={onDone}>
        取消
      </button>
    </div>
  );
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }): React.JSX.Element {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="dsh-share-btn"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(
          () => {
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          },
          () => undefined,
        )
      }
    >
      {ok ? '已复制' : label}
    </button>
  );
}

// ---------------- 让别人访问我 ----------------

function SelfCard({ state, reload }: { state: ShareState; reload: () => void }): React.JSX.Element {
  const [editing, setEditing] = useState(!state.self.renamed);
  const [name, setName] = useState(state.self.name);
  const [more, setMore] = useState(false);
  const a = useAction(reload);
  const g = state.gateway;
  const other = g.otherEndpoints ?? [];
  const save = (): void =>
    void a.run(() => shareCall('self.rename', { name: name.trim() })).then((ok) => ok && setEditing(false));
  return (
    <div className="dsh-share-card">
      <div className="dsh-share-row">
        <h4 className="grow">本机</h4>
        {g.running ? (
          <span className="dsh-share-tag on" title="本机的访问服务已开启：持邀请码的设备可以发起配对，已配对的设备可以连接">
            访问服务运行中
          </span>
        ) : (
          <span className="dsh-share-tag" title="本机的访问服务已关闭：任何设备都连不上本机">
            访问服务已关闭
          </span>
        )}
      </div>
      {editing ? (
        <>
          <div className="dsh-share-row">
            <input
              className="dsh-share-input"
              value={name}
              maxLength={64}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()}
            />
            <button className="dsh-share-btn primary" disabled={a.busy || name.trim() === ''} onClick={save}>
              保存
            </button>
          </div>
          {!state.self.renamed && <div className="dsh-share-hint">给本机起个好认的名字（如「小王的笔记本」），对方配对和确认时看到的是它。</div>}
        </>
      ) : (
        <div className="dsh-share-row">
          <span className="grow dsh-share-big">
            <DeviceName name={state.self.name} instanceId={state.self.instanceId} />
          </span>
          <button className="dsh-share-btn" onClick={() => setEditing(true)}>
            改名
          </button>
        </div>
      )}
      {g.running && (
        <div className="dsh-share-kv">
          <span>地址</span>
          <span className="grow mono">{g.endpoints.join('、') || '（没有局域网地址）'}</span>
          {other.length > 0 && (
            <button className="dsh-share-link" onClick={() => setMore((v) => !v)}>
              {more ? '收起' : `其他 ${other.length} 个`}
            </button>
          )}
        </div>
      )}
      {g.running && more && other.length > 0 && (
        <div className="dsh-share-hint mono">虚拟网卡（WSL / Hyper-V 等，对方通常连不上，不写进邀请码）：{other.join('、')}</div>
      )}
      {g.error && <div className="dsh-share-err">访问服务启动失败：{g.error}</div>}
      {a.err && <div className="dsh-share-err">{a.err}</div>}
    </div>
  );
}

function InviteCard({ state, reload }: { state: ShareState; reload: () => void }): React.JSX.Element {
  const a = useAction(reload);
  const now = useNow();
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | undefined>(undefined);
  const g = state.gateway;
  const live = invite && invite.expiresAt > now && g.running ? invite : undefined;
  const { ask, view } = useAsk();
  const doCreate = (): void =>
    void a.run(async () => {
      if (!g.enabled || !g.running) await shareCall('gateway.set', { enabled: true });
      setInvite(await shareCall<{ code: string; expiresAt: number }>('invite.create'));
    });
  const create = (): void => {
    if (g.enabled) return doCreate();
    ask({
      text: '生成邀请码会开启「允许其他设备访问本机」。\n配对成功的设备可以完全控制本机 DSH（浏览会话、发消息、审批、改文件）。只把邀请码发给信任的人。',
      ok: '开启并生成',
      run: doCreate,
    });
  };
  return (
    <div className="dsh-share-card">
      <h4>邀请设备</h4>
      {view}
      {state.requests.map((r) => (
        <RequestCard key={r.requestId} r={r} reload={reload} onDone={() => setInvite(undefined)} />
      ))}
      {live ? (
        <>
          <div className="dsh-share-invite">
            <code className="grow">{live.code}</code>
            <CopyButton text={live.code} label="复制邀请码" />
          </div>
          <div className="dsh-share-row">
            <span className="dsh-share-spin" />
            <span className="grow dsh-share-sub">把邀请码发给对方，等待对方填写… 剩余 {fmtLeft(live.expiresAt - now)}，只能用一次</span>
            <button className="dsh-share-link" onClick={() => setInvite(undefined)}>
              作废
            </button>
          </div>
        </>
      ) : (
        <div className="dsh-share-row">
          <button className="dsh-share-btn primary" disabled={a.busy} onClick={create}>
            {invite ? '重新生成邀请码' : '生成邀请码'}
          </button>
          <span className="dsh-share-sub grow">{invite ? '上一个邀请码已过期' : '对方粘贴邀请码后，你在这里确认'}</span>
        </div>
      )}
      {a.err && <div className="dsh-share-err">{a.err}</div>}
    </div>
  );
}

function RequestCard({ r, reload, onDone }: { r: ShareState['requests'][number]; reload: () => void; onDone: () => void }): React.JSX.Element {
  const a = useAction(reload);
  const act = (m: string): void => void a.run(() => shareCall(m, { requestId: r.requestId })).then((ok) => ok && onDone());
  return (
    <div className="dsh-share-notice">
      <div>
        <b>
          <DeviceName name={r.name} instanceId={r.instanceId} />
        </b>
        {r.address && <span className="dsh-share-sub"> · {r.address}</span>} 请求访问本机
      </div>
      <div className="dsh-share-row">
        <span className="dsh-share-sub">校验码</span>
        <span className="dsh-share-code">{r.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</span>
      </div>
      <div className="dsh-share-hint">和对方核对：对方屏幕上显示的校验码一致才允许。允许后对方可以完全控制本机 DSH。</div>
      <div className="dsh-share-row">
        <button className="dsh-share-btn primary" disabled={a.busy} onClick={() => act('request.confirm')}>
          允许
        </button>
        <button className="dsh-share-btn" disabled={a.busy} onClick={() => act('request.reject')}>
          拒绝
        </button>
      </div>
      {a.err && <div className="dsh-share-err">{a.err}</div>}
    </div>
  );
}


function IncomingCard({ state, reload }: { state: ShareState; reload: () => void }): React.JSX.Element {
  const a = useAction(reload);
  const g = state.gateway;
  const paused = !g.enabled && state.incoming.length > 0;
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const { ask, view } = useAsk();
  return (
    <div className="dsh-share-card">
      <div className="dsh-share-row">
        <h4 className="grow">可以访问本机的设备</h4>
        {state.incoming.length > 0 && (
          <label className="dsh-share-switch" title="暂停后所有设备都连不上本机，配对关系保留">
            <input
              type="checkbox"
              checked={paused}
              disabled={a.busy}
              onChange={(e) => {
                const pause = e.target.checked;
                void a.run(() => shareCall('gateway.set', { enabled: !pause }));
              }}
            />
            <span>暂停所有访问</span>
          </label>
        )}
      </div>
      {view}
      {paused && <div className="dsh-share-warn">已暂停：下面的设备暂时都连不上本机，配对关系保留。</div>}
      {state.incoming.length === 0 ? (
        <div className="dsh-share-empty">还没有。生成邀请码发给对方即可。</div>
      ) : (
        <div className="dsh-share-list">
          {state.incoming.map((d) => (
            editId === d.deviceId ? (
              <RenameRow key={d.deviceId} d={d} kind="incoming" run={a.run} onDone={() => setEditId(undefined)} />
            ) : (
            <div className="dsh-share-item" key={d.deviceId}>
              <div className="grow">
                <div className="name">
                  <DeviceName name={d.name} instanceId={d.instanceId} />
                </div>
                <div className="dsh-share-sub">配对于 {fmtDate(d.pairedAt)}</div>
              </div>
              <button className="dsh-share-btn" disabled={a.busy} onClick={() => setEditId(d.deviceId)}>
                改名
              </button>
              <button
                className="dsh-share-btn danger"
                disabled={a.busy}
                onClick={() =>
                  ask({ text: `撤销「${d.name}」的访问权限？对方会立即断开，之后需要重新配对。`, ok: '撤销', danger: true, run: () => void a.run(() => shareCall('incoming.revoke', { deviceId: d.deviceId })) })
                }
              >
                撤销
              </button>
            </div>
            )
          ))}
        </div>
      )}
      {a.err && <div className="dsh-share-err">{a.err}</div>}
    </div>
  );
}

// ---------------- 我访问别人 ----------------

/** 添加设备：粘贴 → 预览对方 → 发起 → 显示校验码等待 → 批准后回调 onPaired(deviceId)。 */
export function AddDevice({ state, reload, onPaired }: { state: ShareState; reload: () => void; onPaired?: (deviceId: string) => void }): React.JSX.Element {
  const a = useAction(reload);
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<InvitePreview | undefined>(undefined);
  const [previewErr, setPreviewErr] = useState('');
  const [attemptId, setAttemptId] = useState<string | undefined>(undefined);
  const attempt = attemptId ? state.attempts.find((t) => t.attemptId === attemptId) : undefined;

  useEffect(() => {
    const c = code.trim();
    setPreview(undefined);
    setPreviewErr('');
    if (!c) return;
    let alive = true;
    const t = setTimeout(() => {
      shareCall<InvitePreview>('invite.inspect', { code: c }).then(
        (p) => alive && setPreview(p),
        (e) =>
          alive &&
          setPreviewErr(
            String(e instanceof Error ? e.message : e).includes('SELF_PAIR')
              ? `这是本机（${state.self.name} · ${shortId(state.self.instanceId)}）生成的邀请码，请粘贴到另一台设备上`
              : errorText(e),
          ),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code]);

  useEffect(() => {
    if (attempt?.status === 'approved' && attempt.deviceId) {
      const id = attempt.deviceId;
      void shareCall('attempt.dismiss', { attemptId: attempt.attemptId }).finally(reload);
      setAttemptId(undefined);
      setCode('');
      onPaired?.(id);
    }
  }, [attempt?.status, attempt?.deviceId]);

  const cancel = (): void => {
    if (attemptId) void shareCall('attempt.dismiss', { attemptId }).finally(reload);
    setAttemptId(undefined);
  };

  if (attempt && attempt.status !== 'approved') {
    return (
      <div className="dsh-share-notice">
        <div>
          连接 <b><DeviceName name={attempt.name} instanceId={attempt.instanceId} /></b>
        </div>
        {attempt.status === 'waiting' ? (
          <>
            <div className="dsh-share-row">
              <span className="dsh-share-sub">校验码</span>
              <span className="dsh-share-code">{attempt.code.replace(/(\d{3})(\d{3})/, '$1 $2')}</span>
            </div>
            <div className="dsh-share-row">
              <span className="dsh-share-spin" />
              <span className="grow dsh-share-sub">请和对方核对这 6 位数字，等待对方允许…</span>
            </div>
          </>
        ) : (
          <div className="dsh-share-err">
            {attempt.status === 'rejected' ? '对方拒绝了配对' : `配对失败${attempt.error ? `：${errorText(new Error(attempt.error))}` : ''}`}
          </div>
        )}
        <div className="dsh-share-row">
          <button className="dsh-share-btn" onClick={cancel}>
            {attempt.status === 'waiting' ? '取消' : '关闭'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dsh-share-add">
      <textarea
        className="dsh-share-text"
        placeholder="粘贴对方发来的邀请码（DSHS1. 开头）"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      {preview && (
        <div className="dsh-share-preview">
          将连接 <b><DeviceName name={preview.name} instanceId={preview.instanceId} /></b>
          <span className="dsh-share-sub mono">（{preview.endpoints.map((e) => e.replace(/:\d+$/, '')).join('、')}）</span>
        </div>
      )}
      {previewErr && <div className="dsh-share-err">{previewErr}</div>}
      <div className="dsh-share-row">
        <button
          className="dsh-share-btn primary"
          disabled={a.busy || !preview}
          onClick={() =>
            void a.run(async () => {
              const r = await shareCall<{ attemptId: string }>('pair.start', { code: code.trim() });
              setAttemptId(r.attemptId);
            })
          }
        >
          {a.busy ? '正在连接…' : '发起配对'}
        </button>
      </div>
      {a.err && <div className="dsh-share-err">{a.err}</div>}
    </div>
  );
}

export function usePing(devices: Device[], intervalMs = 15000): Record<string, boolean> {
  const [online, setOnline] = useState<Record<string, boolean>>({});
  const ids = devices.map((d) => d.deviceId).join(',');
  useEffect(() => {
    let alive = true;
    const run = (): void => {
      for (const id of ids ? ids.split(',') : []) {
        shareCall<{ online: boolean }>('outgoing.ping', { deviceId: id }).then(
          (r) => alive && setOnline((m) => ({ ...m, [id]: r.online })),
          () => alive && setOnline((m) => ({ ...m, [id]: false })),
        );
      }
    };
    run();
    const t = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [ids, intervalMs]);
  return online;
}

function OutgoingCard({ state, reload, onOpen }: { state: ShareState; reload: () => void; onOpen?: (deviceId: string) => void }): React.JSX.Element {
  const a = useAction(reload);
  const online = usePing(state.outgoing);
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const { ask, view } = useAsk();
  return (
    <div className="dsh-share-card">
      <h4>我能访问的设备</h4>
      {view}
      {state.outgoing.length === 0 ? (
        <div className="dsh-share-empty">还没有。向对方要一个邀请码，粘贴到下面。</div>
      ) : (
        <div className="dsh-share-list">
          {state.outgoing.map((d) => {
            const on = online[d.deviceId];
            if (editId === d.deviceId) return <RenameRow key={d.deviceId} d={d} kind="outgoing" run={a.run} onDone={() => setEditId(undefined)} />;
            return (
              <div className="dsh-share-item" key={d.deviceId}>
                <span className={`dsh-share-dot ${on === undefined ? '' : on ? 'on' : 'off'}`} />
                <div className="grow">
                  <div className="name">
                    <DeviceName name={d.name} instanceId={d.instanceId} />
                  </div>
                  <div className="dsh-share-sub">
                    {on === undefined ? '检测中' : on ? '在线' : '连不上'} · {(d.endpoints ?? []).map((e) => e.replace(/:\d+$/, '')).join('、')}
                  </div>
                </div>
                {onOpen && (
                  <button className="dsh-share-btn primary" onClick={() => onOpen(d.deviceId)}>
                    打开
                  </button>
                )}
                <button className="dsh-share-btn" disabled={a.busy} onClick={() => setEditId(d.deviceId)}>
                  改名
                </button>
                <button
                  className="dsh-share-btn danger"
                  disabled={a.busy}
                  onClick={() =>
                    ask({ text: `删除设备「${d.name}」？之后需要重新配对才能访问。`, ok: '删除', danger: true, run: () => void a.run(() => shareCall('outgoing.remove', { deviceId: d.deviceId })) })
                  }
                >
                  删除
                </button>
              </div>
            );
          })}
        </div>
      )}
      {a.err && <div className="dsh-share-err">{a.err}</div>}
      <h4 style={{ marginTop: 6 }}>添加设备</h4>
      <AddDevice state={state} reload={reload} {...(onOpen ? { onPaired: onOpen } : {})} />
    </div>
  );
}

export type ManageTab = 'in' | 'out';

export function ShareManager({ tab: initial = 'in', onOpen }: { tab?: ManageTab; onOpen?: (deviceId: string) => void }): React.JSX.Element {
  const { state, error, reload } = useShareState();
  const [tab, setTab] = useState<ManageTab>(initial);
  useEffect(() => setTab(initial), [initial]);
  if (!state) return <div className="dsh-share-mgr">{error ? <div className="dsh-share-err">{error}</div> : <div className="dsh-share-empty">加载中…</div>}</div>;
  const pending = state.requests.length;
  return (
    <div className="dsh-share-mgr">
      <div className="dsh-share-tabs">
        <button className={tab === 'in' ? 'active' : ''} onClick={() => setTab('in')}>
          让别人访问我
          {pending > 0 && <span className="dsh-share-badge">{pending}</span>}
        </button>
        <button className={tab === 'out' ? 'active' : ''} onClick={() => setTab('out')}>
          我访问别人
        </button>
      </div>
      {error && <div className="dsh-share-err">{error}</div>}
      {tab === 'in' ? (
        <>
          <SelfCard state={state} reload={reload} />
          <InviteCard state={state} reload={reload} />
          <IncomingCard state={state} reload={reload} />
        </>
      ) : (
        <OutgoingCard state={state} reload={reload} {...(onOpen ? { onOpen } : {})} />
      )}
    </div>
  );
}
