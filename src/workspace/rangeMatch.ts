const DAY = 86400000;

/** 范围按钮的毫秒跨度；YTD / ALL 需要结合数据单独判断 */
const SPANS: { key: string; days: number }[] = [
  { key: '1D', days: 1 },
  { key: '7D', days: 7 },
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
  { key: '5Y', days: 1825 },
];

export interface RangeMatchInput {
  /** 当前视口跨度（天） */
  spanDays: number;
  /** 全部数据跨度（天） */
  dataDays: number;
  /** 视口右端是否贴着最新一根 */
  atRightEdge: boolean;
  /** 当前年份的 1 月 1 日距最新一根多少天 */
  ytdDays: number;
}

/**
 * 按**当前视口跨度**反推哪个范围按钮该高亮（而不是记住「上次点了哪个」）。
 * 手动缩放之后高亮才不会说谎（README §9 ③）。
 * 规则：对数距离最近 + 容差 1.6 倍；ALL / YTD 单独判。
 */
export function matchRange(i: RangeMatchInput): string | null {
  const { spanDays, dataDays, atRightEdge, ytdDays } = i;
  if (!(spanDays > 0)) return null;
  if (dataDays > 0 && spanDays >= dataDays * 0.97) return 'ALL';
  if (!atRightEdge) return null;

  let best: string | null = null;
  let bestD = Math.log(1.6);

  if (ytdDays > 0) {
    const d = Math.abs(Math.log(spanDays / ytdDays));
    if (d <= bestD) {
      best = 'YTD';
      bestD = d;
    }
  }
  for (const s of SPANS) {
    const d = Math.abs(Math.log(spanDays / s.days));
    if (d <= bestD) {
      best = s.key;
      bestD = d;
    }
  }
  return best;
}

export function daysBetween(a: number, b: number): number {
  return Math.abs(b - a) / DAY;
}
