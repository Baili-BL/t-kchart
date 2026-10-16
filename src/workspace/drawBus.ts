/**
 * 绘图工具栏 → 各格 DrawLayer 的小总线。
 * 工具状态不进 zustand：它不影响任何 React 渲染，只需要把事件广播给图层。
 */
export type DrawEvent =
  | { type: 'tool'; tool: string }
  | { type: 'magnet'; on: boolean }
  | { type: 'hidden'; on: boolean }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'redo' };

class DrawBus {
  tool = 'cursor';
  magnet = false;
  hidden = false;
  private listeners = new Set<(ev: DrawEvent) => void>();

  subscribe(fn: (ev: DrawEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: DrawEvent): void {
    this.listeners.forEach((fn) => fn(ev));
  }

  setTool(tool: string): void {
    this.tool = tool;
    this.emit({ type: 'tool', tool });
  }
  setMagnet(on: boolean): void {
    this.magnet = on;
    this.emit({ type: 'magnet', on });
  }
  setHidden(on: boolean): void {
    this.hidden = on;
    this.emit({ type: 'hidden', on });
  }
  clear(): void {
    this.emit({ type: 'clear' });
  }
  undo(): void {
    this.emit({ type: 'undo' });
  }
  redo(): void {
    this.emit({ type: 'redo' });
  }
}

export const drawBus = new DrawBus();

/** 左侧工具栏的中文标签 → DrawLayer 的工具 key；映射不到的工具返回 null（暂未实现）。 */
export function toolKeyForLabel(label: string): string | null {
  switch (label) {
    case '十字线':
    case '光标':
      return 'cursor';
    case '趋势线':
      return 'trend';
    case '水平线':
      return 'hline';
    case '垂直线':
      return 'vline';
    case '斐波那契回撤':
      return 'fib';
    case '文字':
      return 'text';
    case '测量':
      return 'measure';
    default:
      return null;
  }
}

export function isMagnetLabel(label: string): boolean {
  return label === '磁铁' || label === '强力磁铁' || label === '弱磁铁';
}
