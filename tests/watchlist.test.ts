import { beforeEach, describe, expect, it } from 'vitest';
import { formatChange, formatPct, formatPrice, formatVolume, isDelayed, marketStatus, quoteFor } from '../src/data/quote';
import { genDaily, symbolInfo } from '../src/data/mockBars';
import {
  defaultWatchlists,
  hydrateWatchlists,
  serializeWatchlists,
  useWatchlistStore,
} from '../src/store/watchlistStore';

// ---------------------------------------------------------------- quote

describe('quote · 行情口径', () => {
  it('change / changePct / volume 与日线数据一致', () => {
    const bars = genDaily(symbolInfo('TSLA'));
    const n = bars.length;
    const q = quoteFor('TSLA');
    expect(q.last).toBeCloseTo(bars[n - 1].close, 10);
    expect(q.change).toBeCloseTo(bars[n - 1].close - bars[n - 2].close, 10);
    expect(q.changePct).toBeCloseTo(((bars[n - 1].close - bars[n - 2].close) / bars[n - 2].close) * 100, 10);
    expect(q.volume).toBe(bars[n - 1].volume);
  });

  it('返回拷贝：改返回值不影响缓存', () => {
    const a = quoteFor('AAPL');
    const snapshot = a.change;
    a.change = 0;
    expect(quoteFor('AAPL').change).toBeCloseTo(snapshot, 10);
  });

  it('未知标的抛错，不静默', () => {
    expect(() => quoteFor('NOPE')).toThrow();
  });
});

describe('format · 数字格式化', () => {
  it('价格：≥1 千分位 + 2 位小数；<1 去尾零', () => {
    expect(formatPrice(27.15)).toBe('27.15');
    expect(formatPrice(3716.28)).toBe('3,716.28');
    expect(formatPrice(1500)).toBe('1,500.00');
    expect(formatPrice(1.16)).toBe('1.16');
    expect(formatPrice(0.66)).toBe('0.66');
    expect(formatPrice(0.0001)).toBe('0.0001');
  });

  it('涨跌：带符号，0 不带符号', () => {
    expect(formatChange(0.67)).toBe('+0.67');
    expect(formatChange(8.81)).toBe('+8.81');
    expect(formatChange(-2.31)).toBe('-2.31');
    expect(formatChange(0)).toBe('0.00');
    expect(formatChange(0.24)).toBe('+0.24');
    expect(formatChange(-0.001)).toBe('-0.001');
  });

  it('涨跌幅：固定 2 位小数', () => {
    expect(formatPct(2.53)).toBe('+2.53');
    expect(formatPct(0.24)).toBe('+0.24');
    expect(formatPct(-0.6061)).toBe('-0.61');
    expect(formatPct(0)).toBe('0.00');
  });

  it('成交量：英文单位，去尾零', () => {
    expect(formatVolume(13_410_000)).toBe('13.41M');
    expect(formatVolume(25_600_000)).toBe('25.6M');
    expect(formatVolume(47.26e9)).toBe('47.26B');
    expect(formatVolume(8_123)).toBe('8.12K');
    expect(formatVolume(940)).toBe('940');
    expect(formatVolume(-1)).toBe('—');
  });
});

// ---------------------------------------------------------------- market status

// 2026-10-16 是周五，10-17 周六，10-18 周日
const FRI = (utcHour: number, utcMin = 0): Date => new Date(Date.UTC(2026, 9, 16, utcHour, utcMin));
const SAT = (utcHour: number): Date => new Date(Date.UTC(2026, 9, 17, utcHour));
const SUN = (utcHour: number): Date => new Date(Date.UTC(2026, 9, 18, utcHour));

describe('marketStatus · 开收盘', () => {
  it('A股：上海时段 09:30–15:00（UTC+8），周末休市', () => {
    expect(marketStatus('600519', FRI(2))).toBe('open'); // 10:00 北京
    expect(marketStatus('600519', FRI(5, 59))).toBe('open'); // 13:59 北京
    expect(marketStatus('600519', FRI(7, 59))).toBe('closed'); // 15:59 收盘后
    expect(marketStatus('600519', SAT(2))).toBe('closed');
  });

  it('美股：含夏令时的 ET 时段', () => {
    expect(marketStatus('TSLA', FRI(14))).toBe('open'); // 10:00 EDT
    expect(marketStatus('TSLA', FRI(20, 30))).toBe('closed'); // 16:30 EDT
    expect(marketStatus('TSLA', SAT(14))).toBe('closed');
    expect(marketStatus('SPX', FRI(14))).toBe('open'); // 指数跟随美股时段
  });

  it('加密货币恒开；外汇周末休；宏观指标恒休', () => {
    expect(marketStatus('BTCUSD', SUN(4))).toBe('open');
    expect(marketStatus('EURUSD', SUN(4))).toBe('closed');
    expect(marketStatus('EURUSD', FRI(4))).toBe('open');
    expect(marketStatus('USGDP', FRI(14))).toBe('closed');
  });

  it('未知标的抛错', () => {
    expect(() => marketStatus('NOPE', FRI(2))).toThrow();
  });

  it('延时标：中国大陆交易所 D，其它没有', () => {
    expect(isDelayed('600519')).toBe(true);
    expect(isDelayed('000001')).toBe(true);
    expect(isDelayed('TSLA')).toBe(false);
    expect(isDelayed('0700')).toBe(false);
  });
});

// ---------------------------------------------------------------- watchlist store

describe('watchlistStore · 分组与标的', () => {
  beforeEach(() => {
    useWatchlistStore.setState({ lists: defaultWatchlists(), activeId: 'diy' });
  });

  it('默认分组：INDICES / Stocks / DIY，激活 DIY', () => {
    const s = useWatchlistStore.getState();
    expect(s.lists.map((l) => l.name)).toEqual(['INDICES', 'Stocks', 'DIY']);
    expect(s.activeId).toBe('diy');
  });

  it('addSymbol：未知标的 false、重复 false、新标的追加到当前组', () => {
    const s = useWatchlistStore.getState();
    expect(s.addSymbol('NOPE')).toBe(false);
    expect(s.addSymbol('TSLA')).toBe(false); // DIY 里已有
    expect(s.addSymbol('600519')).toBe(true);
    const active = useWatchlistStore.getState().lists.find((l) => l.id === useWatchlistStore.getState().activeId);
    expect(active && active.symbols[active.symbols.length - 1]).toBe('600519');
  });

  it('addSymbol 可指定分组', () => {
    const s = useWatchlistStore.getState();
    expect(s.addSymbol('000063', 'indices')).toBe(true);
    const indices = useWatchlistStore.getState().lists.find((l) => l.id === 'indices');
    expect(indices && indices.symbols.includes('000063')).toBe(true);
  });

  it('removeSymbol / moveSymbol：移动换位、边界 false', () => {
    const s = useWatchlistStore.getState();
    expect(s.moveSymbol('TSLA', -1)).toBe(false); // 已在顶部
    expect(s.moveSymbol('TSLA', 1)).toBe(true);
    let diy = useWatchlistStore.getState().lists.find((l) => l.id === 'diy')!;
    expect(diy.symbols[0]).toBe('AAPL');
    expect(diy.symbols[1]).toBe('TSLA');
    useWatchlistStore.getState().removeSymbol('AAPL');
    diy = useWatchlistStore.getState().lists.find((l) => l.id === 'diy')!;
    expect(diy.symbols.includes('AAPL')).toBe(false);
  });

  it('addList 新建并选中；removeList 切回、删最后一组 false', () => {
    const s = useWatchlistStore.getState();
    const id = s.addList('测试组');
    let st = useWatchlistStore.getState();
    expect(st.activeId).toBe(id);
    expect(st.removeList('diy')).toBe(true); // 删别的组
    st = useWatchlistStore.getState();
    expect(st.activeId).toBe(id);
    expect(st.removeList(id)).toBe(true); // 删当前激活 → 回到剩余第一组
    st = useWatchlistStore.getState();
    expect(st.lists.length).toBe(2);
    expect(st.lists.some((l) => l.id === id)).toBe(false);
    // 只剩一组时不可删
    useWatchlistStore.setState({ lists: [{ id: 'only', name: '唯一', symbols: [] }], activeId: 'only' });
    expect(useWatchlistStore.getState().removeList('only')).toBe(false);
  });

  it('selectList：切到不存在的 id 不生效', () => {
    const s = useWatchlistStore.getState();
    s.selectList('nope');
    expect(useWatchlistStore.getState().activeId).toBe('diy');
  });
});

describe('watchlist · 存档往返', () => {
  it('serialize → hydrate 往返一致', () => {
    const lists = defaultWatchlists();
    const raw = serializeWatchlists(lists, 'stocks');
    const back = hydrateWatchlists(raw);
    expect(back).toEqual({ lists, activeId: 'stocks' });
  });

  it('损坏 / 版本不对 / 空数组 → null（调用方回默认）', () => {
    expect(hydrateWatchlists(null)).toBeNull();
    expect(hydrateWatchlists('garbage{')).toBeNull();
    expect(hydrateWatchlists(JSON.stringify({ v: 2, activeId: 'x', lists: [] }))).toBeNull();
    expect(hydrateWatchlists(JSON.stringify({ v: 1, activeId: 'x', lists: [] }))).toBeNull();
  });

  it('未知 ticker 被过滤，不静默入库', () => {
    const raw = JSON.stringify({
      v: 1,
      activeId: 'a',
      lists: [
        { id: 'a', name: 'A', symbols: ['TSLA', 'NOPE', 'AAPL'] },
        { id: 'b', name: 'B', symbols: ['GHOST'] },
      ],
    });
    const back = hydrateWatchlists(raw);
    expect(back).not.toBeNull();
    expect(back && back.lists[0].symbols).toEqual(['TSLA', 'AAPL']);
    expect(back && back.lists[1].symbols).toEqual([]);
  });

  it('activeId 指向不存在的组 → 回第一组', () => {
    const raw = JSON.stringify({
      v: 1,
      activeId: 'ghost',
      lists: [{ id: 'a', name: 'A', symbols: [] }],
    });
    const back = hydrateWatchlists(raw);
    expect(back && back.activeId).toBe('a');
  });
});
