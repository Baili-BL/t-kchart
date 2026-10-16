/**
 * 商品代码目录 / 搜索（「商品代码搜索」弹窗背后的纯逻辑）
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, SYMBOL_CATALOG, distinctValues, searchSymbols } from '../src/data/symbols';
import type { SymbolCategory } from '../src/data/symbols';
import { MOCK_SYMBOLS, isKnownTicker, mockDataSource, symbolInfo } from '../src/data/mockBars';
import { pickTicker, planToolCalls } from '../src/agent/providers/mock';

describe('目录完整性', () => {
  it('ticker 全局唯一；seed 全局唯一（否则两个标的会走出一模一样的曲线）', () => {
    expect(new Set(SYMBOL_CATALOG.map((s) => s.ticker)).size).toBe(SYMBOL_CATALOG.length);
    expect(new Set(SYMBOL_CATALOG.map((s) => s.seed)).size).toBe(SYMBOL_CATALOG.length);
  });

  it('9 个分类每个都有标的；每条都有价格 > 0、交易所、国家、类型', () => {
    const cats: SymbolCategory[] = ['stock', 'fund', 'futures', 'forex', 'crypto', 'index', 'bond', 'economy', 'option'];
    expect(CATEGORY_LABELS.map((c) => c.key)).toEqual(['all', ...cats]);
    for (const c of cats) expect(SYMBOL_CATALOG.some((s) => s.category === c), c).toBe(true);
    for (const s of SYMBOL_CATALOG) {
      expect(s.last, s.ticker).toBeGreaterThan(0);
      expect(s.exchange && s.country && s.kind && s.name, s.ticker).toBeTruthy();
    }
  });

  it('核心 5 个顺序与基线数据不变（TSLA 的 seed / last 有测试基线）', () => {
    expect(MOCK_SYMBOLS.map((s) => s.ticker)).toEqual(['TSLA', 'AAPL', 'NVDA', 'MSFT', 'SPY']);
    expect(symbolInfo('TSLA')).toMatchObject({ seed: 7001, last: 362.46 });
  });

  it('目录里每个标的都能出日线 / 小时线，OHLC 合法，最后一根收盘价 = last', () => {
    const src = mockDataSource;
    for (const s of SYMBOL_CATALOG) {
      expect(isKnownTicker(s.ticker)).toBe(true);
      for (const tf of ['1D', '1h']) {
        const bars = src(s.ticker, tf);
        expect(bars.length, s.ticker + tf).toBeGreaterThan(100);
        for (const b of bars.slice(-50)) {
          expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close) - 1e-9);
          expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close) + 1e-9);
          expect(b.low).toBeGreaterThan(0);
        }
      }
      const last = src(s.ticker, '1D').at(-1)!;
      expect(last.close / s.last, s.ticker).toBeCloseTo(1, 6);
    }
  });
});

describe('searchSymbols', () => {
  it('空查询 = 全部（按目录顺序）；分类过滤', () => {
    expect(searchSymbols().length).toBe(SYMBOL_CATALOG.length);
    const stocks = searchSymbols({ category: 'stock' });
    expect(stocks.length).toBeGreaterThan(30);
    expect(stocks.every((s) => s.category === 'stock')).toBe(true);
  });

  it('设计稿里的例子：「000001」+ 股票 → 首行是 平安银行（SZSE）', () => {
    const r = searchSymbols({ q: '000001', category: 'stock' });
    expect(r[0]).toMatchObject({ ticker: '000001', name: '平安银行', exchange: 'SZSE' });
  });

  it('排序：代码完全匹配 > 代码前缀 > 代码包含 > 描述包含', () => {
    const r = searchSymbols({ q: 'btc' }).map((s) => s.ticker);
    expect(r[0]).toBe('BTCUSD');                 // 前缀匹配，目录里排在前
    expect(r).toContain('BTCUSDT.P');
    const r2 = searchSymbols({ q: 'spy' });
    expect(r2[0].ticker).toBe('SPY');            // 完全匹配排在以 SPY 开头的期权前面
    expect(r2.slice(1).every((s) => s.category === 'option')).toBe(true);
  });

  it('按中文描述、大小写不敏感、交易所:代码 都能搜', () => {
    expect(searchSymbols({ q: '茅台' })[0].ticker).toBe('600519');
    expect(searchSymbols({ q: 'tesla' })[0].ticker).toBe('TSLA');
    expect(searchSymbols({ q: 'SZSE:000001' }).map((s) => s.ticker)).toEqual(['000001']);
    expect(searchSymbols({ q: 'nasdaq:' }).every((s) => s.exchange === 'NASDAQ')).toBe(true);
    expect(searchSymbols({ q: 'zzzz不存在' })).toEqual([]);
  });

  it('国家 / 类型 / 板块 过滤会叠加；下拉选项只来自当前结果集（选了一定有结果）', () => {
    const base = searchSymbols({ category: 'stock' });
    const countries = distinctValues(base, 'country');
    expect(countries).toEqual(expect.arrayContaining(['中国大陆', '美国', '中国香港', '中国台湾']));
    for (const c of countries) expect(searchSymbols({ category: 'stock', country: c }).length).toBeGreaterThan(0);
    const cn = searchSymbols({ category: 'stock', country: '中国大陆', sector: '金融' });
    expect(cn.length).toBeGreaterThan(0);
    expect(cn.every((s) => s.country === '中国大陆' && s.sector === '金融')).toBe(true);
    // 外汇没有板块 → 选项为空（下拉置灰）
    expect(distinctValues(searchSymbols({ category: 'forex' }), 'sector')).toEqual([]);
    // 搜索后再取选项：只剩命中的国家
    expect(distinctValues(searchSymbols({ q: '000001' }), 'country')).toEqual(['中国大陆']);
  });
});

describe('Agent 认标的', () => {
  it('代码（整词）/ 中文名都能认；普通数字和两位字母不会误判', () => {
    expect(pickTicker('切到 NVDA')).toBe('NVDA');
    expect(pickTicker('看看 btcusd')).toBe('BTCUSD');
    expect(pickTicker('换成 000001')).toBe('000001');
    expect(pickTicker('打开贵州茅台')).toBe('600519');
    expect(pickTicker('切到腾讯控股')).toBe('0700');
    expect(pickTicker('回放前进 10 根')).toBeNull();
    expect(pickTicker('回放每秒 30 根')).toBeNull();
    expect(pickTicker('2x2 布局')).toBeNull();
    expect(pickTicker('ba ko')).toBeNull();
    expect(planToolCalls('切到 AMZN')[0]).toMatchObject({ name: 'set_symbol', arguments: { symbol: 'AMZN' } });
  });
});
