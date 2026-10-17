import { useEffect, useRef } from 'react';
import { ChartGrid } from '../engine/grid';
import type { KChart } from '../engine/chart';
import { DrawLayer } from '../engine/draw';
import { mockDataSource } from '../data/mockBars';
import { useChartStore } from '../store/chartStore';
import { useStudyStore } from '../store/studyStore';
import { useAppStore } from '../store/appStore';
import { registerGrid } from './gridRegistry';
import { drawBus } from './drawBus';
import { createDrawPropsBar } from './dom/DrawPropsBar';
import { registerDrawLayer, unregisterDrawLayer } from '../dev/drawRegistry';
import { replayController, useReplayStore } from '../store/replayStore';
import type { ReplayState } from '../engine/replay';
import { SYMBOL_BY_TICKER } from '../data/symbols';
import { applyTo, useChartSettingsStore } from '../store/chartSettingsStore';
import { useToast } from '../ui/toast';

/** 美股习惯：涨绿跌红（引擎默认是 A 股的涨红跌绿） */
const CHART_COLORS = { upColor: '#089981', downColor: '#f23645' };
/** 多周期布局里，非活动格默认看日线 */
const SECONDARY_TF = '1D';

/**
 * ChartGrid 的 React 外壳。
 * 约定：store 是单一数据源，这里订阅 store 去驱动引擎；引擎的事件再回写 store。
 */
export function ChartGridView(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const st0 = useChartStore.getState();
    const grid = new ChartGrid(host, {
      layoutId: st0.layoutId,
      theme: useAppStore.getState().theme,
      timeframe: st0.timeframe,
      symbols: [st0.symbol],
      dataSource: mockDataSource,
      sync: st0.sync,
      chartOptions: CHART_COLORS,
      legendInset: 8,
      symbolNameFor: (t) => SYMBOL_BY_TICKER.get(t)?.name ?? '',
    });
    registerGrid(grid);

    /* ---------- 设置：建格后立即应用一次；之后每次变更都广播到所有格 ---------- */
    applyTo(grid);
    const unSettings = useChartSettingsStore.subscribe(() => applyTo(grid));

    /* ---------- 指标：store 里是定义，每一格自己运行 ---------- */
    grid.setStudyHandler((uid, action) => {
      const ss = useStudyStore.getState();
      if (action === 'remove') ss.removeStudy(uid);
      else if (!ss.edit(uid)) useToast.getState().show('指标已锁定：先在左栏「锁定指标」解锁');
    });
    grid.setStudies(useStudyStore.getState().studies);
    const unStudies = useStudyStore.subscribe((s, prev) => {
      if (s.studies !== prev.studies) grid.setStudies(s.studies);
    });

    /* ---------- 绘图层：每格一个，按需创建 ---------- */
    const layers = new Map<KChart, DrawLayer>();
    let keyed: DrawLayer | null = null;

    /* 浮动绘图属性工具条：跟随「最近有选中图形」的那一层；
       onDraw 每帧 sync 一次，拖动 / 平移缩放时工具条都贴着图形走 */
    let barLayer: DrawLayer | null = null;
    const propsBar = createDrawPropsBar(() => barLayer);

    const ensureLayers = (): void => {
      const live = new Set(grid.charts());
      for (const [c, l] of layers) {
        if (!live.has(c)) {
          if (l === barLayer) { barLayer = null; propsBar.hide(); }
          if (import.meta.env.DEV) unregisterDrawLayer(l);
          l.dispose();
          layers.delete(c);
        }
      }
      for (const c of live) {
        if (layers.has(c)) continue;
        const layer = new DrawLayer(c);
        c.setHooks({
          onDown: (px: number, py: number) => layer.onDown(px, py),
          onMove: (px: number, py: number) => layer.onMove(px, py),
          onUp: () => layer.onUp(),
          onDraw: (ctx: CanvasRenderingContext2D) => {
            layer.render(ctx);
            if (layer.active()) barLayer = layer;
            if (barLayer === layer) propsBar.sync();
          },
        });
        layer.setTool(drawBus.tool);
        layer.setMagnet(drawBus.magnet);
        layer.setHidden(drawBus.hidden);
        if (drawBus.lockAll) layer.setAllLocked(true);
        layer.repeatDraw = drawBus.repeatDraw;
        c.longPressTip = drawBus.longPressTip;
        if (import.meta.env.DEV) registerDrawLayer(layer);
        layers.set(c, layer);
      }
      // 键盘只给活动格的绘图层，避免 Ctrl+Z 同时撤销好几张图
      const active = layers.get(grid.charts()[grid.activeIndex()]) ?? null;
      if (active !== keyed) {
        keyed?.dispose();
        keyed = active;
        keyed?.attachKeys(window);
      }
    };

    const unbindDraw = drawBus.subscribe((ev) => {
      // 撤销 / 重做只作用于活动格
      if (ev.type === 'undo') return void keyed?.undo();
      if (ev.type === 'redo') return void keyed?.redo();
      for (const l of layers.values()) {
        if (ev.type === 'tool') {
          l.setTool(ev.tool);
          if (ev.char) l.emojiChar = ev.char;
        }
        else if (ev.type === 'magnet') l.setMagnet(ev.on);
        else if (ev.type === 'hidden') l.setHidden(ev.on);
        else if (ev.type === 'lock') l.setAllLocked(ev.on);
        else if (ev.type === 'repeat') l.repeatDraw = ev.on;
        else if (ev.type === 'clear') l.clear();
      }
      if (ev.type === 'longPressTip') {
        for (const c of layers.keys()) c.longPressTip = ev.on;
      }
    });

    /* ---------- 引擎 → store ---------- */
    const refreshLast = (): void => {
      const c = grid.charts()[grid.activeIndex()];
      const b = c && c.bars.length ? c.bars[c.bars.length - 1] : null;
      useChartStore.getState().setLastPrice(b ? b.close : null);
    };
    /* ---------- 回放：controller → 被回放那一格的 setReplayCount ---------- */
    let replayTile = -1;
    const applyReplay = (s: ReplayState): void => {
      if (s.active) {
        replayTile = useReplayStore.getState().tile;
        grid.charts()[replayTile]?.setReplayCount(s.index + 1);
      } else if (replayTile >= 0) {
        grid.charts()[replayTile]?.setReplayCount(null);
        replayTile = -1;
      }
      refreshLast();
    };
    const unReplay = replayController.subscribe(applyReplay);

    const onActive = (): void => {
      // 回放只属于开始时的那一格；切到别的格 = 退出回放
      if (replayController.state().active && grid.activeIndex() !== replayTile) replayController.stop();
      const cs = useChartStore.getState();
      cs.setActiveTile(grid.activeIndex());
      cs.setTimeframe(grid.activeTimeframe());
      ensureLayers();
      refreshLast();
    };
    grid.el.addEventListener('activechange', onActive);

    const applyBb = (): void => {
      const on = useChartStore.getState().bbVisible;
      grid.eachTile((c) => c.setChannelVisible('bb', on));
    };

    // 初始：活动格（0）用 store 周期，其余格看日线
    if (!st0.sync.interval) {
      for (let i = 1; i < grid.layoutInfo().total; i++) grid.setTileTimeframe(i, SECONDARY_TF);
    }
    applyBb();
    grid.setChartStyle(st0.chartStyle);
    ensureLayers();
    onActive();

    /* ---------- store → 引擎 ---------- */
    const unsub = useChartStore.subscribe((s, prev) => {
      // 换标的 / 周期 / 布局会换掉数据：旧的回放位置没有意义，**先退出再动图表**
      if (
        replayController.state().active &&
        (s.symbol !== prev.symbol || s.timeframe !== prev.timeframe || s.layoutId !== prev.layoutId)
      ) {
        replayController.stop();
      }
      if (s.sync !== prev.sync) {
        (Object.keys(s.sync) as (keyof typeof s.sync)[]).forEach((k) => {
          if (s.sync[k] !== prev.sync[k]) grid.setSync(k, s.sync[k]);
        });
      }
      if (s.layoutId !== prev.layoutId) {
        const oldTotal = grid.layoutInfo().total;
        grid.setLayoutId(s.layoutId);
        const total = grid.layoutInfo().total;
        if (!s.sync.interval) for (let i = oldTotal; i < total; i++) grid.setTileTimeframe(i, SECONDARY_TF);
        applyBb();
        ensureLayers();
        applyTo(grid); // 新格子的外观也要跟上（布局变化会新建 tile）
        refreshLast();
      }
      if (s.symbol !== prev.symbol) {
        grid.setSymbol(s.symbol);
        applyTo(grid); // 图例「名称」跟着标的换
        refreshLast();
      }
      if (s.timeframe !== prev.timeframe && s.timeframe !== grid.activeTimeframe()) {
        grid.setTimeframe(s.timeframe);
        refreshLast();
      }
      if (s.bbVisible !== prev.bbVisible) applyBb();
      if (s.chartStyle !== prev.chartStyle) grid.setChartStyle(s.chartStyle);
    });

    const unTheme = useAppStore.subscribe((s, prev) => {
      if (s.theme !== prev.theme) grid.setTheme(s.theme);
    });

    /* ---------- 模拟实时报价：轻推活动格最后一根 bar（chart.update 是引擎的实时入口）。
       演示数据没有真实行情源，警报触发 / PaperTrade / 图例最新价靠它活起来。 ---------- */
    const tickTimer = window.setInterval(() => {
      if (document.hidden) return;
      const c = grid.charts()[grid.activeIndex()];
      const last = c && c.bars.length ? c.bars[c.bars.length - 1] : null;
      if (!last) return;
      const close = last.close * (1 + (Math.random() - 0.5) * 0.0012);
      c.update({
        ...last,
        close,
        high: Math.max(last.high, close),
        low: Math.min(last.low, close),
        volume: last.volume + Math.round(Math.random() * last.volume * 0.002),
      });
      refreshLast();
    }, 2000);

    return () => {
      window.clearInterval(tickTimer);
      replayController.stop();
      unReplay();
      unsub();
      unStudies();
      unTheme();
      unSettings();
      unbindDraw();
      propsBar.dispose();
      grid.el.removeEventListener('activechange', onActive);
      for (const l of layers.values()) l.dispose();
      layers.clear();
      registerGrid(null);
      grid.dispose();
    };
  }, []);

  return <div ref={hostRef} className="chart-grid" />;
}
