import { useMemo, useState } from 'react';
import { useChartStore } from '../store/chartStore';
import { SYMBOL_BY_TICKER } from '../data/symbols';
import { useToast } from '../ui/toast';
import { useTradeStore, bracketOf, TYPE_LABELS, TIF_LABELS, tickSizeFor } from '../store/tradeStore';
import type { OrderType, OrderSide, Tif, TradeOrder } from '../store/tradeStore';
import { markToMarket } from '../workspace/paperAccount';
import { useChartSettingsStore } from '../store/chartSettingsStore';

const TYPE_TABS: OrderType[] = ['market', 'limit', 'stop'];
const TIF_OPTIONS: Tif[] = ['day', 'week', 'month', 'gtc'];

const fmt = (n: number, d = 2): string => n.toFixed(d);
const trimQty = (q: number): string => (Number.isInteger(q) ? String(q) : q.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));

function stateText(o: TradeOrder): string {
  const st = o.state === 'filled' ? '已成交' : o.state === 'cancelled' ? '已取消' : '已过期';
  return `${TYPE_LABELS[o.type]}${o.side === 'buy' ? '买' : '卖'} ${trimQty(o.qty)}${o.filledPrice != null ? ` @ ${fmt(o.filledPrice)}` : ''} · ${st}`;
}

/**
 * 交易面板（设计稿：TradingView 下单面板导入稿）。
 * 挂在 ws-grid 左上；「买/卖按钮」图表设置控制显隐。
 * 诚实边界：演示数据没有真实盘口，bid/ask = 最新价 ∓ 半个 tick，成交无滑点/手续费。
 */
export function TradePanel(): JSX.Element | null {
  const symbol = useChartStore((s) => s.symbol);
  const last = useChartStore((s) => s.lastPrice);
  const buySell = useChartSettingsStore((s) => s.settings.buySell);
  const toast = useToast((s) => s.show);
  const orders = useTradeStore((s) => s.orders);
  const positions = useTradeStore((s) => s.positions);
  const realized = useTradeStore((s) => s.realized);
  const submit = useTradeStore((s) => s.submit);
  const cancel = useTradeStore((s) => s.cancel);
  const resetAccount = useTradeStore((s) => s.resetAccount);

  const [tab, setTab] = useState<'orders' | 'dom'>('orders');
  const [side, setSide] = useState<OrderSide>('buy');
  const [type, setType] = useState<OrderType>('market');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [qtyType, setQtyType] = useState<'shares' | 'currency'>('shares');
  const [bracket, setBracket] = useState(false);
  const [tpTicks, setTpTicks] = useState('75');
  const [slTicks, setSlTicks] = useState('25');
  const [extra, setExtra] = useState(false);
  const [tif, setTif] = useState<Tif>('week');

  const entry = SYMBOL_BY_TICKER.get(symbol);
  const tick = tickSizeFor(last ?? 0);
  const ask = last != null ? last + tick / 2 : null;
  const bid = last != null ? last - tick / 2 : null;
  const cur = positions[symbol] ?? { qty: 0, avg: 0 };
  const unrealized = last != null ? markToMarket(cur, last) : 0;
  const pending = useMemo(() => orders.filter((o) => o.ticker === symbol && o.state === 'pending'), [orders, symbol]);
  const recent = useMemo(() => orders.filter((o) => o.ticker === symbol && o.state !== 'pending').slice(0, 4), [orders, symbol]);

  if (!buySell) return null;

  const bracketNow = bracketOf(orders, symbol);

  /**
   * 切订单类型的价格填充口径：
   * - 「市场」→ 限价/止损：价格输入框是新出现的（市场类型下它隐藏），一律用当前参考价填充（买→Ask、卖→Bid），
   *   不看旧值——旧值是上次挂单残留，和现在的盘口没关系。
   * - 限价 ↔ 止损 互切：保留用户已填的价格，不打扰。
   */
  const pickType = (t: OrderType): void => {
    if (t !== 'market' && type === 'market') {
      const ref = side === 'buy' ? ask : bid;
      if (ref != null) setPrice(fmt(ref));
    }
    setType(t);
  };

  const numQty = Number(qty);
  const qtyShares = qtyType === 'shares' ? numQty : last != null && numQty > 0 ? numQty / last : 0;

  const place = (): void => {
    const r = submit({
      ticker: symbol,
      side,
      type,
      qty: qtyShares,
      price: type === 'market' ? undefined : Number(price) || undefined,
      // bracket 契约：tick 数恒为正，方向由 side 决定（见 tradeStore.submit）
      tpTicks: bracket && Number(tpTicks) > 0 ? Number(tpTicks) : null,
      slTicks: bracket && Number(slTicks) > 0 ? Number(slTicks) : null,
      refPrice: last ?? 0,
      tif,
    });
    toast(r.message);
    if (r.ok && type === 'market') setPrice('');
  };

  return (
    <div className="trade" role="group" aria-label="交易面板">
      <header className="tp-head">
        <button type="button" className={'tp-tab' + (tab === 'orders' ? ' on' : '')} onClick={() => setTab('orders')}>
          订单
        </button>
        <button type="button" className={'tp-tab' + (tab === 'dom' ? ' on' : '')} onClick={() => setTab('dom')}>
          市场深度
        </button>
        <span className="tp-sym" title={entry ? `${entry.name} · ${entry.exchange}` : symbol}>
          {symbol}
        </span>
        <span className="tp-sim">
          <i /> Simulated
        </span>
      </header>

      {tab === 'orders' && (
        <div className="tp-body">
          <div className="tp-ba">
            <button type="button" className={'tp-ba-btn sell' + (side === 'sell' ? ' sel' : '')} onClick={() => setSide('sell')} aria-pressed={side === 'sell'}>
              <span>卖出</span>
              <b>{bid != null ? fmt(bid) : '--'}</b>
            </button>
            <button type="button" className={'tp-ba-btn buy' + (side === 'buy' ? ' sel' : '')} onClick={() => setSide('buy')} aria-pressed={side === 'buy'}>
              <span>买入</span>
              <b>{ask != null ? fmt(ask) : '--'}</b>
            </button>
          </div>

          <div className="tp-types" role="tablist" aria-label="订单类型">
            {TYPE_TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={type === t}
                className={'tp-type' + (type === t ? ' on' : '')}
                onClick={() => pickType(t)}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {type !== 'market' && (
            <label className="tp-row">
              <span className="tp-label">{TYPE_LABELS[type]}价格</span>
              <input
                className="tp-input"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                placeholder={ask != null ? fmt(ask) : ''}
                aria-label={`${TYPE_LABELS[type]}价格`}
              />
              <span className="tp-ref">{ask != null ? <><em>Ask</em>{fmt(ask)}</> : ''}</span>
            </label>
          )}

          <div className="tp-row">
            <span className="tp-label">数量类型</span>
            <div className="tp-seg">
              <button type="button" className={qtyType === 'shares' ? 'on' : ''} onClick={() => setQtyType('shares')}>
                流通股
              </button>
              <button type="button" className={qtyType === 'currency' ? 'on' : ''} onClick={() => setQtyType('currency')}>
                货币
              </button>
            </div>
          </div>

          <label className="tp-row">
            <span className="tp-label">数量</span>
            <input className="tp-input" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" aria-label="数量" />
            <span className="tp-ref">{qtyType === 'currency' ? 'USD' : '股'}</span>
          </label>

          <div className="tp-row">
            <span className="tp-label">刻度值</span>
            <span className="tp-static">{fmt(tick, 3)} USD</span>
          </div>

          <label className="tp-row tp-check">
            <input type="checkbox" checked={bracket} onChange={(e) => setBracket(e.target.checked)} />
            <span className="tp-label">退出（止盈 / 止损）</span>
          </label>
          {bracket && (
            <>
              <label className="tp-row">
                <span className="tp-label">止盈 tick</span>
                <input className="tp-input" value={tpTicks} onChange={(e) => setTpTicks(e.target.value)} inputMode="numeric" aria-label="止盈 tick 数" />
                <span className="tp-ref">{last != null && Number(tpTicks) > 0 ? fmt(last + Number(tpTicks) * tick) : ''}</span>
              </label>
              <label className="tp-row">
                <span className="tp-label">止损 tick</span>
                <input className="tp-input" value={slTicks} onChange={(e) => setSlTicks(e.target.value)} inputMode="numeric" aria-label="止损 tick 数" />
                <span className="tp-ref">{last != null && Number(slTicks) > 0 ? fmt(last - Number(slTicks) * tick) : ''}</span>
              </label>
            </>
          )}

          <div className="tp-row">
            <button type="button" className="tp-extra" aria-expanded={extra} onClick={() => setExtra((v) => !v)}>
              额外设置 {extra ? '▾' : '▸'}
            </button>
          </div>
          {extra && (
            <div className="tp-row">
              <span className="tp-label">有效时间</span>
              <div className="tp-seg">
                {TIF_OPTIONS.map((t) => (
                  <button key={t} type="button" className={tif === t ? 'on' : ''} onClick={() => setTif(t)}>
                    {TIF_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button type="button" className={'tp-cta ' + side} disabled={!(qtyShares > 0) || last == null} onClick={place}>
            开始创建{TYPE_LABELS[type]}{side === 'buy' ? '买入' : '卖出'}单
          </button>

          {/* 持仓 / 挂单 / 最近成交 —— 设计稿没画，但没有它下完单什么都看不见 */}
          <div className="tp-acct">
            <span>
              持仓 <b className={cur.qty > 0 ? 'up' : cur.qty < 0 ? 'down' : ''}>{cur.qty === 0 ? '—' : `${trimQty(cur.qty)} @ ${fmt(cur.avg)}`}</b>
            </span>
            <span>
              浮动{' '}
              <b className={unrealized >= 0 ? 'up' : 'down'}>{cur.qty === 0 ? '—' : `${unrealized >= 0 ? '+' : ''}${fmt(unrealized)}`}</b>
            </span>
            <span>
              已实现 <b className={realized >= 0 ? 'up' : 'down'}>{`${realized >= 0 ? '+' : ''}${fmt(realized)}`}</b>
            </span>
            {bracketNow.tp != null && <span>止盈 {fmt(bracketNow.tp)}</span>}
            {bracketNow.sl != null && <span>止损 {fmt(bracketNow.sl)}</span>}
          </div>

          {pending.length > 0 && (
            <ul className="tp-orders">
              {pending.map((o) => (
                <li key={o.id}>
                  <span className={o.side === 'buy' ? 'up' : 'down'}>
                    {TYPE_LABELS[o.type]}
                    {o.side === 'buy' ? '买' : '卖'} {trimQty(o.qty)}
                    {o.price != null ? ` @ ${fmt(o.price)}` : ''}
                  </span>
                  <button type="button" onClick={() => cancel(o.id)} aria-label="取消订单">
                    取消
                  </button>
                </li>
              ))}
            </ul>
          )}
          {recent.length > 0 && (
            <div className="tp-recent">
              <ul className="tp-orders recent">
                {recent.map((o) => (
                  <li key={o.id}>
                    <span className={o.side === 'buy' ? 'up' : 'down'}>{stateText(o)}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className="tp-reset" onClick={resetAccount} title="清空模拟账户的持仓与订单">
                清空账户
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'dom' && <Depth symbol={symbol} last={last} tick={tick} />}
    </div>
  );
}

/** 模拟市场深度：围绕最新价的十档挂单（量按确定性伪随机，纯演示） */
function Depth({ symbol, last, tick }: { symbol: string; last: number | null; tick: number }): JSX.Element {
  const rows = useMemo(() => {
    if (last == null) return [];
    const out: { price: number; size: number; side: 'ask' | 'bid' }[] = [];
    let seed = symbol.length * 7 + Math.floor(last * 100);
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 5; i >= 1; i--) out.push({ price: last + i * tick, size: Math.round(100 + rnd() * 900), side: 'ask' });
    for (let i = 1; i <= 5; i++) out.push({ price: last - i * tick, size: Math.round(100 + rnd() * 900), side: 'bid' });
    return out;
  }, [symbol, last, tick]);
  const max = rows.reduce((m, r) => Math.max(m, r.size), 0);

  if (last == null) return <div className="tp-depth tp-depth-empty">暂无行情</div>;
  return (
    <div className="tp-depth">
      <div className="tp-depth-head">
        <span>价格</span>
        <span>数量</span>
      </div>
      {rows.map((r) => (
        <div key={r.price} className={'tp-depth-row ' + r.side}>
          <i style={{ width: `${(r.size / max) * 100}%` }} />
          <span>{fmt(r.price)}</span>
          <span>{r.size}</span>
        </div>
      ))}
    </div>
  );
}
