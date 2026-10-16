import { describe, expect, it } from 'vitest';
import { INTRADAY_MINUTES, MOCK_SYMBOLS, genDaily, genIntraday, mockDataSource, symbolInfo, tradingDays } from '../src/data/mockBars';
import type { Bar } from '../src/engine/chart';

const ANCHOR = new Date(2026, 9, 16, 12, 0, 0); // 2026-10-16（周五）
const tsla = symbolInfo('TSLA');

function expectValidBars(bars: Bar[]): void {
  expect(bars.length).toBeGreaterThan(0);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    // 时间戳铁律：epoch 毫秒（秒级会 < 1e11）
    expect(b.time).toBeGreaterThan(1e11);
    if (i > 0) expect(b.time).toBeGreaterThan(bars[i - 1].time);
    expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close) - 1e-9);
    expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close) + 1e-9);
    expect(b.low).toBeGreaterThan(0);
    expect(b.volume).toBeGreaterThanOrEqual(0);
  }
}

describe('mockBars', () => {
  it('tradingDays：升序、不含周末、数量正确、最后一天不晚于锚点', () => {
    const days = tradingDays(30, ANCHOR);
    expect(days).toHaveLength(30);
    for (let i = 0; i < days.length; i++) {
      expect([0, 6]).not.toContain(days[i].getDay());
      if (i > 0) expect(days[i].getTime()).toBeGreaterThan(days[i - 1].getTime());
    }
    expect(days[29].getTime()).toBeLessThanOrEqual(ANCHOR.getTime());
  });

  it('日线：OHLC 合法、升序、最后一根收盘价 == 标的现价', () => {
    const bars = genDaily(tsla, ANCHOR, 400);
    expectValidBars(bars);
    expect(bars).toHaveLength(400);
    expect(bars[bars.length - 1].close).toBeCloseTo(tsla.last, 8);
  });

  it('确定性：同样的输入得到逐字节相同的数据', () => {
    expect(genDaily(tsla, ANCHOR, 100)).toEqual(genDaily(tsla, ANCHOR, 100));
    expect(genIntraday(tsla, '30m', ANCHOR, 5)).toEqual(genIntraday(tsla, '30m', ANCHOR, 5));
  });

  it('不同标的走势不同', () => {
    const a = genDaily(MOCK_SYMBOLS[0], ANCHOR, 50).map((b) => b.close / MOCK_SYMBOLS[0].last);
    const b = genDaily(MOCK_SYMBOLS[1], ANCHOR, 50).map((b) => b.close / MOCK_SYMBOLS[1].last);
    expect(a).not.toEqual(b);
  });

  it.each(Object.keys(INTRADAY_MINUTES))('日内 %s：合法、升序、同一天内按周期等间隔、从 09:30 开始', (tf) => {
    const m = INTRADAY_MINUTES[tf];
    const bars = genIntraday(tsla, tf, ANCHOR, 6);
    expectValidBars(bars);
    expect(bars[bars.length - 1].close).toBeCloseTo(tsla.last, 8);
    const perDay = Math.ceil(390 / m);
    expect(bars).toHaveLength(6 * perDay);
    // 每个交易日的第一根都是 09:30
    for (let d = 0; d < 6; d++) {
      const first = new Date(bars[d * perDay].time);
      expect([first.getHours(), first.getMinutes()]).toEqual([9, 30]);
      for (let k = 1; k < perDay; k++) {
        expect(bars[d * perDay + k].time - bars[d * perDay + k - 1].time).toBe(m * 60_000);
      }
    }
  });

  it('未知周期抛错而不是悄悄给日线', () => {
    expect(() => genIntraday(tsla, '7m', ANCHOR)).toThrow();
  });

  it('数据源：日/周/月 周期单调变粗，周线 volume 守恒', () => {
    const d = mockDataSource('TSLA', '1D');
    const w = mockDataSource('TSLA', '1W');
    const mo = mockDataSource('TSLA', '1M');
    expect(w.length).toBeLessThan(d.length);
    expect(mo.length).toBeLessThan(w.length);
    const sum = (bs: Bar[]): number => bs.reduce((a, b) => a + b.volume, 0);
    expect(sum(w)).toBeCloseTo(sum(d), 0);
    expect(sum(mo)).toBeCloseTo(sum(d), 0);
  });

  it('数据源返回副本：调用方改它不会污染缓存', () => {
    const a = mockDataSource('TSLA', '30m');
    a[0].close = -1;
    a.length = 0;
    expect(mockDataSource('TSLA', '30m').length).toBeGreaterThan(100);
    expect(mockDataSource('TSLA', '30m')[0].close).toBeGreaterThan(0);
  });
});
