/**
 * kc-chart / grid.ts
 * ---------------------------------------------------------------------------
 * 多图网格 + 联动（专业图表软件常见的 Layout + Sync）。
 *
 * 依赖 chart.ts（ESM `import`）。
 *
 * 设计要点（这几条是这个文件存在的理由）：
 *
 *   ① 每格是**独立的 KChart 实例**，不是一个画布切几块。
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

import { DEFAULT_LAYOUT_ID, LayoutDef, gridTemplate, layoutById, uniformLayoutId } from './layouts';
import type { StudyDef } from './studies';
import { Bar, ChartOptions, ChartStyle, RANGES, KChart, clamp, log, makeBars, resample } from './chart';

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
  /** 时间：其它格跟着滚到同一个最新时刻，但各格保持自己的缩放（可视跨度不变） */
  time: boolean;
  /** 日期范围：其它格显示与活动格完全相同的起止时间 */
  range: boolean;
}

/** 数据源：给定标的 + 周期，返回 K 线（time 必须是开盘时间、epoch 毫秒） */
export type DataSource = (ticker: string, timeframe: string) => Bar[];

export interface GridOptions {
  /** 注入数据源；不传则使用内置的 A 股演示数据 */
  dataSource?: DataSource;
  /** 透传给每格 KChart 的选项（如美股习惯的涨绿跌红） */
  chartOptions?: Partial<ChartOptions>;
  /** 每格的初始标的（按格序号轮流取）；不传则用内置演示标的 */
  symbols?: string[];
  /** 均匀网格的行列数（兼容旧入口）；同时给了 layoutId 时以 layoutId 为准 */
  rows?: number;
  cols?: number;
  /** 布局目录里的 id（见 layouts.ts），如 `4-3` */
  layoutId?: string;
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
  chart: KChart;
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

  private layout: LayoutDef = layoutById(uniformLayoutId(2, 2) ?? DEFAULT_LAYOUT_ID) as LayoutDef;
  private active = 0;
  private timeframe = '1D';
  private themeName = 'dark';
  private legendInset = 34;
  private sync: SyncFlags = { symbol: true, interval: true, crosshair: true, time: true, range: true };
  /** 构建 / 批量换数据期间屏蔽回调，防止联动自己触发自己 */
  private busyGuard = false;
  private ready = false;
  private source: DataSource = barsFor;
  private chartOptions: Partial<ChartOptions> = {};
  private initialSymbols: string[] = [];
  private styleName: ChartStyle = 'candles';
  /** 图上的指标定义：所有格共用，新建的格子也要补上 */
  private studyDefs: StudyDef[] = [];
  private studyHandler: ((uid: string, action: 'settings' | 'remove') => void) | null = null;

  constructor(target: HTMLElement | string, options?: GridOptions) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!(el instanceof HTMLElement)) throw new Error('ChartGrid: 第一个参数必须是容器元素');
    this.el = el;
    const o: GridOptions = options || {};
    if (o.dataSource) this.source = o.dataSource;
    if (o.chartOptions) this.chartOptions = o.chartOptions;
    this.styleName = this.chartOptions.style ?? 'candles';
    if (o.symbols && o.symbols.length) this.initialSymbols = o.symbols.slice();
    const byId = o.layoutId ? layoutById(o.layoutId) : null;
    const byGrid = layoutById(uniformLayoutId(clamp(o.rows == null ? 2 : o.rows, 1, 4), clamp(o.cols == null ? 2 : o.cols, 1, 4)) ?? '');
    this.layout = byId ?? byGrid ?? this.layout;
    this.timeframe = o.timeframe || '1D';
    this.themeName = o.theme || 'dark';
    this.legendInset = o.legendInset == null ? 34 : o.legendInset;
    if (o.sync) {
      if (o.sync.symbol != null) this.sync.symbol = !!o.sync.symbol;
      if (o.sync.interval != null) this.sync.interval = !!o.sync.interval;
      if (o.sync.crosshair != null) this.sync.crosshair = !!o.sync.crosshair;
      if (o.sync.time != null) this.sync.time = !!o.sync.time;
      if (o.sync.range != null) this.sync.range = !!o.sync.range;
    }

    this.el.classList.add('kc-grid');
    this.applyGridCss();
    this.ensureTiles(this.layout.count);
    this.placeTiles();
    this.ready = true;
    this.applyAll();
    log('ChartGrid: 布局 ' + this.layout.id + ' = ' + this.tiles.length + ' 格');
  }

  /* ------------------------------------------------------------- 布局 */

  private applyGridCss(): void {
    const g = gridTemplate(this.layout);
    this.el.style.display = 'grid';
    // minmax(0, Nfr) 而不是 Nfr —— 否则画布的固有尺寸会把轨道撑开，整个网格溢出
    this.el.style.gridTemplateColumns = g.cols.map((w) => 'minmax(0, ' + w.toFixed(6) + 'fr)').join(' ');
    this.el.style.gridTemplateRows = g.rows.map((h) => 'minmax(0, ' + h.toFixed(6) + 'fr)').join(' ');
    this.el.style.gap = '1px';
  }

  /** 按当前布局给每一格指定它占的行列（非均匀布局靠跨度实现） */
  private placeTiles(): void {
    const g = gridTemplate(this.layout);
    this.tiles.forEach((t, i) => {
      const p = g.place[i];
      if (!p) return;
      t.el.style.gridColumn = p.c0 + ' / ' + p.c1;
      t.el.style.gridRow = p.r0 + ' / ' + p.r1;
    });
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
      el.className = 'kc-tile';
      const canvas = document.createElement('canvas');
      const badge = document.createElement('div');
      badge.className = 'kc-badge';
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
      const chart = new KChart(canvas, this.source(ticker, this.timeframe), {
        ...this.chartOptions,
        symbol: ticker,
        timeframe: this.timeframe,
        legendInset: this.legendInset,
        onCrosshair: (idx: number | null) => this.onCross(i, idx),
        onView: (t0: number, t1: number) => this.onView(i, t0, t1),
      });
      chart.setTheme(this.themeName);
      chart.setStyle(this.styleName);
      chart.setStudyHandler(this.studyHandler);
      if (this.studyDefs.length) chart.setStudies(this.studyDefs);

      const tile: Tile = { el, canvas, badge, chart, symbol: ticker, timeframe: this.timeframe };
      el.addEventListener('pointerdown', () => this.setActive(i), { passive: true });
      this.tiles.push(tile);
    }
    for (let i = 0; i < this.tiles.length; i++) this.tiles[i].badge.textContent = String(i + 1);
  }

  /** 均匀 rows × cols 入口（兼容旧调用）；没有这种均匀布局时返回 false、不动 */
  setLayout(rows: number, cols: number): boolean {
    const id = uniformLayoutId(clamp(Math.round(rows), 1, 4), clamp(Math.round(cols), 1, 4));
    return id ? this.setLayoutId(id) : false;
  }

  /** 按布局目录里的 id 切换；id 不存在返回 false */
  setLayoutId(id: string): boolean {
    const def = layoutById(id);
    if (!def) return false;
    this.busyGuard = true;
    try {
      this.layout = def;
      this.applyGridCss();
      this.ensureTiles(def.count);
      this.placeTiles();
    } finally {
      this.busyGuard = false;
    }
    this.ready = true;
    this.applyAll();
    this.setActive(Math.min(this.active, this.tiles.length - 1));
    this.el.dispatchEvent(new CustomEvent('layoutchange', { detail: this.layoutInfo() }));
    return true;
  }

  layoutId(): string {
    return this.layout.id;
  }

  /** rows / cols 是布局的行列轨道数（均匀网格时就是行列数） */
  layoutInfo(): { rows: number; cols: number; total: number; id: string } {
    const g = gridTemplate(this.layout);
    return { rows: g.rows.length, cols: g.cols.length, total: this.tiles.length, id: this.layout.id };
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
    if (this.sync.range || this.sync.time) {
      this.busyGuard = true;
      try {
        for (let k = 0; k < this.tiles.length; k++) {
          if (k === ix) continue;
          const c = this.tiles[k].chart;
          if (this.sync.range) {
            // 日期范围：起止时间完全一致。目标区间比这一格的视口宽时靠右对齐，而不是静默只显示左侧一段
            c.revealSpan(t0, t1);
          } else {
            // 时间：只对齐最新一端的时刻，各格保持自己的可视跨度（缩放不被带走）
            const own = c.viewTimes();
            if (own) c.revealSpan(t1 - (own[1] - own[0]), t1);
          }
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
      time: this.sync.time,
      range: this.sync.range,
    };
  }

  setSync(key: string, on: boolean): void {
    if (key === 'symbol') this.sync.symbol = !!on;
    else if (key === 'interval') this.sync.interval = !!on;
    else if (key === 'crosshair') this.sync.crosshair = !!on;
    else if (key === 'time') this.sync.time = !!on;
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

  /* ------------------------------------------------------------- 主图样式 */

  /** 所有格同时切换样式（蜡烛 / 美国线 / 折线 / 面积）；新增的格子沿用当前样式 */
  setChartStyle(style: ChartStyle): void {
    this.styleName = style;
    for (const t of this.tiles) t.chart.setStyle(style);
  }

  /* ------------------------------------------------------------- 指标 */

  /** 整体换一组指标（Pine v6 脚本）；每一格在自己的数据上各自运行，新建的格子也会带上 */
  setStudies(defs: StudyDef[]): void {
    this.studyDefs = defs.slice();
    for (const t of this.tiles) t.chart.setStudies(this.studyDefs);
  }

  studiesNow(): StudyDef[] {
    return this.studyDefs;
  }

  /** 指标图例上的「设置 / 删除」按钮被点击 */
  setStudyHandler(fn: ((uid: string, action: 'settings' | 'remove') => void) | null): void {
    this.studyHandler = fn;
    for (const t of this.tiles) t.chart.setStudyHandler(fn);
  }

  chartStyleNow(): ChartStyle {
    return this.styleName;
  }

  themeNow(): string {
    return this.themeName;
  }

  /* --------------------------------------------------------- 批量操作 */

  /** 对每一格执行（比如切换 BB 通道、圆圈规则） */
  eachTile(fn: (chart: KChart, i: number) => void): void {
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

  charts(): KChart[] {
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
  t('网格格数 = 布局张数', L0.total === (layoutById(L0.id)?.count ?? -1), L0.id + '=' + L0.total);
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

  // 布局切换：均匀网格入口 + 目录里的非均匀布局
  grid.setLayout(2, 2);
  t('setLayout(2,2) 后是 4 格', grid.layoutInfo().total === 4 && grid.layoutId() === uniformLayoutId(2, 2));
  t('没有这种均匀布局时 setLayout 返回 false 且不动', (() => { const id = grid.layoutId(); return grid.setLayout(3, 4) === false && grid.layoutId() === id; })());
  t('未知布局 id 返回 false 且不动', (() => { const id = grid.layoutId(); return grid.setLayoutId('nope') === false && grid.layoutId() === id; })());
  for (const id of ['3-3', '4-5', '7-1', '16-2', '1-1']) {
    const def = layoutById(id);
    grid.setLayoutId(id);
    const tiles = grid.tiles;
    t('布局 ' + id + '：格数 = ' + (def ? def.count : '?'), !!def && tiles.length === def.count && grid.charts().every((c) => c.bars.length > 0));
    // 每格的实际占位要和目录里的矩形一致（按网格实测像素，容差 3px）
    const host = grid.el.getBoundingClientRect();
    if (def && host.width > 50 && host.height > 50) {
      const ok = def.cells.every((c, i) => {
        const r = tiles[i].el.getBoundingClientRect();
        const ex0 = host.left + c[0] * host.width, ey0 = host.top + c[1] * host.height;
        const ex1 = host.left + c[2] * host.width, ey1 = host.top + c[3] * host.height;
        return Math.abs(r.left - ex0) < 3 && Math.abs(r.top - ey0) < 3 && Math.abs(r.right - ex1) < 3 && Math.abs(r.bottom - ey1) < 3;
      });
      t('布局 ' + id + '：每格像素位置与目录一致', ok);
    }
  }
  grid.setLayoutId(L0.id);
  t('布局还原成功', grid.layoutInfo().total === L0.total && grid.layoutId() === L0.id);

  // 时间 / 日期范围联动的区别
  if (grid.tiles.length >= 2) {
    const savedS = grid.syncFlags();
    const [a0, b0] = [grid.charts()[0], grid.charts()[1]];
    grid.setSync('range', false);
    grid.setSync('time', true);
    const vb0 = b0.viewTimes();
    a0.showLast(40);
    const va = a0.viewTimes();
    const vb = b0.viewTimes();
    const dtB = b0.bars.length > 1 ? b0.bars[1].time - b0.bars[0].time : 86400000;
    t('「时间」联动：另一格的最新端时刻跟上活动格（容差 2 根）', !!va && !!vb && Math.abs(vb[1] - va[1]) <= dtB * 2,
      va && vb ? new Date(va[1]).toISOString().slice(0, 10) + ' vs ' + new Date(vb[1]).toISOString().slice(0, 10) : 'null');
    t('「时间」联动：另一格的可视跨度不被带走（±1 根）', !!vb && !!vb0 && Math.abs((vb[1] - vb[0]) - (vb0[1] - vb0[0])) <= dtB);
    grid.setSync('time', false);
    grid.setSync('range', savedS.range);
    grid.setSync('time', savedS.time);
  }

  log('网格自检：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail };
}
