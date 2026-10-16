/**
 * kc-chart / strategyTest.ts
 * ---------------------------------------------------------------------------
 * Pine 撮合（strategy.ts + pine.ts 里的 strategy.*）的自检。纯计算，Node / 浏览器都能跑。
 *
 * 期望值全部**手算**，不拿被测代码的输出当期望。几条硬约束：
 *   · 仓位公式 / 手续费方向 / 滑点方向 / pyramiding / 平仓后权益守恒 —— 各有断言
 *   · 反向用例：保证金不足必须**抛错**，不能静默不下单
 *   · 两个历史坑做成回归：100% 权益被判保证金不足、空头幽灵成交
 *   · 用 strategy.* 重写双均线演示策略，权益曲线与 simulateMaCross() 在无成本下逐点一致
 * ---------------------------------------------------------------------------
 */

import type { Bar } from './chart';
import { log } from './chart';
import { simulateMaCross } from './equity';
import { PineEngine, pineTestBars } from './pine';
import { StrategyBroker, STRATEGY_DEFAULTS, sharpe, strategyConfigFromDecl } from './strategy';
import type { StrategyConfig, StrategyResult } from './strategy';

export interface StrategyTestResult {
  pass: number;
  fail: number;
  names: string[];
}

/** 手写 OHLC 行 → Bar（time 每根 +1 天） */
function rowsToBars(rows: [number, number, number, number][]): Bar[] {
  const t0 = Date.UTC(2020, 0, 2);
  return rows.map((r, i) => ({ time: t0 + i * 86400000, open: r[0], high: r[1], low: r[2], close: r[3], volume: 100 }));
}

/** 在每根 bar 上：先 beginBar，再跑「脚本」，再 afterScript / endBar —— 和 PineEngine.run 同一个顺序 */
function runBroker(
  bars: Bar[],
  cfg: Partial<StrategyConfig>,
  script: (i: number, br: StrategyBroker) => void,
): { res: StrategyResult; br: StrategyBroker } {
  const br = new StrategyBroker({ ...STRATEGY_DEFAULTS, ...cfg });
  for (let i = 0; i < bars.length; i++) {
    br.beginBar(i, bars[i]);
    script(i, br);
    br.afterScript();
    br.endBar();
  }
  return { res: br.result(), br };
}

export function strategySelfTest(): StrategyTestResult {
  let pass = 0;
  let fail = 0;
  const names: string[] = [];
  const t = (name: string, ok: boolean, extra = ''): void => {
    names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
    if (ok) pass++;
    else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };
  const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
  const throwsWith = (fn: () => unknown, frag: string): boolean => {
    try {
      fn();
      return false;
    } catch (e) {
      return String(e instanceof Error ? e.message : e).indexOf(frag) >= 0;
    }
  };

  // 上涨：收盘 100,110,120,130,120；开盘 = 前收（第 0 根 = 自己的收盘）
  const UP = pineTestBars([100, 110, 120, 130, 120]);
  // 下跌：100,90,80,70,80
  const DOWN = pineTestBars([100, 90, 80, 70, 80]);

  /* ------------------------------------------------------------------ 基础成交 */
  // 第 0 根收盘后下多单 → 第 1 根开盘 100 成交；第 3 根收盘后平仓 → 第 4 根开盘 130 成交
  const longTrip = (i: number, br: StrategyBroker): void => {
    if (i === 0) br.placeEntry('A', 'long', null);
    if (i === 3) br.placeClose('A');
  };
  const fx = runBroker(UP, { defaultQtyType: 'fixed', defaultQtyValue: 10 }, longTrip).res;
  t('fixed：成交 1 笔', fx.tradeCount === 1, String(fx.tradeCount));
  t('fixed：入场价 = 下一根开盘价 100（不是信号那根的收盘）', fx.tradeList[0].entryPrice === 100 && fx.tradeList[0].entryBar === 1,
    fx.tradeList[0].entryPrice + '@' + fx.tradeList[0].entryBar);
  t('fixed：出场价 = 下一根开盘价 130', fx.tradeList[0].exitPrice === 130 && fx.tradeList[0].exitBar === 4);
  t('fixed：净利 = (130-100)×10 = 300', near(fx.netProfit, 300) && near(fx.trades[0], 300), String(fx.netProfit));
  t('fixed：权益按收盘盯市 100100 / 100300，平仓后仍 100300',
    near(fx.points[1].equity, 100100) && near(fx.points[3].equity, 100300) && near(fx.points[4].equity, 100300),
    fx.points.map((p) => p.equity).join(','));
  t('fixed：持仓区间 = 第 1 根 → 第 4 根', fx.positions.length === 1 && fx.positions[0].from === UP[1].time && fx.positions[0].to === UP[4].time);
  t('每根 pnl 累加 == 净利', near(fx.points.reduce((s, p) => s + p.pnl, 0), fx.netProfit));

  /* ------------------------------------------------------------------ 仓位公式 */
  const pct = runBroker(UP, { defaultQtyType: 'percent_of_equity', defaultQtyValue: 100 }, longTrip).res;
  t('【回归①】100% 权益下单不会被判保证金不足：照常成交，净利 = 1000×30 = 30000',
    pct.tradeCount === 1 && near(pct.netProfit, 30000) && near(pct.tradeList[0].qty, 1000),
    pct.tradeCount + ' / ' + pct.netProfit);
  // 带 0.1% 手续费：qty = 100000 / (100 × 1.001)，入场手续费 = qty×100×0.1%
  const q = 100000 / (100 * 1.001);
  const pctC = runBroker(UP, { defaultQtyType: 'percent_of_equity', defaultQtyValue: 100, commissionValue: 0.1 }, longTrip).res;
  t('【回归①】100% 权益 + 手续费也不会被自己的手续费挤掉：qty = 预算 /（价×(1+费率)）',
    pctC.tradeCount === 1 && near(pctC.tradeList[0].qty, q, 1e-9), String(pctC.tradeList[0] && pctC.tradeList[0].qty));
  t('100% 权益 + 手续费：第 1 根权益 = 100000 − 入场费 + 浮盈',
    near(pctC.points[1].equity, 100000 - q * 100 * 0.001 + q * 10, 1e-9), String(pctC.points[1].equity));
  const cash = runBroker(UP, { defaultQtyType: 'cash', defaultQtyValue: 5000 }, longTrip).res;
  t('cash：5000 元在 100 的价格买 50 股', near(cash.tradeList[0].qty, 50), String(cash.tradeList[0].qty));

  /* ------------------------------------------------------------------ 保证金：必须明确报错 */
  t('【反向】150% 权益下单（保证金 100%）必须抛「保证金不足」，不能静默不下单',
    throwsWith(() => runBroker(UP, { defaultQtyType: 'percent_of_equity', defaultQtyValue: 150 }, longTrip), '保证金不足'));
  const big = (i: number, br: StrategyBroker): void => { if (i === 0) br.placeEntry('A', 'long', 2000); };
  t('【反向】显式 qty=2000（名义 20 万 > 权益 10 万）抛「保证金不足」', throwsWith(() => runBroker(UP, {}, big), '保证金不足'));
  t('保证金 50% 时 qty=2000 允许（需要 10 万 ≤ 权益 10 万）',
    (() => { try { return runBroker(UP, { marginLong: 50 }, big).res.openTrades.length === 1; } catch (e) { return false; } })());
  t('保证金 0 = 不检查', (() => { try { return runBroker(UP, { marginLong: 0 }, big).res.openTrades.length === 1; } catch (e) { return false; } })());
  const bigShort = (i: number, br: StrategyBroker): void => { if (i === 0) br.placeEntry('S', 'short', 2000); };
  t('【反向】空头同样检查保证金', throwsWith(() => runBroker(DOWN, {}, bigShort), '保证金不足'));
  t('qty 非正数 → 抛错', throwsWith(() => runBroker(UP, {}, (i, br) => { if (i === 0) br.placeEntry('A', 'long', -1); }), 'qty'));

  /* ------------------------------------------------------------------ 手续费 / 滑点方向 */
  const comm = runBroker(UP, { defaultQtyType: 'fixed', defaultQtyValue: 10, commissionValue: 0.1 }, longTrip).res;
  // 入场 100×10×0.1% = 1.0；出场 130×10×0.1% = 1.3
  t('手续费（百分比）从净利里扣：300 − 2.3 = 297.7，且小于无手续费的净利',
    near(comm.netProfit, 297.7) && comm.netProfit < fx.netProfit, String(comm.netProfit));
  t('逐笔记录的手续费 = 入场 + 出场 = 2.3', near(comm.tradeList[0].commission, 2.3) && near(comm.totalCommission, 2.3));
  const perOrder = runBroker(UP, { defaultQtyType: 'fixed', defaultQtyValue: 10, commissionType: 'cash_per_order', commissionValue: 5 }, longTrip).res;
  t('每笔固定 5 元：进出各一次，净利 300 − 10 = 290', near(perOrder.netProfit, 290), String(perOrder.netProfit));
  const perContract = runBroker(UP, { defaultQtyType: 'fixed', defaultQtyValue: 10, commissionType: 'cash_per_contract', commissionValue: 0.5 }, longTrip).res;
  t('每手 0.5 元：10 手进出 = 10 元，净利 290', near(perContract.netProfit, 290), String(perContract.netProfit));
  t('【守恒】平仓后权益 == 初始资金 + 各笔净盈亏之和（含手续费）',
    near(comm.finalEquity, 100000 + comm.trades.reduce((a, b) => a + b, 0)), comm.finalEquity + ' vs ' + (100000 + comm.trades[0]));

  const slip = runBroker(UP, { defaultQtyType: 'fixed', defaultQtyValue: 10, slippage: 2, mintick: 0.5 }, longTrip).res;
  t('滑点（多头）：买更贵 101、卖更便宜 129，净利 280',
    slip.tradeList[0].entryPrice === 101 && slip.tradeList[0].exitPrice === 129 && near(slip.netProfit, 280),
    slip.tradeList[0].entryPrice + '/' + slip.tradeList[0].exitPrice);

  /* ------------------------------------------------------------------ 空头（回归②） */
  const shortTrip = (i: number, br: StrategyBroker): void => {
    if (i === 0) br.placeEntry('S', 'short', null);
    if (i === 3) br.placeClose('S');
  };
  const sh = runBroker(DOWN, { defaultQtyType: 'fixed', defaultQtyValue: 10 }, shortTrip).res;
  t('【回归②】空头只产生 1 笔成交，没有「同日进同出」的幽灵单',
    sh.tradeCount === 1 && sh.tradeList[0].entryBar === 1 && sh.tradeList[0].exitBar === 4 &&
      sh.tradeList[0].entryTime < sh.tradeList[0].exitTime, sh.tradeCount + ' 笔');
  t('空头净利 = (100−70)×10 = 300，且权益上升', near(sh.netProfit, 300) && sh.points[3].equity > sh.points[0].equity);
  const shSlip = runBroker(DOWN, { defaultQtyType: 'fixed', defaultQtyValue: 10, slippage: 2, mintick: 0.5 }, shortTrip).res;
  t('滑点（空头）：卖在 99、回补在 71，净利 280',
    shSlip.tradeList[0].entryPrice === 99 && shSlip.tradeList[0].exitPrice === 71 && near(shSlip.netProfit, 280),
    shSlip.tradeList[0].entryPrice + '/' + shSlip.tradeList[0].exitPrice);

  /* ------------------------------------------------------------------ pyramiding / 反手 */
  const two = (i: number, br: StrategyBroker): void => {
    if (i === 0) br.placeEntry('A', 'long', null);
    if (i === 1) br.placeEntry('B', 'long', null);
  };
  t('pyramiding 默认（0 即只允许 1 笔）：第二个 id 的同向入场被忽略，持仓 10',
    runBroker(UP, { defaultQtyValue: 10 }, two).br.positionSize() === 10);
  t('pyramiding=2：两笔都成交，持仓 20', runBroker(UP, { defaultQtyValue: 10, pyramiding: 2 }, two).br.positionSize() === 20);
  t('同一个 id 已持仓时再次 entry 被忽略（即使 pyramiding=3）',
    runBroker(UP, { defaultQtyValue: 10, pyramiding: 3 }, (i, br) => { if (i < 2) br.placeEntry('A', 'long', null); }).br.positionSize() === 10);
  // 反手：第 0 根下多 → 第 1 根开盘 100 买；第 2 根下空 → 第 3 根开盘 120 先平多（+200）再开空 10
  const rev = runBroker(UP, { defaultQtyValue: 10 }, (i, br) => {
    if (i === 0) br.placeEntry('L', 'long', null);
    if (i === 2) br.placeEntry('S', 'short', null);
  });
  t('反手：先平掉多头（净利 200、原因 reverse），再开空头 −10',
    rev.res.tradeCount === 1 && near(rev.res.trades[0], 200) && rev.res.tradeList[0].exitReason === 'reverse' && rev.br.positionSize() === -10,
    rev.res.tradeCount + ' / ' + rev.br.positionSize());

  /* ------------------------------------------------------------------ stop / limit 退出 */
  const exitRun = (row3: [number, number, number, number], extra: Partial<StrategyConfig> = {}, exitArgs: { stop: number | null; limit: number | null } = { stop: 95, limit: 125 }): StrategyResult =>
    runBroker(
      rowsToBars([[100, 101, 99, 100], [100, 102, 98, 101], [101, 110, 100, 108], row3, [row3[3], row3[3] + 1, row3[3] - 1, row3[3]]]),
      { defaultQtyValue: 10, ...extra },
      (i, br) => {
        if (i === 0) br.placeEntry('A', 'long', null);
        if (i === 1) br.placeExit('X', 'A', exitArgs.stop, exitArgs.limit);
      },
    ).res;
  const limitFill = exitRun([108, 126, 107, 120]);
  t('止盈：high 够到 125 → 按 125 成交，净利 250', limitFill.tradeCount === 1 && limitFill.tradeList[0].exitPrice === 125 && near(limitFill.netProfit, 250),
    String(limitFill.tradeList[0] && limitFill.tradeList[0].exitPrice));
  const stopFill = exitRun([108, 109, 94, 95]);
  t('止损：low 破 95 → 按 95 成交，净利 −50', stopFill.tradeList[0].exitPrice === 95 && near(stopFill.netProfit, -50) && /^stop/.test(stopFill.tradeList[0].exitReason));
  const gapStop = exitRun([90, 92, 88, 90]);
  t('跳空低开越过止损：按开盘价 90 成交（不是 95），净利 −100', gapStop.tradeList[0].exitPrice === 90 && near(gapStop.netProfit, -100));
  const gapLimit = exitRun([130, 131, 129, 130]);
  t('跳空高开越过止盈：按开盘价 130 成交，净利 300', gapLimit.tradeList[0].exitPrice === 130 && near(gapLimit.netProfit, 300));
  const both = exitRun([108, 130, 90, 100]);
  t('同一根止损、止盈都够得着：止损先成交（悲观）', both.tradeList[0].exitPrice === 95 && /^stop/.test(both.tradeList[0].exitReason));
  const stopSlip = exitRun([108, 109, 94, 95], { slippage: 2, mintick: 0.5 });
  t('止损带滑点：95 − 1 = 94 成交', stopSlip.tradeList[0].exitPrice === 94, String(stopSlip.tradeList[0].exitPrice));
  // 本根下的退出单不能在本根生效：第 1 根下 stop=99，第 1 根 low=98 本来够得着
  const sameBar = runBroker(rowsToBars([[100, 101, 99, 100], [100, 102, 98, 101]]), { defaultQtyValue: 10 }, (i, br) => {
    if (i === 0) br.placeEntry('A', 'long', null);
    if (i === 1) br.placeExit('X', 'A', 99, null);
  }).res;
  t('退出单从下一根才生效（本根下的不会用本根的高低价成交）', sameBar.tradeCount === 0 && sameBar.openTrades.length === 1);
  const shortRows = (row: [number, number, number, number]): Bar[] =>
    rowsToBars([[100, 101, 99, 100], [100, 101, 99, 100], row, [row[3], row[3] + 1, row[3] - 1, row[3]]]);
  const shortExit = (row: [number, number, number, number]): StrategyResult =>
    runBroker(shortRows(row), { defaultQtyValue: 10 }, (i, br) => {
      if (i === 0) br.placeEntry('S', 'short', null);
      if (i === 1) br.placeExit('X', 'S', 105, 90);
    }).res;
  t('空头止损：high 够到 105 → 按 105 成交，净利 −50', near(shortExit([100, 106, 99, 105]).netProfit, -50));
  t('空头止盈：low 够到 90 → 按 90 成交，净利 +100', near(shortExit([100, 101, 89, 92]).netProfit, 100));
  t('exit 缺少 stop / limit → 抛错', throwsWith(() => runBroker(UP, {}, (i, br) => { if (i === 0) br.placeExit('X', 'A', null, null); }), 'stop 或 limit'));

  /* ------------------------------------------------------------------ process_orders_on_close */
  const gapBars = rowsToBars([[100, 101, 99, 100], [102, 111, 101, 110], [112, 121, 111, 120], [118, 131, 117, 130], [128, 129, 124, 125]]);
  const poScript = (i: number, br: StrategyBroker): void => {
    if (i === 1) br.placeEntry('A', 'long', null);
    if (i === 3) br.placeClose('A');
  };
  t('默认：下一根开盘成交（112 买、128 卖，净利 160）', near(runBroker(gapBars, { defaultQtyValue: 10 }, poScript).res.netProfit, 160));
  t('process_orders_on_close：当根收盘成交（110 买、130 卖，净利 200）',
    near(runBroker(gapBars, { defaultQtyValue: 10, processOrdersOnClose: true }, poScript).res.netProfit, 200));

  /* ------------------------------------------------------------------ 绩效指标 */
  const SAW = pineTestBars([100, 110, 120, 130, 120, 110, 100]);
  const twoTrades = runBroker(SAW, { defaultQtyValue: 10 }, (i, br) => {
    if (i === 0) br.placeEntry('A', 'long', null);
    if (i === 3) br.placeClose('A');
    if (i === 4) br.placeEntry('B', 'long', null);
    if (i === 5) br.placeClose('B');
  }).res;
  // 第一笔 +300（100→130），第二笔 −100（120→110）
  t('绩效：2 笔、胜率 50%、盈亏比 3、盈利因子 3',
    twoTrades.tradeCount === 2 && near(twoTrades.winRate, 0.5) && near(twoTrades.payoffRatio, 3) && near(twoTrades.profitFactor, 3) &&
      near(twoTrades.grossProfit, 300) && near(twoTrades.grossLoss, 100),
    `${twoTrades.tradeCount} ${twoTrades.winRate} ${twoTrades.payoffRatio} ${twoTrades.profitFactor}`);
  t('绩效：最大回撤 = 100300 → 100200 = 100', near(twoTrades.maxDrawdown, 100), String(twoTrades.maxDrawdown));
  t('绩效：净利 200，夏普为有限正数', near(twoTrades.netProfit, 200) && isFinite(twoTrades.sharpe) && twoTrades.sharpe > 0, String(twoTrades.sharpe));
  const flat = runBroker(UP, {}, () => undefined).res;
  t('没有任何交易：全部指标是 0 而不是 NaN（并且这是「没下单」而不是「被拒单」）',
    flat.tradeCount === 0 && flat.netProfit === 0 && flat.sharpe === 0 && flat.profitFactor === 0 && flat.winRate === 0 && !isNaN(flat.maxDrawdown));
  t('sharpe：权益纹丝不动时返回 0（方差 0 不出 NaN）',
    sharpe([{ time: 0, equity: 100, pnl: 0 }, { time: 1, equity: 100, pnl: 0 }], 100) === 0);

  /* ------------------------------------------------------------------ 声明头 → 配置 */
  t('声明头：非法 default_qty_type 抛错而不是悄悄用默认值', throwsWith(() => strategyConfigFromDecl({ default_qty_type: 'bogus' }), 'default_qty_type'));
  t('声明头：负的滑点抛错', throwsWith(() => strategyConfigFromDecl({ slippage: -1 }), 'slippage'));
  t('声明头：initial_capital ≤ 0 抛错', throwsWith(() => strategyConfigFromDecl({ initial_capital: 0 }), 'initial_capital'));
  t('声明头：calc_on_order_fills=true 暂不支持，明确报错', throwsWith(() => strategyConfigFromDecl({ calc_on_order_fills: true }), '暂不支持'));

  /* ------------------------------------------------------------------ Pine 脚本层 */
  const PINE_HEAD = (extra: string): string =>
    '//@version=5\nstrategy("t", overlay=true' + extra + ')\n';
  const run = (code: string, bars: Bar[]): PineEngine => new PineEngine(code, bars).run();

  // 用 strategy.* 重写双均线演示策略，与 simulateMaCross 逐点一致（无手续费无滑点）
  const closes: number[] = [];
  for (let i = 0; i < 400; i++) closes.push(100 + 12 * Math.sin(i / 7) + 6 * Math.sin(i / 3.1) + i * 0.03);
  const bars400 = pineTestBars(closes);
  const maScript =
    PINE_HEAD(', initial_capital=100000, default_qty_type=strategy.percent_of_equity, default_qty_value=100') +
    'fast = ta.sma(close, 5)\nslow = ta.sma(close, 20)\n' +
    'if ta.crossover(fast, slow)\n    strategy.entry("L", strategy.long)\n' +
    'if ta.crossunder(fast, slow)\n    strategy.close("L")\n';
  const pe = run(maScript, bars400);
  const pr = pe.strategyResult() as StrategyResult;
  const ref = simulateMaCross(bars400, 5, 20, 100000);
  t('演示策略：有成交（排除「引擎什么都没做」也能与参照一致的假阳性）', ref.tradeCount >= 5 && pr.tradeCount === ref.tradeCount,
    pr.tradeCount + ' vs ' + ref.tradeCount);
  t('演示策略：权益曲线与 simulateMaCross 逐点一致（每一根 400 个点）',
    pr.points.length === ref.points.length && pr.points.every((p, i) => near(p.equity, ref.points[i].equity, 1e-9) && p.time === ref.points[i].time),
    (() => {
      for (let i = 0; i < pr.points.length; i++) {
        if (!near(pr.points[i].equity, ref.points[i].equity, 1e-9)) return `第 ${i} 根 ${pr.points[i].equity} vs ${ref.points[i].equity}`;
      }
      return '';
    })());
  t('演示策略：净利 / 最大回撤 / 胜率 / 逐笔收益率与参照一致',
    near(pr.netProfit, ref.netProfit, 1e-9) && near(pr.maxDrawdown, ref.maxDrawdown, 1e-9) && near(pr.winRate, ref.winRate, 1e-12) &&
      pr.tradeReturns.length === ref.tradeReturns.length && pr.tradeReturns.every((r, i) => near(r, ref.tradeReturns[i], 1e-9)),
    `${pr.netProfit} vs ${ref.netProfit}`);
  t('演示策略：持仓区间一致', pr.positions.length === ref.positions.length &&
    pr.positions.every((p, i) => p.from === ref.positions[i].from && p.to === ref.positions[i].to));

  const sizeRun = run(PINE_HEAD(', default_qty_value=10') + 'if bar_index == 0\n    strategy.entry("A", strategy.long)\nplot(strategy.position_size)\nplot(strategy.opentrades)', UP);
  t('strategy.position_size：第 0 根 0，成交后（第 1 根起）10；opentrades 同步',
    sizeRun.plots[0].values[0] === 0 && sizeRun.plots[0].values[1] === 10 && sizeRun.plots[1].values[4] === 1,
    sizeRun.plots[0].values.join(','));
  const eqRun = run(PINE_HEAD(', default_qty_value=10') + 'if bar_index == 0\n    strategy.entry("A", strategy.long)\nplot(strategy.equity)', UP);
  t('strategy.equity：第 1 根 = 100000 + (110−100)×10', near(eqRun.plots[0].values[1] as number, 100100), String(eqRun.plots[0].values[1]));
  t('when=false 时不下单', (run(PINE_HEAD(', default_qty_value=10') + 'strategy.entry("A", strategy.long, when = close > 1000)', UP).strategyResult() as StrategyResult).openTrades.length === 0);
  t('indicator() 里调用 strategy.entry 明确报错', throwsWith(() => run('indicator("t")\nstrategy.entry("A", strategy.long)', UP), '只能在 strategy'));
  t('entry 带 limit 抛「暂不支持」，不悄悄当市价单',
    throwsWith(() => run(PINE_HEAD('') + 'strategy.entry("A", strategy.long, limit=90)', UP), '暂不支持'));
  t('exit 带 profit（点数止盈）抛「暂不支持」',
    throwsWith(() => run(PINE_HEAD('') + 'strategy.entry("A", strategy.long)\nstrategy.exit("X", "A", profit=10)', UP), '暂不支持'));
  t('Pine 层的保证金不足同样抛错（不是 0 笔成交的静默结果）',
    throwsWith(() => run(PINE_HEAD('') + 'if bar_index == 0\n    strategy.entry("A", strategy.long, qty=2000)', UP), '保证金不足'));
  t('Pine 层抛错时 engine.error 同步记录', (() => {
    const e = new PineEngine(PINE_HEAD('') + 'strategy.entry("A", strategy.long, qty=2000)', UP);
    try { e.run(); } catch (err) { return !!e.error && e.error.indexOf('保证金不足') >= 0; }
    return false;
  })());
  t('声明头里的 strategy.percent_of_equity 常量被识别（而不是退回默认的 fixed 1 手）',
    (() => {
      const r = run(PINE_HEAD(', default_qty_type=strategy.percent_of_equity, default_qty_value=50') + 'if bar_index == 0\n    strategy.entry("A", strategy.long)', UP).strategyResult() as StrategyResult;
      return r.openTrades.length === 1 && near(r.openTrades[0].qty, 500);
    })());
  t('未实现的 strategy.* 仍然明确抛错', throwsWith(() => run(PINE_HEAD('') + 'strategy.order("A", strategy.long)', UP), '还没实现'));
  t('indicator 脚本没有撮合结果', run('indicator("t")\nplot(close)', UP).strategyResult() === null);

  log('Pine 撮合自检：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail, names };
}
