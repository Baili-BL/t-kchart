import { useState } from 'react';
import { useChartStore } from '../store/chartStore';
import { applyFill, markToMarket, EMPTY_POSITION } from './paperAccount';
import type { Position } from './paperAccount';

/**
 * 模拟下单浮层（纯本地状态，不连任何券商）。
 * 成交价一律取活动图最新价（Market）。账户口径见 paperAccount.ts。
 */
export function PaperTrade(): JSX.Element {
  const symbol = useChartStore((s) => s.symbol);
  const last = useChartStore((s) => s.lastPrice);
  const [qty, setQty] = useState(1);
  const [pos, setPos] = useState<Record<string, Position>>({});
  const [realized, setRealized] = useState(0);

  const cur = pos[symbol] ?? EMPTY_POSITION;
  const unrealized = last != null ? markToMarket(cur, last) : 0;

  const trade = (side: 'buy' | 'sell'): void => {
    if (last == null || !(qty > 0)) return;
    const r = applyFill(cur, side, qty, last);
    setPos((p) => ({ ...p, [symbol]: r.position }));
    setRealized((v) => v + r.realized);
  };

  const fmt = (n: number): string => (n >= 0 ? '+' : '') + n.toFixed(2);

  return (
    <div className="paper" role="group" aria-label="模拟交易">
      <div className="paper-head">
        <span>Paper account</span>
        <span className="paper-sim">
          <i /> Simulated
        </span>
      </div>
      <div className="paper-row">
        <button type="button" className="paper-btn sell" onClick={() => trade('sell')} disabled={last == null}>
          <b>Sell</b>
          <small>Market</small>
        </button>
        <label className="paper-qty">
          <input
            type="number"
            min={1}
            step={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            aria-label="数量"
          />
          <small>{qty === 1 ? 'share' : 'shares'}</small>
        </label>
        <button type="button" className="paper-btn buy" onClick={() => trade('buy')} disabled={last == null}>
          <b>Buy</b>
          <small>Market</small>
        </button>
      </div>
      {(cur.qty !== 0 || realized !== 0) && (
        <div className="paper-pos">
          <span>
            {cur.qty === 0 ? '空仓' : `${cur.qty > 0 ? '多' : '空'} ${Math.abs(cur.qty)} @ ${cur.avg.toFixed(2)}`}
          </span>
          <span className={unrealized >= 0 ? 'up' : 'down'}>浮 {fmt(unrealized)}</span>
          <span className={realized >= 0 ? 'up' : 'down'}>实 {fmt(realized)}</span>
        </div>
      )}
    </div>
  );
}
