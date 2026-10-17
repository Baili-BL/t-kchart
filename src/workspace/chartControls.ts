import type { ChartControls } from '../agent/tools';
import { RANGES } from '../engine/chart';
import { PineEngine } from '../engine/pine';
import { SYMBOL_CATALOG } from '../data/symbols';
import { TIMEFRAMES, useChartStore } from '../store/chartStore';
import { getGrid } from './gridRegistry';
import { replayControl } from './replayActions';
import { useStudyStore } from '../store/studyStore';
import { INDICATORS, findIndicator } from '../indicators';

/**
 * ChartControls 的真实实现：
 *   - 标的 / 周期 / 布局 / 指标 → 写 store，ChartGridView 订阅 store 去驱动 ChartGrid（单一数据源）
 *   - 显示范围 / Pine → 需要立即拿到结果，直接操作 ChartGrid
 */
export const chartControls: ChartControls = {
  setSymbol: (s) => useChartStore.getState().setSymbol(s),
  setTimeframe: (tf) => useChartStore.getState().setTimeframe(tf),
  setLayout: (rows, cols) => void useChartStore.getState().setLayout(rows, cols),
  setLayoutId: (id) => void useChartStore.getState().setLayoutId(id),
  setChartStyle: (style) => useChartStore.getState().setChartStyle(style),
  replay: (action, value) => replayControl(action, value),
  setIndicator: (indicator, visible) => {
    if (indicator === 'bb') useChartStore.getState().setBb(visible);
  },
  addStudy(query) {
    const hit = findIndicator(query);
    if (!hit) return { ok: false, message: `没有找到指标「${query}」。先用 list_indicators 看看有哪些。` };
    return useStudyStore.getState().addIndicator(hit.id);
  },
  removeStudy(query) {
    const hit = findIndicator(query);
    if (!hit) return { ok: false, message: `没有找到指标「${query}」` };
    const n = useStudyStore.getState().removeByQuery(hit.id);
    return n > 0 ? { ok: true, message: `已移除 ${n} 个「${hit.name}」` } : { ok: false, message: `图上没有「${hit.name}」` };
  },
  listStudies() {
    const on = useStudyStore.getState().studies.map((s) => s.name);
    const usable = INDICATORS.filter((d) => d.source).map((d) => `${d.name}(${d.short})`);
    const off = INDICATORS.filter((d) => !d.source).map((d) => `${d.name}：${d.unsupported}`);
    return `图上已有：${on.length ? on.join('、') : '无'}\n可用（Pine v6）：${usable.join('、')}\n不可用：\n- ${off.join('\n- ')}`;
  },

  setRange(range) {
    const g = getGrid();
    return g ? g.setRange(range) : false;
  },

  runPine(code) {
    const g = getGrid();
    if (!g) return { ok: false, message: '图表尚未就绪' };
    const chart = g.charts()[g.activeIndex()];
    if (!chart) return { ok: false, message: '没有活动图' };
    // 解析错误、未实现的语法、策略的保证金不足等都是抛出来的，必须带回给调用方（Agent 要看见才能自我修正）
    try {
      const eng = new PineEngine(code, chart.bars);
      eng.run();
      eng.applyTo(chart);
      const r = eng.strategyResult();
      const strat = r
        ? `；策略回测：${r.tradeCount} 笔，净利 ${r.netProfit.toFixed(2)}，最大回撤 ${r.maxDrawdown.toFixed(2)}，胜率 ${(r.winRate * 100).toFixed(1)}%`
        : '';
      return { ok: true, message: `Pine 已运行：${eng.plots.length} 条线，${eng.marks.length} 个标记${strat}` };
    } catch (e) {
      return { ok: false, message: 'Pine 运行失败：' + (e instanceof Error ? e.message : String(e)) };
    }
  },

  knownSymbols: () => SYMBOL_CATALOG.map((s) => s.ticker),
  knownTimeframes: () => TIMEFRAMES.map((t) => t.code),
  knownRanges: () => RANGES.map((r) => r.key),
};
