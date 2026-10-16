/**
 * kc-chart / chart.ts
 * ---------------------------------------------------------------------------
 * 一个不依赖任何第三方库的 专业图表风格的图表核心（Tier-1 范围）。
 *
 *   ✓ 蜡烛图（A 股习惯：涨红跌绿）+ 成交量副条
 *   ✓ 价格轴 / 时间轴，nice ticks 自适应刻度
 *   ✓ 十字光标（吸附到 bar 中心）+ 双轴反色标签 + OHLC 图例
 *   ✓ 滚轮缩放（**光标锚定**：光标下的那根 bar 不动）+ 拖拽平移
 *   ✓ 最新价虚线 + 右侧价格标签
 *   ✓ MA5/10/20 叠加，BOLL(20,2) 可切换、带通道填充
 *   ✓ devicePixelRatio 适配 + ResizeObserver
 *   ✓ 实时最后一根走线刷新（chart.update(bar)）
 *
 * 设计约束（重要，别破坏）：
 *   ① 本文件现为 ESM 模块（原为全局脚本，改造时补了 `export`，算法未动）；
 *      零运行时依赖，不引入任何图表库。
 *   ② 只使用可擦除类型语法（无 enum / 装饰器 / namespace / 参数属性），保持算法可读、可移植（见 TODO §3 Rust 计划）。
 * ---------------------------------------------------------------------------
 */

import {
  drawStudyOutput, fmtStudyValue, getStudyRunner, paneScale, paneStudies, paneTicks, studyParamsText,
} from './studies';
import type { Study, StudyDef, StudyGeom } from './studies';

/* ===========================================================================
 * 1. 类型（编译时整体擦除）
 * ========================================================================= */

/** 一根 K 线。`time` 必须是该 bar 的**开盘时间**，epoch 毫秒。 */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 主图样式。全部是**纯显示层**变换：数据、指标、回放、联动都仍然跑在真实 OHLC 上。
 *   蜡烛族：candles K线 / bars 美国线 / hollow 空心K线（涨空心跌实心）/ volcandles 成交量蜡烛（实体宽度 ∝ 成交量）/ heikin 平均K线
 *   折线族（价格轴只按收盘价取范围）：line / linemarkers 带标记线 / step 阶梯线 / area 面积 / baseline 基准线 / columns 柱状图
 *   区间族（按最高最低价取范围）：hlcarea HLC 区域 / highlow 高-低
 */
export type ChartStyle =
  | 'candles' | 'bars' | 'hollow' | 'volcandles'
  | 'line' | 'linemarkers' | 'step'
  | 'area' | 'hlcarea' | 'baseline'
  | 'columns' | 'highlow'
  | 'heikin';

export const CHART_STYLES: ChartStyle[] = [
  'candles', 'bars', 'hollow', 'volcandles',
  'line', 'linemarkers', 'step',
  'area', 'hlcarea', 'baseline',
  'columns', 'highlow',
  'heikin',
];

/** 只看收盘价的样式（价格轴也只按收盘价取范围） */
const CLOSE_ONLY_STYLES: ReadonlySet<ChartStyle> = new Set<ChartStyle>(['line', 'linemarkers', 'step', 'area', 'baseline', 'columns']);

/**
 * 平均K线（Heikin-Ashi）。纯函数，输入真实 K 线，输出等长的平均K线（time / volume 不变）。
 *   haClose = (o+h+l+c)/4；haOpen = 上一根 (haOpen+haClose)/2，首根 (o+c)/2；
 *   haHigh = max(h, haOpen, haClose)；haLow = min(l, haOpen, haClose)
 */
export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let po = 0;
  let pc = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const c = (b.open + b.high + b.low + b.close) / 4;
    const o = i === 0 ? (b.open + b.close) / 2 : (po + pc) / 2;
    out.push({
      time: b.time, open: o, close: c,
      high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), volume: b.volume,
    });
    po = o;
    pc = c;
  }
  return out;
}

/** 带标记线的渐变：最高收盘价处紫、最低收盘价处蓝，中间按纵向位置线性过渡（颜色取自设计稿） */
export const MARKER_TOP: [number, number, number] = [0x96, 0x37, 0xf3];
export const MARKER_BOTTOM: [number, number, number] = [0x2d, 0x9b, 0xd2];

/** t = 0 → 紫（最高），t = 1 → 蓝（最低）；越界夹紧；返回 `rgb(r,g,b)` */
export function markerColor(t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const c = MARKER_TOP.map((a, i) => Math.round(a + (MARKER_BOTTOM[i] - a) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** 成交量蜡烛的实体宽度（像素）：随成交量在 [20%, 100%] × 90% 的柱距之间线性变化，至少 1px */
export function volCandleWidth(volume: number, maxVolume: number, barW: number): number {
  const r = maxVolume > 0 ? Math.min(1, Math.max(0, volume / maxVolume)) : 1;
  return Math.max(1, Math.floor(barW * 0.9 * (0.2 + 0.8 * r)));
}

export interface ChartOptions {
  /** 图例里显示的标的 */
  symbol?: string;
  /** 图例里显示的周期 */
  timeframe?: string;
  /** 上涨颜色。默认 A 股习惯 #ef5350（红） */
  upColor?: string;
  /** 下跌颜色。默认 A 股习惯 #26a69a（绿） */
  downColor?: string;
  /** 主图样式，默认蜡烛 */
  style?: ChartStyle;
  /** 折线 / 面积的线色 */
  lineColor?: string;
  bgColor?: string;
  gridColor?: string;
  axisTextColor?: string;
  crossColor?: string;
  /** 右侧价格轴宽度（CSS 像素） */
  axisWidth?: number;
  /** 底部时间轴高度（CSS 像素） */
  axisHeight?: number;
  /** 成交量区占绘图高度的比例 */
  volumeRatio?: number;
  font?: string;
  /** 价格上下留白比例 */
  padding?: number;
  /** 图例主标题（标的/周期）的文字颜色 */
  titleColor?: string;
  /** 图例左边距。多图网格里要给左上角的编号徽章让位，所以做成可配的。 */
  legendInset?: number;
  /** 十字光标变化回调，参数是 bar 索引（移出画布为 null）。多图联动用。 */
  onCrosshair?: (index: number | null) => void;
  /** 视口变化回调，参数是当前可见的时间区间。多图联动用。 */
  onView?: (t0: number, t1: number) => void;
}

export interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
  w: number;
  h: number;
}

export interface Scale {
  min: number;
  max: number;
}

/** 一条叠加线（MA / BOLL 边）。`values[i]` 对应 `bars[i]`，不足处为 null。 */
export interface Line {
  name: string;
  color: string;
  values: (number | null)[];
  width: number;
  dash: number[];
}

export interface Band {
  mid: Line;
  upper: Line;
  lower: Line;
}

/**
 * 通道上那个小圆圈的规则。
 * 截图里那几个圆圈的确切语义我判断不了（出现频率远低于「碰带」，也未必是带宽极值），
 * 所以做成可切换的三种模式，让效果自己说话。
 */
export type MarkerMode = 'none' | 'touch' | 'extremum';

/**
 * 一条「通道」——上下轨 + 中轨 + 中间那片半透明填充。
 * 主流图表软件里 BB / 肯特纳 / 唐奇安 用的是同一套画法，所以抽象成一个东西。
 */
export interface Channel {
  id: string;
  /** 图例里的名字，例如 'BB' */
  name: string;
  /** 图例里的参数串，例如 '20 SMA close 2' */
  params: string;
  upper: Line;
  basis: Line;
  lower: Line;
  /** 上下轨之间的填充色（必须带 alpha，否则会把 K 线糊掉） */
  fill: string;
  marker: MarkerMode;
  /** extremum 模式的回看半径 */
  markerLookback: number;
  visible: boolean;
}

/**
 * 外部图层的接入点（绘图层走这里）。
 * `onDown` 返回 true = 这次点击被图层接管，**KChart 不再平移**。
 * 这条约定很重要：没有它，选个绘图工具就没法拖动画布了。
 */
export interface ChartHooks {
  onDown?(px: number, py: number, e: PointerEvent): boolean;
  onMove?(px: number, py: number, e: PointerEvent): void;
  onUp?(px: number, py: number, e: PointerEvent): void;
  /** 在绘图区裁剪内、十字光标之前调用 */
  onDraw?(ctx: CanvasRenderingContext2D): void;
}

/** 主题：只换背景/网格/文字/十字光标，不碰涨跌色（涨跌是 A 股习惯，不该跟着主题走）。 */
export const THEMES: { [k: string]: { bg: string; grid: string; axisText: string; cross: string; title: string; fill: string } } = {
  dark: {
    bg: '#0e1116',
    grid: 'rgba(255,255,255,0.055)',
    axisText: '#9aa4b2',
    cross: '#787b86',
    title: '#e6edf3',
    fill: 'rgba(120,160,255,0.13)',
  },
  light: {
    bg: '#ffffff',
    grid: 'rgba(0,0,0,0.07)',
    axisText: '#131722',
    cross: '#131722',
    title: '#131722',
    fill: 'rgba(41,98,255,0.10)',
  },
};

/** 用 BOLL(20,2) 的结果造一条 专业图表风格的通道。 */
export function makeBBChannel(bb: Band): Channel {
  return {
    id: 'bb',
    name: 'BB',
    params: '20 SMA close 2',
    upper: { name: 'UPPER', color: '#ef5350', values: bb.upper.values, width: 1.4, dash: [] },
    basis: { name: 'BASIS', color: '#4d7cff', values: bb.mid.values, width: 1.4, dash: [] },
    lower: { name: 'LOWER', color: '#26a69a', values: bb.lower.values, width: 1.4, dash: [] },
    fill: THEMES.dark.fill,
    marker: 'none',
    markerLookback: 4,
    visible: true,
  };
}

/* ===========================================================================
 * 2. 小工具
 * ========================================================================= */

export const DEFAULTS: Required<ChartOptions> = {
  symbol: 'DEMO',
  timeframe: '1D',
  upColor: '#ef5350',
  downColor: '#26a69a',
  style: 'candles',
  lineColor: '#2962ff',
  bgColor: '#0e1116',
  gridColor: 'rgba(255,255,255,0.055)',
  axisTextColor: '#9aa4b2',
  crossColor: '#787b86',
  axisWidth: 66,
  axisHeight: 26,
  volumeRatio: 0.22,
  font: '12px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  padding: 0.08,
  titleColor: '#e6edf3',
  legendInset: 12,
  onCrosshair: function (_i: number | null): void { /* 默认不做事 */ },
  onView: function (_t0: number, _t1: number): void { /* 默认不做事 */ },
};

/** '#rrggbb' → 'rgba(r,g,b,a)'；不是 6 位十六进制就原样返回（渐变会退化为纯色） */
export function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 把任意步长吸附到 1 / 2 / 5 × 10^k。
 * 这是所有「好看的」坐标轴刻度的来源。
 */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * p;
}

/** 简单移动平均。前 n-1 项为 null。 */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** 布林带 BOLL(n, k)。中轨 = SMA(n)，上下轨 = 中轨 ± k × 总体标准差。 */
export function bollinger(closes: number[], n: number, k: number): Band {
  const mid = sma(closes, n);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    const m = mid[i];
    if (m == null) continue;
    let acc = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = closes[j] - m;
      acc += d * d;
    }
    const sd = Math.sqrt(acc / n);
    upper[i] = m + k * sd;
    lower[i] = m - k * sd;
  }
  return {
    mid: { name: 'MID', color: '#c9d1d9', values: mid, width: 1, dash: [3, 3] },
    upper: { name: 'UP', color: '#7aa2f7', values: upper, width: 1, dash: [] },
    lower: { name: 'DN', color: '#7aa2f7', values: lower, width: 1, dash: [] },
  };
}

/**
 * 清洗行情数据：过滤非法值 → 按 open time 升序 → 同 time 去重（保留后者）。
 * 这三步任何一步漏掉，图会错，而且**不报错**。
 */
export function normalizeBars(input: Bar[]): Bar[] {
  const ok: Bar[] = [];
  for (const b of input) {
    if (!b) continue;
    if (!isFinite(b.time) || !isFinite(b.open) || !isFinite(b.high) ||
        !isFinite(b.low) || !isFinite(b.close)) continue;
    ok.push({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: isFinite(b.volume) ? b.volume : 0,
    });
  }
  ok.sort((a, b) => a.time - b.time);
  const out: Bar[] = [];
  for (const b of ok) {
    if (out.length && out[out.length - 1].time === b.time) out[out.length - 1] = b;
    else out.push(b);
  }
  return out;
}

/** 生成可复现的模拟日线（LCG 驱动的几何随机游走），跳过周末。 */
export function makeBars(count: number, seed: number, startPrice: number): Bar[] {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const bars: Bar[] = [];
  const d = new Date(2020, 0, 2, 9, 30, 0, 0);
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const drift = Math.sin(i / 55) * 0.0016 + 0.0004;
    const shock = (rnd() - 0.5) * 0.030;
    const open = price;
    const close = Math.max(0.5, open * (1 + drift + shock));
    const high = Math.max(open, close) * (1 + rnd() * 0.012);
    const low = Math.min(open, close) * (1 - rnd() * 0.012);
    const volume = Math.round(4_000_000 * (0.5 + rnd()) * (1 + Math.abs(shock) * 22));
    bars.push({ time: d.getTime(), open, high, low, close, volume });
    price = close;
    d.setDate(d.getDate() + 1);
  }
  return bars;
}

/** 把时间映射到所属「周 / 月 / 日」的桶编号 */
export function bucketKey(t: number, tf: string): number {
  const d = new Date(t);
  if (tf === '1W') {
    // 该周的周一（把周日算作上一周的末尾）
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    return Math.floor(monday.getTime() / 86400000);
  }
  if (tf === '1M') return d.getFullYear() * 12 + d.getMonth();
  return Math.floor(t / 86400000);
}

/**
 * 把日线合成更大周期。
 * 规矩：open 取该段**第一根**的 open，close 取**最后一根**的 close，
 * high/low 取段内极值，volume 求和，time 用该段第一根的开盘时间。
 * （把 close 写成第一根、或者 time 用最后时间，是这类函数最常见的两个错。）
 */
export function resample(bars: Bar[], tf: string): Bar[] {
  if (!bars.length || tf === '1D') return bars.slice();
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let key = -1;
  for (const b of bars) {
    const k = bucketKey(b.time, tf);
    if (!cur || k !== key) {
      if (cur) out.push(cur);
      cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      key = k;
    } else {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume += b.volume;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 底部那条显示范围。
 * ⚠️ 这**不是** K 线周期 —— 周期是「每根 bar 代表多久」（1D/1W/1M），
 * 范围是「视口覆盖多长时间」。两个维度正交：
 * 你可以在 1D 周期上看 1 年（365 根），也可以在 1W 周期上看 1 个月（约 4 根）。
 */
export interface RangeDef {
  key: string;
  label: string;
  /** 毫秒跨度；null 表示需要特殊计算（YTD / ALL） */
  ms: number | null;
}

export const RANGES: RangeDef[] = [
  { key: '1D', label: '1D', ms: 86400000 },
  { key: '7D', label: '7D', ms: 7 * 86400000 },
  { key: '1M', label: '1M', ms: 30 * 86400000 },
  { key: '3M', label: '3M', ms: 91 * 86400000 },
  { key: '6M', label: '6M', ms: 182 * 86400000 },
  { key: 'YTD', label: 'YTD', ms: null },
  { key: '1Y', label: '1Y', ms: 365 * 86400000 },
  { key: '5Y', label: '5Y', ms: 1825 * 86400000 },
  { key: 'ALL', label: 'ALL', ms: null },
];

/** 范围至少露出这么多根 —— 否则「1D」在日线图上只剩一根，图会难看 */
export const MIN_RANGE_BARS = 5;

/** 某个范围在给定数据上的起始时间；算不出来返回 NaN */
export function rangeStart(bars: Bar[], key: string): number {
  const n = bars.length;
  if (!n) return NaN;
  const last = bars[n - 1].time;
  if (key === 'YTD') {
    const d = new Date(last);
    return new Date(d.getFullYear(), 0, 1).getTime();
  }
  for (const r of RANGES) if (r.key === key && r.ms != null) return last - r.ms;
  return NaN;
}

/** 把日志同时写进 console 和页面上的 #log（headless --dump-dom 才能抓到）。 */
export function log(msg: string): void {
  const line = '[' + new Date().toISOString().slice(11, 23) + '] ' + msg;
  try {
    console.log(line);
  } catch (_e) { /* 忽略 */ }
  const el = typeof document !== 'undefined' ? document.getElementById('log') : null;
  if (el) {
    const div = document.createElement('div');
    div.textContent = line;
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }
}

export function fmtTime(t: number, spanDays: number): string {
  const d = new Date(t);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  if (spanDays > 400) return d.getFullYear() + '/' + p(d.getMonth() + 1);
  if (spanDays > 75) return p(d.getMonth() + 1) + '/' + p(d.getDate());
  return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export function decimalsFor(step: number): number {
  if (!(step > 0)) return 2;
  const d = Math.ceil(-Math.log10(step));
  return clamp(d, 0, 6);
}

/* ===========================================================================
 * 3. 图表核心
 * ========================================================================= */

export class KChart {
  readonly canvas: HTMLCanvasElement;
  bars: Bar[];

  // ↓ 这几个是内部状态，但自检(selfTest)与调试需要读，故不加 private。
  ctx: CanvasRenderingContext2D;
  view: { from: number; barW: number } = { from: 0, barW: 8 };
  scale: Scale = { min: 0, max: 1 };
  plot: Rect = { l: 0, t: 0, r: 0, b: 0, w: 0, h: 0 };
  W = 0;
  H = 0;
  dpr = 1;

  private o: Required<ChartOptions>;
  private priceStep = 1;

  /** 鼠标在本图上的原始位置（本地十字光标的横线 + 右轴价格标签用） */
  private pointer: { x: number; y: number } | null = null;
  /**
   * 由外部强制指定的十字光标 bar 索引 —— 多图联动走这里。
   * 为什么不是像素：两张图周期/缩放不同，像素 x 指的根本不是同一时刻。
   */
  private syncIndex: number | null = null;
  private dragging = false;
  private dragX = 0;

  /**
   * 回放期间保存的**完整**数据；null = 没在回放。
   * `bars` 在回放时是它的前缀（原地改写，外面拿着的数组引用不会变孤儿）。
   */
  private replayFull: Bar[] | null = null;

  private ma: Line[] = [];
  /** addLine() 加进来的通用叠加线（Pine 的 plot 输出走这里） */
  private extraLines: Line[] = [];
  /** addMarkers() 加进来的三角标记（Pine 的 plotshape 输出走这里） */
  private extraMarks: { index: number; price: number; color: string; text: string; above: boolean }[] = [];
  channels: Channel[] = [];

  /** 通过 setStudies() 加进来的指标（Pine v6 脚本的运行结果）：overlay 画主图，其余各占一个副图 */
  studies: Study[] = [];
  /** 指标图例上的按钮（设置 / 删除）：每次重绘重建，鼠标点击时据此命中 */
  private studyHits: { uid: string; action: 'settings' | 'remove'; x: number; y: number; w: number; h: number }[] = [];
  private studyHandler: ((uid: string, action: 'settings' | 'remove') => void) | null = null;

  private rafId = 0;
  private ac: AbortController;
  private ro: ResizeObserver | null = null;
  /** 外部图层（绘图层）的钩子 */
  private hooks: ChartHooks | null = null;

  /** 挂载外部图层。传 null 卸载。 */
  setHooks(h: ChartHooks | null): void {
    this.hooks = h;
  }

  constructor(target: HTMLCanvasElement | string, bars: Bar[], options: ChartOptions = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(el instanceof HTMLCanvasElement)) {
      throw new Error('KChart: 第一个参数必须是 <canvas> 或其选择器');
    }
    this.canvas = el;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('KChart: 无法获取 2d context');
    this.ctx = ctx;
    this.o = Object.assign({}, DEFAULTS, options);
    this.bars = normalizeBars(bars);
    this.ac = new AbortController();

    el.style.touchAction = 'none';
    el.style.cursor = 'crosshair';
    el.style.display = 'block';

    this.buildIndicators();
    this.bind();
    this.resize();
    this.showLast(180);
    if (this.bars.length) {
      log('KChart 初始化：' + this.bars.length + ' 根 bar，' +
          new Date(this.bars[0].time).toISOString().slice(0, 10) + ' → ' +
          new Date(this.bars[this.bars.length - 1].time).toISOString().slice(0, 10));
    } else {
      log('KChart 初始化：数据为空');
    }
  }

  /* ---------------------------------------------------------------- 指标 */

  /**
   * 全量重算叠加线。自检会调它（所以不是 private）。
   * ⚠️ 只重算 **values**，绝不重建通道对象 —— 否则每来一根实时 tick，
   * 用户设的颜色 / 填充 / marker 就被冲回默认值了。
   */
  buildIndicators(): void {
    const closes = this.bars.map((b) => b.close);
    this.ma = [
      { name: 'MA5', color: '#f5c542', values: sma(closes, 5), width: 1, dash: [] },
      { name: 'MA10', color: '#4dabf7', values: sma(closes, 10), width: 1, dash: [] },
      { name: 'MA20', color: '#b197fc', values: sma(closes, 20), width: 1, dash: [] },
    ];
    const bb = bollinger(closes, 20, 2);
    if (!this.channels.length) {
      this.channels.push(makeBBChannel(bb));
    } else {
      for (const ch of this.channels) {
        if (ch.id !== 'bb') continue;
        ch.upper.values = bb.upper.values;
        ch.basis.values = bb.mid.values;
        ch.lower.values = bb.lower.values;
      }
    }
    this.runStudies();
  }

  /* ------------------------------------------------------------- 指标（study） */

  /** 公开选项（只读）：副图 / 外部图层要跟主题取色 */
  opts(): Readonly<Required<ChartOptions>> {
    return this.o;
  }

  /**
   * 整体换一组指标定义（顺序即显示顺序）。每个指标在**本图的数据**上独立运行：
   * 同一个定义在日线图和 30 分钟图上结果不同，这是对的。
   * 回放时 bars 是截断后的前缀，所以指标天然只看得到「过去」。
   */
  setStudies(defs: StudyDef[]): void {
    this.studies = defs.map((def) => ({ def, output: null, error: null }));
    this.runStudies();
    this.plot = this.computePlot();
    this.clampView();
    this.invalidate();
  }

  studyList(): Study[] {
    return this.studies;
  }

  /** 指标图例上的按钮被点击时回调（设置 / 删除） */
  setStudyHandler(fn: ((uid: string, action: 'settings' | 'remove') => void) | null): void {
    this.studyHandler = fn;
  }

  private runStudies(): void {
    const run = getStudyRunner();
    for (const st of this.studies) {
      if (!run) {
        st.output = null;
        st.error = '指标引擎未就绪';
        continue;
      }
      try {
        st.output = run(st.def, this.bars, { symbol: this.o.symbol, timeframe: this.o.timeframe });
        st.error = null;
      } catch (e) {
        st.output = null;
        st.error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  /** 单个副图的高度（0 = 没有副图）。主图至少留 40%：副图总高度封顶在 60% */
  private paneHeight(): number {
    const k = paneStudies(this.studies).length;
    if (!k) return 0;
    const avail = Math.max(1, this.H - this.o.axisHeight - 6);
    const each = clamp(Math.round(avail * 0.22), 60, 200);
    return Math.max(24, Math.floor(Math.min(each * k, avail * 0.6) / k));
  }

  /** 每个副图占的矩形（从主图下沿往下依次排；最下面一个贴着时间轴） */
  paneRects(): { study: Study; rect: Rect }[] {
    const list = paneStudies(this.studies);
    const h = this.paneHeight();
    const p = this.plot;
    return list.map((study, j) => {
      const t = p.b + j * h;
      return { study, rect: { l: p.l, t, r: p.r, b: t + h, w: p.w, h } };
    });
  }

  /** 时间轴文字所在的纵坐标（时间轴永远贴着画布最底部，副图夹在主图与它之间） */
  private axisY(): number {
    return this.H - this.o.axisHeight / 2;
  }

  /* ------------------------------------------------------ 通用叠加线 API */

  /** 加一条通用叠加线（Pine 的 plot 输出就走这里）。返回同一个句柄。 */
  addLine(ln: Line): Line {
    this.extraLines.push(ln);
    this.invalidate();
    return ln;
  }

  /** 清掉所有 addLine 加进来的线（不动 MA / 通道） */
  clearLines(): void {
    this.extraLines.length = 0;
    this.invalidate();
  }

  /**
   * 打一批三角标记（Pine plotshape 的输出）。
   * `above` 为真画在价格上方（死叉/卖出），否则画在下方（金叉/买入）。
   */
  addMarkers(list: { index: number; price: number; color: string; text: string; above: boolean }[]): void {
    for (const m of list) this.extraMarks.push(m);
    this.invalidate();
  }

  clearMarks(): void {
    this.extraMarks.length = 0;
    this.invalidate();
  }

  /** 当前参与自动缩放与绘制的所有叠加线 */
  activeLines(): Line[] {
    const out: Line[] = this.ma.slice();
    for (const ch of this.channels) {
      if (!ch.visible) continue;
      out.push(ch.upper, ch.basis, ch.lower);
    }
    for (const ln of this.extraLines) out.push(ln);
    return out;
  }

  /* ------------------------------------------------------------- 通道 API */

  /** 加一条通道。上下轨/中轨都是 `(number|null)[]`，长度对齐 bars。 */
  addChannel(cfg: Partial<Channel> & { upper: Line; basis: Line; lower: Line }): Channel {
    const ch: Channel = {
      id: cfg.id || 'ch' + (this.channels.length + 1),
      name: cfg.name || 'CHANNEL',
      params: cfg.params || '',
      upper: cfg.upper,
      basis: cfg.basis,
      lower: cfg.lower,
      fill: cfg.fill || THEMES.dark.fill,
      marker: cfg.marker || 'none',
      markerLookback: cfg.markerLookback == null ? 4 : cfg.markerLookback,
      visible: cfg.visible !== false,
    };
    this.channels.push(ch);
    this.invalidate();
    return ch;
  }

  setChannelVisible(id: string, on: boolean): void {
    for (const ch of this.channels) if (ch.id === id) ch.visible = !!on;
    this.invalidate();
  }

  /**
   * 切换通道上小圆圈的规则：
   *   'none'     不画
   *   'touch'    high 触及上轨 / low 触及下轨
   *   'extremum' 上轨的局部极大 / 下轨的局部极小
   */
  setChannelMarker(id: string, mode: MarkerMode): void {
    for (const ch of this.channels) if (ch.id === id) ch.marker = mode;
    this.invalidate();
  }

  channelMarkers(): { id: string; marker: MarkerMode }[] {
    return this.channels.map((c) => ({ id: c.id, marker: c.marker }));
  }

  channelsVisible(): number {
    let n = 0;
    for (const ch of this.channels) if (ch.visible) n++;
    return n;
  }

  /* ---------------------------------------------------------------- 主图样式 */

  setStyle(style: ChartStyle): void {
    if (!CHART_STYLES.includes(style) || style === this.o.style) return;
    this.o.style = style;
    this.invalidate();
  }

  style(): ChartStyle {
    return this.o.style;
  }

  /** 当前涨跌色（自检与外部图层用） */
  colors(): { up: string; down: string } {
    return { up: this.o.upColor, down: this.o.downColor };
  }

  /** 折线族只看收盘价，价格轴也只按收盘价取范围 */
  private closeOnly(): boolean {
    return CLOSE_ONLY_STYLES.has(this.o.style);
  }

  /** 平均K线缓存：按 (数组, 长度, 首根时间, 末根 OHLC) 判断是否失效，实时 tick 改最后一根也能刷新 */
  private haKey = '';
  private haCache: Bar[] = [];
  private haBars(): Bar[] {
    const n = this.bars.length;
    const l = n ? this.bars[n - 1] : null;
    const key = n + '|' + (n ? this.bars[0].time : 0) + '|' + (l ? l.open + ',' + l.high + ',' + l.low + ',' + l.close : '');
    if (key !== this.haKey) {
      this.haCache = heikinAshi(this.bars);
      this.haKey = key;
    }
    return this.haCache;
  }

  /** 基准线样式的基准价 = 可见范围收盘价的中点；最近一次绘制时更新（供自检 / 外部读取） */
  private baselineValue: number | null = null;
  baselinePrice(): number | null {
    return this.baselineValue;
  }

  /* ---------------------------------------------------------------- 主题 */

  setTheme(name: string): void {
    const t = THEMES[name] || THEMES.dark;
    this.o.bgColor = t.bg;
    this.o.gridColor = t.grid;
    this.o.axisTextColor = t.axisText;
    this.o.crossColor = t.cross;
    this.o.titleColor = t.title;
    for (const ch of this.channels) ch.fill = t.fill;
    this.invalidate();
  }

  /* --------------------------------------------- 多图联动 / 时间轴对齐 */

  /** 二分：返回 time <= t 的最后一根的下标（空数据返回 -1） */
  indexAtTime(t: number): number {
    const b = this.bars;
    if (!b.length) return -1;
    let lo = 0;
    let hi = b.length - 1;
    let res = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (b[mid].time <= t) { res = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return res;
  }

  /* ------------------------------------------------------- 回放（Bar Replay） */

  /**
   * 只显示前 k 根（k = null 退出回放、恢复全部）。
   * 指标 / 通道按截断后的序列**全量重算**，所以与「直接喂前 k 根」逐值一致，不泄露未来。
   * 保持视口：最新一根跑出右边缘就把视口往右带，退回时最新一根跑出左边缘就往左带。
   */
  setReplayCount(k: number | null): void {
    if (k === null) {
      if (!this.replayFull) return;
      const full = this.replayFull;
      this.replayFull = null;
      this.bars.length = 0;
      for (const b of full) this.bars.push(b);
      this.syncIndex = null;
      this.buildIndicators();
      this.clampView();
      this.notifyView();
      this.invalidate();
      return;
    }
    if (!this.replayFull) this.replayFull = this.bars.slice();
    const full = this.replayFull;
    if (!full.length) return;
    const cnt = clamp(Math.round(k), 1, full.length);
    this.bars.length = 0;
    for (let i = 0; i < cnt; i++) this.bars.push(full[i]);
    this.syncIndex = null;
    this.buildIndicators();
    const vis = this.plot.w / this.view.barW;
    if (cnt > this.view.from + vis - 2) this.view.from = cnt - vis + 3; // 右边留 3 根的余量
    else if (cnt - 1 < this.view.from) this.view.from = cnt - vis * 0.5;
    this.clampView();
    this.notifyView();
    this.invalidate();
  }

  /** 回放中返回当前显示的根数，否则 null */
  replayCount(): number | null {
    return this.replayFull ? this.bars.length : null;
  }

  /** 完整数据的根数（回放时 ≠ bars.length） */
  fullBarCount(): number {
    return this.replayFull ? this.replayFull.length : this.bars.length;
  }

  /** 视口正中间那一根的下标（回放默认从这里开始），夹在 [0, n-1] */
  centerIndex(): number {
    const n = this.bars.length;
    if (!n) return -1;
    return clamp(Math.round(this.view.from + this.plot.w / this.view.barW / 2), 0, n - 1);
  }

  /** 当前视口左右边缘对应的时间。空数据返回 null。 */
  viewTimes(): [number, number] | null {
    const n = this.bars.length;
    if (!n) return null;
    const vis = this.plot.w / this.view.barW;
    const i0 = clamp(Math.round(this.view.from), 0, n - 1);
    const i1 = clamp(Math.round(this.view.from + vis), 0, n - 1);
    return [this.bars[i0].time, this.bars[i1].time];
  }

  /**
   * 让视口覆盖 [t0, t1] 这段时间 —— 多图联动的正解。
   * 按**时间**对齐，不按像素：两张图周期不同（1D vs 1W）或缩放不同时，
   * 同一个像素 x 指的根本不是同一时刻，按像素同步会让十字光标彻底错位。
   *
   * 注意靠数据边缘时 clampView 会夹住，所以两图不可能 100% 对齐 —— 这是对的。
   */
  setViewTimes(t0: number, t1: number): void {
    const n = this.bars.length;
    if (!n || !(t1 > t0)) return;
    const a = this.indexAtTime(t0);
    const b = this.indexAtTime(t1);
    const span = Math.max(1, b - a + 1);
    this.view.barW = clamp(this.plot.w / span, 1, 60);
    this.view.from = a;
    this.clampView();
    this.invalidate();
  }

  /**
   * 当前绘图区最多能同时显示多少根（barW 有 1px 下限，所以 = 绘图区像素宽）。
   * 小格子（比如 4×4 布局）里这个数可能只有一两百。
   */
  maxVisibleBars(): number {
    return Math.max(1, Math.floor(this.plot.w / 1));
  }

  /**
   * 让 [t0, t1] 可见，**装不下时靠右对齐 t1**（保证最新一端在屏幕里）。返回 false 表示装不下、被截成了右侧一段。
   *
   * 为什么不直接用 setViewTimes：它以 t0 为左边缘往右铺，目标区间比视口宽时（barW 已经压到 1px 下限），
   * 会**静默只显示左侧一段**，t1 在屏幕外 —— 点「1M」却看到最老的那一截。
   * 这里的做法与 setRange 的夹紧哲学一致：宁可丢掉最老的一段，也要让最新的一根可见。
   * 不触发视图回调，由调用方决定是否广播。
   */
  revealSpan(t0: number, t1: number): boolean {
    const n = this.bars.length;
    if (!n || !(t1 > t0)) return false;
    this.setViewTimes(t0, t1);
    const b = this.indexAtTime(t1);
    const vis = Math.floor(this.plot.w / this.view.barW);
    if (this.view.from + vis >= b) return true;
    this.view.from = b + 1 - this.plot.w / this.view.barW;
    this.clampView();
    this.invalidate();
    return false;
  }

  /** 外部指定十字光标（多图联动）。传 null 清除。 */
  setSyncIndex(i: number | null): void {
    const v = i == null ? null : clamp(i, 0, Math.max(0, this.bars.length - 1));
    if (this.syncIndex === v) return;
    this.syncIndex = v;
    this.invalidate();
  }

  /** 当前十字光标锁定的 bar 索引（本地鼠标 / 外部同步，谁有算谁） */
  crosshairIndex(): number | null {
    return this.snapIndex();
  }

  private notifyCrosshair(): void {
    this.o.onCrosshair(this.snapIndex());
  }

  private notifyView(): void {
    const vt = this.viewTimes();
    if (vt) this.o.onView(vt[0], vt[1]);
  }

  /**
   * 换数据 / 换周期。
   * 原地改写 `this.bars`（`length = 0` + push）而不是整个换数组 ——
   * 外面可能已经拿了这个数组的引用（比如自检里的 `const bars = chart.bars`），
   * 换数组会让那些引用变成孤儿，指着一份再也不会更新的旧数据。
   */
  setBars(bars: Bar[], meta?: { symbol?: string; timeframe?: string }): void {
    const clean = normalizeBars(bars);
    this.replayFull = null; // 换数据 = 回放作废，旧的完整数据已经不是这个标的 / 周期的了
    this.bars.length = 0;
    for (const b of clean) this.bars.push(b);
    if (meta) {
      if (meta.symbol) this.o.symbol = meta.symbol;
      if (meta.timeframe) this.o.timeframe = meta.timeframe;
    }
    this.syncIndex = null;
    this.buildIndicators();
    this.showLast(180);
    this.invalidate();
  }

  /* ------------------------------------------------- 显示范围（底部条） */

  /**
   * 设置显示范围。返回 false 表示**数据不够长**，已经退化成「从头开始」。
   * 调用方（底部那排按钮）应该据此把按钮置灰。
   */
  setRange(key: string): boolean {
    const n = this.bars.length;
    if (!n) return false;
    if (key === 'ALL') {
      this.fitContent();
      return true;
    }
    const t0raw = rangeStart(this.bars, key);
    if (!isFinite(t0raw)) return false;
    let i0 = this.indexAtTime(t0raw);
    if (i0 <= 0) {
      this.fitContent();
      return false;
    }
    if (n - i0 < MIN_RANGE_BARS) i0 = Math.max(0, n - MIN_RANGE_BARS);
    // 整段范围装不下时 revealSpan 会靠右对齐，保证最新一根可见（README §7⑦）
    this.revealSpan(this.bars[i0].time, this.bars[n - 1].time);
    this.notifyView();
    return true;
  }

  /** 当前数据够不够长来满足这个范围（用来把越界的按钮置灰） */
  rangeAvailable(key: string): boolean {
    const n = this.bars.length;
    if (!n) return false;
    if (key === 'ALL') return true;
    const t0 = rangeStart(this.bars, key);
    if (!isFinite(t0)) return false;
    return t0 > this.bars[0].time;
  }

  /** 当前视口覆盖的时间跨度（毫秒） */
  viewSpan(): number {
    const vt = this.viewTimes();
    return vt ? vt[1] - vt[0] : 0;
  }

  /* ------------------------------------------------------- 坐标变换核心 */

  /** 当前可见的 bar 索引区间 [i0, i1]（含端点，可能越界） */
  visible(): [number, number] {
    const i0 = Math.floor(this.view.from);
    const i1 = Math.ceil(this.view.from + this.plot.w / this.view.barW);
    return [i0, i1];
  }

  /** bar 索引 → 该 bar 左边缘的像素 x */
  xOf(i: number): number {
    return this.plot.l + (i - this.view.from) * this.view.barW;
  }

  /** bar 索引 → 该 bar 中心的像素 x */
  xCenter(i: number): number {
    return this.xOf(i) + this.view.barW / 2;
  }

  /** 像素 x → bar 索引（小数） */
  iOf(px: number): number {
    return this.view.from + (px - this.plot.l) / this.view.barW;
  }

  /** 价格 → 像素 y */
  yOf(price: number): number {
    const s = this.scale;
    const span = s.max - s.min || 1;
    return this.plot.t + ((s.max - price) / span) * this.plot.h;
  }

  /** 像素 y → 价格 */
  pOf(py: number): number {
    const s = this.scale;
    const span = s.max - s.min || 1;
    return s.max - ((py - this.plot.t) / this.plot.h) * span;
  }

  /* ------------------------------------------------------------ 视口操作 */

  private computePlot(): Rect {
    const l = 0;
    const t = 6;
    const r = Math.max(1, this.W - this.o.axisWidth);
    const panes = paneStudies(this.studies).length * this.paneHeight();
    const b = Math.max(t + 1, this.H - this.o.axisHeight - panes);
    return { l, t, r, b, w: Math.max(1, r - l), h: Math.max(1, b - t) };
  }

  /** 把 from 夹在合理范围内，保证不会把图拖到天边 */
  private clampView(): void {
    const vis = this.plot.w / this.view.barW;
    if (this.bars.length <= vis) {
      this.view.from = this.bars.length - vis;
      return;
    }
    const minFrom = -vis * 0.25;
    const maxFrom = Math.max(minFrom, this.bars.length - vis * 0.25);
    this.view.from = clamp(this.view.from, minFrom, maxFrom);
  }

  /** 显示最近 k 根 */
  showLast(k: number): void {
    const n = this.bars.length;
    if (!n) return;
    this.view.barW = clamp(this.plot.w / Math.max(1, k), 1, 60);
    this.view.from = n - this.plot.w / this.view.barW;
    this.clampView();
    this.notifyView();
    this.invalidate();
  }

  /** 全部塞进视口 */
  fitContent(): void {
    const n = this.bars.length;
    if (!n) return;
    this.view.barW = clamp(this.plot.w / n, 1, 60);
    this.view.from = Math.max(0, n - this.plot.w / this.view.barW);
    this.clampView();
    this.notifyView();
    this.invalidate();
  }

  /**
   * 以像素位置 `px` 为锚点缩放 `k` 倍。
   * 不变量：**锚点下的 bar 索引在缩放前后完全不变** —— 这是手感的关键，
   * 也是自检里唯一一条真正的行为断言。
   */
  zoomAt(px: number, k: number): void {
    const anchor = this.iOf(px);
    const next = clamp(this.view.barW * k, 1, 60);
    if (next === this.view.barW) return;
    this.view.barW = next;
    this.view.from = anchor - (px - this.plot.l) / next;
    this.clampView();
    this.notifyView();
    this.invalidate();
  }

  /* ------------------------------------------------------------- 事件 */

  private bind(): void {
    const c = this.canvas;
    const sig = { signal: this.ac.signal };

    c.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = e.deltaY * unit;
      if (!dy) return;
      this.zoomAt(e.offsetX, Math.exp(-dy * 0.0012));
    }, Object.assign({ passive: false }, sig));

    c.addEventListener('pointerdown', (e: PointerEvent) => {
      const px = e.offsetX;
      const py = e.offsetY;
      try { c.setPointerCapture(e.pointerId); } catch (_e) { /* 忽略 */ }
      this.pointer = { x: px, y: py };
      // 指标图例上的按钮先挑
      const btn = this.hitStudyButton(px, py);
      if (btn) {
        if (this.studyHandler) this.studyHandler(btn.uid, btn.action);
        this.invalidate();
        return;
      }
      // 外部图层先挑：它接管了这次点击，本图就不平移。副图区域不交给绘图层（那里的坐标不是价格）
      const taken = py < this.plot.b && !!(this.hooks && this.hooks.onDown && this.hooks.onDown(px, py, e));
      if (!taken) {
        this.dragging = true;
        this.dragX = e.clientX;
      }
      this.invalidate();
    }, sig);

    c.addEventListener('pointermove', (e: PointerEvent) => {
      const px = e.offsetX;
      const py = e.offsetY;
      if (py < this.plot.b && this.hooks && this.hooks.onMove) this.hooks.onMove(px, py, e);
      c.style.cursor = this.hitStudyButton(px, py) ? 'pointer' : 'crosshair';
      if (this.dragging) {
        const dx = e.clientX - this.dragX;
        this.dragX = e.clientX;
        this.view.from -= dx / this.view.barW;
        this.clampView();
        this.notifyView();
      }
      this.pointer = { x: px, y: py };
      this.notifyCrosshair();
      this.invalidate();
    }, sig);

    const endDrag = (e: PointerEvent) => {
      if (this.hooks && this.hooks.onUp) this.hooks.onUp(e.offsetX, e.offsetY, e);
      if (!this.dragging) return;
      this.dragging = false;
      try { c.releasePointerCapture(e.pointerId); } catch (_e) { /* 忽略 */ }
    };
    c.addEventListener('pointerup', endDrag, sig);
    c.addEventListener('pointercancel', endDrag, sig);

    c.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.notifyCrosshair();
      this.invalidate();
    }, sig);

    c.addEventListener('dblclick', () => this.fitContent(), sig);

    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(c);
    } else {
      window.addEventListener('resize', () => this.resize(), sig);
    }
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 800));
    const h = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 400));
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.W = w;
    this.H = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.plot = this.computePlot();
    this.clampView();
    this.invalidate();
  }

  dispose(): void {
    this.ac.abort();
    if (this.ro) this.ro.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  /* ----------------------------------------------------------- 实时更新 */

  /**
   * 推送一根 bar。同 time = 更新最后一根（forming candle），
   * 更大 time = 追加新的一根。这是实时行情的唯一入口。
   */
  update(bar: Bar): void {
    // 回放中：实时行情只更新完整数据，不动正在回放的画面（否则会把「未来」漏进来）
    if (this.replayFull) {
      const full = this.replayFull;
      const m = full.length;
      if (m && bar.time === full[m - 1].time) full[m - 1] = bar;
      else if (!m || bar.time > full[m - 1].time) full.push(bar);
      return;
    }
    const n = this.bars.length;
    if (n && bar.time === this.bars[n - 1].time) {
      this.bars[n - 1] = bar;
    } else if (!n || bar.time > this.bars[n - 1].time) {
      this.bars.push(bar);
    } else {
      log('update() 忽略了一根乱序 bar: ' + new Date(bar.time).toISOString());
      return;
    }
    // 800 根全量重算 < 1ms。生产环境应该只增量重算尾部。
    this.buildIndicators();
    const vis = this.plot.w / this.view.barW;
    if (n && this.view.from + vis >= n - 1.5) this.view.from = this.bars.length - vis;
    this.clampView();
    this.invalidate();
  }

  /* -------------------------------------------------------------- 渲染 */

  invalidate(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.draw();
    });
  }

  /** 同步重绘：绕开 rAF 合帧。自检 / 截图 / 需要立刻拿到像素时用。 */
  drawNow(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.draw();
  }

  private priceTicks(): number[] {
    const s = this.scale;
    const target = Math.max(2, Math.round(this.plot.h / 62));
    const step = niceStep((s.max - s.min) / target);
    this.priceStep = step;
    const out: number[] = [];
    const first = Math.ceil(s.min / step);
    for (let k = 0; k < 60; k++) {
      const v = (first + k) * step;
      if (v > s.max) break;
      out.push(v);
    }
    return out;
  }

  private timeTicks(i0: number, i1: number): number[] {
    const per = Math.max(1, Math.ceil(78 / this.view.barW));
    const out: number[] = [];
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    for (let i = Math.ceil(lo / per) * per; i <= hi; i += per) out.push(i);
    return out;
  }

  private computeScale(): Scale {
    const [i0, i1] = this.visible();
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    let min = Infinity;
    let max = -Infinity;
    const src = this.o.style === 'heikin' ? this.haBars() : this.bars;
    for (let i = lo; i <= hi; i++) {
      const b = src[i];
      const lowV = this.closeOnly() ? b.close : b.low;
      const highV = this.closeOnly() ? b.close : b.high;
      if (lowV < min) min = lowV;
      if (highV > max) max = highV;
    }
    for (const ln of this.activeLines()) {
      for (let i = lo; i <= hi; i++) {
        const v = ln.values[i];
        if (v == null) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    for (const st of this.studies) {
      if (!st.output || !st.output.overlay) continue;
      for (const pl of st.output.plots) {
        if (pl.hidden) continue;
        for (let i = lo; i <= hi; i++) {
          const v = pl.values[i];
          if (v == null) continue;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
    }
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
    if (max - min < 1e-9) { max = min + 1; }
    const pad = (max - min) * this.o.padding;
    return { min: min - pad, max: max + pad };
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.o.bgColor;
    ctx.fillRect(0, 0, this.W, this.H);

    this.plot = this.computePlot();
    this.scale = this.computeScale();
    const [i0, i1] = this.visible();
    const p = this.plot;

    this.drawGrid(i0, i1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.l, p.t, p.w, p.h);
    ctx.clip();
    this.drawChannelFills(i0, i1);   // 最底层：通道填充
    this.drawVolume(i0, i1);         // 成交量压在填充上，不然会被染上一层
    this.drawSeries(i0, i1);
    this.drawLines(i0, i1);          // MA
    this.drawChannelLines(i0, i1);   // 通道线在 K 线上面
    this.drawOverlayStudies(i0, i1); // Pine v6 指标（overlay=true）
    this.drawMarks();                // Pine plotshape 打点
    if (this.hooks && this.hooks.onDraw) this.hooks.onDraw(ctx);   // 外部图层（绘图工具）
    this.drawCrosshairV();
    ctx.restore();

    this.studyHits = [];
    this.drawPriceAxis();
    this.drawStudyPanes(i0, i1);
    this.drawTimeAxis(i0, i1);
    this.drawLastPrice();
    this.drawCrosshairLabels(i0, i1);
    this.drawLegend(i0, i1);
    this.drawPaneLegends(i1);
  }

  /** 主图几何（给 drawStudyOutput 用） */
  private mainGeom(i0: number, i1: number): StudyGeom {
    const p = this.plot;
    return {
      l: p.l, r: p.r, t: p.t, b: p.b, barW: this.view.barW,
      xCenter: (i) => this.xCenter(i), yOf: (v) => this.yOf(v), i0, i1: Math.min(this.bars.length - 1, i1),
    };
  }

  private drawOverlayStudies(i0: number, i1: number): void {
    const g = this.mainGeom(i0, i1);
    for (const st of this.studies) {
      if (st.output && st.output.overlay) drawStudyOutput(this.ctx, st.output, g);
    }
  }

  /** 副图：每个 overlay=false 的指标一块。网格 / 图形 / 纵轴 / 十字线都在这里，图例在 drawPaneLegends */
  private drawStudyPanes(i0: number, i1: number): void {
    const ctx = this.ctx;
    const p = this.plot;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    if (hi < lo) return;
    const idx = this.snapIndex();
    for (const { study, rect } of this.paneRects()) {
      const out = study.output;
      if (!out) continue;
      const sc = paneScale(out, lo, hi);
      const span = sc.max - sc.min || 1;
      const yOf = (v: number): number => rect.t + ((sc.max - v) / span) * rect.h;
      const { ticks, step } = paneTicks(sc.min, sc.max, rect.h);

      // 分隔线（压在主图 / 上一个副图的下沿）
      ctx.strokeStyle = this.o.axisTextColor;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(rect.t) + 0.5);
      ctx.lineTo(this.W, Math.round(rect.t) + 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 网格
      ctx.strokeStyle = this.o.gridColor;
      ctx.beginPath();
      for (const v of ticks) {
        const y = Math.round(yOf(v)) + 0.5;
        if (y <= rect.t + 2 || y >= rect.b - 1) continue;
        ctx.moveTo(rect.l, y);
        ctx.lineTo(rect.r, y);
      }
      for (const i of this.timeTicks(i0, i1)) {
        const x = Math.round(this.xCenter(i)) + 0.5;
        if (x < rect.l || x > rect.r) continue;
        ctx.moveTo(x, rect.t);
        ctx.lineTo(x, rect.b);
      }
      ctx.stroke();

      // 图形
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.l, rect.t + 1, rect.w, rect.h - 1);
      ctx.clip();
      drawStudyOutput(ctx, out, {
        l: rect.l, r: rect.r, t: rect.t + 1, b: rect.b, barW: this.view.barW,
        xCenter: (i) => this.xCenter(i), yOf, i0: lo, i1: hi,
      });
      if (idx != null) {
        const x = Math.round(this.xCenter(idx)) + 0.5;
        ctx.strokeStyle = this.o.crossColor;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, rect.t);
        ctx.lineTo(x, rect.b);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 本地鼠标在这个副图里：横向十字线
      const ptr = this.pointer;
      if (ptr && ptr.y > rect.t && ptr.y < rect.b) {
        ctx.strokeStyle = this.o.crossColor;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(rect.l, Math.round(ptr.y) + 0.5);
        ctx.lineTo(rect.r, Math.round(ptr.y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();

      // 纵轴刻度
      ctx.font = this.o.font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.o.axisTextColor;
      for (const v of ticks) {
        const y = yOf(v);
        if (y < rect.t + 8 || y > rect.b - 6) continue;
        ctx.fillText(fmtStudyValue(v, step), p.r + 8, Math.round(y));
      }
      // 鼠标处的数值标签（反色）
      if (ptr && ptr.y > rect.t && ptr.y < rect.b) {
        const v = sc.max - ((ptr.y - rect.t) / rect.h) * span;
        const label = fmtStudyValue(v, step / 10);
        const tw = ctx.measureText(label).width;
        const bw = Math.max(this.o.axisWidth - 4, tw + 12);
        const y = Math.round(ptr.y);
        ctx.fillStyle = this.o.crossColor;
        ctx.fillRect(p.r + 2, y - 9, bw, 18);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, p.r + 8, y);
      }
    }
    // 价格轴竖线延伸到最底下一个副图
    if (paneStudies(this.studies).length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath();
      ctx.moveTo(p.r + 0.5, p.b);
      ctx.lineTo(p.r + 0.5, this.H - this.o.axisHeight);
      ctx.stroke();
    }
  }

  /** 一个指标的图例行：名称 (参数) 各条线当前值 [设置][删除]。`hover` 为真才画按钮 */
  private drawStudyRow(st: Study, x0: number, y: number, i: number, hover: boolean): void {
    const ctx = this.ctx;
    let x = x0;
    const put = (text: string, fill: string, gap: number): void => {
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width + gap;
    };
    ctx.font = this.o.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    put(st.def.short || st.def.name, this.o.titleColor, 6);
    if (st.output) {
      const params = studyParamsText(st.output);
      if (params) put('(' + params + ')', this.o.axisTextColor, 10);
      for (const pl of st.output.plots) {
        if (pl.hidden) continue;
        const v = pl.values[i];
        put(fmtStudyValue(v), pl.colors[i] || pl.color, 10);
      }
    } else if (st.error) {
      put('⚠ ' + (st.error.length > 46 ? st.error.slice(0, 46) + '…' : st.error), '#f23645', 10);
    }
    if (!hover) return;
    // 按钮：设置（⚙）/ 删除（✕）。16×16 的小圆角块，放在文字后面
    const btn = (label: string, action: 'settings' | 'remove'): void => {
      const bx = Math.round(x);
      const by = Math.round(y - 8);
      ctx.fillStyle = 'rgba(120,123,134,0.28)';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(bx, by, 16, 16, 3) : ctx.rect(bx, by, 16, 16);
      ctx.fill();
      ctx.fillStyle = this.o.titleColor;
      ctx.textAlign = 'center';
      ctx.fillText(label, bx + 8, by + 8.5);
      ctx.textAlign = 'left';
      this.studyHits.push({ uid: st.def.uid, action, x: bx, y: by, w: 16, h: 16 });
      x += 20;
    };
    btn('⚙', 'settings');
    btn('✕', 'remove');
  }

  /** 副图图例：每个副图左上角一行 */
  private drawPaneLegends(i1: number): void {
    const n = this.bars.length;
    if (!n) return;
    const idx = this.snapIndex();
    const i = idx == null ? Math.min(n - 1, i1) : idx;
    const ptr = this.pointer;
    for (const { study, rect } of this.paneRects()) {
      const hover = !!ptr && ptr.y > rect.t && ptr.y < rect.b;
      this.drawStudyRow(study, rect.l + this.o.legendInset, rect.t + 12, i, hover);
    }
  }

  /** 点中了指标图例上的哪个按钮（没点中返回 null） */
  private hitStudyButton(px: number, py: number): { uid: string; action: 'settings' | 'remove' } | null {
    for (const h of this.studyHits) {
      if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return { uid: h.uid, action: h.action };
    }
    return null;
  }

  private drawGrid(i0: number, i1: number): void {
    const ctx = this.ctx;
    const p = this.plot;
    ctx.strokeStyle = this.o.gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const v of this.priceTicks()) {
      const y = Math.round(this.yOf(v)) + 0.5;
      if (y < p.t || y > p.b) continue;
      ctx.moveTo(p.l, y);
      ctx.lineTo(p.r, y);
    }
    for (const i of this.timeTicks(i0, i1)) {
      const x = Math.round(this.xCenter(i)) + 0.5;
      if (x < p.l || x > p.r) continue;
      ctx.moveTo(x, p.t);
      ctx.lineTo(x, p.b);
    }
    ctx.stroke();
  }

  private volRect(): Rect {
    const p = this.plot;
    const h = p.h * this.o.volumeRatio;
    return { l: p.l, t: p.b - h, r: p.r, b: p.b, w: p.w, h };
  }

  private drawVolume(i0: number, i1: number): void {
    const ctx = this.ctx;
    const v = this.volRect();
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    let maxV = 0;
    for (let i = lo; i <= hi; i++) if (this.bars[i].volume > maxV) maxV = this.bars[i].volume;
    if (maxV <= 0) return;

    ctx.globalAlpha = 0.55;
    const bw = Math.max(1, Math.floor(this.view.barW * 0.7));
    for (let i = lo; i <= hi; i++) {
      const b = this.bars[i];
      const h = (b.volume / maxV) * v.h;
      const x = Math.round(this.xCenter(i) - bw / 2);
      ctx.fillStyle = b.close >= b.open ? this.o.upColor : this.o.downColor;
      ctx.fillRect(x, v.b - h, bw, h);
    }
    ctx.globalAlpha = 1;
  }

  /**
   * 通道填充。**画在 K 线后面** —— 半透明色压在蜡烛上会把 K 线糊掉。
   */
  private drawChannelFills(i0: number, i1: number): void {
    const ctx = this.ctx;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    for (const ch of this.channels) {
      if (!ch.visible) continue;
      const up = ch.upper.values;
      const dn = ch.lower.values;
      for (const run of this.channelRuns(ch, lo, hi)) {
        ctx.beginPath();
        for (let i = run[0]; i <= run[1]; i++) {
          const x = this.xCenter(i);
          const y = this.yOf(up[i] as number);
          if (i === run[0]) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        for (let i = run[1]; i >= run[0]; i--) {
          ctx.lineTo(this.xCenter(i), this.yOf(dn[i] as number));
        }
        ctx.closePath();
        ctx.fillStyle = ch.fill;
        ctx.fill();
      }
    }
  }

  /** 通道的三条线 + 小圆圈。**画在 K 线上面**。 */
  private drawChannelLines(i0: number, i1: number): void {
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    for (const ch of this.channels) {
      if (!ch.visible) continue;
      this.strokeLine(ch.upper, lo, hi);
      this.strokeLine(ch.basis, lo, hi);
      this.strokeLine(ch.lower, lo, hi);
      if (ch.marker !== 'none') this.drawChannelMarkers(ch, lo, hi);
    }
  }

  /**
   * 把可见区间切成「上下轨都非 null」的连续段。
   * 不能整段走一条路径 —— 指标前 n-1 根是 null（样本不足），中间也可能有缺口；
   * 不切段的话填充会横跨缺口，画出一片根本不存在的区域。
   */
  channelRuns(ch: Channel, lo: number, hi: number): [number, number][] {
    const runs: [number, number][] = [];
    let start = -1;
    for (let i = lo; i <= hi; i++) {
      const ok = ch.upper.values[i] != null && ch.lower.values[i] != null;
      if (ok && start < 0) start = i;
      if (start >= 0 && (!ok || i === hi)) {
        runs.push([start, ok ? i : i - 1]);
        start = -1;
      }
    }
    return runs;
  }

  /** 画单条折线，null 处断开 */
  private strokeLine(ln: Line, lo: number, hi: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.strokeStyle = ln.color;
    ctx.lineWidth = ln.width;
    ctx.setLineDash(ln.dash);
    let started = false;
    for (let i = lo; i <= hi; i++) {
      const v = ln.values[i];
      if (v == null) { started = false; continue; }
      const x = this.xCenter(i);
      const y = this.yOf(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * 通道上的小圆圈。
   * ⚠️ 截图里那几个圆圈的确切规则我判断不了（出现频率远低于「碰带」，
   * 也不像带宽极值），所以给出两种可切换的实现，让效果自己说话。
   */
  private drawChannelMarkers(ch: Channel, lo: number, hi: number): void {
    const up = ch.upper.values;
    const dn = ch.lower.values;
    const k = Math.max(1, ch.markerLookback);
    for (let i = lo; i <= hi; i++) {
      const u = up[i];
      const l = dn[i];
      if (u == null || l == null) continue;
      if (ch.marker === 'touch') {
        const b = this.bars[i];
        if (b.high >= u) this.drawCircle(this.xCenter(i), this.yOf(u), ch.upper.color);
        if (b.low <= l) this.drawCircle(this.xCenter(i), this.yOf(l), ch.lower.color);
      } else if (ch.marker === 'extremum') {
        if (this.isLocalMax(up, i, k)) this.drawCircle(this.xCenter(i), this.yOf(u), ch.upper.color);
        if (this.isLocalMin(dn, i, k)) this.drawCircle(this.xCenter(i), this.yOf(l), ch.lower.color);
      }
    }
  }

  private isLocalMax(v: (number | null)[], i: number, k: number): boolean {
    const c = v[i];
    if (c == null) return false;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const o = v[j];
      if (o == null) return false;
      if (o >= c) return false;
    }
    return true;
  }

  private isLocalMin(v: (number | null)[], i: number, k: number): boolean {
    const c = v[i];
    if (c == null) return false;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const o = v[j];
      if (o == null) return false;
      if (o <= c) return false;
    }
    return true;
  }

  /** Pine plotshape 的三角标记。画在 K 线上面，所以放在通道线之后。 */
  private drawMarks(): void {
    if (!this.extraMarks.length) return;
    const ctx = this.ctx;
    const s = 5;
    for (const m of this.extraMarks) {
      if (m.index < 0 || m.index >= this.bars.length) continue;
      const x = this.xCenter(m.index);
      const y = this.yOf(m.price);
      ctx.beginPath();
      if (m.above) {
        ctx.moveTo(x, y - s);
        ctx.lineTo(x - s, y + s);
        ctx.lineTo(x + s, y + s);
      } else {
        ctx.moveTo(x, y + s);
        ctx.lineTo(x - s, y - s);
        ctx.lineTo(x + s, y - s);
      }
      ctx.closePath();
      ctx.fillStyle = m.color;
      ctx.fill();
      if (m.text) {
        ctx.font = this.o.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = m.above ? 'bottom' : 'top';
        ctx.fillStyle = m.color;
        ctx.fillText(m.text, x, m.above ? y - s - 2 : y + s + 2);
      }
    }
  }

  /** 空心小圆点：先填背景色再描边，压在 K 线上也看得清 */
  private drawCircle(x: number, y: number, color: string): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = this.o.bgColor;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  /** 按主图样式分发 */
  private drawSeries(i0: number, i1: number): void {
    switch (this.o.style) {
      case 'bars': return this.drawBars(i0, i1);
      case 'hollow': return this.drawCandles(i0, i1, { hollow: true });
      case 'volcandles': return this.drawCandles(i0, i1, { volWidth: true });
      case 'heikin': return this.drawCandles(i0, i1, { src: this.haBars() });
      case 'line': return this.drawCloseLine(i0, i1, 'line');
      case 'linemarkers': return this.drawCloseLine(i0, i1, 'markers');
      case 'step': return this.drawCloseLine(i0, i1, 'step');
      case 'area': return this.drawCloseLine(i0, i1, 'area');
      case 'baseline': return this.drawBaseline(i0, i1);
      case 'hlcarea': return this.drawHlcArea(i0, i1);
      case 'columns': return this.drawColumns(i0, i1);
      case 'highlow': return this.drawHighLow(i0, i1);
      default: return this.drawCandles(i0, i1);
    }
  }

  /** 美国线：竖线连接最高最低；左短线 = 开盘，右短线 = 收盘；颜色按涨跌 */
  private drawBars(i0: number, i1: number): void {
    const ctx = this.ctx;
    const lw = this.view.barW >= 10 ? 2 : 1;
    const tick = Math.max(1, Math.floor(this.view.barW * 0.35));
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    for (let i = lo; i <= hi; i++) {
      const b = this.bars[i];
      ctx.fillStyle = b.close >= b.open ? this.o.upColor : this.o.downColor;
      const xc = Math.round(this.xCenter(i));
      const yH = Math.round(this.yOf(b.high));
      const yL = Math.round(this.yOf(b.low));
      ctx.fillRect(Math.round(xc - lw / 2), yH, lw, Math.max(1, yL - yH));
      ctx.fillRect(xc - tick, Math.round(this.yOf(b.open) - lw / 2), tick, lw);
      ctx.fillRect(Math.round(xc + lw / 2), Math.round(this.yOf(b.close) - lw / 2), tick, lw);
    }
  }

  /**
   * 收盘价折线族：line 折线 / markers 带标记线（蓝紫渐变折线 + 每根收盘价一个实心圆点）/ step 阶梯线（先横后竖）/
   * area 面积（线下自上而下渐变填充）
   */
  private drawCloseLine(i0: number, i1: number, kind: 'line' | 'markers' | 'step' | 'area'): void {
    const ctx = this.ctx;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    if (hi < lo) return;
    const p = this.plot;
    const path = new Path2D();
    let top = Infinity;
    let prevY = 0;
    for (let i = lo; i <= hi; i++) {
      const x = this.xCenter(i);
      const y = this.yOf(this.bars[i].close);
      if (y < top) top = y;
      if (i === lo) path.moveTo(x, y);
      else if (kind === 'step') { path.lineTo(x, prevY); path.lineTo(x, y); }
      else path.lineTo(x, y);
      prevY = y;
    }
    if (kind === 'area') {
      const area = new Path2D(path);
      area.lineTo(this.xCenter(hi), p.b);
      area.lineTo(this.xCenter(lo), p.b);
      area.closePath();
      const g = ctx.createLinearGradient(0, Math.min(top, p.b), 0, p.b);
      g.addColorStop(0, withAlpha(this.o.lineColor, 0.28));
      g.addColorStop(1, withAlpha(this.o.lineColor, 0.02));
      ctx.fillStyle = g;
      ctx.fill(area);
    }
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    if (kind === 'markers') {
      // 渐变锚在可见范围内最高 / 最低收盘价的位置上，颜色因此只取决于价格相对高低，不随缩放 / 平移跳变
      let mx = -Infinity;
      let mn = Infinity;
      for (let i = lo; i <= hi; i++) {
        const c = this.bars[i].close;
        if (c > mx) mx = c;
        if (c < mn) mn = c;
      }
      const yTop = this.yOf(mx);
      const yBot = this.yOf(mn);
      const colorAt = (y: number): string => markerColor(yBot - yTop < 1e-6 ? 0.5 : (y - yTop) / (yBot - yTop));
      const g = ctx.createLinearGradient(0, yTop, 0, Math.max(yBot, yTop + 1));
      g.addColorStop(0, markerColor(0));
      g.addColorStop(1, markerColor(1));
      ctx.strokeStyle = g;
      ctx.stroke(path);
      for (let i = lo; i <= hi; i++) {
        const y = this.yOf(this.bars[i].close);
        ctx.beginPath();
        ctx.arc(this.xCenter(i), y, 4, 0, Math.PI * 2);
        ctx.fillStyle = colorAt(y);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = this.o.lineColor;
      ctx.stroke(path);
    }
    ctx.restore();
  }

  /**
   * 基准线：基准价 = 可见范围收盘价的中点（虚线）。线在基准之上用涨色、之下用跌色，
   * 线与基准之间各自渐变填充 —— 用两个裁剪矩形分别画，不用手算交点。
   */
  private drawBaseline(i0: number, i1: number): void {
    const ctx = this.ctx;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    if (hi < lo) return;
    const p = this.plot;
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = lo; i <= hi; i++) {
      const c = this.bars[i].close;
      if (c < mn) mn = c;
      if (c > mx) mx = c;
    }
    const base = (mn + mx) / 2;
    this.baselineValue = base;
    const yB = this.yOf(base);
    const path = new Path2D();
    for (let i = lo; i <= hi; i++) {
      const x = this.xCenter(i);
      const y = this.yOf(this.bars[i].close);
      if (i === lo) path.moveTo(x, y); else path.lineTo(x, y);
    }
    const area = new Path2D(path);
    area.lineTo(this.xCenter(hi), yB);
    area.lineTo(this.xCenter(lo), yB);
    area.closePath();
    const half = (above: boolean): void => {
      const color = above ? this.o.upColor : this.o.downColor;
      ctx.save();
      ctx.beginPath();
      if (above) ctx.rect(p.l, p.t, p.w, Math.max(0, yB - p.t));
      else ctx.rect(p.l, yB, p.w, Math.max(0, p.b - yB));
      ctx.clip();
      const g = ctx.createLinearGradient(0, above ? p.t : p.b, 0, yB);
      g.addColorStop(0, withAlpha(color, 0.32));
      g.addColorStop(1, withAlpha(color, 0.04));
      ctx.fillStyle = g;
      ctx.fill(area);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.restore();
    };
    half(true);
    half(false);
    ctx.save();
    ctx.strokeStyle = this.o.axisTextColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(p.l, Math.round(yB) + 0.5);
    ctx.lineTo(p.r, Math.round(yB) + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  /** HLC 区域：最高价线 / 最低价线之间半透明填充，收盘价一条细线；高低线分别用涨 / 跌色 */
  private drawHlcArea(i0: number, i1: number): void {
    const ctx = this.ctx;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    if (hi < lo) return;
    const hiPath = new Path2D();
    const loPath = new Path2D();
    const clPath = new Path2D();
    const fill = new Path2D();
    for (let i = lo; i <= hi; i++) {
      const b = this.bars[i];
      const x = this.xCenter(i);
      if (i === lo) { hiPath.moveTo(x, this.yOf(b.high)); loPath.moveTo(x, this.yOf(b.low)); clPath.moveTo(x, this.yOf(b.close)); fill.moveTo(x, this.yOf(b.high)); }
      else { hiPath.lineTo(x, this.yOf(b.high)); loPath.lineTo(x, this.yOf(b.low)); clPath.lineTo(x, this.yOf(b.close)); fill.lineTo(x, this.yOf(b.high)); }
    }
    for (let i = hi; i >= lo; i--) fill.lineTo(this.xCenter(i), this.yOf(this.bars[i].low));
    fill.closePath();
    ctx.fillStyle = withAlpha(this.o.lineColor, 0.16);
    ctx.fill(fill);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.o.upColor;
    ctx.stroke(hiPath);
    ctx.strokeStyle = this.o.downColor;
    ctx.stroke(loPath);
    ctx.strokeStyle = this.o.lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke(clPath);
    ctx.restore();
  }

  /** 柱状图：每根收盘价一根自底向上的柱，颜色按收盘相对上一根收盘（首根按开盘）涨跌 */
  private drawColumns(i0: number, i1: number): void {
    const ctx = this.ctx;
    const bw = Math.max(1, Math.floor(this.view.barW * 0.7));
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    const p = this.plot;
    for (let i = lo; i <= hi; i++) {
      const b = this.bars[i];
      const ref = i > 0 ? this.bars[i - 1].close : b.open;
      ctx.fillStyle = b.close >= ref ? this.o.upColor : this.o.downColor;
      const y = Math.round(this.yOf(b.close));
      ctx.fillRect(Math.round(this.xCenter(i) - bw / 2), y, bw, Math.max(1, Math.round(p.b) - y));
    }
  }

  /** 高-低：每根一根从最低价到最高价的悬浮柱，单色 */
  private drawHighLow(i0: number, i1: number): void {
    const ctx = this.ctx;
    const bw = Math.max(1, Math.floor(this.view.barW * 0.7));
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    ctx.fillStyle = this.o.lineColor;
    for (let i = lo; i <= hi; i++) {
      const b = this.bars[i];
      const yH = Math.round(this.yOf(b.high));
      const yL = Math.round(this.yOf(b.low));
      ctx.fillRect(Math.round(this.xCenter(i) - bw / 2), yH, bw, Math.max(1, yL - yH));
    }
  }

  /**
   * 蜡烛体。默认行为（实心、固定宽度、真实 OHLC）不变；
   *   hollow：涨（close ≥ open）空心 —— 先填背景色再描边；跌实心；
   *   volWidth：实体宽度随成交量变化（`volCandleWidth`）；
   *   src：改用别的 OHLC 序列（平均K线）。
   */
  private drawCandles(i0: number, i1: number, o: { hollow?: boolean; volWidth?: boolean; src?: Bar[] } = {}): void {
    const ctx = this.ctx;
    const src = o.src || this.bars;
    const bw0 = Math.max(1, Math.floor(this.view.barW * 0.7));
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    let maxV = 0;
    if (o.volWidth) for (let i = lo; i <= hi; i++) if (src[i].volume > maxV) maxV = src[i].volume;
    for (let i = lo; i <= hi; i++) {
      const b = src[i];
      const up = b.close >= b.open;
      const color = up ? this.o.upColor : this.o.downColor;
      const bw = o.volWidth ? volCandleWidth(b.volume, maxV, this.view.barW) : bw0;
      const xc = Math.round(this.xCenter(i));
      const yH = this.yOf(b.high);
      const yL = this.yOf(b.low);
      const yO = this.yOf(b.open);
      const yC = this.yOf(b.close);

      ctx.fillStyle = color;
      ctx.fillRect(Math.round(xc - 0.5), Math.round(yH), 1, Math.max(1, Math.round(yL - yH)));
      const top = Math.min(yO, yC);
      const hgt = Math.max(1, Math.abs(yC - yO));
      const bx = Math.round(xc - bw / 2);
      if (o.hollow && up && bw >= 3 && hgt >= 3) {
        ctx.fillStyle = this.o.bgColor;
        ctx.fillRect(bx, Math.round(top), bw, Math.round(hgt));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, Math.round(top) + 0.5, bw - 1, Math.round(hgt) - 1);
      } else {
        ctx.fillRect(bx, Math.round(top), bw, Math.round(hgt));
      }
    }
  }

  /** 画 MA 和 addLine 的通用线。通道三条线由 drawChannelLines 负责（要画在 K 线上面）。 */
  private drawLines(i0: number, i1: number): void {
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    for (const ln of this.ma) this.strokeLine(ln, lo, hi);
    for (const ln of this.extraLines) this.strokeLine(ln, lo, hi);
  }

  private drawCrosshairV(): void {
    const ctx = this.ctx;
    const p = this.plot;
    const i = this.snapIndex();
    if (i == null) return;
    const x = Math.round(this.xCenter(i)) + 0.5;
    ctx.save();
    ctx.strokeStyle = this.o.crossColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, p.t);
    ctx.lineTo(x, p.b);
    ctx.stroke();
    ctx.restore();
  }

  private snapIndex(): number | null {
    if (!this.bars.length) return null;
    if (this.syncIndex != null) return clamp(this.syncIndex, 0, this.bars.length - 1);
    if (!this.pointer) return null;
    return clamp(Math.floor(this.iOf(this.pointer.x)), 0, this.bars.length - 1);
  }

  private drawPriceAxis(): void {
    const ctx = this.ctx;
    const p = this.plot;
    ctx.font = this.o.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.o.axisTextColor;
    const dec = decimalsFor(this.priceStep);
    for (const v of this.priceTicks()) {
      const y = this.yOf(v);
      if (y < p.t - 6 || y > p.b + 6) continue;
      ctx.fillText(v.toFixed(dec), p.r + 8, Math.round(y));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(p.r + 0.5, 0);
    ctx.lineTo(p.r + 0.5, p.b);
    ctx.stroke();
  }

  private drawTimeAxis(i0: number, i1: number): void {
    const ctx = this.ctx;
    const p = this.plot;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.bars.length - 1, i1);
    if (hi < lo) return;
    const spanDays = (this.bars[hi].time - this.bars[lo].time) / 86400000;
    ctx.font = this.o.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.o.axisTextColor;
    for (const i of this.timeTicks(i0, i1)) {
      const x = this.xCenter(i);
      if (x < p.l || x > p.r) continue;
      ctx.fillText(fmtTime(this.bars[i].time, spanDays), Math.round(x), this.axisY());
    }
  }

  private drawLastPrice(): void {
    const n = this.bars.length;
    if (!n) return;
    const ctx = this.ctx;
    const b = this.bars[n - 1];
    const y = Math.round(this.yOf(b.close)) + 0.5;
    const p = this.plot;
    if (y < p.t || y > p.b) return;
    const color = this.closeOnly() ? this.o.lineColor : b.close >= b.open ? this.o.upColor : this.o.downColor;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(p.l, y);
    ctx.lineTo(p.r, y);
    ctx.stroke();
    ctx.restore();

    const dec = decimalsFor(this.priceStep);
    const label = b.close.toFixed(dec);
    ctx.font = this.o.font;
    const tw = ctx.measureText(label).width;
    const bw = Math.max(this.o.axisWidth - 4, tw + 12);
    ctx.fillStyle = color;
    ctx.fillRect(p.r + 2, y - 9, bw, 18);
    ctx.fillStyle = this.o.bgColor;   // 标签文字用背景色：换主题时自动跟着走
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.r + 8, y);
  }

  private drawCrosshairLabels(i0: number, i1: number): void {
    const ptr = this.pointer;
    const i = this.snapIndex();
    if (!ptr && i == null) return;
    const ctx = this.ctx;
    const p = this.plot;
    ctx.font = this.o.font;
    ctx.textBaseline = 'middle';

    // 价格轴反色标签：**只在鼠标真的落在这张图上时画**。
    // 联动的其它图没有「鼠标的纵坐标」这回事，硬画一个价格标签是瞎编。
    if (ptr && ptr.y >= p.t && ptr.y <= p.b) {
      const price = this.pOf(ptr.y);
      const dec = decimalsFor(this.priceStep);
      const label = price.toFixed(dec);
      const tw = ctx.measureText(label).width;
      const bw = Math.max(this.o.axisWidth - 4, tw + 12);
      const y = Math.round(ptr.y);
      ctx.fillStyle = this.o.crossColor;
      ctx.fillRect(p.r + 2, y - 9, bw, 18);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(label, p.r + 8, y);
    }

    // 时间轴反色标签（吸附到 bar 中心）
    if (i != null) {
      const lo = Math.max(0, i0);
      const hi = Math.min(this.bars.length - 1, i1);
      const spanDays = hi >= lo ? (this.bars[hi].time - this.bars[lo].time) / 86400000 : 30;
      const label = fmtTime(this.bars[i].time, spanDays);
      const tw = ctx.measureText(label).width;
      const bw = tw + 14;
      const x = clamp(this.xCenter(i), p.l + bw / 2, p.r - bw / 2);
      const y = this.axisY();
      ctx.fillStyle = this.o.crossColor;
      ctx.fillRect(Math.round(x - bw / 2), Math.round(y - 9), Math.round(bw), 18);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(label, Math.round(x), Math.round(y));
    }
  }

  /**
   * 图例。主流图表软件是**每个指标一行**堆叠的，这里照做：
   *   ① 标的 · 周期 · OHLC · 涨跌幅
   *   ② MA5/10/20
   *   ③ 每条通道一行：名字 + 参数 + 上/中/下轨当前值
   */
  private drawLegend(i0: number, i1: number): void {
    const ctx = this.ctx;
    const p = this.plot;
    const n = this.bars.length;
    if (!n) return;
    const hi = Math.min(this.bars.length - 1, i1);
    const idx = this.snapIndex();
    const i = idx == null ? hi : idx;
    const b = this.bars[i];
    const prev = i > 0 ? this.bars[i - 1] : b;
    const up = b.close >= b.open;
    const color = up ? this.o.upColor : this.o.downColor;
    const chg = prev.close ? ((b.close - prev.close) / prev.close) * 100 : 0;
    const dec = decimalsFor(this.priceStep);
    const fmt = (v: number | null | undefined) => (v == null ? '--' : v.toFixed(dec));

    ctx.font = this.o.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const rowH = 17;
    const x0 = p.l + this.o.legendInset;
    let y = p.t + 12;

    // 行 ① —— 主图
    let x = x0;
    const put = (text: string, fill: string, gap: number) => {
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
      x += ctx.measureText(text).width + gap;
    };
    put(this.o.symbol, this.o.titleColor, 10);
    put(this.o.timeframe, this.o.axisTextColor, 10);
    put('开 ' + b.open.toFixed(dec), color, 10);
    put('高 ' + b.high.toFixed(dec), color, 10);
    put('低 ' + b.low.toFixed(dec), color, 10);
    put('收 ' + b.close.toFixed(dec), color, 10);
    put((chg >= 0 ? '+' : '') + chg.toFixed(2) + '%', chg >= 0 ? this.o.upColor : this.o.downColor, 10);
    if (idx != null) put('· ' + fmtTime(b.time, 30), this.o.axisTextColor, 10);

    // 行 ② —— MA
    y += rowH;
    x = x0;
    for (const ln of this.ma) {
      put(ln.name + ' ' + fmt(ln.values[i]), ln.color, 12);
    }

    // 行 ③.. —— 每条通道一行
    for (const ch of this.channels) {
      if (!ch.visible) continue;
      y += rowH;
      x = x0;
      put(ch.name, this.o.titleColor, 6);
      if (ch.params) put(ch.params, this.o.axisTextColor, 12);
      put('上 ' + fmt(ch.upper.values[i]), ch.upper.color, 12);
      put('中 ' + fmt(ch.basis.values[i]), ch.basis.color, 12);
      put('下 ' + fmt(ch.lower.values[i]), ch.lower.color, 12);
      // 带宽 —— 通道类指标最常看的一个数
      const u = ch.upper.values[i];
      const l = ch.lower.values[i];
      if (u != null && l != null) {
        const bw = ((u - l) / ((u + l) / 2)) * 100;
        put('带 ' + bw.toFixed(2) + '%', this.o.axisTextColor, 12);
      }
    }

    // Pine v6 指标：overlay 的和运行失败的各占一行（副图指标的图例在各自的副图里）
    const ptr = this.pointer;
    for (const st of this.studies) {
      if (st.output && !st.output.overlay) continue;
      y += rowH;
      const hover = !!ptr && ptr.y >= y - rowH / 2 && ptr.y <= y + rowH / 2 && ptr.x < p.r;
      this.drawStudyRow(st, x0, y, i, hover);
    }
  }

  /** 给无头验证用的一行摘要 */
  debugInfo(): string {
    const [i0, i1] = this.visible();
    const modes = this.channelMarkers().map((c) => c.id + ':' + c.marker).join(',');
    return 'bars=' + this.bars.length +
      ' view.from=' + this.view.from.toFixed(2) +
      ' barW=' + this.view.barW.toFixed(2) +
      ' visible=[' + i0 + ',' + i1 + ']' +
      ' scale=[' + this.scale.min.toFixed(2) + ',' + this.scale.max.toFixed(2) + ']' +
      ' channels=' + this.channelsVisible() + '/' + this.channels.length +
      ' markers=[' + modes + ']' +
      ' size=' + this.W + 'x' + this.H + '@' + this.dpr + 'x';
  }
}

/* ===========================================================================
 * 4. 自检 —— 打开页面就会跑，结果写进 #log
 *    headless 下用 `--dump-dom` 抓下来 grep "FAIL" 即可判定。
 * ========================================================================= */

export interface TestResult {
  pass: number;
  fail: number;
  names: string[];
}

export function selfTest(chart: KChart): TestResult {
  let pass = 0;
  let fail = 0;
  const names: string[] = [];
  const t = (name: string, ok: boolean, extra: string = '') => {
    names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
    if (ok) pass++; else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };
  const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

  const bars = chart.bars;

  // --- 数据层 ---
  let sorted = bars.length > 1;
  for (let i = 1; i < bars.length; i++) if (bars[i].time <= bars[i - 1].time) sorted = false;
  t('bars 严格升序且无重复 time', sorted, 'n=' + bars.length);

  let ohlc = true;
  for (const b of bars) {
    if (!(b.high >= Math.max(b.open, b.close) - 1e-9 && b.low <= Math.min(b.open, b.close) + 1e-9)) ohlc = false;
  }
  t('每根 bar 满足 low<=min(o,c) 且 max(o,c)<=high', ohlc);

  const dirty = normalizeBars([
    { time: 3, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 },
    { time: 3, open: 9, high: 9, low: 9, close: 9, volume: 0 },
    { time: 2, open: NaN, high: 1, low: 1, close: 1, volume: 0 },
  ]);
  t('normalizeBars 排序+去重+剔除 NaN',
    dirty.length === 2 && dirty[0].time === 1 && dirty[1].time === 3 && dirty[1].open === 9,
    'len=' + dirty.length);

  // --- 指标数学 ---
  const closes = bars.map((b) => b.close);
  const m5 = sma(closes, 5);
  const k = closes.length - 1;
  const naive = (closes[k] + closes[k - 1] + closes[k - 2] + closes[k - 3] + closes[k - 4]) / 5;
  t('sma(5) 末值与朴素均值一致', near(m5[k] as number, naive, 1e-9));
  t('sma 前 4 项为 null', m5[0] === null && m5[3] === null && m5[4] !== null);

  const band = bollinger(closes, 20, 2);
  const mid = band.mid.values[k] as number;
  const up = band.upper.values[k] as number;
  const dn = band.lower.values[k] as number;
  t('BOLL 上下轨关于中轨对称', near(up - mid, mid - dn, 1e-6));
  t('BOLL 中轨就是 sma(20)',
    near(mid, sma(closes, 20)[k] as number, 1e-12));
  t('BOLL 上轨 > 中轨 > 下轨', up > mid && mid > dn);

  // --- 通道（那种「上下轨 + 中轨 + 半透明填充」）---
  chart.drawNow();
  const chs = chart.channels;
  t('默认带一条 BB 通道', chs.length >= 1 && chs[0].id === 'bb', 'n=' + chs.length);
  const ch0 = chs[0];
  t('通道三条轨长度与 bars 对齐',
    ch0.upper.values.length === bars.length &&
    ch0.basis.values.length === bars.length &&
    ch0.lower.values.length === bars.length);
  t('通道前 19 根为 null（20 周期未满）',
    ch0.upper.values[18] === null && ch0.upper.values[19] !== null);

  let ordered = true;
  for (let i = 0; i < bars.length; i++) {
    const uu = ch0.upper.values[i];
    const mm = ch0.basis.values[i];
    const ll = ch0.lower.values[i];
    if (uu == null || mm == null || ll == null) continue;
    if (!(uu >= mm - 1e-9 && mm >= ll - 1e-9)) ordered = false;
  }
  t('通道处处满足 upper >= basis >= lower', ordered);

  const runs = chart.channelRuns(ch0, 0, bars.length - 1);
  t('通道填充按缺口切段（前 19 根 null 被排除，不横跨缺口）',
    runs.length === 1 && runs[0][0] === 19 && runs[0][1] === bars.length - 1,
    'runs=' + runs.length + ' [' + (runs[0] ? runs[0][0] + ',' + runs[0][1] : '-') + ']');

  const [s0, s1] = chart.visible();
  let maxU = -Infinity;
  let minL = Infinity;
  for (let i = Math.max(0, s0); i <= Math.min(bars.length - 1, s1); i++) {
    const uu = ch0.upper.values[i];
    const ll = ch0.lower.values[i];
    if (uu != null && uu > maxU) maxU = uu;
    if (ll != null && ll < minL) minL = ll;
  }
  t('通道上下轨被算进自动缩放（否则开通道时上下轨会被切掉）',
    chart.scale.max >= maxU - 1e-9 && chart.scale.min <= minL + 1e-9,
    'scale=[' + chart.scale.min.toFixed(2) + ',' + chart.scale.max.toFixed(2) +
    '] band=[' + minL.toFixed(2) + ',' + maxU.toFixed(2) + ']');

  chart.setChannelMarker('bb', 'touch');
  const mm1 = chart.channelMarkers()[0].marker;
  chart.setChannelMarker('bb', 'none');
  t('setChannelMarker 能切到 touch 再切回 none',
    mm1 === 'touch' && chart.channelMarkers()[0].marker === 'none');

  // --- 多周期合成 & 时间轴对齐（多图联动的地基）---
  const wk = resample(bars, '1W');
  t('resample(1W) 非空且根数远少于日线',
    wk.length > 0 && wk.length < bars.length, 'd=' + bars.length + ' w=' + wk.length);

  let wkOk = true;
  {
    let j = 0;
    for (let i = 0; i < wk.length; i++) {
      const w = wk[i];
      const group: Bar[] = [];
      while (j < bars.length && bucketKey(bars[j].time, '1W') === bucketKey(w.time, '1W')) {
        group.push(bars[j]);
        j++;
      }
      if (!group.length) { wkOk = false; break; }
      let hi = -Infinity;
      let lo = Infinity;
      let vol = 0;
      for (const g of group) {
        if (g.high > hi) hi = g.high;
        if (g.low < lo) lo = g.low;
        vol += g.volume;
      }
      if (w.time !== group[0].time) wkOk = false;
      if (w.open !== group[0].open) wkOk = false;
      if (w.close !== group[group.length - 1].close) wkOk = false;
      if (Math.abs(w.high - hi) > 1e-9 || Math.abs(w.low - lo) > 1e-9) wkOk = false;
      if (Math.abs(w.volume - vol) > 1e-6) wkOk = false;
    }
  }
  t('resample(1W)：open 取首根 / close 取末根 / high·low 取极值 / volume 求和 / time 取首根', wkOk);

  const mo = resample(bars, '1M');
  t('resample(1M) 非空且根数 < 周线', mo.length > 0 && mo.length < wk.length, 'm=' + mo.length);

  const tRef = bars[400].time;
  t('indexAtTime 命中已有时间戳', chart.indexAtTime(tRef) === 400);
  t('indexAtTime 落在两根之间取前一根', chart.indexAtTime(tRef + 1) === 400);
  t('indexAtTime 早于第一根取 0', chart.indexAtTime(bars[0].time - 86400000) === 0);
  t('indexAtTime 晚于最后一根取末根',
    chart.indexAtTime(bars[bars.length - 1].time + 1e9) === bars.length - 1);

  const vt = chart.viewTimes();
  t('viewTimes 返回有序区间', !!vt && vt[0] <= vt[1]);

  const tgt0 = bars[100].time;
  const tgt1 = bars[300].time;
  chart.setViewTimes(tgt0, tgt1);
  const vt2 = chart.viewTimes();
  const vt2s = vt2
    ? '[' + new Date(vt2[0]).toISOString().slice(0, 10) + ',' +
      new Date(vt2[1]).toISOString().slice(0, 10) + ']'
    : 'null';
  // barW 有 1px 下限：小格子（比如 4×4 布局）里 201 根根本塞不下，
  // 此时右边缘到不了 tgt1 是**正确**的，不是 bug
  const canFitVt = chart.plot.w / 201 >= 1;
  t('setViewTimes 左边缘对齐请求起点',
    !!vt2 && vt2[0] <= tgt0 + 86400000, vt2s);
  t('setViewTimes 装得下时右边缘也覆盖请求终点',
    !!vt2 && (!canFitVt || vt2[1] >= tgt1 - 86400000),
    'canFit=' + canFitVt + ' plotW=' + chart.plot.w.toFixed(0));

  // 【回归】目标区间比视口宽：setViewTimes 会静默只显示左侧一段；revealSpan 必须让右端（最新）可见
  {
    const cap = chart.maxVisibleBars();
    t('maxVisibleBars 等于绘图区像素宽（barW 下限 1px）', cap === Math.max(1, Math.floor(chart.plot.w)), String(cap));
    const wideA = Math.max(0, bars.length - 1 - (cap + 50));
    if (wideA > 0) {
      const t0 = bars[wideA].time;
      const t1 = bars[bars.length - 1].time;
      chart.setViewTimes(t0, t1);
      const left = chart.viewTimes();
      t('（前提）比视口宽的区间用 setViewTimes 确实只显示左侧一段，右端被甩在屏幕外',
        !!left && left[1] < t1, left ? String(left[1]) + ' < ' + String(t1) : 'null');
      const fits = chart.revealSpan(t0, t1);
      const right = chart.viewTimes();
      t('revealSpan：装不下时返回 false，且靠右对齐、最新一根可见',
        !fits && !!right && right[1] === t1, right ? String(right[1]) + ' vs ' + String(t1) : 'null');
    } else {
      t('revealSpan：数据不够长，跳过「装不下」场景', true);
    }
    const mid0 = bars[100].time;
    const mid1 = bars[100 + Math.min(40, cap - 5)].time;
    t('revealSpan：装得下时返回 true，左端对齐起点', chart.revealSpan(mid0, mid1) && (chart.viewTimes() as [number, number])[0] <= mid0 + 86400000);
  }

  chart.setSyncIndex(123);
  t('setSyncIndex 后 crosshairIndex 返回它', chart.crosshairIndex() === 123);
  chart.setSyncIndex(9e9);
  t('setSyncIndex 会夹到数据范围内', chart.crosshairIndex() === bars.length - 1);
  chart.setSyncIndex(null);

  // --- 显示范围（底部 1D 7D 1M 3M 6M YTD 1Y 5Y ALL）---
  const nRange = bars.length;
  const lastT = bars[nRange - 1].time;
  const canFitAll = chart.plot.w / nRange >= 1;

  const okAll = chart.setRange('ALL');
  const vtAll = chart.viewTimes();
  t('setRange(ALL)：要么首尾全见，要么 barW 已到 1px 下限',
    okAll && !!vtAll && (canFitAll
      ? (vtAll[0] <= bars[0].time + 86400000 && vtAll[1] >= lastT - 86400000)
      : Math.abs(chart.view.barW - 1) < 1e-9),
    'canFit=' + canFitAll + ' barW=' + chart.view.barW.toFixed(2));

  // 容差必须跟着**当前周期**走：月线一根就 30 天，
  // 固定 ±30 天的话「1Y ≈ 365 天」在月线上会直接假失败
  const barDays = nRange > 1 ? (lastT - bars[0].time) / (nRange - 1) / 86400000 : 1;
  t('setRange(1Y) 返回 true', chart.setRange('1Y') === true);
  const spanY = chart.viewSpan() / 86400000;
  t('setRange(1Y) 跨度 ≈365 天（容差 30 天 + 一根 bar）',
    Math.abs(spanY - 365) < 30 + barDays,
    spanY.toFixed(0) + 'd  bar=' + barDays.toFixed(1) + 'd');

  chart.setRange('1M');
  const spanM = chart.viewSpan() / 86400000;
  t('setRange(1M) 跨度 ≈30 天（容差 6 天 + 一根 bar）',
    Math.abs(spanM - 30) < 6 + barDays,
    spanM.toFixed(0) + 'd');

  // 回归：setRange 之后最新一根必须可见（1px 下限装不下整段范围时靠右对齐，而不是从范围起点往右铺）
  const vtM = chart.viewTimes();
  t('setRange(1M) 之后最新一根可见', !!vtM && vtM[1] === bars[bars.length - 1].time);

  const ytdOk = chart.rangeAvailable('YTD');
  chart.setRange('YTD');
  const vtYtd = chart.viewTimes();
  const ytdStart = new Date(new Date(lastT).getFullYear(), 0, 1).getTime();
  t('setRange(YTD) 可用时左边缘落在今年 1 月 1 日附近（±7 天）',
    !ytdOk || (!!vtYtd && Math.abs(vtYtd[0] - ytdStart) < 86400000 * 7),
    'avail=' + ytdOk + ' ' + (vtYtd ? new Date(vtYtd[0]).toISOString().slice(0, 10) + ' vs ' +
      new Date(ytdStart).toISOString().slice(0, 10) : 'null'));

  // 900 根日线约 3.5 年：1Y 够、5Y 不够 —— 底部那排按钮就是靠这个置灰的
  t('rangeAvailable(1Y) = true', chart.rangeAvailable('1Y') === true);
  t('rangeAvailable(5Y) = false（数据只有约 3.5 年）', chart.rangeAvailable('5Y') === false);
  t('setRange(5Y) 数据不够时返回 false', chart.setRange('5Y') === false);
  t('setRange(不存在的 key) 返回 false', chart.setRange('9Z') === false);

  // --- 刻度 ---
  let nice = true;
  for (const raw of [0.0031, 0.017, 0.42, 3.7, 88, 1234]) {
    const s = niceStep(raw);
    const p = Math.pow(10, Math.floor(Math.log10(s) + 1e-9));
    const m = Math.round(s / p);
    if (m !== 1 && m !== 2 && m !== 5 && m !== 10) nice = false;
    if (s < raw * 0.5 || s > raw * 2.5) nice = false;
  }
  t('niceStep 只产出 1/2/5×10^k 且量级正确', nice);

  // --- 坐标变换是互逆的 ---
  const [vi0, vi1] = chart.visible();
  const probe = clamp(Math.floor((vi0 + vi1) / 2), 0, bars.length - 1);
  t('索引→像素→索引 往返一致',
    near(chart.iOf(chart.xCenter(probe)), probe + 0.5, 1e-6),
    'i=' + probe + ' got=' + chart.iOf(chart.xCenter(probe)).toFixed(9));
  const midPrice = (chart.scale.min + chart.scale.max) / 2;
  t('价格→像素→价格 往返一致', near(chart.pOf(chart.yOf(midPrice)), midPrice, 1e-6));

  // --- 渲染确实发生了（放在改动状态之前）---
  chart.drawNow();
  let painted = false;
  try {
    const full = chart.ctx.getImageData(0, 0, chart.canvas.width, chart.canvas.height).data;
    const bg = [14, 17, 22];
    let ink = 0;
    for (let i = 0; i < full.length; i += 4 * 53) {
      if (Math.abs(full[i] - bg[0]) > 12 ||
          Math.abs(full[i + 1] - bg[1]) > 12 ||
          Math.abs(full[i + 2] - bg[2]) > 12) ink++;
    }
    painted = ink > 50;
  } catch (e) {
    log('WARN  getImageData 不可用（画布被污染？）：' + String(e));
  }
  t('画布上确实画了东西（背景之外有像素）', painted);

  // --- 主图样式：蜡烛 / 美国线 / 折线 / 面积 ---
  const candleScale = { min: chart.scale.min, max: chart.scale.max };
  t('默认样式是蜡烛', chart.style() === 'candles');
  chart.setStyle('nope' as ChartStyle);
  t('非法样式被忽略', chart.style() === 'candles');

  /** 在某根 bar 的收盘价附近取一块像素（css 偏移，返回 RGBA 数组；取不到返回 null） */
  const regionAt = (i: number, dx: number, dy: number, w: number, h: number): Uint8ClampedArray | null => {
    try {
      const x = Math.round((chart.xCenter(i) + dx) * chart.dpr);
      const y = Math.round((chart.yOf(chart.bars[i].close) + dy) * chart.dpr);
      return chart.ctx.getImageData(x, y, Math.max(1, Math.round(w * chart.dpr)), Math.max(1, Math.round(h * chart.dpr))).data;
    } catch (e) {
      return null;
    }
  };
  /** 区域内是否存在满足条件的像素（抗锯齿 / 均线压在上面时，单点取样不可靠） */
  const anyPx = (d: Uint8ClampedArray | null, pred: (r: number, g: number, b: number) => boolean): boolean => {
    if (!d) return true; // 取不到像素（如跨域污染）时不判失败
    for (let k = 0; k < d.length; k += 4) if (pred(d[k], d[k + 1], d[k + 2])) return true;
    return false;
  };
  const isBlue = (r: number, g: number, b: number): boolean => b - r > 60 && b - g > 40;

  chart.setStyle('line');
  chart.drawNow();
  t('折线：价格轴只按收盘价取范围（不宽于蜡烛的高低价范围）',
    chart.scale.min >= candleScale.min - 1e-9 && chart.scale.max <= candleScale.max + 1e-9,
    '[' + chart.scale.min.toFixed(2) + ',' + chart.scale.max.toFixed(2) + '] vs [' +
      candleScale.min.toFixed(2) + ',' + candleScale.max.toFixed(2) + ']');
  t('折线：收盘价附近画了线色像素', anyPx(regionAt(probe, -3, -3, 7, 7), isBlue));
  const belowLine = regionAt(probe, 0, 8, 1, 1);

  chart.setStyle('area');
  chart.drawNow();
  const belowArea = regionAt(probe, 0, 8, 1, 1);
  t('面积：线下方有渐变填充（与折线同位置的像素不同）',
    belowLine === null || belowArea === null || Math.abs(belowArea[2] - belowLine[2]) + Math.abs(belowArea[0] - belowLine[0]) > 4,
    'line=' + (belowLine ? Array.from(belowLine).join(',') : '') + ' area=' + (belowArea ? Array.from(belowArea).join(',') : ''));

  chart.setStyle('bars');
  chart.drawNow();
  t('美国线：价格轴回到按最高最低价取范围',
    near(chart.scale.min, candleScale.min, 1e-9) && near(chart.scale.max, candleScale.max, 1e-9));
  {
    // 右短线 = 收盘：中线右侧 1~3 个 css 像素、收盘高度附近应有涨跌色像素
    const bb = chart.bars[probe];
    const wn = parseInt((bb.close >= bb.open ? chart.colors().up : chart.colors().down).slice(1), 16);
    const wr = (wn >> 16) & 255, wg = (wn >> 8) & 255, wb = wn & 255;
    t('美国线：收盘价处右短线为涨跌色',
      anyPx(regionAt(probe, 1, -2, 3, 4), (r, g, b) => Math.abs(r - wr) < 50 && Math.abs(g - wg) < 50 && Math.abs(b - wb) < 50));
  }

  chart.setStyle('candles');
  chart.drawNow();
  t('切回蜡烛后价格轴与最初一致',
    near(chart.scale.min, candleScale.min, 1e-9) && near(chart.scale.max, candleScale.max, 1e-9));

  // --- 真正的行为断言：光标锚定缩放 ---
  const px = chart.plot.l + chart.plot.w * 0.37;
  const anchorBefore = chart.iOf(px);
  chart.zoomAt(px, 1.9);
  t('放大后光标下的 bar 索引不变',
    near(anchorBefore, chart.iOf(px), 1e-6),
    anchorBefore.toFixed(9) + ' -> ' + chart.iOf(px).toFixed(9));
  chart.zoomAt(px, 1 / 1.9);
  t('缩小回来后仍锚定同一根 bar', near(anchorBefore, chart.iOf(px), 1e-6));

  // --- 视口夹紧：极端缩放不能把图甩出去 ---
  chart.zoomAt(chart.plot.l, 1e6);
  const wMax = chart.view.barW;
  chart.zoomAt(chart.plot.r, 1e-6);
  const wMin = chart.view.barW;
  t('barW 被夹在 [1,60]', wMax <= 60 + 1e-9 && wMin >= 1 - 1e-9,
    'max=' + wMax.toFixed(2) + ' min=' + wMin.toFixed(2));

  chart.fitContent();
  const fitBars = chart.visible();
  // barW 有 1px 下限，所以「装得下」和「装不下」是两种正当结果
  const canFit = chart.plot.w / bars.length >= 1;
  t('fitContent：最后一根始终可见，装得下时第一根也可见',
    fitBars[1] >= bars.length - 1 && (!canFit || fitBars[0] <= 1),
    '[' + fitBars[0] + ',' + fitBars[1] + '] n=' + bars.length + ' canFit=' + canFit);

  chart.showLast(180);
  const [a0, a1] = chart.visible();
  t('showLast(180) 后可见区间非空且贴住最新数据',
    a1 > a0 && a1 >= bars.length - 1 - 2 && a0 < bars.length,
    '[' + a0 + ',' + a1 + '] n=' + bars.length);

  // --- 实时更新语义 ---
  const n0 = chart.bars.length;
  const snap = Object.assign({}, chart.bars[n0 - 1]);
  chart.update(Object.assign({}, snap, { close: snap.close * 1.01 }));
  t('update() 同 time 覆盖而非追加', chart.bars.length === n0);
  chart.update({
    time: snap.time + 86400000, open: snap.close, high: snap.close * 1.02,
    low: snap.close * 0.99, close: snap.close * 1.01, volume: 123,
  });
  t('update() 更大 time 追加新 bar', chart.bars.length === n0 + 1);
  chart.update({ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 });
  t('update() 拒绝乱序 bar', chart.bars.length === n0 + 1);

  // 还原 update 测试的改动：弹出插入的那根，**并把被覆盖的最后一根恢复原值**。
  // 少了后半句，自检就不是幂等的 —— 第二次跑 OHLC 合法性那条会假失败。
  if (chart.bars.length === n0 + 1) chart.bars.length = n0;
  chart.bars[n0 - 1] = snap;
  chart.buildIndicators();

  // --- Bar Replay：截断显示、指标按截断序列重算 ---
  {
    const fullN = chart.bars.length;
    const arrRef = chart.bars;
    const fullCopy = chart.bars.slice();
    const K = Math.min(150, fullN - 10);
    const cl = (n: number): number[] => fullCopy.slice(0, n).map((b) => b.close);
    const sameVals = (x: (number | null)[], y: (number | null)[]): boolean =>
      x.length === y.length && x.every((v, i) => (v === null) === (y[i] === null) && (v === null || Math.abs(v - (y[i] as number)) <= 1e-9));
    const bbNow = (): { u: (number | null)[]; m: (number | null)[]; l: (number | null)[] } => {
      const ch = chart.channels.find((c) => c.id === 'bb');
      return ch ? { u: ch.upper.values, m: ch.basis.values, l: ch.lower.values } : { u: [], m: [], l: [] };
    };
    const maNow = (): (number | null)[][] => chart.activeLines().slice(0, 3).map((l) => l.values);

    chart.setReplayCount(K);
    t('回放：只显示前 K 根', chart.bars.length === K && chart.replayCount() === K && chart.fullBarCount() === fullN,
      chart.bars.length + ' / ' + fullN);
    t('回放：bars 数组原地截断（外面拿着的引用不会变孤儿）', chart.bars === arrRef);
    t('回放：显示的就是原数据的前缀（逐根同一个对象）', chart.bars.every((b, i) => b === fullCopy[i]));
    const ma = maNow();
    const refMa = [sma(cl(K), 5), sma(cl(K), 10), sma(cl(K), 20)];
    t('回放：MA5/10/20 与「直接喂前 K 根」逐值一致，且没有多出未来的值',
      ma.every((v, i) => sameVals(v, refMa[i])), ma.map((v) => v.length).join(','));
    const bb = bollinger(cl(K), 20, 2);
    const bn = bbNow();
    t('回放：布林通道与「直接喂前 K 根」逐值一致',
      sameVals(bn.u, bb.upper.values) && sameVals(bn.m, bb.mid.values) && sameVals(bn.l, bb.lower.values));
    t('回放：最新一根在视口内（步进时视口会跟上）', chart.visible()[1] >= K - 1 && chart.visible()[0] <= K - 1,
      '[' + chart.visible() + '] K=' + K);

    chart.setReplayCount(K + 1);
    chart.setReplayCount(K);
    t('回放：前进再后退，指标与第一次完全相同（没有残留状态）',
      maNow().every((v, i) => sameVals(v, refMa[i])) && chart.bars.length === K);
    const far = Math.max(1, K - 120);
    chart.setReplayCount(far);
    t('回放：退到很早的位置，最新一根仍可见', chart.visible()[1] >= far - 1 && chart.visible()[0] <= far - 1,
      '[' + chart.visible() + '] far=' + far);
    chart.setReplayCount(10 * fullN);
    t('回放：超过总数会夹到总数', chart.bars.length === fullN);
    chart.setReplayCount(0);
    t('回放：小于 1 会夹到 1 根', chart.bars.length === 1);

    // 回放中来了实时行情：只进完整数据，不动画面
    chart.setReplayCount(K);
    const lastFull = fullCopy[fullN - 1];
    chart.update({ time: lastFull.time + 86400000, open: lastFull.close, high: lastFull.close, low: lastFull.close, close: lastFull.close, volume: 1 });
    t('回放中的 update() 不改变画面，但完整数据 +1', chart.bars.length === K && chart.fullBarCount() === fullN + 1);

    chart.setReplayCount(null);
    t('退出回放：恢复全部（含回放期间新增的那根）', chart.bars.length === fullN + 1 && chart.replayCount() === null);
    chart.bars.length = fullN; // 还原 update 追加的那根，保持自检幂等
    chart.buildIndicators();
    t('退出回放：指标与完整数据重算一致',
      maNow().every((v, i) => sameVals(v, [sma(cl(fullN), 5), sma(cl(fullN), 10), sma(cl(fullN), 20)][i])));
    chart.setReplayCount(K);
    chart.setBars(fullCopy);
    t('回放中换数据（setBars）= 回放作废、显示新数据全部', chart.replayCount() === null && chart.bars.length === fullN);
    t('centerIndex 落在数据范围内', chart.centerIndex() >= 0 && chart.centerIndex() <= chart.bars.length - 1);
  }

  // 收尾：恢复成初始视图
  chart.showLast(180);
  chart.drawNow();
  log('自检完成：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail, names };
}
