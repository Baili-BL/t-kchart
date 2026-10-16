/**
 * 图表样式的浏览器侧自检：13 种样式的价格轴口径 + 像素断言（要读 canvas 像素，所以不进 vitest）。
 * 纯函数部分（平均K线 / 成交量蜡烛宽度 / 关键词）在 tests/styles.test.ts。
 */
import type { Bar, ChartStyle, KChart } from './chart';
import { CHART_STYLES, heikinAshi, log, markerColor, volCandleWidth } from './chart';

export interface StyleTestResult {
  pass: number;
  fail: number;
  names: string[];
}

type RGB = [number, number, number];

function parseColor(c: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const r = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : [0, 0, 0];
}

const dist = (a: RGB, b: RGB): number => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

export function styleSelfTest(chart: KChart): StyleTestResult {
  let pass = 0;
  let fail = 0;
  const names: string[] = [];
  const t = (name: string, ok: boolean, extra: string = ''): void => {
    names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
    if (ok) pass++; else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };

  const saved = { from: chart.view.from, barW: chart.view.barW, style: chart.style() };
  chart.setStudies([]);
  chart.setStyle('candles');

  const o = chart.opts();
  const BG = parseColor(o.bgColor);
  const UP = parseColor(o.upColor);
  const DN = parseColor(o.downColor);
  const LINE = parseColor(o.lineColor);

  /** 取 css 坐标 (x, y) 的像素；取不到（跨域污染）返回 null */
  const px = (x: number, y: number): RGB | null => {
    try {
      const d = chart.ctx.getImageData(Math.round(x * chart.dpr), Math.round(y * chart.dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    } catch (e) {
      return null;
    }
  };
  /** 以 (x, y) 为中心 ±r 的方块里，最接近目标色的距离 */
  const nearest = (x: number, y: number, r: number, want: RGB): number => {
    let best = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const p = px(x + dx, y + dy);
        if (p) best = Math.min(best, dist(p, want));
      }
    }
    return best;
  };

  // 让柱子够宽、够好认：barW=14，从中间开始铺
  const n0 = chart.bars.length;
  chart.view.barW = 14;
  chart.view.from = Math.max(0, Math.floor(n0 / 2) - 6);
  chart.drawNow();
  const [i0, i1] = chart.visible();
  const lo = Math.max(0, i0);
  const hi = Math.min(chart.bars.length - 1, i1);
  const candleScale = { min: chart.scale.min, max: chart.scale.max };

  // ---- A. 13 种样式都能切 / 能画 / 价格轴有限
  const CLOSE_ONLY: ChartStyle[] = ['line', 'linemarkers', 'step', 'area', 'baseline', 'columns'];
  for (const s of CHART_STYLES) {
    let threw = '';
    try {
      chart.setStyle(s);
      chart.drawNow();
    } catch (e) {
      threw = String(e);
    }
    t(`[${s}] 能切换、能绘制、价格轴有限`,
      !threw && chart.style() === s && isFinite(chart.scale.min) && isFinite(chart.scale.max) && chart.scale.max > chart.scale.min, threw);
  }

  // ---- B. 价格轴口径
  for (const s of CHART_STYLES) {
    chart.setStyle(s);
    chart.drawNow();
    const sc = chart.scale;
    if (CLOSE_ONLY.includes(s)) {
      t(`[${s}] 价格轴只按收盘价取范围（不宽于蜡烛的高低价范围）`,
        sc.min >= candleScale.min - 1e-9 && sc.max <= candleScale.max + 1e-9);
    } else if (s === 'heikin') {
      const ha = heikinAshi(chart.bars);
      let mn = Infinity;
      let mx = -Infinity;
      for (let i = lo; i <= hi; i++) { mn = Math.min(mn, ha[i].low); mx = Math.max(mx, ha[i].high); }
      t('[heikin] 价格轴覆盖可见范围内平均K线的最高 / 最低价', sc.min <= mn + 1e-9 && sc.max >= mx - 1e-9,
        `[${sc.min.toFixed(2)},${sc.max.toFixed(2)}] vs ha [${mn.toFixed(2)},${mx.toFixed(2)}]`);
    } else {
      t(`[${s}] 价格轴与蜡烛一致（按最高最低价）`,
        Math.abs(sc.min - candleScale.min) < 1e-9 && Math.abs(sc.max - candleScale.max) < 1e-9);
    }
  }

  // 找一根可见的、实体足够高（≥ 10px）的涨 / 跌 K 线
  const tall = (up: boolean): number => {
    for (let i = lo + 1; i <= hi - 1; i++) {
      const b = chart.bars[i];
      if ((b.close >= b.open) !== up) continue;
      if (Math.abs(chart.yOf(b.close) - chart.yOf(b.open)) >= 10) return i;
    }
    return -1;
  };
  const bodyMid = (b: Bar): number => (chart.yOf(b.open) + chart.yOf(b.close)) / 2;

  // ---- C. 空心 K 线
  {
    const iu = tall(true);
    const id = tall(false);
    /** 实体内 6 个采样点（左右 ±2px × 上中下）里，与目标色接近的个数；均线可能压过个别点，所以看多数而不是单点 */
    const votes = (i: number, want: RGB, tol: number): number => {
      const b = chart.bars[i];
      const yA = Math.min(chart.yOf(b.open), chart.yOf(b.close));
      const yB = Math.max(chart.yOf(b.open), chart.yOf(b.close));
      let c = 0;
      for (const f of [0.25, 0.5, 0.75]) {
        for (const dx of [-2, 2]) {
          const p = px(chart.xCenter(i) + dx, yA + (yB - yA) * f);
          if (!p || dist(p, want) < tol) c++;
        }
      }
      return c;
    };
    chart.setStyle('candles');
    chart.drawNow();
    const solidVotes = iu >= 0 ? votes(iu, UP, 40) : 0;
    chart.setStyle('hollow');
    chart.drawNow();
    t('空心K线：找得到高实体的涨 / 跌 K 线用于断言', iu >= 0 && id >= 0, `up=${iu} down=${id}`);
    if (iu >= 0) {
      const v = votes(iu, BG, 12);
      t('空心K线：涨线实体内部是背景色（空心）', v >= 4, `${v}/6`);
      t('（对照）同一根在普通K线下实体内部是涨色', solidVotes >= 4, `${solidVotes}/6`);
      t('空心K线：涨线边框是涨色', nearest(chart.xCenter(iu) - 14 * 0.7 / 2 + 0.5, bodyMid(chart.bars[iu]), 1, UP) < 40);
    }
    if (id >= 0) {
      const v = votes(id, DN, 40);
      t('空心K线：跌线仍是实心（实体内部是跌色）', v >= 4, `${v}/6`);
    }
  }

  // ---- D. 成交量蜡烛
  {
    let imax = lo;
    let imin = lo;
    for (let i = lo; i <= hi; i++) {
      if (chart.bars[i].volume > chart.bars[imax].volume) imax = i;
      if (chart.bars[i].volume < chart.bars[imin].volume) imin = i;
    }
    let maxV = 0;
    for (let i = lo; i <= hi; i++) maxV = Math.max(maxV, chart.bars[i].volume);
    chart.setStyle('volcandles');
    chart.drawNow();
    /** 实体第一行上，与该 bar 涨跌色接近的横向像素数（≈ 实体宽度） */
    const widthOf = (i: number): number => {
      const b = chart.bars[i];
      const want = b.close >= b.open ? UP : DN;
      const row = Math.round(Math.min(chart.yOf(b.open), chart.yOf(b.close))) + 0.5;
      const xc = chart.xCenter(i);
      let cnt = 0;
      for (let dx = -9; dx <= 9; dx++) {
        const p = px(xc + dx, row + (Math.abs(chart.yOf(b.close) - chart.yOf(b.open)) < 2 ? 0 : 1));
        if (p && dist(p, want) < 40) cnt++;
      }
      return cnt;
    };
    const wMax = widthOf(imax);
    const wMin = widthOf(imin);
    t('成交量蜡烛：成交量最大的比最小的实体更宽', wMax > wMin, `max=${wMax} min=${wMin}`);
    const exp = volCandleWidth(chart.bars[imax].volume, maxV, 14);
    t('成交量蜡烛：最大量的实体宽度 = volCandleWidth（±2px）', Math.abs(wMax - exp) <= 2, `got=${wMax} exp=${exp}`);
  }

  // ---- E. 阶梯线 vs 折线：两根收盘价差得远时，阶梯线的横线段在 y(close[i]) 上，折线在这里没有线
  {
    let k = -1;
    for (let i = lo; i < hi; i++) {
      if (Math.abs(chart.yOf(chart.bars[i].close) - chart.yOf(chart.bars[i + 1].close)) > 20) { k = i; break; }
    }
    t('阶梯线：找得到相邻收盘价差 > 20px 的两根', k >= 0);
    if (k >= 0) {
      const xm = (chart.xCenter(k) + chart.xCenter(k + 1)) / 2;
      const y = chart.yOf(chart.bars[k].close);
      chart.setStyle('step');
      chart.drawNow();
      const onStep = nearest(xm, y, 1, LINE);
      chart.setStyle('line');
      chart.drawNow();
      const onLine = nearest(xm, y, 1, LINE);
      t('阶梯线：两根之间的水平段在前一根收盘价高度', onStep < 60, 'dist=' + onStep);
      t('（对照）折线在同一位置没有线（走的是斜线）', onLine > 60, 'dist=' + onLine);
    }
  }

  // ---- F. 带标记线：蓝紫渐变 + 实心圆点（最高收盘处紫、最低收盘处蓝），不是空心圈
  {
    let kHi = lo;
    let kLo = lo;
    for (let i = lo; i <= hi; i++) {
      if (chart.bars[i].close > chart.bars[kHi].close) kHi = i;
      if (chart.bars[i].close < chart.bars[kLo].close) kLo = i;
    }
    const yHi = chart.yOf(chart.bars[kHi].close);
    const yLo = chart.yOf(chart.bars[kLo].close);
    chart.setStyle('line');
    chart.drawNow();
    const plain = px(chart.xCenter(kHi), yHi);
    chart.setStyle('linemarkers');
    chart.drawNow();
    const purple = parseColor(markerColor(0));
    const blue = parseColor(markerColor(1));
    t('带标记线：最高收盘价的圆点是紫色、实心（圆心与圆边都是紫）',
      nearest(chart.xCenter(kHi), yHi, 1, purple) < 40 && nearest(chart.xCenter(kHi) + 3, yHi, 0, purple) < 60);
    t('带标记线：最低收盘价的圆点是蓝色', nearest(chart.xCenter(kLo), yLo, 1, blue) < 40);
    t('（对照）折线在最高收盘价处不是紫色，是普通线色', !plain || dist(plain, purple) > 60, String(plain));
    t('带标记线：圆点半径 4px（上方 3px 在圆内是紫色，8px 处已在圆外）',
      nearest(chart.xCenter(kHi), yHi - 3, 0, purple) < 60 && nearest(chart.xCenter(kHi), yHi - 8, 1, purple) > 60);
  }

  // ---- G. 基准线：基准价落在可见收盘价范围内；之上的点是涨色线、之下的点是跌色线
  {
    chart.setStyle('baseline');
    chart.drawNow();
    const base = chart.baselinePrice();
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = lo; i <= hi; i++) { mn = Math.min(mn, chart.bars[i].close); mx = Math.max(mx, chart.bars[i].close); }
    t('基准线：基准价 = 可见收盘价范围的中点', base != null && Math.abs(base - (mn + mx) / 2) < 1e-9, String(base));
    if (base != null) {
      let ia = -1;
      let ib = -1;
      for (let i = lo; i <= hi; i++) {
        const c = chart.bars[i].close;
        if (ia < 0 && c > base && Math.abs(chart.yOf(c) - chart.yOf(base)) > 10) ia = i;
        if (ib < 0 && c < base && Math.abs(chart.yOf(c) - chart.yOf(base)) > 10) ib = i;
      }
      t('基准线：基准价上下都有收盘价可测', ia >= 0 && ib >= 0, `above=${ia} below=${ib}`);
      if (ia >= 0) t('基准线：高于基准的收盘价处是涨色线', nearest(chart.xCenter(ia), chart.yOf(chart.bars[ia].close), 1, UP) < 60);
      if (ib >= 0) t('基准线：低于基准的收盘价处是跌色线', nearest(chart.xCenter(ib), chart.yOf(chart.bars[ib].close), 1, DN) < 60);
    }
  }

  // ---- H. 柱状图：柱子一直画到绘图区底部，颜色按相对上一根收盘价
  {
    chart.setStyle('columns');
    chart.drawNow();
    const k = Math.floor((lo + hi) / 2);
    const want = chart.bars[k].close >= chart.bars[k - 1].close ? UP : DN;
    t('柱状图：柱子底部（绘图区下沿上方）是涨 / 跌色', nearest(chart.xCenter(k), chart.plot.b - 3, 1, want) < 40);
  }

  // ---- I. 高-低：最高到最低之间是线色实心柱
  {
    chart.setStyle('highlow');
    chart.drawNow();
    const k = Math.floor((lo + hi) / 2);
    const b = chart.bars[k];
    const mid = px(chart.xCenter(k), (chart.yOf(b.high) + chart.yOf(b.low)) / 2);
    t('高-低：最高 / 最低价之间是线色柱', !mid || dist(mid, LINE) < 40, String(mid));
  }

  // ---- J. HLC 区域：高低价之间有填充（与高价上方不同）
  {
    chart.setStyle('hlcarea');
    chart.drawNow();
    const k = Math.floor((lo + hi) / 2);
    const b = chart.bars[k];
    const inside = px(chart.xCenter(k) + 3, (chart.yOf(b.high) + chart.yOf(b.low)) / 2 + 2);
    const above = px(chart.xCenter(k) + 3, Math.max(chart.plot.t + 2, chart.yOf(b.high) - 12));
    t('HLC 区域：高低价之间有半透明填充', !inside || !above || dist(inside, above) >= 6, `${inside} vs ${above}`);
    t('HLC 区域：最高价线是涨色、最低价线是跌色',
      nearest(chart.xCenter(k), chart.yOf(b.high), 2, UP) < 60 && nearest(chart.xCenter(k), chart.yOf(b.low), 2, DN) < 60);
  }

  // ---- K. 平均K线：画的是平均值而不是真实 OHLC，且实时 tick 改最后一根会刷新
  {
    chart.setStyle('heikin');
    chart.drawNow();
    const ha = heikinAshi(chart.bars);
    let k = -1;
    for (let i = lo + 1; i <= hi - 1; i++) {
      if (Math.abs(chart.yOf(ha[i].close) - chart.yOf(ha[i].open)) >= 10) { k = i; break; }
    }
    t('平均K线：找得到高实体的平均K线用于断言', k >= 0);
    if (k >= 0) {
      const want = ha[k].close >= ha[k].open ? UP : DN;
      const mid = px(chart.xCenter(k), (chart.yOf(ha[k].open) + chart.yOf(ha[k].close)) / 2);
      t('平均K线：实体中心是平均K线的涨 / 跌色', !mid || dist(mid, want) < 40, String(mid));
    }
    // 实时 tick：把最后一根拉高 30%，平均K线缓存必须失效（价格轴上沿跟着升）
    const n = chart.bars.length;
    const last = chart.bars[n - 1];
    const keep = { ...last };
    chart.view.from = Math.max(0, n - Math.floor(chart.plot.w / chart.view.barW) + 4);
    chart.drawNow();
    const maxBefore = chart.scale.max;
    chart.update({ ...last, high: last.high * 1.3, close: last.high * 1.3 });
    chart.drawNow();
    t('平均K线：实时 tick 改最后一根后价格轴上沿上升（缓存已失效）', chart.scale.max > maxBefore, `${maxBefore.toFixed(2)} → ${chart.scale.max.toFixed(2)}`);
    chart.update(keep);
  }

  // ---- 还原
  chart.setStyle(saved.style);
  chart.view.from = saved.from;
  chart.view.barW = saved.barW;
  chart.drawNow();
  t('样式自检结束后样式与视口已还原', chart.style() === saved.style && chart.view.barW === saved.barW);

  return { pass, fail, names };
}
