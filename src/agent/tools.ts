import { LAYOUT_COUNTS, layoutsOfCount, uniformLayoutId } from '../engine/layouts';
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
  /** 均匀 rows × cols 网格（调用方已确认存在这种布局） */
  setLayout(rows: number, cols: number): void;
  /** 按布局目录 id 切换（如 `4-3`），调用方已确认 id 存在 */
  setLayoutId(id: string): void;
  /** 切换主图样式，所有格一起变 */
  setChartStyle(style: ChartStyle): void;
  /** 主图自带的布林带通道显示 / 隐藏 */
  setIndicator(indicator: string, visible: boolean): void;
  /** 按名称 / 缩写 / 中文关键词把内置指标（Pine v6 脚本）加到图上；找不到或不可用时 ok=false 并说明原因 */
  addStudy(query: string): { ok: boolean; message: string };
  /** 把图上这类指标全部移除 */
  removeStudy(query: string): { ok: boolean; message: string };
  /** 指标清单：可用的 + 不可用的（带原因）+ 图上已有的 */
  listStudies(): string;
  /** K 线回放控制；状态不对（比如没在回放就 play）时返回 ok=false 并说明原因 */
  replay(action: ReplayActionName, value?: number): { ok: boolean; message: string };
  /** 运行 Pine 脚本并画到活动图上；失败时返回错误文本 */
  runPine(code: string): { ok: boolean; message: string };
  knownSymbols(): string[];
  knownTimeframes(): string[];
  knownRanges(): string[];
}

/** 回放动作与速度（Agent 层不依赖引擎，故在此重复声明；与 engine/replay.ts 保持一致，tests 里有对照） */
export const REPLAY_ACTION_NAMES = ['start', 'stop', 'play', 'pause', 'step', 'back', 'speed'] as const;
export type ReplayActionName = (typeof REPLAY_ACTION_NAMES)[number];
export const REPLAY_SPEED_VALUES = [1, 2, 5, 10, 30];

/** 主图样式（与引擎 ChartStyle 同构；Agent 层不依赖引擎，故在此重复声明） */
export type ChartStyle =
  | 'candles' | 'bars' | 'hollow' | 'volcandles'
  | 'line' | 'linemarkers' | 'step'
  | 'area' | 'hlcarea' | 'baseline'
  | 'columns' | 'highlow'
  | 'heikin';
export const CHART_STYLE_KEYS: ChartStyle[] = [
  'candles', 'bars', 'hollow', 'volcandles',
  'line', 'linemarkers', 'step',
  'area', 'hlcarea', 'baseline',
  'columns', 'highlow',
  'heikin',
];

/** 菜单里有、但目前做不了的样式（key → 原因）。Agent 点名要这些时，把原因原样告诉用户，而不是悄悄换成别的 */
export const UNAVAILABLE_STYLES: Record<string, string> = {
  renko: '砖形图是按价格变动而不是按时间出 bar 的非时间序列图，会改变 bar 的数量与时间轴，指标 / 回放 / 联动都要跟着改，暂未实现',
  linebreak: '新价线（三线反转）是按价格变动出 bar 的非时间序列图，暂未实现',
  kagi: '卡吉图是按价格反转出线的非时间序列图，暂未实现',
  pnf: '点数图（圈叉图）是按价格变动出列的非时间序列图，暂未实现',
  range: '范围图需要根内逐笔数据才能准确切分，现有数据源只有 OHLC，暂未实现',
  footprint: '成交量轨迹需要逐笔 / 更小周期的买卖成交量，现有数据源只有 OHLC，暂不可用',
  tpo: '时间价格机会（TPO）需要日内更小周期数据，现有数据源只有 OHLC，暂不可用',
  sessionvp: '交易时段成交量分布图需要日内更小周期数据，现有数据源只有 OHLC，暂不可用',
};

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
    description:
      '设置多图布局。两种写法二选一：① rows + cols（均匀网格，各 1–4）；' +
      '② count + variant（按图数选，count ∈ 1–10、12、14、16；同图数有多种排法，variant 从 1 起，默认 1）。',
    parameters: {
      type: 'object',
      properties: {
        rows: { type: 'number' },
        cols: { type: 'number' },
        count: { type: 'number', description: '图的张数' },
        variant: { type: 'number', description: '同张数里的第几种排法（从 1 起）' },
      },
    },
  },
  {
    name: 'set_chart_style',
    description: '切换主图样式：candles K线 / bars 美国线 / hollow 空心K线 / volcandles 成交量蜡烛 / line 折线 / linemarkers 带标记线 / step 阶梯线 / area 面积 / hlcarea HLC 区域 / baseline 基准线 / columns 柱状图 / highlow 高-低 / heikin 平均K线。',
    parameters: {
      type: 'object',
      properties: { style: { type: 'string', enum: CHART_STYLE_KEYS } },
      required: ['style'],
    },
  },
  {
    name: 'replay',
    description:
      'K 线回放（Bar Replay）：start 进入（停在视口中间，只作用于活动图）/ stop 退出 / play 播放 / pause 暂停 / ' +
      'step 前进 value 根（默认 1）/ back 后退 value 根（默认 1）/ speed 设置每秒几根（value ∈ 1,2,5,10,30）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...REPLAY_ACTION_NAMES] },
        value: { type: 'number', description: 'step / back 的根数（1–500），或 speed 的每秒根数' },
      },
      required: ['action'],
    },
  },
  {
    name: 'add_indicator',
    description:
      '添加（或移除）指标。indicator 可以是英文全名 / 缩写 / 中文名，如 "MACD"、"RSI"、"Exponential moving average"、"布林带"。' +
      '特例：bb = 主图自带的布林带通道（visible 控制显示隐藏）。所有指标都是 Pine v6 脚本；visible=false 表示移除这类指标。' +
      '不知道有哪些时先调 list_indicators。',
    parameters: {
      type: 'object',
      properties: {
        indicator: { type: 'string', description: '指标名称或缩写' },
        visible: { type: 'boolean', description: '默认 true；false = 移除' },
      },
      required: ['indicator'],
    },
  },
  {
    name: 'remove_indicator',
    description: '把图上某类指标全部移除（按名称 / 缩写 / 中文名匹配）。',
    parameters: {
      type: 'object',
      properties: { indicator: { type: 'string' } },
      required: ['indicator'],
    },
  },
  {
    name: 'list_indicators',
    description: '列出内置指标清单（哪些可用、哪些不可用及原因）和图上已添加的指标。',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'run_pine',
    description: '在活动图上运行 Pine 脚本（v5 / v6 子集，仅支持引擎已实现的内置，见 README §12）。',
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
          const known = ctl.knownSymbols();
          if (!known.includes(s)) {
            const head = known.slice(0, 12).join(', ');
            return fail(`未知标的 ${s}，可选（共 ${known.length} 个，仅列前 12 个；也可让用户用顶栏的商品代码搜索）：${head}`);
          }
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
          if (a.count !== undefined) {
            const n = num(a.count);
            if (n == null || !Number.isInteger(n) || !LAYOUT_COUNTS.includes(n)) {
              return fail(`count 只能是 ${LAYOUT_COUNTS.join(' / ')} 之一`);
            }
            const list = layoutsOfCount(n);
            const v = a.variant === undefined ? 1 : num(a.variant);
            if (v == null || !Number.isInteger(v) || v < 1 || v > list.length) {
              return fail(`${n} 图共有 ${list.length} 种排法，variant 取 1–${list.length}`);
            }
            ctl.setLayoutId(list[v - 1].id);
            return ok(`布局已设为 ${n} 图第 ${v} 种（${list[v - 1].id}）`);
          }
          const r = num(a.rows);
          const c = num(a.cols);
          if (r == null || c == null) return fail('请提供 rows + cols，或 count（+ variant）');
          if (r < 1 || r > 4 || c < 1 || c > 4) return fail('rows / cols 取值范围 1–4');
          const rr = Math.round(r);
          const cc = Math.round(c);
          if (!uniformLayoutId(rr, cc)) return fail(`没有 ${rr}×${cc} 的均匀布局；可改用 count（+ variant）选非均匀排法`);
          ctl.setLayout(rr, cc);
          return ok(`布局已设为 ${rr}×${cc}`);
        }
        case 'set_chart_style': {
          const raw = str(a.style)?.toLowerCase();
          if (!raw) return fail('缺少参数 style');
          const style = CHART_STYLE_KEYS.find((k) => k === raw);
          if (!style && UNAVAILABLE_STYLES[raw]) return fail(`样式 ${raw} 暂不可用：${UNAVAILABLE_STYLES[raw]}`);
          if (!style) return fail(`未知样式 ${raw}，可选：${CHART_STYLE_KEYS.join(', ')}`);
          ctl.setChartStyle(style);
          return ok(`主图样式已切换为 ${style}`);
        }
        case 'replay': {
          const action = REPLAY_ACTION_NAMES.find((k) => k === str(a.action)?.toLowerCase());
          if (!action) return fail(`未知回放动作 ${String(a.action)}，可选：${REPLAY_ACTION_NAMES.join(', ')}`);
          const value = a.value === undefined ? undefined : num(a.value);
          if (a.value !== undefined && value === null) return fail('value 必须是数字');
          if (action === 'speed') {
            if (value == null || !REPLAY_SPEED_VALUES.includes(value)) {
              return fail(`speed 的 value 必须是 ${REPLAY_SPEED_VALUES.join(' / ')} 之一（每秒几根）`);
            }
          }
          if ((action === 'step' || action === 'back') && value != null && (value < 1 || value > 500)) {
            return fail('step / back 的 value 取值范围 1–500');
          }
          const r = ctl.replay(action, value ?? undefined);
          return r.ok ? ok(r.message) : fail(r.message);
        }
        case 'add_indicator': {
          const raw = str(a.indicator);
          if (!raw) return fail('缺少参数 indicator');
          const visible = a.visible === undefined ? true : a.visible === true || a.visible === 'true';
          if (raw.toLowerCase() === 'bb') {
            ctl.setIndicator('bb', visible);
            return ok(`布林带已${visible ? '显示' : '隐藏'}`);
          }
          const r = visible ? ctl.addStudy(raw) : ctl.removeStudy(raw);
          return r.ok ? ok(r.message) : fail(r.message);
        }
        case 'remove_indicator': {
          const raw = str(a.indicator);
          if (!raw) return fail('缺少参数 indicator');
          if (raw.toLowerCase() === 'bb') {
            ctl.setIndicator('bb', false);
            return ok('布林带已隐藏');
          }
          const r = ctl.removeStudy(raw);
          return r.ok ? ok(r.message) : fail(r.message);
        }
        case 'list_indicators':
          return ok(ctl.listStudies());
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
