/**
 * 绘图工具栏 → 各格 DrawLayer 的小总线。
 * 工具状态不进 zustand：它不影响任何 React 渲染，只需要把事件广播给图层。
 */
export type DrawEvent =
  | { type: 'tool'; tool: string; char?: string }
  | { type: 'magnet'; on: boolean }
  | { type: 'hidden'; on: boolean }
  /** 全部锁定 / 解锁（左栏「锁定所有绘图」） */
  | { type: 'lock'; on: boolean }
  /** 「继续绘图」开关 */
  | { type: 'repeat'; on: boolean }
  | { type: 'longPressTip'; on: boolean }
  | { type: 'clear' }
  | { type: 'undo' }
  | { type: 'redo' };

class DrawBus {
  tool = 'cursor';
  magnet = false;
  hidden = false;
  /** 「锁定所有绘图」的当前状态（新格子建层时要跟上） */
  lockAll = false;
  /** 「继续绘图」的当前状态 */
  repeatDraw = false;
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
  /** emoji 面板选中字符：切到 emoji 工具并广播字符给各图层 */
  setEmoji(char: string): void {
    this.tool = 'emoji';
    this.emit({ type: 'tool', tool: 'emoji', char });
  }
  setMagnet(on: boolean): void {
    this.magnet = on;
    this.emit({ type: 'magnet', on });
  }
  setHidden(on: boolean): void {
    this.hidden = on;
    this.emit({ type: 'hidden', on });
  }
  /** 全部锁定 / 解锁；锁定的图形能选中但不能拖、Delete 也删不掉（橡皮擦例外，官方口径是照擦） */
  setLockAll(on: boolean): void {
    this.lockAll = on;
    this.emit({ type: 'lock', on });
  }
  /** 「继续绘图」开关：画完一个图形后不回到光标 */
  setRepeatDraw(on: boolean): void {
    if (this.repeatDraw === on) return;
    this.repeatDraw = on;
    this.emit({ type: 'repeat', on });
  }
  toggleRepeatDraw(): void {
    this.setRepeatDraw(!this.repeatDraw);
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
    case '三角形':
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
    // —— 设计稿「预测/基于成交量/测量」子菜单（多头仓位按钮） ——
    case '多头仓位':
      return 'longpos';
    case '空头仓位':
      return 'shortpos';
    case '仓位预测':
      return 'forecast';
    case 'K线形态':
      return 'kpattern';
    case '模拟K线':
      return 'simcandle';
    case '扇形':
      return 'fan';
    case '锚定VWAP':
      return 'avwap';
    case '固定范围成交量分布图':
      return 'vprofile';
    case '锚定成交量分布图':
      return 'avprofile';
    case '价格范围':
      return 'prange';
    case '日期范围':
      return 'drange';
    case '日期和价格范围':
      return 'dprange';
    case '笔刷':
      return 'brush';
    case '箭头标记':
      return 'arrowmark';
    case '向上箭头':
      return 'uparrow';
    case '向下箭头':
      return 'downarrow';
    case '旋转矩形':
      return 'rotrect';
    case '路径':
      return 'path';
    case '圆':
      return 'circle';
    case '折线':
      return 'polyline';
    case '弧形':
      return 'arc';
    case '曲线':
      return 'curve';
    case '双曲线':
      return 'hyperbola';
    case '安德鲁音叉':
      return 'pitchfork';
    case '希夫音叉':
      return 'schiff';
    case '改良希夫音叉':
      return 'schiff2';
    case '内部分叉':
      return 'innerfork';
    case '扇形分叉':
      return 'pitchfan';
    case '标注':
      return 'callout';
    case '评论':
      return 'comment';
    case '气泡':
      return 'balloon';
    case '便签':
      return 'note';
    case '价格便签':
      return 'pricenote';
    case '价格标签':
      return 'pricelabel';
    case '路标':
      return 'signpost';
    case '圆加十字线':
      return 'circlelines';
    case '三次贝塞尔':
      return 'beziercubic';
    case '平底':
      return 'flatbottom';
    case '左箭头':
      return 'arrowmarl';
    case '右箭头':
      return 'arrowmarr';
    case '矩形':
      return 'rect';
    case '文字':
      return 'text';
    case '图标':
      return 'emoji';
    case '测量':
      return 'measure';
    default:
      return null;
  }
}

export function isMagnetLabel(label: string): boolean {
  return label === '磁铁' || label === '强力磁铁' || label === '弱磁铁';
}

/* ===========================================================================
 * 菜单项 → 意图
 *
 * 左栏里有的行是「画图工具」，有的是「动作」（移除 / 隐藏 / 锁定 / 磁铁 / 面板）。
 * 早先这些动作行统一落到 `toolKeyForLabel() === null` 的分支里弹「暂未实现」，
 * 于是侧栏上明明看得见、点了却什么都不做 —— 上线清单和引擎能力对不上。
 *
 * 这里把 label 一次性翻成 DrawIntent（纯函数，无副作用，可单测），
 * DrawToolbar 只负责执行。新增菜单行时忘接线，tests/sidebarWiring.test.ts 会红。
 * ========================================================================= */

export type DrawIntent =
  /** 选中一个绘图工具 */
  | { kind: 'tool'; label: string; key: string }
  /** 开磁吸 */
  | { kind: 'magnet'; label: string }
  /** 清空：绘图 / 指标 / 两者 */
  | { kind: 'clear'; target: 'drawings' | 'studies' | 'all' }
  /** 隐藏：绘图 / 指标 / 两者 */
  | { kind: 'hide'; target: 'drawings' | 'studies' | 'all' }
  /** 锁定：绘图 / 指标 */
  | { kind: 'lock'; target: 'drawings' | 'studies' }
  /** 开关型（继续绘图） */
  | { kind: 'toggle'; label: string; what: 'repeatDraw' }
  /** 打开面板（图标 = emoji 面板） */
  | { kind: 'panel'; panel: 'emoji' }
  /** 还没接上引擎的动作（放大：图上单击缩放，属于图表层而非绘图层） */
  | { kind: 'stub'; label: string; why: string };

export function drawIntent(label: string): DrawIntent {
  const key = toolKeyForLabel(label);
  if (key) return { kind: 'tool', label, key };
  if (isMagnetLabel(label)) return { kind: 'magnet', label };
  switch (label) {
    case '移除图形':
      return { kind: 'clear', target: 'drawings' };
    case '移除指标':
      return { kind: 'clear', target: 'studies' };
    case '移除全部':
      return { kind: 'clear', target: 'all' };
    case '隐藏绘图':
      return { kind: 'hide', target: 'drawings' };
    case '隐藏指标':
      return { kind: 'hide', target: 'studies' };
    case '隐藏所有图形':
      return { kind: 'hide', target: 'all' };
    case '锁定所有绘图':
      return { kind: 'lock', target: 'drawings' };
    case '锁定指标':
      return { kind: 'lock', target: 'studies' };
    case '继续绘图':
      return { kind: 'toggle', label, what: 'repeatDraw' };
    case '放大':
      return { kind: 'stub', label, why: '放大是图表层动作（单击以点为锚缩放），不属于绘图层' };
    default:
      return { kind: 'stub', label, why: '没有对应的引擎能力' };
  }
}
