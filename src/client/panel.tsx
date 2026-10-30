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
  return `正在经本机主端口访问对方设备（如手机经 dsh-mobile）。若页面不更新，请在电脑上的 dsh-mobile「WebSocket 路径」里放行：${mount}api/remote.mux 和 ${mount}sidebar/ws/agent-opens。`;
}

function DeviceFrame({ deviceId, name, nonce, visible }: { deviceId: string; name: string; nonce: number; visible: boolean }): React.JSX.Element {
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [err, setErr] = useState('');
  const [retry, setRetry] = useState(0);
  const local = isLocalPage();
  useEffect(() => {
    let alive = true;
    setSrc(undefined);
    setErr('');
    shareCall<{ url: string; port: number; mount: string }>('outgoing.open', { deviceId }).then(
      // 本机：走 127 代理端口；非本机（手机经 dsh-mobile）：走本机主端口子路径，相对地址随页面同源
      (r) => alive && setSrc(local ? r.url : `${r.mount.slice(1)}?n=${nonce}`),
      (e) => alive && setErr(errorText(e)),
    );
    return () => {
      alive = false;
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
          {!local && (
            <div className="dsh-share-hint" style={{ padding: '4px 10px', fontSize: 12 }}>
              {remoteNotice(`/dsh-coshare/peer/${deviceId}/`)}
            </div>
          )}
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
  };

  // 默认打开第一个设备；设备被删除后清掉对应页面
  useEffect(() => {
    if (!state) return;
    const ids = devices.map((d) => d.deviceId);
    setOpened((o) => o.filter((id) => ids.includes(id)));
    if (current && !ids.includes(current)) setCurrent(undefined);
    if (!current && ids[0]) open(ids[0]);
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
