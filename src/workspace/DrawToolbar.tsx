import { useEffect, useRef } from 'react';
import { createSidebar, LONGPRESS_TIP_LABEL } from './dom/sidebar';
import { useToast } from '../ui/toast';
import { drawBus, drawIntent } from './drawBus';
import { useStudyStore } from '../store/studyStore';

/**
 * 左侧绘图工具栏。
 * 视觉与子菜单沿用 dom/sidebar.ts（设计稿 1:1 还原），这里只负责把菜单项接到动作上。
 * 「菜单项 → 意图」的翻译在 drawBus.drawIntent()（纯函数，单测覆盖），
 * 本组件只分发意图的副作用，保证侧栏上看得见的每一项都真的做事。
 */
export function DrawToolbar(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const toast = useToast((s) => s.show);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = createSidebar(host, {
      onTool: (label) => {
        const it = drawIntent(label);
        switch (it.kind) {
          case 'tool':
            drawBus.setTool(it.key);
            return;
          case 'magnet':
            drawBus.setMagnet(true);
            toast('磁吸已开启：绘图吸附到最近的 OHLC');
            return;
          case 'clear': {
            const n = useStudyStore.getState().studies.length;
            if (it.target !== 'studies') drawBus.clear();
            if (it.target !== 'drawings') useStudyStore.getState().clearStudies();
            const what = it.target === 'studies' ? `指标 ${n} 个` : it.target === 'all' ? `绘图 + 指标 ${n} 个` : '全部绘图';
            toast(`已移除${what}`);
            return;
          }
          case 'hide':
            if (it.target !== 'studies') drawBus.setHidden(true);
            if (it.target !== 'drawings') useStudyStore.getState().setAllHidden(true);
            toast(it.target === 'all' ? '已隐藏全部绘图与指标' : it.target === 'drawings' ? '已隐藏全部绘图（左侧按钮可再显示）' : '已隐藏全部指标（图例仍在，可逐个恢复）');
            return;
          case 'lock':
            if (it.target === 'drawings') {
              const on = !drawBus.lockAll;
              drawBus.setLockAll(on);
              toast(on ? '已锁定全部绘图：不能拖动、删不掉（再点一次解锁）' : '已解锁全部绘图');
            } else {
              const st = useStudyStore.getState();
              const on = !st.locked;
              st.setLocked(on);
              toast(on ? '已锁定指标：参数与删除都锁住（再点一次解锁）' : '已解锁指标');
            }
            return;
          case 'toggle':
            drawBus.toggleRepeatDraw();
            toast(drawBus.repeatDraw ? '继续绘图已开启：画完一个继续用当前工具' : '继续绘图已关闭：画完回到光标');
            return;
          case 'panel':
            return; // 图标面板由 sidebar 自己弹出
          default:
            toast(`「${it.label}」暂未接上：${it.why}`);
        }
      },
      onEmoji: (char) => {
        drawBus.setEmoji(char);
        toast(`已选图标 ${char}：点击图表放置`);
      },
      onToggle: (label, on) => {
        if (label === '隐藏所有图形') drawBus.setHidden(on);
        else if (label === '移除对象' && on) drawBus.clear();
        else if (label === '继续绘图') {
          // 侧栏把「继续绘图」当成开关按钮（走 onToggle，不走 onTool）
          drawBus.setRepeatDraw(on);
          toast(on ? '继续绘图已开启：画完一个继续用当前工具' : '继续绘图已关闭：画完回到光标');
        }
        else if (label === '锁定绘图和指标') toast('锁定绘图和指标：见菜单里的「锁定所有绘图」/「锁定指标」');
        else if (label === LONGPRESS_TIP_LABEL) drawBus.setLongPressTip(on);
      },
    });
    return () => {
      root.remove();
    };
  }, [toast]);

  return <div ref={hostRef} className="draw-toolbar" />;
}
