"use strict";
/**
 * tv-chart / grid.ts
 * ---------------------------------------------------------------------------
 * 多图网格 + 联动（TradingView 的 Layout + Sync）。
 *
 * 依赖 chart.ts（同为全局脚本，**先加载 chart.js 再加载 grid.js**）。
 * 同样是全局脚本、只使用可擦除类型语法，`grid.js` 就是本文件删掉类型注解的样子：
 *
 *     npx --yes typescript@5 tsc -p tsconfig.json
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
/** 演示用标的。真实的活数据源接进来只需要换掉 barsFor()。 */
const SYMBOLS = [
    { ticker: '600519.SH', name: '贵州茅台', seed: 1101, base: 1680 },
    { ticker: '300750.SZ', name: '宁德时代', seed: 2202, base: 275 },
    { ticker: '000001.SH', name: '上证指数', seed: 3303, base: 3100 },
    { ticker: '000300.SH', name: '沪深300', seed: 4404, base: 3800 },
    { ticker: '601318.SH', name: '中国平安', seed: 5505, base: 46 },
    { ticker: '000858.SZ', name: '五粮液', seed: 6606, base: 142 },
];
const TIMEFRAMES = ['1D', '1W', '1M'];
const DAILY_COUNT = 900;
function symbolDef(ticker) {
    for (const s of SYMBOLS)
        if (s.ticker === ticker)
            return s;
    return SYMBOLS[0];
}
function symbolName(ticker) {
    return symbolDef(ticker).name;
}
/** 日线只生成一次，多个格子共用 */
const DAILY_CACHE = {};
function dailyFor(ticker) {
    if (!DAILY_CACHE[ticker]) {
        const def = symbolDef(ticker);
        DAILY_CACHE[ticker] = makeBars(DAILY_COUNT, def.seed, def.base);
    }
    return DAILY_CACHE[ticker];
}
/** 某标的某周期的 K 线：日线是确定性生成的，周/月由日线合成 */
function barsFor(ticker, tf) {
    return resample(dailyFor(ticker), tf);
}
class ChartGrid {
    constructor(target, options) {
        this.tiles = [];
        this.rows = 2;
        this.cols = 2;
        this.active = 0;
        this.timeframe = '1D';
        this.themeName = 'dark';
        this.legendInset = 34;
        this.sync = { symbol: true, interval: true, crosshair: true, range: true };
        /** 构建 / 批量换数据期间屏蔽回调，防止联动自己触发自己 */
        this.busyGuard = false;
        this.ready = false;
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!(el instanceof HTMLElement))
            throw new Error('ChartGrid: 第一个参数必须是容器元素');
        this.el = el;
        const o = options || {};
        this.rows = clamp(o.rows == null ? 2 : o.rows, 1, 4);
        this.cols = clamp(o.cols == null ? 2 : o.cols, 1, 4);
        this.timeframe = o.timeframe || '1D';
        this.themeName = o.theme || 'dark';
        this.legendInset = o.legendInset == null ? 34 : o.legendInset;
        if (o.sync) {
            if (o.sync.symbol != null)
                this.sync.symbol = !!o.sync.symbol;
            if (o.sync.interval != null)
                this.sync.interval = !!o.sync.interval;
            if (o.sync.crosshair != null)
                this.sync.crosshair = !!o.sync.crosshair;
            if (o.sync.range != null)
                this.sync.range = !!o.sync.range;
        }
        this.el.classList.add('tv-grid');
        this.applyGridCss();
        this.ensureTiles(this.rows * this.cols);
        this.ready = true;
        this.applyAll();
        log('ChartGrid: ' + this.rows + '×' + this.cols + ' = ' + this.tiles.length + ' 格');
    }
    /* ------------------------------------------------------------- 布局 */
    applyGridCss() {
        this.el.style.display = 'grid';
        // minmax(0, 1fr) 而不是 1fr —— 否则画布的固有尺寸会把轨道撑开，整个网格溢出
        this.el.style.gridTemplateColumns = 'repeat(' + this.cols + ', minmax(0, 1fr))';
        this.el.style.gridTemplateRows = 'repeat(' + this.rows + ', minmax(0, 1fr))';
        this.el.style.gap = '1px';
    }
    ensureTiles(n) {
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
            const ticker = SYMBOLS[i % SYMBOLS.length].ticker;
            const chart = new TVChart(canvas, barsFor(ticker, this.timeframe), {
                symbol: ticker,
                timeframe: this.timeframe,
                legendInset: this.legendInset,
                onCrosshair: (idx) => this.onCross(i, idx),
                onView: (t0, t1) => this.onView(i, t0, t1),
            });
            chart.setTheme(this.themeName);
            const tile = { el, canvas, badge, chart, symbol: ticker };
            el.addEventListener('pointerdown', () => this.setActive(i), { passive: true });
            this.tiles.push(tile);
        }
        for (let i = 0; i < this.tiles.length; i++)
            this.tiles[i].badge.textContent = String(i + 1);
    }
    setLayout(rows, cols) {
        const r = clamp(Math.round(rows), 1, 4);
        const c = clamp(Math.round(cols), 1, 4);
        this.busyGuard = true;
        try {
            this.rows = r;
            this.cols = c;
            this.applyGridCss();
            this.ensureTiles(r * c);
        }
        finally {
            this.busyGuard = false;
        }
        this.ready = true;
        this.applyAll();
        this.setActive(Math.min(this.active, this.tiles.length - 1));
        this.el.dispatchEvent(new CustomEvent('layoutchange', { detail: this.layoutInfo() }));
    }
    layoutInfo() {
        return { rows: this.rows, cols: this.cols, total: this.tiles.length };
    }
    setActive(i) {
        this.active = clamp(i, 0, Math.max(0, this.tiles.length - 1));
        for (let k = 0; k < this.tiles.length; k++) {
            this.tiles[k].el.classList.toggle('active', k === this.active);
        }
    }
    activeIndex() {
        return this.active;
    }
    /* ------------------------------------------------------------- 联动 */
    /** 十字光标联动（公开：宿主也可以手动驱动） */
    onCross(ix, idx) {
        if (!this.ready || this.busyGuard || !this.sync.crosshair)
            return;
        const src = this.tiles[ix];
        if (!src)
            return;
        const t = idx == null ? null : (src.chart.bars[idx] ? src.chart.bars[idx].time : null);
        this.busyGuard = true;
        try {
            for (let k = 0; k < this.tiles.length; k++) {
                if (k === ix)
                    continue;
                const c = this.tiles[k].chart;
                c.setSyncIndex(t == null || !c.bars.length ? null : c.indexAtTime(t));
            }
        }
        finally {
            this.busyGuard = false;
        }
    }
    /** 时间轴范围联动（公开：宿主也可以手动驱动） */
    onView(ix, t0, t1) {
        if (!this.ready || this.busyGuard)
            return;
        if (this.sync.range) {
            this.busyGuard = true;
            try {
                for (let k = 0; k < this.tiles.length; k++) {
                    if (k === ix)
                        continue;
                    this.tiles[k].chart.setViewTimes(t0, t1);
                }
            }
            finally {
                this.busyGuard = false;
            }
        }
        this.emitView();
    }
    /** 视口变了就广播一次 —— 底部的范围高亮靠它刷新 */
    emitView() {
        this.el.dispatchEvent(new CustomEvent('viewchange', { detail: { active: this.active } }));
    }
    /** 以活动格为基准，把时间轴范围刷给其它格 */
    syncRange() {
        if (!this.sync.range || !this.tiles.length)
            return;
        const src = this.tiles[this.active].chart;
        const vt = src.viewTimes();
        if (!vt)
            return;
        this.onView(this.active, vt[0], vt[1]);
    }
    syncFlags() {
        return {
            symbol: this.sync.symbol,
            interval: this.sync.interval,
            crosshair: this.sync.crosshair,
            range: this.sync.range,
        };
    }
    setSync(key, on) {
        if (key === 'symbol')
            this.sync.symbol = !!on;
        else if (key === 'interval')
            this.sync.interval = !!on;
        else if (key === 'crosshair')
            this.sync.crosshair = !!on;
        else if (key === 'range')
            this.sync.range = !!on;
        else
            return;
        // 关掉十字光标联动时，把别格残留的光标清掉，否则会留一条摘不掉的线
        if (key === 'crosshair' && !this.sync.crosshair) {
            for (const t of this.tiles)
                t.chart.setSyncIndex(null);
        }
        log('联动 ' + key + ' -> ' + (on ? '开' : '关'));
    }
    /* ----------------------------------------------------- 标的 / 周期 */
    loadTile(t, ticker, tf) {
        t.symbol = ticker;
        t.chart.setBars(barsFor(ticker, tf), { symbol: ticker, timeframe: tf });
    }
    /** 标的。sync.symbol 开 → 全部格子；关 → 只改当前活动格。 */
    setSymbol(ticker) {
        this.busyGuard = true;
        try {
            if (this.sync.symbol) {
                for (const t of this.tiles)
                    this.loadTile(t, ticker, this.timeframe);
            }
            else {
                const t = this.tiles[this.active];
                if (t)
                    this.loadTile(t, ticker, this.timeframe);
            }
        }
        finally {
            this.busyGuard = false;
        }
        this.syncRange();
    }
    /** 周期。sync.interval 开 → 全部格子；关 → 只改当前活动格。 */
    setTimeframe(tf) {
        this.timeframe = tf;
        this.busyGuard = true;
        try {
            if (this.sync.interval) {
                for (const t of this.tiles)
                    this.loadTile(t, t.symbol, tf);
            }
            else {
                const t = this.tiles[this.active];
                if (t)
                    this.loadTile(t, t.symbol, tf);
            }
        }
        finally {
            this.busyGuard = false;
        }
        this.syncRange();
    }
    activeSymbol() {
        const t = this.tiles[this.active];
        return t ? t.symbol : SYMBOLS[0].ticker;
    }
    /* ----------------------------------------------------- 显示范围（底部条） */
    /** 设置显示范围。作用于**活动格**；sync.range 开时自动联动到其它格。 */
    setRange(key) {
        const t = this.tiles[this.active];
        if (!t)
            return false;
        return t.chart.setRange(key);
    }
    /** 每个范围按钮当前是否可用（数据够不够长）—— 底部按钮靠这个置灰 */
    rangeAvailability() {
        const t = this.tiles[this.active];
        const out = [];
        if (!t)
            return out;
        for (const r of RANGES) {
            out.push({ key: r.key, label: r.label, ok: t.chart.rangeAvailable(r.key) });
        }
        return out;
    }
    /** 活动格当前视口覆盖多少天 */
    viewSpanDays() {
        const t = this.tiles[this.active];
        return t ? t.chart.viewSpan() / 86400000 : 0;
    }
    timeframeNow() {
        return this.timeframe;
    }
    /* ------------------------------------------------------------- 主题 */
    setTheme(name) {
        this.themeName = name;
        for (const t of this.tiles)
            t.chart.setTheme(name);
    }
    themeNow() {
        return this.themeName;
    }
    /* --------------------------------------------------------- 批量操作 */
    /** 对每一格执行（比如切换 BB 通道、圆圈规则） */
    eachTile(fn) {
        for (let i = 0; i < this.tiles.length; i++)
            fn(this.tiles[i].chart, i);
    }
    /** 全部格子重新显示最近 k 根并互相对齐 */
    showLastAll(k) {
        this.busyGuard = true;
        try {
            for (const t of this.tiles)
                t.chart.showLast(k);
        }
        finally {
            this.busyGuard = false;
        }
        this.syncRange();
        this.emitView();
    }
    fitAll() {
        this.busyGuard = true;
        try {
            for (const t of this.tiles)
                t.chart.fitContent();
        }
        finally {
            this.busyGuard = false;
        }
        this.emitView();
    }
    charts() {
        return this.tiles.map((t) => t.chart);
    }
    applyAll() {
        this.busyGuard = true;
        try {
            this.setTheme(this.themeName);
            for (const t of this.tiles) {
                t.chart.setChannelVisible('bb', true);
                t.chart.setBars(barsFor(t.symbol, this.timeframe), {
                    symbol: t.symbol,
                    timeframe: this.timeframe,
                });
            }
        }
        finally {
            this.busyGuard = false;
        }
        this.syncRange();
    }
    dispose() {
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
function gridSelfTest(grid) {
    let pass = 0;
    let fail = 0;
    const t = (name, ok, extra = '') => {
        if (ok)
            pass++;
        else
            fail++;
        log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
    };
    const L0 = grid.layoutInfo();
    t('网格格数 = rows × cols', L0.total === L0.rows * L0.cols, L0.rows + 'x' + L0.cols + '=' + L0.total);
    t('每格都有 K 线', grid.charts().every((c) => c.bars.length > 0), grid.charts().map((c) => c.bars.length).join(','));
    t('每格都有 BB 通道', grid.charts().every((c) => c.channels.length >= 1));
    // 十字光标联动：第 0 格报一个索引，其它格应该按**时间**跟过去
    const saved = grid.syncFlags().crosshair;
    grid.setSync('crosshair', true);
    const c0 = grid.charts()[0];
    const pick = Math.min(200, c0.bars.length - 1);
    const tgt = c0.bars[pick].time;
    grid.onCross(0, pick);
    const others = grid.charts().slice(1);
    t('十字光标按时间联动到其它格（容差 8 天，跨周期也对得上）', others.length > 0 && others.every((c) => {
        const id = c.crosshairIndex();
        return id != null && Math.abs(c.bars[id].time - tgt) < 86400000 * 8;
    }), 'others=' + others.length);
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
