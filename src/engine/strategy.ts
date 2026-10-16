/**
 * kc-chart / strategy.ts
 * ---------------------------------------------------------------------------
 * Pine `strategy.*` 的撮合引擎（T3 Phase 2）。纯计算，不依赖 DOM / canvas。
 *
 * pine.ts 在每根 bar 上调用：
 *     beginBar(i, bar)   → 先按开盘价成交上一根留下的订单，再检查 stop / limit 退出
 *     （脚本执行，strategy.entry / close / exit 只是把订单排队）
 *     afterScript()      → process_orders_on_close=true 时，在收盘价立即成交本根下的单
 *     endBar()           → 按收盘价盯市，记一个权益点
 *
 * ============================ 口径（写清楚，免得数字对不上时互相猜）============================
 * 成交
 *   · 脚本在一根 bar **收盘后**运行，所以下的单默认在**下一根开盘价**成交（避免前视）。
 *     process_orders_on_close=true 时改为当根收盘价成交。
 *   · 只支持市价入场。entry 带 limit / stop 会明确报错，不会被悄悄当成市价单。
 *   · 反向 entry = 先平掉全部反向持仓，再按新方向开仓（与主流图表软件一致）。
 *   · pyramiding：同方向最多同时持有 max(1, pyramiding) 笔入场；
 *     同一个 id 已经持仓时，再次 entry 被忽略。
 *   · close(id) 平掉该 id 的入场；close_all() 全平。没有这个持仓则忽略。
 *   · exit(id, from_entry, stop, limit)：价位是**绝对价格**，从下一根 bar 起生效。
 *     跳空：开盘已越过止损 / 止盈 → 按**开盘价**成交，不是按挂单价。
 *     同一根里止损和止盈都够得着：**按止损先成交**（悲观假设，没有逐笔数据时不乐观）。
 *     profit / loss（点数）、trail_*、qty / qty_percent 暂不支持，传了就报错。
 * 成本
 *   · 手续费：percent（成交额的 %）/ cash_per_order（每笔固定额）/ cash_per_contract（每手固定额），
 *     入场和出场各收一次，**从权益里扣**。
 *   · 滑点：slippage × mintick，永远对自己不利（买更贵、卖更便宜）；
 *     止损单和市价单有滑点，限价单没有。
 * 仓位
 *   · fixed：qty 就是 default_qty_value；
 *     percent_of_equity：按成交那一刻的权益 × 比例，**并预留手续费**，
 *       所以 100% 权益不会被自己的手续费挤成「保证金不足」；
 *     cash：按固定金额，同样预留手续费。
 *   · 保证金：持仓名义价值 × margin% 不得超过扣完手续费后的权益。
 *     **不足时抛错，绝不静默不下单。** margin=0 表示不检查。
 * 权益
 *   · 权益 = 初始资金 + 已实现盈亏 − 手续费 + 持仓浮盈，每根 bar 按**收盘价**盯市。
 *
 * 两个必须永远不再出现的坑（有回归自检，见 strategyTest.ts）：
 *   ① 100% 权益下单被判成保证金不足，0 笔成交、全部指标 0，却不报错。
 *   ② 空头持仓凭空多记一批「同日进同出」的幽灵成交。
 * ===========================================================================
 */

import type { Bar } from './chart';

/* ===========================================================================
 * 1. 类型
 * ========================================================================= */

export type Direction = 'long' | 'short';
export type QtyType = 'percent_of_equity' | 'fixed' | 'cash';
export type CommissionType = 'percent' | 'cash_per_order' | 'cash_per_contract';

export interface StrategyConfig {
  initialCapital: number;
  defaultQtyType: QtyType;
  defaultQtyValue: number;
  commissionType: CommissionType;
  commissionValue: number;
  /** 滑点，单位是 tick */
  slippage: number;
  /** 最小报价单位（1 tick 的价格） */
  mintick: number;
  /** 同方向最多同时持有的入场笔数（0 和 1 等价） */
  pyramiding: number;
  processOrdersOnClose: boolean;
  /** 多 / 空头保证金比例（%）；0 = 不检查 */
  marginLong: number;
  marginShort: number;
}

export const STRATEGY_DEFAULTS: StrategyConfig = {
  initialCapital: 100000,
  defaultQtyType: 'fixed',
  defaultQtyValue: 1,
  commissionType: 'percent',
  commissionValue: 0,
  slippage: 0,
  mintick: 0.01,
  pyramiding: 0,
  processOrdersOnClose: false,
  marginLong: 100,
  marginShort: 100,
};

/** 一笔还在持有的入场 */
export interface Lot {
  id: string;
  dir: Direction;
  qty: number;
  price: number;
  time: number;
  bar: number;
  /** 入场手续费（已经从现金里扣过了） */
  commission: number;
}

/** 一笔已平仓的交易 */
export interface ClosedTrade {
  entryId: string;
  /** 平仓原因：close:id / close_all / reverse / stop:id / limit:id */
  exitReason: string;
  dir: Direction;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  entryBar: number;
  exitBar: number;
  /** 入场 + 出场手续费 */
  commission: number;
  /** 净盈亏（已扣手续费） */
  profit: number;
}

export interface EquityPt {
  time: number;
  equity: number;
  pnl: number;
}

/** 与 equity.ts 的 BacktestResult 同构（多出来的字段是策略报告用的），权益图和统计组件可直接吃 */
export interface StrategyResult {
  points: EquityPt[];
  /** 每笔平仓净盈亏 */
  trades: number[];
  /** 逐笔收益率 = 净盈亏 / 入场名义价值 */
  tradeReturns: number[];
  tradeCount: number;
  winRate: number;
  maxDrawdown: number;
  netProfit: number;
  /** 收尾未平的持仓带 `open: true`，不是成交；与 equity.ts 的 BacktestResult 同口径 */
  positions: { from: number; to: number; long: boolean; open?: boolean }[];

  initialCapital: number;
  finalEquity: number;
  tradeList: ClosedTrade[];
  openTrades: Lot[];
  grossProfit: number;
  /** 总亏损，正数 */
  grossLoss: number;
  /** 总盈利 / 总亏损；没有亏损且有盈利时是 Infinity，都没有时是 0 */
  profitFactor: number;
  avgWin: number;
  /** 平均亏损，正数 */
  avgLoss: number;
  /** 盈亏比 = 平均盈利 / 平均亏损 */
  payoffRatio: number;
  totalCommission: number;
  /** 每根 bar 收益率的夏普（年化因子见 sharpe()，默认 252 根/年），无风险利率取 0 */
  sharpe: number;
}

/** 策略层面的错误：保证金不足 / 参数不合法 / 暂不支持。pine.ts 会原样抛给调用方。 */
export class StrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrategyError';
  }
}

interface MarketOrder {
  kind: 'entry' | 'close' | 'close_all';
  id: string;
  dir: Direction;
  qty: number | null;
}

interface ExitOrder {
  id: string;
  from: string | null;
  stop: number | null;
  limit: number | null;
  placedBar: number;
}

/* ===========================================================================
 * 2. 声明头 → 配置
 * ========================================================================= */

const QTY_TYPES: QtyType[] = ['percent_of_equity', 'fixed', 'cash'];
const COMMISSION_TYPES: CommissionType[] = ['percent', 'cash_per_order', 'cash_per_contract'];

/**
 * 把 `strategy(...)` 声明头里的字面量选项转成配置。
 * 非法值直接抛错：宁可让用户看到「default_qty_type 不认识」，也不要悄悄退回默认值，
 * 否则回测结果和脚本写的对不上，还没有任何提示。
 */
export function strategyConfigFromDecl(opts: Record<string, any>, extra?: { mintick?: number }): StrategyConfig {
  const cfg: StrategyConfig = { ...STRATEGY_DEFAULTS };
  if (extra && extra.mintick != null) cfg.mintick = extra.mintick;

  const num = (key: string, min: number, strictlyAbove: boolean): number | undefined => {
    const v = opts[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'number' || !isFinite(v)) throw new StrategyError(`strategy(${key}=…) 必须是数字`);
    if (strictlyAbove ? v <= min : v < min) {
      throw new StrategyError(`strategy(${key}=${v}) 不合法：需要 ${strictlyAbove ? '>' : '>='} ${min}`);
    }
    return v;
  };

  cfg.initialCapital = num('initial_capital', 0, true) ?? cfg.initialCapital;
  cfg.defaultQtyValue = num('default_qty_value', 0, true) ?? cfg.defaultQtyValue;
  cfg.commissionValue = num('commission_value', 0, false) ?? cfg.commissionValue;
  cfg.slippage = num('slippage', 0, false) ?? cfg.slippage;
  cfg.marginLong = num('margin_long', 0, false) ?? cfg.marginLong;
  cfg.marginShort = num('margin_short', 0, false) ?? cfg.marginShort;
  const pyr = num('pyramiding', 0, false);
  if (pyr !== undefined) cfg.pyramiding = Math.floor(pyr);

  if (opts.default_qty_type !== undefined) {
    if (!QTY_TYPES.includes(opts.default_qty_type)) {
      throw new StrategyError(`strategy(default_qty_type=…) 不认识：${String(opts.default_qty_type)}，可选 ${QTY_TYPES.join(' / ')}`);
    }
    cfg.defaultQtyType = opts.default_qty_type;
  }
  if (opts.commission_type !== undefined) {
    if (!COMMISSION_TYPES.includes(opts.commission_type)) {
      throw new StrategyError(`strategy(commission_type=…) 不认识：${String(opts.commission_type)}，可选 ${COMMISSION_TYPES.join(' / ')}`);
    }
    cfg.commissionType = opts.commission_type;
  }
  if (opts.process_orders_on_close !== undefined) cfg.processOrdersOnClose = opts.process_orders_on_close === true;

  if (opts.calc_on_order_fills === true) throw new StrategyError('strategy(calc_on_order_fills=true) 暂不支持');
  if (opts.use_bar_magnifier === true) throw new StrategyError('strategy(use_bar_magnifier=true) 暂不支持');
  return cfg;
}

/* ===========================================================================
 * 3. 撮合器
 * ========================================================================= */

export class StrategyBroker {
  readonly cfg: StrategyConfig;

  private cash: number;
  private lots: Lot[] = [];
  private closed: ClosedTrade[] = [];
  private orders: MarketOrder[] = [];
  private exits: ExitOrder[] = [];
  private points: EquityPt[] = [];

  private i = -1;
  private bar: Bar | null = null;
  /** 脚本里读 strategy.equity 等变量时用的盯市价（= 当根收盘价） */
  private mark = 0;
  private prevEquity: number;
  private peak: number;
  private maxDD = 0;
  private totalCommission = 0;

  constructor(cfg: StrategyConfig) {
    this.cfg = cfg;
    this.cash = cfg.initialCapital;
    this.prevEquity = cfg.initialCapital;
    this.peak = cfg.initialCapital;
  }

  /* --------------------------------------------------------- 每根 bar 的驱动 */

  beginBar(i: number, bar: Bar): void {
    this.i = i;
    this.bar = bar;
    this.mark = bar.open;
    this.fillQueued(bar.open);
    this.checkExits(bar);
    this.mark = bar.close;
  }

  /** 脚本跑完之后：process_orders_on_close 时在收盘价立即成交本根下的单 */
  afterScript(): void {
    if (!this.bar) return;
    if (this.cfg.processOrdersOnClose) this.fillQueued(this.bar.close);
  }

  endBar(): void {
    const bar = this.bar;
    if (!bar) return;
    const eq = this.equityAt(bar.close);
    this.points.push({ time: bar.time, equity: eq, pnl: eq - this.prevEquity });
    this.prevEquity = eq;
    if (eq > this.peak) this.peak = eq;
    if (this.peak - eq > this.maxDD) this.maxDD = this.peak - eq;
  }

  /* --------------------------------------------------------- 脚本下单（只排队） */

  placeEntry(id: string, dir: Direction, qty: number | null): void {
    this.needId(id, 'strategy.entry');
    if (dir !== 'long' && dir !== 'short') throw new StrategyError('strategy.entry 的方向必须是 strategy.long 或 strategy.short');
    if (qty !== null && (!isFinite(qty) || qty <= 0)) {
      throw new StrategyError(`strategy.entry("${id}") 的 qty 必须是正数，收到 ${qty}`);
    }
    this.orders.push({ kind: 'entry', id, dir, qty });
  }

  placeClose(id: string): void {
    this.needId(id, 'strategy.close');
    this.orders.push({ kind: 'close', id, dir: 'long', qty: null });
  }

  placeCloseAll(): void {
    this.orders.push({ kind: 'close_all', id: '', dir: 'long', qty: null });
  }

  placeExit(id: string, from: string | null, stop: number | null, limit: number | null): void {
    this.needId(id, 'strategy.exit');
    if (stop === null && limit === null) {
      throw new StrategyError(`strategy.exit("${id}") 至少要给 stop 或 limit 之一`);
    }
    for (const [name, v] of [['stop', stop], ['limit', limit]] as [string, number | null][]) {
      if (v !== null && (!isFinite(v) || v <= 0)) throw new StrategyError(`strategy.exit("${id}") 的 ${name} 必须是正的价格，收到 ${v}`);
    }
    const next: ExitOrder = { id, from, stop, limit, placedBar: this.i };
    const k = this.exits.findIndex((e) => e.id === id);
    if (k >= 0) {
      // 同一个 id 重复调用 = 修改价位；已经生效的单不能因为改价而推迟一根
      next.placedBar = Math.min(this.exits[k].placedBar, this.i);
      this.exits[k] = next;
    } else {
      this.exits.push(next);
    }
  }

  cancel(id: string): void {
    this.orders = this.orders.filter((o) => o.id !== id);
    this.exits = this.exits.filter((e) => e.id !== id);
  }

  cancelAll(): void {
    this.orders = [];
    this.exits = [];
  }

  /* --------------------------------------------------------- 脚本可读的状态 */

  positionSize(): number {
    let s = 0;
    for (const l of this.lots) s += l.dir === 'long' ? l.qty : -l.qty;
    return s;
  }

  /** 持仓均价；空仓时返回 null（脚本里是 na） */
  positionAvgPrice(): number | null {
    let q = 0;
    let v = 0;
    for (const l of this.lots) {
      q += l.qty;
      v += l.qty * l.price;
    }
    return q > 0 ? v / q : null;
  }

  equity(): number {
    return this.equityAt(this.mark);
  }

  openProfit(): number {
    return this.equityAt(this.mark) - this.cash;
  }

  netProfit(): number {
    let s = 0;
    for (const t of this.closed) s += t.profit;
    return s;
  }

  /** pine.ts 读 `strategy.xxx` 变量的入口；不认识的名字返回 undefined，调用方继续走「未实现」报错 */
  varValue(name: string): number | null | undefined {
    switch (name) {
      case 'strategy.position_size': return this.positionSize();
      case 'strategy.position_avg_price': return this.positionAvgPrice();
      case 'strategy.equity': return this.equity();
      case 'strategy.netprofit': return this.netProfit();
      case 'strategy.openprofit': return this.openProfit();
      case 'strategy.initial_capital': return this.cfg.initialCapital;
      case 'strategy.opentrades': return this.lots.length;
      case 'strategy.closedtrades': return this.closed.length;
      default: return undefined;
    }
  }

  /* --------------------------------------------------------- 结果 */

  result(): StrategyResult {
    const cfg = this.cfg;
    const trades: number[] = [];
    const tradeReturns: number[] = [];
    const positions: { from: number; to: number; long: boolean; open?: boolean }[] = [];
    let grossProfit = 0;
    let grossLoss = 0;
    let wins = 0;
    let losses = 0;
    for (const t of this.closed) {
      trades.push(t.profit);
      const notional = t.entryPrice * t.qty;
      tradeReturns.push(notional > 0 ? t.profit / notional : 0);
      positions.push({ from: t.entryTime, to: t.exitTime, long: t.dir === 'long' });
      if (t.profit > 0) {
        grossProfit += t.profit;
        wins++;
      } else if (t.profit < 0) {
        grossLoss += -t.profit;
        losses++;
      }
    }
    // 还没平的持仓也算一段（和 simulateMaCross 一致），但不计入成交笔数
    const lastTime = this.points.length ? this.points[this.points.length - 1].time : 0;
    for (const l of this.lots) positions.push({ from: l.time, to: lastTime, long: l.dir === 'long', open: true });
    positions.sort((a, b) => a.from - b.from || a.to - b.to);

    const finalEquity = this.points.length ? this.points[this.points.length - 1].equity : cfg.initialCapital;
    const avgWin = wins ? grossProfit / wins : 0;
    const avgLoss = losses ? grossLoss / losses : 0;
    return {
      points: this.points.slice(),
      trades,
      tradeReturns,
      tradeCount: this.closed.length,
      winRate: this.closed.length ? wins / this.closed.length : 0,
      maxDrawdown: this.maxDD,
      netProfit: finalEquity - cfg.initialCapital,
      positions,
      initialCapital: cfg.initialCapital,
      finalEquity,
      tradeList: this.closed.slice(),
      openTrades: this.lots.map((l) => ({ ...l })),
      grossProfit,
      grossLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      avgWin,
      avgLoss,
      payoffRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0,
      totalCommission: this.totalCommission,
      sharpe: sharpe(this.points, cfg.initialCapital),
    };
  }

  /* --------------------------------------------------------- 内部：成交 */

  private needId(id: string, fn: string): void {
    if (typeof id !== 'string' || !id) throw new StrategyError(`${fn} 需要一个非空的 id`);
  }

  private where(): string {
    return `（第 ${this.i} 根 K 线${this.bar ? '，time=' + this.bar.time : ''}）`;
  }

  private sign(l: Lot): number {
    return l.dir === 'long' ? 1 : -1;
  }

  private equityAt(price: number): number {
    let e = this.cash;
    for (const l of this.lots) e += this.sign(l) * (price - l.price) * l.qty;
    return e;
  }

  private commissionFor(qty: number, price: number): number {
    const c = this.cfg;
    if (c.commissionValue === 0) return 0;
    switch (c.commissionType) {
      case 'percent': return (qty * price * c.commissionValue) / 100;
      case 'cash_per_order': return c.commissionValue;
      default: return qty * c.commissionValue;
    }
  }

  /** 滑点永远对自己不利：买入更贵、卖出更便宜 */
  private slipped(price: number, buy: boolean): number {
    return price + (buy ? 1 : -1) * this.cfg.slippage * this.cfg.mintick;
  }

  /** 预算（现金）在给定价格下能买多少，**预留手续费** */
  private qtyForBudget(budget: number, price: number): number {
    const c = this.cfg;
    if (c.commissionValue === 0) return budget / price;
    switch (c.commissionType) {
      case 'percent': return budget / (price * (1 + c.commissionValue / 100));
      case 'cash_per_contract': return budget / (price + c.commissionValue);
      default: return (budget - c.commissionValue) / price;
    }
  }

  private defaultQty(price: number): number {
    const c = this.cfg;
    switch (c.defaultQtyType) {
      case 'fixed': return c.defaultQtyValue;
      case 'cash': return this.qtyForBudget(c.defaultQtyValue, price);
      default: return this.qtyForBudget((this.equityAt(price) * c.defaultQtyValue) / 100, price);
    }
  }

  private fillQueued(refPrice: number): void {
    const q = this.orders;
    this.orders = [];
    for (const o of q) {
      if (o.kind === 'entry') this.fillEntry(o, refPrice);
      else if (o.kind === 'close') this.closeLots(this.lots.filter((l) => l.id === o.id), refPrice, 'close:' + o.id);
      else this.closeLots(this.lots.slice(), refPrice, 'close_all');
    }
  }

  private fillEntry(o: MarketOrder, refPrice: number): void {
    const buy = o.dir === 'long';
    const opposite = this.lots.filter((l) => l.dir !== o.dir);
    if (opposite.length) this.closeLots(opposite, refPrice, 'reverse');

    const same = this.lots.filter((l) => l.dir === o.dir);
    if (same.some((l) => l.id === o.id)) return;
    if (same.length >= Math.max(1, this.cfg.pyramiding)) return;

    const price = this.slipped(refPrice, buy);
    const eq0 = this.equityAt(price);
    if (eq0 <= 0) throw new StrategyError(`权益已耗尽（${eq0.toFixed(2)}），无法再开仓 ${this.where()}`);

    const qty = o.qty !== null ? o.qty : this.defaultQty(price);
    if (!isFinite(qty) || qty <= 0) {
      throw new StrategyError(
        `strategy.entry("${o.id}") 算出的数量是 ${qty}，无法下单。` +
          `检查 default_qty_value / 手续费是否把预算吃光 ${this.where()}`,
      );
    }

    const commission = this.commissionFor(qty, price);
    const eqAfter = eq0 - commission;
    let longQty = 0;
    let shortQty = 0;
    for (const l of this.lots) {
      if (l.dir === 'long') longQty += l.qty;
      else shortQty += l.qty;
    }
    if (buy) longQty += qty;
    else shortQty += qty;
    const need = (longQty * price * this.cfg.marginLong) / 100 + (shortQty * price * this.cfg.marginShort) / 100;
    const checked = (buy ? this.cfg.marginLong : this.cfg.marginShort) > 0;
    // 100% 预算刚好用满时，浮点误差可能让 need 比 eqAfter 大一点点，给 1e-9 的相对容差
    if (checked && need > eqAfter * (1 + 1e-9) + 1e-9) {
      throw new StrategyError(
        `保证金不足：strategy.entry("${o.id}") 需要 ${need.toFixed(2)}，可用权益 ${eqAfter.toFixed(2)}` +
          `（数量 ${qty}，价格 ${price}）。请减小数量或调低保证金比例 ${this.where()}`,
      );
    }

    this.cash -= commission;
    this.totalCommission += commission;
    this.lots.push({ id: o.id, dir: o.dir, qty, price, time: this.bar ? this.bar.time : 0, bar: this.i, commission });
  }

  private closeLots(sel: Lot[], refPrice: number, reason: string): void {
    for (const l of sel) {
      const buyToCover = l.dir === 'short';
      this.closeLot(l, this.slipped(refPrice, buyToCover), reason);
    }
  }

  private closeLot(l: Lot, price: number, reason: string): void {
    const k = this.lots.indexOf(l);
    if (k < 0) return;
    this.lots.splice(k, 1);
    const gross = this.sign(l) * (price - l.price) * l.qty;
    const exitComm = this.commissionFor(l.qty, price);
    this.cash += gross - exitComm;
    this.totalCommission += exitComm;
    this.closed.push({
      entryId: l.id,
      exitReason: reason,
      dir: l.dir,
      qty: l.qty,
      entryPrice: l.price,
      exitPrice: price,
      entryTime: l.time,
      exitTime: this.bar ? this.bar.time : 0,
      entryBar: l.bar,
      exitBar: this.i,
      commission: l.commission + exitComm,
      profit: gross - l.commission - exitComm,
    });
  }

  private checkExits(bar: Bar): void {
    for (const ex of this.exits.slice()) {
      if (ex.placedBar >= this.i) continue; // 本根下的单，下一根才生效
      const targets = this.lots.filter((l) => ex.from === null || l.id === ex.from);
      for (const l of targets) this.tryExit(ex, l, bar);
      const left = this.lots.some((l) => ex.from === null || l.id === ex.from);
      if (targets.length && !left) this.exits = this.exits.filter((e) => e !== ex);
    }
  }

  private tryExit(ex: ExitOrder, l: Lot, bar: Bar): void {
    const long = l.dir === 'long';
    const { stop, limit } = ex;
    // 价位「够得着」：多头止损向下、止盈向上；空头相反
    const stopHit = stop !== null && (long ? bar.low <= stop : bar.high >= stop);
    const limitHit = limit !== null && (long ? bar.high >= limit : bar.low <= limit);
    if (!stopHit && !limitHit) return;

    // 1) 跳空越过限价：按开盘价成交（对自己有利，也是真实会发生的）
    if (limit !== null && (long ? bar.open >= limit : bar.open <= limit)) {
      this.closeLot(l, bar.open, 'limit:' + ex.id);
      return;
    }
    // 2) 跳空越过止损：按开盘价成交，含滑点
    if (stop !== null && (long ? bar.open <= stop : bar.open >= stop)) {
      this.closeLot(l, this.slipped(bar.open, !long), 'stop:' + ex.id);
      return;
    }
    // 3) 同一根里都够得着：止损先成交（悲观）
    if (stopHit && stop !== null) {
      this.closeLot(l, this.slipped(stop, !long), 'stop:' + ex.id);
      return;
    }
    if (limitHit && limit !== null) this.closeLot(l, limit, 'limit:' + ex.id);
  }
}

/* ===========================================================================
 * 4. 绩效指标
 * ========================================================================= */

/**
 * 夏普 = 每根 bar 收益率均值 / 样本标准差 × √(barsPerYear)，无风险利率取 0。
 * 收益率 = 权益 / 上一根权益 − 1（第一根相对初始资金）。方差为 0 时返回 0，不返回 NaN。
 */
export function sharpe(points: EquityPt[], initial: number, barsPerYear = 252): number {
  const n = points.length;
  if (n < 2) return 0;
  const rs: number[] = [];
  let prev = initial;
  for (const p of points) {
    rs.push(prev > 0 ? p.equity / prev - 1 : 0);
    prev = p.equity;
  }
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  let ss = 0;
  for (const r of rs) ss += (r - mean) * (r - mean);
  const sd = Math.sqrt(ss / (n - 1));
  return sd > 1e-15 ? (mean / sd) * Math.sqrt(barsPerYear) : 0;
}
