/**
 * TradingView 官方调色板（10 列 × 8 行，共 80 色）。
 *
 * 逐值取自 cn.tradingview.com「设置 → 商品代码 → 主体颜色」弹出的取色器
 * （2026-10-18 Playwright 抓取，快照 tests/fixtures/tv-palette.json）。
 * 第 1 行是 10 级灰阶，第 2 行是 10 个基色，第 3~8 行是同一批基色由浅到深的色阶。
 * 改一个数 tests/colorpicker.test.ts 就会红。
 */
export const PALETTE_ROWS: readonly (readonly string[])[] = [
  ['#ffffff', '#dbdbdb', '#b8b8b8', '#9c9c9c', '#808080', '#636363', '#4a4a4a', '#2e2e2e', '#0f0f0f', '#000000'],
  ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63'],
  ['#fccbcd', '#ffe0b2', '#fff9c4', '#c8e6c9', '#ace5dc', '#b2ebf2', '#bbd9fb', '#d1c4e9', '#e1bee7', '#f8bbd0'],
  ['#faa1a4', '#ffcc80', '#fff59d', '#a5d6a7', '#70ccbd', '#80deea', '#90bff9', '#b39ddb', '#ce93d8', '#f48fb1'],
  ['#f77c80', '#ffb74d', '#fff176', '#81c784', '#42bda8', '#4dd0e1', '#5b9cf6', '#9575cd', '#ba68c8', '#f06292'],
  ['#f7525f', '#ffa726', '#ffee58', '#66bb6a', '#22ab94', '#26c6da', '#3179f5', '#7e57c2', '#ab47bc', '#ec407a'],
  ['#b22833', '#f57c00', '#fbc02d', '#388e3c', '#056656', '#0097a7', '#1848cc', '#512da8', '#7b1fa2', '#c2185b'],
  ['#801922', '#e65100', '#f57f17', '#1b5e20', '#00332a', '#006064', '#0c3299', '#311b92', '#4a148c', '#880e4f'],
];

/** 拉平后的 80 色（按行优先，索引 = 行 × 10 + 列） */
export const PALETTE: readonly string[] = PALETTE_ROWS.flat();

/** 每行 10 格 */
export const PALETTE_COLS = 10;

/** 官方白色块单独描边 #dbdbdb，其余块的描边就是自己的颜色（CSS currentColor） */
export const PALETTE_EDGE = '#dbdbdb';

/** 某个色块的描边色：纯白用灰边，其它用自身颜色 */
export function swatchEdge(hex: string): string {
  return hex.toLowerCase() === '#ffffff' ? PALETTE_EDGE : hex;
}

/** hex 规范化：接受 3/6 位（可带 #），非法返回 null；输出大写 #RRGGBB */
export function normalizeHex(raw: string): string | null {
  const s = raw.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(s)) return null;
  const six = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return `#${six.toUpperCase()}`;
}
