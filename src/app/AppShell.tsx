import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Sidebar } from '../sidebar/Sidebar';
import { AgentPanel } from '../agent/AgentPanel';
import { ChartWorkspace } from '../workspace/ChartWorkspace';
import { Icon, BrandMark } from '../ui/icons';
import { Toaster } from '../ui/toast';
import { AGENT_MAX, AGENT_MIN, useAppStore } from '../store/appStore';
import { AlertsPage, ScreenerPage, StrategiesPage } from './pages';

/** Agent 与图表区之间的拖拽分隔条 */
function Resizer(): JSX.Element {
  const setW = useAppStore((s) => s.setAgentWidth);
  const startX = useRef(0);
  const startW = useRef(0);

  const onDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      startX.current = e.clientX;
      startW.current = useAppStore.getState().agentWidth;
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );
  const onMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      setW(startW.current + (e.clientX - startX.current));
    },
    [setW],
  );

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={AGENT_MIN}
      aria-valuemax={AGENT_MAX}
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onKeyDown={(e) => {
        const w = useAppStore.getState().agentWidth;
        if (e.key === 'ArrowLeft') setW(w - 16);
        if (e.key === 'ArrowRight') setW(w + 16);
      }}
    />
  );
}

function TabBar(): JSX.Element {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const toggleAgent = useAppStore((s) => s.toggleAgent);
  const user = useAppStore((s) => s.user);
  return (
    <div className="tabbar">
      <div className="tab active">
        <BrandMark size={13} />
        <span>Quant</span>
      </div>
      <span className="tabbar-spacer" />
      <button type="button" className="icon-btn" title="显示 / 隐藏 Agent" aria-label="切换 Agent 面板" onClick={toggleAgent}>
        <Icon name="chat" size={15} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title={theme === 'light' ? '切到深色' : '切到浅色'}
        aria-label="切换主题"
        onClick={toggleTheme}
      >
        <Icon name="moon" size={15} />
      </button>
      <button type="button" className="feedback-btn">
        <Icon name="feedback" size={13} />
        Feedback
      </button>
      <span className="avatar sm" title={user.name}>
        {user.name.slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}

export function AppShell(): JSX.Element {
  const nav = useAppStore((s) => s.nav);
  const agentWidth = useAppStore((s) => s.agentWidth);
  const agentCollapsed = useAppStore((s) => s.agentCollapsed);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);

  return (
    <div
      className="shell"
      style={{ gridTemplateColumns: `${collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)'} minmax(0, 1fr)` }}
    >
      <Sidebar />
      <main className="main">
        <TabBar />
        {nav === 'quant' ? (
          <div className="main-body">
            {!agentCollapsed && (
              <>
                <div className="agent-col" style={{ width: agentWidth }}>
                  <AgentPanel />
                </div>
                <Resizer />
              </>
            )}
            <div className="ws-col">
              <ChartWorkspace />
            </div>
          </div>
        ) : (
          <div className="main-body page-body">
            {nav === 'strategies' && <StrategiesPage />}
            {nav === 'alerts' && <AlertsPage />}
            {nav === 'screener' && <ScreenerPage />}
          </div>
        )}
      </main>
      <Toaster />
    </div>
  );
}
