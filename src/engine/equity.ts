/**
 * kc-chart / equity.ts
 * ---------------------------------------------------------------------------
 * 权益曲线图（策略测试器那张图）。
 *
 * 依赖 chart.ts（ESM `import`）：
 * 复用 clamp / niceStep / fmtTime / log / RANGES / rangeStart / THEMES / Bar。 *
 * ============================ 为什么单独一个组件 ============================
 * KChart 是「蜡烛 + 多通道」的骨架，权益图是另一种图：
 *   ① 没有蜡烛，是「折线 + 柱状」两层序列
 *   ② **数值轴必须包含 0**，因为柱状是从 0 轴上下生长的 —— 这是硬约束，
 *      不是自动缩放的副产物。轴一旦把 0 排除在外，整张图的语义就崩了。
 *   ③ 折线和柱状是**两个不同量纲**叠在一个轴上（累计权益 vs 单根盈亏），
 *      所以轴范围要同时装下两者的极值。
 * 硬塞进 KChart 会把它变成一坨 if，所以拆开；共用的只有刻度/时间格式那几个纯函数。
 * ===========================================================================
 */

import { Bar, RANGES, THEMES, clamp, fmtTime, log, makeBars, niceStep, sma } from './chart';

/* ===========================================================================
 * 1. 类型
 * ========================================================================= */

export interface EquityPoint {
  time: number;
  /** 累计权益（或累计盈亏），折线 */
  equity: number;
  /** 该根的盈亏，柱状 */
  pnl: number;
}

export interface EquityOptions {
  /** 左上角标题，留空则不画那一行 */
  title?: string;
  /** 折线颜色 */
  lineColor?: string;
  /** 折线按正负变色（默认 true：参考图里线是红的，正是因为权益是负的） */
  colorBySign?: boolean;
  /** 盈利色 / 亏损色，柱状和按正负着色时都用它 */
  upColor?: string;
  downColor?: string;
  bgColor?: string;
  gridColor?: string;
  axisTextColor?: string;
  crossColor?: string;
  titleColor?: string;
  /** 右侧数值轴宽度 */
  axisWidth?: number;
  /** 底部时间轴高度 */
  axisHeight?: number;
  /** 数值小数位 */
  decimals?: number;
  /** 数值轴是否显示千分位（主流图表软件是显示的：-70,000.00） */
  thousands?: boolean;
  /** 柱状宽度占单根宽度的比例 */
  barRatio?: number;
  font?: string;
}

/** 纯计算用的最小数据形状（单测和假数据都用它，不需要 DOM） */
export interface EquitySeries {
  points: EquityPoint[];
  /** 每笔平仓盈亏（可选，只用于统计，不参与绘制） */
  trades?: number[];
}

/* ===========================================================================
 * 2. 常量与纯函数
 * ========================================================================= */

export const EQUITY_DEFAULTS: Required<EquityOptions> = {
  title: '',
  lineColor: '#f23645',
  colorBySign: true,
  upColor: '#26a69a',
  downColor: '#f23645',
  bgColor: '#0e1116',
  gridColor: 'rgba(255,255,255,0.06)',
  axisTextColor: '#9aa4b2',
  crossColor: '#787b86',
  titleColor: '#f23645',
  axisWidth: 96,
  axisHeight: 24,
  decimals: 2,
  thousands: true,
  barRatio: 0.62,
  font: '12px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
};

/** 1234567.891 → "1,234,567.89"。数值轴的标签格式。 */
export function fmtMoney(v: number, dec: number, thousands: boolean): string {
  if (!isFinite(v)) return '—';
  const neg = v < 0 || (v === 0 && 1 / v === -Infinity);
  let s = Math.abs(v).toFixed(dec);
  if (thousands) {
    const p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    s = p.join('.');
  }
  return (neg ? '-' : '') + s;
}

/**
 * 数值轴刻度。
 * ⚠️ **必须包含 0** —— 柱状从 0 轴生长，轴里没有 0 的话整张图就没意义了。
 * 所以这里先把 0 并进范围，再算 nice step。
 */
export function equityValueTicks(lo: number, hi: number, target: number): { ticks: number[]; step: number } {
  let mn = Math.min(lo, 0);
  let mx = Math.max(hi, 0);
  if (!isFinite(mn) || !isFinite(mx)) return { ticks: [0], step: 1 };
  if (mx - mn < 1e-12) { mx = mn + 1; }
  const step = niceStep((mx - mn) / Math.max(1, target));
  const ticks: number[] = [];
  const first = Math.ceil(mn / step - 1e-9);
  for (let k = 0; k < 200; k++) {
    const v = (first + k) * step;
    if (v > mx + 1e-9) break;
    // 消掉浮点毛刺：1e-13 之类的会被 toFixed 显示成 "-0.00"
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  if (!ticks.length) ticks.push(0);
  return { ticks, step };
}

/**
 * 数值轴的上下界：要同时装下**累计权益**和**单根盈亏**两条序列。
 * 只看权益的话，某根插一根大阴线（柱状探到权益范围之外）就会被切掉 ——
 * 截图里那根长红柱就是这么来的，它比同期权益还深。
 */
export function equityRange(points: EquityPoint[]): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const p of points) {
    if (p.equity < lo) lo = p.equity;
    if (p.equity > hi) hi = p.equity;
    if (p.pnl < lo) lo = p.pnl;
    if (p.pnl > hi) hi = p.pnl;
  }
  if (hi - lo < 1e-12) hi = lo + 1;
  return { lo, hi };
}

/** 每根盈亏序列 → 累计权益序列 */
export function buildEquityFromPnl(times: number[], pnl: number[], start: number): EquityPoint[] {
  const out: EquityPoint[] = [];
  let acc = start;
  for (let i = 0; i < times.length; i++) {
    acc += pnl[i] || 0;
    out.push({ time: times[i], equity: acc, pnl: pnl[i] || 0 });
  }
  return out;
}

export interface BacktestResult extends EquitySeries {
  /** 平仓次数 */
  tradeCount: number;
  /** 逐笔收益率（比例，不是百分比）—— 直接喂给收益分布直方图 */
  tradeReturns: number[];
  winRate: number;
  /** 最大回撤（正数） */
  maxDrawdown: number;
  /** 末值 */
  netProfit: number;
  /**
   * 持仓区间，用来画底部色条。
   * ⚠️ 收尾还没平的那一段带 `open: true`，**它不是一笔成交**：
   * `trades` / `tradeReturns` / `tradeCount` 只对应 `!open` 的区间。
   * 把 positions 当成交列表去映射收益率（缺的补 0）会多出一笔 ret=0 的幽灵交易，
   * 让直方图各箱对不上总数。要成交列表请用 `closedPositions()`。
   */
  positions: { from: number; to: number; long: boolean; open?: boolean }[];
}

/** 只保留已平仓的区间，与 trades / tradeReturns 一一对应 */
export function closedPositions<T extends { open?: boolean }>(positions: T[]): T[] {
  return positions.filter((p) => !p.open);
}

/**
 * 一个最小可用的双均线策略回测，只用来喂演示数据。
 * Pine 撮合（strategy.ts）吐同样的结构；在无手续费无滑点下，
 * 它跑 `ta.crossover(fast, slow)` 入场 / `ta.crossunder` 平仓的脚本，权益曲线与本函数逐点一致。
 *
 * 口径（写清楚，免得数字对不上时互相猜）：
 *   · 只做多，满仓，不加杠杆，不含手续费和滑点
 *   · 快线上穿慢线 → 下一根开盘建仓；下穿 → 下一根开盘平仓
 *   · 权益按**收盘价盯市**，所以每根都有盈亏（柱状才是连续的）
 *   · 「下一根开盘」是为了避免用当根收盘价成交的前视偏差
 */
export function simulateMaCross(bars: Bar[], fastLen: number, slowLen: number, start: number): BacktestResult {
  const n = bars.length;
  const closes: number[] = [];
  for (const b of bars) closes.push(b.close);
  const fast = sma(closes, Math.max(1, fastLen));
  const slow = sma(closes, Math.max(1, slowLen));

  let cash = start;
  let qty = 0;
  const points: EquityPoint[] = [];
  const positions: { from: number; to: number; long: boolean; open?: boolean }[] = [];
  const tradePnls: number[] = [];
  const tradeReturns: number[] = [];
  let openIdx = -1;
  let entryEquity = 0;
  let prevEquity = start;
  let peak = start;
  let maxDD = 0;

  for (let i = 0; i < n; i++) {
    // 信号取自**上一根收盘**（i-1 相对 i-2），这一根开盘执行。
    // ⚠️ 旧版这里用的是 fast[i] / slow[i]：均线里含了当根收盘价，却按当根开盘价成交，
    //    等于偷看了一根的未来，注释里写的「避免前视」其实没做到。
    const f = i >= 1 ? fast[i - 1] : null;
    const s = i >= 1 ? slow[i - 1] : null;
    const pf = i >= 2 ? fast[i - 2] : null;
    const ps = i >= 2 ? slow[i - 2] : null;

    if (pf != null && ps != null && f != null && s != null) {
      const up = pf <= ps && f > s;
      const dn = pf >= ps && f < s;
      if (up && qty === 0) {
        // ⚠️ 记的是**建仓那一刻的权益**，不是初始资金。
        // 写成 start 的话，每笔盈亏会变成「相对初始资金」而不是「相对本轮进场」，
        // 越往后越夸张，而且胜率会被算成全是赢的。
        entryEquity = cash;
        qty = cash / bars[i].open;
        cash = 0;
        openIdx = i;
      } else if (dn && qty > 0) {
        cash = qty * bars[i].open;
        qty = 0;
        if (openIdx >= 0) {
          positions.push({ from: bars[openIdx].time, to: bars[i].time, long: true });
          tradePnls.push(cash - entryEquity);
          // 收益率以**建仓时权益**为分母，不是初始资金 —— 复利下两者会越差越远
          tradeReturns.push(entryEquity > 0 ? (cash - entryEquity) / entryEquity : 0);
        }
        openIdx = -1;
      }
    }

    const eq = qty > 0 ? qty * bars[i].close : cash;
    points.push({ time: bars[i].time, equity: eq, pnl: eq - prevEquity });
    prevEquity = eq;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
  }

  // 收尾没平仓的也算一段持仓
  if (openIdx >= 0 && n > 0) positions.push({ from: bars[openIdx].time, to: bars[n - 1].time, long: true, open: true });

  let wins = 0;
  for (const p of tradePnls) if (p > 0) wins++;
  return {
    points,
    trades: tradePnls,
    tradeReturns,
    tradeCount: tradePnls.length,
    winRate: tradePnls.length ? wins / tradePnls.length : 0,
    maxDrawdown: maxDD,
    netProfit: points.length ? points[points.length - 1].equity - start : 0,
    positions,
  };
}

/* ===========================================================================
 * 3. 组件
 * ========================================================================= */

export class EquityChart {
  canvas: HTMLCanvasElement;
  points: EquityPoint[];
  /** 持仓区间（可选）—— 画在底部的一条细色带 */
  positions: { from: number; to: number; long: boolean }[];
  upColor: string;
  downColor: string;
  lineColor: string;
  colorBySign: boolean;

  ctx: CanvasRenderingContext2D;
  o: Required<EquityOptions>;
  view: { from: number; barW: number } = { from: 0, barW: 6 };
  plot: { l: number; t: number; r: number; b: number; w: number; h: number };
  scale: { min: number; max: number };
  priceStep: number;
  W: number;
  H: number;
  dpr: number;

  private pointer: { x: number; y: number } | null = null;
  private dragging = false;
  private dragX = 0;
  private rafId = 0;
  private ac: AbortController;
  private ro: ResizeObserver | null = null;

  constructor(target: HTMLCanvasElement | string, data: EquityPoint[], options?: EquityOptions) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(el instanceof HTMLCanvasElement)) throw new Error('EquityChart: 第一个参数必须是 <canvas>');
    this.canvas = el;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('EquityChart: 无法获取 2d context');
    this.ctx = ctx;
    this.o = Object.assign({}, EQUITY_DEFAULTS, options || {});
    this.points = [];
    this.positions = [];
    this.upColor = this.o.upColor;
    this.downColor = this.o.downColor;
    this.lineColor = this.o.lineColor;
    this.colorBySign = this.o.colorBySign;
    this.view = { from: 0, barW: 6 };
    this.plot = { l: 0, t: 0, r: 0, b: 0, w: 0, h: 0 };
    this.scale = { min: 0, max: 1 };
    this.priceStep = 1;
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.ac = new AbortController();

    el.style.touchAction = 'none';
    el.style.display = 'block';

    this.setData(data, true);
    this.bind();
    this.resize();
  }

  /* ---------------------------------------------------------- 数据 */

  setData(data: EquityPoint[], keepView?: boolean): void {
    this.points = [];
    if (data) for (const p of data) this.points.push({ time: p.time, equity: p.equity, pnl: p.pnl });
    if (!keepView) this.view = { from: 0, barW: 6 };
    this.showLast(180);
  }

  setPositions(list: { from: number; to: number; long: boolean }[]): void {
    this.positions = list ? list.slice() : [];
    this.invalidate();
  }

  /* ---------------------------------------------------------- 主题 */

  setTheme(name: string): void {
    const th = THEMES[name] || THEMES.dark;
    this.o.bgColor = th.bg;
    this.o.gridColor = th.grid;
    this.o.axisTextColor = th.axisText;
    this.o.crossColor = th.cross;
    this.o.titleColor = name === 'light' ? '#f23645' : th.title;
    this.invalidate();
  }

  /* ------------------------------------------------------ 坐标变换 */

  visible(): [number, number] {
    return [
      Math.floor(this.view.from),
      Math.ceil(this.view.from + this.plot.w / this.view.barW),
    ];
  }

  xOf(i: number): number { return this.plot.l + (i - this.view.from) * this.view.barW; }
  xCenter(i: number): number { return this.xOf(i) + this.view.barW / 2; }
  iOf(px: number): number { return this.view.from + (px - this.plot.l) / this.view.barW; }

  yOf(v: number): number {
    const s = this.scale;
    const span = s.max - s.min || 1;
    return this.plot.t + ((s.max - v) / span) * this.plot.h;
  }
  vOf(py: number): number {
    const s = this.scale;
    const span = s.max - s.min || 1;
    return s.max - ((py - this.plot.t) / this.plot.h) * span;
  }

  /** 二分：返回 time <= t 的最后一根 */
  indexAtTime(t: number): number {
    const b = this.points;
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

  viewTimes(): [number, number] | null {
    const n = this.points.length;
    if (!n) return null;
    const vis = this.plot.w / this.view.barW;
    const i0 = clamp(Math.round(this.view.from), 0, n - 1);
    const i1 = clamp(Math.round(this.view.from + vis), 0, n - 1);
    return [this.points[i0].time, this.points[i1].time];
  }

  setViewTimes(t0: number, t1: number): void {
    const n = this.points.length;
    if (!n || !(t1 > t0)) return;
    const a = this.indexAtTime(t0);
    const b = this.indexAtTime(t1);
    const span = Math.max(1, b - a + 1);
    this.view.barW = clamp(this.plot.w / span, 0.5, 60);
    this.view.from = a;
    this.clampView();
    this.invalidate();
  }

  viewSpan(): number {
    const vt = this.viewTimes();
    return vt ? vt[1] - vt[0] : 0;
  }

  private computePlot(): { l: number; t: number; r: number; b: number; w: number; h: number } {
    const titleH = this.o.title ? 26 : 8;
    const l = 8;
    const t = titleH;
    const r = Math.max(1, this.W - this.o.axisWidth);
    const b = Math.max(1, this.H - this.o.axisHeight);
    return { l, t, r, b, w: Math.max(1, r - l), h: Math.max(1, b - t) };
  }

  private clampView(): void {
    const vis = this.plot.w / this.view.barW;
    if (this.points.length <= vis) { this.view.from = this.points.length - vis; return; }
    const minFrom = -vis * 0.15;
    const maxFrom = Math.max(minFrom, this.points.length - vis * 0.85);
    this.view.from = clamp(this.view.from, minFrom, maxFrom);
  }

  showLast(k: number): void {
    const n = this.points.length;
    if (!n) return;
    this.view.barW = clamp(this.plot.w / Math.max(1, k), 0.5, 60);
    this.view.from = n - this.plot.w / this.view.barW;
    this.clampView();
    this.invalidate();
  }

  fitContent(): void {
    const n = this.points.length;
    if (!n) return;
    this.view.barW = clamp(this.plot.w / n, 0.5, 60);
    this.view.from = Math.max(0, n - this.plot.w / this.view.barW);
    this.clampView();
    this.invalidate();
  }

  zoomAt(px: number, k: number): void {
    const anchor = this.iOf(px);
    const next = clamp(this.view.barW * k, 0.5, 60);
    if (next === this.view.barW) return;
    this.view.barW = next;
    this.view.from = anchor - (px - this.plot.l) / next;
    this.clampView();
    this.invalidate();
  }

  /** 显示范围（复用 chart.ts 的 RANGES） */
  setRange(key: string): boolean {
    const n = this.points.length;
    if (!n) return false;
    if (key === 'ALL') { this.fitContent(); return true; }
    const last = this.points[n - 1].time;
    let t0: number;
    if (key === 'YTD') {
      const d = new Date(last);
      t0 = new Date(d.getFullYear(), 0, 1).getTime();
    } else {
      let ms: number | null = null;
      for (const r of RANGES) if (r.key === key && r.ms != null) ms = r.ms;
      if (ms == null) return false;
      t0 = last - ms;
    }
    const i0 = this.indexAtTime(t0);
    if (i0 <= 0) { this.fitContent(); return false; }
    this.setViewTimes(this.points[i0].time, last);
    return true;
  }

  rangeAvailable(key: string): boolean {
    const n = this.points.length;
    if (!n) return false;
    if (key === 'ALL') return true;
    const last = this.points[n - 1].time;
    let ms: number | null = null;
    for (const r of RANGES) if (r.key === key && r.ms != null) ms = r.ms;
    if (key === 'YTD') {
      return new Date(last).getFullYear() === new Date(this.points[0].time).getFullYear() ||
        new Date(last).getFullYear() > new Date(this.points[0].time).getFullYear();
    }
    if (ms == null) return false;
    return last - ms > this.points[0].time;
  }

  private computeScale(): { min: number; max: number } {
    const [i0, i1] = this.visible();
    const lo = Math.max(0, i0);
    const hi = Math.min(this.points.length - 1, i1);
    let mn = 0;
    let mx = 0;
    for (let i = lo; i <= hi; i++) {
      const p = this.points[i];
      if (p.equity < mn) mn = p.equity;
      if (p.equity > mx) mx = p.equity;
      if (p.pnl < mn) mn = p.pnl;
      if (p.pnl > mx) mx = p.pnl;
    }
    if (mx - mn < 1e-12) mx = mn + 1;
    const pad = (mx - mn) * 0.06;
    return { min: mn - pad, max: mx + pad };
  }

  /* ---------------------------------------------------------- 事件 */

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
      this.dragging = true;
      this.dragX = e.clientX;
      try { c.setPointerCapture(e.pointerId); } catch (_e) { /* 忽略 */ }
      this.pointer = { x: e.offsetX, y: e.offsetY };
      this.invalidate();
    }, sig);

    c.addEventListener('pointermove', (e: PointerEvent) => {
      if (this.dragging) {
        const dx = e.clientX - this.dragX;
        this.dragX = e.clientX;
        this.view.from -= dx / this.view.barW;
        this.clampView();
      }
      this.pointer = { x: e.offsetX, y: e.offsetY };
      this.invalidate();
    }, sig);

    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      try { c.releasePointerCapture(e.pointerId); } catch (_e) { /* 忽略 */ }
    };
    c.addEventListener('pointerup', end, sig);
    c.addEventListener('pointercancel', end, sig);
    c.addEventListener('pointerleave', () => { this.pointer = null; this.invalidate(); }, sig);
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
    const h = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 300));
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

  invalidate(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => { this.rafId = 0; this.draw(); });
  }

  drawNow(): void {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    this.draw();
  }

  /* ---------------------------------------------------------- 渲染 */

  private tickStep(): number {
    return 1;
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

    this.drawTitle();
    this.drawGrid(i0, i1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(p.l, p.t, p.w, p.h);
    ctx.clip();
    this.drawEquityFill(i0, i1);
    this.drawZeroLine();
    this.drawPnlBars(i0, i1);
    this.drawEquityLine(i0, i1);
    this.drawPositions();
    this.drawCrosshairV();
    ctx.restore();

    this.drawValueAxis();
    this.drawTimeAxis(i0, i1);
    this.drawLastTag();
    this.drawLegend(i0, i1);
    this.drawCrosshairLabels(i0, i1);
  }

  private drawTitle(): void {
    if (!this.o.title) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = this.o.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.o.titleColor;
    ctx.fillText(this.o.title, this.plot.l, 14);
    ctx.restore();
  }

  private drawGrid(i0: number, i1: number): void {
    const ctx = this.ctx;
    const p = this.plot;
    const target = Math.max(2, Math.round(p.h / 44));
    const r = equityValueTicks(this.scale.min, this.scale.max, target);
    this.priceStep = r.step;
    ctx.save();
    ctx.strokeStyle = this.o.gridColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 3]);            // 那张参考图是点线网格
    ctx.beginPath();
    for (const v of r.ticks) {
      const y = Math.round(this.yOf(v)) + 0.5;
      if (y < p.t || y > p.b) continue;
      ctx.moveTo(p.l, y);
      ctx.lineTo(p.r, y);
    }
    // 时间刻度线不画（那张图里没有竖网格），只留底部刻度用
    ctx.stroke();
    ctx.restore();
  }

  private valueTicks(): number[] {
    const target = Math.max(2, Math.round(this.plot.h / 44));
    return equityValueTicks(this.scale.min, this.scale.max, target).ticks;
  }

  private timeTicks(i0: number, i1: number): number[] {
    const per = Math.max(1, Math.ceil(78 / this.view.barW));
    const out: number[] = [];
    const lo = Math.max(0, i0);
    const hi = Math.min(this.points.length - 1, i1);
    for (let i = Math.ceil(lo / per) * per; i <= hi; i += per) out.push(i);
    return out;
  }

  /** 0 轴与权益曲线之间的填充。截图里那层淡红就是它。 */
  private drawEquityFill(i0: number, i1: number): void {
    const ctx = this.ctx;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.points.length - 1, i1);
    if (hi < lo) return;
    const y0 = this.yOf(0);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(this.xCenter(lo), y0);
    for (let i = lo; i <= hi; i++) ctx.lineTo(this.xCenter(i), this.yOf(this.points[i].equity));
    ctx.lineTo(this.xCenter(hi), y0);
    ctx.closePath();
    ctx.globalAlpha = 0.09;
    // 填充必须跟**折线**同色。折线单色时用 up/down 色会出现
    // 「红线配绿底」这种自相矛盾的画面（我第一版就是这样）。
    ctx.fillStyle = this.colorBySign
      ? (this.points[hi].equity >= 0 ? this.upColor : this.downColor)
      : this.lineColor;
    ctx.fill();
    ctx.restore();
  }

  /** 0 轴：柱状的生长基线，画得比网格重 */
  private drawZeroLine(): void {
    const ctx = this.ctx;
    const p = this.plot;
    const y = this.yOf(0);
    if (y < p.t || y > p.b) return;
    ctx.save();
    ctx.strokeStyle = this.o.axisTextColor;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.l, Math.round(y) + 0.5);
    ctx.lineTo(p.r, Math.round(y) + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  /** 每根盈亏的柱状，从 0 轴上下生长 */
  private drawPnlBars(i0: number, i1: number): void {
    const ctx = this.ctx;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.points.length - 1, i1);
    const bw = Math.max(1, this.view.barW * this.o.barRatio);
    const y0 = this.yOf(0);
    ctx.save();
    ctx.globalAlpha = 0.42;
    for (let i = lo; i <= hi; i++) {
      const v = this.points[i].pnl;
      if (!v) continue;
      const y = this.yOf(v);
      const top = Math.min(y0, y);
      const h = Math.max(1, Math.abs(y - y0));
      ctx.fillStyle = v >= 0 ? this.upColor : this.downColor;
      ctx.fillRect(Math.round(this.xCenter(i) - bw / 2), Math.round(top), Math.max(1, Math.round(bw)), Math.round(h));
    }
    ctx.restore();
  }

  /** 权益折线 + 每根一个圆点 */
  private drawEquityLine(i0: number, i1: number): void {
    const ctx = this.ctx;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.points.length - 1, i1);
    if (hi < lo) return;
    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    if (this.colorBySign) {
      // 按正负分段上色：跨越 0 的地方在两点的中间断开
      for (let i = lo; i < hi; i++) {
        const a = this.points[i];
        const b = this.points[i + 1];
        if ((a.equity >= 0) === (b.equity >= 0)) {
          ctx.strokeStyle = a.equity >= 0 ? this.upColor : this.downColor;
          ctx.beginPath();
          ctx.moveTo(this.xCenter(i), this.yOf(a.equity));
          ctx.lineTo(this.xCenter(i + 1), this.yOf(b.equity));
          ctx.stroke();
        } else {
          const f = a.equity / (a.equity - b.equity);
          const xa = this.xCenter(i);
          const xb = this.xCenter(i + 1);
          const xm = xa + f * (xb - xa);
          const ym = this.yOf(0);
          ctx.strokeStyle = a.equity >= 0 ? this.upColor : this.downColor;
          ctx.beginPath();
          ctx.moveTo(xa, this.yOf(a.equity));
          ctx.lineTo(xm, ym);
          ctx.stroke();
          ctx.strokeStyle = b.equity >= 0 ? this.upColor : this.downColor;
          ctx.beginPath();
          ctx.moveTo(xm, ym);
          ctx.lineTo(xb, this.yOf(b.equity));
          ctx.stroke();
        }
      }
    } else {
      ctx.strokeStyle = this.lineColor;
      ctx.beginPath();
      for (let i = lo; i <= hi; i++) {
        const x = this.xCenter(i);
        const y = this.yOf(this.points[i].equity);
        if (i === lo) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // 圆点：barW 太小就不画，不然一片糊
    if (this.view.barW >= 3) {
      const r = Math.min(3, Math.max(1.6, this.view.barW * 0.18));
      for (let i = lo; i <= hi; i++) {
        const eq = this.points[i].equity;
        ctx.beginPath();
        ctx.arc(this.xCenter(i), this.yOf(eq), r, 0, Math.PI * 2);
        ctx.fillStyle = this.colorBySign ? (eq >= 0 ? this.upColor : this.downColor) : this.lineColor;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** 底部持仓色带（可选）。语义见 README，是我对截图里那条底栏的**猜测**。 */
  private drawPositions(): void {
    if (!this.positions.length) return;
    const ctx = this.ctx;
    const p = this.plot;
    const y = p.b - 1;
    ctx.save();
    for (const seg of this.positions) {
      const x0 = this.timeToX(seg.from);
      const x1 = this.timeToX(seg.to);
      if (x1 < p.l || x0 > p.r) continue;
      ctx.fillStyle = seg.long ? this.upColor : this.downColor;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(Math.max(p.l, x0), y - 2, Math.max(1, Math.min(p.r, x1) - Math.max(p.l, x0)), 2);
    }
    ctx.restore();
  }

  /** 时间 → 像素（相邻两根线性插值，和 draw.ts 一个路子） */
  timeToX(t: number): number {
    const b = this.points;
    if (!b.length) return this.plot.l;
    if (t <= b[0].time) return this.xCenter(0);
    if (t >= b[b.length - 1].time) return this.xCenter(b.length - 1);
    const i = this.indexAtTime(t);
    if (i >= b.length - 1) return this.xCenter(b.length - 1);
    const t0 = b[i].time;
    const t1 = b[i + 1].time;
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    return this.xCenter(i) + f * (this.xCenter(i + 1) - this.xCenter(i));
  }

  private snapIndex(): number | null {
    if (!this.pointer || !this.points.length) return null;
    return clamp(Math.floor(this.iOf(this.pointer.x)), 0, this.points.length - 1);
  }

  private drawCrosshairV(): void {
    const i = this.snapIndex();
    if (i == null) return;
    const ctx = this.ctx;
    const p = this.plot;
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

  private drawValueAxis(): void {
    const ctx = this.ctx;
    const p = this.plot;
    ctx.save();
    ctx.font = this.o.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.o.axisTextColor;
    for (const v of this.valueTicks()) {
      const y = this.yOf(v);
      if (y < p.t - 6 || y > p.b + 6) continue;
      ctx.fillText(fmtMoney(v, this.o.decimals, this.o.thousands), p.r + 10, Math.round(y));
    }
    ctx.restore();
  }

  private drawTimeAxis(i0: number, i1: number): void {
    const ctx = this.ctx;
    const p = this.plot;
    const lo = Math.max(0, i0);
    const hi = Math.min(this.points.length - 1, i1);
    if (hi < lo) return;
    const spanDays = (this.points[hi].time - this.points[lo].time) / 86400000;
    ctx.save();
    ctx.font = this.o.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.o.axisTextColor;
    let lastYear = -1;
    for (const i of this.timeTicks(i0, i1)) {
      const x = this.xCenter(i);
      if (x < p.l || x > p.r) continue;
      const t = this.points[i].time;
      const d = new Date(t);
      let label: string;
      // 参考图的时间轴是「跨年时打年份，其余打月/日」
      if (d.getFullYear() !== lastYear) { label = String(d.getFullYear()); lastYear = d.getFullYear(); }
      else if (spanDays > 400) label = String(d.getFullYear());
      else label = fmtTime(t, spanDays > 75 ? 100 : 0);
      ctx.fillText(label, Math.round(x), p.b + this.o.axisHeight / 2);
    }
    ctx.restore();
  }

  /** 右轴末端那个实心标签（截图里的 -66,653.91） */
  private drawLastTag(): void {
    const n = this.points.length;
    if (!n) return;
    const ctx = this.ctx;
    const p = this.plot;
    const v = this.points[n - 1].equity;
    const y = Math.round(this.yOf(v));
    if (y < p.t || y > p.b) return;
    const color = v >= 0 ? this.upColor : this.downColor;
    const label = fmtMoney(v, this.o.decimals, this.o.thousands);
    ctx.save();
    ctx.font = this.o.font;
    const tw = ctx.measureText(label).width;
    const bw = Math.max(this.o.axisWidth - 8, tw + 14);
    ctx.fillStyle = color;
    ctx.fillRect(p.r + 4, y - 9, bw, 18);
    ctx.fillStyle = this.o.bgColor;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.r + 11, y);
    ctx.restore();
  }

  private drawLegend(i0: number, i1: number): void {
    const n = this.points.length;
    if (!n) return;
    const ctx = this.ctx;
    const p = this.plot;
    const i = this.snapIndex() == null ? Math.min(n - 1, i1) : (this.snapIndex() as number);
    const pt = this.points[i];
    const prev = i > 0 ? this.points[i - 1] : pt;
    const d = pt.equity - prev.equity;
    const dec = this.o.decimals;
    ctx.save();
    ctx.font = this.o.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let x = p.l + 4;
    const y = p.t + 12;
    const put = (s: string, c: string) => {
      ctx.fillStyle = c;
      ctx.fillText(s, x, y);
      x += ctx.measureText(s).width + 12;
    };
    const dcol = d >= 0 ? this.upColor : this.downColor;
    put(fmtTime(pt.time, 100), this.o.axisTextColor);
    put('权益 ' + fmtMoney(pt.equity, dec, this.o.thousands), dcol);
    put('本根 ' + (d >= 0 ? '+' : '') + fmtMoney(d, dec, this.o.thousands), dcol);
    put('柱 ' + (pt.pnl >= 0 ? '+' : '') + fmtMoney(pt.pnl, dec, this.o.thousands),
      pt.pnl >= 0 ? this.upColor : this.downColor);
    ctx.restore();
  }

  private drawCrosshairLabels(i0: number, i1: number): void {
    const ptr = this.pointer;
    const i = this.snapIndex();
    if (!ptr && i == null) return;
    const ctx = this.ctx;
    const p = this.plot;
    ctx.save();
    ctx.font = this.o.font;
    ctx.textBaseline = 'middle';

    if (ptr && ptr.y >= p.t && ptr.y <= p.b) {
      const v = this.vOf(ptr.y);
      const label = fmtMoney(v, this.o.decimals, this.o.thousands);
      const tw = ctx.measureText(label).width;
      const y = Math.round(ptr.y);
      ctx.fillStyle = this.o.crossColor;
      ctx.fillRect(p.r + 4, y - 9, Math.max(this.o.axisWidth - 8, tw + 14), 18);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(label, p.r + 11, y);
    }

    if (i != null) {
      const lo = Math.max(0, i0);
      const hi = Math.min(this.points.length - 1, i1);
      const spanDays = hi >= lo ? (this.points[hi].time - this.points[lo].time) / 86400000 : 30;
      const label = fmtTime(this.points[i].time, spanDays > 75 ? 100 : 0);
      const tw = ctx.measureText(label).width;
      const bw = tw + 14;
      const x = clamp(this.xCenter(i), p.l + bw / 2, p.r - bw / 2);
      const y = p.b + this.o.axisHeight / 2;
      ctx.fillStyle = this.o.crossColor;
      ctx.fillRect(Math.round(x - bw / 2), Math.round(y - 9), Math.round(bw), 18);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(label, Math.round(x), Math.round(y));
    }
    ctx.restore();
  }

  /** 给无头验证用 */
  debugInfo(): string {
    const [i0, i1] = this.visible();
    const n = this.points.length;
    const last = n ? this.points[n - 1].equity : 0;
    return 'points=' + n +
      ' view.from=' + this.view.from.toFixed(2) +
      ' barW=' + this.view.barW.toFixed(2) +
      ' visible=[' + i0 + ',' + i1 + ']' +
      ' scale=[' + this.scale.min.toFixed(2) + ',' + this.scale.max.toFixed(2) + ']' +
      ' last=' + last.toFixed(2) +
      ' step=' + this.priceStep +
      ' size=' + this.W + 'x' + this.H + '@' + this.dpr + 'x';
  }
}

/* ===========================================================================
 * 4. 自检
 * ========================================================================= */

export interface EquityTestResult {
  pass: number;
  fail: number;
  names: string[];
}

export function equitySelfTest(bars?: Bar[]): EquityTestResult {
  let pass = 0;
  let fail = 0;
  const names: string[] = [];
  const t = (name: string, ok: boolean, extra: string = '') => {
    names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
    if (ok) pass++; else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };
  const near = (a: number, b: number, eps: number = 1e-9) => Math.abs(a - b) <= eps;

  // --- 金额格式 ---
  t('fmtMoney 千分位 + 负数', fmtMoney(-66653.912, 2, true) === '-66,653.91',
    fmtMoney(-66653.912, 2, true));
  t('fmtMoney 关掉千分位', fmtMoney(-66653.912, 2, false) === '-66653.91');
  t('fmtMoney 零不是 "-0.00"', fmtMoney(0, 2, true) === '0.00', fmtMoney(0, 2, true));
  t('fmtMoney 大数千分位正确', fmtMoney(1234567.891, 2, true) === '1,234,567.89',
    fmtMoney(1234567.891, 2, true));

  // --- 数值轴**必须**包含 0 ---
  const r1 = equityValueTicks(-66653, 1200, 6);
  t('数值轴刻度一定包含 0（柱状从 0 生长，没 0 图就没意义）', r1.ticks.indexOf(0) >= 0,
    '[' + r1.ticks[0] + ' … ' + r1.ticks[r1.ticks.length - 1] + '] n=' + r1.ticks.length);
  t('全正数据也包含 0', equityValueTicks(100, 5000, 5).ticks.indexOf(0) >= 0);
  t('全负数据也包含 0', equityValueTicks(-5000, -100, 5).ticks.indexOf(0) >= 0);
  t('刻度是 nice step（1/2/5×10^k）', (() => {
    const s = r1.step;
    const p = Math.pow(10, Math.floor(Math.log10(s) + 1e-9));
    const m = Math.round(s / p);
    return m === 1 || m === 2 || m === 5 || m === 10;
  })(), 'step=' + r1.step);
  t('刻度里不出现 -0（浮点毛刺会显示成 "-0.00"）',
    r1.ticks.every((v) => !(v === 0 && 1 / v === -Infinity)));

  // --- 轴范围要同时装下权益和柱状 ---
  const pts: EquityPoint[] = [
    { time: 1, equity: 0, pnl: 0 },
    { time: 2, equity: -100, pnl: -100 },
    { time: 3, equity: -50, pnl: 50 },
    { time: 4, equity: -300, pnl: -250 },   // 这一根的柱比权益还深
  ];
  const rg = equityRange(pts);
  t('轴范围同时含权益与柱状的极值', rg.lo <= -300 && rg.hi >= 0, JSON.stringify(rg));
  t('轴范围在数据全 0 时不会退化成 0 高', (() => {
    const z = equityRange([{ time: 1, equity: 0, pnl: 0 }]);
    return z.hi - z.lo >= 1;
  })());

  // --- 累计 ---
  const eq = buildEquityFromPnl([1, 2, 3, 4], [10, -30, 5, 0], 1000);
  t('buildEquityFromPnl 累计正确', eq[0].equity === 1010 && eq[1].equity === 980 &&
    eq[2].equity === 985 && eq[3].equity === 985, JSON.stringify(eq.map((p) => p.equity)));
  t('每根的 pnl 原样保留', eq[0].pnl === 10 && eq[1].pnl === -30);

  // ====================================================================
  // 下面这些需要真 canvas，**只有浏览器里能跑**。
  // 纯计算的部分（金额格式、刻度、轴范围、累计、回测）在上面，Node 里已经测过了。
  // ====================================================================
  let canvasSkipped = 0;
  if (typeof document === 'undefined') {
    canvasSkipped = 11;
    log('（跳过 ' + canvasSkipped + ' 条需要 canvas 的断言：当前不在浏览器环境）');
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 300;
    const host = document.createElement('div');
    host.style.width = '800px';
    host.style.height = '300px';
    host.appendChild(canvas);
    document.body.appendChild(host);

    const data: EquityPoint[] = [];
    for (let i = 0; i < 200; i++) {
      data.push({
        time: new Date(2020, 0, 2).getTime() + i * 86400000,
        equity: -i * 13 + Math.sin(i / 7) * 40,
        pnl: Math.cos(i / 3) * 20,
      });
    }
    const ec = new EquityChart(canvas, data, { title: 'selftest' });
    (window as any).__ec = ec;
    ec.resize();
    ec.showLast(180);
    ec.drawNow();

    t('坐标互逆：iOf(xCenter(i)) == i + 0.5',
      near(ec.iOf(ec.xCenter(37)), 37.5, 1e-6), String(ec.iOf(ec.xCenter(37))));
    t('yOf / vOf 互逆', near(ec.vOf(ec.yOf(-1234.5)), -1234.5, 1e-6));
    t('数值轴包含 0（真实组件）', ec.scale.min <= 0 && ec.scale.max >= 0,
      '[' + ec.scale.min.toFixed(2) + ',' + ec.scale.max.toFixed(2) + ']');
    t('柱状从 y(0) 生长：正 pnl 的柱子顶端在 0 轴上方', (() => {
      const y0 = ec.yOf(0);
      const yp = ec.yOf(100);
      return yp < y0;   // 屏幕 y 向下，所以「上方」是更小的 y
    })());

    const px = ec.plot.l + ec.plot.w * 0.37;
    const before = ec.iOf(px);
    ec.zoomAt(px, 1.9);
    t('放大后光标下的点索引不变', near(before, ec.iOf(px), 1e-6));
    ec.zoomAt(px, 1 / 1.9);
    t('缩小回来后仍锚定同一个点', near(before, ec.iOf(px), 1e-6));

    ec.drawNow();
    let painted = false;
    try {
      const img = ec.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const bg = [14, 17, 22];
      let ink = 0;
      for (let i = 0; i < img.length; i += 4 * 53) {
        if (Math.abs(img[i] - bg[0]) > 12 || Math.abs(img[i + 1] - bg[1]) > 12 ||
            Math.abs(img[i + 2] - bg[2]) > 12) ink++;
      }
      painted = ink > 50;
    } catch (e) {
      log('WARN  getImageData 不可用：' + String(e));
    }
    t('画布上确实画了东西（背景之外有像素）', painted);
    t('debugInfo 能报出点数与末值',
      ec.debugInfo().indexOf('points=200') >= 0 && ec.debugInfo().indexOf('last=') >= 0,
      ec.debugInfo());

    t('setRange(ALL) 末根仍在视口内', (() => {
      ec.setRange('ALL');
      const [a0, a1] = ec.visible();
      return a1 >= data.length - 1;
    })());
    t('setRange(不存在的 key) 返回 false', ec.setRange('9Z') === false);
    t('setPositions 会被记录', (() => {
      ec.setPositions([{ from: data[10].time, to: data[40].time, long: true }]);
      return ec.positions.length === 1;
    })());

    ec.dispose();
    host.remove();
  }

  // --- 回测函数 ---
  const testBars = bars && bars.length ? bars : makeBars(600, 4242, 100);
  const bt = simulateMaCross(testBars, 5, 20, 100000);
  t('回测：点数与 K 线数一致', bt.points.length === testBars.length,
    bt.points.length + ' vs ' + testBars.length);
  t('回测：每根 pnl 累加 == 末值 - 初始',
    near(bt.points.reduce((s, p) => s + p.pnl, 0), bt.netProfit, 1e-6),
    bt.points.reduce((s, p) => s + p.pnl, 0).toFixed(2) + ' vs ' + bt.netProfit.toFixed(2));
  t('回测：pnl 序列的累计与 equity 序列逐步一致', (() => {
    let acc = 100000;
    for (const p of bt.points) {
      acc += p.pnl;
      if (Math.abs(acc - p.equity) > 1e-6) return false;
    }
    return true;
  })());
  t('回测：最大回撤 >= 0', bt.maxDrawdown >= 0, bt.maxDrawdown.toFixed(2));
  t('回测：winRate 落在 [0,1]', bt.winRate >= 0 && bt.winRate <= 1, bt.winRate.toFixed(3));
  t('回测：有平仓交易（不然说明信号逻辑没跑起来）', bt.tradeCount > 0, String(bt.tradeCount));
  t('回测：笔数 == 已平仓的持仓区间数 == 逐笔收益率个数', bt.tradeCount === closedPositions(bt.positions).length &&
    bt.tradeCount === bt.tradeReturns.length, bt.tradeCount + ' vs ' + closedPositions(bt.positions).length);
  // 【回归】收尾持仓：positions 会比成交多一段（带 open 标记），不能被当成一笔成交
  {
    const up: Bar[] = [];
    let px = 100;
    for (let i = 0; i < 80; i++) {
      const c = i < 25 ? 100 : 100 + (i - 24) * 1.5;
      up.push({ time: Date.UTC(2020, 0, 2) + i * 86400000, open: px, high: Math.max(px, c) + 0.5, low: Math.min(px, c) - 0.5, close: c, volume: 100 });
      px = c;
    }
    const r = simulateMaCross(up, 5, 20, 100000);
    t('回测：末段仍持仓时 positions 比成交多一段，且多出的那段标了 open',
      r.tradeCount === 0 && r.positions.length === 1 && r.positions[0].open === true && r.tradeReturns.length === 0,
      `trades=${r.tradeCount} positions=${r.positions.length}`);
    t('回测：closedPositions 与 tradeReturns 一一对应（不产生 ret=0 的幽灵交易）',
      closedPositions(r.positions).length === r.tradeReturns.length);
  }
  // 这条是真断言：逐笔收益率**连乘**必须等于「末权益 / 初始资金」。
  // 它同时验证了收益率的分母（建仓权益而不是初始资金）和复利一致性。
  t('回测：Π(1+逐笔收益率) == 末权益 / 初始资金', (() => {
    if (!bt.tradeCount) return false;
    let prod = 1;
    for (const r of bt.tradeReturns) prod *= 1 + r;
    const expect = bt.points[bt.points.length - 1].equity / 100000;
    return Math.abs(prod - expect) <= Math.abs(expect) * 1e-6 + 1e-9;
  })(), (() => {
    let prod = 1;
    for (const r of bt.tradeReturns) prod *= 1 + r;
    return 'prod=' + prod.toFixed(6) + ' expect=' +
      (bt.points[bt.points.length - 1].equity / 100000).toFixed(6);
  })());
  // 这条专门盯 entryEquity 记成 start 的那个 bug：
  // 记错了的话每笔盈亏是「相对初始资金」，累加起来会比净利大一个数量级。
  t('回测：逐笔盈亏之和与净利同量级（±30% + 100）', (() => {
    const sum = (bt.trades || []).reduce((a, b) => a + b, 0);
    return Math.abs(sum - bt.netProfit) <= Math.abs(bt.netProfit) * 0.3 + 100;
  })(), (() => {
    const sum = (bt.trades || []).reduce((a, b) => a + b, 0);
    return 'sum=' + sum.toFixed(0) + ' net=' + bt.netProfit.toFixed(0);
  })());
  t('回测：胜率不是 100%（全胜通常意味着盈亏口径算错了）',
    bt.winRate < 1 || bt.tradeCount <= 1, bt.winRate.toFixed(3));
  t('回测：持仓区间有序且首尾合法', (() => {
    for (let i = 1; i < bt.positions.length; i++) {
      if (bt.positions[i].from < bt.positions[i - 1].to) return false;
    }
    return bt.positions.every((p) => p.to >= p.from);
  })());

  log('权益图自检：' + pass + ' PASS / ' + fail + ' FAIL' +
    (canvasSkipped ? '（另有 ' + canvasSkipped + ' 条需要 canvas，本次跳过）' : ''));
  return { pass, fail, names };
}
