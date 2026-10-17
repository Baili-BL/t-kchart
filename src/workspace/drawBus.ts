/**
 * 绘图工具栏 → 各格 DrawLayer 的小总线。
 * 工具状态不进 zustand：它不影响任何 React 渲染，只需要把事件广播给图层。
 */
export type DrawEvent =
  | { type: 'tool'; tool: string }
  | { type: 'magnet'; on: boolean }
  | { type: 'hidden'; on: boolean }
  | { type: 'longPressTip'; on: boolean }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'redo' };

class DrawBus {
  tool = 'cursor';
  magnet = false;
  hidden = false;
  /** 设计稿「长按时显示数值工具提示」开关，默认开 */
  longPressTip = true;
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
  setLongPressTip(on: boolean): void {
    this.longPressTip = on;
    this.emit({ type: 'longPressTip', on });
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
    case '圆点':
      return 'dot';
    case '荧光笔':
      return 'highlight';
    case '橡皮擦':
      return 'eraser';
    case '趋势线':
      return 'trend';
    case '信息线':
      return 'infoline';
    case '趋势角度':
      return 'angle';
    case '横线':
      return 'crossline';
    case '水平线':
      return 'hline';
    case '垂直线':
      return 'vline';
    case '射线':
      return 'ray';
    case '水平射线':
      return 'hray';
    case '延长线':
      return 'extline';
    case '箭头':
      return 'arrow';
    case '平行通道':
      return 'channel';
    case '三角形形态':
      return 'triangle';
    case '椭圆':
      return 'ellipse';
    case '斐波那契回撤':
      return 'fib';
    case '斐波那契趋势扩展':
    case '斐波那契扩展':
      return 'fibext';
    case '斐波那契通道':
      return 'fibchannel';
    case '斐波那契时区':
      return 'fibtz';
    case '斐波那契速度阻力扇':
      return 'fibfan';
    case '斐波那契趋势时间':
      return 'fibttz';
    case '斐波那契圆':
      return 'fibcirc';
    case '斐波那契螺旋':
      return 'fibspiral';
    case '斐波那契速度阻力弧':
      return 'fibarc';
    case '斐波那契楔形':
      return 'fibwedge';
    case '倾斜扇形':
      return 'tiltfan';
    case '江恩箱':
      return 'gannbox';
    case '固定江恩正方':
      return 'gannsqf';
    case '江恩正方':
      return 'gannsq';
    // —— 设计稿「图表形态」子菜单（图表形态 + 艾略特波浪 + 循环组） ——
    case 'XABCD形态':
      return 'xabcd';
    case '赛福形态':
      return 'shark';
    case '头肩形态':
      return 'hs';
    case 'ABCD形态':
      return 'abcd';
    case '三角形态':
      return 'tri';
    case '三驱形态':
      return 'threedrives';
    case '艾略特脉冲波（1-2-3-4-5）':
      return 'ewimpulse';
    case '艾略特修正波（A-B-C）':
      return 'ewcorrection';
    case '艾略特三角波（A-B-C-D-E）':
      return 'ewtriangle';
    case '艾略特双重组合浪（W-X-Y）':
      return 'ewdouble';
    case '艾略特三重组合浪（W-X-Y-Z）':
      return 'ewtriple';
    case '循环线':
      return 'cycle';
    case '时间循环':
      return 'timecycle';
    case '正弦线':
      return 'sine';
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
