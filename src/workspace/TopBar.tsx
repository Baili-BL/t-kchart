import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/toast';
import { createToolbarHandle } from './dom/toolbar';
import type { ToolbarHandle } from './dom/toolbar';
import { STYLE_LABELS, styleFromLabel, useChartStore } from '../store/chartStore';
import { LAYOUT_COUNTS, layoutsOfCount } from '../engine/layouts';
import { LayoutIcon } from '../ui/LayoutIcon';
import type { SyncState } from '../store/chartStore';
import { drawBus } from './drawBus';
import { replayController } from '../store/replayStore';
import { useSymbolSearchStore } from '../store/symbolSearchStore';
import { useCompareDialogStore } from '../store/compareDialogStore';
import { useAlertDialogStore } from '../store/alertDialogStore';
import { useSettingsDialogStore } from '../store/settingsDialogStore';
import { useStudyStore } from '../store/studyStore';
import { useChartSettingsStore } from '../store/chartSettingsStore';
import { toggleReplay } from './replayActions';

const SYNC_LABELS: { key: keyof SyncState; label: string }[] = [
  { key: 'symbol', label: '商品代码' },
  { key: 'interval', label: '周期' },
  { key: 'crosshair', label: '十字线' },
  { key: 'time', label: '时间' },
  { key: 'range', label: '日期范围' },
];

function LayoutMenu({ close }: { close: () => void }): JSX.Element {
  const layoutId = useChartStore((s) => s.layoutId);
  const setLayoutId = useChartStore((s) => s.setLayoutId);
  const sync = useChartStore((s) => s.sync);
  const setSync = useChartStore((s) => s.setSync);
  return (
    <div className="layout-menu">
      <div className="layout-rows">
        {LAYOUT_COUNTS.map((n) => (
          <div className="layout-row" key={n}>
            <span className="layout-n">{n}</span>
            <div className="layout-opts">
              {layoutsOfCount(n).map((l) => {
                const sel = l.id === layoutId;
                return (
                  <button
                    type="button"
                    key={l.id}
                    className={'layout-opt' + (sel ? ' sel' : '')}
                    aria-label={`布局 ${l.id}`}
                    aria-pressed={sel}
                    title={`${n} 图 · 第 ${l.variant} 种`}
                    onClick={() => {
                      setLayoutId(l.id);
                      close();
                    }}
                  >
                    <LayoutIcon def={l} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="menu-title">同步到所有图表</div>
      <div className="sync-list">
        {SYNC_LABELS.map(({ key, label }) => (
          <button
            type="button"
            key={key}
            className={'switch-row' + (sync[key] ? ' on' : '')}
            role="switch"
            aria-checked={sync[key]}
            onClick={() => setSync(key, !sync[key])}
          >
            <span>{label}</span>
            <span className="switch" />
          </button>
        ))}
      </div>
    </div>
  );
}

function LayoutNameMenu({ close }: { close: () => void }): JSX.Element {
  const name = useChartStore((s) => s.layoutName);
  const setName = useChartStore((s) => s.setLayoutName);
  const [v, setV] = useState(name);
  const commit = (): void => {
    const t = v.trim();
    if (t) setName(t);
    close();
  };
  return (
    <div className="rename">
      <div className="menu-title">布局名称</div>
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-label="布局名称"
      />
      <button type="button" className="btn primary" onClick={commit}>
        保存
      </button>
    </div>
  );
}

type FloatKind = 'layout' | 'rename';

/** 工具栏下方的浮层：点外部 / Esc 关闭。位置由 CSS 类决定。 */
function Float({ kind, onClose, children }: { kind: FloatKind; onClose: () => void; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // 用 setTimeout 跳过「打开它的那一次点击」
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={'tb-float ' + kind}>
      {children}
    </div>
  );
}

/**
 * 顶栏：视觉与交互沿用 dom/toolbar.ts（设计稿 1:1 还原）。
 * 工具栏只是呈现层——状态都在 chartStore，这里订阅 store 把值推给它，
 * 它的按钮事件再写回 store（与 Agent 工具走同一条路径）。
 */
export function TopBar(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const tbRef = useRef<ToolbarHandle | null>(null);
  const [float, setFloat] = useState<FloatKind | null>(null);
  const toast = useToast((s) => s.show);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const st = (): ReturnType<typeof useChartStore.getState> => useChartStore.getState();
    const tb = createToolbarHandle(host, {
      onSymbol: () => useSymbolSearchStore.getState().openSearch(),
      onQuickSearch: () => useSymbolSearchStore.getState().openSearch(),
      onCompare: () => useCompareDialogStore.getState().openDialog(),
      onDataType: () => toast('数据类型切换尚未实现（当前为演示数据）'),
      onInterval: (_label, code) => st().setTimeframe(code),
      onStyle: (label, unavailable) => {
        if (unavailable) {
          toast(`「${label}」暂不可用：${unavailable}`);
          return;
        }
        const style = styleFromLabel(label);
        if (style) st().setChartStyle(style);
      },
      onIndicators: () => useStudyStore.getState().openDialog(),
      onAlert: () => useAlertDialogStore.getState().openDialog(),
      onReplay: () => {
        const r = toggleReplay();
        if (!r.ok) toast(r.message);
        tbRef.current?.setReplayOn(replayController.state().active);
      },
      onUndo: () => drawBus.undo(),
      onRedo: () => drawBus.redo(),
      onLayout: () => setFloat('layout'),
      onSave: () => toast('布局存档尚未实现（TODO 2.9）'),
      onManageLayouts: () => setFloat('rename'),
      onSettings: () => useSettingsDialogStore.getState().openDialog(),
      onSnapshot: () => toast('快照尚未实现'),
    });
    tbRef.current = tb;
    tb.setUndoRedo(true, true);
    // 顶栏「交易」开关：交易面板默认隐藏，点这里才出现（dom/toolbar.ts 是设计稿原 DOM 不动，
    // 按钮由接线层在运行时挂到其根节点，复用 kc-tb-btn 的视觉与深色反相）
    const tradeBtn = document.createElement('button');
    tradeBtn.type = 'button';
    tradeBtn.id = 'header-toolbar-trading';
    tradeBtn.className = 'kc-tb-btn kc-tb-trade';
    tradeBtn.title = '交易面板';
    tradeBtn.innerHTML = '<span>交易</span>';
    tradeBtn.addEventListener('click', () => {
      const s = useChartSettingsStore.getState();
      s.set({ buySell: !s.settings.buySell });
    });
    const syncTrade = (s: { settings: { buySell: boolean } }): void => {
      tradeBtn.classList.toggle('kc-on', s.settings.buySell);
      tradeBtn.setAttribute('aria-pressed', String(s.settings.buySell));
    };
    syncTrade(useChartSettingsStore.getState());
    const unTrade = useChartSettingsStore.subscribe(syncTrade);
    tb.root.appendChild(tradeBtn);
    const push = (s: ReturnType<typeof useChartStore.getState>): void => {
      tb.setSymbol(s.symbol);
      tb.setInterval(s.timeframe);
      tb.setLayoutName(s.layoutName);
      tb.setIndicatorsOn(s.bbVisible || useStudyStore.getState().studies.length > 0);
      tb.setStyle(STYLE_LABELS[s.chartStyle]);
    };
    push(st());
    const unsub = useChartStore.subscribe(push);
    const unStudy = useStudyStore.subscribe(() => push(st()));
    // 回放被别处结束（换标的、切格、控制条「退出」、Agent）时，顶栏按钮要跟着弹起
    tb.setReplayOn(replayController.state().active);
    const unReplay = replayController.subscribe((r) => tb.setReplayOn(r.active));
    return () => {
      unReplay();
      unsub();
      unStudy();
      unTrade();
      tbRef.current = null;
      tb.root.remove();
    };
  }, [toast]);

  const close = (): void => setFloat(null);
  return (
    <div className="topbar-host">
      <div ref={hostRef} className="topbar" />
      {float && (
        <Float kind={float} onClose={close}>
          {float === 'layout' && <LayoutMenu close={close} />}
          {float === 'rename' && <LayoutNameMenu close={close} />}
        </Float>
      )}
    </div>
  );
}
