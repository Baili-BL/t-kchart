/**
 * 模拟交易 store：订单 + 持仓（口径复用 paperAccount.ts）。
 *
 * 口径（诚实说明）：
 * - 成交价一律用当前最新价（chartStore.lastPrice，模拟 tick）；没有真实盘口，买卖都无滑点/手续费。
 * - 限价/止损单是 pending，processTick 里按「价格触线即成交」评估：
 *     限价买 price ≤ limit 成交、止损买 price ≥ stop 成交（卖反向）。
 * - 止盈/止损挂在**仓位**上（bracket）：按下单时的参考价 ± ticks×tickSize 折成绝对价存单；
 *   tick 触线即以触线价平仓（可整仓了结）。反向下单会先平仓（applyFill 的反手口径），TP/SL 随旧仓位消失。
 * - 有效时间（TIF）：日/周/月 只是标记到期时刻，到期未成交自动取消；GTC 永久挂单。
 * - 持久化到 localStorage；损坏存档回空账户。
 */
import { create } from 'zustand';
import { applyFill, markToMarket, EMPTY_POSITION } from '../workspace/paperAccount';
import type { Position } from '../workspace/paperAccount';
import { useChartStore } from './chartStore';

export type OrderType = 'market' | 'limit' | 'stop';
export type OrderSide = 'buy' | 'sell';
export type Tif = 'day' | 'week' | 'month' | 'gtc';
export type OrderState = 'pending' | 'filled' | 'cancelled' | 'expired';

export const TYPE_LABELS: Record<OrderType, string> = { market: '市场', limit: '限价', stop: '止损' };
export const TIF_LABELS: Record<Tif, string> = { day: '日', week: '周', month: '月', gtc: 'GTC' };

export interface TradeOrder {
  id: string;
  ticker: string;
  side: OrderSide;
  type: OrderType;
  /** 数量（流通股口径的股数；货币数量类型在 UI 层折算成股数） */
  qty: number;
  /** 限价 / 止损触发价 */
  price?: number;
  /** bracket：止盈/止损（绝对价，null = 不设置） */
  tp?: number | null;
  sl?: number | null;
  tif: Tif;
  /** 过期时刻（epoch ms），gtc 为 null */
  expires: number | null;
  state: OrderState;
  createdAt: number;
  filledPrice?: number;
  closedAt?: number;
}

export interface TradeLog {
  id: string;
  ticker: string;
  text: string;
  at: number;
}

const DAY = 86_400_000;
const TIF_MS: Record<Exclude<Tif, 'gtc'>, number> = { day: DAY, week: 7 * DAY, month: 30 * DAY };

const STORAGE_KEY = 'kc.trade.v1';
const hasLS = typeof localStorage !== 'undefined';

interface Account {
  positions: { [ticker: string]: Position };
  realized: number;
  orders: TradeOrder[];
  logs: TradeLog[];
}

function serialize(a: Account): string {
  return JSON.stringify({ v: 1, ...a });
}

function hydrate(raw: string | null): Account {
  if (!raw) return { positions: {}, realized: 0, orders: [], logs: [] };
  try {
    const p = JSON.parse(raw) as Partial<Account>;
    if (!p || typeof p !== 'object') throw new Error('bad');
    return {
      positions: p.positions && typeof p.positions === 'object' ? p.positions : {},
      realized: typeof p.realized === 'number' ? p.realized : 0,
      orders: Array.isArray(p.orders) ? p.orders.slice(0, 200) : [],
      logs: Array.isArray(p.logs) ? p.logs.slice(0, 100) : [],
    };
  } catch {
    return { positions: {}, realized: 0, orders: [], logs: [] };
  }
}

const newId = (): string => Math.random().toString(36).slice(2, 10);

/** 每标的的 tick（显示精度推导；设计稿演示 0.01） */
export function tickSizeFor(price: number): number {
  if (!(price > 0)) return 0.01;
  if (price >= 1000) return 0.1;
  if (price >= 1) return 0.01;
  return 0.001;
}

interface TradeState extends Account {
  submit: (draft: {
    ticker: string;
    side: OrderSide;
    type: OrderType;
    qty: number;
    price?: number;
    tpTicks?: number | null;
    slTicks?: number | null;
    refPrice: number;
    tif: Tif;
  }) => { ok: boolean; message: string };
  cancel: (id: string) => void;
  processTick: (ticker: string, price: number, now?: number, forceId?: string) => TradeOrder[];
  resetAccount: () => void;
}

const prevPrices = new Map<string, number>();
const persist = (s: Account): void => {
  if (!hasLS) return;
  localStorage.setItem(STORAGE_KEY, serialize({ positions: s.positions, realized: s.realized, orders: s.orders, logs: s.logs }));
};

export const useTradeStore = create<TradeState>((set, get) => ({
  ...hydrate(hasLS ? localStorage.getItem(STORAGE_KEY) : null),

  submit: (draft) => {
    const { ticker, side, type, qty, price, tpTicks, slTicks, refPrice, tif } = draft;
    if (!(qty > 0)) return { ok: false, message: '数量必须大于 0' };
    if (!(refPrice > 0)) return { ok: false, message: '当前没有可用的最新价' };
    const tick = tickSizeFor(refPrice);
    if (type !== 'market' && !(price && price > 0)) return { ok: false, message: '请输入有效价格' };
    // bracket 契约：tpTicks / slTicks 恒为正数，方向由 side 决定——
    // 止盈挂盈利侧（买→上方、卖→下方），止损挂亏损侧（买→下方、卖→上方）。
    const dir = side === 'buy' ? 1 : -1;
    const order: TradeOrder = {
      id: newId(),
      ticker,
      side,
      type,
      qty,
      price: type === 'market' ? undefined : price,
      tp: tpTicks != null && tpTicks > 0 ? Number((refPrice + dir * tpTicks * tick).toFixed(6)) : null,
      sl: slTicks != null && slTicks > 0 ? Number((refPrice - dir * slTicks * tick).toFixed(6)) : null,
      tif,
      expires: tif === 'gtc' ? null : Date.now() + TIF_MS[tif],
      state: 'pending',
      createdAt: Date.now(),
    };
    set((s) => {
      const orders = [order, ...s.orders];
      const logs = [{ id: newId(), ticker, text: `提交 ${TYPE_LABELS[type]}${side === 'buy' ? '买入' : '卖出'} ${qty} @ ${type === 'market' ? '市价' : price}`, at: Date.now() }, ...s.logs].slice(0, 100);
      const next = { ...s, orders, logs };
      persist(next);
      return { orders, logs };
    });
    // 市价单立即按当前价成交（processTick 不处理市价）
    if (type === 'market') {
      get().processTick(ticker, refPrice, Date.now(), order.id);
    }
    return { ok: true, message: type === 'market' ? `市价单已成交：${side === 'buy' ? '买入' : '卖出'} ${qty}` : '订单已提交' };
  },

  cancel: (id) => {
    set((s) => {
      const orders = s.orders.map((o) => (o.id === id && o.state === 'pending' ? { ...o, state: 'cancelled' as const, closedAt: Date.now() } : o));
      persist({ ...s, orders });
      return { orders };
    });
  },

  processTick: (ticker, price, now = Date.now(), forceId?: string) => {
    const prev = prevPrices.get(ticker);
    prevPrices.set(ticker, price);
    if (!Number.isFinite(price) || !(price > 0)) return [];
    // 市价单强制成交路径不依赖前值
    if (prev == null && !forceId) return [];

    const filled: TradeOrder[] = [];
    set((s) => {
      let positions = s.positions;
      let realized = s.realized;
      let changed = false;
      const logs = [...s.logs];

      const closeAt = (t: string, exitPrice: number, why: string): void => {
        const pos = positions[t];
        if (!pos || pos.qty === 0) return;
        changed = true;
        const r = applyFill(pos, pos.qty > 0 ? 'sell' : 'buy', Math.abs(pos.qty), exitPrice);
        positions = { ...positions, [t]: r.position };
        realized += r.realized;
        logs.unshift({ id: newId(), ticker: t, text: `${why} 平仓 ${Math.abs(pos.qty)} @ ${exitPrice.toFixed(2)}（盈亏 ${r.realized >= 0 ? '+' : ''}${r.realized.toFixed(2)}）`, at: now });
      };

      const orders = s.orders.map((o) => {
        if (o.ticker !== ticker) return o;
        if (o.state === 'pending') {
          if (o.expires != null && now >= o.expires) {
            changed = true;
            return { ...o, state: 'expired' as const, closedAt: now };
          }
          // 市价强制成交（submit 传入 forceId）
          if (forceId && o.id !== forceId) return o;
          const hit =
            forceId != null && o.id === forceId
              ? true
              : o.type === 'limit'
                ? o.side === 'buy'
                  ? price <= (o.price ?? 0)
                  : price >= (o.price ?? Infinity)
                : o.type === 'stop'
                  ? o.side === 'buy'
                    ? price >= (o.price ?? Infinity)
                    : price <= (o.price ?? 0)
                  : false;
          if (!hit) return o;
          // TP/SL 折算成绝对价挂在成交后的仓位上（存到 order 上，见下）
          filled.push(o);
          changed = true;
          logs.unshift({ id: newId(), ticker, text: `成交 ${TYPE_LABELS[o.type]}${o.side === 'buy' ? '买入' : '卖出'} ${o.qty} @ ${price.toFixed(2)}`, at: now });
          return { ...o, state: 'filled' as const, filledPrice: price, closedAt: now };
        }
        return o;
      });

      // 成交落仓位（按订单顺序，保证反手口径正确）
      for (const o of filled) {
        const pos = positions[o.ticker] ?? EMPTY_POSITION;
        const r = applyFill(pos, o.side, o.qty, o.filledPrice ?? price);
        positions = { ...positions, [o.ticker]: r.position };
        realized += r.realized;
      }

      // bracket：对当前仓位的止盈/止损评估（取该仓位最近一次成交单上挂的 tp/sl）
      const pos = positions[ticker];
      if (pos && pos.qty !== 0) {
        const lastFill = orders.find((o) => o.ticker === ticker && o.state === 'filled' && (o.tp != null || o.sl != null));
        if (lastFill) {
          if (pos.qty > 0) {
            if (lastFill.tp != null && price >= lastFill.tp) closeAt(ticker, lastFill.tp, '止盈');
            else if (lastFill.sl != null && price <= lastFill.sl) closeAt(ticker, lastFill.sl, '止损');
          } else {
            if (lastFill.tp != null && price <= lastFill.tp) closeAt(ticker, lastFill.tp, '止盈');
            else if (lastFill.sl != null && price >= lastFill.sl) closeAt(ticker, lastFill.sl, '止损');
          }
        }
      }

      if (!changed) return s;
      const next = { ...s, positions, realized, orders, logs: logs.slice(0, 100) };
      persist(next);
      return { positions, realized, orders, logs: next.logs };
    });
    return filled;
  },

  resetAccount: () => {
    const blank: Account = { positions: {}, realized: 0, orders: [], logs: [] };
    if (hasLS) localStorage.setItem(STORAGE_KEY, serialize(blank));
    set(blank);
  },
}));

/** 订单簿上最近一次成交挂的 TP/SL（TradePanel 显示仓位保护用） */
export function bracketOf(orders: TradeOrder[], ticker: string): { tp: number | null; sl: number | null } {
  const o = orders.find((x) => x.ticker === ticker && x.state === 'filled' && (x.tp != null || x.sl != null));
  return { tp: o?.tp ?? null, sl: o?.sl ?? null };
}

let wired = false;

/** 把 chartStore 最新价接到订单引擎上（应用入口调用一次；重复调用无副作用） */
export function wireTradeEngine(): void {
  if (wired) return;
  wired = true;
  useChartStore.subscribe((s) => {
    if (s.lastPrice == null) return;
    useTradeStore.getState().processTick(s.symbol, s.lastPrice);
  });
}

export { markToMarket };
