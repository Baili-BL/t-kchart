import { useEffect, useRef } from 'react';
import { createSidebar } from './dom/sidebar';
import { useToast } from '../ui/toast';
import { drawBus, isMagnetLabel, toolKeyForLabel } from './drawBus';

/**
 * 左侧绘图工具栏。
 * 视觉与子菜单沿用 dom/sidebar.ts（设计稿 1:1 还原），这里只负责把它接到 drawBus。
 */
export function DrawToolbar(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const toast = useToast((s) => s.show);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = createSidebar(host, {
      onTool: (label) => {
        if (isMagnetLabel(label)) {
          drawBus.setMagnet(true);
          toast('磁吸已开启：绘图吸附到最近的 OHLC');
          return;
        }
        const key = toolKeyForLabel(label);
        if (key) {
          drawBus.setTool(key);
        } else {
          drawBus.setTool('cursor');
          toast(`「${label}」暂未实现（见 TODO 2.8）`);
        }
      },
      onToggle: (label, on) => {
        if (label === '隐藏所有图形') drawBus.setHidden(on);
        else if (label === '移除对象' && on) drawBus.clear();
        else if (label === '锁定绘图和指标') toast('锁定暂未实现');
      },
    });
    return () => {
      root.remove();
    };
  }, [toast]);

  return <div ref={hostRef} className="draw-toolbar" />;
}
