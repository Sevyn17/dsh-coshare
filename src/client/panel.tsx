/**
 * 共享面板（D18，m03456/m03458 重设计）：整页留给内嵌的对方实例页面。
 * 顶栏：设备下拉（在线状态、添加设备、配对管理）+ 重新加载 / 新窗口 / 配对管理（有请求时红点）+ 请求提醒条。
 * 配对管理放弹窗（两个标签，与插件配置页同一套 ShareManager）。切换设备时 iframe 只隐藏不销毁。
 */
import React, { useEffect, useRef, useState } from 'react';
import { errorText, shareCall, shortId } from './api.js';
import { ShareManager, useShareState, usePing, type ManageTab } from './manage.js';

export const PANEL_ID = 'dsh-share-panel';

/** 代理只监听本机 127.0.0.1：页面不在本机打开（如手机经 dsh-mobile 访问）时无法内嵌对方实例。 */
export function isLocalPage(): boolean {
  if (location.protocol === 'dsh-app:') return true;
  return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(location.hostname);
}
/** 非本机访问（手机经 dsh-mobile）时的提示：对方页面的实时通道要先在 dsh-mobile 里放行。 */
export function remoteNotice(mount: string): string {
  return `正在经电脑主端口访问对方设备（如手机经 dsh-mobile）。若页面打开后不实时更新：在电脑上打开 dsh-mobile「诊断」页，在「第三方 WebSocket 路径」里点「全部允许」，然后刷新本页。也可展开「手动添加路径（高级）」照抄这两条（已是本设备的完整路径）：${mount}api/remote.mux 和 ${mount}sidebar/ws/agent-opens。`;
}

const TIP_HIDDEN_KEY = 'dsh-coshare.remoteTipHidden';

/** 手机访问提示：默认一行小字，点开看完整步骤，可关闭（记在浏览器本地）。 */
function RemoteTip({ mount }: { mount: string }): React.JSX.Element | null {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(TIP_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);
  if (hidden) return null;
  const close = (): void => {
    try {
      localStorage.setItem(TIP_HIDDEN_KEY, '1');
    } catch {
      /* 存不了就只关本次 */
    }
    setHidden(true);
  };
  return (
    <div className="dsh-share-hint" style={{ padding: '2px 10px', fontSize: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span style={{ flex: 1, cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        {open ? `▾ ${remoteNotice(mount)}` : '▸ 手机访问：页面不更新时点这里查看说明'}
      </span>
      <span style={{ cursor: 'pointer' }} title="不再显示" onClick={close}>
        ✕
      </span>
    </div>
  );
}

const RESTART_HINT = '电脑上的 dsh-coshare 已更新但 DSH 还没重启。请完全退出电脑上的 DSH（包括托盘图标）再重新打开，然后刷新本页。';
const LAST_DEVICE_KEY = 'dsh-coshare.lastDevice';
const TIMEOUT_HINT = '连接超时。如果刚更新过插件，请完全退出并重新打开电脑上的 DSH。';
/** 与 src/host/proxy.ts CSRF_FAILED_MESSAGE 一致（两边分别打包，不能直接 import）。 */
const CSRF_FAILED_MESSAGE = 'dsh-coshare:mobile-csrf-failed';
const CSRF_HINT = '手机上的操作被 dsh-mobile 拒绝（CSRF 校验失败），可能是 dsh-mobile 版本有变化，请更新 dsh-coshare。';

function DeviceFrame({ deviceId, name, nonce, visible }: { deviceId: string; name: string; nonce: number; visible: boolean }): React.JSX.Element {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [err, setErr] = useState('');
  const [retry, setRetry] = useState(0);
  const local = isLocalPage();
  const [csrfBroken, setCsrfBroken] = useState(false);
  useEffect(() => {
    if (local) return;
    const onMsg = (e: MessageEvent): void => {
      const d = e.data as { type?: unknown } | null;
      if (e.origin === location.origin && d?.type === CSRF_FAILED_MESSAGE) setCsrfBroken(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [local]);
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setErr('');
    // 兜底：15 秒还没拿到地址也给出提示（拿到结果后清掉）
    const timer = setTimeout(() => alive && setErr(TIMEOUT_HINT), 15000);
    shareCall<{ url: string; port: number; mount?: string }>('outgoing.open', { deviceId }).then(
      // 本机：走 127 代理端口；非本机（手机经 dsh-mobile）：走本机主端口子路径，相对地址随页面同源
      (r) => {
        clearTimeout(timer);
        if (!alive) return;
        // 宿主端还是旧版（装了新插件但 DSH 没重启）时不返回 mount：直接提示重启，不要卡在「正在连接」
        if (!local && typeof r.mount !== 'string') return setErr(RESTART_HINT);
        setSrc(local || !r.mount ? r.url : `${r.mount.slice(1)}?n=${nonce}`);
      },
      (e) => {
        clearTimeout(timer);
        if (alive) setErr(errorText(e));
      },
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [deviceId, nonce, retry, local]);
  return (
    <div className="dsh-share-slot" style={visible ? undefined : { display: 'none' }}>
      {err ? (
        <div className="dsh-share-center">
          <div className="dsh-share-err">连接「{name}」失败：{err}</div>
          <button className="dsh-share-btn" onClick={() => setRetry((n) => n + 1)}>
            重试
          </button>
        </div>
      ) : src ? (
        <>
          {!local && csrfBroken && <div className="dsh-share-err" style={{ padding: '4px 10px', fontSize: 12 }}>{CSRF_HINT}</div>}
          {!local && <RemoteTip mount={`/dsh-coshare/peer/${deviceId}/`} />}
          <iframe key={src} className="dsh-share-frame" src={src} title={name} allow="clipboard-read; clipboard-write" />
        </>
      ) : (
        <div className="dsh-share-center">正在连接「{name}」…</div>
      )}
    </div>
  );
}

function Modal({ tab, self, onClose, onOpen }: { tab: ManageTab; self?: { name: string; instanceId: string } | undefined; onClose: () => void; onOpen: (deviceId: string) => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dsh-share-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dsh-share-modal" role="dialog" aria-label="配对管理">
        <div className="dsh-share-modal-head">
          <b>配对管理</b>
          {self && (
            <span className="grow dsh-share-sub" title="当前这台设备">
              本机：{self.name} · {shortId(self.instanceId)}
            </span>
          )}
          {!self && <span className="grow" />}
          <button className="dsh-share-icon-btn" title="关闭（Esc）" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dsh-share-modal-body">
          <ShareManager tab={tab} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}

export function SharePanel(): React.JSX.Element {
  const { state } = useShareState(3000);
  const devices = state?.outgoing ?? [];
  const online = usePing(devices);
  const [current, setCurrent] = useState<string | undefined>(undefined);
  const [opened, setOpened] = useState<string[]>([]);
  const [nonces, setNonces] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<ManageTab | undefined>(undefined);
  const [err, setErr] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const requests = state?.requests ?? [];

  const open = (deviceId: string): void => {
    setCurrent(deviceId);
    setOpened((o) => (o.includes(deviceId) ? o : [...o, deviceId]));
    setMenu(false);
    try {
      localStorage.setItem(LAST_DEVICE_KEY, deviceId);
    } catch {
      /* 存储不可用时不记忆 */
    }
  };

  // 默认打开上次查看的设备（记在浏览器本地），不在列表里则打开第一个；设备被删除后清掉对应页面
  useEffect(() => {
    if (!state) return;
    const ids = devices.map((d) => d.deviceId);
    setOpened((o) => o.filter((id) => ids.includes(id)));
    if (current && !ids.includes(current)) setCurrent(undefined);
    if (!current || !ids.includes(current)) {
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_DEVICE_KEY);
      } catch {
        /* 忽略 */
      }
      const pick = last && ids.includes(last) ? last : ids[0];
      if (pick) open(pick);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu]);

  const dev = devices.find((d) => d.deviceId === current);
  const dotClass = (id: string): string => (online[id] === undefined ? '' : online[id] ? ' on' : ' off');
  const proxyHint = '经本机代理访问对方实例：页面、会话、执行和模型费用都在对方机器上';

  const openWindow = (): void => {
    if (!current) return;
    setErr('');
    const local = isLocalPage();
    void shareCall<{ url: string; mount: string }>('outgoing.open', { deviceId: current }).then(
      (r) => window.open(local ? r.url : new URL(r.mount.slice(1), document.baseURI).href, '_blank', 'noopener'),
      (e) => setErr(errorText(e)),
    );
  };

  return (
    <div className="dsh-share-panel">
      <div className="dsh-share-top">
        <div className="dsh-share-picker" ref={menuRef}>
          <button className="dsh-share-pick" onClick={() => setMenu((v) => !v)} title={dev ? `${proxyHint}\n地址：${(dev.endpoints ?? []).join('、')}` : ''}>
            {dev ? (
              <>
                <span className={`dsh-share-dot${dotClass(dev.deviceId)}`} />
                <span className="name">{dev.name}</span>
                <span className="dsh-share-sid">{shortId(dev.instanceId)}</span>
              </>
            ) : (
              <span className="name">{devices.length ? '选择设备' : '还没有设备'}</span>
            )}
            <span className="caret">▾</span>
          </button>
          {menu && (
            <div className="dsh-share-menu">
              {devices.length === 0 && <div className="dsh-share-empty" style={{ padding: '6px 10px' }}>还没有可访问的设备</div>}
              {devices.map((d) => (
                <button key={d.deviceId} className={`dsh-share-mi${d.deviceId === current ? ' active' : ''}`} onClick={() => open(d.deviceId)} title={(d.endpoints ?? []).join('、')}>
                  <span className={`dsh-share-dot${dotClass(d.deviceId)}`} />
                  <span className="grow">{d.name}</span>
                  <span className="dsh-share-sid">{shortId(d.instanceId)}</span>
                  <span className="dsh-share-sub">{online[d.deviceId] === undefined ? '' : online[d.deviceId] ? '在线' : '离线'}</span>
                </button>
              ))}
              <div className="sep" />
              <button className="dsh-share-mi" onClick={() => (setMenu(false), setModal('out'))}>
                ＋ 添加设备…
              </button>
              <button className="dsh-share-mi" onClick={() => (setMenu(false), setModal('in'))}>
                ⚙ 配对管理…
              </button>
            </div>
          )}
        </div>
        <span className="grow dsh-share-err">{err}</span>
        <button className="dsh-share-icon-btn" title="重新加载" disabled={!current} onClick={() => current && setNonces((n) => ({ ...n, [current]: (n[current] ?? 0) + 1 }))}>
          ⟳
        </button>
        <button className="dsh-share-icon-btn" title="在新窗口打开" disabled={!current} onClick={openWindow}>
          ↗
        </button>
        <button className="dsh-share-icon-btn dsh-share-gear" title="配对管理" onClick={() => setModal(requests.length ? 'in' : 'out')}>
          ⚙{requests.length > 0 && <span className="reddot" />}
        </button>
      </div>
      {requests.length > 0 && (
        <div className="dsh-share-alert">
          <span className="grow">
            「{requests[0]?.name}」{requests.length > 1 ? ` 等 ${requests.length} 台设备` : ''}请求访问本机
          </span>
          <button className="dsh-share-btn primary" onClick={() => setModal('in')}>
            查看
          </button>
        </div>
      )}
      <div className="dsh-share-stage">
        {opened.map((id) => {
          const d = devices.find((x) => x.deviceId === id);
          return d ? <DeviceFrame key={id} deviceId={id} name={d.name} nonce={nonces[id] ?? 0} visible={id === current} /> : null;
        })}
        {!current && state && (
          <div className="dsh-share-center">
            <div className="dsh-share-big">{devices.length ? '从左上角选择一台设备' : '还没有可访问的设备'}</div>
            <div className="dsh-share-hint">访问别人：向对方要一个邀请码；让别人访问我：生成邀请码发给对方。</div>
            <div className="dsh-share-row">
              <button className="dsh-share-btn primary" onClick={() => setModal('out')}>
                添加设备（访问别人）
              </button>
              <button className="dsh-share-btn" onClick={() => setModal('in')}>
                让别人访问我
              </button>
            </div>
          </div>
        )}
        {!state && <div className="dsh-share-center">加载中…</div>}
      </div>
      {modal && (
        <Modal
          tab={modal}
          self={state?.self}
          onClose={() => setModal(undefined)}
          onOpen={(id) => {
            setModal(undefined);
            open(id);
          }}
        />
      )}
    </div>
  );
}
