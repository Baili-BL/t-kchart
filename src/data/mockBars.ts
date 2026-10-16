/**
 * 演示数据源（TSLA / AAPL / NVDA / MSFT / SPY）。
 *
 * 铁律（README §7④）：`bar.time` 必须是该 bar 的**开盘时间**、**epoch 毫秒**。
 * 这里全部走 `Date#getTime()`，不会出现秒级时间戳。
 *
 * 真实行情接入时，只需要提供同签名的 `DataSource`（见 engine/grid.ts），替换这个文件即可。
 */
import type { Bar } from '../engine/chart';
import { resample } from '../engine/chart';
import type { DataSource } from '../engine/grid';

export interface MockSymbol {
  ticker: string;
  exchange: string;
  name: string;
  seed: number;
  /** 当前价（最后一根收盘价会被缩放到这个数） */
  last: number;
}

export const MOCK_SYMBOLS: MockSymbol[] = [
  { ticker: 'TSLA', exchange: 'NASDAQ', name: 'Tesla, Inc.', seed: 7001, last: 362.46 },
  { ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple Inc.', seed: 7002, last: 231.8 },
  { ticker: 'NVDA', exchange: 'NASDAQ', name: 'NVIDIA Corporation', seed: 7003, last: 188.2 },
  { ticker: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft Corporation', seed: 7004, last: 512.4 },
  { ticker: 'SPY', exchange: 'AMEX', name: 'SPDR S&P 500 ETF', seed: 7005, last: 668.9 },
];

/** 周期 → 单根 bar 的分钟数（日线及以上不在此表） */
export const INTRADAY_MINUTES: Record<string, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
};

/** 每个周期生成多少个交易日（让根数落在 ~800–2000，范围条才有意义） */
const INTRADAY_DAYS: Record<string, number> = {
  '1m': 5,
  '5m': 20,
  '15m': 40,
  '30m': 60,
  '1h': 120,
  '4h': 250,
};

const SESSION_MIN = 390; // 09:30–16:00
const DAILY_COUNT = 1000;

export function symbolInfo(ticker: string): MockSymbol {
  return MOCK_SYMBOLS.find((s) => s.ticker === ticker) ?? MOCK_SYMBOLS[0];
}

export function isKnownTicker(ticker: string): boolean {
  return MOCK_SYMBOLS.some((s) => s.ticker === ticker);
}

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 截止到 `anchor` 的最近 n 个工作日（升序），时间落在 09:30。 */
export function tradingDays(n: number, anchor: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 9, 30, 0, 0);
  while (out.length < n) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d));
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

/** 给定时间序列，做几何随机游走，并把最后一根收盘价缩放到 `last`。 */
function walk(times: number[], barMinutes: number, seed: number, last: number): Bar[] {
  const rnd = lcg(seed + barMinutes * 31);
  const volScale = Math.sqrt(Math.min(barMinutes, SESSION_MIN) / SESSION_MIN);
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < times.length; i++) {
    const drift = Math.sin(i / (55 * (SESSION_MIN / Math.min(barMinutes, SESSION_MIN)) ** 0.5)) * 0.0016 * volScale;
    const shock = (rnd() - 0.5) * 0.03 * volScale;
    const open = price;
    const close = Math.max(0.5, open * (1 + drift + shock));
    const high = Math.max(open, close) * (1 + rnd() * 0.012 * volScale);
    const low = Math.min(open, close) * (1 - rnd() * 0.012 * volScale);
    const volume = Math.round(2_000_000 * volScale * (0.5 + rnd()) * (1 + Math.abs(shock) * 22));
    bars.push({ time: times[i], open, high, low, close, volume });
    price = close;
  }
  const k = last / bars[bars.length - 1].close;
  for (const b of bars) {
    b.open *= k;
    b.high *= k;
    b.low *= k;
    b.close *= k;
  }
  return bars;
}

export function genDaily(info: MockSymbol, anchor: Date = new Date(), count: number = DAILY_COUNT): Bar[] {
  const times = tradingDays(count, anchor).map((d) => d.getTime());
  return walk(times, SESSION_MIN, info.seed, info.last);
}

export function genIntraday(
  info: MockSymbol,
  tf: string,
  anchor: Date = new Date(),
  days: number = INTRADAY_DAYS[tf] ?? 30,
): Bar[] {
  const m = INTRADAY_MINUTES[tf];
  if (!m) throw new Error('未知的分钟周期: ' + tf);
  const perDay = Math.ceil(SESSION_MIN / m);
  const times: number[] = [];
  for (const day of tradingDays(days, anchor)) {
    const t0 = day.getTime(); // 09:30
    for (let k = 0; k < perDay; k++) times.push(t0 + k * m * 60_000);
  }
  return walk(times, m, info.seed, info.last);
}

const dailyCache = new Map<string, Bar[]>();

function dailyFor(ticker: string): Bar[] {
  let b = dailyCache.get(ticker);
  if (!b) {
    b = genDaily(symbolInfo(ticker));
    dailyCache.set(ticker, b);
  }
  return b;
}

const intradayCache = new Map<string, Bar[]>();

const clone = (bars: Bar[]): Bar[] => bars.map((b) => ({ ...b }));

/**
 * ChartGrid 的数据源：分钟/小时走日内生成器，日/周/月由日线合成。
 * 返回的是**深拷贝**：缓存里的 bar 对象不能被调用方改动（slice() 只拷数组、不拷元素）。
 */
export const mockDataSource: DataSource = (ticker, tf) => {
  if (INTRADAY_MINUTES[tf]) {
    const key = ticker + '|' + tf;
    let b = intradayCache.get(key);
    if (!b) {
      b = genIntraday(symbolInfo(ticker), tf);
      intradayCache.set(key, b);
    }
    return clone(b);
  }
  return clone(resample(dailyFor(ticker), tf));
};
