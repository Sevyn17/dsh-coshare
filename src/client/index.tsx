/**
 * Client entry（D18）。装载契约（dsh-mobile 先例）：
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... return module.exports } })
 *   module.exports = { name, inject, apply }。
 * 挂载点：main 键控面板 + sidebar.panellist 入口（ui-plugin-manager 先例）；
 * 插件详情页 plugins.detail.section 里放配对与管理（只对本插件渲染）。
 */
import React from 'react';
import { injectShareStyles } from './styles.js';
import { PANEL_ID, SharePanel } from './panel.js';
import { ShareManager } from './manage.js';

type Dispose = () => void;
interface SlotsLike {
  inject(name: string, fn: () => unknown): unknown;
  register(meta: Record<string, unknown>, comp: unknown): unknown;
}
interface ClientCtx {
  slots: SlotsLike;
  effect?: (fn: () => Dispose) => void;
  logger?: { info?: (m: string) => void };
}

const PKG = 'dsh-coshare';

export const name = 'dsh-share-client';
export const inject = ['slots', 'locale', 'layout'];

function PanelIcon(props: { size?: number }): React.JSX.Element {
  const n = props?.size ?? 18;
  return (
    <svg width={n} height={n} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="9" height="7" rx="1.2" />
      <rect x="5.5" y="6.5" width="9" height="7" rx="1.2" />
    </svg>
  );
}

interface DetailProps {
  subject?: { kind?: string; pkg?: { name?: string } };
}
function DetailSection(props: DetailProps): React.JSX.Element | null {
  const s = props?.subject;
  if (!s || (s.kind !== 'bundle' && s.kind !== 'row') || s.pkg?.name !== PKG) return null;
  return (
    <section style={{ marginTop: 8 }}>
      <ShareManager />
    </section>
  );
}

export function apply(ctx: ClientCtx): void {
  if (ctx.effect) ctx.effect(() => injectShareStyles());
  else injectShareStyles();
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({}) }, SharePanel));
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => '协作共享' }, PanelIcon),
  );
  ctx.slots.inject('plugins.detail.section', () =>
    ctx.slots.register({ name: 'plugins.detail.section', id: 'dsh-share-manage', order: 10 }, DetailSection),
  );
  ctx.logger?.info?.('[dsh-coshare] client registered');
}
