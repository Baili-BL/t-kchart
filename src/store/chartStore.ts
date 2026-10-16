import { create } from 'zustand';
import type { ChartStyle } from '../engine/chart';
import { DEFAULT_LAYOUT_ID, layoutById, uniformLayoutId } from '../engine/layouts';

/** 主图样式 ↔ 顶栏样式下拉里的显示名 */
export const STYLE_LABELS: Record<ChartStyle, string> = {
  candles: 'K线图',
  bars: '美国线',
  line: '线形图',
  area: '面积图',
};

export function styleFromLabel(label: string): ChartStyle | null {
  const hit = (Object.keys(STYLE_LABELS) as ChartStyle[]).find((k) => STYLE_LABELS[k] === label);
  return hit ?? null;
}

/** 顶栏周期下拉里能选的周期（标签 → 周期码） */
export const TIMEFRAMES: { code: string; label: string }[] = [
  { code: '1m', label: '1m' },
  { code: '5m', label: '5m' },
  { code: '15m', label: '15m' },
  { code: '30m', label: '30m' },
  { code: '1h', label: '1h' },
  { code: '4h', label: '4h' },
  { code: '1D', label: '1D' },
  { code: '1W', label: '1W' },
  { code: '1M', label: '1M' },
];

export interface SyncState {
  symbol: boolean;
  interval: boolean;
  crosshair: boolean;
  time: boolean;
  range: boolean;
}

interface ChartState {
  symbol: string;
  /** 活动格的周期（顶栏显示的那个） */
  timeframe: string;
  /** 布局目录里的 id（见 engine/layouts.ts），如 `2-1`（左右两图）、`4-3` */
  layoutId: string;
  layoutName: string;
  sync: SyncState;
  bbVisible: boolean;
  /** 主图样式（所有格共用） */
  chartStyle: ChartStyle;
  /** 活动格最新价（给 PaperTrade 用） */
  lastPrice: number | null;
  /** 活动格序号 */
  activeTile: number;

  setSymbol: (s: string) => void;
  setTimeframe: (tf: string) => void;
  /** 按目录 id 切换；id 不存在返回 false */
  setLayoutId: (id: string) => boolean;
  /** 均匀 rows × cols 入口；没有这种均匀布局返回 false */
  setLayout: (rows: number, cols: number) => boolean;
  setLayoutName: (n: string) => void;
  setSync: (k: keyof SyncState, on: boolean) => void;
  setBb: (on: boolean) => void;
  setChartStyle: (style: ChartStyle) => void;
  setLastPrice: (p: number | null) => void;
  setActiveTile: (i: number) => void;
}

export const useChartStore = create<ChartState>((set, get) => ({
  symbol: 'TSLA',
  timeframe: '30m',
  layoutId: DEFAULT_LAYOUT_ID,
  layoutName: 'Multi-timeframe copy',
  // 截图里左 30m / 右 1D，所以周期与范围默认不联动
  sync: { symbol: true, interval: false, crosshair: true, time: false, range: false },
  bbVisible: true,
  chartStyle: 'candles',
  lastPrice: null,
  activeTile: 0,

  setSymbol: (symbol) => set({ symbol }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setLayoutId: (id) => {
    if (!layoutById(id)) return false;
    if (get().layoutId !== id) set({ layoutId: id });
    return true;
  },
  setLayout: (rows, cols) => {
    const id = uniformLayoutId(rows, cols);
    return id ? get().setLayoutId(id) : false;
  },
  setLayoutName: (layoutName) => set({ layoutName }),
  setSync: (k, on) => set((s) => ({ sync: { ...s.sync, [k]: on } })),
  setBb: (bbVisible) => set({ bbVisible }),
  setChartStyle: (chartStyle) => set({ chartStyle }),
  setLastPrice: (lastPrice) => set({ lastPrice }),
  setActiveTile: (activeTile) => set({ activeTile }),
}));
