import { useEffect, useRef } from 'react';
import { ChartGrid } from '../engine/grid';
import type { KChart } from '../engine/chart';
import { DrawLayer } from '../engine/draw';
import { mockDataSource } from '../data/mockBars';
import { useChartStore } from '../store/chartStore';
import { useAppStore } from '../store/appStore';
import { registerGrid } from './gridRegistry';
import { drawBus } from './drawBus';
import { replayController, useReplayStore } from '../store/replayStore';
import type { ReplayState } from '../engine/replay';

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
      rows: st0.layout.rows,
      cols: st0.layout.cols,
      theme: useAppStore.getState().theme,
      timeframe: st0.timeframe,
      symbols: [st0.symbol],
      dataSource: mockDataSource,
      sync: st0.sync,
      chartOptions: CHART_COLORS,
      legendInset: 8,
    });
    registerGrid(grid);

    /* ---------- 绘图层：每格一个，按需创建 ---------- */
    const layers = new Map<KChart, DrawLayer>();
    let keyed: DrawLayer | null = null;

    const ensureLayers = (): void => {
      const live = new Set(grid.charts());
      for (const [c, l] of layers) {
        if (!live.has(c)) {
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
          onDraw: (ctx: CanvasRenderingContext2D) => layer.render(ctx),
        });
        layer.setTool(drawBus.tool);
        layer.setMagnet(drawBus.magnet);
        layer.setHidden(drawBus.hidden);
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
        if (ev.type === 'tool') l.setTool(ev.tool);
        else if (ev.type === 'magnet') l.setMagnet(ev.on);
        else if (ev.type === 'hidden') l.setHidden(ev.on);
        else if (ev.type === 'clear') l.clear();
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
        (s.symbol !== prev.symbol || s.timeframe !== prev.timeframe || s.layout !== prev.layout)
      ) {
        replayController.stop();
      }
      if (s.sync !== prev.sync) {
        (Object.keys(s.sync) as (keyof typeof s.sync)[]).forEach((k) => {
          if (s.sync[k] !== prev.sync[k]) grid.setSync(k, s.sync[k]);
        });
      }
      if (s.layout !== prev.layout) {
        const oldTotal = grid.layoutInfo().total;
        grid.setLayout(s.layout.rows, s.layout.cols);
        const total = grid.layoutInfo().total;
        if (!s.sync.interval) for (let i = oldTotal; i < total; i++) grid.setTileTimeframe(i, SECONDARY_TF);
        applyBb();
        ensureLayers();
        refreshLast();
      }
      if (s.symbol !== prev.symbol) {
        grid.setSymbol(s.symbol);
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

    return () => {
      replayController.stop();
      unReplay();
      unsub();
      unTheme();
      unbindDraw();
      grid.el.removeEventListener('activechange', onActive);
      for (const l of layers.values()) l.dispose();
      layers.clear();
      registerGrid(null);
      grid.dispose();
    };
  }, []);

  return <div ref={hostRef} className="chart-grid" />;
}
