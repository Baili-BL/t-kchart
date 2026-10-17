/**
 * 图表样式（设计稿「图表样式」菜单）
 *   - 平均K线 / 成交量蜡烛宽度 是纯函数，用手算值对数
 *   - 菜单里的每个样式要么能切（引擎 / store / Agent 三处一致），要么明确不可用并写明原因
 */
import { describe, expect, it } from 'vitest';
import { CHART_STYLES, heikinAshi, makeBars, markerColor, volCandleWidth } from '../src/engine/chart';
import type { Bar } from '../src/engine/chart';
import { STYLE_LABELS, styleFromLabel } from '../src/store/chartStore';
import { CHART_STYLE_KEYS, UNAVAILABLE_STYLES, createChartTools } from '../src/agent/tools';
import type { ChartControls } from '../src/agent/tools';
import { pickStyle, planToolCalls } from '../src/agent/providers/mock';

const bar = (o: number, h: number, l: number, c: number, v = 1, time = 0): Bar => ({ time, open: o, high: h, low: l, close: c, volume: v });

describe('平均K线（Heikin-Ashi）', () => {
  it('手算：首根 haOpen=(o+c)/2；后续 haOpen=(上一根 haOpen+haClose)/2；high/low 包住实体', () => {
    const bars = [bar(10, 14, 8, 12, 5, 1), bar(12, 16, 11, 15, 6, 2), bar(15, 15.5, 9, 10, 7, 3)];
    const ha = heikinAshi(bars);
    // 第 1 根
    expect(ha[0].close).toBeCloseTo((10 + 14 + 8 + 12) / 4, 12);      // 11
    expect(ha[0].open).toBeCloseTo((10 + 12) / 2, 12);                // 11
    expect(ha[0].high).toBe(14);
    expect(ha[0].low).toBe(8);
    // 第 2 根
    expect(ha[1].close).toBeCloseTo((12 + 16 + 11 + 15) / 4, 12);     // 13.5
    expect(ha[1].open).toBeCloseTo((11 + 11) / 2, 12);                // 11
    expect(ha[1].high).toBe(16);
    expect(ha[1].low).toBe(11);
    // 第 3 根
    expect(ha[2].close).toBeCloseTo((15 + 15.5 + 9 + 10) / 4, 12);    // 12.375
    expect(ha[2].open).toBeCloseTo((11 + 13.5) / 2, 12);              // 12.25
    expect(ha[2].high).toBe(15.5);
    expect(ha[2].low).toBe(9);
    // time / volume 原样保留，长度相同
    expect(ha.map((b) => b.time)).toEqual([1, 2, 3]);
    expect(ha.map((b) => b.volume)).toEqual([5, 6, 7]);
  });

  it('不变式：high ≥ max(open, close)、low ≤ min(open, close)；不修改入参', () => {
    const bars = makeBars(300, 3, 100);
    const copy = JSON.stringify(bars);
    const ha = heikinAshi(bars);
    expect(ha.length).toBe(bars.length);
    for (const b of ha) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close) - 1e-12);
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close) + 1e-12);
    }
    expect(JSON.stringify(bars)).toBe(copy);
    expect(heikinAshi([])).toEqual([]);
  });
});

describe('成交量蜡烛宽度', () => {
  it('随成交量单调递增；最大量 = 柱距 90%，零量 = 柱距 18%；至少 1px', () => {
    const w = (v: number): number => volCandleWidth(v, 100, 20);
    expect(w(100)).toBe(18);                 // floor(20 × 0.9 × 1.0)
    expect(w(0)).toBe(3);                    // floor(20 × 0.9 × 0.2)
    expect(w(50)).toBe(10);                  // floor(20 × 0.9 × 0.6)
    for (let v = 0; v < 100; v += 10) expect(w(v + 10)).toBeGreaterThanOrEqual(w(v));
    expect(volCandleWidth(5, 100, 1)).toBe(1);
    expect(volCandleWidth(5, 0, 20)).toBe(18);   // 没有最大量时按满宽，不出 NaN
  });
});

describe('带标记线的渐变色', () => {
  it('两端取设计稿的紫 / 蓝，中点是两者平均，越界夹紧', () => {
    expect(markerColor(0)).toBe('rgb(150,55,243)');
    expect(markerColor(1)).toBe('rgb(45,155,210)');
    expect(markerColor(0.5)).toBe('rgb(98,105,227)');   // ((150+45)/2, (55+155)/2, (243+210)/2) 四舍五入
    expect(markerColor(-3)).toBe(markerColor(0));
    expect(markerColor(9)).toBe(markerColor(1));
  });
});

describe('样式在引擎 / store / Agent 三处一致', () => {
  it('引擎里的每个样式都有菜单文案，文案反查回同一个样式，文案互不重复', () => {
    expect(Object.keys(STYLE_LABELS).sort()).toEqual([...CHART_STYLES].sort());
    for (const k of CHART_STYLES) expect(styleFromLabel(STYLE_LABELS[k])).toBe(k);
    expect(new Set(Object.values(STYLE_LABELS)).size).toBe(CHART_STYLES.length);
    expect([...CHART_STYLE_KEYS].sort()).toEqual([...CHART_STYLES].sort());
  });

  it('设计稿菜单的 13 个文案都在', () => {
    const want = ['美国线', 'K线图', '空心K线图', '成交量蜡烛', '线形图', '带标记线', '阶梯线', '面积图', 'HLC区域', '基准线', '柱状图', '高-低', '平均K线图'];
    expect(Object.values(STYLE_LABELS).sort()).toEqual([...want].sort());
  });

  it('关键词 → 样式：具体名字优先于泛称（「空心K线」不能被认成普通 K 线）', () => {
    const cases: Array<[string, string]> = [
      ['切到空心K线图', 'hollow'], ['换成平均K线', 'heikin'], ['用 Heikin Ashi', 'heikin'],
      ['成交量蜡烛', 'volcandles'], ['带标记线', 'linemarkers'], ['阶梯线', 'step'],
      ['HLC区域', 'hlcarea'], ['基准线', 'baseline'], ['柱状图', 'columns'], ['高-低', 'highlow'],
      ['面积图', 'area'], ['线形图', 'line'], ['美国线', 'bars'], ['K线图', 'candles'],
      ['砖形图', 'renko'], ['卡吉图', 'kagi'], ['点数图', 'pnf'], ['范围图', 'range'],
      ['新价线', 'linebreak'], ['成交量轨迹', 'footprint'], ['时间价格机会', 'tpo'], ['交易时段成交量分布图', 'sessionvp'],
    ];
    for (const [text, key] of cases) expect(pickStyle(text), text).toBe(key);
    expect(pickStyle('切到 NVDA')).toBeNull();
    expect(planToolCalls('换成阶梯线').find((c) => c.name === 'set_chart_style')?.arguments.style).toBe('step');
  });

  it('不可用的样式：Agent 说出原因，且不会碰图表；不会被悄悄换成别的样式', async () => {
    const log: string[] = [];
    const ctl = new Proxy({}, { get: (_t, k) => (...a: unknown[]) => { log.push(String(k) + ':' + a.join(',')); return { ok: true, message: '' }; } }) as unknown as ChartControls;
    const tools = createChartTools(ctl);
    for (const [key, reason] of Object.entries(UNAVAILABLE_STYLES)) {
      const r = await tools.execute({ id: 'x', name: 'set_chart_style', arguments: { style: key } });
      expect(r.ok, key).toBe(false);
      expect(r.content).toContain(reason);
    }
    expect(Object.keys(UNAVAILABLE_STYLES).length).toBe(8);
    expect(log).toEqual([]);
    const okR = await tools.execute({ id: 'y', name: 'set_chart_style', arguments: { style: 'HEIKIN' } });
    expect(okR.ok).toBe(true);
    expect(log).toEqual(['setChartStyle:heikin']);
  });
});
