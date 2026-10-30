/**
 * dsh-coshare 样式（D18）：只用宿主设计系统里真实存在的 --dsw-alias-* 变量，类名前缀 dsh-share-，全局注入一次（幂等）。
 */
const STYLE_ID = 'dsh-share-style';

const MONO = 'ui-monospace, Consolas, monospace';

const CSS = `
.dsh-share-ico { flex: none; display: block; }
.dsh-share-mgr { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 12px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-share-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.dsh-share-card h4 { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-share-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-share-row { display: flex; align-items: center; gap: 10px; min-height: 32px; flex-wrap: wrap; }
.dsh-share-row .grow, .dsh-share-top .grow, .dsh-share-alert .grow, .dsh-share-modal-head .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-share-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-share-list { display: flex; flex-direction: column; gap: 2px; }
.dsh-share-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; }
.dsh-share-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-share-item .grow { flex: 1; min-width: 0; }
.dsh-share-item .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-share-empty { color: var(--dsw-alias-label-secondary); padding: 6px 0; }
.dsh-share-btn { appearance: none; border: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 4px 12px; font-size: 12px; line-height: 20px; cursor: pointer; white-space: nowrap; }
.dsh-share-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-share-btn:disabled { opacity: .5; cursor: default; }
.dsh-share-btn.primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: #fff; }
.dsh-share-btn.primary:hover { filter: brightness(1.08); }
.dsh-share-btn.danger { color: var(--dsw-alias-state-error-primary); }
.dsh-share-link { appearance: none; border: none; background: none; padding: 0; color: var(--dsw-alias-brand-primary); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.dsh-share-link:hover { text-decoration: underline; }
.dsh-share-input, .dsh-share-text { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 6px 10px; font-size: 12px; font-family: inherit; }
.dsh-share-row .dsh-share-input { flex: 1; width: auto; min-width: 120px; }
.dsh-share-text { font-family: ${MONO}; resize: vertical; min-height: 64px; word-break: break-all; }
.dsh-share-code { font-family: ${MONO}; font-size: 22px; letter-spacing: 4px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-share-err { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dsh-share-ok { color: var(--dsw-alias-state-success-primary); font-size: 12px; }
.dsh-share-warn { color: var(--dsw-alias-state-warn-primary); font-size: 12px; }
.dsh-share-notice { border: 1px solid var(--dsw-alias-brand-primary); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-2); }
.dsh-share-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--dsw-alias-label-tertiary); }
.dsh-share-dot.on { background: var(--dsw-alias-state-success-primary); }
.dsh-share-dot.off { background: var(--dsw-alias-state-error-primary); }
.dsh-share-switch { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.dsh-share-switch input { width: 16px; height: 16px; accent-color: var(--dsw-alias-brand-primary); }
.dsh-share-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-share-tabs button { appearance: none; border: none; background: none; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; padding: 8px 12px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; display: inline-flex; align-items: center; gap: 6px; }
.dsh-share-tabs button:hover { color: var(--dsw-alias-label-primary); }
.dsh-share-tabs button.active { color: var(--dsw-alias-label-primary); font-weight: 600; border-bottom-color: var(--dsw-alias-brand-primary); }
.dsh-share-badge { min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 8px; background: var(--dsw-alias-state-error-primary); color: #fff; font-size: 11px; line-height: 16px; text-align: center; font-weight: 600; }
.dsh-share-tag { font-size: 11px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dsh-share-tag.on { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.dsh-share-big { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-share-kv { display: flex; align-items: baseline; gap: 10px; font-size: 12px; }
.dsh-share-kv > span:first-child { color: var(--dsw-alias-label-secondary); flex: none; }
.dsh-share-kv .grow { flex: 1; min-width: 0; word-break: break-all; }
.dsh-share-mono, .dsh-share-kv .mono, .dsh-share-hint.mono { font-family: ${MONO}; }
.dsh-share-invite { display: flex; align-items: center; gap: 10px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: 8px; padding: 8px 10px; background: var(--dsw-alias-bg-base); }
.dsh-share-invite code { flex: 1; min-width: 0; font-family: ${MONO}; font-size: 12px; word-break: break-all; color: var(--dsw-alias-label-primary); max-height: 72px; overflow: auto; }
.dsh-share-spin { width: 12px; height: 12px; flex: none; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l3); border-top-color: var(--dsw-alias-brand-primary); animation: dsh-share-spin .8s linear infinite; }
@keyframes dsh-share-spin { to { transform: rotate(360deg); } }
.dsh-share-add { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 12px; }
.dsh-share-preview { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 10px; background: var(--dsw-alias-bg-layer-2); font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.dsh-share-dname { display: inline-flex; align-items: baseline; gap: 6px; min-width: 0; }
.dsh-share-sid { font-family: ${MONO}; font-size: 11px; color: var(--dsw-alias-label-tertiary); font-weight: 400; flex: none; }

.dsh-share-panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; position: relative; }
.dsh-share-top { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); min-height: 36px; box-sizing: border-box; flex: none; }
.dsh-share-top .grow { font-size: 12px; }
.dsh-share-picker { position: relative; min-width: 0; }
.dsh-share-pick { appearance: none; border: 1px solid transparent; background: none; color: inherit; font: inherit; display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 6px; cursor: pointer; max-width: 360px; }
.dsh-share-pick:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l2); }
.dsh-share-pick .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-share-pick .caret { color: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-share-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; min-width: 260px; max-width: 380px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.18); padding: 4px; display: flex; flex-direction: column; }
.dsh-share-menu .sep { height: 1px; background: var(--dsw-alias-border-l2); margin: 4px 2px; }
.dsh-share-mi { appearance: none; border: none; background: none; color: inherit; font: inherit; text-align: left; display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.dsh-share-mi:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-share-mi.active { background: var(--dsw-alias-interactive-bg-active); font-weight: 600; }
.dsh-share-mi .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-share-icon-btn { appearance: none; border: none; background: none; color: var(--dsw-alias-label-secondary); width: 28px; height: 28px; border-radius: 6px; cursor: pointer; font-size: 15px; line-height: 28px; text-align: center; padding: 0; position: relative; flex: none; }
.dsh-share-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-share-icon-btn:disabled { opacity: .4; cursor: default; }
.dsh-share-gear .reddot { position: absolute; top: 4px; right: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-state-error-primary); }
.dsh-share-alert { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-brand-primary); font-size: 12px; flex: none; }
.dsh-share-stage { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.dsh-share-slot { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.dsh-share-frame { flex: 1; border: 0; width: 100%; min-height: 0; background: var(--dsw-alias-bg-base); }
.dsh-share-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--dsw-alias-label-secondary); padding: 24px; text-align: center; }
.dsh-share-center .dsh-share-row { justify-content: center; }
.dsh-share-mask { position: absolute; inset: 0; z-index: 30; background: rgba(0,0,0,.32); display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px 16px; box-sizing: border-box; overflow: auto; }
.dsh-share-modal { width: 560px; max-width: 100%; max-height: calc(100% - 32px); display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.28); }
.dsh-share-modal-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px 18px; font-size: 14px; }
.dsh-share-modal-body { padding: 0 18px 14px; overflow: auto; min-height: 0; }
`;

/** 全局注入一次（幂等）；返回移除函数。 */
export function injectShareStyles(): () => void {
  if (typeof document === 'undefined') return () => {};
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = CSS;
  return () => {
    el?.remove();
  };
}
