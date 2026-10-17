import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AgentPanel } from '../agent/AgentPanel';
import { ChartWorkspace } from '../workspace/ChartWorkspace';
import { Toaster } from '../ui/toast';
import { AGENT_MAX, AGENT_MIN, useAppStore } from '../store/appStore';

/** 图表区与右侧 Agent 面板之间的拖拽分隔条（面板在右，往左拖 = 变宽） */
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
      setW(startW.current - (e.clientX - startX.current));
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
        if (e.key === 'ArrowLeft') setW(w + 16);
        if (e.key === 'ArrowRight') setW(w - 16);
      }}
    />
  );
}

/**
 * 应用外壳：图表区 + 右侧 Agent 面板（无顶栏、无左侧导航栏）。
 * 原顶栏（Quant 品牌 / 主题切换 / Feedback / 头像）与原侧栏入口全部并入右侧 Agent 面板；
 * 面板收起时可通过图表区右缘的 AI Copilot 按钮重新展开。
 */
export function AppShell(): JSX.Element {
  const agentWidth = useAppStore((s) => s.agentWidth);
  const agentCollapsed = useAppStore((s) => s.agentCollapsed);

  return (
    <div className="shell">
      <main className="main">
        <div className="main-body">
          <div className="ws-col">
            <ChartWorkspace />
          </div>
          {!agentCollapsed && (
            <>
              <Resizer />
              <div className="agent-col" style={{ width: agentWidth }}>
                <AgentPanel />
              </div>
            </>
          )}
        </div>
      </main>
      <Toaster />
    </div>
  );
}
