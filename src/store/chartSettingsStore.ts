/**
 * 图表设置 store（设置对话框「商品代码」「样式」两页的数据源）。
 *
 * 口径（诚实说明）：
 * - 这里只存**已确认**的设置；对话框里是草稿，确认后才写进来（取消 = 丢弃草稿）。
 * - applyTo(grid) 把设置广播到所有图格：颜色 / 图例开关 / 成交量显隐 / 精确度走引擎
 *   setAppearance（纯显示层），时区走 fmtTime 的全局偏移。
 * - 设计稿里没有引擎对应的行（预测烛线颜色 / 细K线 / 虚拟K线 / 数据修改 / 系统预设）没有实现，
 *   对话框里不放假开关。
 * - 买/卖按钮开关控制的是 PaperTrade 浮层的显隐（本应用里「图上直接买卖」的对应物）。
 * - 持久化到 localStorage；损坏存档回默认值（与 watchlist/alerts 同一套约定）。
 */
import { create } from 'zustand';
import type { ChartGrid } from '../engine/grid';
import { setTimezoneShift } from '../engine/chart';

export interface ChartSettings {
  /* —— 商品代码页 · 商品组 —— */
  /** Logo 徽标 */
  logo: boolean;
  /** 标题（代码） */
  ticker: boolean;
  /** 名称 */
  name: boolean;
  /** 图表值（开高低收） */
  values: boolean;
  /** K线变化值（相对前一根） */
  barChange: boolean;
  /** 成交量副条 */
  showVolume: boolean;
  /** 最后一天变化值（相对昨收） */
  lastDayChange: boolean;
  /* —— 商品代码页 · 其余 —— */
  /** 买/卖按钮（= 交易面板显隐；默认关，顶栏「交易」按钮 / 设置勾选行均可开关） */
  buySell: boolean;
  /** 指标图例：输入（参数串） */
  indInputs: boolean;
  /** 指标图例：数值 */
  indValues: boolean;
  /** 指标图例：背景（悬停高亮） */
  indBg: boolean;
  /* —— 样式页 —— */
  /** 上涨烛线颜色 */
  upColor: string;
  /** 下跌烛线颜色 */
  downColor: string;
  /** 美国线 / 折线族颜色 */
  lineColor: string;
  /** 价格小数位；0 = 自动（按最小变动价位） */
  precision: number;
  /** 时区 key，见 TZ_OPTIONS */
  timezone: string;
}

export const DEFAULT_SETTINGS: ChartSettings = {
  logo: true,
  ticker: true,
  name: true,
  values: true,
  barChange: true,
  showVolume: true,
  lastDayChange: false,
  buySell: false,
  indInputs: true,
  indValues: true,
  indBg: true,
  // 与 ChartGridView 现行的美股习惯配色一致（设计稿色值同款）
  upColor: '#089981',
  downColor: '#f23645',
  lineColor: '#2962ff',
  precision: 0,
  timezone: 'system',
};

/** 时区选项：value 是相对 UTC 的固定偏移分钟数；'system' 跟系统走 */
export const TZ_OPTIONS: { value: string; label: string; offsetMin: number | null }[] = [
  { value: 'system', label: '系统预设', offsetMin: null },
  { value: 'shanghai', label: '(UTC+8) 上海', offsetMin: 480 },
  { value: 'tokyo', label: '(UTC+9) 东京', offsetMin: 540 },
  { value: 'newyork', label: '(UTC-5) 纽约', offsetMin: -300 },
  { value: 'london', label: '(UTC+0) 伦敦', offsetMin: 0 },
];

/** 目标时区的钟面 = 系统钟面 + (目标偏移 − 系统偏移)。纯函数，测试用。 */
export function tzShiftMinFor(tz: string, now = new Date()): number {
  const opt = TZ_OPTIONS.find((o) => o.value === tz);
  if (!opt || opt.offsetMin == null) return 0;
  return opt.offsetMin + now.getTimezoneOffset();
}

export const PRECISION_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '自动' },
  { value: 1, label: '1 位小数' },
  { value: 2, label: '2 位小数' },
  { value: 3, label: '3 位小数' },
  { value: 4, label: '4 位小数' },
  { value: 5, label: '5 位小数' },
];

const STORAGE_KEY = 'kc.chartSettings.v1';

function serialize(s: ChartSettings): string {
  return JSON.stringify({ v: 1, ...s });
}

function hydrate(raw: string | null): ChartSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const p = JSON.parse(raw) as Partial<ChartSettings>;
    const out = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof ChartSettings)[]) {
      const v = p[k];
      if (typeof v === typeof DEFAULT_SETTINGS[k] && v != null) {
        // @ts-expect-error 逐键校验后赋值，类型上无法收窄
        out[k] = v;
      }
    }
    // 颜色必须是 #rrggbb
    for (const k of ['upColor', 'downColor', 'lineColor'] as const) {
      if (!/^#[0-9a-f]{6}$/i.test(out[k])) out[k] = DEFAULT_SETTINGS[k];
    }
    out.precision = Math.min(6, Math.max(0, Math.round(out.precision)));
    return out;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const hasLS = typeof localStorage !== 'undefined';

interface ChartSettingsState {
  settings: ChartSettings;
  set: (patch: Partial<ChartSettings>) => void;
  reset: () => void;
}

export const useChartSettingsStore = create<ChartSettingsState>((set, get) => ({
  settings: hasLS ? hydrate(localStorage.getItem(STORAGE_KEY)) : { ...DEFAULT_SETTINGS },
  set: (patch) => {
    const settings = { ...get().settings, ...patch };
    if (hasLS) localStorage.setItem(STORAGE_KEY, serialize(settings));
    set({ settings });
  },
  reset: () => {
    if (hasLS) localStorage.setItem(STORAGE_KEY, serialize({ ...DEFAULT_SETTINGS }));
    set({ settings: { ...DEFAULT_SETTINGS } });
  },
}));

/** 把当前设置应用到一张图格网格（纯显示层 + 时钟偏移）。 */
export function applyTo(grid: ChartGrid | null): void {
  const s = useChartSettingsStore.getState().settings;
  setTimezoneShift(tzShiftMinFor(s.timezone));
  if (!grid) return;
  grid.applyAppearance((ticker) => ({
    upColor: s.upColor,
    downColor: s.downColor,
    lineColor: s.lineColor,
    showVolume: s.showVolume,
    precision: s.precision,
    legend: {
      logo: s.logo,
      ticker: s.ticker,
      name: s.name,
      values: s.values,
      barChange: s.barChange,
      lastChange: s.lastDayChange,
    },
    indLegend: { inputs: s.indInputs, values: s.indValues, bg: s.indBg },
    // 图例「名称」按格子的标的注入（引擎不认识标的目录）
    symbolName: grid ? gridTileName(ticker) : '',
  }));
}

/* 标的目录在 data 层，engine 层不知道；这里懒加载避免 store ←→ data 循环依赖 */
import { SYMBOL_BY_TICKER } from '../data/symbols';
function gridTileName(ticker: string): string {
  return SYMBOL_BY_TICKER.get(ticker)?.name ?? '';
}
