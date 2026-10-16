import { describe, expect, it } from 'vitest';
import { applyFill, markToMarket, EMPTY_POSITION } from '../src/workspace/paperAccount';
import type { Position } from '../src/workspace/paperAccount';
import { matchRange } from '../src/workspace/rangeMatch';
import { STYLE_LABELS, styleFromLabel, useChartStore } from '../src/store/chartStore';

describe('paperAccount · 持仓计算', () => {
  it('开多 → 加仓：均价是加权平均，无已实现盈亏', () => {
    const a = applyFill(EMPTY_POSITION, 'buy', 2, 100);
    const b = applyFill(a.position, 'buy', 3, 110);
    expect(b.position.qty).toBe(5);
    expect(b.position.avg).toBeCloseTo((2 * 100 + 3 * 110) / 5, 10);
    expect(b.realized).toBe(0);
  });

  it('部分平仓：均价不变，已实现盈亏 = (卖价-均价)×平掉的数量', () => {
    const open = applyFill(EMPTY_POSITION, 'buy', 4, 100).position;
    const r = applyFill(open, 'sell', 1, 120);
    expect(r.position).toEqual({ qty: 3, avg: 100 });
    expect(r.realized).toBe(20);
  });

  it('全平后回到空仓', () => {
    const open = applyFill(EMPTY_POSITION, 'sell', 2, 50).position; // 空头
    const r = applyFill(open, 'buy', 2, 40);
    expect(r.position).toEqual(EMPTY_POSITION);
    expect(r.realized).toBe(20); // 空头 50 卖、40 回补，赚 10×2
  });

  it('反手：先按旧仓位结算，剩余数量以成交价开新仓（只结算一次）', () => {
    const long3 = applyFill(EMPTY_POSITION, 'buy', 3, 100).position;
    const r = applyFill(long3, 'sell', 5, 90);
    expect(r.realized).toBe(-30); // 只结算被平掉的 3 手：(90-100)×3
    expect(r.position).toEqual({ qty: -2, avg: 90 });
  });

  it('空头反手成多头', () => {
    const short2 = applyFill(EMPTY_POSITION, 'sell', 2, 100).position;
    const r = applyFill(short2, 'buy', 3, 95);
    expect(r.realized).toBe(10); // (100-95)×2
    expect(r.position).toEqual({ qty: 1, avg: 95 });
  });

  it('非法输入抛错，不静默', () => {
    expect(() => applyFill(EMPTY_POSITION, 'buy', 0, 100)).toThrow();
    expect(() => applyFill(EMPTY_POSITION, 'buy', 1, NaN)).toThrow();
    expect(() => applyFill(EMPTY_POSITION, 'buy', 1, -5)).toThrow();
  });

  it('不变式：随机成交序列下，已实现 + 浮动 == 现金账本算出的总盈亏', () => {
    // 用独立的「现金账本」做对照：equity = cash + qty × last，初始 cash = 0
    let s = 12345;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    let pos: Position = EMPTY_POSITION;
    let realized = 0;
    let cash = 0;
    let last = 100;
    for (let i = 0; i < 500; i++) {
      last = Math.max(1, last * (1 + (rnd() - 0.5) * 0.04));
      const side = rnd() < 0.5 ? 'buy' : 'sell';
      const qty = 1 + Math.floor(rnd() * 5);
      const r = applyFill(pos, side, qty, last);
      pos = r.position;
      realized += r.realized;
      cash += (side === 'buy' ? -qty : qty) * last;
      const total = realized + markToMarket(pos, last);
      const ledger = cash + pos.qty * last;
      expect(Math.abs(total - ledger)).toBeLessThan(1e-6);
    }
  });
});

describe('rangeMatch · 范围按钮高亮', () => {
  const base = { dataDays: 1000, atRightEdge: true, ytdDays: 290 };

  it('视口跨度 ≈ 某个范围时高亮该范围', () => {
    expect(matchRange({ ...base, spanDays: 30 })).toBe('1M');
    expect(matchRange({ ...base, spanDays: 7 })).toBe('7D');
    expect(matchRange({ ...base, spanDays: 365 })).toBe('1Y');
  });

  it('手动缩放到不对应任何范围时不高亮（高亮不能说谎）', () => {
    expect(matchRange({ ...base, spanDays: 15 })).toBeNull();
  });

  it('视口没贴着最新一根时不高亮', () => {
    expect(matchRange({ ...base, spanDays: 30, atRightEdge: false })).toBeNull();
  });

  it('覆盖全部数据 → ALL（即使不贴右边）', () => {
    expect(matchRange({ ...base, spanDays: 990, atRightEdge: false })).toBe('ALL');
  });

  it('YTD：跨度接近年初至今时优先 YTD', () => {
    expect(matchRange({ ...base, spanDays: 290, ytdDays: 290 })).toBe('YTD');
  });

  it('空视口 / 非法跨度 → null', () => {
    expect(matchRange({ ...base, spanDays: 0 })).toBeNull();
    expect(matchRange({ ...base, spanDays: NaN })).toBeNull();
  });
});

describe('chartStore · 主图样式', () => {
  it('默认是蜡烛，setChartStyle 写入 store', () => {
    expect(useChartStore.getState().chartStyle).toBe('candles');
    useChartStore.getState().setChartStyle('area');
    expect(useChartStore.getState().chartStyle).toBe('area');
    useChartStore.getState().setChartStyle('candles');
  });

  it('顶栏标签与样式一一对应、可互相还原', () => {
    for (const k of Object.keys(STYLE_LABELS) as (keyof typeof STYLE_LABELS)[]) {
      expect(styleFromLabel(STYLE_LABELS[k])).toBe(k);
    }
    expect(styleFromLabel('不存在')).toBeNull();
  });
});
