import type { CSSProperties, ReactElement } from 'react';

/** 24×24 描边图标集。统一 currentColor，颜色跟随文字。 */
const paths = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" />
      <path d="M3.5 4v4.5H8M12 7.5V12l3 2" />
    </>
  ),
  dots: (
    <>
      <circle cx="12" cy="5.5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="18.5" r="1" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 15h17" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </>
  ),
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.8" cy="6.5" r="1" />
      <circle cx="4.8" cy="12" r="1" />
      <circle cx="4.8" cy="17.5" r="1" />
    </>
  ),
  hourglass: <path d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5-8 8.5" />,
  doc: (
    <>
      <path d="M6.5 3.5h8l4 4v13h-12z" />
      <path d="M14.5 3.5v4h4M9.5 12h5M9.5 15.5h5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
    </>
  ),
  code: <path d="m8.5 7.5-5 4.5 5 4.5M15.5 7.5l5 4.5-5 4.5" />,
  trendingUp: <path d="m3.5 17 6-6 4 4 7-8M15 7h5.5v5.5" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  chat: <path d="M4.5 5.5h15v10h-8l-4.5 4v-4h-2.5z" />,
  share: (
    <>
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="m7.8 11 8.4-4M7.8 13l8.4 4" />
    </>
  ),
  bookmark: <path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" />,
  rewind: <path d="M11 6.5v11l-7-5.5zM20 6.5v11l-7-5.5z" />,
  undo: <path d="M9 7 4.5 11.5 9 16M4.5 11.5H14a5.5 5.5 0 0 1 0 11" />,
  redo: <path d="m15 7 4.5 4.5L15 16M19.5 11.5H10a5.5 5.5 0 0 0 0 11" />,
  candles: (
    <>
      <rect x="5" y="8" width="4" height="8" rx="0.8" />
      <path d="M7 4.5V8M7 16v3.5" />
      <rect x="15" y="6" width="4" height="9" rx="0.8" />
      <path d="M17 3v3M17 15v4" />
    </>
  ),
  layout: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M12 4.5v15" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </>
  ),
  feedback: <path d="M4.5 5.5h15v10.5h-9l-4 3.5V16h-2z" />,
  zap: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  trash: <path d="M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7" />,
  alertCircle: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof paths;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, className, style, strokeWidth = 1.6 }: IconProps): ReactElement {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** 渲染来自 *-icons.ts 的内联 SVG 字符串（设计稿里抠出来的那批）。 */
export function RawIcon({ html, className }: { html: string; className?: string }): ReactElement {
  return <span className={className} style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 品牌标记：一个 V 形 */
export function BrandMark({ size = 20 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3.5 5h4.2L12 14.2 16.3 5h4.2L13.6 20h-3.2z" fill="currentColor" />
    </svg>
  );
}
