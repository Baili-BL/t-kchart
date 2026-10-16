import type { ToolCall, ToolDefinition, ToolResult, ToolRuntime } from './types';

/**
 * Agent 能对图表做的操作。
 * 这里只依赖 `ChartControls` 接口，不碰 React / ChartGrid：
 *   - 真实实现见 workspace/chartControls.ts
 *   - 单测里用假实现（tests/agent.test.ts）
 */
export interface ChartControls {
  setSymbol(symbol: string): void;
  setTimeframe(timeframe: string): void;
  /** 返回 false 表示数据不够长，已退化为 ALL */
  setRange(range: string): boolean;
  setLayout(rows: number, cols: number): void;
  /** 切换主图样式，所有格一起变 */
  setChartStyle(style: ChartStyle): void;
  setIndicator(indicator: string, visible: boolean): void;
  /** 运行 Pine 脚本并画到活动图上；失败时返回错误文本 */
  runPine(code: string): { ok: boolean; message: string };
  knownSymbols(): string[];
  knownTimeframes(): string[];
  knownRanges(): string[];
}

/** 主图样式（与引擎 ChartStyle 同构；Agent 层不依赖引擎，故在此重复声明） */
export type ChartStyle = 'candles' | 'bars' | 'line' | 'area';
export const CHART_STYLE_KEYS: ChartStyle[] = ['candles', 'bars', 'line', 'area'];

export const CHART_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'set_symbol',
    description: '切换图表标的。',
    parameters: {
      type: 'object',
      properties: { symbol: { type: 'string', description: '代码，例如 TSLA' } },
      required: ['symbol'],
    },
  },
  {
    name: 'set_timeframe',
    description: '切换活动图的 K 线周期（每根 bar 代表多久）。',
    parameters: {
      type: 'object',
      properties: { timeframe: { type: 'string', description: '1m 5m 15m 30m 1h 4h 1D 1W 1M' } },
      required: ['timeframe'],
    },
  },
  {
    name: 'set_range',
    description: '设置显示范围（视口覆盖多长时间，不改变 K 线周期）。',
    parameters: {
      type: 'object',
      properties: { range: { type: 'string', description: '1D 7D 1M 3M 6M YTD 1Y 5Y ALL' } },
      required: ['range'],
    },
  },
  {
    name: 'set_layout',
    description: '设置多图网格布局，行列各 1–4。',
    parameters: {
      type: 'object',
      properties: { rows: { type: 'number' }, cols: { type: 'number' } },
      required: ['rows', 'cols'],
    },
  },
  {
    name: 'set_chart_style',
    description: '切换主图样式：candles K线 / bars 美国线 / line 收盘价折线 / area 面积图。',
    parameters: {
      type: 'object',
      properties: { style: { type: 'string', enum: CHART_STYLE_KEYS } },
      required: ['style'],
    },
  },
  {
    name: 'add_indicator',
    description: '显示或隐藏指标。目前支持 bb（布林带通道）。',
    parameters: {
      type: 'object',
      properties: {
        indicator: { type: 'string', enum: ['bb'] },
        visible: { type: 'boolean', description: '默认 true' },
      },
      required: ['indicator'],
    },
  },
  {
    name: 'run_pine',
    description: '在活动图上运行 Pine v5 子集脚本（仅支持引擎已实现的内置，见 README §12）。',
    parameters: {
      type: 'object',
      properties: { code: { type: 'string', description: '完整的 Pine 源码' } },
      required: ['code'],
    },
  },
];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

const fail = (content: string): ToolResult => ({ ok: false, content });
const ok = (content: string): ToolResult => ({ ok: true, content });

export function createChartTools(ctl: ChartControls): ToolRuntime {
  return {
    definitions: CHART_TOOL_DEFINITIONS,
    async execute(call: ToolCall): Promise<ToolResult> {
      const a = call.arguments;
      switch (call.name) {
        case 'set_symbol': {
          const s = str(a.symbol)?.toUpperCase();
          if (!s) return fail('缺少参数 symbol');
          if (!ctl.knownSymbols().includes(s)) return fail(`未知标的 ${s}，可选：${ctl.knownSymbols().join(', ')}`);
          ctl.setSymbol(s);
          return ok(`标的已切换为 ${s}`);
        }
        case 'set_timeframe': {
          const raw = str(a.timeframe);
          if (!raw) return fail('缺少参数 timeframe');
          const tf = ctl.knownTimeframes().find((t) => t.toLowerCase() === raw.toLowerCase());
          if (!tf) return fail(`未知周期 ${raw}，可选：${ctl.knownTimeframes().join(', ')}`);
          ctl.setTimeframe(tf);
          return ok(`周期已切换为 ${tf}`);
        }
        case 'set_range': {
          const raw = str(a.range)?.toUpperCase();
          if (!raw) return fail('缺少参数 range');
          if (!ctl.knownRanges().includes(raw)) return fail(`未知范围 ${raw}，可选：${ctl.knownRanges().join(', ')}`);
          const enough = ctl.setRange(raw);
          return ok(enough ? `显示范围已设为 ${raw}` : `数据不足 ${raw}，已退化为 ALL`);
        }
        case 'set_layout': {
          const r = num(a.rows);
          const c = num(a.cols);
          if (r == null || c == null) return fail('rows / cols 必须是数字');
          if (r < 1 || r > 4 || c < 1 || c > 4) return fail('rows / cols 取值范围 1–4');
          ctl.setLayout(Math.round(r), Math.round(c));
          return ok(`布局已设为 ${Math.round(r)}×${Math.round(c)}`);
        }
        case 'set_chart_style': {
          const raw = str(a.style)?.toLowerCase();
          if (!raw) return fail('缺少参数 style');
          const style = CHART_STYLE_KEYS.find((k) => k === raw);
          if (!style) return fail(`未知样式 ${raw}，可选：${CHART_STYLE_KEYS.join(', ')}`);
          ctl.setChartStyle(style);
          return ok(`主图样式已切换为 ${style}`);
        }
        case 'add_indicator': {
          const ind = str(a.indicator)?.toLowerCase();
          if (ind !== 'bb') return fail('目前只支持 indicator = "bb"');
          const visible = a.visible === undefined ? true : a.visible === true || a.visible === 'true';
          ctl.setIndicator('bb', visible);
          return ok(`布林带已${visible ? '显示' : '隐藏'}`);
        }
        case 'run_pine': {
          const code = str(a.code);
          if (!code) return fail('缺少参数 code');
          const r = ctl.runPine(code);
          return r.ok ? ok(r.message) : fail(r.message);
        }
        default:
          return fail(`未知工具 ${call.name}`);
      }
    },
  };
}
