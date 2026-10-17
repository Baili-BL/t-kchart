/**
 * 自选表行情：从演示数据源（mockBars 的日线）算最新价 / 涨跌 / 成交量，外加
 * 格式化（价格 / 涨跌 / 成交量）与市场状态（交易中 / 休市 / 延时标）两组纯函数。
 *
 * 诚实说明：价格与涨跌来自随机游走的演示数据（mockBars.ts），这里只保证**口径正确**：
 * change == 最后一根 close − 前一根 close，changePct == change / 前一根 close × 100。
 * 接真实行情时只需替换 quoteFor 的数据来源，格式化与市场状态不受影响。
 *
 * 市场时段按交易所近似：不开盘不弹错误、只是灰色状态点；FX 按「工作日 24 小时」、
 * 期货按「工作日全天」近似，加密货币永远开盘。
 */
import { genDaily, symbolInfo } from './mockBars';
import { SYMBOL_BY_TICKER } from './symbols';

export interface Quote {
  ticker: string;
  /** 最新价（演示数据里是最后一根日线的收盘价） */
  last: number;
  /** 涨跌 = last − 前收 */
  change: number;
  /** 涨跌% = change / 前收 × 100 */
  changePct: number;
  /** 成交量（最后一根日线的 volume） */
  volume: number;
}

const quoteCache = new Map<string, Quote>();

/** 最新行情快照。同一标的一次会话内缓存（演示数据本身也是固定的）。未知标的抛错。 */
export function quoteFor(ticker: string): Quote {
  const hit = quoteCache.get(ticker);
  if (hit) return { ...hit };
  if (!SYMBOL_BY_TICKER.has(ticker)) throw new Error('未知标的: ' + ticker);
  const bars = genDaily(symbolInfo(ticker));
  const n = bars.length;
  if (n < 2) throw new Error('行情数据不足: ' + ticker);
  const last = bars[n - 1].close;
  const prev = bars[n - 2].close;
  const q: Quote = {
    ticker,
    last,
    change: last - prev,
    changePct: ((last - prev) / prev) * 100,
    volume: bars[n - 1].volume,
  };
  quoteCache.set(ticker, q);
  return { ...q };
}

// ---------------------------------------------------------------- 格式化

/** 价格：≥1 保留 2 位 + 千分位（3,716.28）；<1 去尾零最多 4 位（0.66 / 0.0001） */
export function formatPrice(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (Math.abs(p) >= 1) {
    return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const s = p.toFixed(4).replace(/0+$/, '');
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

/** 涨跌：带正负号（+0.67 / -2.31 / 0.00），小数规则同 formatPrice */
export function formatChange(d: number): string {
  if (!Number.isFinite(d)) return '—';
  if (d === 0) return '0.00';
  const sign = d > 0 ? '+' : '-';
  const a = Math.abs(d);
  const s = a >= 1 ? a.toFixed(2) : a.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return sign + s;
}

const trimNum = (x: number): string => x.toFixed(2).replace(/\.?0+$/, '');

/** 涨跌幅：固定 2 位小数带符号（+0.24 / -0.61 / 2.53），0 不带符号 */
export function formatPct(d: number): string {
  if (!Number.isFinite(d)) return '—';
  if (d === 0) return '0.00';
  return (d > 0 ? '+' : '-') + Math.abs(d).toFixed(2);
}

/** 成交量：TradingView 风格英文单位（13.41M / 47.26B / 8.12K），<1000 原样 */
export function formatVolume(v: number): string {
  if (!Number.isFinite(v) || v < 0) return '—';
  if (v >= 1e12) return trimNum(v / 1e12) + 'T';
  if (v >= 1e9) return trimNum(v / 1e9) + 'B';
  if (v >= 1e6) return trimNum(v / 1e6) + 'M';
  if (v >= 1e3) return trimNum(v / 1e3) + 'K';
  return String(Math.round(v));
}

// ---------------------------------------------------------------- 市场状态

export type MarketStatus = 'open' | 'closed';

interface Session {
  tz: string;
  /** 开 / 收盘的当地分钟数（0 = 00:00） */
  open: number;
  close: number;
}

const MIN = (h: number, m = 0): number => h * 60 + m;

/** 各交易所日内时段（近似：不含午休与节假日）；没有条目的交易所一律按休市 */
const SESSION_BY_EXCHANGE: Record<string, Session> = {
  SSE: { tz: 'Asia/Shanghai', open: MIN(9, 30), close: MIN(15) },
  SZSE: { tz: 'Asia/Shanghai', open: MIN(9, 30), close: MIN(15) },
  CFFEX: { tz: 'Asia/Shanghai', open: MIN(9, 30), close: MIN(15) },
  SHFE: { tz: 'Asia/Shanghai', open: MIN(9, 30), close: MIN(15) },
  HKEX: { tz: 'Asia/Shanghai', open: MIN(9, 30), close: MIN(16) },
  TWSE: { tz: 'Asia/Taipei', open: MIN(9), close: MIN(13, 30) },
  TPEX: { tz: 'Asia/Taipei', open: MIN(9), close: MIN(13, 30) },
  TSE: { tz: 'Asia/Tokyo', open: MIN(9), close: MIN(15) },
  NASDAQ: { tz: 'America/New_York', open: MIN(9, 30), close: MIN(16) },
  NYSE: { tz: 'America/New_York', open: MIN(9, 30), close: MIN(16) },
  AMEX: { tz: 'America/New_York', open: MIN(9, 30), close: MIN(16) },
  OPRA: { tz: 'America/New_York', open: MIN(9, 30), close: MIN(16) },
  SP: { tz: 'America/New_York', open: MIN(9, 30), close: MIN(16) },
  DJ: { tz: 'America/New_York', open: MIN(9, 30), close: MIN(16) },
  ICE: { tz: 'America/New_York', open: MIN(9, 30), close: MIN(16) },
  // 期货近似为工作日全天（实际各品种约 23 小时）
  CME: { tz: 'America/New_York', open: MIN(0), close: MIN(24) },
  COMEX: { tz: 'America/New_York', open: MIN(0), close: MIN(24) },
  NYMEX: { tz: 'America/New_York', open: MIN(0), close: MIN(24) },
  CBOT: { tz: 'America/New_York', open: MIN(0), close: MIN(24) },
};

const WEEKDAY_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** 某时区的「当地分钟数 + 星期」（0=周日）。用 Intl 处理夏令时，不做手工偏移。 */
function zoneParts(now: Date, tz: string): { minutes: number; weekday: number } {
  let fmt = fmtCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
    fmtCache.set(tz, fmt);
  }
  let hour = 0;
  let minute = 0;
  let weekday = 1;
  for (const p of fmt.formatToParts(now)) {
    if (p.type === 'hour') hour = Number(p.value) % 24; // en-US 会把 0 点写成 "24"
    else if (p.type === 'minute') minute = Number(p.value);
    else if (p.type === 'weekday') weekday = WEEKDAY_NUM[p.value] ?? 1;
  }
  return { minutes: hour * 60 + minute, weekday };
}

/** 市场状态：crypto 恒开、economy 恒休、forex 按「工作日 24 小时」、其余按交易所时段。 */
export function marketStatus(ticker: string, now: Date = new Date()): MarketStatus {
  const entry = SYMBOL_BY_TICKER.get(ticker);
  if (!entry) throw new Error('未知标的: ' + ticker);
  if (entry.category === 'crypto') return 'open';
  if (entry.category === 'economy') return 'closed';
  if (entry.category === 'forex') {
    const day = now.getUTCDay();
    return day >= 1 && day <= 5 ? 'open' : 'closed';
  }
  const s = SESSION_BY_EXCHANGE[entry.exchange];
  if (!s) return 'closed';
  const { minutes, weekday } = zoneParts(now, s.tz);
  if (weekday === 0 || weekday === 6) return 'closed';
  return minutes >= s.open && minutes < s.close ? 'open' : 'closed';
}

/** 行情延时标（橙色 D）：中国大陆交易所按延时展示 */
const DELAYED_EXCHANGES = new Set(['SSE', 'SZSE', 'CFFEX', 'SHFE']);

export function isDelayed(ticker: string): boolean {
  const entry = SYMBOL_BY_TICKER.get(ticker);
  return !!entry && DELAYED_EXCHANGES.has(entry.exchange);
}
