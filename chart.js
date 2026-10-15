"use strict";
/**
 * tv-chart / chart.ts
 * ---------------------------------------------------------------------------
 * 一个不依赖任何第三方库的 TradingView 风格图表核心（Tier-1 范围）。
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
 *   ① 本文件是一个**全局脚本**：没有 `import` / `export`。tsc 因此直接产出经典脚本，
 *      index.html 用 `<script src="chart.js">` 加载 —— `file://` 双击打开和 `http://`
 *      都能跑，**不会有 ESM 的 CORS 问题**。代价是 TVChart 等成为全局名字。
 *   ② 只使用**可擦除（erasable）类型语法** —— 没有 enum、没有装饰器、
 *      没有 namespace、没有参数属性、没有 `const enum`、没有 `declare`。
 *      因此 `chart.js` 就是本文件删掉类型注解后的样子，二者可机械对应：
 *
 *          npx --yes typescript@5 tsc -p tsconfig.json
 *
 *   第 ② 条是因为写这份代码时会话的 shell 不可用（无法调用 tsc），需要同时交付
 *   一个「打开就能跑」的 chart.js。shell 恢复后请用上面这条命令重新生成，
 *   并以 chart.ts 为唯一真相。
 * ---------------------------------------------------------------------------
 */
/** 主题：只换背景/网格/文字/十字光标，不碰涨跌色（涨跌是 A 股习惯，不该跟着主题走）。 */
const THEMES = {
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
/** 用 BOLL(20,2) 的结果造一条 TradingView 风格的通道。 */
function makeBBChannel(bb) {
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
const DEFAULTS = {
    symbol: 'DEMO',
    timeframe: '1D',
    upColor: '#ef5350',
    downColor: '#26a69a',
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
    onCrosshair: function (_i) { },
    onView: function (_t0, _t1) { },
};
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
/**
 * 把任意步长吸附到 1 / 2 / 5 × 10^k。
 * 这是所有「好看的」坐标轴刻度的来源。
 */
function niceStep(raw) {
    if (!(raw > 0) || !isFinite(raw))
        return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * p;
}
/** 简单移动平均。前 n-1 项为 null。 */
function sma(values, n) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= n)
            sum -= values[i - n];
        if (i >= n - 1)
            out[i] = sum / n;
    }
    return out;
}
/** 布林带 BOLL(n, k)。中轨 = SMA(n)，上下轨 = 中轨 ± k × 总体标准差。 */
function bollinger(closes, n, k) {
    const mid = sma(closes, n);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    for (let i = n - 1; i < closes.length; i++) {
        const m = mid[i];
        if (m == null)
            continue;
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
function normalizeBars(input) {
    const ok = [];
    for (const b of input) {
        if (!b)
            continue;
        if (!isFinite(b.time) || !isFinite(b.open) || !isFinite(b.high) ||
            !isFinite(b.low) || !isFinite(b.close))
            continue;
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
    const out = [];
    for (const b of ok) {
        if (out.length && out[out.length - 1].time === b.time)
            out[out.length - 1] = b;
        else
            out.push(b);
    }
    return out;
}
/** 生成可复现的模拟日线（LCG 驱动的几何随机游走），跳过周末。 */
function makeBars(count, seed, startPrice) {
    let s = seed >>> 0 || 1;
    const rnd = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
    const bars = [];
    const d = new Date(2020, 0, 2, 9, 30, 0, 0);
    let price = startPrice;
    for (let i = 0; i < count; i++) {
        while (d.getDay() === 0 || d.getDay() === 6)
            d.setDate(d.getDate() + 1);
        const drift = Math.sin(i / 55) * 0.0016 + 0.0004;
        const shock = (rnd() - 0.5) * 0.030;
        const open = price;
        const close = Math.max(0.5, open * (1 + drift + shock));
        const high = Math.max(open, close) * (1 + rnd() * 0.012);
        const low = Math.min(open, close) * (1 - rnd() * 0.012);
        const volume = Math.round(4000000 * (0.5 + rnd()) * (1 + Math.abs(shock) * 22));
        bars.push({ time: d.getTime(), open, high, low, close, volume });
        price = close;
        d.setDate(d.getDate() + 1);
    }
    return bars;
}
/** 把时间映射到所属「周 / 月 / 日」的桶编号 */
function bucketKey(t, tf) {
    const d = new Date(t);
    if (tf === '1W') {
        // 该周的周一（把周日算作上一周的末尾）
        const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
        return Math.floor(monday.getTime() / 86400000);
    }
    if (tf === '1M')
        return d.getFullYear() * 12 + d.getMonth();
    return Math.floor(t / 86400000);
}
/**
 * 把日线合成更大周期。
 * 规矩：open 取该段**第一根**的 open，close 取**最后一根**的 close，
 * high/low 取段内极值，volume 求和，time 用该段第一根的开盘时间。
 * （把 close 写成第一根、或者 time 用最后时间，是这类函数最常见的两个错。）
 */
function resample(bars, tf) {
    if (!bars.length || tf === '1D')
        return bars.slice();
    const out = [];
    let cur = null;
    let key = -1;
    for (const b of bars) {
        const k = bucketKey(b.time, tf);
        if (!cur || k !== key) {
            if (cur)
                out.push(cur);
            cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
            key = k;
        }
        else {
            if (b.high > cur.high)
                cur.high = b.high;
            if (b.low < cur.low)
                cur.low = b.low;
            cur.close = b.close;
            cur.volume += b.volume;
        }
    }
    if (cur)
        out.push(cur);
    return out;
}
const RANGES = [
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
const MIN_RANGE_BARS = 5;
/** 某个范围在给定数据上的起始时间；算不出来返回 NaN */
function rangeStart(bars, key) {
    const n = bars.length;
    if (!n)
        return NaN;
    const last = bars[n - 1].time;
    if (key === 'YTD') {
        const d = new Date(last);
        return new Date(d.getFullYear(), 0, 1).getTime();
    }
    for (const r of RANGES)
        if (r.key === key && r.ms != null)
            return last - r.ms;
    return NaN;
}
/** 把日志同时写进 console 和页面上的 #log（headless --dump-dom 才能抓到）。 */
function log(msg) {
    const line = '[' + new Date().toISOString().slice(11, 23) + '] ' + msg;
    try {
        console.log(line);
    }
    catch (_e) { /* 忽略 */ }
    const el = typeof document !== 'undefined' ? document.getElementById('log') : null;
    if (el) {
        const div = document.createElement('div');
        div.textContent = line;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }
}
function fmtTime(t, spanDays) {
    const d = new Date(t);
    const p = (n) => (n < 10 ? '0' : '') + n;
    if (spanDays > 400)
        return d.getFullYear() + '/' + p(d.getMonth() + 1);
    if (spanDays > 75)
        return p(d.getMonth() + 1) + '/' + p(d.getDate());
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function decimalsFor(step) {
    if (!(step > 0))
        return 2;
    const d = Math.ceil(-Math.log10(step));
    return clamp(d, 0, 6);
}
/* ===========================================================================
 * 3. 图表核心
 * ========================================================================= */
class TVChart {
    /** 挂载外部图层。传 null 卸载。 */
    setHooks(h) {
        this.hooks = h;
    }
    constructor(target, bars, options = {}) {
        this.view = { from: 0, barW: 8 };
        this.scale = { min: 0, max: 1 };
        this.plot = { l: 0, t: 0, r: 0, b: 0, w: 0, h: 0 };
        this.W = 0;
        this.H = 0;
        this.dpr = 1;
        this.priceStep = 1;
        /** 鼠标在本图上的原始位置（本地十字光标的横线 + 右轴价格标签用） */
        this.pointer = null;
        /**
         * 由外部强制指定的十字光标 bar 索引 —— 多图联动走这里。
         * 为什么不是像素：两张图周期/缩放不同，像素 x 指的根本不是同一时刻。
         */
        this.syncIndex = null;
        this.dragging = false;
        this.dragX = 0;
        this.ma = [];
        /** addLine() 加进来的通用叠加线（Pine 的 plot 输出走这里） */
        this.extraLines = [];
        /** addMarkers() 加进来的三角标记（Pine 的 plotshape 输出走这里） */
        this.extraMarks = [];
        this.channels = [];
        this.rafId = 0;
        this.ro = null;
        /** 外部图层（绘图层）的钩子 */
        this.hooks = null;
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!(el instanceof HTMLCanvasElement)) {
            throw new Error('TVChart: 第一个参数必须是 <canvas> 或其选择器');
        }
        this.canvas = el;
        const ctx = el.getContext('2d');
        if (!ctx)
            throw new Error('TVChart: 无法获取 2d context');
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
            log('TVChart 初始化：' + this.bars.length + ' 根 bar，' +
                new Date(this.bars[0].time).toISOString().slice(0, 10) + ' → ' +
                new Date(this.bars[this.bars.length - 1].time).toISOString().slice(0, 10));
        }
        else {
            log('TVChart 初始化：数据为空');
        }
    }
    /* ---------------------------------------------------------------- 指标 */
    /**
     * 全量重算叠加线。自检会调它（所以不是 private）。
     * ⚠️ 只重算 **values**，绝不重建通道对象 —— 否则每来一根实时 tick，
     * 用户设的颜色 / 填充 / marker 就被冲回默认值了。
     */
    buildIndicators() {
        const closes = this.bars.map((b) => b.close);
        this.ma = [
            { name: 'MA5', color: '#f5c542', values: sma(closes, 5), width: 1, dash: [] },
            { name: 'MA10', color: '#4dabf7', values: sma(closes, 10), width: 1, dash: [] },
            { name: 'MA20', color: '#b197fc', values: sma(closes, 20), width: 1, dash: [] },
        ];
        const bb = bollinger(closes, 20, 2);
        if (!this.channels.length) {
            this.channels.push(makeBBChannel(bb));
        }
        else {
            for (const ch of this.channels) {
                if (ch.id !== 'bb')
                    continue;
                ch.upper.values = bb.upper.values;
                ch.basis.values = bb.mid.values;
                ch.lower.values = bb.lower.values;
            }
        }
    }
    /* ------------------------------------------------------ 通用叠加线 API */
    /** 加一条通用叠加线（Pine 的 plot 输出就走这里）。返回同一个句柄。 */
    addLine(ln) {
        this.extraLines.push(ln);
        this.invalidate();
        return ln;
    }
    /** 清掉所有 addLine 加进来的线（不动 MA / 通道） */
    clearLines() {
        this.extraLines.length = 0;
        this.invalidate();
    }
    /**
     * 打一批三角标记（Pine plotshape 的输出）。
     * `above` 为真画在价格上方（死叉/卖出），否则画在下方（金叉/买入）。
     */
    addMarkers(list) {
        for (const m of list)
            this.extraMarks.push(m);
        this.invalidate();
    }
    clearMarks() {
        this.extraMarks.length = 0;
        this.invalidate();
    }
    /** 当前参与自动缩放与绘制的所有叠加线 */
    activeLines() {
        const out = this.ma.slice();
        for (const ch of this.channels) {
            if (!ch.visible)
                continue;
            out.push(ch.upper, ch.basis, ch.lower);
        }
        for (const ln of this.extraLines)
            out.push(ln);
        return out;
    }
    /* ------------------------------------------------------------- 通道 API */
    /** 加一条通道。上下轨/中轨都是 `(number|null)[]`，长度对齐 bars。 */
    addChannel(cfg) {
        const ch = {
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
    setChannelVisible(id, on) {
        for (const ch of this.channels)
            if (ch.id === id)
                ch.visible = !!on;
        this.invalidate();
    }
    /**
     * 切换通道上小圆圈的规则：
     *   'none'     不画
     *   'touch'    high 触及上轨 / low 触及下轨
     *   'extremum' 上轨的局部极大 / 下轨的局部极小
     */
    setChannelMarker(id, mode) {
        for (const ch of this.channels)
            if (ch.id === id)
                ch.marker = mode;
        this.invalidate();
    }
    channelMarkers() {
        return this.channels.map((c) => ({ id: c.id, marker: c.marker }));
    }
    channelsVisible() {
        let n = 0;
        for (const ch of this.channels)
            if (ch.visible)
                n++;
        return n;
    }
    /* ---------------------------------------------------------------- 主题 */
    setTheme(name) {
        const t = THEMES[name] || THEMES.dark;
        this.o.bgColor = t.bg;
        this.o.gridColor = t.grid;
        this.o.axisTextColor = t.axisText;
        this.o.crossColor = t.cross;
        this.o.titleColor = t.title;
        for (const ch of this.channels)
            ch.fill = t.fill;
        this.invalidate();
    }
    /* --------------------------------------------- 多图联动 / 时间轴对齐 */
    /** 二分：返回 time <= t 的最后一根的下标（空数据返回 -1） */
    indexAtTime(t) {
        const b = this.bars;
        if (!b.length)
            return -1;
        let lo = 0;
        let hi = b.length - 1;
        let res = 0;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (b[mid].time <= t) {
                res = mid;
                lo = mid + 1;
            }
            else {
                hi = mid - 1;
            }
        }
        return res;
    }
    /** 当前视口左右边缘对应的时间。空数据返回 null。 */
    viewTimes() {
        const n = this.bars.length;
        if (!n)
            return null;
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
    setViewTimes(t0, t1) {
        const n = this.bars.length;
        if (!n || !(t1 > t0))
            return;
        const a = this.indexAtTime(t0);
        const b = this.indexAtTime(t1);
        const span = Math.max(1, b - a + 1);
        this.view.barW = clamp(this.plot.w / span, 1, 60);
        this.view.from = a;
        this.clampView();
        this.invalidate();
    }
    /** 外部指定十字光标（多图联动）。传 null 清除。 */
    setSyncIndex(i) {
        const v = i == null ? null : clamp(i, 0, Math.max(0, this.bars.length - 1));
        if (this.syncIndex === v)
            return;
        this.syncIndex = v;
        this.invalidate();
    }
    /** 当前十字光标锁定的 bar 索引（本地鼠标 / 外部同步，谁有算谁） */
    crosshairIndex() {
        return this.snapIndex();
    }
    notifyCrosshair() {
        this.o.onCrosshair(this.snapIndex());
    }
    notifyView() {
        const vt = this.viewTimes();
        if (vt)
            this.o.onView(vt[0], vt[1]);
    }
    /**
     * 换数据 / 换周期。
     * 原地改写 `this.bars`（`length = 0` + push）而不是整个换数组 ——
     * 外面可能已经拿了这个数组的引用（比如自检里的 `const bars = chart.bars`），
     * 换数组会让那些引用变成孤儿，指着一份再也不会更新的旧数据。
     */
    setBars(bars, meta) {
        const clean = normalizeBars(bars);
        this.bars.length = 0;
        for (const b of clean)
            this.bars.push(b);
        if (meta) {
            if (meta.symbol)
                this.o.symbol = meta.symbol;
            if (meta.timeframe)
                this.o.timeframe = meta.timeframe;
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
    setRange(key) {
        const n = this.bars.length;
        if (!n)
            return false;
        if (key === 'ALL') {
            this.fitContent();
            return true;
        }
        const t0raw = rangeStart(this.bars, key);
        if (!isFinite(t0raw))
            return false;
        let i0 = this.indexAtTime(t0raw);
        if (i0 <= 0) {
            this.fitContent();
            return false;
        }
        if (n - i0 < MIN_RANGE_BARS)
            i0 = Math.max(0, n - MIN_RANGE_BARS);
        this.setViewTimes(this.bars[i0].time, this.bars[n - 1].time);
        this.notifyView();
        return true;
    }
    /** 当前数据够不够长来满足这个范围（用来把越界的按钮置灰） */
    rangeAvailable(key) {
        const n = this.bars.length;
        if (!n)
            return false;
        if (key === 'ALL')
            return true;
        const t0 = rangeStart(this.bars, key);
        if (!isFinite(t0))
            return false;
        return t0 > this.bars[0].time;
    }
    /** 当前视口覆盖的时间跨度（毫秒） */
    viewSpan() {
        const vt = this.viewTimes();
        return vt ? vt[1] - vt[0] : 0;
    }
    /* ------------------------------------------------------- 坐标变换核心 */
    /** 当前可见的 bar 索引区间 [i0, i1]（含端点，可能越界） */
    visible() {
        const i0 = Math.floor(this.view.from);
        const i1 = Math.ceil(this.view.from + this.plot.w / this.view.barW);
        return [i0, i1];
    }
    /** bar 索引 → 该 bar 左边缘的像素 x */
    xOf(i) {
        return this.plot.l + (i - this.view.from) * this.view.barW;
    }
    /** bar 索引 → 该 bar 中心的像素 x */
    xCenter(i) {
        return this.xOf(i) + this.view.barW / 2;
    }
    /** 像素 x → bar 索引（小数） */
    iOf(px) {
        return this.view.from + (px - this.plot.l) / this.view.barW;
    }
    /** 价格 → 像素 y */
    yOf(price) {
        const s = this.scale;
        const span = s.max - s.min || 1;
        return this.plot.t + ((s.max - price) / span) * this.plot.h;
    }
    /** 像素 y → 价格 */
    pOf(py) {
        const s = this.scale;
        const span = s.max - s.min || 1;
        return s.max - ((py - this.plot.t) / this.plot.h) * span;
    }
    /* ------------------------------------------------------------ 视口操作 */
    computePlot() {
        const l = 0;
        const t = 6;
        const r = Math.max(1, this.W - this.o.axisWidth);
        const b = Math.max(1, this.H - this.o.axisHeight);
        return { l, t, r, b, w: Math.max(1, r - l), h: Math.max(1, b - t) };
    }
    /** 把 from 夹在合理范围内，保证不会把图拖到天边 */
    clampView() {
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
    showLast(k) {
        const n = this.bars.length;
        if (!n)
            return;
        this.view.barW = clamp(this.plot.w / Math.max(1, k), 1, 60);
        this.view.from = n - this.plot.w / this.view.barW;
        this.clampView();
        this.notifyView();
        this.invalidate();
    }
    /** 全部塞进视口 */
    fitContent() {
        const n = this.bars.length;
        if (!n)
            return;
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
    zoomAt(px, k) {
        const anchor = this.iOf(px);
        const next = clamp(this.view.barW * k, 1, 60);
        if (next === this.view.barW)
            return;
        this.view.barW = next;
        this.view.from = anchor - (px - this.plot.l) / next;
        this.clampView();
        this.notifyView();
        this.invalidate();
    }
    /* ------------------------------------------------------------- 事件 */
    bind() {
        const c = this.canvas;
        const sig = { signal: this.ac.signal };
        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
            const dy = e.deltaY * unit;
            if (!dy)
                return;
            this.zoomAt(e.offsetX, Math.exp(-dy * 0.0012));
        }, Object.assign({ passive: false }, sig));
        c.addEventListener('pointerdown', (e) => {
            const px = e.offsetX;
            const py = e.offsetY;
            try {
                c.setPointerCapture(e.pointerId);
            }
            catch (_e) { /* 忽略 */ }
            this.pointer = { x: px, y: py };
            // 外部图层先挑：它接管了这次点击，本图就不平移
            const taken = !!(this.hooks && this.hooks.onDown && this.hooks.onDown(px, py, e));
            if (!taken) {
                this.dragging = true;
                this.dragX = e.clientX;
            }
            this.invalidate();
        }, sig);
        c.addEventListener('pointermove', (e) => {
            const px = e.offsetX;
            const py = e.offsetY;
            if (this.hooks && this.hooks.onMove)
                this.hooks.onMove(px, py, e);
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
        const endDrag = (e) => {
            if (this.hooks && this.hooks.onUp)
                this.hooks.onUp(e.offsetX, e.offsetY, e);
            if (!this.dragging)
                return;
            this.dragging = false;
            try {
                c.releasePointerCapture(e.pointerId);
            }
            catch (_e) { /* 忽略 */ }
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
        }
        else {
            window.addEventListener('resize', () => this.resize(), sig);
        }
    }
    resize() {
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
    dispose() {
        this.ac.abort();
        if (this.ro)
            this.ro.disconnect();
        if (this.rafId)
            cancelAnimationFrame(this.rafId);
    }
    /* ----------------------------------------------------------- 实时更新 */
    /**
     * 推送一根 bar。同 time = 更新最后一根（forming candle），
     * 更大 time = 追加新的一根。这是实时行情的唯一入口。
     */
    update(bar) {
        const n = this.bars.length;
        if (n && bar.time === this.bars[n - 1].time) {
            this.bars[n - 1] = bar;
        }
        else if (!n || bar.time > this.bars[n - 1].time) {
            this.bars.push(bar);
        }
        else {
            log('update() 忽略了一根乱序 bar: ' + new Date(bar.time).toISOString());
            return;
        }
        // 800 根全量重算 < 1ms。生产环境应该只增量重算尾部。
        this.buildIndicators();
        const vis = this.plot.w / this.view.barW;
        if (n && this.view.from + vis >= n - 1.5)
            this.view.from = this.bars.length - vis;
        this.clampView();
        this.invalidate();
    }
    /* -------------------------------------------------------------- 渲染 */
    invalidate() {
        if (this.rafId)
            return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = 0;
            this.draw();
        });
    }
    /** 同步重绘：绕开 rAF 合帧。自检 / 截图 / 需要立刻拿到像素时用。 */
    drawNow() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
        this.draw();
    }
    priceTicks() {
        const s = this.scale;
        const target = Math.max(2, Math.round(this.plot.h / 62));
        const step = niceStep((s.max - s.min) / target);
        this.priceStep = step;
        const out = [];
        const first = Math.ceil(s.min / step);
        for (let k = 0; k < 60; k++) {
            const v = (first + k) * step;
            if (v > s.max)
                break;
            out.push(v);
        }
        return out;
    }
    timeTicks(i0, i1) {
        const per = Math.max(1, Math.ceil(78 / this.view.barW));
        const out = [];
        const lo = Math.max(0, i0);
        const hi = Math.min(this.bars.length - 1, i1);
        for (let i = Math.ceil(lo / per) * per; i <= hi; i += per)
            out.push(i);
        return out;
    }
    computeScale() {
        const [i0, i1] = this.visible();
        const lo = Math.max(0, i0);
        const hi = Math.min(this.bars.length - 1, i1);
        let min = Infinity;
        let max = -Infinity;
        for (let i = lo; i <= hi; i++) {
            const b = this.bars[i];
            if (b.low < min)
                min = b.low;
            if (b.high > max)
                max = b.high;
        }
        for (const ln of this.activeLines()) {
            for (let i = lo; i <= hi; i++) {
                const v = ln.values[i];
                if (v == null)
                    continue;
                if (v < min)
                    min = v;
                if (v > max)
                    max = v;
            }
        }
        if (!isFinite(min) || !isFinite(max))
            return { min: 0, max: 1 };
        if (max - min < 1e-9) {
            max = min + 1;
        }
        const pad = (max - min) * this.o.padding;
        return { min: min - pad, max: max + pad };
    }
    draw() {
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
        this.drawChannelFills(i0, i1); // 最底层：通道填充
        this.drawVolume(i0, i1); // 成交量压在填充上，不然会被染上一层
        this.drawCandles(i0, i1);
        this.drawLines(i0, i1); // MA
        this.drawChannelLines(i0, i1); // 通道线在 K 线上面
        this.drawMarks(); // Pine plotshape 打点
        if (this.hooks && this.hooks.onDraw)
            this.hooks.onDraw(ctx); // 外部图层（绘图工具）
        this.drawCrosshairV();
        ctx.restore();
        this.drawPriceAxis();
        this.drawTimeAxis(i0, i1);
        this.drawLastPrice();
        this.drawCrosshairLabels(i0, i1);
        this.drawLegend(i0, i1);
    }
    drawGrid(i0, i1) {
        const ctx = this.ctx;
        const p = this.plot;
        ctx.strokeStyle = this.o.gridColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const v of this.priceTicks()) {
            const y = Math.round(this.yOf(v)) + 0.5;
            if (y < p.t || y > p.b)
                continue;
            ctx.moveTo(p.l, y);
            ctx.lineTo(p.r, y);
        }
        for (const i of this.timeTicks(i0, i1)) {
            const x = Math.round(this.xCenter(i)) + 0.5;
            if (x < p.l || x > p.r)
                continue;
            ctx.moveTo(x, p.t);
            ctx.lineTo(x, p.b);
        }
        ctx.stroke();
    }
    volRect() {
        const p = this.plot;
        const h = p.h * this.o.volumeRatio;
        return { l: p.l, t: p.b - h, r: p.r, b: p.b, w: p.w, h };
    }
    drawVolume(i0, i1) {
        const ctx = this.ctx;
        const v = this.volRect();
        const lo = Math.max(0, i0);
        const hi = Math.min(this.bars.length - 1, i1);
        let maxV = 0;
        for (let i = lo; i <= hi; i++)
            if (this.bars[i].volume > maxV)
                maxV = this.bars[i].volume;
        if (maxV <= 0)
            return;
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
    drawChannelFills(i0, i1) {
        const ctx = this.ctx;
        const lo = Math.max(0, i0);
        const hi = Math.min(this.bars.length - 1, i1);
        for (const ch of this.channels) {
            if (!ch.visible)
                continue;
            const up = ch.upper.values;
            const dn = ch.lower.values;
            for (const run of this.channelRuns(ch, lo, hi)) {
                ctx.beginPath();
                for (let i = run[0]; i <= run[1]; i++) {
                    const x = this.xCenter(i);
                    const y = this.yOf(up[i]);
                    if (i === run[0])
                        ctx.moveTo(x, y);
                    else
                        ctx.lineTo(x, y);
                }
                for (let i = run[1]; i >= run[0]; i--) {
                    ctx.lineTo(this.xCenter(i), this.yOf(dn[i]));
                }
                ctx.closePath();
                ctx.fillStyle = ch.fill;
                ctx.fill();
            }
        }
    }
    /** 通道的三条线 + 小圆圈。**画在 K 线上面**。 */
    drawChannelLines(i0, i1) {
        const lo = Math.max(0, i0);
        const hi = Math.min(this.bars.length - 1, i1);
        for (const ch of this.channels) {
            if (!ch.visible)
                continue;
            this.strokeLine(ch.upper, lo, hi);
            this.strokeLine(ch.basis, lo, hi);
            this.strokeLine(ch.lower, lo, hi);
            if (ch.marker !== 'none')
                this.drawChannelMarkers(ch, lo, hi);
        }
    }
    /**
     * 把可见区间切成「上下轨都非 null」的连续段。
     * 不能整段走一条路径 —— 指标前 n-1 根是 null（样本不足），中间也可能有缺口；
     * 不切段的话填充会横跨缺口，画出一片根本不存在的区域。
     */
    channelRuns(ch, lo, hi) {
        const runs = [];
        let start = -1;
        for (let i = lo; i <= hi; i++) {
            const ok = ch.upper.values[i] != null && ch.lower.values[i] != null;
            if (ok && start < 0)
                start = i;
            if (start >= 0 && (!ok || i === hi)) {
                runs.push([start, ok ? i : i - 1]);
                start = -1;
            }
        }
        return runs;
    }
    /** 画单条折线，null 处断开 */
    strokeLine(ln, lo, hi) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.strokeStyle = ln.color;
        ctx.lineWidth = ln.width;
        ctx.setLineDash(ln.dash);
        let started = false;
        for (let i = lo; i <= hi; i++) {
            const v = ln.values[i];
            if (v == null) {
                started = false;
                continue;
            }
            const x = this.xCenter(i);
            const y = this.yOf(v);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            }
            else
                ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }
    /**
     * 通道上的小圆圈。
     * ⚠️ 截图里那几个圆圈的确切规则我判断不了（出现频率远低于「碰带」，
     * 也不像带宽极值），所以给出两种可切换的实现，让效果自己说话。
     */
    drawChannelMarkers(ch, lo, hi) {
        const up = ch.upper.values;
        const dn = ch.lower.values;
        const k = Math.max(1, ch.markerLookback);
        for (let i = lo; i <= hi; i++) {
            const u = up[i];
            const l = dn[i];
            if (u == null || l == null)
                continue;
            if (ch.marker === 'touch') {
                const b = this.bars[i];
                if (b.high >= u)
                    this.drawCircle(this.xCenter(i), this.yOf(u), ch.upper.color);
                if (b.low <= l)
                    this.drawCircle(this.xCenter(i), this.yOf(l), ch.lower.color);
            }
            else if (ch.marker === 'extremum') {
                if (this.isLocalMax(up, i, k))
                    this.drawCircle(this.xCenter(i), this.yOf(u), ch.upper.color);
                if (this.isLocalMin(dn, i, k))
                    this.drawCircle(this.xCenter(i), this.yOf(l), ch.lower.color);
            }
        }
    }
    isLocalMax(v, i, k) {
        const c = v[i];
        if (c == null)
            return false;
        for (let j = i - k; j <= i + k; j++) {
            if (j === i)
                continue;
            const o = v[j];
            if (o == null)
                return false;
            if (o >= c)
                return false;
        }
        return true;
    }
    isLocalMin(v, i, k) {
        const c = v[i];
        if (c == null)
            return false;
        for (let j = i - k; j <= i + k; j++) {
            if (j === i)
                continue;
            const o = v[j];
            if (o == null)
                return false;
            if (o <= c)
                return false;
        }
        return true;
    }
    /** Pine plotshape 的三角标记。画在 K 线上面，所以放在通道线之后。 */
    drawMarks() {
        if (!this.extraMarks.length)
            return;
        const ctx = this.ctx;
        const s = 5;
        for (const m of this.extraMarks) {
            if (m.index < 0 || m.index >= this.bars.length)
                continue;
            const x = this.xCenter(m.index);
            const y = this.yOf(m.price);
            ctx.beginPath();
            if (m.above) {
                ctx.moveTo(x, y - s);
                ctx.lineTo(x - s, y + s);
                ctx.lineTo(x + s, y + s);
            }
            else {
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
    drawCircle(x, y, color) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = this.o.bgColor;
        ctx.fill();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = color;
        ctx.stroke();
    }
    drawCandles(i0, i1) {
        const ctx = this.ctx;
        const bw = Math.max(1, Math.floor(this.view.barW * 0.7));
        const lo = Math.max(0, i0);
        const hi = Math.min(this.bars.length - 1, i1);
        for (let i = lo; i <= hi; i++) {
            const b = this.bars[i];
            const up = b.close >= b.open;
            const color = up ? this.o.upColor : this.o.downColor;
            const xc = Math.round(this.xCenter(i));
            const yH = this.yOf(b.high);
            const yL = this.yOf(b.low);
            const yO = this.yOf(b.open);
            const yC = this.yOf(b.close);
            ctx.fillStyle = color;
            ctx.fillRect(Math.round(xc - 0.5), Math.round(yH), 1, Math.max(1, Math.round(yL - yH)));
            const top = Math.min(yO, yC);
            const hgt = Math.max(1, Math.abs(yC - yO));
            ctx.fillRect(Math.round(xc - bw / 2), Math.round(top), bw, Math.round(hgt));
        }
    }
    /** 画 MA 和 addLine 的通用线。通道三条线由 drawChannelLines 负责（要画在 K 线上面）。 */
    drawLines(i0, i1) {
        const lo = Math.max(0, i0);
        const hi = Math.min(this.bars.length - 1, i1);
        for (const ln of this.ma)
            this.strokeLine(ln, lo, hi);
        for (const ln of this.extraLines)
            this.strokeLine(ln, lo, hi);
    }
    drawCrosshairV() {
        const ctx = this.ctx;
        const p = this.plot;
        const i = this.snapIndex();
        if (i == null)
            return;
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
    snapIndex() {
        if (!this.bars.length)
            return null;
        if (this.syncIndex != null)
            return clamp(this.syncIndex, 0, this.bars.length - 1);
        if (!this.pointer)
            return null;
        return clamp(Math.floor(this.iOf(this.pointer.x)), 0, this.bars.length - 1);
    }
    drawPriceAxis() {
        const ctx = this.ctx;
        const p = this.plot;
        ctx.font = this.o.font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.o.axisTextColor;
        const dec = decimalsFor(this.priceStep);
        for (const v of this.priceTicks()) {
            const y = this.yOf(v);
            if (y < p.t - 6 || y > p.b + 6)
                continue;
            ctx.fillText(v.toFixed(dec), p.r + 8, Math.round(y));
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.beginPath();
        ctx.moveTo(p.r + 0.5, 0);
        ctx.lineTo(p.r + 0.5, p.b);
        ctx.stroke();
    }
    drawTimeAxis(i0, i1) {
        const ctx = this.ctx;
        const p = this.plot;
        const lo = Math.max(0, i0);
        const hi = Math.min(this.bars.length - 1, i1);
        if (hi < lo)
            return;
        const spanDays = (this.bars[hi].time - this.bars[lo].time) / 86400000;
        ctx.font = this.o.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = this.o.axisTextColor;
        for (const i of this.timeTicks(i0, i1)) {
            const x = this.xCenter(i);
            if (x < p.l || x > p.r)
                continue;
            ctx.fillText(fmtTime(this.bars[i].time, spanDays), Math.round(x), p.b + this.o.axisHeight / 2);
        }
    }
    drawLastPrice() {
        const n = this.bars.length;
        if (!n)
            return;
        const ctx = this.ctx;
        const b = this.bars[n - 1];
        const y = Math.round(this.yOf(b.close)) + 0.5;
        const p = this.plot;
        if (y < p.t || y > p.b)
            return;
        const color = b.close >= b.open ? this.o.upColor : this.o.downColor;
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
        ctx.fillStyle = this.o.bgColor; // 标签文字用背景色：换主题时自动跟着走
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, p.r + 8, y);
    }
    drawCrosshairLabels(i0, i1) {
        const ptr = this.pointer;
        const i = this.snapIndex();
        if (!ptr && i == null)
            return;
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
            const y = p.b + this.o.axisHeight / 2;
            ctx.fillStyle = this.o.crossColor;
            ctx.fillRect(Math.round(x - bw / 2), Math.round(y - 9), Math.round(bw), 18);
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.fillText(label, Math.round(x), Math.round(y));
        }
    }
    /**
     * 图例。TradingView 是**每个指标一行**堆叠的，这里照做：
     *   ① 标的 · 周期 · OHLC · 涨跌幅
     *   ② MA5/10/20
     *   ③ 每条通道一行：名字 + 参数 + 上/中/下轨当前值
     */
    drawLegend(i0, i1) {
        const ctx = this.ctx;
        const p = this.plot;
        const n = this.bars.length;
        if (!n)
            return;
        const hi = Math.min(this.bars.length - 1, i1);
        const idx = this.snapIndex();
        const i = idx == null ? hi : idx;
        const b = this.bars[i];
        const prev = i > 0 ? this.bars[i - 1] : b;
        const up = b.close >= b.open;
        const color = up ? this.o.upColor : this.o.downColor;
        const chg = prev.close ? ((b.close - prev.close) / prev.close) * 100 : 0;
        const dec = decimalsFor(this.priceStep);
        const fmt = (v) => (v == null ? '--' : v.toFixed(dec));
        ctx.font = this.o.font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const rowH = 17;
        const x0 = p.l + this.o.legendInset;
        let y = p.t + 12;
        // 行 ① —— 主图
        let x = x0;
        const put = (text, fill, gap) => {
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
        if (idx != null)
            put('· ' + fmtTime(b.time, 30), this.o.axisTextColor, 10);
        // 行 ② —— MA
        y += rowH;
        x = x0;
        for (const ln of this.ma) {
            put(ln.name + ' ' + fmt(ln.values[i]), ln.color, 12);
        }
        // 行 ③.. —— 每条通道一行
        for (const ch of this.channels) {
            if (!ch.visible)
                continue;
            y += rowH;
            x = x0;
            put(ch.name, this.o.titleColor, 6);
            if (ch.params)
                put(ch.params, this.o.axisTextColor, 12);
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
    }
    /** 给无头验证用的一行摘要 */
    debugInfo() {
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
function selfTest(chart) {
    let pass = 0;
    let fail = 0;
    const names = [];
    const t = (name, ok, extra = '') => {
        names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
        if (ok)
            pass++;
        else
            fail++;
        log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
    };
    const near = (a, b, eps) => Math.abs(a - b) <= eps;
    const bars = chart.bars;
    // --- 数据层 ---
    let sorted = bars.length > 1;
    for (let i = 1; i < bars.length; i++)
        if (bars[i].time <= bars[i - 1].time)
            sorted = false;
    t('bars 严格升序且无重复 time', sorted, 'n=' + bars.length);
    let ohlc = true;
    for (const b of bars) {
        if (!(b.high >= Math.max(b.open, b.close) - 1e-9 && b.low <= Math.min(b.open, b.close) + 1e-9))
            ohlc = false;
    }
    t('每根 bar 满足 low<=min(o,c) 且 max(o,c)<=high', ohlc);
    const dirty = normalizeBars([
        { time: 3, open: 1, high: 1, low: 1, close: 1, volume: 0 },
        { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 0 },
        { time: 3, open: 9, high: 9, low: 9, close: 9, volume: 0 },
        { time: 2, open: NaN, high: 1, low: 1, close: 1, volume: 0 },
    ]);
    t('normalizeBars 排序+去重+剔除 NaN', dirty.length === 2 && dirty[0].time === 1 && dirty[1].time === 3 && dirty[1].open === 9, 'len=' + dirty.length);
    // --- 指标数学 ---
    const closes = bars.map((b) => b.close);
    const m5 = sma(closes, 5);
    const k = closes.length - 1;
    const naive = (closes[k] + closes[k - 1] + closes[k - 2] + closes[k - 3] + closes[k - 4]) / 5;
    t('sma(5) 末值与朴素均值一致', near(m5[k], naive, 1e-9));
    t('sma 前 4 项为 null', m5[0] === null && m5[3] === null && m5[4] !== null);
    const band = bollinger(closes, 20, 2);
    const mid = band.mid.values[k];
    const up = band.upper.values[k];
    const dn = band.lower.values[k];
    t('BOLL 上下轨关于中轨对称', near(up - mid, mid - dn, 1e-6));
    t('BOLL 中轨就是 sma(20)', near(mid, sma(closes, 20)[k], 1e-12));
    t('BOLL 上轨 > 中轨 > 下轨', up > mid && mid > dn);
    // --- 通道（TradingView 那种「上下轨 + 中轨 + 半透明填充」）---
    chart.drawNow();
    const chs = chart.channels;
    t('默认带一条 BB 通道', chs.length >= 1 && chs[0].id === 'bb', 'n=' + chs.length);
    const ch0 = chs[0];
    t('通道三条轨长度与 bars 对齐', ch0.upper.values.length === bars.length &&
        ch0.basis.values.length === bars.length &&
        ch0.lower.values.length === bars.length);
    t('通道前 19 根为 null（20 周期未满）', ch0.upper.values[18] === null && ch0.upper.values[19] !== null);
    let ordered = true;
    for (let i = 0; i < bars.length; i++) {
        const uu = ch0.upper.values[i];
        const mm = ch0.basis.values[i];
        const ll = ch0.lower.values[i];
        if (uu == null || mm == null || ll == null)
            continue;
        if (!(uu >= mm - 1e-9 && mm >= ll - 1e-9))
            ordered = false;
    }
    t('通道处处满足 upper >= basis >= lower', ordered);
    const runs = chart.channelRuns(ch0, 0, bars.length - 1);
    t('通道填充按缺口切段（前 19 根 null 被排除，不横跨缺口）', runs.length === 1 && runs[0][0] === 19 && runs[0][1] === bars.length - 1, 'runs=' + runs.length + ' [' + (runs[0] ? runs[0][0] + ',' + runs[0][1] : '-') + ']');
    const [s0, s1] = chart.visible();
    let maxU = -Infinity;
    let minL = Infinity;
    for (let i = Math.max(0, s0); i <= Math.min(bars.length - 1, s1); i++) {
        const uu = ch0.upper.values[i];
        const ll = ch0.lower.values[i];
        if (uu != null && uu > maxU)
            maxU = uu;
        if (ll != null && ll < minL)
            minL = ll;
    }
    t('通道上下轨被算进自动缩放（否则开通道时上下轨会被切掉）', chart.scale.max >= maxU - 1e-9 && chart.scale.min <= minL + 1e-9, 'scale=[' + chart.scale.min.toFixed(2) + ',' + chart.scale.max.toFixed(2) +
        '] band=[' + minL.toFixed(2) + ',' + maxU.toFixed(2) + ']');
    chart.setChannelMarker('bb', 'touch');
    const mm1 = chart.channelMarkers()[0].marker;
    chart.setChannelMarker('bb', 'none');
    t('setChannelMarker 能切到 touch 再切回 none', mm1 === 'touch' && chart.channelMarkers()[0].marker === 'none');
    // --- 多周期合成 & 时间轴对齐（多图联动的地基）---
    const wk = resample(bars, '1W');
    t('resample(1W) 非空且根数远少于日线', wk.length > 0 && wk.length < bars.length, 'd=' + bars.length + ' w=' + wk.length);
    let wkOk = true;
    {
        let j = 0;
        for (let i = 0; i < wk.length; i++) {
            const w = wk[i];
            const group = [];
            while (j < bars.length && bucketKey(bars[j].time, '1W') === bucketKey(w.time, '1W')) {
                group.push(bars[j]);
                j++;
            }
            if (!group.length) {
                wkOk = false;
                break;
            }
            let hi = -Infinity;
            let lo = Infinity;
            let vol = 0;
            for (const g of group) {
                if (g.high > hi)
                    hi = g.high;
                if (g.low < lo)
                    lo = g.low;
                vol += g.volume;
            }
            if (w.time !== group[0].time)
                wkOk = false;
            if (w.open !== group[0].open)
                wkOk = false;
            if (w.close !== group[group.length - 1].close)
                wkOk = false;
            if (Math.abs(w.high - hi) > 1e-9 || Math.abs(w.low - lo) > 1e-9)
                wkOk = false;
            if (Math.abs(w.volume - vol) > 1e-6)
                wkOk = false;
        }
    }
    t('resample(1W)：open 取首根 / close 取末根 / high·low 取极值 / volume 求和 / time 取首根', wkOk);
    const mo = resample(bars, '1M');
    t('resample(1M) 非空且根数 < 周线', mo.length > 0 && mo.length < wk.length, 'm=' + mo.length);
    const tRef = bars[400].time;
    t('indexAtTime 命中已有时间戳', chart.indexAtTime(tRef) === 400);
    t('indexAtTime 落在两根之间取前一根', chart.indexAtTime(tRef + 1) === 400);
    t('indexAtTime 早于第一根取 0', chart.indexAtTime(bars[0].time - 86400000) === 0);
    t('indexAtTime 晚于最后一根取末根', chart.indexAtTime(bars[bars.length - 1].time + 1e9) === bars.length - 1);
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
    t('setViewTimes 左边缘对齐请求起点', !!vt2 && vt2[0] <= tgt0 + 86400000, vt2s);
    t('setViewTimes 装得下时右边缘也覆盖请求终点', !!vt2 && (!canFitVt || vt2[1] >= tgt1 - 86400000), 'canFit=' + canFitVt + ' plotW=' + chart.plot.w.toFixed(0));
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
    t('setRange(ALL)：要么首尾全见，要么 barW 已到 1px 下限', okAll && !!vtAll && (canFitAll
        ? (vtAll[0] <= bars[0].time + 86400000 && vtAll[1] >= lastT - 86400000)
        : Math.abs(chart.view.barW - 1) < 1e-9), 'canFit=' + canFitAll + ' barW=' + chart.view.barW.toFixed(2));
    // 容差必须跟着**当前周期**走：月线一根就 30 天，
    // 固定 ±30 天的话「1Y ≈ 365 天」在月线上会直接假失败
    const barDays = nRange > 1 ? (lastT - bars[0].time) / (nRange - 1) / 86400000 : 1;
    t('setRange(1Y) 返回 true', chart.setRange('1Y') === true);
    const spanY = chart.viewSpan() / 86400000;
    t('setRange(1Y) 跨度 ≈365 天（容差 30 天 + 一根 bar）', Math.abs(spanY - 365) < 30 + barDays, spanY.toFixed(0) + 'd  bar=' + barDays.toFixed(1) + 'd');
    chart.setRange('1M');
    const spanM = chart.viewSpan() / 86400000;
    t('setRange(1M) 跨度 ≈30 天（容差 6 天 + 一根 bar）', Math.abs(spanM - 30) < 6 + barDays, spanM.toFixed(0) + 'd');
    const ytdOk = chart.rangeAvailable('YTD');
    chart.setRange('YTD');
    const vtYtd = chart.viewTimes();
    const ytdStart = new Date(new Date(lastT).getFullYear(), 0, 1).getTime();
    t('setRange(YTD) 可用时左边缘落在今年 1 月 1 日附近（±7 天）', !ytdOk || (!!vtYtd && Math.abs(vtYtd[0] - ytdStart) < 86400000 * 7), 'avail=' + ytdOk + ' ' + (vtYtd ? new Date(vtYtd[0]).toISOString().slice(0, 10) + ' vs ' +
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
        if (m !== 1 && m !== 2 && m !== 5 && m !== 10)
            nice = false;
        if (s < raw * 0.5 || s > raw * 2.5)
            nice = false;
    }
    t('niceStep 只产出 1/2/5×10^k 且量级正确', nice);
    // --- 坐标变换是互逆的 ---
    const [vi0, vi1] = chart.visible();
    const probe = clamp(Math.floor((vi0 + vi1) / 2), 0, bars.length - 1);
    t('索引→像素→索引 往返一致', near(chart.iOf(chart.xCenter(probe)), probe + 0.5, 1e-6), 'i=' + probe + ' got=' + chart.iOf(chart.xCenter(probe)).toFixed(9));
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
                Math.abs(full[i + 2] - bg[2]) > 12)
                ink++;
        }
        painted = ink > 50;
    }
    catch (e) {
        log('WARN  getImageData 不可用（画布被污染？）：' + String(e));
    }
    t('画布上确实画了东西（背景之外有像素）', painted);
    // --- 真正的行为断言：光标锚定缩放 ---
    const px = chart.plot.l + chart.plot.w * 0.37;
    const anchorBefore = chart.iOf(px);
    chart.zoomAt(px, 1.9);
    t('放大后光标下的 bar 索引不变', near(anchorBefore, chart.iOf(px), 1e-6), anchorBefore.toFixed(9) + ' -> ' + chart.iOf(px).toFixed(9));
    chart.zoomAt(px, 1 / 1.9);
    t('缩小回来后仍锚定同一根 bar', near(anchorBefore, chart.iOf(px), 1e-6));
    // --- 视口夹紧：极端缩放不能把图甩出去 ---
    chart.zoomAt(chart.plot.l, 1e6);
    const wMax = chart.view.barW;
    chart.zoomAt(chart.plot.r, 1e-6);
    const wMin = chart.view.barW;
    t('barW 被夹在 [1,60]', wMax <= 60 + 1e-9 && wMin >= 1 - 1e-9, 'max=' + wMax.toFixed(2) + ' min=' + wMin.toFixed(2));
    chart.fitContent();
    const fitBars = chart.visible();
    // barW 有 1px 下限，所以「装得下」和「装不下」是两种正当结果
    const canFit = chart.plot.w / bars.length >= 1;
    t('fitContent：最后一根始终可见，装得下时第一根也可见', fitBars[1] >= bars.length - 1 && (!canFit || fitBars[0] <= 1), '[' + fitBars[0] + ',' + fitBars[1] + '] n=' + bars.length + ' canFit=' + canFit);
    chart.showLast(180);
    const [a0, a1] = chart.visible();
    t('showLast(180) 后可见区间非空且贴住最新数据', a1 > a0 && a1 >= bars.length - 1 - 2 && a0 < bars.length, '[' + a0 + ',' + a1 + '] n=' + bars.length);
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
    if (chart.bars.length === n0 + 1)
        chart.bars.length = n0;
    chart.bars[n0 - 1] = snap;
    chart.buildIndicators();
    // 收尾：恢复成初始视图
    chart.showLast(180);
    chart.drawNow();
    log('自检完成：' + pass + ' PASS / ' + fail + ' FAIL');
    return { pass, fail, names };
}
