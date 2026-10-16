import type { AgentEvent, AgentMessage, AgentProvider, AgentRequest, ToolCall } from '../types';

/**
 * 本地 mock provider：不联网，用关键字规则模拟「模型 → 工具调用 → 总结」。
 * 只用来在没有 DeepSeek harness 的时候把整条链路跑通。
 */

const TICKERS = ['TSLA', 'AAPL', 'NVDA', 'MSFT', 'SPY'];
const TF_RE = /\b(1m|5m|15m|30m|1h|4h|1d|1w|1M)\b/i;
const RANGE_RE = /\b(1D|7D|1M|3M|6M|YTD|1Y|5Y|ALL)\b/;
const LAYOUT_RE = /(\d)\s*[x×*]\s*(\d)/i;

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
export function planToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const upper = text.toUpperCase();

  const ticker = TICKERS.find((t) => new RegExp('\\b' + t + '\\b').test(upper));
  if (ticker) calls.push({ id: nid('call'), name: 'set_symbol', arguments: { symbol: ticker } });

  const lay = text.match(LAYOUT_RE);
  if (lay) {
    calls.push({ id: nid('call'), name: 'set_layout', arguments: { rows: Number(lay[1]), cols: Number(lay[2]) } });
  }

  const tf = text.match(TF_RE);
  if (tf && !/range|范围/i.test(text)) {
    calls.push({ id: nid('call'), name: 'set_timeframe', arguments: { timeframe: normalizeTf(tf[1]) } });
  }

  const rg = text.match(RANGE_RE);
  if (rg && /range|范围|显示|看/i.test(text)) {
    calls.push({ id: nid('call'), name: 'set_range', arguments: { range: rg[1] } });
  }

  // 样式：先判面积/折线/美国线，最后才是「K线」
  const styleKey = /面积/.test(text)
    ? 'area'
    : /线形|折线|line\s*chart/i.test(text)
      ? 'line'
      : /美国线|\bbars?\b/i.test(text)
        ? 'bars'
        : /k\s*线|蜡烛|candle/i.test(text)
          ? 'candles'
          : null;
  if (styleKey) calls.push({ id: nid('call'), name: 'set_chart_style', arguments: { style: styleKey } });

  if (/布林|bollinger|\bbb\b/i.test(text)) {
    const off = /关|隐藏|hide|off|remove/i.test(text);
    calls.push({ id: nid('call'), name: 'add_indicator', arguments: { indicator: 'bb', visible: !off } });
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
            '- "切到 NVDA"\n- "用 1h 周期"\n- "显示 1Y 范围"\n- "布局 2x2"\n- "打开布林带"\n- "切成面积图"\n\n' +
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
