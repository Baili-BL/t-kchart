/**
 * 商品代码目录（「商品代码搜索」弹窗的数据，也是演示数据源能出图的全部标的）。
 *
 * 诚实说明：名字、交易所、分类是真实的，**价格全是按 seed 生成的随机游走**（见 mockBars.ts），
 * 只是把最后一根收盘价缩放到 `last` 附近。接入真实行情时，只需要把这个目录换成真实的 symbol 搜索接口。
 *
 * 约束：`ticker` 全局唯一（它同时是 store / 图表 / Agent 里的标的 id）。
 */

/** 分类，对应弹窗里的胶囊：全部 / 股票 / 基金 / 期货 / 外汇 / 加密货币 / 指数 / 债券 / 经济 / 期权 */
export type SymbolCategory = 'stock' | 'fund' | 'futures' | 'forex' | 'crypto' | 'index' | 'bond' | 'economy' | 'option';

export interface SymbolEntry {
  ticker: string;
  /** 描述（公司 / 品种全名） */
  name: string;
  /** 交易所简称，如 SZSE / NASDAQ */
  exchange: string;
  category: SymbolCategory;
  /** 「所有类型」过滤：普通股 / ETF / 永续合约 … */
  kind: string;
  /** 「所有国家/地区」过滤 */
  country: string;
  /** 「所有板块」过滤（目前只有股票 / 基金有） */
  sector?: string;
  seed: number;
  /** 当前价（最后一根收盘价会被缩放到这个数） */
  last: number;
  /** 头像颜色（有 logo 的大票给品牌色；没有的用灰底首字符） */
  color?: string;
  /** 自选表里默认显示的核心 5 个 */
  core?: boolean;
}

export const CATEGORY_LABELS: { key: SymbolCategory | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'stock', label: '股票' },
  { key: 'fund', label: '基金' },
  { key: 'futures', label: '期货' },
  { key: 'forex', label: '外汇' },
  { key: 'crypto', label: '加密货币' },
  { key: 'index', label: '指数' },
  { key: 'bond', label: '债券' },
  { key: 'economy', label: '经济' },
  { key: 'option', label: '期权' },
];

/** 行右侧的类型小字（沿用设计稿里的英文） */
export const CATEGORY_TAG: Record<SymbolCategory, string> = {
  stock: 'stock', fund: 'fund', futures: 'futures', forex: 'forex', crypto: 'crypto',
  index: 'index', bond: 'bond', economy: 'economic', option: 'option',
};

let seedN = 7100;   // 核心 5 个占了 7001–7005，其余从 7101 起，避免两个标的走出一模一样的曲线
const E = (
  category: SymbolCategory, ticker: string, name: string, exchange: string, country: string, kind: string, last: number,
  extra: { sector?: string; color?: string; core?: boolean; seed?: number } = {},
): SymbolEntry => ({
  ticker, name, exchange, category, kind, country, last,
  sector: extra.sector, color: extra.color, core: extra.core,
  seed: extra.seed ?? ++seedN,
});

const CN = '中国大陆';
const US = '美国';
const HK = '中国香港';
const TW = '中国台湾';
const GL = '全球';

export const SYMBOL_CATALOG: SymbolEntry[] = [
  // —— 核心 5 个（seed / last 与最初的演示数据一致，别改，测试里有基线）
  { ticker: 'TSLA', name: 'Tesla, Inc.', exchange: 'NASDAQ', category: 'stock', kind: '普通股', country: US, sector: '消费', seed: 7001, last: 362.46, color: '#e31937', core: true },
  { ticker: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', category: 'stock', kind: '普通股', country: US, sector: '科技', seed: 7002, last: 231.8, color: '#1d1d1f', core: true },
  { ticker: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', category: 'stock', kind: '普通股', country: US, sector: '科技', seed: 7003, last: 188.2, color: '#76b900', core: true },
  { ticker: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', category: 'stock', kind: '普通股', country: US, sector: '科技', seed: 7004, last: 512.4, color: '#0078d4', core: true },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', exchange: 'AMEX', category: 'fund', kind: 'ETF', country: US, seed: 7005, last: 668.9, color: '#7a1f1f', core: true },

  // —— 股票 · 深交所
  E('stock', '000001', '平安银行', 'SZSE', CN, '普通股', 11.5, { sector: '金融', color: '#ee6a00' }),
  E('stock', '000002', '万科A', 'SZSE', CN, '普通股', 7.2, { sector: '房地产' }),
  E('stock', '000063', '中兴通讯', 'SZSE', CN, '普通股', 32.4, { sector: '科技' }),
  E('stock', '000333', '美的集团', 'SZSE', CN, '普通股', 72.1, { sector: '消费' }),
  E('stock', '000651', '格力电器', 'SZSE', CN, '普通股', 43.6, { sector: '消费' }),
  E('stock', '000858', '五粮液', 'SZSE', CN, '普通股', 128.5, { sector: '消费' }),
  E('stock', '002415', '海康威视', 'SZSE', CN, '普通股', 31.2, { sector: '科技' }),
  E('stock', '002594', '比亚迪', 'SZSE', CN, '普通股', 280.4, { sector: '消费', color: '#d71920' }),
  E('stock', '300059', '东方财富', 'SZSE', CN, '普通股', 22.6, { sector: '金融' }),
  E('stock', '300750', '宁德时代', 'SZSE', CN, '普通股', 262.8, { sector: '工业' }),
  // —— 股票 · 上交所
  E('stock', '600519', '贵州茅台', 'SSE', CN, '普通股', 1500, { sector: '消费', color: '#c8161d' }),
  E('stock', '601318', '中国平安', 'SSE', CN, '普通股', 52.3, { sector: '金融', color: '#f26522' }),
  E('stock', '600036', '招商银行', 'SSE', CN, '普通股', 40.5, { sector: '金融', color: '#c8161d' }),
  E('stock', '601398', '工商银行', 'SSE', CN, '普通股', 6.2, { sector: '金融' }),
  E('stock', '600900', '长江电力', 'SSE', CN, '普通股', 28.9, { sector: '公用事业' }),
  E('stock', '601857', '中国石油', 'SSE', CN, '普通股', 8.8, { sector: '能源' }),
  E('stock', '688981', '中芯国际', 'SSE', CN, '普通股', 90.7, { sector: '科技' }),
  // —— 股票 · 港交所
  E('stock', '0700', '腾讯控股', 'HKEX', HK, '普通股', 560, { sector: '科技', color: '#1ba784' }),
  E('stock', '9988', '阿里巴巴-W', 'HKEX', HK, '普通股', 140.2, { sector: '消费', color: '#ff6a00' }),
  E('stock', '3690', '美团-W', 'HKEX', HK, '普通股', 130.6, { sector: '消费', color: '#ffc300' }),
  E('stock', '1810', '小米集团-W', 'HKEX', HK, '普通股', 55.4, { sector: '科技', color: '#ff6900' }),
  E('stock', '0005', '汇丰控股', 'HKEX', HK, '普通股', 100.3, { sector: '金融', color: '#db0011' }),
  E('stock', '0941', '中国移动', 'HKEX', HK, '普通股', 85.9, { sector: '通信' }),
  // —— 股票 · 美股
  E('stock', 'AMZN', 'Amazon.com, Inc.', 'NASDAQ', US, '普通股', 220.1, { sector: '消费', color: '#ff9900' }),
  E('stock', 'GOOGL', 'Alphabet Inc.', 'NASDAQ', US, '普通股', 250.6, { sector: '科技', color: '#4285f4' }),
  E('stock', 'META', 'Meta Platforms, Inc.', 'NASDAQ', US, '普通股', 700.3, { sector: '科技', color: '#0866ff' }),
  E('stock', 'NFLX', 'Netflix, Inc.', 'NASDAQ', US, '普通股', 1200.5, { sector: '消费', color: '#e50914' }),
  E('stock', 'AMD', 'Advanced Micro Devices, Inc.', 'NASDAQ', US, '普通股', 160.8, { sector: '科技', color: '#00a651' }),
  E('stock', 'BABA', 'Alibaba Group Holding Limited', 'NYSE', US, '存托凭证', 140.7, { sector: '消费', color: '#ff6a00' }),
  E('stock', 'JPM', 'JPMorgan Chase & Co.', 'NYSE', US, '普通股', 300.2, { sector: '金融', color: '#117aca' }),
  E('stock', 'XOM', 'Exxon Mobil Corporation', 'NYSE', US, '普通股', 115.4, { sector: '能源', color: '#ed1b2d' }),
  E('stock', 'JNJ', 'Johnson & Johnson', 'NYSE', US, '普通股', 160.9, { sector: '医疗', color: '#d51900' }),
  E('stock', 'KO', 'The Coca-Cola Company', 'NYSE', US, '普通股', 70.2, { sector: '消费', color: '#f40009' }),
  E('stock', 'DIS', 'The Walt Disney Company', 'NYSE', US, '普通股', 110.6, { sector: '消费', color: '#113ccf' }),
  E('stock', 'BA', 'The Boeing Company', 'NYSE', US, '普通股', 220.4, { sector: '工业', color: '#0039a6' }),
  // —— 股票 · 台湾
  E('stock', '2330', '台积电', 'TWSE', TW, '普通股', 1100, { sector: '科技' }),
  E('stock', '2317', '鸿海', 'TWSE', TW, '普通股', 200.5, { sector: '科技' }),
  E('stock', '6488', '环球晶', 'TPEX', TW, '普通股', 380.2, { sector: '科技' }),

  // —— 基金 / ETF
  E('fund', 'QQQ', 'Invesco QQQ Trust, Series 1', 'NASDAQ', US, 'ETF', 600.4),
  E('fund', 'IWM', 'iShares Russell 2000 ETF', 'AMEX', US, 'ETF', 240.3),
  E('fund', 'GLD', 'SPDR Gold Shares', 'AMEX', US, 'ETF', 330.9),
  E('fund', '510300', '沪深300ETF', 'SSE', CN, 'ETF', 4.1),
  E('fund', '510050', '上证50ETF', 'SSE', CN, 'ETF', 3.0),
  E('fund', '159915', '创业板ETF', 'SZSE', CN, 'ETF', 2.3),
  E('fund', '513100', '纳指ETF', 'SSE', CN, 'ETF', 1.5),

  // —— 期货
  E('futures', 'ES1!', 'E-mini S&P 500 期货', 'CME', US, '股指期货', 6700),
  E('futures', 'NQ1!', 'E-mini NASDAQ 100 期货', 'CME', US, '股指期货', 24000),
  E('futures', 'GC1!', '黄金期货', 'COMEX', US, '商品期货', 4000),
  E('futures', 'SI1!', '白银期货', 'COMEX', US, '商品期货', 48),
  E('futures', 'HG1!', '铜期货', 'COMEX', US, '商品期货', 5.1),
  E('futures', 'CL1!', 'WTI 原油期货', 'NYMEX', US, '商品期货', 62.5),
  E('futures', 'ZC1!', '玉米期货', 'CBOT', US, '商品期货', 420),
  E('futures', 'IF1!', '沪深300股指期货', 'CFFEX', CN, '股指期货', 4600),
  E('futures', 'RB1!', '螺纹钢期货', 'SHFE', CN, '商品期货', 3200),

  // —— 外汇
  E('forex', 'EURUSD', '欧元 / 美元', 'FX', GL, '货币对', 1.16),
  E('forex', 'USDJPY', '美元 / 日元', 'FX', GL, '货币对', 150.2),
  E('forex', 'GBPUSD', '英镑 / 美元', 'FX', GL, '货币对', 1.33),
  E('forex', 'AUDUSD', '澳元 / 美元', 'FX', GL, '货币对', 0.66),
  E('forex', 'USDCAD', '美元 / 加元', 'FX', GL, '货币对', 1.38),
  E('forex', 'USDCHF', '美元 / 瑞郎', 'FX', GL, '货币对', 0.8),
  E('forex', 'USDCNH', '美元 / 离岸人民币', 'FX', CN, '货币对', 7.1),

  // —— 加密货币
  E('crypto', 'BTCUSD', '比特币 / 美元', 'COINBASE', GL, '现货', 115000, { color: '#f7931a' }),
  E('crypto', 'ETHUSD', '以太坊 / 美元', 'COINBASE', GL, '现货', 4200, { color: '#627eea' }),
  E('crypto', 'SOLUSD', 'Solana / 美元', 'COINBASE', GL, '现货', 200.4, { color: '#9945ff' }),
  E('crypto', 'XRPUSD', '瑞波币 / 美元', 'COINBASE', GL, '现货', 2.6, { color: '#23292f' }),
  E('crypto', 'DOGEUSD', '狗狗币 / 美元', 'COINBASE', GL, '现货', 0.21, { color: '#c2a633' }),
  E('crypto', 'BNBUSDT', '币安币 / 泰达币', 'BINANCE', GL, '现货', 1100, { color: '#f3ba2f' }),
  E('crypto', 'BTCUSDT.P', '比特币 / 泰达币 永续合约', 'BINANCE', GL, '永续合约', 115100, { color: '#f7931a' }),

  // —— 指数
  E('index', 'SPX', '标普 500 指数', 'SP', US, '股票指数', 6700),
  E('index', 'NDX', '纳斯达克 100 指数', 'NASDAQ', US, '股票指数', 24000),
  E('index', 'DJI', '道琼斯工业平均指数', 'DJ', US, '股票指数', 46000),
  E('index', 'VIX', '标普 500 波动率指数', 'CBOE', US, '波动率指数', 17.2),
  E('index', 'SHCOMP', '上证综合指数', 'SSE', CN, '股票指数', 3900),
  E('index', 'SZCOMP', '深证成份指数', 'SZSE', CN, '股票指数', 13000),
  E('index', 'HSI', '恒生指数', 'HKEX', HK, '股票指数', 26000),
  E('index', 'N225', '日经 225 指数', 'TSE', '日本', '股票指数', 45000),
  E('index', 'DXY', '美元指数', 'ICE', US, '货币指数', 99.1),

  // —— 债券
  E('bond', 'US10Y', '美国 10 年期国债收益率', 'TVC', US, '国债收益率', 4.1),
  E('bond', 'US02Y', '美国 2 年期国债收益率', 'TVC', US, '国债收益率', 3.6),
  E('bond', 'CN10Y', '中国 10 年期国债收益率', 'TVC', CN, '国债收益率', 1.8),
  E('bond', 'DE10Y', '德国 10 年期国债收益率', 'TVC', '德国', '国债收益率', 2.6),
  E('bond', 'JP10Y', '日本 10 年期国债收益率', 'TVC', '日本', '国债收益率', 1.6),

  // —— 经济
  E('economy', 'USGDP', '美国 GDP 同比增速', 'ECONOMICS', US, '宏观指标', 2.1),
  E('economy', 'USCPI', '美国 CPI 同比', 'ECONOMICS', US, '宏观指标', 3.0),
  E('economy', 'USUR', '美国失业率', 'ECONOMICS', US, '宏观指标', 4.3),
  E('economy', 'CNGDP', '中国 GDP 同比增速', 'ECONOMICS', CN, '宏观指标', 5.0),
  E('economy', 'CNCPI', '中国 CPI 同比', 'ECONOMICS', CN, '宏观指标', 0.4),

  // —— 期权（OCC 代码风格：标的 + 到期日 YYMMDD + C/P + 行权价）
  E('option', 'SPY261218C700', 'SPY 2026-12-18 看涨 700.00', 'OPRA', US, '看涨期权', 18.5),
  E('option', 'SPY261218P650', 'SPY 2026-12-18 看跌 650.00', 'OPRA', US, '看跌期权', 14.2),
  E('option', 'AAPL261218C250', 'AAPL 2026-12-18 看涨 250.00', 'OPRA', US, '看涨期权', 9.8),
  E('option', 'NVDA261218C200', 'NVDA 2026-12-18 看涨 200.00', 'OPRA', US, '看涨期权', 11.3),
  E('option', 'TSLA261218P350', 'TSLA 2026-12-18 看跌 350.00', 'OPRA', US, '看跌期权', 27.6),
];

export const SYMBOL_BY_TICKER: ReadonlyMap<string, SymbolEntry> = new Map(SYMBOL_CATALOG.map((s) => [s.ticker, s]));

export interface SymbolFilter {
  q?: string;
  category?: SymbolCategory | 'all';
  country?: string;
  kind?: string;
  sector?: string;
}

/**
 * 搜索 + 过滤。排序：代码完全匹配 > 代码前缀匹配 > 代码包含 > 描述包含 > 其它（按目录顺序，稳定）。
 * `交易所:代码`（如 `SZSE:000001`）也认。查询为空时按目录顺序返回全部符合过滤的。
 */
export function searchSymbols(f: SymbolFilter = {}): SymbolEntry[] {
  const q = (f.q ?? '').trim().toLowerCase();
  const ex = q.includes(':') ? q.split(':')[0] : '';
  const code = q.includes(':') ? q.slice(q.indexOf(':') + 1) : q;
  const out: { s: SymbolEntry; rank: number; i: number }[] = [];
  SYMBOL_CATALOG.forEach((s, i) => {
    if (f.category && f.category !== 'all' && s.category !== f.category) return;
    if (f.country && s.country !== f.country) return;
    if (f.kind && s.kind !== f.kind) return;
    if (f.sector && s.sector !== f.sector) return;
    let rank = 4;
    if (q) {
      const t = s.ticker.toLowerCase();
      const n = s.name.toLowerCase();
      if (ex && s.exchange.toLowerCase() !== ex) return;
      if (t === code) rank = 0;
      else if (t.startsWith(code)) rank = 1;
      else if (t.includes(code)) rank = 2;
      else if (n.includes(code) || (!ex && s.exchange.toLowerCase() === q)) rank = 3;
      else return;
    }
    out.push({ s, rank, i });
  });
  out.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return out.map((x) => x.s);
}

/** 当前结果集里出现过的取值（保持首次出现顺序），用来生成下拉选项，保证选了就一定有结果 */
export function distinctValues(list: SymbolEntry[], key: 'country' | 'kind' | 'sector'): string[] {
  const seen = new Set<string>();
  for (const s of list) {
    const v = s[key];
    if (v) seen.add(v);
  }
  return [...seen];
}
