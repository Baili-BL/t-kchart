/**
 * 模拟账户的持仓计算（纯函数，可单测）。
 *
 * 口径：单标的净头寸（qty > 0 多头，< 0 空头），avg 为持仓均价，不含手续费与滑点。
 * 这里刻意把「反手」写清楚 —— 这是最容易静默算错的地方（TODO 2.1 提到的两个坑之一）：
 * 反手时必须先平掉旧仓位结算已实现盈亏，剩余数量才以成交价开新仓。
 */
export interface Position {
  qty: number;
  avg: number;
}

export const EMPTY_POSITION: Position = { qty: 0, avg: 0 };

export interface FillResult {
  position: Position;
  /** 本次成交产生的已实现盈亏 */
  realized: number;
}

export function applyFill(pos: Position, side: 'buy' | 'sell', qty: number, price: number): FillResult {
  if (!(qty > 0) || !isFinite(price) || !(price > 0)) throw new Error('applyFill: qty 与 price 必须为正数');
  const signed = side === 'buy' ? qty : -qty;

  // 空仓或同向加仓：更新加权均价，无已实现盈亏
  if (pos.qty === 0 || Math.sign(pos.qty) === Math.sign(signed)) {
    const total = pos.qty + signed;
    const avg = (Math.abs(pos.qty) * pos.avg + Math.abs(signed) * price) / Math.abs(total);
    return { position: { qty: total, avg }, realized: 0 };
  }

  // 反向：先平仓
  const closing = Math.min(Math.abs(signed), Math.abs(pos.qty));
  const realized = (price - pos.avg) * closing * Math.sign(pos.qty);
  const remain = pos.qty + signed;
  if (remain === 0) return { position: EMPTY_POSITION, realized };
  // 部分平仓：均价不变；反手：剩余数量按成交价开新仓
  if (Math.sign(remain) === Math.sign(pos.qty)) return { position: { qty: remain, avg: pos.avg }, realized };
  return { position: { qty: remain, avg: price }, realized };
}

/** 浮动盈亏 */
export function markToMarket(pos: Position, last: number): number {
  return pos.qty === 0 ? 0 : (last - pos.avg) * pos.qty;
}
