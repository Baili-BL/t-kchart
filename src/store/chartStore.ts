import { create } from 'zustand';

export interface LayoutPreset {
  key: string;
  label: string;
  rows: number;
  cols: number;
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { key: '1x1', label: '单图', rows: 1, cols: 1 },
  { key: '1x2', label: '左右 2 图', rows: 1, cols: 2 },
  { key: '2x1', label: '上下 2 图', rows: 2, cols: 1 },
  { key: '2x2', label: '4 图', rows: 2, cols: 2 },
  { key: '2x3', label: '6 图', rows: 2, cols: 3 },
];

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
  range: boolean;
}

interface ChartState {
  symbol: string;
  /** 活动格的周期（顶栏显示的那个） */
  timeframe: string;
  layout: { rows: number; cols: number };
  layoutName: string;
  sync: SyncState;
  bbVisible: boolean;
  /** 活动格最新价（给 PaperTrade 用） */
  lastPrice: number | null;
  /** 活动格序号 */
  activeTile: number;

  setSymbol: (s: string) => void;
  setTimeframe: (tf: string) => void;
  setLayout: (rows: number, cols: number) => void;
  setLayoutName: (n: string) => void;
  setSync: (k: keyof SyncState, on: boolean) => void;
  setBb: (on: boolean) => void;
  setLastPrice: (p: number | null) => void;
  setActiveTile: (i: number) => void;
}

export const useChartStore = create<ChartState>((set) => ({
  symbol: 'TSLA',
  timeframe: '30m',
  layout: { rows: 1, cols: 2 },
  layoutName: 'Multi-timeframe copy',
  // 截图里左 30m / 右 1D，所以周期与范围默认不联动
  sync: { symbol: true, interval: false, crosshair: true, range: false },
  bbVisible: true,
  lastPrice: null,
  activeTile: 0,

  setSymbol: (symbol) => set({ symbol }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setLayout: (rows, cols) => set({ layout: { rows, cols } }),
  setLayoutName: (layoutName) => set({ layoutName }),
  setSync: (k, on) => set((s) => ({ sync: { ...s.sync, [k]: on } })),
  setBb: (bbVisible) => set({ bbVisible }),
  setLastPrice: (lastPrice) => set({ lastPrice }),
  setActiveTile: (activeTile) => set({ activeTile }),
}));
