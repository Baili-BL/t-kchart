/**
 * kc-chart / compare.ts
 * ---------------------------------------------------------------------------
 * 「比较商品」（Compare）的纯计算部分 —— 不碰 canvas，也不认识 store。
 *
 * 语义（与线上 TradingView 一致）：
 *   ① 比较线按**百分比**比较，不是按价格。两条价格差 100 倍的线也能看出谁跑得快。
 *   ② 百分比基准 = **可见范围左端第一根有数据的 bar**（所以平移 / 缩放时基准会跟着换，
 *      这是官方行为：比较的是「屏幕上这一段」的相对涨幅）。
 *   ③ 主图价格轴不动。比较线先算成百分比，再按主图基准价折回「等价价格」，
 *      于是它和主图共用同一个 yOf()，自动缩放也只需要把等价价格一起纳入 min/max。
 *
 * 为什么不在 KChart 里就地算：这三步（对齐 / 归一 / 折回）都是纯函数，
 * 放在这里可以直接单测，不用造 canvas。
 * ---------------------------------------------------------------------------
 */
import type { Bar } from './chart';

/** 一条比较线。`values` 与主图 bars **等长**，按时间对齐后的收盘价（缺数据 = null）。 */
export interface CompareSeries {
  ticker: string;
  /** 交易所简称（图例行里显示） */
  exchange: string;
  color: string;
  visible: boolean;
  values: (number | null)[];
}

/**
 * 把另一只标的的收盘价对齐到主图时间轴。
 * 用 time（bar 开盘时间）作为键 —— 两个标的的交易日历不同（节假日 / 停牌）时会缺值，
 * 缺的那根就是 null，画线时断开，绝不用前值填充（那会造出一段不存在的横线）。
 */
export function alignCloses(main: { time: number }[], other: Bar[]): (number | null)[] {
  const byTime = new Map<number, number>();
  for (const b of other) {
    if (isFinite(b.close)) byTime.set(b.time, b.close);
  }
  const out: (number | null)[] = new Array(main.length);
  for (let i = 0; i < main.length; i++) {
    const v = byTime.get(main[i].time);
    out[i] = v == null ? null : v;
  }
  return out;
}

/** [lo, hi] 里第一个非空值的位置；没有返回 -1 */
export function firstValueIndex(values: (number | null)[], lo: number, hi: number): number {
  const a = Math.max(0, lo);
  const b = Math.min(values.length - 1, hi);
  for (let i = a; i <= b; i++) {
    const v = values[i];
    if (v != null && isFinite(v)) return i;
  }
  return -1;
}

/** [lo, hi] 里最后一个非空值的位置；没有返回 -1 */
export function lastValueIndex(values: (number | null)[], lo: number, hi: number): number {
  const a = Math.max(0, lo);
  const b = Math.min(values.length - 1, hi);
  for (let i = b; i >= a; i--) {
    const v = values[i];
    if (v != null && isFinite(v)) return i;
  }
  return -1;
}

export interface EquivLine {
  /** 归一基准所在的主图索引 */
  baseIndex: number;
  /** 与 values 等长的「等价价格」（主图坐标系）；基准之外 / 缺值 = null */
  prices: (number | null)[];
}

/**
 * 比较线 → 主图坐标系的等价价格。
 *   pct = value / base - 1；eq = mainBase × (1 + pct)
 * `base` 取**自己的**第一个可见值（不同标的交易日历可能错开一根），
 * `mainBase` 是主图在同一索引上的收盘价 —— 于是两条线在基准点重合，之后比的是涨幅。
 * 返回 null = 可见范围里一个值都没有（不画）。
 */
export function equivPrices(
  values: (number | null)[], mainBase: number, lo: number, hi: number,
): EquivLine | null {
  const baseIndex = firstValueIndex(values, lo, hi);
  if (baseIndex < 0) return null;
  const base = values[baseIndex];
  if (base == null || !isFinite(base) || base === 0 || !isFinite(mainBase)) return null;
  const prices: (number | null)[] = new Array(values.length).fill(null);
  const b = Math.min(values.length - 1, hi);
  for (let i = baseIndex; i <= b; i++) {
    const v = values[i];
    if (v == null || !isFinite(v)) continue;
    prices[i] = mainBase * (v / base);
  }
  return { baseIndex, prices };
}

/** 某根（或它之前最近一根）相对基准的百分比；返回 null = 该范围内没有数据 */
export function percentAt(values: (number | null)[], baseIndex: number, i: number): number | null {
  if (baseIndex < 0) return null;
  const base = values[baseIndex];
  if (base == null || !isFinite(base) || base === 0) return null;
  for (let k = Math.min(i, values.length - 1); k >= baseIndex; k--) {
    const v = values[k];
    if (v == null || !isFinite(v)) continue;
    return (v / base - 1) * 100;
  }
  return null;
}
