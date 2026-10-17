import { create } from 'zustand';

/**
 * 比较商品（顶栏「比较」按钮 → 图表上的叠加线）的状态。
 *
 * 只存「代码 + 颜色 + 显隐」三件事：价格数据不属于 store ——
 * 它取决于每张图自己的周期，由 ChartGrid 现场向数据源要（见 engine/grid.ts）。
 */
/**
 * 比较线配色：**刻意避开涨跌红/绿**（#f23645 / #089981）——
 * 比较线是独立序列，用和 K 线涨跌同色的线会让人以为它是主图的一部分。
 */
export const COMPARE_COLORS = ['#2962ff', '#ff9800', '#673ab7', '#00bcd4', '#9c27b0', '#e91e63'];

/** 一张图最多叠几条比较线：再多图例就压到 K 线上了 */
export const COMPARE_MAX = 6;

export interface CompareItem {
  ticker: string;
  color: string;
  /** 图例上的「眼睛」：关掉后线不画，但配置留着 */
  visible: boolean;
}

export type AddCompareResult = 'added' | 'exists' | 'full';

interface CompareState {
  items: CompareItem[];
  /** 添加。已存在 / 超额都不动，返回原因给 UI 提示 */
  add: (ticker: string) => AddCompareResult;
  remove: (ticker: string) => void;
  toggle: (ticker: string) => void;
  setColor: (ticker: string, color: string) => void;
  clear: () => void;
}

export const useCompareStore = create<CompareState>((set, get) => ({
  items: [],

  add: (ticker) => {
    const items = get().items;
    if (items.some((i) => i.ticker === ticker)) return 'exists';
    if (items.length >= COMPARE_MAX) return 'full';
    // 颜色取「还没用过」的第一个：删掉一条再加一条不会撞成同色
    const used = new Set(items.map((i) => i.color));
    const color = COMPARE_COLORS.find((c) => !used.has(c)) ?? COMPARE_COLORS[items.length % COMPARE_COLORS.length];
    set({ items: [...items, { ticker, color, visible: true }] });
    return 'added';
  },

  remove: (ticker) => set((s) => ({ items: s.items.filter((i) => i.ticker !== ticker) })),

  toggle: (ticker) => set((s) => ({
    items: s.items.map((i) => (i.ticker === ticker ? { ...i, visible: !i.visible } : i)),
  })),

  setColor: (ticker, color) => set((s) => ({
    items: s.items.map((i) => (i.ticker === ticker ? { ...i, color } : i)),
  })),

  clear: () => set({ items: [] }),
}));
