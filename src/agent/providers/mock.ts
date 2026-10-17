import type { AgentEvent, AgentMessage, AgentProvider, AgentRequest, ToolCall } from '../types';
import { SYMBOL_CATALOG } from '../../data/symbols';

/**
 * 本地 mock provider：不联网，用关键字规则模拟「模型 → 工具调用 → 总结」。
 * 只用来在没有 DeepSeek harness 的时候把整条链路跑通。
 */


const TF_RE = /\b(1m|5m|15m|30m|1h|4h|1d|1w|1M)\b/i;
const RANGE_RE = /\b(1D|7D|1M|3M|6M|YTD|1Y|5Y|ALL)\b/;
const LAYOUT_RE = /(\d)\s*[x×*]\s*(\d)/i;
/** 「7 图」「12 个图」「4 张图」＋可选的「第 3 种」 */
const LAYOUT_COUNT_RE = /(\d{1,2})\s*(?:个|张)?图(?!表|形|标)/;
const LAYOUT_VARIANT_RE = /第\s*(\d+)\s*种/;

/** 口语 → 清单里的指标名（只给 mock 用；真模型自己会读 list_indicators） */
const INDICATOR_ALIASES: [RegExp, string][] = [
  [/macd|平滑异同/i, 'MACD'],
  [/\brsi\b|相对强弱/i, 'RSI'],
  [/\bema\b|指数均线|指数移动平均/i, 'EMA'],
  [/\bsma\b|简单均线|简单移动平均/i, 'SMA'],
  [/\bwma\b|加权均线/i, 'WMA'],
  [/\bhma\b|赫尔/i, 'HMA'],
  [/\bvwma\b/i, 'VWMA'],
  [/\bdema\b|双指数/i, 'DEMA'],
  [/\balma\b/i, 'ALMA'],
  [/\batr\b|真实波幅/i, 'ATR'],
  [/\bobv\b|能量潮/i, 'OBV'],
  [/\bcci\b|顺势/i, 'CCI'],
  [/\bmfi\b|资金流量指数/i, 'MFI'],
  [/\badx\b|平均趋向/i, 'ADX'],
  [/\bcmf\b|蔡金资金流/i, 'CMF'],
  [/kdj|stoch|随机指标/i, 'Stochastic oscillator'],
  [/williams|威廉/i, 'Williams %R'],
  [/donchian|唐奇安/i, 'Donchian channels'],
  [/动量|momentum/i, 'Momentum'],
  [/变动率|\broc\b/i, 'ROC'],
  [/chandelier|吊灯/i, 'Chandelier exit'],
  [/aroon|阿隆/i, 'Aroon oscillator'],
  [/awesome|神奇震荡/i, 'Awesome oscillator'],
];

let seq = 0;
const nid = (p: string): string => p + '-' + Date.now().toString(36) + '-' + (seq++).toString(36);

function normalizeTf(raw: string): string {
  const s = raw.trim();
  if (/^1d$/i.test(s)) return '1D';
  if (/^1w$/i.test(s)) return '1W';
  if (s === '1M') return '1M';
  return s.toLowerCase();
}

/** 把一句话翻译成若干个工具调用（纯函数，方便单测） */
/** 文字 → 主图样式 key；不认识返回 null。菜单里做不了的样式也返回各自的 key，由工具层说明原因 */
const STYLE_RULES: Array<[RegExp, string]> = [
  [/砖形|renko/i, 'renko'],
  [/新价线|三线反转/, 'linebreak'],
  [/卡吉|kagi/i, 'kagi'],
  [/点数图|圈叉|point\s*(and|&)\s*figure/i, 'pnf'],
  [/范围图|range\s*bars?/i, 'range'],
  [/成交量轨迹|footprint/i, 'footprint'],
  [/时间价格机会|\btpo\b/i, 'tpo'],
  [/成交量分布/, 'sessionvp'],
  [/平均\s*k\s*线|平均蜡烛|heikin|\bha\b/i, 'heikin'],
  [/空心/, 'hollow'],
  [/成交量蜡烛|volume\s*candle/i, 'volcandles'],
  [/带标记线|标记线|line\s*with\s*markers/i, 'linemarkers'],
  [/阶梯|step\s*line/i, 'step'],
  [/hlc/i, 'hlcarea'],
  [/基准线|baseline/i, 'baseline'],
  [/柱状图|columns/i, 'columns'],
  [/高[-－—\s]?低|high[-\s]?low/i, 'highlow'],
  [/面积/, 'area'],
  [/线形|折线|line\s*chart/i, 'line'],
  [/美国线|\bbars?\b/i, 'bars'],
  [/k\s*线|蜡烛|candle/i, 'candles'],
];

export function pickStyle(text: string): string | null {
  for (const [re, key] of STYLE_RULES) if (re.test(text)) return key;
  return null;
}

/**
 * 文字 → 标的代码：先认代码（字母数字，整词匹配；纯数字至少 4 位、字母至少 3 位，免得把「回放前进 10 根」里的数字、普通英文短词当成标的），
 * 再认中文名（如「贵州茅台」「腾讯控股」，至少 2 个字）。核心 5 个排在目录最前，同一句话里出现多个时它们优先。
 */
export function pickTicker(text: string): string | null {
  const upper = text.toUpperCase();
  for (const s of SYMBOL_CATALOG) {
    const t = s.ticker.toUpperCase();
    if (!/^[A-Z0-9]+$/.test(t)) continue;                 // ES1! / BTCUSDT.P 这类带符号的不走整词匹配
    if (/^\d+$/.test(t) ? t.length < 4 : t.length < 3) continue;   // 纯数字至少 4 位；字母代码至少 3 位（BA / KO 这种两位的太容易撞上普通单词）
    if (new RegExp('(^|[^A-Z0-9])' + t + '($|[^A-Z0-9])').test(upper)) return s.ticker;
  }
  for (const s of SYMBOL_CATALOG) {
    if (/[\u4e00-\u9fa5]{2,}/.test(s.name) && text.includes(s.name.replace(/-W$/, ''))) return s.ticker;
  }
  return null;
}

export function planToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const upper = text.toUpperCase();

  const ticker = pickTicker(text);
  if (ticker) calls.push({ id: nid('call'), name: 'set_symbol', arguments: { symbol: ticker } });

  const lay = text.match(LAYOUT_RE);
  const cnt = text.match(LAYOUT_COUNT_RE);
  if (lay) {
    calls.push({ id: nid('call'), name: 'set_layout', arguments: { rows: Number(lay[1]), cols: Number(lay[2]) } });
  } else if (cnt && /布局|layout|分屏|多图|切成|改成|换成|设为|设置/i.test(text)) {
    const v = text.match(LAYOUT_VARIANT_RE);
    calls.push({
      id: nid('call'),
      name: 'set_layout',
      arguments: v ? { count: Number(cnt[1]), variant: Number(v[1]) } : { count: Number(cnt[1]) },
    });
  }

  const tf = text.match(TF_RE);
  if (tf && !/range|范围/i.test(text)) {
    calls.push({ id: nid('call'), name: 'set_timeframe', arguments: { timeframe: normalizeTf(tf[1]) } });
  }

  const rg = text.match(RANGE_RE);
  if (rg && /range|范围|显示|看/i.test(text)) {
    calls.push({ id: nid('call'), name: 'set_range', arguments: { range: rg[1] } });
  }

  // 回放：先判退出 / 暂停 / 步进 / 速度，最后才是「回放」本身（进入）
  if (/回放|replay/i.test(text)) {
    const speed = text.match(/每秒\s*(\d+)\s*根|(\d+)\s*(?:根\/秒|倍速)/);
    const n = text.match(/(\d+)\s*根/);
    const act: [string, Record<string, unknown>] | null = /退出|停止|结束|关闭|stop|exit/i.test(text)
      ? ['stop', {}]
      : /暂停|pause/i.test(text)
        ? ['pause', {}]
        : speed
          ? ['speed', { value: Number(speed[1] ?? speed[2]) }]
          : /播放|play/i.test(text)
            ? ['play', {}]
            : /下一根|前进|step/i.test(text)
              ? ['step', n ? { value: Number(n[1]) } : {}]
              : /上一根|后退|back/i.test(text)
                ? ['back', n ? { value: Number(n[1]) } : {}]
                : ['start', {}];
    calls.push({ id: nid('call'), name: 'replay', arguments: { action: act[0], ...act[1] } });
  }

  // 样式：具体的名字（空心K线 / 平均K线 / 带标记线…）要先于泛称（K线 / 线形），否则「空心K线图」会被认成普通 K 线
  const styleKey = pickStyle(text);
  if (styleKey) calls.push({ id: nid('call'), name: 'set_chart_style', arguments: { style: styleKey } });

  const off = /关|隐藏|hide|off|remove|删|移除|去掉|取消/i.test(text);
  if (/布林|bollinger|\bbb\b/i.test(text)) {
    calls.push({ id: nid('call'), name: 'add_indicator', arguments: { indicator: 'bb', visible: !off } });
  }
  // 脚本指标：用常见叫法映射到清单里的名字（真正的解析在 chartControls.addStudy → findIndicator）
  if (/有哪些指标|指标列表|指标清单|list indicators/i.test(text)) {
    calls.push({ id: nid('call'), name: 'list_indicators', arguments: {} });
  } else {
    const hit = INDICATOR_ALIASES.find(([re]) => re.test(text));
    if (hit) calls.push({ id: nid('call'), name: 'add_indicator', arguments: { indicator: hit[1], visible: !off } });
  }
  return calls;
}

function lastUserText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content;
  return '';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

async function* streamText(text: string, signal?: AbortSignal, delay = 14): AsyncGenerator<AgentEvent> {
  const chunks = text.match(/.{1,3}/gs) ?? [];
  for (const c of chunks) {
    if (signal?.aborted) return;
    yield { type: 'text-delta', text: c };
    if (delay > 0) await sleep(delay, signal);
  }
}

export function createMockProvider(opts: { delayMs?: number } = {}): AgentProvider {
  const delay = opts.delayMs ?? 14;
  return {
    id: 'mock',
    label: 'Mock（本地演示）',
    async *send(req: AgentRequest): AsyncGenerator<AgentEvent> {
      const last = req.messages[req.messages.length - 1];

      // 工具结果回来了：给一段总结，不再发起新的调用
      if (last && last.role === 'tool') {
        const results: string[] = [];
        for (let i = req.messages.length - 1; i >= 0 && req.messages[i].role === 'tool'; i--) {
          results.unshift('- ' + req.messages[i].content);
        }
        yield* streamText('已完成:\n' + results.join('\n'), req.signal, delay);
        yield { type: 'done' };
        return;
      }

      const text = lastUserText(req.messages);
      const calls = planToolCalls(text).filter((c) => req.tools.some((t) => t.name === c.name));
      if (calls.length === 0) {
        yield* streamText(
          '我是 Quant 助手（mock 模式）。试试:\n' +
            '- "切到 NVDA"\n- "用 1h 周期"\n- "显示 1Y 范围"\n- "布局 2x2"\n- "打开布林带"\n- "切成面积图"\n- "开始回放" / "回放 5 根/秒" / "回放下一根"\n\n' +
            '接入 DeepSeek harness 后，这里会换成真实的推理与工具调用。',
          req.signal,
          delay,
        );
        yield { type: 'done' };
        return;
      }

      yield* streamText('好的，我来操作图表。', req.signal, delay);
      for (const call of calls) yield { type: 'tool-call', call };
      yield { type: 'done' };
    },
  };
}
