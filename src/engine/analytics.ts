/**
 * tv-chart / analytics.ts
 * ---------------------------------------------------------------------------
 * 三个统计组件：收益分布直方图 / 交易环形图 / 季节性多年份叠加线。
 *
 * 依赖 chart.ts（复用 clamp / niceStep / log / Bar）。
 *
 * 三者共用的东西抽出来了：主题色、圆角气泡、图例小圆点、canvas/DPR 样板。
 *
 * ============================ 三个关键点 ============================
 * ① **直方图的 x 轴标签是「整百分比刻度」，不是箱边界。**
 *    10 个箱不等于 10 个标签 —— 参考图里 10 个箱子只标了 7 个标签（-15…15，步长 5%）。
 *    箱边界是数据决定的，标签是 niceStep 决定的，两者独立。
 *
 * ② **环形图的弧段从 12 点方向顺时针。** 不是从 3 点、也不是逆时针。
 *    角度→命中判定的换算必须和这个起点一致，否则点击高亮会整体偏 90°。
 *
 * ③ **Seasonals 的 x 轴是「日历日序」，不是时间戳，也不是年内第几天。**
 *    这是它和普通折线图的根本区别：2024/2025/2026 三条线的 x 是同一套 0..364，
 *    跟绝对时间无关。用 `calendarDoy`（忽略闰年）而不是 `dayOfYear` ——
 *    否则闰年会让整条线错开一天，「同一天对齐」这个前提就没了。
 * ===========================================================================
 */

import { Bar, clamp, log, makeBars, niceStep } from './chart';

/* ===========================================================================
 * 1. 主题与共用绘制
 * ========================================================================= */

export interface AnalyticsTheme {
  bg: string;
  text: string;
  dim: string;
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipText: string;
  up: string;
  down: string;
  neutral: string;
  font: string;
}

export const ANALYTICS_THEMES: { [k: string]: AnalyticsTheme } = {
  light: {
    bg: '#ffffff',
    text: '#131722',
    dim: '#787b86',
    grid: '#f0f3fa',
    axis: '#d1d4dc',
    tooltipBg: '#2a2e39',
    tooltipText: '#ffffff',
    up: '#089981',
    down: '#f23645',
    neutral: '#ff9800',
    font: '13px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  },
  dark: {
    bg: '#131722',
    text: '#e6edf3',
    dim: '#9aa4b2',
    grid: 'rgba(255,255,255,0.07)',
    axis: '#2a2e39',
    tooltipBg: '#e6edf3',
    tooltipText: '#131722',
    up: '#26a69a',
    down: '#ef5350',
    neutral: '#ff9800',
    font: '13px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
  },
};

/** 圆角矩形路径。不依赖 ctx.roundRect（老浏览器没有）。 */
export function pathRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export interface TipLine {
  text: string;
  color?: string;
  /** 右侧对齐的第二列（用于「27 trades  81.82%」这种） */
  right?: string;
  dot?: string;
}

/**
 * 深色圆角气泡 + 下方小三角。
 * 会自动左右夹紧不出画布；不会自动翻转上下（这三个组件的气泡都在上方）。
 * 返回占用的矩形，方便调用方判断有没有画到边界外。
 */
export function drawTip(ctx: CanvasRenderingContext2D, th: AnalyticsTheme,
                 cx: number, cy: number, lines: TipLine[], W: number): { x: number; y: number; w: number; h: number } {
  const padX = 14;
  const padY = 10;
  const lineH = 24;
  const dotR = 5;
  ctx.save();
  ctx.font = th.font;
  let maxW = 0;
  for (const l of lines) {
    let w = ctx.measureText(l.text).width;
    if (l.dot) w += dotR * 2 + 8;
    if (l.right) w += 24 + ctx.measureText(l.right).width;
    if (w > maxW) maxW = w;
  }
  const w = Math.ceil(maxW + padX * 2);
  const h = Math.ceil(lines.length * lineH + padY * 2);
  let x = cx - w / 2;
  x = clamp(x, 4, Math.max(4, W - w - 4));
  const y = cy - h - 10;

  pathRoundRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = th.tooltipBg;
  ctx.fill();

  // 小三角
  const tx = clamp(cx, x + 14, x + w - 14);
  ctx.beginPath();
  ctx.moveTo(tx - 7, y + h - 0.5);
  ctx.lineTo(tx, y + h + 8);
  ctx.lineTo(tx + 7, y + h - 0.5);
  ctx.closePath();
  ctx.fill();

  ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const ly = y + padY + lineH * i + lineH / 2;
    let lx = x + padX;
    if (l.dot) {
      ctx.beginPath();
      ctx.arc(lx + dotR, ly, dotR, 0, Math.PI * 2);
      ctx.fillStyle = l.dot;
      ctx.fill();
      lx += dotR * 2 + 8;
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = l.color || th.tooltipText;
    ctx.fillText(l.text, lx, ly);
    if (l.right) {
      ctx.textAlign = 'right';
      ctx.fillStyle = th.tooltipText;
      ctx.fillText(l.right, x + w - padX, ly);
    }
  }
  ctx.restore();
  return { x, y, w, h };
}

/** 图例小圆点 + 文字，返回下一个 x */
export function drawLegendDot(ctx: CanvasRenderingContext2D, th: AnalyticsTheme,
                       x: number, y: number, color: string, text: string, dim?: boolean): number {
  ctx.save();
  ctx.font = th.font;
  ctx.beginPath();
  ctx.arc(x + 5, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = dim ? th.dim : th.text;
  ctx.fillText(text, x + 16, y + 1);
  const w = 16 + ctx.measureText(text).width;
  ctx.restore();
  return x + w + 22;
}

/* ===========================================================================
 * 2. 纯计算（Node 里可测）
 * ========================================================================= */

export interface HistBin {
  from: number;
  to: number;
  count: number;
}

export interface Histogram {
  bins: HistBin[];
  lo: number;
  hi: number;
  total: number;
  maxCount: number;
}

/**
 * 等宽分箱。
 * 边界规则：**左闭右开，最后一个箱右闭** —— 否则等于最大值的样本会掉到所有箱外面。
 * 这是直方图最经典的 off-by-one。
 */
export function histogram(values: number[], binCount: number, lo?: number, hi?: number): Histogram {
  const n = Math.max(1, Math.round(binCount));
  const vals = values.filter((v) => isFinite(v));
  let a = lo;
  let b = hi;
  if (a == null || b == null) {
    a = vals.length ? Math.min.apply(null, vals) : 0;
    b = vals.length ? Math.max.apply(null, vals) : 1;
  }
  if (!(b > a)) { b = a + 1; }
  const w = (b - a) / n;
  const bins: HistBin[] = [];
  for (let i = 0; i < n; i++) bins.push({ from: a + i * w, to: a + (i + 1) * w, count: 0 });
  for (const v of vals) {
    if (v < a || v > b) continue;
    let k = Math.floor((v - a) / w);
    if (k >= n) k = n - 1;      // 右闭
    if (k < 0) k = 0;
    bins[k].count++;
  }
  let mx = 0;
  for (const x of bins) if (x.count > mx) mx = x.count;
  return { bins, lo: a, hi: b, total: vals.length, maxCount: mx };
}

export interface WinLoss {
  winners: number[];
  losers: number[];
  breakevens: number[];
  avgProfit: number | null;
  avgLoss: number | null;
  winRate: number;
  lossRate: number;
  breakevenRate: number;
}

/** 按盈亏分组并算均值。`eps` 是「算平局」的阈值（收益率常有 1e-9 级噪声）。 */
export function avgWinLoss(values: number[], eps: number = 1e-9): WinLoss {
  const winners: number[] = [];
  const losers: number[] = [];
  const breakevens: number[] = [];
  for (const v of values) {
    if (!isFinite(v)) continue;
    if (v > eps) winners.push(v);
    else if (v < -eps) losers.push(v);
    else breakevens.push(v);
  }
  const mean = (a: number[]): number | null => {
    if (!a.length) return null;
    let s = 0;
    for (const x of a) s += x;
    return s / a.length;
  };
  const total = winners.length + losers.length + breakevens.length;
  return {
    winners, losers, breakevens,
    avgProfit: mean(winners),
    avgLoss: mean(losers),
    winRate: total ? winners.length / total : 0,
    lossRate: total ? losers.length / total : 0,
    breakevenRate: total ? breakevens.length / total : 0,
  };
}

export interface DonutArc {
  start: number;   // 弧度，12 点方向为 -PI/2
  end: number;
  pct: number;
}

/** 弧段角度：**从 12 点方向顺时针**。顺序与 slices 一致。 */
export function donutArcs(slices: { value: number }[]): DonutArc[] {
  let total = 0;
  for (const s of slices) if (isFinite(s.value) && s.value > 0) total += s.value;
  const out: DonutArc[] = [];
  let a = -Math.PI / 2;
  for (const s of slices) {
    const v = isFinite(s.value) && s.value > 0 ? s.value : 0;
    const pct = total > 0 ? v / total : 0;
    const sweep = pct * Math.PI * 2;
    out.push({ start: a, end: a + sweep, pct });
    a += sweep;
  }
  return out;
}

/** 一年中的第几天（0-based），**含闰年差异**。 */
export function dayOfYear(t: number): number {
  const d = new Date(t);
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime() + (start.getTimezoneOffset() - d.getTimezoneOffset()) * 60000) / 86400000);
}

/** 非闰年各月的累计天数，给 calendarDoy 用 */
export const MONTH_CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/**
 * **日历日序**（0..364），忽略闰年。
 *
 * ⚠️ 这是 Seasonals 该用的那个，不是 dayOfYear。
 * 用 dayOfYear 的话：2024-06-15 是第 166 天、2026-06-15 是第 165 天，
 * 两条线会整体错开一格 —— 而 seasonals 图的全部意义就是「同一天对齐比较」。
 *
 * 代价：闰年的 2/29 和 3/1 会落到同一个 x（因为只有 365 个槽）。
 * 这是日历对齐的固有取舍，不是 bug。
 */
export function calendarDoy(t: number): number {
  const d = new Date(t);
  return MONTH_CUM[d.getMonth()] + d.getDate() - 1;
}

export function daysInYear(y: number): number {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
}

/**
 * 把日线按年份拆成多条「年内累计收益」曲线 —— Seasonals 的数据准备。
 * 每年**从该年第一根收盘算起**，所以每条线在第 0 天都从 0 出发。
 * 这正是 seasonals 图能叠加比较的前提。
 */
export function seasonalSeries(bars: Bar[], colors?: string[]): SeasonSeries[] {
  const pal = colors && colors.length ? colors : ['#2962ff', '#089981', '#ff9800', '#f23645', '#9c27b0', '#00bcd4'];
  const byYear: { [k: string]: Bar[] } = {};
  const order: string[] = [];
  for (const b of bars) {
    const y = String(new Date(b.time).getFullYear());
    if (!byYear[y]) { byYear[y] = []; order.push(y); }
    byYear[y].push(b);
  }
  order.sort();
  const out: SeasonSeries[] = [];
  for (let i = 0; i < order.length; i++) {
    const y = order[i];
    const list = byYear[y];
    if (list.length < 2) continue;
    const base = list[0].close;
    const points: { time: number; value: number }[] = [];
    for (const b of list) {
      points.push({ time: b.time, value: base ? b.close / base - 1 : 0 });
    }
    out.push({ year: y, color: pal[(order.length - 1 - i) % pal.length], points });
  }
  return out;
}

/* ===========================================================================
 * 3. 收益分布直方图
 * ========================================================================= */

export interface ReturnsOptions {
  title?: string;
  theme?: string;
  binCount?: number;
  /** 左上 / 右上的两行摘要 */
  leftStat?: TipLine[];
  rightStat?: TipLine[];
  decimals?: number;
  /** 高亮的箱下标（外部指定；鼠标悬停会覆盖它） */
  highlight?: number;
  /**
   * 分箱范围是否**关于 0 对称**（默认 true）。
   * 收益分布里 0 是「赢/亏分界」，不居中的话一侧会被压扁、另一侧拉长，
   * 两个方向就没法直观比较了。
   */
  symmetric?: boolean;
}

export class ReturnsChart {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  th: AnalyticsTheme;
  o: Required<ReturnsOptions>;
  values: number[];
  hist: Histogram;
  /** 平均值线（比例，不是百分比字符串） */
  avgLoss: number | null = null;
  avgProfit: number | null = null;

  W: number;
  H: number;
  dpr: number;
  pad: { l: number; r: number; t: number; b: number };
  hoverBin: number | null;

  private pointer: { x: number; y: number } | null = null;
  private rafId = 0;
  private ac: AbortController;
  private ro: ResizeObserver | null = null;

  constructor(target: HTMLCanvasElement | string, values?: number[], options?: ReturnsOptions) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(el instanceof HTMLCanvasElement)) throw new Error('ReturnsChart: 需要 <canvas>');
    this.canvas = el;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('ReturnsChart: 无法获取 2d context');
    this.ctx = ctx;
    this.o = Object.assign({
      title: '', theme: 'light', binCount: 10,
      leftStat: [] as TipLine[], rightStat: [] as TipLine[],
      decimals: 2, highlight: -1, symmetric: true,
    }, options || {});
    this.th = ANALYTICS_THEMES[this.o.theme] || ANALYTICS_THEMES.light;
    this.values = [];
    this.hist = histogram([], this.o.binCount);
    this.W = 0; this.H = 0; this.dpr = 1;
    this.pad = { l: 14, r: 44, t: 96, b: 62 };
    this.hoverBin = this.o.highlight >= 0 ? this.o.highlight : null;
    this.ac = new AbortController();
    el.style.display = 'block';
    this.setData(values || [], null, null);
    this.bind();
    this.resize();
  }

  setData(values: number[], avgLoss?: number | null, avgProfit?: number | null): void {
    this.values = (values || []).slice();
    const wl = avgWinLoss(this.values);
    this.avgLoss = avgLoss === undefined ? wl.avgLoss : avgLoss;
    this.avgProfit = avgProfit === undefined ? wl.avgProfit : avgProfit;
    let lo: number | undefined;
    let hi: number | undefined;
    if (this.o.symmetric && this.values.length) {
      let m = 0;
      for (const v of this.values) if (isFinite(v)) m = Math.max(m, Math.abs(v));
      if (m > 0) { lo = -m; hi = m; }
    }
    this.hist = histogram(this.values, this.o.binCount, lo, hi);
    this.invalidate();
  }

  setTheme(name: string): void {
    this.o.theme = name;
    this.th = ANALYTICS_THEMES[name] || ANALYTICS_THEMES.light;
    this.invalidate();
  }

  /* ---- 坐标 ---- */
  private plotW(): number { return Math.max(1, this.W - this.pad.l - this.pad.r); }
  private plotH(): number { return Math.max(1, this.H - this.pad.t - this.pad.b); }
  /** 收益率 → 像素 x */
  xOf(v: number): number {
    const span = this.hist.hi - this.hist.lo || 1;
    return this.pad.l + ((v - this.hist.lo) / span) * this.plotW();
  }
  /** 像素 x → 收益率 */
  vOf(px: number): number {
    const span = this.hist.hi - this.hist.lo || 1;
    return this.hist.lo + ((px - this.pad.l) / this.plotW()) * span;
  }
  /** 计数 → 像素 y */
  yOf(c: number): number {
    const m = this.hist.maxCount || 1;
    return this.pad.t + this.plotH() * (1 - c / m);
  }

  private bind(): void {
    const c = this.canvas;
    const sig = { signal: this.ac.signal };
    c.addEventListener('pointermove', (e: PointerEvent) => {
      this.pointer = { x: e.offsetX, y: e.offsetY };
      this.hoverBin = this.binAt(e.offsetX);
      this.invalidate();
    }, sig);
    c.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.hoverBin = this.o.highlight >= 0 ? this.o.highlight : null;
      this.invalidate();
    }, sig);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(c);
    } else {
      window.addEventListener('resize', () => this.resize(), sig);
    }
  }

  /** 像素 x 命中哪个箱；不在绘图区内返回 null */
  binAt(px: number): number | null {
    const p = this.pad;
    if (px < p.l || px > this.W - p.r) return null;
    const v = this.vOf(px);
    const n = this.hist.bins.length;
    if (!n) return null;
    const w = (this.hist.hi - this.hist.lo) / n;
    let k = Math.floor((v - this.hist.lo) / w);
    if (k >= n) k = n - 1;
    if (k < 0) k = 0;
    return k;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 600));
    const h = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 340));
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.W = w; this.H = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
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

  /* ---- 绘制 ---- */
  private draw(): void {
    const ctx = this.ctx;
    const th = this.th;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, this.W, this.H);

    const p = this.pad;
    const pw = this.plotW();
    const ph = this.plotH();
    const x0 = p.l;
    const x1 = this.W - p.r;
    const yBase = p.t + ph;

    // ---- 顶部摘要（左 / 右）----
    ctx.font = th.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let yy = 22;
    for (const ln of this.o.leftStat) {
      ctx.font = '500 15px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = ln.color || th.text;
      ctx.fillText(ln.text, p.l, yy);
      if (ln.right) {
        ctx.fillStyle = th.dim;
        ctx.fillText(ln.right, p.l + ctx.measureText(ln.text).width + 10, yy);
      }
      yy += 22;
    }
    yy = 22;
    for (const ln of this.o.rightStat) {
      ctx.font = '500 15px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      let rx = x1;
      if (ln.right) {
        ctx.fillStyle = th.dim;
        ctx.fillText(ln.right, rx, yy);
        rx -= ctx.measureText(ln.right).width + 10;
      }
      ctx.fillStyle = ln.color || th.text;
      ctx.fillText(ln.text, rx, yy);
      yy += 22;
    }
    ctx.textAlign = 'left';

    // ---- 标题 ----
    if (this.o.title) {
      ctx.font = '600 17px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = th.text;
      ctx.fillText(this.o.title, p.l, p.t - 34);
    }

    // ---- 水平网格 + 右侧刻度（整数计数）----
    const maxC = this.hist.maxCount || 1;
    const stepC = niceStep(maxC / Math.max(1, Math.round(ph / 60)));
    ctx.font = th.font;
    ctx.textAlign = 'left';
    for (let c = 0; c <= maxC + 1e-9; c += stepC) {
      const y = Math.round(this.yOf(c)) + 0.5;
      if (y < p.t - 1 || y > yBase + 1) continue;
      ctx.strokeStyle = th.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillStyle = th.dim;
      ctx.fillText(String(Math.round(c)), x1 + 12, y);
    }

    // ---- 悬停高亮带（在柱子下面）----
    if (this.hoverBin != null && this.hist.bins[this.hoverBin]) {
      const b = this.hist.bins[this.hoverBin];
      const bx0 = this.xOf(b.from);
      const bx1 = this.xOf(b.to);
      ctx.fillStyle = this.o.theme === 'light' ? '#f7f8fa' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(bx0, p.t, bx1 - bx0, ph);
    }

    // ---- 柱子 ----
    const n = this.hist.bins.length;
    const gap = Math.max(2, pw / n * 0.16);
    for (let i = 0; i < n; i++) {
      const b = this.hist.bins[i];
      if (!b.count) continue;
      const bx0 = this.xOf(b.from) + gap / 2;
      const bx1 = this.xOf(b.to) - gap / 2;
      const y = this.yOf(b.count);
      const mid = (b.from + b.to) / 2;
      ctx.fillStyle = mid >= 0 ? th.up : th.down;
      ctx.fillRect(Math.round(bx0), Math.round(y), Math.max(1, Math.round(bx1 - bx0)), Math.round(yBase - y));
    }

    // ---- 0 轴 ----
    ctx.strokeStyle = th.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, Math.round(yBase) + 0.5);
    ctx.lineTo(x1, Math.round(yBase) + 0.5);
    ctx.stroke();

    // ---- 平均盈亏虚线 ----
    this.drawAvgLine(this.avgProfit, th.up, '平均盈利');
    this.drawAvgLine(this.avgLoss, th.down, '平均亏损');

    // ---- x 轴标签：**整百分比刻度**，不是箱边界 ----
    const span = this.hist.hi - this.hist.lo;
    const stepPct = niceStep(span / 5);
    ctx.textAlign = 'center';
    ctx.fillStyle = th.dim;
    ctx.font = th.font;
    const first = Math.ceil(this.hist.lo / stepPct) * stepPct;
    for (let v = first; v <= this.hist.hi + 1e-9; v += stepPct) {
      const x = this.xOf(v);
      if (x < x0 - 1 || x > x1 + 1) continue;
      const pct = v * 100;
      const label = (Math.abs(pct) < 1e-9 ? '0' : (pct > 0 ? '' : '-') + Math.abs(pct).toFixed(0)) + '%';
      ctx.fillText(label, Math.round(x), yBase + 24);
    }

    // ---- 图例 ----
    const ly = this.H - 22;
    let lx = p.l;
    lx = drawLegendDot(ctx, th, lx, ly, th.down, '亏损');
    lx = drawLegendDot(ctx, th, lx, ly, th.up, '盈利');
    // 右侧：均值
    ctx.font = th.font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    let rx = x1;
    const avg = (color: string, text: string) => {
      ctx.fillStyle = color;
      ctx.fillText(text, rx, ly);
      rx -= ctx.measureText(text).width + 8;
      // 虚线小样
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(rx - 20, ly);
      ctx.lineTo(rx, ly);
      ctx.stroke();
      ctx.restore();
      rx -= 28;
    };
    if (this.avgProfit != null) avg(th.up, '平均盈利 ' + (this.avgProfit * 100).toFixed(2) + '%');
    if (this.avgLoss != null) avg(th.down, '平均亏损 ' + (this.avgLoss * 100).toFixed(2) + '%');

    // ---- 悬停气泡 ----
    if (this.hoverBin != null && this.pointer && this.hist.bins[this.hoverBin]) {
      const b = this.hist.bins[this.hoverBin];
      const cx = (this.xOf(b.from) + this.xOf(b.to)) / 2;
      drawTip(ctx, th, cx, p.t + 6, [
        { text: '区间', right: (b.from * 100).toFixed(2) + '% — ' + (b.to * 100).toFixed(2) + '%' },
        { text: '交易数', right: String(b.count) },
      ], this.W);
    }
  }

  private drawAvgLine(v: number | null, color: string, label: string): void {
    if (v == null || !isFinite(v)) return;
    const ctx = this.ctx;
    const p = this.pad;
    const x = this.xOf(v);
    if (x < p.l || x > this.W - p.r) return;
    const yBase = p.t + this.plotH();
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, p.t);
    ctx.lineTo(Math.round(x) + 0.5, yBase);
    ctx.stroke();
    ctx.restore();
  }

  debugInfo(): string {
    return 'values=' + this.values.length + ' bins=' + this.hist.bins.length +
      ' range=[' + (this.hist.lo * 100).toFixed(2) + '%,' + (this.hist.hi * 100).toFixed(2) + '%]' +
      ' maxCount=' + this.hist.maxCount +
      ' avgProfit=' + (this.avgProfit == null ? 'na' : (this.avgProfit * 100).toFixed(2) + '%') +
      ' avgLoss=' + (this.avgLoss == null ? 'na' : (this.avgLoss * 100).toFixed(2) + '%') +
      ' hover=' + (this.hoverBin == null ? '-' : this.hoverBin) +
      ' size=' + this.W + 'x' + this.H + '@' + this.dpr + 'x';
  }
}

/* ===========================================================================
 * 4. 交易分布环形图
 * ========================================================================= */

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export interface DonutOptions {
  title?: string;
  theme?: string;
  centerLabel?: string;
  innerRatio?: number;
  highlight?: number;
}

export class DonutChart {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  th: AnalyticsTheme;
  o: Required<DonutOptions>;
  slices: DonutSlice[];
  title: string;

  W: number;
  H: number;
  dpr: number;
  hoverSlice: number | null;
  R: number;
  CX: number;
  CY: number;
  inner: number;

  private pointer: { x: number; y: number } | null = null;
  private rafId = 0;
  private ac: AbortController;
  private ro: ResizeObserver | null = null;

  constructor(target: HTMLCanvasElement | string, slices?: DonutSlice[], options?: DonutOptions) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(el instanceof HTMLCanvasElement)) throw new Error('DonutChart: 需要 <canvas>');
    this.canvas = el;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('DonutChart: 无法获取 2d context');
    this.ctx = ctx;
    this.o = Object.assign({
      title: '', theme: 'light', centerLabel: '', innerRatio: 0.62, highlight: -1,
    }, options || {});
    this.th = ANALYTICS_THEMES[this.o.theme] || ANALYTICS_THEMES.light;
    this.slices = [];
    this.title = this.o.title;
    this.W = 0; this.H = 0; this.dpr = 1;
    this.R = 10; this.CX = 0; this.CY = 0; this.inner = 6;
    this.hoverSlice = this.o.highlight >= 0 ? this.o.highlight : null;
    this.ac = new AbortController();
    el.style.display = 'block';
    this.setData(slices || []);
    this.bind();
    this.resize();
  }

  setData(slices: DonutSlice[]): void {
    this.slices = (slices || []).map((s) => ({
      label: s.label, value: s.value, color: s.color,
    }));
    this.invalidate();
  }

  setTheme(name: string): void {
    this.o.theme = name;
    this.th = ANALYTICS_THEMES[name] || ANALYTICS_THEMES.light;
    this.invalidate();
  }

  total(): number {
    let t = 0;
    for (const s of this.slices) if (s.value > 0) t += s.value;
    return t;
  }

  private bind(): void {
    const c = this.canvas;
    const sig = { signal: this.ac.signal };
    c.addEventListener('pointermove', (e: PointerEvent) => {
      this.pointer = { x: e.offsetX, y: e.offsetY };
      this.hoverSlice = this.sliceAt(e.offsetX, e.offsetY);
      this.invalidate();
    }, sig);
    c.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.hoverSlice = this.o.highlight >= 0 ? this.o.highlight : null;
      this.invalidate();
    }, sig);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(c);
    } else {
      window.addEventListener('resize', () => this.resize(), sig);
    }
  }

  /**
   * 命中哪个弧段。
   * ⚠️ 角度换算必须和 donutArcs 的起点一致（12 点方向、顺时针），
   * 否则整体偏 90° —— 点右边的弧却高亮上面的。
   */
  sliceAt(px: number, py: number): number | null {
    const dx = px - this.CX;
    const dy = py - this.CY;
    const d = Math.hypot(dx, dy);
    if (d < this.inner) return null;         // 挖空处不算
    if (d > this.R + 12) return null;
    let a = Math.atan2(dy, dx);              // (-PI, PI]，3 点方向为 0
    // 转到「12 点方向为 -PI/2」的同一套：atan2 已经把 12 点算成 -PI/2，直接比
    const arcs = donutArcs(this.slices);
    for (let i = 0; i < arcs.length; i++) {
      let s = arcs[i].start;
      let e = arcs[i].end;
      // 把 a 归一到 [s, s+2PI)
      while (a < s) a += Math.PI * 2;
      while (a >= s + Math.PI * 2) a -= Math.PI * 2;
      if (a >= s && a < e) return i;
    }
    return null;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 760));
    const h = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 320));
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.W = w; this.H = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
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

  private draw(): void {
    const ctx = this.ctx;
    const th = this.th;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, this.W, this.H);

    // 标题
    if (this.o.title) {
      ctx.font = '600 17px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = th.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.o.title, 26, 30);
    }

    // 环的圆心/半径：靠左，给右边图例留位置
    const cy = this.H / 2 + 8;
    const R = Math.max(20, Math.min(this.H / 2 - 30, this.W * 0.22));
    this.R = R;
    this.CX = 30 + R;
    this.CY = cy;
    this.inner = R * this.o.innerRatio;

    const arcs = donutArcs(this.slices);
    const total = this.total();

    // 高亮段的外圈光晕
    if (this.hoverSlice != null && arcs[this.hoverSlice]) {
      const a = arcs[this.hoverSlice];
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = this.slices[this.hoverSlice].color;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.arc(this.CX, this.CY, R + 6, a.start, a.end);
      ctx.stroke();
      ctx.restore();
    }

    // 弧段
    const lw = R - this.inner;
    const rm = (R + this.inner) / 2;
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i];
      if (a.pct <= 0) continue;
      ctx.beginPath();
      ctx.strokeStyle = this.slices[i].color;
      ctx.lineWidth = lw;
      ctx.arc(this.CX, this.CY, rm, a.start, a.end);
      ctx.stroke();
    }

    // 中心数字
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = th.text;
    ctx.font = '600 30px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText(String(total), this.CX, this.CY - 8);
    ctx.font = th.font;
    ctx.fillStyle = th.dim;
    ctx.fillText(this.o.centerLabel || '总交易数', this.CX, this.CY + 18);

    // 右侧图例表：色点 + 名称 + "N trades" + 百分比
    const lx = this.CX + R + 54;
    const rowH = 34;
    let ly = this.CY - (this.slices.length - 1) * rowH / 2;
    const nameW = 96;
    const cntW = 92;
    for (const s of this.slices) {
      const pct = total > 0 ? s.value / total : 0;
      ctx.beginPath();
      ctx.arc(lx + 6, ly, 6, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = th.font;
      ctx.fillStyle = th.text;
      ctx.fillText(s.label, lx + 20, ly);
      ctx.textAlign = 'right';
      ctx.fillStyle = th.text;
      ctx.fillText(s.value + ' 笔', lx + nameW + cntW, ly);
      ctx.fillStyle = th.dim;
      ctx.fillText((pct * 100).toFixed(2) + '%', lx + nameW + cntW + 92, ly);
      ly += rowH;
    }

    // 气泡
    if (this.hoverSlice != null && this.pointer && this.slices[this.hoverSlice]) {
      const s = this.slices[this.hoverSlice];
      const pct = total > 0 ? s.value / total : 0;
      const mid = (arcs[this.hoverSlice].start + arcs[this.hoverSlice].end) / 2;
      const tipX = this.CX + Math.cos(mid) * (this.R + 30);
      const tipY = this.CY + Math.sin(mid) * (this.R + 30) - 40;
      drawTip(ctx, th, clamp(tipX, 90, this.W - 90), clamp(tipY, 60, this.H - 40), [
        { text: s.label, dot: s.color },
        { text: s.value + ' trades  (' + (pct * 100).toFixed(2) + '%)' },
      ], this.W);
    }
  }

  debugInfo(): string {
    return 'slices=' + this.slices.length + ' total=' + this.total() +
      ' R=' + this.R.toFixed(1) + ' inner=' + this.inner.toFixed(1) +
      ' center=(' + this.CX.toFixed(0) + ',' + this.CY.toFixed(0) + ')' +
      ' hover=' + (this.hoverSlice == null ? '-' : this.hoverSlice) +
      ' size=' + this.W + 'x' + this.H + '@' + this.dpr + 'x';
  }
}

/* ===========================================================================
 * 5. 季节性多年份叠加线
 * ========================================================================= */

export interface SeasonSeries {
  year: string;
  color: string;
  /** 点的 time 只用来算「一年中的第几天」，年份本身不影响 x */
  points: { time: number; value: number }[];
}

export interface SeasonOptions {
  title?: string;
  theme?: string;
  header?: string;
  /** y 轴显示成百分比 */
  asPercent?: boolean;
  decimals?: number;
  valueSuffix?: string;
}

export class SeasonalsChart {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  th: AnalyticsTheme;
  o: Required<SeasonOptions>;
  series: SeasonSeries[];

  W: number;
  H: number;
  dpr: number;
  pad: { l: number; r: number; t: number; b: number };
  lo: number;
  hi: number;
  hoverDoy: number | null;

  private pointer: { x: number; y: number } | null = null;
  private rafId = 0;
  private ac: AbortController;
  private ro: ResizeObserver | null = null;

  constructor(target: HTMLCanvasElement | string, series?: SeasonSeries[], options?: SeasonOptions) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(el instanceof HTMLCanvasElement)) throw new Error('SeasonalsChart: 需要 <canvas>');
    this.canvas = el;
    const ctx = el.getContext('2d');
    if (!ctx) throw new Error('SeasonalsChart: 无法获取 2d context');
    this.ctx = ctx;
    this.o = Object.assign({
      title: '', theme: 'light', header: '', asPercent: true, decimals: 2, valueSuffix: '',
    }, options || {});
    this.th = ANALYTICS_THEMES[this.o.theme] || ANALYTICS_THEMES.light;
    this.series = [];
    this.W = 0; this.H = 0; this.dpr = 1;
    this.pad = { l: 16, r: 24, t: 74, b: 74 };
    this.lo = -1; this.hi = 1;
    this.hoverDoy = null;
    this.ac = new AbortController();
    el.style.display = 'block';
    this.setData(series || []);
    this.bind();
    this.resize();
  }

  setData(series: SeasonSeries[]): void {
    this.series = (series || []).map((s) => ({
      year: s.year, color: s.color,
      points: s.points.map((p) => ({ time: p.time, value: p.value })),
    }));
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of this.series) {
      for (const p of s.points) {
        if (!isFinite(p.value)) continue;
        if (p.value < lo) lo = p.value;
        if (p.value > hi) hi = p.value;
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-9) { hi = lo + 1; }
    const padY = (hi - lo) * 0.08;
    this.lo = lo - padY;
    this.hi = hi + padY;
    this.invalidate();
  }

  setTheme(name: string): void {
    this.o.theme = name;
    this.th = ANALYTICS_THEMES[name] || ANALYTICS_THEMES.light;
    this.invalidate();
  }

  private plotW(): number { return Math.max(1, this.W - this.pad.l - this.pad.r); }
  private plotH(): number { return Math.max(1, this.H - this.pad.t - this.pad.b); }

  /** **日历日序 → 像素 x**。这是这个组件的核心：x 不是时间戳。 */
  xOfDoy(doy: number): number {
    return this.pad.l + (clamp(doy, 0, 364) / 364) * this.plotW();
  }
  doyOf(px: number): number {
    return clamp(((px - this.pad.l) / this.plotW()) * 364, 0, 364);
  }
  yOf(v: number): number {
    const span = this.hi - this.lo || 1;
    return this.pad.t + ((this.hi - v) / span) * this.plotH();
  }

  private bind(): void {
    const c = this.canvas;
    const sig = { signal: this.ac.signal };
    c.addEventListener('pointermove', (e: PointerEvent) => {
      this.pointer = { x: e.offsetX, y: e.offsetY };
      this.hoverDoy = this.doyOf(e.offsetX);
      this.invalidate();
    }, sig);
    c.addEventListener('pointerleave', () => {
      this.pointer = null;
      this.hoverDoy = null;
      this.invalidate();
    }, sig);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(c);
    } else {
      window.addEventListener('resize', () => this.resize(), sig);
    }
  }

  /** 某个年份在指定「年内第几天」附近的值（容差 window 天），找不到返回 null */
  valueAt(s: SeasonSeries, doy: number, windowDays: number): number | null {
    let best: number | null = null;
    let bd = Infinity;
    for (const p of s.points) {
      const d = calendarDoy(p.time);
      const diff = Math.abs(d - doy);
      if (diff < bd) { bd = diff; best = p.value; }
    }
    return bd <= windowDays ? best : null;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 600));
    const h = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 380));
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.W = w; this.H = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
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

  private draw(): void {
    const ctx = this.ctx;
    const th = this.th;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, this.W, this.H);

    const p = this.pad;
    const x0 = p.l;
    const x1 = this.W - p.r;
    const yBaseTop = p.t;
    const yBaseBot = p.t + this.plotH();

    // 顶部 header（FUTUON 那种品牌行）
    if (this.o.header) {
      ctx.font = '600 17px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = th.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.o.header, x0, 26);
    }
    if (this.o.title) {
      ctx.font = '600 17px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = th.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.o.title, x0, p.t - 34);
    }

    // 月份分隔虚线 + 月份标签（Jan/Apr/Jul/Oct）
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const cum: number[] = [0];
    for (let m = 0; m < 12; m++) {
      cum.push(cum[m] + new Date(2023, m + 1, 0).getDate());
    }
    const totalDays = 365;
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = th.axis;
    ctx.lineWidth = 1;
    for (let m = 0; m < 12; m++) {
      const x = this.xOfDoy(Math.min(364, cum[m] / totalDays * 364));
      if (x < x0 || x > x1) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yBaseTop);
      ctx.lineTo(Math.round(x) + 0.5, yBaseBot);
      ctx.stroke();
    }
    ctx.restore();

    // 0 轴
    const yZero = this.yOf(0);
    if (yZero >= yBaseTop && yZero <= yBaseBot) {
      ctx.strokeStyle = th.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(yZero) + 0.5);
      ctx.lineTo(x1, Math.round(yZero) + 0.5);
      ctx.stroke();
    }

    // 各年份的线
    for (const s of this.series) {
      if (!s.points.length) continue;
      const pts: { x: number; y: number }[] = [];
      for (const pt of s.points) {
        if (!isFinite(pt.value)) continue;
        pts.push({ x: this.xOfDoy(calendarDoy(pt.time)), y: this.yOf(pt.value) });
      }
      pts.sort((a, b) => a.x - b.x);
      if (!pts.length) continue;
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
        else ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      // 最后一个点画个实心圆（参考图里就有）
      const last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.restore();
    }

    // 悬停竖线 + 日期徽章
    if (this.hoverDoy != null && this.pointer) {
      const x = Math.round(this.xOfDoy(this.hoverDoy)) + 0.5;
      ctx.save();
      ctx.strokeStyle = th.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yBaseTop);
      ctx.lineTo(x, yBaseBot);
      ctx.stroke();
      // 各年份在这个位置的点
      for (const s of this.series) {
        const v = this.valueAt(s, this.hoverDoy, 4);
        if (v == null) continue;
        ctx.beginPath();
        ctx.arc(x, this.yOf(v), 5, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
        ctx.strokeStyle = th.bg;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();

      // 日期徽章
      const d = new Date(2023, 0, 1 + Math.round(this.hoverDoy * 365 / 364));
      const label = d.getDate() + ' ' + MON[d.getMonth()];
      ctx.save();
      ctx.font = th.font;
      const bw = ctx.measureText(label).width + 20;
      const bx = clamp(x - bw / 2, x0, x1 - bw);
      pathRoundRect(ctx, bx, yBaseBot + 6, bw, 26, 4);
      ctx.fillStyle = th.tooltipBg;
      ctx.fill();
      ctx.fillStyle = th.tooltipText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + bw / 2, yBaseBot + 19);
      ctx.restore();

      // 气泡
      const lines: TipLine[] = [];
      for (const s of this.series) {
        const v = this.valueAt(s, this.hoverDoy, 4);
        lines.push({
          text: s.year,
          dot: s.color,
          right: v == null ? '—' : (this.o.asPercent
            ? (v * 100).toFixed(this.o.decimals) + '%'
            : v.toFixed(this.o.decimals) + this.o.valueSuffix),
        });
      }
      const cx = clamp(x, 110, this.W - 110);
      drawTip(ctx, th, cx, yBaseTop + 4, lines, this.W);
    }

    // 底部月份标签
    ctx.font = th.font;
    ctx.fillStyle = th.dim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of [0, 3, 6, 9]) {
      const x = this.xOfDoy(Math.min(364, cum[m] / totalDays * 364));
      if (x < x0 - 1 || x > x1 + 1) continue;
      ctx.fillText(MON[m], Math.round(x), yBaseBot + 26);
    }

    // 底部图例（按 series 顺序倒过来，参考图是 2026 在前）
    const ly = this.H - 20;
    let lx = x0;
    const ordered = this.series.slice().sort((a, b) => (a.year < b.year ? 1 : -1));
    for (const s of ordered) {
      lx = drawLegendDot(ctx, th, lx, ly, s.color, s.year);
    }
  }

  debugInfo(): string {
    let pts = 0;
    for (const s of this.series) pts += s.points.length;
    return 'series=' + this.series.length + ' points=' + pts +
      ' y=[' + this.lo.toFixed(4) + ',' + this.hi.toFixed(4) + ']' +
      ' hoverDoy=' + (this.hoverDoy == null ? '-' : this.hoverDoy.toFixed(0)) +
      ' size=' + this.W + 'x' + this.H + '@' + this.dpr + 'x';
  }
}

/* ===========================================================================
 * 6. 自检
 * ========================================================================= */

export interface AnalyticsTestResult {
  pass: number;
  fail: number;
  names: string[];
}

export function analyticsSelfTest(): AnalyticsTestResult {
  let pass = 0;
  let fail = 0;
  const names: string[] = [];
  const t = (name: string, ok: boolean, extra: string = '') => {
    names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
    if (ok) pass++; else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };
  const near = (a: number, b: number, eps: number = 1e-9) => Math.abs(a - b) <= eps;

  /* ---------------- 直方图 ---------------- */
  const h1 = histogram([0.01, 0.02, 0.03, -0.01, -0.02], 5, -0.05, 0.05);
  t('histogram：箱宽相等且覆盖满区间',
    h1.bins.length === 5 && near(h1.bins[0].from, -0.05) && near(h1.bins[4].to, 0.05));
  t('histogram：计数总和 == 样本数', h1.total === 5 &&
    h1.bins.reduce((s, b) => s + b.count, 0) === 5);
  // 别手算：0.01 和 0.02 在箱宽 0.02 下是**同一箱**（我第一版就算错了）。
  // 断言不变式，不依赖我的口算。
  t('histogram：maxCount == 各箱计数的最大值',
    h1.maxCount === Math.max.apply(null, h1.bins.map((b) => b.count)),
    'maxCount=' + h1.maxCount + ' counts=' + JSON.stringify(h1.bins.map((b) => b.count)));

  // 边界：等于最大值的样本必须落在最后一箱（左闭右开 + 末箱右闭）
  const h2 = histogram([0, 1, 2, 3, 4], 4, 0, 4);
  t('histogram：最大值落在最后一箱而不是被丢掉',
    h2.bins.reduce((s, b) => s + b.count, 0) === 5 && h2.bins[3].count === 2,
    JSON.stringify(h2.bins.map((b) => b.count)));
  t('histogram：等于最小值的样本落在第一箱', h2.bins[0].count === 1);

  const h3 = histogram([0.5, 0.5, 0.5], 3, 0, 1);
  t('histogram：全相同值只落一个箱', h3.bins.reduce((s, b) => s + b.count, 0) === 3);

  const h4 = histogram([], 5);
  t('histogram：空输入不炸且 maxCount 为 0', h4.total === 0 && h4.maxCount === 0 && h4.bins.length === 5);
  t('histogram：退化区间（lo==hi）不会除零',
    isFinite(histogram([1, 1], 3, 1, 1).bins[0].to));

  /* ---------------- 盈亏统计 ---------------- */
  const wl = avgWinLoss([0.05, 0.03, -0.02, -0.04, -0.06, 0, 1e-12]);
  t('avgWinLoss：盈利/亏损/平局分组正确',
    wl.winners.length === 2 && wl.losers.length === 3 && wl.breakevens.length === 2,
    wl.winners.length + '/' + wl.losers.length + '/' + wl.breakevens.length);
  t('avgWinLoss：平均盈利 / 平均亏损正确',
    near(wl.avgProfit as number, 0.04) && near(wl.avgLoss as number, -0.04),
    wl.avgProfit + ' / ' + wl.avgLoss);
  t('avgWinLoss：胜率+败率+平局率 == 1',
    near(wl.winRate + wl.lossRate + wl.breakevenRate, 1));
  const wl2 = avgWinLoss([]);
  t('avgWinLoss：空输入返回 null 而不是 NaN',
    wl2.avgProfit === null && wl2.avgLoss === null && wl2.winRate === 0);

  /* ---------------- 环形弧段 ---------------- */
  const arcs = donutArcs([{ value: 6 }, { value: 27 }, { value: 0 }]);
  t('donutArcs：起点是 12 点方向（-PI/2）', near(arcs[0].start, -Math.PI / 2));
  t('donutArcs：顺时针累加，末段正好收在 -PI/2 + 2PI',
    near(arcs[1].end, -Math.PI / 2 + Math.PI * 2, 1e-9), String(arcs[1].end));
  t('donutArcs：占比正确（6/33, 27/33）',
    near(arcs[0].pct, 6 / 33, 1e-9) && near(arcs[1].pct, 27 / 33, 1e-9));
  t('donutArcs：0 值段不占角度', near(arcs[2].end - arcs[2].start, 0));
  t('donutArcs：全 0 输入不会除零产生 NaN',
    donutArcs([{ value: 0 }, { value: 0 }]).every((a) => isFinite(a.start) && isFinite(a.end)));

  /* ---------------- 年内天数 ---------------- */
  t('dayOfYear：1 月 1 日是 0', dayOfYear(new Date(2024, 0, 1).getTime()) === 0);
  t('dayOfYear：1 月 31 日是 30', dayOfYear(new Date(2024, 0, 31).getTime()) === 30);
  t('dayOfYear：闰年 3 月 1 日是 60（非闰年是 59）',
    dayOfYear(new Date(2024, 2, 1).getTime()) === 60 &&
    dayOfYear(new Date(2023, 2, 1).getTime()) === 59);
  t('dayOfYear：12 月 31 日在闰年/非闰年分别 365/364',
    dayOfYear(new Date(2024, 11, 31).getTime()) === 365 &&
    dayOfYear(new Date(2023, 11, 31).getTime()) === 364);
  t('daysInYear 闰年判断', daysInYear(2024) === 366 && daysInYear(2023) === 365 &&
    daysInYear(1900) === 365 && daysInYear(2000) === 366);

  // calendarDoy 是 seasonals 的 x 轴，必须**忽略闰年**——否则跨年比较会错开一天
  t('calendarDoy：12-31 是 364、01-01 是 0',
    calendarDoy(new Date(2023, 11, 31).getTime()) === 364 &&
    calendarDoy(new Date(2023, 0, 1).getTime()) === 0);
  t('calendarDoy 忽略闰年：2024-06-15 与 2026-06-15 都是 165',
    calendarDoy(new Date(2024, 5, 15).getTime()) === 165 &&
    calendarDoy(new Date(2026, 5, 15).getTime()) === 165,
    String(calendarDoy(new Date(2024, 5, 15).getTime())));
  t('dayOfYear 保留闰年差异（正因如此不能拿它当 seasonals 的 x）',
    dayOfYear(new Date(2024, 5, 15).getTime()) === 166 &&
    dayOfYear(new Date(2026, 5, 15).getTime()) === 165);

  /* ---------------- 季节性数据准备 ---------------- */
  const ssBars = makeBars(760, 77, 100);   // 约 3 年
  const ss = seasonalSeries(ssBars);
  t('seasonalSeries：按年份拆成多条', ss.length >= 2, ss.map((s) => s.year).join(','));
  t('seasonalSeries：每年的第一个点都是 0（年内累计收益的定义）',
    ss.every((s) => near(s.points[0].value, 0, 1e-12)));
  t('seasonalSeries：每年的点都在同一年内', ss.every((s) =>
    s.points.every((p) => String(new Date(p.time).getFullYear()) === s.year)));
  t('seasonalSeries：颜色不重复', (() => {
    const seen: { [k: string]: boolean } = {};
    for (const s of ss) { if (seen[s.color]) return false; seen[s.color] = true; }
    return true;
  })());
  t('seasonalSeries：单年数据不炸', (() => {
    const one = seasonalSeries(makeBars(60, 5, 100));
    return one.length === 1 && one[0].points.length > 0;
  })());

  /* ---------------- 需要 canvas 的部分 ---------------- */
  let skipped = 0;
  if (typeof document === 'undefined') {
    skipped = 16;
    log('（跳过 ' + skipped + ' 条需要 canvas 的断言：当前不在浏览器环境）');
  } else {
    const host = document.createElement('div');
    host.style.position = 'absolute';
    host.style.left = '-9999px';
    host.style.top = '0';
    host.innerHTML =
      '<div style="width:700px;height:340px"><canvas id="t-rc"></canvas></div>' +
      '<div style="width:760px;height:320px"><canvas id="t-dn"></canvas></div>' +
      '<div style="width:700px;height:380px"><canvas id="t-sn"></canvas></div>';
    document.body.appendChild(host);

    // --- 直方图 ---
    const rets: number[] = [];
    for (let i = 0; i < 200; i++) {
      rets.push(Math.sin(i * 1.7) * 0.06 + (i % 7 === 0 ? 0.09 : -0.02));
    }
    const rc = new ReturnsChart(host.querySelector('#t-rc') as HTMLCanvasElement, rets, {
      title: 'Returns distribution', theme: 'light', binCount: 10,
      leftStat: [{ text: '-2,026.57 USD', right: '-4.56%', color: '#f23645' }],
      rightStat: [{ text: '-24,632.28 USD', right: '-24.63%' }],
    });
    rc.resize();
    rc.drawNow();
    t('直方图：vOf(xOf(v)) 互逆', near(rc.vOf(rc.xOf(0.01)), 0.01, 1e-9));
    t('直方图：分箱范围关于 0 对称（0 是赢/亏分界，必须居中）',
      near(rc.hist.lo, -rc.hist.hi, 1e-9) && rc.hist.lo < 0 && rc.hist.hi > 0,
      '[' + rc.hist.lo.toFixed(4) + ',' + rc.hist.hi.toFixed(4) + ']');
    t('直方图：binAt 在绘图区内返回合法下标，区外返回 null',
      rc.binAt(rc.pad.l + 5) === 0 && rc.binAt(2) === null);
    t('直方图：柱高与计数成正比（maxCount 的柱顶 = 绘图区顶）',
      near(rc.yOf(rc.hist.maxCount), rc.pad.t, 1e-6));
    let inked = false;
    try {
      const img = rc.ctx.getImageData(0, 0, rc.canvas.width, rc.canvas.height).data;
      let ink = 0;
      for (let i = 0; i < img.length; i += 4 * 53) {
        if (img[i] < 250 || img[i + 1] < 250 || img[i + 2] < 250) ink++;
      }
      inked = ink > 50;
    } catch (e) { log('WARN  getImageData 不可用：' + String(e)); }
    t('直方图：白底上确实画了东西', inked);

    // --- 环形图 ---
    const dn = new DonutChart(host.querySelector('#t-dn') as HTMLCanvasElement, [
      { label: 'Winners', value: 6, color: '#089981' },
      { label: 'Losers', value: 27, color: '#f23645' },
      { label: 'Breakevens', value: 0, color: '#ff9800' },
    ], { title: 'Trades distribution', centerLabel: 'Total trades', highlight: 1 });
    dn.resize();
    dn.drawNow();
    t('环形图：总数正确', dn.total() === 33);
    const rmD = (dn.R + dn.inner) / 2;
    const atAng = (ang: number) => dn.sliceAt(dn.CX + Math.cos(ang) * rmD, dn.CY + Math.sin(ang) * rmD);
    t('环形图：每段弧的中点都命中自己（角度换算与 donutArcs 起点一致）', (() => {
      const arcs = donutArcs(dn.slices);
      for (let i = 0; i < arcs.length; i++) {
        if (arcs[i].pct <= 0) continue;
        const mid = (arcs[i].start + arcs[i].end) / 2;
        if (atAng(mid) !== i) return false;
      }
      return true;
    })());
    // 方向验证：Winners 占 6/33 = 18%（65°）。所以 12 点**顺时针**一点点属于第一段，
    // **逆时针**一点点属于最后一段。写反了这两个就会互换。
    t('环形图：第一段从 12 点方向「顺时针」开始', atAng(-Math.PI / 2 + 0.05) === 0,
      '顺时针=' + atAng(-Math.PI / 2 + 0.05));
    t('环形图：12 点逆时针方向属于最后一段', atAng(-Math.PI / 2 - 0.05) === 1,
      '逆时针=' + atAng(-Math.PI / 2 - 0.05));
    t('环形图：圆心挖空处不命中', dn.sliceAt(dn.CX, dn.CY) === null);
    t('环形图：环外远处不命中', dn.sliceAt(dn.CX, dn.CY + dn.R + 90) === null);

    // --- 季节性 ---
    const mk = (year: number, f: (i: number) => number): SeasonSeries => {
      const pts: { time: number; value: number }[] = [];
      for (let i = 0; i < 200; i++) {
        const d = new Date(year, 0, 1 + Math.floor(i * 1.8));
        pts.push({ time: d.getTime(), value: f(i) });
      }
      return { year: String(year), color: '#2962ff', points: pts };
    };
    const sn = new SeasonalsChart(host.querySelector('#t-sn') as HTMLCanvasElement, [
      mk(2026, (i) => Math.sin(i / 20) * 0.1),
      mk(2025, (i) => Math.cos(i / 25) * 0.08),
      mk(2024, (i) => -0.05),
    ], { title: 'Seasonals', header: 'FUTUON' });
    sn.resize();
    sn.drawNow();
    t('季节性：x 轴是「日历日序」——第 0 天在最左、第 364 天在最右',
      near(sn.xOfDoy(0), sn.pad.l, 1e-9) &&
      near(sn.xOfDoy(364), sn.W - sn.pad.r, 1e-9));
    t('季节性：doyOf(xOfDoy(d)) 互逆', near(sn.doyOf(sn.xOfDoy(123)), 123, 1e-6));
    t('季节性：跨闰年同一天映射到同一个 x（这正是这个组件的意义）', (() => {
      const a = sn.xOfDoy(calendarDoy(new Date(2024, 5, 15).getTime()));
      const b = sn.xOfDoy(calendarDoy(new Date(2026, 5, 15).getTime()));
      return near(a, b, 1e-9);
    })());
    t('季节性：valueAt 在容差内找得到、在真正的空档返回 null', (() => {
      const s = sn.series[0];
      const pd = s.points.map((p) => calendarDoy(p.time));
      const have: { [k: number]: boolean } = {};
      for (const d of pd) have[d] = true;
      // 找一个左右 1 天内都没有点的日序（不能凭感觉挑 d+300，序列可能铺满全年）
      let empty = -1;
      for (let d = 1; d < 364; d++) {
        if (!have[d] && !have[d - 1] && !have[d + 1]) { empty = d; break; }
      }
      const hit = sn.valueAt(s, pd[10], 1) === s.points[10].value;
      const miss = empty < 0 ? true : sn.valueAt(s, empty, 1) === null;
      return hit && miss;
    })());
    t('季节性：yOf 单调（值越大 y 越小）',
      sn.yOf(sn.hi) < sn.yOf(sn.lo));

    rc.dispose(); dn.dispose(); sn.dispose();
    host.remove();
  }

  log('统计组件自检：' + pass + ' PASS / ' + fail + ' FAIL' +
    (skipped ? '（另有 ' + skipped + ' 条需要 canvas，本次跳过）' : ''));
  return { pass, fail, names };
}
