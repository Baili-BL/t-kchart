/**
 * 指标库（Pine v6）验证：
 *   ① 清单里每个可用指标都是 //@version=6、能跑通、画得出东西；
 *   ② 每个指标的数值都和一份**独立的 TypeScript 参考实现**逐根对数
 *      （参考实现只在测试里，不进产品代码：产品里的计算全部来自 Pine 脚本）。
 */
import { describe, expect, it } from 'vitest';
import { makeBars } from '../src/engine/chart';
import type { Bar } from '../src/engine/chart';
import { INDICATORS, SORTED_INDICATORS, findIndicator, indicatorById, makeStudyDef, runStudy, searchIndicators } from '../src/indicators';
import type { StudyOutput } from '../src/engine/studies';

const N = NaN;
const base = makeBars(400, 11, 100);
const bars: Bar[] = base.map((b, i) => ({ ...b, volume: 1000 + ((i * 7919) % 5000) }));
const META = { symbol: 'T', timeframe: '1D' };
const enabled = INDICATORS.filter((d) => d.source);

const O = bars.map((b) => b.open);
const H = bars.map((b) => b.high);
const L = bars.map((b) => b.low);
const C = bars.map((b) => b.close);
const V = bars.map((b) => b.volume);
const HL2 = bars.map((b) => (b.high + b.low) / 2);
const HLC3 = bars.map((b) => (b.high + b.low + b.close) / 3);

/* ------------------------------------------------------------ 参考实现 */

const lead = (x: number[]): number => {
  const i = x.findIndex((v) => Number.isFinite(v));
  return i < 0 ? x.length : i;
};
const pad = (n: number, tail: number[]): number[] => new Array<number>(n - tail.length).fill(N).concat(tail);
/** 对「开头是 NaN」的序列：只在有效段上算，再补回 NaN */
const onValid = (x: number[], f: (y: number[]) => number[]): number[] => {
  const s = lead(x);
  return pad(x.length, f(x.slice(s)));
};
const win = (x: number[], n: number, f: (w: number[]) => number): number[] =>
  onValid(x, (y) => y.map((_, i) => (i < n - 1 ? N : f(y.slice(i - n + 1, i + 1)))));
const sum = (w: number[]): number => w.reduce((a, b) => a + b, 0);
const mean = (w: number[]): number => sum(w) / w.length;
const smaR = (x: number[], n: number): number[] => win(x, n, mean);
const hiR = (x: number[], n: number): number[] => win(x, n, (w) => Math.max(...w));
const loR = (x: number[], n: number): number[] => win(x, n, (w) => Math.min(...w));
const sumR = (x: number[], n: number): number[] => win(x, n, sum);
const stdevR = (x: number[], n: number): number[] => win(x, n, (w) => { const m = mean(w); return Math.sqrt(mean(w.map((v) => (v - m) ** 2))); });
const wmaR = (x: number[], n: number): number[] => win(x, n, (w) => w.reduce((a, v, i) => a + v * (i + 1), 0) / ((n * (n + 1)) / 2));
const emaR = (x: number[], n: number): number[] => onValid(x, (y) => {
  const out: number[] = [];
  const a = 2 / (n + 1);
  y.forEach((v, i) => {
    if (i < n - 1) out.push(N);
    else if (i === n - 1) out.push(mean(y.slice(0, n)));
    else out.push(a * v + (1 - a) * out[i - 1]);
  });
  return out;
});
const rmaR = (x: number[], n: number): number[] => onValid(x, (y) => {
  const out: number[] = [];
  y.forEach((v, i) => {
    if (i < n - 1) out.push(N);
    else if (i === n - 1) out.push(mean(y.slice(0, n)));
    else out.push((out[i - 1] * (n - 1) + v) / n);
  });
  return out;
});
const chg = (x: number[], n = 1): number[] => x.map((v, i) => (i < n ? N : v - x[i - n]));
const lagged = (x: number[], n: number): number[] => x.map((_, i) => (i < n ? N : x[i - n]));
const TR = bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
const zip = (a: number[], b: number[], f: (x: number, y: number) => number): number[] => a.map((v, i) => f(v, b[i]));
const AD = (() => {
  let s = 0;
  return bars.map((b) => { s += b.high === b.low ? 0 : ((2 * b.close - b.low - b.high) / (b.high - b.low)) * b.volume; return s; });
})();

/** 在输出里按 title 找 plot 的值（null → NaN） */
const col = (out: StudyOutput, title: string): number[] => {
  const p = out.plots.find((q) => q.title === title);
  if (!p) throw new Error('没有这条 plot：' + title + '（有：' + out.plots.map((q) => q.title).join(' / ') + '）');
  return p.values.map((v) => (v === null ? N : v));
};
const run = (id: string, inputs: { [k: string]: any } = {}, data: Bar[] = bars): StudyOutput => {
  const d = indicatorById(id)!;
  return runStudy(makeStudyDef(d, inputs), data, META);
};

/** 逐根对数：ref 有限处必须相等；ref 是 NaN 处脚本必须也是 null（warmup 长度一致） */
function same(got: number[], want: number[], label: string, tol = 1e-7): void {
  expect(got.length, label + ' 长度').toBe(want.length);
  let checked = 0;
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    const g = got[i];
    if (!Number.isFinite(w)) {
      expect(Number.isNaN(g), `${label}[${i}] 应为 na，实际 ${g}`).toBe(true);
    } else {
      expect(Number.isFinite(g), `${label}[${i}] 应为 ${w}，实际 ${g}`).toBe(true);
      expect(Math.abs(g - w) <= tol * Math.max(1, Math.abs(w)), `${label}[${i}] 期望 ${w} 实际 ${g}`).toBe(true);
      checked++;
    }
  }
  expect(checked, label + ' 有效对比点数').toBeGreaterThan(50);
}

/* ------------------------------------------------------------ ① 清单 */

describe('指标清单（Pine v6）', () => {
  it('每个可用指标都是 //@version=6 脚本，并且能在 400 根行情上跑通、画出东西', () => {
    expect(enabled.length).toBeGreaterThanOrEqual(35);
    for (const d of enabled) {
      expect(d.source!.startsWith('//@version=6'), d.id + ' 必须是 v6').toBe(true);
      const out = runStudy(makeStudyDef(d), bars, META);
      expect(out.plots.length, d.id + ' 至少有一条 plot').toBeGreaterThan(0);
      expect(out.plots.some((p) => p.values.some((v) => v !== null)), d.id + ' 至少有一个非空值').toBe(true);
      for (const p of out.plots) {
        expect(p.values.length).toBe(bars.length);
        for (const v of p.values) if (v !== null) expect(Number.isFinite(v), d.id + '/' + p.title).toBe(true);
      }
    }
  });

  it('参考页里的 37 个名字全在清单里，按字母序；不能实现的都写了原因', () => {
    const names = ['24-hour volume', 'Accumulation/distribution', 'Advance-decline line', 'Advance-decline ratio', 'Advance-decline ratio (bars)',
      'Arnaud Legoux moving average', 'Aroon oscillator', 'Auto fib extension', 'Auto fib retracement', 'Auto key levels', 'Auto pitchfork',
      'Auto trendlines', 'Average directional index', 'Awesome oscillator', 'Balance of power', 'BBTrend', 'Chaikin money flow',
      'Chaikin oscillator', 'Chande Kroll stop', 'Chande momentum oscillator', 'Chandelier exit', 'Chop zone', 'Choppiness index',
      'Commodity channel index', 'Coppock curve', 'Correlation coefficient', 'Cumulative volume delta', 'Cumulative volume index',
      'Detrended price oscillator', 'Donchian channels', 'Double exponential moving average', 'Ease of movement',
      "Elder's force index", 'Exponential moving average'];
    const have = SORTED_INDICATORS.map((d) => d.name);
    for (const n of names) expect(have, n).toContain(n);
    // 清单整体按字母序（忽略大小写），数字开头的在最前
    expect(have).toEqual(have.slice().sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en')));
    expect(have[0]).toBe('24-hour volume');
    for (const d of INDICATORS) {
      expect(!!d.source !== !!d.unsupported, d.id + '：要么有脚本，要么写明不能用的原因').toBe(true);
    }
    expect(INDICATORS.find((d) => d.id === 'auto-key-levels')!.beta).toBe(true);
    expect(INDICATORS.find((d) => d.id === 'auto-trendlines')!.beta).toBe(true);
    expect(new Set(INDICATORS.map((d) => d.id)).size).toBe(INDICATORS.length);
  });

  it('搜索：名称 / 短名 / 中文关键词都能命中；findIndicator 精确优先', () => {
    expect(searchIndicators('ema').map((d) => d.id)).toContain('ema');
    expect(searchIndicators('EMA').map((d) => d.id)).toContain('dema');
    expect(searchIndicators('布林').map((d) => d.id)).toContain('bb');
    expect(searchIndicators('rsi').map((d) => d.id)).toEqual(['rsi']);
    expect(searchIndicators('zzzzzz')).toEqual([]);
    expect(searchIndicators('').length).toBe(SORTED_INDICATORS.length);
    expect(findIndicator('MACD')?.id).toBe('macd');
    expect(findIndicator('ema')?.id).toBe('ema');
    expect(findIndicator('相对强弱')?.id).toBe('rsi');
    expect(findIndicator('没有这个指标')).toBeNull();
  });

  it('不能用的指标不能被加到图上（给出原因）', () => {
    expect(() => makeStudyDef(indicatorById('adl-line')!)).toThrow(/不可用/);
  });
});

/* ------------------------------------------------------------ ② 对数 */

describe('指标数值 = 独立 TS 参考实现', () => {
  it('均线族：SMA / EMA / WMA / VWMA / HMA / ALMA / DEMA', () => {
    same(col(run('sma'), 'SMA'), smaR(C, 9), 'SMA');
    same(col(run('ema'), 'EMA'), emaR(C, 9), 'EMA');
    same(col(run('wma'), 'WMA'), wmaR(C, 9), 'WMA');
    same(col(run('vwma'), 'VWMA'), win(C.map((c, i) => c * V[i]), 20, sum).map((v, i) => v / sumR(V, 20)[i]), 'VWMA');
    const e1 = emaR(C, 9);
    same(col(run('dema'), 'DEMA'), zip(e1, emaR(e1, 9), (a, b) => 2 * a - b), 'DEMA');
    const raw = zip(wmaR(C, 4), wmaR(C, 9), (a, b) => 2 * a - b);
    same(col(run('hma'), 'HMA'), wmaR(raw, 3), 'HMA');
    // ALMA：m = floor(0.85*(len-1)), s = len/6，权重 exp(-(i-m)^2/(2 s^2))
    const m = Math.floor(0.85 * 8);
    const s = 9 / 6;
    const wts = Array.from({ length: 9 }, (_, i) => Math.exp(-((i - m) ** 2) / (2 * s * s)));
    same(col(run('alma'), 'ALMA'), win(C, 9, (w) => w.reduce((a, v, i) => a + v * wts[i], 0) / sum(wts)), 'ALMA');
  });

  it('改参数 / 改数据源后值跟着变（input 真的生效）', () => {
    same(col(run('ema', { Length: 21 }), 'EMA'), emaR(C, 21), 'EMA(21)');
    same(col(run('sma', { Source: 'hl2', Length: 5 }), 'SMA'), smaR(HL2, 5), 'SMA(hl2,5)');
  });

  it('布林带 / MACD / RSI / ATR / 随机 / 威廉 / CCI / MFI', () => {
    const bb = run('bb');
    const mid = smaR(C, 20);
    const sd = stdevR(C, 20);
    same(col(bb, 'Basis'), mid, 'BB basis');
    same(col(bb, 'Upper'), zip(mid, sd, (a, b) => a + 2 * b), 'BB upper');
    same(col(bb, 'Lower'), zip(mid, sd, (a, b) => a - 2 * b), 'BB lower');
    expect(bb.fills.length).toBe(1);

    const macd = run('macd');
    const line = zip(emaR(C, 12), emaR(C, 26), (a, b) => a - b);
    const sig = emaR(line, 9);
    same(col(macd, 'MACD'), pad(C.length, line.slice(25)).map((v, i) => (Number.isNaN(sig[i]) ? v : v)), 'MACD line');
    same(col(macd, 'Signal'), sig, 'MACD signal');
    same(col(macd, 'Histogram'), zip(line, sig, (a, b) => a - b), 'MACD hist');

    // RSI（Wilder）：第 14 个变动处用前 14 个涨跌幅的简单平均播种
    const gains = chg(C).map((v) => (Number.isFinite(v) ? Math.max(v, 0) : N));
    const losses = chg(C).map((v) => (Number.isFinite(v) ? Math.max(-v, 0) : N));
    const ag = rmaR(gains, 14);
    const al = rmaR(losses, 14);
    same(col(run('rsi'), 'RSI'), zip(ag, al, (a, b) => (b === 0 ? (a === 0 ? 50 : 100) : 100 - 100 / (1 + a / b))), 'RSI');

    same(col(run('atr'), 'ATR'), rmaR(TR, 14), 'ATR');

    const hh = hiR(H, 14);
    const ll = loR(L, 14);
    const k = zip(zip(C, ll, (c, l) => c - l), zip(hh, ll, (h, l) => h - l), (a, b) => (100 * a) / b);
    same(col(run('stoch'), '%K'), k, 'Stoch %K');
    same(col(run('stoch'), '%D'), smaR(k, 3), 'Stoch %D');
    same(col(run('wpr'), '%R'), zip(zip(C, hh, (c, h) => h - c), zip(hh, ll, (h, l) => h - l), (a, b) => (-100 * a) / b), 'Williams %R');

    const sma20 = smaR(HLC3, 20);
    const dev = win(HLC3, 20, (w) => { const m = mean(w); return mean(w.map((v) => Math.abs(v - m))); });
    same(col(run('cci'), 'CCI'), HLC3.map((v, i) => (v - sma20[i]) / (0.015 * dev[i])), 'CCI');

    const up = HLC3.map((v, i) => (i === 0 ? 0 : v > HLC3[i - 1] ? v * V[i] : 0));
    const dn = HLC3.map((v, i) => (i === 0 ? 0 : v < HLC3[i - 1] ? v * V[i] : 0));
    const su = sumR(up, 14);
    const sd2 = sumR(dn, 14);
    same(col(run('mfi'), 'MFI'), zip(su, sd2, (a, b) => 100 - 100 / (1 + a / b)), 'MFI');
  });

  it('量价类：OBV / A/D / CMF / Chaikin 振荡 / EFI / EOM / 24 小时成交量', () => {
    let s = 0;
    const obv = C.map((c, i) => { if (i > 0) s += c > C[i - 1] ? V[i] : c < C[i - 1] ? -V[i] : 0; return s; });
    same(col(run('obv'), 'OBV'), obv, 'OBV');
    same(col(run('acc-dist'), 'Accumulation/Distribution'), AD, 'A/D');

    const ad1 = bars.map((b) => (b.high === b.low ? 0 : ((2 * b.close - b.low - b.high) / (b.high - b.low)) * b.volume));
    same(col(run('cmf'), 'CMF'), zip(sumR(ad1, 20), sumR(V, 20), (a, b) => a / b), 'CMF');
    same(col(run('chaikin-osc'), 'Chaikin Oscillator'), zip(emaR(AD, 3), emaR(AD, 10), (a, b) => a - b), 'Chaikin osc');
    same(col(run('efi'), "Elder's Force Index"), emaR(zip(chg(C), V, (a, b) => a * b), 13), 'EFI');
    same(col(run('eom'), 'EOM'), smaR(zip(zip(chg(HL2), bars.map((b) => b.high - b.low), (a, b) => (10000 * a * b)), V, (a, b) => a / b), 14), 'EOM');

    // 日线：24 小时 = 当根
    same(col(run('volume-24h'), '24h volume'), V, '24h volume(1D)');
    // 1 小时线：最近 24 根之和
    const hourly = bars.map((b, i) => ({ ...b, time: Date.UTC(2024, 0, 1) + i * 3600000 }));
    same(col(run('volume-24h', {}, hourly), '24h volume'), V.map((_, i) => sum(V.slice(Math.max(0, i - 23), i + 1))), '24h volume(1h)');
  });

  it('趋势 / 动量类：ADX / Aroon / AO / BoP / BBTrend / CMO / Coppock / DPO / MOM / ROC / CHOP', () => {
    // ADX：官方文档里的等价写法
    const up = chg(H);
    const down = chg(L).map((v) => -v);
    const plusDM = up.map((u, i) => (Number.isNaN(u) ? N : u > down[i] && u > 0 ? u : 0));
    const minusDM = down.map((d, i) => (Number.isNaN(d) ? N : d > up[i] && d > 0 ? d : 0));
    const trr = rmaR(TR, 14);
    const plus = zip(rmaR(plusDM, 14), trr, (a, b) => (100 * a) / b);
    const minus = zip(rmaR(minusDM, 14), trr, (a, b) => (100 * a) / b);
    const dx = zip(plus, minus, (a, b) => Math.abs(a - b) / (a + b === 0 ? 1 : a + b));
    const adx = rmaR(dx, 14).map((v) => v * 100);
    const adxOut = run('adx');
    same(col(adxOut, 'ADX'), adx, 'ADX');
    same(col(adxOut, '+DI'), plus, '+DI');
    same(col(adxOut, '-DI'), minus, '-DI');

    // Aroon 振荡：窗口 len+1 根里最高 / 最低点距今的根数（并列取最近）
    const barsSince = (arr: number[], i: number, pickMax: boolean): number => {
      let bi = i - 14;
      for (let j = i - 14; j <= i; j++) if (pickMax ? arr[j] >= arr[bi] : arr[j] <= arr[bi]) bi = j;
      return i - bi;
    };
    same(col(run('aroon-osc'), 'Aroon Oscillator'),
      C.map((_, i) => (i < 14 ? N : (100 * (14 - barsSince(H, i, true))) / 14 - (100 * (14 - barsSince(L, i, false))) / 14)), 'Aroon osc');

    same(col(run('ao'), 'AO'), zip(smaR(HL2, 5), smaR(HL2, 34), (a, b) => a - b), 'AO');
    same(col(run('bop'), 'Balance of power'), bars.map((b) => (b.close - b.open) / (b.high - b.low)), 'BoP');

    const sdL = stdevR(C, 50);
    const m50 = smaR(C, 50);
    const m20 = smaR(C, 20);
    const sd20 = stdevR(C, 20);
    same(col(run('bbtrend'), 'BBTrend'), C.map((_, i) =>
      ((Math.abs(m20[i] - 2 * sd20[i] - (m50[i] - 2 * sdL[i])) - Math.abs(m20[i] + 2 * sd20[i] - (m50[i] + 2 * sdL[i]))) / m20[i]) * 100), 'BBTrend');

    const roc = (n: number): number[] => C.map((c, i) => (i < n ? N : ((c - C[i - n]) / C[i - n]) * 100));
    same(col(run('roc'), 'ROC'), roc(9), 'ROC');
    same(col(run('mom'), 'MOM'), chg(C, 10), 'MOM');
    same(col(run('coppock'), 'Coppock Curve'), wmaR(zip(roc(14), roc(11), (a, b) => a + b), 10), 'Coppock');
    same(col(run('cmo'), 'Chande MO'), C.map((_, i) => {
      if (i < 9) return N;
      let u = 0; let d = 0;
      for (let j = i - 8; j <= i; j++) { const c = C[j] - C[j - 1]; if (c > 0) u += c; else d -= c; }
      return (100 * (u - d)) / (u + d);
    }), 'CMO');

    const ma21 = smaR(C, 21);
    same(col(run('dpo'), 'DPO'), C.map((c, i) => c - lagged(ma21, 11)[i]), 'DPO');
    same(col(run('dpo', { Centered: true }), 'DPO'), zip(lagged(C, 11), ma21, (a, b) => a - b), 'DPO(centered)');

    same(col(run('chop'), 'CHOP'), C.map((_, i) => {
      if (i < 13) return N;
      const hi = Math.max(...H.slice(i - 13, i + 1));
      const lo = Math.min(...L.slice(i - 13, i + 1));
      return (100 * Math.log10(sum(TR.slice(i - 13, i + 1)) / (hi - lo))) / Math.log10(14);
    }), 'CHOP');
  });

  it('通道 / 止损类：Donchian / Chande Kroll / Chandelier', () => {
    const dc = run('donchian');
    const up = hiR(H, 20);
    const lo = loR(L, 20);
    same(col(dc, 'Upper'), up, 'DC upper');
    same(col(dc, 'Lower'), lo, 'DC lower');
    same(col(dc, 'Basis'), zip(up, lo, (a, b) => (a + b) / 2), 'DC basis');
    expect(dc.overlay).toBe(true);
    expect(dc.fills.length).toBe(1);

    const atr10 = rmaR(TR, 10);
    const fh = zip(hiR(H, 10), atr10, (a, b) => a - b);
    const fl = zip(loR(L, 10), atr10, (a, b) => a + b);
    const cks = run('chande-kroll');
    same(col(cks, 'Stop Short'), hiR(fh, 9), 'CKS short');
    same(col(cks, 'Stop Long'), loR(fl, 9), 'CKS long');

    // Chandelier：棘轮 + 方向，逐根手算
    const atr22 = rmaR(TR, 22).map((v) => v * 3);
    const hc = hiR(C, 22);
    const lc = loR(C, 22);
    const ls: number[] = []; const ss: number[] = []; const lsOut: number[] = []; const ssOut: number[] = [];
    let dir = 1;
    for (let i = 0; i < C.length; i++) {
      let l = hc[i] - atr22[i];
      const lp = Number.isNaN(ls[i - 1] ?? N) ? l : ls[i - 1];
      if (i > 0 && C[i - 1] > lp) l = Math.max(l, lp);
      let s2 = lc[i] + atr22[i];
      const sp = Number.isNaN(ss[i - 1] ?? N) ? s2 : ss[i - 1];
      if (i > 0 && C[i - 1] < sp) s2 = Math.min(s2, sp);
      dir = C[i] > sp ? 1 : C[i] < lp ? -1 : dir;
      ls.push(l); ss.push(s2);
      lsOut.push(dir === 1 ? l : N);
      ssOut.push(dir === -1 ? s2 : N);
    }
    const ce = run('chandelier');
    same(col(ce, 'Long Stop'), lsOut.map((v, i) => (Number.isNaN(ls[i]) ? N : v)), 'CE long');
    same(col(ce, 'Short Stop'), ssOut.map((v, i) => (Number.isNaN(ss[i]) ? N : v)), 'CE short');
  });

  it('plot 的 style / 逐根颜色 / 隐藏 / hline / fill 都被正确带出来', () => {
    const ao = run('ao');
    expect(ao.plots[0].style).toBe('columns');
    expect(ao.plots[0].colors.some((c) => c !== null)).toBe(true);
    expect(new Set(ao.plots[0].colors.filter((c) => c)).size).toBeGreaterThan(1);
    const rsi = run('rsi');
    expect(rsi.hlines.map((h) => h.price)).toEqual([70, 50, 30]);
    expect(rsi.fills.length).toBe(1);
    expect(rsi.fills[0].a).toEqual({ kind: 'hline', price: 70 });
    expect(rsi.overlay).toBe(false);
    expect(run('ema').overlay).toBe(true);
    expect(rsi.inputDefs.map((d) => d.title)).toEqual(['Length', 'Source']);
    expect(rsi.inputDefs[0]).toMatchObject({ kind: 'int', def: 14, min: 1 });
  });
});

/* ------------------------------------------------------------ ③ store / Agent 控制 */

import { useStudyStore } from '../src/store/studyStore';
import { chartControls } from '../src/workspace/chartControls';

describe('study store 与 Agent 控制', () => {
  it('addIndicator / removeStudy / setInputs / clearStudies', () => {
    const st = useStudyStore.getState();
    st.clearStudies();
    expect(st.addIndicator('rsi').ok).toBe(true);
    expect(st.addIndicator('rsi').ok).toBe(true);   // 同一个指标可以加多个（不同参数）
    const [a, b] = useStudyStore.getState().studies;
    expect(a.uid).not.toBe(b.uid);
    expect(a.indicatorId).toBe('rsi');
    expect(a.source.startsWith('//@version=6')).toBe(true);
    st.setInputs(a.uid, { Length: 5 });
    expect(useStudyStore.getState().studies[0].inputs).toEqual({ Length: 5 });
    expect(useStudyStore.getState().studies[1].inputs).toEqual({});
    expect(st.removeStudy(a.uid)).toBe(true);
    expect(st.removeStudy('nope')).toBe(false);
    expect(useStudyStore.getState().studies.length).toBe(1);
    st.clearStudies();
    expect(useStudyStore.getState().studies).toEqual([]);
  });

  it('不可用 / 不存在的指标：ok=false 且带原因，不改 store', () => {
    const st = useStudyStore.getState();
    st.clearStudies();
    const r1 = st.addIndicator('adl-line');
    expect(r1.ok).toBe(false);
    expect(r1.message).toMatch(/暂不可用/);
    expect(st.addIndicator('不存在').ok).toBe(false);
    expect(useStudyStore.getState().studies).toEqual([]);
  });

  it('收藏切换', () => {
    const st = useStudyStore.getState();
    const had = st.favorites.includes('obv');
    st.toggleFavorite('obv');
    expect(useStudyStore.getState().favorites.includes('obv')).toBe(!had);
    st.toggleFavorite('obv');
    expect(useStudyStore.getState().favorites.includes('obv')).toBe(had);
  });

  it('chartControls：按名称 / 缩写 / 中文加删；同类全部移除；清单带原因', () => {
    const st = useStudyStore.getState();
    st.clearStudies();
    expect(chartControls.addStudy('MACD').ok).toBe(true);
    expect(chartControls.addStudy('相对强弱').ok).toBe(true);
    expect(chartControls.addStudy('rsi').ok).toBe(true);
    expect(useStudyStore.getState().studies.map((s) => s.indicatorId)).toEqual(['macd', 'rsi', 'rsi']);
    expect(chartControls.removeStudy('RSI')).toEqual({ ok: true, message: '已移除 2 个「Relative strength index」' });
    expect(chartControls.removeStudy('RSI').ok).toBe(false);
    expect(chartControls.addStudy('没有这个').ok).toBe(false);
    expect(chartControls.addStudy('Advance-decline line').ok).toBe(false);
    const list = chartControls.listStudies();
    expect(list).toContain('图上已有：Moving average convergence divergence');
    expect(list).toContain('Advance-decline line：');
    st.clearStudies();
  });
});
