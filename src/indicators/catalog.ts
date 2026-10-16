/**
 * kc-chart / indicators / catalog.ts
 * ---------------------------------------------------------------------------
 * 内置指标库。**每一个指标都是一份 Pine v6 脚本**（`//@version=6`），由 PineEngine 执行；
 * 没有任何指标是用 TypeScript 手写的计算（测试里的 TS 参考实现只用来对数）。
 *
 * 不能实现的指标（需要引擎还没有的能力）照样列在清单里，但标成 disabled 并写明原因，
 * 不会假装能用，也不会悄悄给一个近似的错值。
 * ========================================================================= */

export type IndicatorKind = 'indicator' | 'strategy' | 'profile' | 'pattern' | 'option';

export interface IndicatorDef {
  id: string;
  /** 清单里显示的名字 */
  name: string;
  /** 短名（搜索用，如 EMA / MACD） */
  short: string;
  /** 中文关键词（搜索用） */
  keywords: string[];
  kind: IndicatorKind;
  beta?: boolean;
  /** Pine v6 源码；不能实现的没有 */
  source?: string;
  /** 不能实现的原因（有这个字段 = 清单里置灰、点不了） */
  unsupported?: string;
  description: string;
}

const V6 = '//@version=6\n';

const MISSING_OTHER_SYMBOL = '需要同时读取其他标的 / 全市场的行情（request.security），当前 Pine 引擎没有这个能力';

export const INDICATORS: IndicatorDef[] = [
  {
    id: 'volume-24h', name: '24-hour volume', short: '24H VOL', keywords: ['24小时成交量', '成交量'],
    kind: 'indicator', description: '最近 24 小时的累计成交量（日线及以上周期等于当根成交量）。',
    source: V6 + `indicator("24-hour volume", shortitle="24H Vol", format=format.volume)
// 一根 K 线占多少毫秒 → 24 小时折合多少根
barMs = time - nz(time[1], time - 86400000)
n = math.max(1, math.round(86400000 / math.max(1, barMs)))
float total = 0.0
for i = 0 to n - 1
    total += nz(volume[i])
plot(total, "24h volume", style=plot.style_columns, color=close >= open ? #26a69a : #ef5350)
`,
  },
  {
    id: 'acc-dist', name: 'Accumulation/distribution', short: 'A/D', keywords: ['累积派发', '累积/派发线', '资金流'],
    kind: 'indicator', description: '累积 / 派发线：按收盘价在当根振幅中的位置给成交量加权，再累计。',
    source: V6 + `indicator("Accumulation/distribution", shortitle="A/D", format=format.volume)
plot(ta.accdist, "Accumulation/Distribution", color=#2962ff)
`,
  },
  {
    id: 'adl-line', name: 'Advance-decline line', short: 'ADL', keywords: ['涨跌线', '腾落线'],
    kind: 'indicator', description: '上涨家数减下跌家数的累计值。', unsupported: MISSING_OTHER_SYMBOL, source: undefined,
  },
  {
    id: 'adl-ratio', name: 'Advance-decline ratio', short: 'ADR', keywords: ['涨跌比', '涨跌家数比'],
    kind: 'indicator', description: '上涨家数 / 下跌家数。', unsupported: MISSING_OTHER_SYMBOL, source: undefined,
  },
  {
    id: 'adl-ratio-bars', name: 'Advance-decline ratio (bars)', short: 'ADR bars', keywords: ['涨跌比（柱）'],
    kind: 'indicator', description: '涨跌家数比的柱状版本。', unsupported: MISSING_OTHER_SYMBOL, source: undefined,
  },
  {
      id: 'alma', name: 'Arnaud Legoux moving average', short: 'ALMA', keywords: ['阿诺勒古均线', '均线'],
      kind: 'indicator', description: '高斯加权均线：offset 控制峰值位置（越大越贴近当前价），sigma 控制平滑程度。',
      source: V6 + `indicator("Arnaud Legoux moving average", shortitle="ALMA", overlay=true)
len = input.int(9, "Window size", minval=1)
src = input.source(close, "Source")
offset = input.float(0.85, "Offset", minval=0, maxval=1, step=0.01)
sigma = input.float(6, "Sigma", minval=0.01)
plot(ta.alma(src, len, offset, sigma), "ALMA", color=#2962ff)
`,
  },
  {
    id: 'aroon-osc', name: 'Aroon oscillator', short: 'Aroon Osc', keywords: ['阿隆振荡', '趋势'],
    kind: 'indicator', description: 'Aroon Up 与 Aroon Down 之差，衡量新高与新低哪个来得更近。',
    source: V6 + `indicator("Aroon oscillator", shortitle="Aroon Osc")
len = input.int(14, "Length", minval=1)
upper = 100 * (ta.highestbars(high, len + 1) + len) / len
lower = 100 * (ta.lowestbars(low, len + 1) + len) / len
osc = upper - lower
hline(0, "Zero", color=#787b86)
plot(osc, "Aroon Oscillator", color=#ff6d00)
`,
  },
  {
    id: 'auto-fib-ext', name: 'Auto fib extension', short: 'Fib Ext', keywords: ['斐波那契扩展', '自动斐波那契'],
    kind: 'indicator', description: '自动识别摆动高低点并画出斐波那契扩展位。',
    unsupported: '需要枢轴点检测（ta.pivothigh/pivotlow）和 line.* / label.* 绘图对象，当前 Pine 引擎没有',
    source: undefined,
  },
  {
    id: 'auto-fib-ret', name: 'Auto fib retracement', short: 'Fib Ret', keywords: ['斐波那契回撤', '自动斐波那契'],
    kind: 'indicator', description: '自动识别摆动高低点并画出斐波那契回撤位。',
    unsupported: '需要枢轴点检测（ta.pivothigh/pivotlow）和 line.* / label.* 绘图对象，当前 Pine 引擎没有',
    source: undefined,
  },
  {
    id: 'auto-key-levels', name: 'Auto key levels', short: 'Key Levels', keywords: ['关键价位', '支撑阻力'], beta: true,
    kind: 'indicator', description: '自动标出关键的支撑 / 阻力价位。',
    unsupported: '需要 line.* / label.* 绘图对象和 request.security 取日 / 周 / 月高低点，当前 Pine 引擎没有',
    source: undefined,
  },
  {
    id: 'auto-pitchfork', name: 'Auto pitchfork', short: 'Pitchfork', keywords: ['安德鲁音叉', '自动音叉'],
    kind: 'indicator', description: '自动识别三个枢轴点并画出安德鲁音叉。',
    unsupported: '需要枢轴点检测和 line.* 绘图对象，当前 Pine 引擎没有',
    source: undefined,
  },
  {
    id: 'auto-trendlines', name: 'Auto trendlines', short: 'Trendlines', keywords: ['趋势线', '自动趋势线'], beta: true,
    kind: 'indicator', description: '自动识别并绘制趋势线。',
    unsupported: '需要枢轴点检测和 line.* 绘图对象，当前 Pine 引擎没有',
    source: undefined,
  },
  {
    id: 'adx', name: 'Average directional index', short: 'ADX', keywords: ['平均趋向指数', '趋势强度', 'DMI'],
    kind: 'indicator', description: '衡量趋势强弱（不分方向）的指标，同时给出 +DI / −DI。',
    source: V6 + `indicator("Average directional index", shortitle="ADX")
adxlen = input.int(14, "ADX Smoothing", minval=1, maxval=50)
dilen = input.int(14, "DI Length", minval=1, maxval=50)
[diplus, diminus, adx] = ta.dmi(dilen, adxlen)
plot(adx, "ADX", color=#f50057)
plot(diplus, "+DI", color=#2962ff)
plot(diminus, "-DI", color=#ff6d00)
`,
  },
  {
    id: 'ao', name: 'Awesome oscillator', short: 'AO', keywords: ['动量震荡', '神奇震荡', '动量'],
    kind: 'indicator', description: '中价 5 周期均线减 34 周期均线，柱色表示动量在增强还是减弱。',
    source: V6 + `indicator("Awesome oscillator", shortitle="AO")
ao = ta.sma(hl2, 5) - ta.sma(hl2, 34)
diff = ao - nz(ao[1])
plot(ao, "AO", style=plot.style_columns, color=ao >= 0 ? (diff > 0 ? #26a69a : #b2dfdb) : (diff > 0 ? #ffcdd2 : #ef5350))
`,
  },
  {
    id: 'bop', name: 'Balance of power', short: 'BoP', keywords: ['力量平衡', '多空力量'],
    kind: 'indicator', description: '(收 − 开) / (高 − 低)：当根里买方还是卖方占上风。',
    source: V6 + `indicator("Balance of power", shortitle="BoP")
hline(0, "Zero", color=#787b86)
plot(high - low == 0 ? na : (close - open) / (high - low), "Balance of power", color=#2962ff)
`,
  },
  {
    id: 'bbtrend', name: 'BBTrend', short: 'BBTrend', keywords: ['布林趋势', '布林带趋势'],
    kind: 'indicator', description: '用长短两组布林带的轨道差衡量趋势强度与方向。',
    source: V6 + `indicator("BBTrend", shortitle="BBTrend")
shortLen = input.int(20, "Short BB length", minval=1)
longLen = input.int(50, "Long BB length", minval=1)
mult = input.float(2.0, "StdDev", minval=0.001, step=0.5)
[midS, upS, lowS] = ta.bb(close, shortLen, mult)
[midL, upL, lowL] = ta.bb(close, longLen, mult)
bbtrend = (math.abs(lowS - lowL) - math.abs(upS - upL)) / midS * 100
hline(0, "Zero", color=#787b86)
plot(bbtrend, "BBTrend", style=plot.style_columns, color=bbtrend >= 0 ? (bbtrend >= nz(bbtrend[1]) ? #26a69a : #b2dfdb) : (bbtrend >= nz(bbtrend[1]) ? #ffcdd2 : #ef5350))
`,
  },
  {
    id: 'cmf', name: 'Chaikin money flow', short: 'CMF', keywords: ['蔡金资金流', '资金流量'],
    kind: 'indicator', description: '一段时间内「按位置加权的成交量」占总成交量的比例，>0 偏买、<0 偏卖。',
    source: V6 + `indicator("Chaikin money flow", shortitle="CMF")
len = input.int(20, "Length", minval=1)
ad = close == high and close == low or high == low ? 0 : ((2 * close - low - high) / (high - low)) * volume
mf = math.sum(ad, len) / math.sum(volume, len)
hline(0, "Zero", color=#787b86, linestyle=hline.style_dashed)
plot(mf, "CMF", color=#43a047)
`,
  },
  {
    id: 'chaikin-osc', name: 'Chaikin oscillator', short: 'Chaikin Osc', keywords: ['蔡金振荡'],
    kind: 'indicator', description: '累积 / 派发线的 3 周期 EMA 减 10 周期 EMA。',
    source: V6 + `indicator("Chaikin oscillator", shortitle="Chaikin Osc", format=format.volume)
fastLen = input.int(3, "Fast length", minval=1)
slowLen = input.int(10, "Slow length", minval=1)
osc = ta.ema(ta.accdist, fastLen) - ta.ema(ta.accdist, slowLen)
hline(0, "Zero", color=#787b86)
plot(osc, "Chaikin Oscillator", color=#2962ff)
`,
  },
  {
    id: 'chande-kroll', name: 'Chande Kroll stop', short: 'CKS', keywords: ['钱德克罗止损', '止损'],
    kind: 'indicator', description: '基于 ATR 的双向止损线：多头止损与空头止损。',
    source: V6 + `indicator("Chande Kroll stop", shortitle="CKS", overlay=true)
p = input.int(10, "ATR length", minval=1)
x = input.float(1.0, "ATR coefficient", minval=0)
q = input.int(9, "Stop length", minval=1)
atrv = ta.atr(p)
firstHighStop = ta.highest(high, p) - x * atrv
firstLowStop = ta.lowest(low, p) + x * atrv
stopShort = ta.highest(firstHighStop, q)
stopLong = ta.lowest(firstLowStop, q)
plot(stopShort, "Stop Short", color=#f23645)
plot(stopLong, "Stop Long", color=#089981)
`,
  },
  {
    id: 'cmo', name: 'Chande momentum oscillator', short: 'CMO', keywords: ['钱德动量', '动量'],
    kind: 'indicator', description: '上涨幅度与下跌幅度之差占总波动的百分比，范围 −100 ~ 100。',
    source: V6 + `indicator("Chande momentum oscillator", shortitle="CMO")
len = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
hline(0, "Zero", color=#787b86)
plot(ta.cmo(src, len), "Chande MO", color=#2962ff)
`,
  },
  {
    id: 'chandelier', name: 'Chandelier exit', short: 'CE', keywords: ['吊灯止损', '止损'],
    kind: 'indicator', description: '从近期最高 / 最低价回退若干倍 ATR 得到的追踪止损（只朝有利方向移动）。',
    source: V6 + `indicator("Chandelier exit", shortitle="CE", overlay=true)
len = input.int(22, "ATR period", minval=1)
mult = input.float(3.0, "ATR multiplier", step=0.1)
useClose = input.bool(true, "Use close price for extremums")
atrv = mult * ta.atr(len)
float longStop = (useClose ? ta.highest(close, len) : ta.highest(high, len)) - atrv
longStopPrev = nz(longStop[1], longStop)
longStop := close[1] > longStopPrev ? math.max(longStop, longStopPrev) : longStop
float shortStop = (useClose ? ta.lowest(close, len) : ta.lowest(low, len)) + atrv
shortStopPrev = nz(shortStop[1], shortStop)
shortStop := close[1] < shortStopPrev ? math.min(shortStop, shortStopPrev) : shortStop
var int dir = 1
dir := close > shortStopPrev ? 1 : close < longStopPrev ? -1 : dir
plot(dir == 1 ? longStop : na, "Long Stop", color=#089981, style=plot.style_linebr)
plot(dir == -1 ? shortStop : na, "Short Stop", color=#f23645, style=plot.style_linebr)
`,
  },
  {
    id: 'chop-zone', name: 'Chop zone', short: 'Chop Zone', keywords: ['震荡区'],
    kind: 'indicator', description: '用 EMA 斜率的角度给趋势 / 震荡状态着色。',
    unsupported: '官方配色依赖 math.acos 与分档色阶，当前 Pine 引擎没有这些，不做近似', source: undefined,
  },
  {
    id: 'chop', name: 'Choppiness index', short: 'CHOP', keywords: ['震荡指数', '盘整'],
    kind: 'indicator', description: '衡量市场是在盘整还是在趋势：越大越震荡（>61.8），越小越有趋势（<38.2）。',
    source: V6 + `indicator("Choppiness index", shortitle="CHOP")
len = input.int(14, "Length", minval=2)
ci = 100 * math.log10(math.sum(ta.tr, len) / (ta.highest(high, len) - ta.lowest(low, len))) / math.log10(len)
upper = hline(61.8, "Upper band", color=#787b86, linestyle=hline.style_dashed)
lower = hline(38.2, "Lower band", color=#787b86, linestyle=hline.style_dashed)
fill(upper, lower, color=color.new(#2962ff, 90), title="Background")
plot(ci, "CHOP", color=#2962ff)
`,
  },
  {
    id: 'cci', name: 'Commodity channel index', short: 'CCI', keywords: ['顺势指标', '商品通道'],
    kind: 'indicator', description: '价格偏离其均值的程度，常用 ±100 作为超买超卖线。',
    source: V6 + `indicator("Commodity channel index", shortitle="CCI")
len = input.int(20, "Length", minval=1)
src = input.source(hlc3, "Source")
upper = hline(100, "Upper band", color=#787b86, linestyle=hline.style_dashed)
hline(0, "Middle band", color=#787b86)
lower = hline(-100, "Lower band", color=#787b86, linestyle=hline.style_dashed)
fill(upper, lower, color=color.new(#2962ff, 90), title="Background")
plot(ta.cci(src, len), "CCI", color=#2962ff)
`,
  },
  {
    id: 'coppock', name: 'Coppock curve', short: 'Coppock', keywords: ['估波曲线', '长线买点'],
    kind: 'indicator', description: '两个变动率之和的加权均线，用来捕捉长线底部。',
    source: V6 + `indicator("Coppock curve", shortitle="Coppock")
wmaLen = input.int(10, "WMA length", minval=1)
longRoc = input.int(14, "Long RoC length", minval=1)
shortRoc = input.int(11, "Short RoC length", minval=1)
src = input.source(close, "Source")
hline(0, "Zero", color=#787b86)
plot(ta.wma(ta.roc(src, longRoc) + ta.roc(src, shortRoc), wmaLen), "Coppock Curve", color=#2962ff)
`,
  },
  {
    id: 'correlation', name: 'Correlation coefficient', short: 'Corr', keywords: ['相关系数', '相关性'],
    kind: 'indicator', description: '当前标的与另一个标的收盘价的相关系数。', unsupported: MISSING_OTHER_SYMBOL, source: undefined,
  },
  {
    id: 'cvd', name: 'Cumulative volume delta', short: 'CVD', keywords: ['累计成交量差', '买卖量差'],
    kind: 'indicator', description: '主动买入量减主动卖出量的累计值。',
    unsupported: '需要更小周期的逐笔 / 分钟数据拆分买卖量（request.security_lower_tf），当前 Pine 引擎没有', source: undefined,
  },
  {
    id: 'cvi', name: 'Cumulative volume index', short: 'CVI', keywords: ['累计成交量指数'],
    kind: 'indicator', description: '上涨家数成交量与下跌家数成交量之差的累计值。', unsupported: MISSING_OTHER_SYMBOL, source: undefined,
  },
  {
    id: 'dpo', name: 'Detrended price oscillator', short: 'DPO', keywords: ['去趋势价格振荡', '周期'],
    kind: 'indicator', description: '去掉长期趋势后的价格波动，用来识别周期。',
    source: V6 + `indicator("Detrended price oscillator", shortitle="DPO")
len = input.int(21, "Length", minval=1)
centered = input.bool(false, "Centered")
barsback = math.floor(len / 2) + 1
ma = ta.sma(close, len)
dpo = centered ? close[barsback] - ma : close - ma[barsback]
hline(0, "Zero", color=#787b86)
plot(dpo, "DPO", color=#43a047)
`,
  },
  {
    id: 'donchian', name: 'Donchian channels', short: 'DC', keywords: ['唐奇安通道', '通道', '海龟'],
    kind: 'indicator', description: '最近 N 根的最高价 / 最低价构成的通道，中轨是两者的平均。',
    source: V6 + `indicator("Donchian channels", shortitle="DC", overlay=true)
len = input.int(20, "Length", minval=1)
lower = ta.lowest(low, len)
upper = ta.highest(high, len)
basis = math.avg(upper, lower)
plot(basis, "Basis", color=#ff6d00)
u = plot(upper, "Upper", color=#2962ff)
l = plot(lower, "Lower", color=#2962ff)
fill(u, l, color=color.new(#2962ff, 95), title="Background")
`,
  },
  {
    id: 'dema', name: 'Double exponential moving average', short: 'DEMA', keywords: ['双指数均线', '均线'],
    kind: 'indicator', description: '2 × EMA − EMA(EMA)：比普通 EMA 滞后更小。',
    source: V6 + `indicator("Double exponential moving average", shortitle="DEMA", overlay=true)
len = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
e1 = ta.ema(src, len)
e2 = ta.ema(e1, len)
plot(2 * e1 - e2, "DEMA", color=#43a047)
`,
  },
  {
    id: 'eom', name: 'Ease of movement', short: 'EOM', keywords: ['简易波动', '易动指标'],
    kind: 'indicator', description: '价格在较小成交量下移动得有多轻松：>0 上涨轻松、<0 下跌轻松。',
    source: V6 + `indicator("Ease of movement", shortitle="EOM")
len = input.int(14, "Length", minval=1)
div = input.int(10000, "Divisor", minval=1)
eom = ta.sma(div * ta.change(hl2) * (high - low) / volume, len)
hline(0, "Zero", color=#787b86)
plot(eom, "EOM", color=#43a047)
`,
  },
  {
    id: 'efi', name: "Elder's force index", short: 'EFI', keywords: ['艾尔德强力指数', '强力指数'],
    kind: 'indicator', description: '价格变化 × 成交量的 EMA：衡量推动价格的力量。',
    source: V6 + `indicator("Elder's force index", shortitle="EFI", format=format.volume)
len = input.int(13, "Length", minval=1)
hline(0, "Zero", color=#787b86)
plot(ta.ema(ta.change(close) * volume, len), "Elder's Force Index", color=#2962ff)
`,
  },
  {
    id: 'ema', name: 'Exponential moving average', short: 'EMA', keywords: ['指数均线', '指数移动平均', '均线'],
    kind: 'indicator', description: '指数加权移动平均：越近的价格权重越大。',
    source: V6 + `indicator("Exponential moving average", shortitle="EMA", overlay=true)
len = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.ema(src, len), "EMA", color=#2962ff)
`,
  },

  /* ---------------- 其余常用指标（同样是 Pine v6） ---------------- */
  {
    id: 'atr', name: 'Average true range', short: 'ATR', keywords: ['平均真实波幅', '波动率'],
    kind: 'indicator', description: '真实波幅的 Wilder 平滑，衡量波动率。',
    source: V6 + `indicator("Average true range", shortitle="ATR")
len = input.int(14, "Length", minval=1)
plot(ta.atr(len), "ATR", color=#b71c1c)
`,
  },
  {
    id: 'bb', name: 'Bollinger bands', short: 'BB', keywords: ['布林带', '布林线', '通道'],
    kind: 'indicator', description: '均线 ± N 倍标准差构成的通道。',
    source: V6 + `indicator("Bollinger bands", shortitle="BB", overlay=true)
len = input.int(20, "Length", minval=1)
mult = input.float(2.0, "StdDev", minval=0.001, step=0.5)
src = input.source(close, "Source")
[basis, upper, lower] = ta.bb(src, len, mult)
plot(basis, "Basis", color=#ff6d00)
p1 = plot(upper, "Upper", color=#2962ff)
p2 = plot(lower, "Lower", color=#2962ff)
fill(p1, p2, color=color.new(#2962ff, 95), title="Background")
`,
  },
  {
    id: 'hma', name: 'Hull moving average', short: 'HMA', keywords: ['赫尔均线', '均线'],
    kind: 'indicator', description: '用加权均线的组合消除滞后，同时保持平滑。',
    source: V6 + `indicator("Hull moving average", shortitle="HMA", overlay=true)
len = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.hma(src, len), "HMA", color=#2962ff)
`,
  },
  {
    id: 'macd', name: 'Moving average convergence divergence', short: 'MACD', keywords: ['指数平滑异同', '平滑异同移动平均', '趋势'],
    kind: 'indicator', description: '快慢 EMA 之差、信号线与柱状图。',
    source: V6 + `indicator("Moving average convergence divergence", shortitle="MACD")
fastLen = input.int(12, "Fast length", minval=1)
slowLen = input.int(26, "Slow length", minval=1)
sigLen = input.int(9, "Signal length", minval=1)
src = input.source(close, "Source")
[macdLine, signalLine, hist] = ta.macd(src, fastLen, slowLen, sigLen)
hline(0, "Zero", color=#787b86)
plot(hist, "Histogram", style=plot.style_columns, color=hist >= 0 ? (hist >= nz(hist[1]) ? #26a69a : #b2dfdb) : (hist >= nz(hist[1]) ? #ffcdd2 : #ef5350))
plot(macdLine, "MACD", color=#2962ff)
plot(signalLine, "Signal", color=#ff6d00)
`,
  },
  {
    id: 'mfi', name: 'Money flow index', short: 'MFI', keywords: ['资金流量指数', '量价'],
    kind: 'indicator', description: '带成交量的 RSI：衡量资金流入流出的强度。',
    source: V6 + `indicator("Money flow index", shortitle="MFI")
len = input.int(14, "Length", minval=1)
src = input.source(hlc3, "Source")
upper = hline(80, "Overbought", color=#787b86, linestyle=hline.style_dashed)
hline(50, "Middle", color=#787b86, linestyle=hline.style_dotted)
lower = hline(20, "Oversold", color=#787b86, linestyle=hline.style_dashed)
fill(upper, lower, color=color.new(#7e57c2, 90), title="Background")
plot(ta.mfi(src, len), "MFI", color=#7e57c2)
`,
  },
  {
    id: 'mom', name: 'Momentum', short: 'MOM', keywords: ['动量', '动能'],
    kind: 'indicator', description: '当前价格减 N 根之前的价格。',
    source: V6 + `indicator("Momentum", shortitle="MOM")
len = input.int(10, "Length", minval=1)
src = input.source(close, "Source")
hline(0, "Zero", color=#787b86)
plot(ta.mom(src, len), "MOM", color=#2962ff)
`,
  },
  {
    id: 'obv', name: 'On balance volume', short: 'OBV', keywords: ['能量潮', '量能'],
    kind: 'indicator', description: '涨日加成交量、跌日减成交量的累计值。',
    source: V6 + `indicator("On balance volume", shortitle="OBV", format=format.volume)
plot(ta.obv, "OBV", color=#2962ff)
`,
  },
  {
    id: 'roc', name: 'Rate of change', short: 'ROC', keywords: ['变动率', '涨跌幅'],
    kind: 'indicator', description: '价格相对 N 根之前的变化百分比。',
    source: V6 + `indicator("Rate of change", shortitle="ROC")
len = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
hline(0, "Zero", color=#787b86)
plot(ta.roc(src, len), "ROC", color=#2962ff)
`,
  },
  {
    id: 'rsi', name: 'Relative strength index', short: 'RSI', keywords: ['相对强弱指数', '相对强弱', '超买超卖'],
    kind: 'indicator', description: '涨跌幅度的相对强度，70 以上超买、30 以下超卖。',
    source: V6 + `indicator("Relative strength index", shortitle="RSI")
len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
upper = hline(70, "Upper band", color=#787b86, linestyle=hline.style_dashed)
hline(50, "Middle band", color=#787b86, linestyle=hline.style_dotted)
lower = hline(30, "Lower band", color=#787b86, linestyle=hline.style_dashed)
fill(upper, lower, color=color.new(#7e57c2, 90), title="Background")
plot(ta.rsi(src, len), "RSI", color=#7e57c2)
`,
  },
  {
    id: 'sma', name: 'Simple moving average', short: 'SMA', keywords: ['简单均线', '简单移动平均', '均线'],
    kind: 'indicator', description: '最近 N 根收盘价的算术平均。',
    source: V6 + `indicator("Simple moving average", shortitle="SMA", overlay=true)
len = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.sma(src, len), "SMA", color=#2962ff)
`,
  },
  {
    id: 'stoch', name: 'Stochastic oscillator', short: 'Stoch', keywords: ['随机指标', 'KDJ', '超买超卖'],
    kind: 'indicator', description: '收盘价在最近 N 根高低区间中的相对位置，%K 与其均线 %D。',
    source: V6 + `indicator("Stochastic oscillator", shortitle="Stoch")
periodK = input.int(14, "%K length", minval=1)
smoothK = input.int(1, "%K smoothing", minval=1)
periodD = input.int(3, "%D smoothing", minval=1)
k = ta.sma(ta.stoch(close, high, low, periodK), smoothK)
d = ta.sma(k, periodD)
upper = hline(80, "Upper band", color=#787b86, linestyle=hline.style_dashed)
hline(50, "Middle band", color=#787b86, linestyle=hline.style_dotted)
lower = hline(20, "Lower band", color=#787b86, linestyle=hline.style_dashed)
fill(upper, lower, color=color.new(#2962ff, 90), title="Background")
plot(k, "%K", color=#2962ff)
plot(d, "%D", color=#ff6d00)
`,
  },
  {
    id: 'vwma', name: 'Volume weighted moving average', short: 'VWMA', keywords: ['成交量加权均线', '均线'],
    kind: 'indicator', description: '按成交量加权的移动平均。',
    source: V6 + `indicator("Volume weighted moving average", shortitle="VWMA", overlay=true)
len = input.int(20, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.vwma(src, len), "VWMA", color=#2962ff)
`,
  },
  {
    id: 'wma', name: 'Weighted moving average', short: 'WMA', keywords: ['加权均线', '加权移动平均', '均线'],
    kind: 'indicator', description: '线性加权移动平均：越近的价格权重越大。',
    source: V6 + `indicator("Weighted moving average", shortitle="WMA", overlay=true)
len = input.int(9, "Length", minval=1)
src = input.source(close, "Source")
plot(ta.wma(src, len), "WMA", color=#2962ff)
`,
  },
  {
    id: 'wpr', name: 'Williams %R', short: '%R', keywords: ['威廉指标', '威廉', '超买超卖'],
    kind: 'indicator', description: '收盘价在最近 N 根高低区间中的位置（反向，−100 ~ 0）。',
    source: V6 + `indicator("Williams %R", shortitle="%R")
len = input.int(14, "Length", minval=1)
upper = hline(-20, "Upper band", color=#787b86, linestyle=hline.style_dashed)
hline(-50, "Middle band", color=#787b86, linestyle=hline.style_dotted)
lower = hline(-80, "Lower band", color=#787b86, linestyle=hline.style_dashed)
fill(upper, lower, color=color.new(#7e57c2, 90), title="Background")
plot(ta.wpr(len), "%R", color=#7e57c2)
`,
  },
];
