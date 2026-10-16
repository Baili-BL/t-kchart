import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../ui/icons';
import { useToast } from '../ui/toast';
import { createToolbarHandle } from './dom/toolbar';
import type { ToolbarHandle } from './dom/toolbar';
import { LAYOUT_PRESETS, STYLE_LABELS, styleFromLabel, useChartStore } from '../store/chartStore';
import type { SyncState } from '../store/chartStore';
import { MOCK_SYMBOLS } from '../data/mockBars';
import { drawBus } from './drawBus';
import { replayController } from '../store/replayStore';
import { toggleReplay } from './replayActions';

const SYNC_LABELS: { key: keyof SyncState; label: string }[] = [
  { key: 'symbol', label: '标的' },
  { key: 'interval', label: '周期' },
  { key: 'crosshair', label: '十字光标' },
  { key: 'range', label: '时间范围' },
];

function SymbolPicker({ close }: { close: () => void }): JSX.Element {
  const [q, setQ] = useState('');
  const symbol = useChartStore((s) => s.symbol);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const list = MOCK_SYMBOLS.filter(
    (s) => s.ticker.includes(q.trim().toUpperCase()) || s.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="symbol-picker">
      <div className="symbol-search">
        <Icon name="search" size={14} />
        <input autoFocus value={q} placeholder="搜索标的" onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="menu">
        {list.map((s) => (
          <li key={s.ticker}>
            <button
              type="button"
              className={s.ticker === symbol ? 'sel' : ''}
              onClick={() => {
                setSymbol(s.ticker);
                close();
              }}
            >
              <b>{s.ticker}</b>
              <span className="menu-sub">{s.name}</span>
              <span className="menu-tag">{s.exchange}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="menu-empty">没有匹配的标的</li>}
      </ul>
    </div>
  );
}

function LayoutMenu({ close }: { close: () => void }): JSX.Element {
  const layout = useChartStore((s) => s.layout);
  const setLayout = useChartStore((s) => s.setLayout);
  const sync = useChartStore((s) => s.sync);
  const setSync = useChartStore((s) => s.setSync);
  return (
    <div className="layout-menu">
      <div className="menu-title">布局</div>
      <ul className="menu">
        {LAYOUT_PRESETS.map((p) => {
          const sel = p.rows === layout.rows && p.cols === layout.cols;
          return (
            <li key={p.key}>
              <button
                type="button"
                className={sel ? 'sel' : ''}
                onClick={() => {
                  setLayout(p.rows, p.cols);
                  close();
                }}
              >
                <span className="menu-check">{sel && <Icon name="check" size={13} />}</span>
                {p.label}
                <span className="menu-tag">{p.key}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="menu-title">联动</div>
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

type FloatKind = 'symbol' | 'layout' | 'rename';

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
      onSymbol: () => setFloat('symbol'),
      onQuickSearch: () => setFloat('symbol'),
      onCompare: () => toast('比较商品尚未实现'),
      onDataType: () => toast('数据类型切换尚未实现（当前为演示数据）'),
      onInterval: (_label, code) => st().setTimeframe(code),
      onStyle: (label) => {
        const style = styleFromLabel(label);
        if (style) st().setChartStyle(style);
      },
      onIndicators: () => {
        const on = !st().bbVisible;
        st().setBb(on);
        toast(on ? '已开启布林带（BB 20 SMA close 2）' : '已关闭布林带');
      },
      onAlert: () => {
        toast('警报尚未实现');
        tbRef.current?.setAlertOn(false);
      },
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
      onSettings: () => toast('设置尚未实现'),
      onSnapshot: () => toast('快照尚未实现'),
    });
    tbRef.current = tb;
    tb.setUndoRedo(true, true);
    const push = (s: ReturnType<typeof useChartStore.getState>): void => {
      tb.setSymbol(s.symbol);
      tb.setInterval(s.timeframe);
      tb.setLayoutName(s.layoutName);
      tb.setIndicatorsOn(s.bbVisible);
      tb.setStyle(STYLE_LABELS[s.chartStyle]);
    };
    push(st());
    const unsub = useChartStore.subscribe(push);
    // 回放被别处结束（换标的、切格、控制条「退出」、Agent）时，顶栏按钮要跟着弹起
    tb.setReplayOn(replayController.state().active);
    const unReplay = replayController.subscribe((r) => tb.setReplayOn(r.active));
    return () => {
      unReplay();
      unsub();
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
          {float === 'symbol' && <SymbolPicker close={close} />}
          {float === 'layout' && <LayoutMenu close={close} />}
          {float === 'rename' && <LayoutNameMenu close={close} />}
        </Float>
      )}
    </div>
  );
}
