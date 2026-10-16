/**
 * tv-chart / grid.ts
 * ---------------------------------------------------------------------------
 * 多图网格 + 联动（TradingView 的 Layout + Sync）。
 *
 * 依赖 chart.ts（ESM `import`）。
 *
 * 设计要点（这几条是这个文件存在的理由）：
 *
 *   ① 每格是**独立的 TVChart 实例**，不是一个画布切几块。
 *      所以每格有自己的坐标轴、图例、缩放、指标 —— 这才叫「多个图表」。
 *
 *   ② 联动一律**按时间对齐，不按像素**。
 *      两格周期不同（1D vs 1W）时，同一个像素 x 指的不是同一时刻；
 *      按像素同步会让十字光标指到完全不同的日子。
 *
 *   ③ 纵向的价格标签只在鼠标真正所在的那一格画。
 *      其它格没有「鼠标的纵坐标」这回事，硬画一个价格是瞎编。
 * ---------------------------------------------------------------------------
 */

import { Bar, ChartOptions, RANGES, TVChart, clamp, log, makeBars, resample } from './chart';

export interface SymbolDef {
  ticker: string;
  name: string;
  seed: number;
  base: number;
}

export interface SyncFlags {
  symbol: boolean;
  interval: boolean;
  crosshair: boolean;
  range: boolean;
}

/** 数据源：给定标的 + 周期，返回 K 线（time 必须是开盘时间、epoch 毫秒） */
export type DataSource = (ticker: string, timeframe: string) => Bar[];

export interface GridOptions {
  /** 注入数据源；不传则使用内置的 A 股演示数据 */
  dataSource?: DataSource;
  /** 透传给每格 TVChart 的选项（如美股习惯的涨绿跌红） */
  chartOptions?: Partial<ChartOptions>;
  /** 每格的初始标的（按格序号轮流取）；不传则用内置演示标的 */
  symbols?: string[];
  rows?: number;
  cols?: number;
  symbol?: string;
  timeframe?: string;
  theme?: string;
  sync?: SyncFlags;
  /** 每格图例的左缩进，给左上角编号徽章让位 */
  legendInset?: number;
}

export interface Tile {
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  badge: HTMLDivElement;
  chart: TVChart;
  symbol: string;
  /** 每格自己的周期（sync.interval 关闭时各格可以不同） */
  timeframe: string;
}

/** 演示用标的。真实的活数据源接进来只需要换掉 barsFor()。 */
export const SYMBOLS: SymbolDef[] = [
  { ticker: '600519.SH', name: '贵州茅台', seed: 1101, base: 1680 },
  { ticker: '300750.SZ', name: '宁德时代', seed: 2202, base: 275 },
  { ticker: '000001.SH', name: '上证指数', seed: 3303, base: 3100 },
  { ticker: '000300.SH', name: '沪深300', seed: 4404, base: 3800 },
  { ticker: '601318.SH', name: '中国平安', seed: 5505, base: 46 },
  { ticker: '000858.SZ', name: '五粮液', seed: 6606, base: 142 },
];

export const TIMEFRAMES: string[] = ['1D', '1W', '1M'];
export const DAILY_COUNT = 900;

export function symbolDef(ticker: string): SymbolDef {
  for (const s of SYMBOLS) if (s.ticker === ticker) return s;
  return SYMBOLS[0];
}

export function symbolName(ticker: string): string {
  return symbolDef(ticker).name;
}

/** 日线只生成一次，多个格子共用 */
export const DAILY_CACHE: { [k: string]: Bar[] } = {};

export function dailyFor(ticker: string): Bar[] {
  if (!DAILY_CACHE[ticker]) {
    const def = symbolDef(ticker);
    DAILY_CACHE[ticker] = makeBars(DAILY_COUNT, def.seed, def.base);
  }
  return DAILY_CACHE[ticker];
}

/** 某标的某周期的 K 线：日线是确定性生成的，周/月由日线合成 */
export function barsFor(ticker: string, tf: string): Bar[] {
  return resample(dailyFor(ticker), tf);
}

export class ChartGrid {
  el: HTMLElement;
  tiles: Tile[] = [];

  private rows = 2;
  private cols = 2;
  private active = 0;
  private timeframe = '1D';
  private themeName = 'dark';
  private legendInset = 34;
  private sync: SyncFlags = { symbol: true, interval: true, crosshair: true, range: true };
  /** 构建 / 批量换数据期间屏蔽回调，防止联动自己触发自己 */
  private busyGuard = false;
  private ready = false;
  private source: DataSource = barsFor;
  private chartOptions: Partial<ChartOptions> = {};
  private initialSymbols: string[] = [];

  constructor(target: HTMLElement | string, options?: GridOptions) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(el instanceof HTMLElement)) throw new Error('ChartGrid: 第一个参数必须是容器元素');
    this.el = el;
    const o: GridOptions = options || {};
    if (o.dataSource) this.source = o.dataSource;
    if (o.chartOptions) this.chartOptions = o.chartOptions;
    if (o.symbols && o.symbols.length) this.initialSymbols = o.symbols.slice();
    this.rows = clamp(o.rows == null ? 2 : o.rows, 1, 4);
    this.cols = clamp(o.cols == null ? 2 : o.cols, 1, 4);
    this.timeframe = o.timeframe || '1D';
    this.themeName = o.theme || 'dark';
    this.legendInset = o.legendInset == null ? 34 : o.legendInset;
    if (o.sync) {
      if (o.sync.symbol != null) this.sync.symbol = !!o.sync.symbol;
      if (o.sync.interval != null) this.sync.interval = !!o.sync.interval;
      if (o.sync.crosshair != null) this.sync.crosshair = !!o.sync.crosshair;
      if (o.sync.range != null) this.sync.range = !!o.sync.range;
    }

    this.el.classList.add('tv-grid');
    this.applyGridCss();
    this.ensureTiles(this.rows * this.cols);
    this.ready = true;
    this.applyAll();
    log('ChartGrid: ' + this.rows + '×' + this.cols + ' = ' + this.tiles.length + ' 格');
  }

  /* ------------------------------------------------------------- 布局 */

  private applyGridCss(): void {
    this.el.style.display = 'grid';
    // minmax(0, 1fr) 而不是 1fr —— 否则画布的固有尺寸会把轨道撑开，整个网格溢出
    this.el.style.gridTemplateColumns = 'repeat(' + this.cols + ', minmax(0, 1fr))';
    this.el.style.gridTemplateRows = 'repeat(' + this.rows + ', minmax(0, 1fr))';
    this.el.style.gap = '1px';
  }

  private ensureTiles(n: number): void {
    while (this.tiles.length > n) {
      const t = this.tiles.pop();
      if (t) {
        t.chart.dispose();
        t.el.remove();
      }
    }
    while (this.tiles.length < n) {
      const i = this.tiles.length;
      const el = document.createElement('div');
      el.className = 'tv-tile';
      const canvas = document.createElement('canvas');
      const badge = document.createElement('div');
      badge.className = 'tv-badge';
      badge.textContent = String(i + 1);
      el.appendChild(canvas);
      el.appendChild(badge);
      this.el.appendChild(el);

      // 联动「标的」开着时，新格子必须跟当前标的走，否则切完 NVDA 再加格子会冒出一个 TSLA
      const ref = this.tiles[Math.min(this.active, this.tiles.length - 1)];
      const ticker = this.sync.symbol && ref
        ? ref.symbol
        : this.initialSymbols.length
          ? this.initialSymbols[i % this.initialSymbols.length]
          : SYMBOLS[i % SYMBOLS.length].ticker;
      const chart = new TVChart(canvas, this.source(ticker, this.timeframe), {
        ...this.chartOptions,
        symbol: ticker,
        timeframe: this.timeframe,
        legendInset: this.legendInset,
        onCrosshair: (idx: number | null) => this.onCross(i, idx),
        onView: (t0: number, t1: number) => this.onView(i, t0, t1),
      });
      chart.setTheme(this.themeName);

      const tile: Tile = { el, canvas, badge, chart, symbol: ticker, timeframe: this.timeframe };
      el.addEventListener('pointerdown', () => this.setActive(i), { passive: true });
      this.tiles.push(tile);
    }
    for (let i = 0; i < this.tiles.length; i++) this.tiles[i].badge.textContent = String(i + 1);
  }

  setLayout(rows: number, cols: number): void {
    const r = clamp(Math.round(rows), 1, 4);
    const c = clamp(Math.round(cols), 1, 4);
    this.busyGuard = true;
    try {
      this.rows = r;
      this.cols = c;
      this.applyGridCss();
      this.ensureTiles(r * c);
    } finally {
      this.busyGuard = false;
    }
    this.ready = true;
    this.applyAll();
    this.setActive(Math.min(this.active, this.tiles.length - 1));
    this.el.dispatchEvent(new CustomEvent('layoutchange', { detail: this.layoutInfo() }));
  }

  layoutInfo(): { rows: number; cols: number; total: number } {
    return { rows: this.rows, cols: this.cols, total: this.tiles.length };
  }

  setActive(i: number): void {
    this.active = clamp(i, 0, Math.max(0, this.tiles.length - 1));
    for (let k = 0; k < this.tiles.length; k++) {
      this.tiles[k].el.classList.toggle('active', k === this.active);
    }
    this.el.dispatchEvent(new CustomEvent('activechange', { detail: { active: this.active } }));
  }

  activeIndex(): number {
    return this.active;
  }

  /* ------------------------------------------------------------- 联动 */

  /** 十字光标联动（公开：宿主也可以手动驱动） */
  onCross(ix: number, idx: number | null): void {
    if (!this.ready || this.busyGuard || !this.sync.crosshair) return;
    const src = this.tiles[ix];
    if (!src) return;
    const t = idx == null ? null : (src.chart.bars[idx] ? src.chart.bars[idx].time : null);
    this.busyGuard = true;
    try {
      for (let k = 0; k < this.tiles.length; k++) {
        if (k === ix) continue;
        const c = this.tiles[k].chart;
        c.setSyncIndex(t == null || !c.bars.length ? null : c.indexAtTime(t));
      }
    } finally {
      this.busyGuard = false;
    }
  }

  /** 时间轴范围联动（公开：宿主也可以手动驱动） */
  onView(ix: number, t0: number, t1: number): void {
    if (!this.ready || this.busyGuard) return;
    if (this.sync.range) {
      this.busyGuard = true;
      try {
        for (let k = 0; k < this.tiles.length; k++) {
          if (k === ix) continue;
          this.tiles[k].chart.setViewTimes(t0, t1);
        }
      } finally {
        this.busyGuard = false;
      }
    }
    this.emitView();
  }

  /** 视口变了就广播一次 —— 底部的范围高亮靠它刷新 */
  private emitView(): void {
    this.el.dispatchEvent(new CustomEvent('viewchange', { detail: { active: this.active } }));
  }

  /** 以活动格为基准，把时间轴范围刷给其它格 */
  syncRange(): void {
    if (!this.sync.range || !this.tiles.length) return;
    const src = this.tiles[this.active].chart;
    const vt = src.viewTimes();
    if (!vt) return;
    this.onView(this.active, vt[0], vt[1]);
  }

  syncFlags(): SyncFlags {
    return {
      symbol: this.sync.symbol,
      interval: this.sync.interval,
      crosshair: this.sync.crosshair,
      range: this.sync.range,
    };
  }

  setSync(key: string, on: boolean): void {
    if (key === 'symbol') this.sync.symbol = !!on;
    else if (key === 'interval') this.sync.interval = !!on;
    else if (key === 'crosshair') this.sync.crosshair = !!on;
    else if (key === 'range') this.sync.range = !!on;
    else return;

    // 关掉十字光标联动时，把别格残留的光标清掉，否则会留一条摘不掉的线
    if (key === 'crosshair' && !this.sync.crosshair) {
      for (const t of this.tiles) t.chart.setSyncIndex(null);
    }
    log('联动 ' + key + ' -> ' + (on ? '开' : '关'));
  }

  /* ----------------------------------------------------- 标的 / 周期 */

  private loadTile(t: Tile, ticker: string, tf: string): void {
    t.symbol = ticker;
    t.timeframe = tf;
    t.chart.setBars(this.source(ticker, tf), { symbol: ticker, timeframe: tf });
  }

  /** 标的。sync.symbol 开 → 全部格子；关 → 只改当前活动格。 */
  setSymbol(ticker: string): void {
    this.busyGuard = true;
    try {
      if (this.sync.symbol) {
        for (const t of this.tiles) this.loadTile(t, ticker, t.timeframe);
      } else {
        const t = this.tiles[this.active];
        if (t) this.loadTile(t, ticker, t.timeframe);
      }
    } finally {
      this.busyGuard = false;
    }
    this.syncRange();
  }

  /** 周期。sync.interval 开 → 全部格子；关 → 只改当前活动格。 */
  setTimeframe(tf: string): void {
    this.timeframe = tf;
    this.busyGuard = true;
    try {
      if (this.sync.interval) {
        for (const t of this.tiles) this.loadTile(t, t.symbol, tf);
      } else {
        const t = this.tiles[this.active];
        if (t) this.loadTile(t, t.symbol, tf);
      }
    } finally {
      this.busyGuard = false;
    }
    this.syncRange();
  }

  activeSymbol(): string {
    const t = this.tiles[this.active];
    return t ? t.symbol : (this.initialSymbols[0] || SYMBOLS[0].ticker);
  }

  /* ----------------------------------------------------- 显示范围（底部条） */

  /** 设置显示范围。作用于**活动格**；sync.range 开时自动联动到其它格。 */
  setRange(key: string): boolean {
    const t = this.tiles[this.active];
    if (!t) return false;
    return t.chart.setRange(key);
  }

  /** 每个范围按钮当前是否可用（数据够不够长）—— 底部按钮靠这个置灰 */
  rangeAvailability(): { key: string; label: string; ok: boolean }[] {
    const t = this.tiles[this.active];
    const out: { key: string; label: string; ok: boolean }[] = [];
    if (!t) return out;
    for (const r of RANGES) {
      out.push({ key: r.key, label: r.label, ok: t.chart.rangeAvailable(r.key) });
    }
    return out;
  }

  /** 活动格当前视口覆盖多少天 */
  viewSpanDays(): number {
    const t = this.tiles[this.active];
    return t ? t.chart.viewSpan() / 86400000 : 0;
  }

  timeframeNow(): string {
    return this.timeframe;
  }

  /** 活动格自己的周期 */
  activeTimeframe(): string {
    const t = this.tiles[this.active];
    return t ? t.timeframe : this.timeframe;
  }

  /** 单独设置某一格的周期（不看 sync.interval），用于初始化「多周期」布局 */
  setTileTimeframe(i: number, tf: string): void {
    const t = this.tiles[i];
    if (!t) return;
    this.busyGuard = true;
    try {
      this.loadTile(t, t.symbol, tf);
    } finally {
      this.busyGuard = false;
    }
    if (i === this.active) this.syncRange();
    this.emitView();
  }

  /* ------------------------------------------------------------- 主题 */

  setTheme(name: string): void {
    this.themeName = name;
    for (const t of this.tiles) t.chart.setTheme(name);
  }

  themeNow(): string {
    return this.themeName;
  }

  /* --------------------------------------------------------- 批量操作 */

  /** 对每一格执行（比如切换 BB 通道、圆圈规则） */
  eachTile(fn: (chart: TVChart, i: number) => void): void {
    for (let i = 0; i < this.tiles.length; i++) fn(this.tiles[i].chart, i);
  }

  /** 全部格子重新显示最近 k 根并互相对齐 */
  showLastAll(k: number): void {
    this.busyGuard = true;
    try {
      for (const t of this.tiles) t.chart.showLast(k);
    } finally {
      this.busyGuard = false;
    }
    this.syncRange();
    this.emitView();
  }

  fitAll(): void {
    this.busyGuard = true;
    try {
      for (const t of this.tiles) t.chart.fitContent();
    } finally {
      this.busyGuard = false;
    }
    this.emitView();
  }

  charts(): TVChart[] {
    return this.tiles.map((t) => t.chart);
  }

  private applyAll(): void {
    this.busyGuard = true;
    try {
      this.setTheme(this.themeName);
      for (const t of this.tiles) {
        t.chart.setChannelVisible('bb', true);
        t.chart.setBars(this.source(t.symbol, t.timeframe), {
          symbol: t.symbol,
          timeframe: t.timeframe,
        });
      }
    } finally {
      this.busyGuard = false;
    }
    this.syncRange();
  }

  dispose(): void {
    for (const t of this.tiles) {
      t.chart.dispose();
      t.el.remove();
    }
    this.tiles.length = 0;
  }
}

/* ===========================================================================
 * 网格自检。同样写进 #log，headless --dump-dom 可以 grep。
 * ========================================================================= */

export function gridSelfTest(grid: ChartGrid): { pass: number; fail: number } {
  let pass = 0;
  let fail = 0;
  const t = (name: string, ok: boolean, extra: string = '') => {
    if (ok) pass++; else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };

  const L0 = grid.layoutInfo();
  t('网格格数 = rows × cols', L0.total === L0.rows * L0.cols,
    L0.rows + 'x' + L0.cols + '=' + L0.total);
  t('每格都有 K 线', grid.charts().every((c) => c.bars.length > 0),
    grid.charts().map((c) => c.bars.length).join(','));
  t('每格都有 BB 通道', grid.charts().every((c) => c.channels.length >= 1));

  // 十字光标联动：第 0 格报一个索引，其它格应该按**时间**跟过去
  const saved = grid.syncFlags().crosshair;
  grid.setSync('crosshair', true);
  const c0 = grid.charts()[0];
  const pick = Math.min(200, c0.bars.length - 1);
  const tgt = c0.bars[pick].time;
  grid.onCross(0, pick);
  const others = grid.charts().slice(1);
  t('十字光标按时间联动到其它格（容差 8 天，跨周期也对得上）',
    others.length > 0 && others.every((c) => {
      const id = c.crosshairIndex();
      return id != null && Math.abs(c.bars[id].time - tgt) < 86400000 * 8;
    }),
    'others=' + others.length);
  grid.eachTile((c) => c.setSyncIndex(null));
  grid.setSync('crosshair', saved);

  // 布局切换
  const r2 = L0.rows === 3 ? 2 : 3;
  grid.setLayout(r2, 2);
  const L1 = grid.layoutInfo();
  t('setLayout 后格数正确', L1.total === r2 * 2, L1.rows + 'x' + L1.cols + '=' + L1.total);
  grid.setLayout(L0.rows, L0.cols);
  t('setLayout 还原成功', grid.layoutInfo().total === L0.total);

  log('网格自检：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail };
}
