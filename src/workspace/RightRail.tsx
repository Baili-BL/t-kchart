import { useEffect, useRef } from 'react';
import { createRightbarHandle } from './dom/rightbar';
import type { RightbarHandle } from './dom/rightbar';
import { useAppStore } from '../store/appStore';
import { useToast } from '../ui/toast';

/**
 * 右侧图标栏。
 * 视觉沿用 dom/rightbar.ts（设计稿 1:1 还原），这里把「选中」接到 appStore.rightPanel：
 * 点按钮 → 打开对应面板；再点 / 面板右上角关闭 → 收起，按钮选中态由 store 反推。
 */
export function RightRail(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<RightbarHandle | null>(null);
  const toast = useToast((s) => s.show);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const app = (): ReturnType<typeof useAppStore.getState> => useAppStore.getState();
    const rb = createRightbarHandle(host, {
      onSelect: (label, on) => {
        if (label === 'AI Copilot') {
          // Copilot 就是左边的 Agent：展开它，而不是再开一个右侧面板
          if (app().agentCollapsed) app().toggleAgent();
          toast('AI Copilot 即左侧 Agent 面板');
          rb.select(app().rightPanel);
          return;
        }
        if (label === '筛选器') {
          app().setNav('screener');
          rb.select(app().rightPanel);
          return;
        }
        app().setRightPanel(on ? label : null);
      },
    });
    handleRef.current = rb;
    rb.select(app().rightPanel);
    const unsub = useAppStore.subscribe((s) => rb.select(s.rightPanel));
    return () => {
      unsub();
      handleRef.current = null;
      rb.root.remove();
    };
  }, [toast]);

  return <div ref={hostRef} className="right-rail" />;
}
