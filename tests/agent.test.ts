import { describe, expect, it } from 'vitest';
import { createMockProvider, planToolCalls } from '../src/agent/providers/mock';
import { createDeepSeekProvider } from '../src/agent/providers/deepseek';
import { runAgent } from '../src/agent/runner';
import type { MessageSink } from '../src/agent/runner';
import { createChartTools } from '../src/agent/tools';
import type { ChartControls } from '../src/agent/tools';
import type { AgentEvent, AgentMessage, AgentProvider, ToolCall } from '../src/agent/types';

/** 记录所有调用的假图表 */
function fakeControls(): ChartControls & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    setSymbol: (s) => void log.push('symbol:' + s),
    setTimeframe: (t) => void log.push('tf:' + t),
    setRange: (r) => {
      log.push('range:' + r);
      return r !== '5Y';
    },
    setLayout: (r, c) => void log.push(`layout:${r}x${c}`),
    setIndicator: (i, v) => void log.push(`ind:${i}:${v}`),
    runPine: (code) => (code.includes('bad') ? { ok: false, message: 'parse error' } : { ok: true, message: 'ok' }),
    knownSymbols: () => ['TSLA', 'NVDA'],
    knownTimeframes: () => ['30m', '1h', '1D'],
    knownRanges: () => ['1M', '1Y', '5Y', 'ALL'],
  };
}

function collectSink(): { sink: MessageSink; all: AgentMessage[] } {
  const all: AgentMessage[] = [];
  return {
    all,
    sink: {
      append: (m) => void all.push(m),
      patch: (id, p) => {
        const m = all.find((x) => x.id === id);
        if (m) Object.assign(m, p);
      },
    },
  };
}

const user = (content: string): AgentMessage => ({ id: 'u1', role: 'user', content, createdAt: 0 });
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: 'c-' + name, name, arguments: args });

describe('mock provider · 意图 → 工具调用', () => {
  it('"切到 NVDA" → set_symbol', () => {
    const calls = planToolCalls('切到 NVDA');
    expect(calls.map((c) => c.name)).toEqual(['set_symbol']);
    expect(calls[0].arguments).toEqual({ symbol: 'NVDA' });
  });

  it('不会把 NVDAX 之类的子串误识别成标的', () => {
    expect(planToolCalls('NVDAX 是什么')).toEqual([]);
  });

  it('周期与范围互不串线：1h 是周期、1Y 是范围', () => {
    const tf = planToolCalls('用 1h 周期');
    expect(tf.map((c) => c.name)).toEqual(['set_timeframe']);
    const rg = planToolCalls('显示 1Y 范围');
    expect(rg.map((c) => c.name)).toEqual(['set_range']);
    expect(rg[0].arguments).toEqual({ range: '1Y' });
  });

  it('1d / 1w 统一成引擎认的大小写', () => {
    expect(planToolCalls('用 1d')[0].arguments).toEqual({ timeframe: '1D' });
    expect(planToolCalls('用 1w')[0].arguments).toEqual({ timeframe: '1W' });
  });

  it('布局 2x3 / 关闭布林带', () => {
    expect(planToolCalls('布局 2x3')[0]).toMatchObject({ name: 'set_layout', arguments: { rows: 2, cols: 3 } });
    expect(planToolCalls('关闭布林带')[0]).toMatchObject({ name: 'add_indicator', arguments: { visible: false } });
  });

  it('无关输入不产生任何调用', () => {
    expect(planToolCalls('今天天气怎么样')).toEqual([]);
  });
});

describe('工具运行时', () => {
  it('未知标的必须报错，不能静默成功', async () => {
    const ctl = fakeControls();
    const r = await createChartTools(ctl).execute(call('set_symbol', { symbol: 'XXXX' }));
    expect(r.ok).toBe(false);
    expect(ctl.log).toEqual([]);
  });

  it('参数缺失 / 越界 / 类型不对都报错且不触碰图表', async () => {
    const ctl = fakeControls();
    const t = createChartTools(ctl);
    expect((await t.execute(call('set_symbol', {}))).ok).toBe(false);
    expect((await t.execute(call('set_layout', { rows: 9, cols: 1 }))).ok).toBe(false);
    expect((await t.execute(call('set_layout', { rows: 'x', cols: 1 }))).ok).toBe(false);
    expect((await t.execute(call('set_timeframe', { timeframe: '7m' }))).ok).toBe(false);
    expect((await t.execute(call('add_indicator', { indicator: 'rsi' }))).ok).toBe(false);
    expect((await t.execute(call('不存在的工具', {}))).ok).toBe(false);
    expect(ctl.log).toEqual([]);
  });

  it('大小写不敏感，并规范化后再交给图表', async () => {
    const ctl = fakeControls();
    const t = createChartTools(ctl);
    await t.execute(call('set_symbol', { symbol: ' nvda ' }));
    await t.execute(call('set_timeframe', { timeframe: '1H' }));
    expect(ctl.log).toEqual(['symbol:NVDA', 'tf:1h']);
  });

  it('数据不够长时如实说明已退化为 ALL', async () => {
    const r = await createChartTools(fakeControls()).execute(call('set_range', { range: '5Y' }));
    expect(r.ok).toBe(true);
    expect(r.content).toContain('ALL');
  });

  it('run_pine 失败时把引擎错误原样带回', async () => {
    const r = await createChartTools(fakeControls()).execute(call('run_pine', { code: 'bad' }));
    expect(r).toEqual({ ok: false, content: 'parse error' });
  });

  it('每个工具定义的 required 参数都在 properties 里', () => {
    for (const d of createChartTools(fakeControls()).definitions) {
      for (const k of d.parameters.required ?? []) expect(d.parameters.properties).toHaveProperty(k);
    }
  });
});

describe('runner · Agent 循环', () => {
  it('文本 → 工具调用 → 工具结果 → 总结，消息顺序正确', async () => {
    const ctl = fakeControls();
    const { sink, all } = collectSink();
    await runAgent({
      provider: createMockProvider({ delayMs: 0 }),
      history: [user('切到 NVDA 用 1h')],
      tools: createChartTools(ctl),
      sink,
    });
    expect(ctl.log).toEqual(['symbol:NVDA', 'tf:1h']);
    expect(all.map((m) => m.role)).toEqual(['assistant', 'tool', 'tool', 'assistant']);
    expect(all[0].toolCalls).toHaveLength(2);
    // 每条 tool 消息都能对上发起它的 call
    const ids = new Set(all[0].toolCalls!.map((c) => c.id));
    for (const m of all.filter((x) => x.role === 'tool')) expect(ids.has(m.toolCallId!)).toBe(true);
    expect(all[3].content).toContain('已完成');
  });

  it('工具失败会作为 isError 的 tool 消息回给模型，而不是吞掉', async () => {
    const { sink, all } = collectSink();
    await runAgent({
      provider: createMockProvider({ delayMs: 0 }),
      history: [user('布局 9x9')],
      tools: createChartTools(fakeControls()),
      sink,
    });
    const tool = all.find((m) => m.role === 'tool')!;
    expect(tool.isError).toBe(true);
  });

  it('没有可识别意图时只回文本，不调用工具', async () => {
    const ctl = fakeControls();
    const { sink, all } = collectSink();
    await runAgent({
      provider: createMockProvider({ delayMs: 0 }),
      history: [user('你好')],
      tools: createChartTools(ctl),
      sink,
    });
    expect(ctl.log).toEqual([]);
    expect(all).toHaveLength(1);
    expect(all[0].content.length).toBeGreaterThan(0);
  });

  it('provider 报错 → 错误写进 assistant 消息并停止，不再调用工具', async () => {
    const { sink, all } = collectSink();
    const failing: AgentProvider = {
      id: 'x',
      label: 'x',
      async *send(): AsyncGenerator<AgentEvent> {
        yield { type: 'text-delta', text: '开头' };
        yield { type: 'error', message: '炸了' };
        yield { type: 'tool-call', call: call('set_symbol', { symbol: 'TSLA' }) };
      },
    };
    const ctl = fakeControls();
    await runAgent({ provider: failing, history: [user('x')], tools: createChartTools(ctl), sink });
    expect(all).toHaveLength(1);
    expect(all[0].isError).toBe(true);
    expect(all[0].content).toContain('炸了');
    expect(ctl.log).toEqual([]);
  });

  it('模型一直要求调用工具时，maxSteps 兜底而不是死循环', async () => {
    const { sink, all } = collectSink();
    let n = 0;
    const looping: AgentProvider = {
      id: 'loop',
      label: 'loop',
      async *send(): AsyncGenerator<AgentEvent> {
        n++;
        yield { type: 'tool-call', call: { id: 'c' + n, name: 'set_symbol', arguments: { symbol: 'TSLA' } } };
      },
    };
    await runAgent({ provider: looping, history: [user('x')], tools: createChartTools(fakeControls()), sink, maxSteps: 3 });
    expect(n).toBe(3);
    expect(all[all.length - 1].isError).toBe(true);
    expect(all[all.length - 1].content).toContain('最大工具调用轮数');
  });

  it('abort 之后不再执行工具', async () => {
    const ctl = fakeControls();
    const { sink } = collectSink();
    const ac = new AbortController();
    const slow: AgentProvider = {
      id: 's',
      label: 's',
      async *send(): AsyncGenerator<AgentEvent> {
        yield { type: 'text-delta', text: 'a' };
        ac.abort();
        yield { type: 'tool-call', call: call('set_symbol', { symbol: 'TSLA' }) };
        yield { type: 'done' };
      },
    };
    await runAgent({ provider: slow, history: [user('x')], tools: createChartTools(ctl), sink, signal: ac.signal });
    expect(ctl.log).toEqual([]);
  });
});

describe('DeepSeek provider（空壳）', () => {
  it('未配置 baseUrl 时明确报错，而不是静默返回空', async () => {
    const p = createDeepSeekProvider({ baseUrl: '', model: 'deepseek-chat' });
    const evs: AgentEvent[] = [];
    for await (const e of p.send({ messages: [], tools: [] })) evs.push(e);
    expect(evs).toHaveLength(1);
    expect(evs[0].type).toBe('error');
  });
});
