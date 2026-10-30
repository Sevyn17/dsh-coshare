/** S4 §5 图标：内联 SVG，16px 线性，stroke=currentColor 跟随文字色（零图标库依赖）。 */
import React from 'react';

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'dsh-share-ico',
};

/** 两个方框叠加=配对/连接。 */
export function IconPair(): React.JSX.Element {
  return (
    <svg {...base}>
      <rect x="1.5" y="5.5" width="9" height="9" rx="1.5" />
      <path d="M5.5 5.5V3a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 14.5 3v6a1.5 1.5 0 0 1-1.5 1.5h-2.5" />
    </svg>
  );
}

/** 分享箭头=共享。 */
export function IconShare(): React.JSX.Element {
  return (
    <svg {...base}>
      <circle cx="12.5" cy="3.5" r="1.8" />
      <circle cx="3.5" cy="8" r="1.8" />
      <circle cx="12.5" cy="12.5" r="1.8" />
      <path d="M5.2 7.1 10.8 4.4M5.2 8.9l5.6 2.7" />
    </svg>
  );
}

/** 加号=新增。 */
export function IconPlus(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

/** 服务器=主机/实例。 */
export function IconServer(): React.JSX.Element {
  return (
    <svg {...base}>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1.2" />
      <rect x="2" y="9" width="12" height="4.5" rx="1.2" />
      <path d="M4.5 4.75h.01M4.5 11.25h.01" />
    </svg>
  );
}

/** 文件夹=工作区。 */
export function IconFolder(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M1.5 4a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2h6A1.5 1.5 0 0 1 15 6v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1.5 12V4z" />
    </svg>
  );
}

/** 对话气泡=会话。 */
export function IconChat(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M14 8a6 6 0 1 1-2.3-4.7L14 2l-.4 2.9A5.9 5.9 0 0 1 14 8z" />
      <path d="M2.5 13.5 4 11" />
    </svg>
  );
}
