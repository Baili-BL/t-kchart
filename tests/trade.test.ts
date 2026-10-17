/**
 * 交易面板订单引擎：市价/限价/止损成交、止盈止损 bracket、TIF 过期、仓位口径（paperAccount）。
 * node 环境无 localStorage，持久化由浏览器 E2E 覆盖。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { useTradeStore, tickSizeFor, bracketOf } from '../src/store/tradeStore';
import type { TradeOrder } from '../src/store/tradeStore';
import { useChartStore } from '../src/store/chartStore';

const S = (): ReturnType<typeof useTradeStore.getState> => useTradeStore.getState();
const orders = (): TradeOrder[] => S().orders;
const pos = (t: string): { qty: number; avg: number } => S().positions[t] ?? { qty: 0, avg: 0 };
const ref = (): number => 100;

beforeEach(() => {
  S().resetAccount();
  useChartStore.setState({ symbol: 'TSLA', lastPrice: ref() });
});

describe('tickSizeFor', () => {
  it('按价格分档：≥1000 → 0.1，≥1 → 0.01，<1 → 0.001', () => {
    expect(tickSizeFor(1234)).toBe(0.1);
    expect(tickSizeFor(11.5)).toBe(0.01);
    expect(tickSizeFor(0.5)).toBe(0.001);
    expect(tickSizeFor(0)).toBe(0.01);
  });
});

describe('市价单', () => {
  it('提交即按参考价成交并落仓位', () => {
    const r = S().submit({ ticker: 'TSLA', side: 'buy', type: 'market', qty: 10, refPrice: ref(), tif: 'day' });
    expect(r.ok).toBe(true);
    const o = orders()[0];
    expect(o.state).toBe('filled');
    expect(o.filledPrice).toBe(ref());
    expect(pos('TSLA')).toEqual({ qty: 10, avg: ref() });
  });

  it('卖出开空仓；反向单先平仓并结算已实现盈亏', () => {
    S().submit({ ticker: 'TSLA', side: 'sell', type: 'market', qty: 5, refPrice: ref(), tif: 'gtc' });
    expect(pos('TSLA').qty).toBe(-5);
    // 价格跌到 98 空头浮盈，反手买 8 → 平 5 空头 realized = (100-98)*5 = +10，剩 3 多头 @98
    S().processTick('TSLA', 98);
    S().submit({ ticker: 'TSLA', side: 'buy', type: 'market', qty: 8, refPrice: 98, tif: 'gtc' });
    expect(pos('TSLA')).toEqual({ qty: 3, avg: 98 });
    expect(S().realized).toBeCloseTo(10, 6);
  });
});

describe('限价 / 止损挂单', () => {
  it('限价买：价格未到不成交，≤ limit 成交', () => {
    S().submit({ ticker: 'TSLA', side: 'buy', type: 'limit', qty: 5, price: 99, refPrice: ref(), tif: 'gtc' });
    expect(orders()[0].state).toBe('pending');
    S().processTick('TSLA', 99.5); // 未触线
    expect(orders()[0].state).toBe('pending');
    S().processTick('TSLA', 99); // 触线
    expect(orders()[0].state).toBe('filled');
    expect(orders()[0].filledPrice).toBe(99);
    expect(pos('TSLA').qty).toBe(5);
  });

  it('止损卖：价格 ≥ 挂单不成交，跌破 stop 成交', () => {
    S().submit({ ticker: 'TSLA', side: 'sell', type: 'stop', qty: 5, price: 98, refPrice: ref(), tif: 'gtc' });
    S().processTick('TSLA', 99);
    expect(orders()[0].state).toBe('pending');
    S().processTick('TSLA', 97.9);
    expect(orders()[0].state).toBe('filled');
  });

  it('限价卖 price ≥ 才成交；取消后永不成交', () => {
    S().submit({ ticker: 'TSLA', side: 'sell', type: 'limit', qty: 1, price: 101, refPrice: ref(), tif: 'gtc' });
    S().processTick('TSLA', 100);
    expect(orders()[0].state).toBe('pending');
    S().cancel(orders()[0].id);
    S().processTick('TSLA', 105);
    expect(orders()[0].state).toBe('cancelled');
    expect(pos('TSLA').qty).toBe(0);
  });

  it('TIF 过期：expires 在过去 → 自动 expired，永不成交', () => {
    S().submit({ ticker: 'TSLA', side: 'buy', type: 'limit', qty: 1, price: 99, refPrice: ref(), tif: 'day' });
    // 手动把过期时间改到过去
    const o = orders()[0];
    useTradeStore.setState({ orders: [{ ...o, expires: Date.now() - 1000 }] });
    S().processTick('TSLA', 50); // 深度触线也只算过期
    expect(orders()[0].state).toBe('expired');
    expect(pos('TSLA').qty).toBe(0);
  });
});

describe('bracket（止盈 / 止损）', () => {
  it('tick 偏移折算绝对价：买 +75 tick 止盈 / -25 tick 止损（tick=0.01）', () => {
    S().submit({ ticker: 'TSLA', side: 'buy', type: 'market', qty: 2, tpTicks: 75, slTicks: 25, refPrice: ref(), tif: 'gtc' });
    const o = orders().find((x) => x.state === 'filled')!;
    expect(o.tp).toBeCloseTo(100.75, 6);
    expect(o.sl).toBeCloseTo(99.75, 6);
    const b = bracketOf(orders(), 'TSLA');
    expect(b.tp).toBeCloseTo(100.75, 6);
  });

  it('多头：涨到止盈价自动平仓并结算盈利', () => {
    S().submit({ ticker: 'TSLA', side: 'buy', type: 'market', qty: 2, tpTicks: 75, slTicks: 25, refPrice: ref(), tif: 'gtc' });
    S().processTick('TSLA', 100.5); // 未到
    expect(pos('TSLA').qty).toBe(2);
    S().processTick('TSLA', 100.75); // 触及止盈
    expect(pos('TSLA').qty).toBe(0);
    expect(S().realized).toBeCloseTo(1.5, 6); // (100.75-100)*2
  });

  it('多头：跌破止损价自动平仓并结算亏损', () => {
    S().submit({ ticker: 'TSLA', side: 'buy', type: 'market', qty: 2, tpTicks: 75, slTicks: 25, refPrice: ref(), tif: 'gtc' });
    S().processTick('TSLA', 99.75);
    expect(pos('TSLA').qty).toBe(0);
    expect(S().realized).toBeCloseTo(-0.5, 6);
  });

  it('空头镜像：止盈在下方、止损在上方', () => {
    S().submit({ ticker: 'TSLA', side: 'sell', type: 'market', qty: 2, tpTicks: 50, slTicks: 30, refPrice: ref(), tif: 'gtc' });
    const o = orders().find((x) => x.state === 'filled')!;
    expect(o.tp).toBeCloseTo(99.5, 6);
    expect(o.sl).toBeCloseTo(100.3, 6);
    S().processTick('TSLA', 99.5);
    expect(pos('TSLA').qty).toBe(0);
    expect(S().realized).toBeCloseTo(1.0, 6);
  });

  it('无效提交被拒绝：qty≤0 / 限价缺价格 / 无最新价', () => {
    expect(S().submit({ ticker: 'TSLA', side: 'buy', type: 'market', qty: 0, refPrice: ref(), tif: 'gtc' }).ok).toBe(false);
    expect(S().submit({ ticker: 'TSLA', side: 'buy', type: 'limit', qty: 1, refPrice: ref(), tif: 'gtc' }).ok).toBe(false);
    expect(S().submit({ ticker: 'TSLA', side: 'buy', type: 'market', qty: 1, refPrice: 0, tif: 'gtc' }).ok).toBe(false);
    expect(orders()).toHaveLength(0);
  });
});
