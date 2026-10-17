/**
 * kc-chart / draw.ts
 * ---------------------------------------------------------------------------
 * 绘图工具层（左侧工具栏背后的引擎）。
 *
 * 依赖 chart.ts（ESM `import`）。
 *
 * ============================ 两个关键设计 ============================
 *
 * ① **锚点存 (时间, 价格)，不存像素。**
 *    存像素的话，你一缩放/平移，画的东西就飘了 —— 同一个错误在十字光标联动
 *    那里踩过一次（见 README §10）。像素只在渲染的那一刻算。
 *
 * ② **依赖的是 `DrawHost` 接口，不是 `KChart` 类。**
 *    KChart 结构化地满足这个接口，所以真图能直接用；测试里塞一个假图
 *    （只有 bars/plot/scale 和几个变换函数）就能在 Node 里跑几何自检，
 *    不需要浏览器。`drawSelfTest()` 就是这么实现的。
 * ===========================================================================
 */

import { Bar, fmtCrossTime, log } from './chart';
import TV_TOOL_DEFAULTS from './tv-tool-defaults.json';
import { loadEmojiImage } from './emojiAssets';

/* ===========================================================================
 * 1. 类型
 * ========================================================================= */

/** 图上锚点：(时间, 价格)。时间用 epoch 毫秒，和 Bar.time 同一套。 */
export interface DrawAnchor {
  time: number;
  price: number;
}

export interface DrawStyle {
  color: string;
  width: number;
  dash: number[];
  fill: string;
  fontSize: number;
  text: string;
  /**
   * 被橡皮擦「擦掉的档位」下标（只对多档位工具有效）。
   * 官方口径：⌘/Ctrl + 橡皮擦点某一条档位线 = 只隐藏这一条（`processErase` →
   * `properties().child('levelN').visible = false`），整个图形还在。
   */
  hiddenLevels?: number[];
}

export interface Drawing {
  id: number;
  type: string;
  pts: DrawAnchor[];
  style: DrawStyle;
  locked: boolean;
  visible: boolean;
}

/**
 * 轴条带几何：测量工具的起止标签要画在绘图区**之外**的轴上，
 * 由 KChart 提供（假宿主可以不实现，此时不画轴标签）。
 */
export interface DrawAxisBox {
  /** 价格轴左边界（= plot.r）与其宽度 */
  priceL: number;
  priceW: number;
  /** 时间轴中线 y */
  timeY: number;
  /** 绘图区左右边界 / 上下边界（夹取标签用） */
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 绘图层需要的「宿主」能力。
 * KChart 天然满足；测试里可以用一个几十行的假对象。
 */
export interface DrawHost {
  bars: Bar[];
  plot: { l: number; t: number; r: number; b: number; w: number; h: number };
  scale: { min: number; max: number };
  xCenter(i: number): number;
  iOf(px: number): number;
  yOf(price: number): number;
  pOf(py: number): number;
  indexAtTime(t: number): number;
  canvas?: HTMLCanvasElement;
  invalidate(): void;
  /** 价格小数位（KChart.dec()）；缺省按 2 位 */
  priceDecimals?(): number;
  /** 轴条带几何；缺省不画轴标签 */
  axisBox?(): DrawAxisBox;
  /**
   * 工具被图层**自己**切走时的回调（画完一个图形、按 Esc 都会回到光标）。
   * 左侧工具栏的主按钮图标要跟着拨回十字线 —— 官方的分组按钮永远显示当前工具。
   * 只报「自动」切换；外部调 `setTool()` 换工具不用走这里。
   */
  onToolAutoChange?(tool: string): void;
}

export interface DrawToolDef {
  key: string;
  label: string;
  /** 需要几个锚点 */
  points: number;
  /** 图标（内联 SVG 的 path d） */
  icon: string;
  /** 快捷键 */
  key2?: string;
  /** Alt 组合快捷键（设计稿「⌥T」样式，attachKeys 里匹配 e.altKey） */
  key3?: string;
}

/* ===========================================================================
 * 2. 工具表
 * ========================================================================= */

export const DRAW_TOOLS: DrawToolDef[] = [
  { key: 'cursor', label: '光标 / 拖动', points: 0, key2: 'Escape',
    icon: 'M4 2 L4 16 L8 12 L11 17 L13 16 L10 11 L15 11 Z' },
  { key: 'trend', label: '趋势线', points: 2, key2: 't', key3: '⌥T',
    icon: 'M3 15 L15 3' },
  { key: 'hline', label: '水平线', points: 1, key2: 'h', key3: '⌥H',
    icon: 'M2 9 L16 9' },
  { key: 'vline', label: '垂直线', points: 1, key2: 'v', key3: '⌥V',
    icon: 'M9 2 L9 16' },
  { key: 'ray', label: '射线', points: 2, key2: 'r',
    icon: 'M3 14 L15 4 M11 4 L15 4 L15 8' },
  { key: 'hray', label: '水平射线', points: 1, key2: 'y', key3: '⌥J',
    icon: 'M3 9 L16 9 M12 6 L16 9 L12 12' },
  { key: 'extline', label: '延长线', points: 2, key2: 'e',
    icon: 'M1 9 L17 9 M4 6 L1 9 L4 12 M14 6 L17 9 L14 12' },
  { key: 'arrow', label: '箭头', points: 2, key2: 'w',
    icon: 'M3 14 L14 4 M14 4 L9 4 M14 4 L14 9' },
  { key: 'rect', label: '矩形', points: 2, key2: 'b', key3: '⌥R',
    icon: 'M3 5 L15 5 L15 14 L3 14 Z' },
  { key: 'ellipse', label: '椭圆', points: 2, key2: 'o',
    icon: 'M9 4 C13.5 4 16 6.2 16 9 C16 11.8 13.5 14 9 14 C4.5 14 2 11.8 2 9 C2 6.2 4.5 4 9 4 Z' },
  { key: 'triangle', label: '三角形', points: 3, key2: 'i',
    icon: 'M9 3 L16 14 L2 14 Z' },
  { key: 'channel', label: '平行通道', points: 3, key2: 'c',
    icon: 'M3 4 L15 4 M3 12 L15 12 M3 4 L3 12' },
  { key: 'fib', label: '斐波那契回撤', points: 2, key2: 'f', key3: '⌥F',
    icon: 'M2 4 L16 4 M2 7.5 L16 7.5 M2 11 L16 11 M2 14.5 L16 14.5' },
  { key: 'text', label: '文字', points: 1, key2: 'x',
    icon: 'M4 4 L14 4 M9 4 L9 15' },
  { key: 'emoji', label: '图标', points: 1,
    icon: 'M9 2 A7 7 0 1 0 9 16 A7 7 0 1 0 9 2 Z M6.5 7 A1 1 0 1 0 6.5 7.01 Z M11.5 7 A1 1 0 1 0 11.5 7.01 Z M5.5 10.5 C6.5 12.5 11.5 12.5 12.5 10.5' },
  { key: 'measure', label: '测量', points: 2, key2: 'm',
    icon: 'M3 12 L14 5 M5 13 L6 11 M7 11 L8 9 M9 9 L10 7 M11 7 L12 5' },
  // —— 设计稿「十字线」子菜单新增的三种 ——
  { key: 'dot', label: '圆点', points: 1, key2: 'd',
    icon: 'M9 6.5 A2.5 2.5 0 1 0 9 11.5 A2.5 2.5 0 1 0 9 6.5 Z' },
  { key: 'highlight', label: '荧光笔', points: 0, key2: 'g',
    icon: 'M3 14 L6 11 M6 11 L11 3 L14 6 L9 14 Z' },
  { key: 'eraser', label: '橡皮擦', points: 0, key2: 'q',
    icon: 'M5 14 L2 11 L9 3 L14 8 L9 14 Z M5 14 L14 14' },
  // —— 设计稿「趋势线」子菜单（线工具组）新增的三种 ——
  { key: 'infoline', label: '信息线', points: 2,
    icon: 'M3 14 L13 4 M11 13 L15 13 L15 9' },
  { key: 'angle', label: '趋势角度', points: 2,
    icon: 'M3 14 L14 4 M3 10 A4 4 0 0 1 7 14' },
  { key: 'crossline', label: '横线', points: 1, key3: '⌥C',
    icon: 'M2 9 L16 9 M9 2 L9 16' },
  // —— 设计稿「斐波那契回撤」子菜单（斐波那契 + 江恩 工具组）新增的十三种 ——
  { key: 'fibext', label: '斐波那契趋势扩展', points: 3,
    icon: 'M2 12 L7 7 L11 10 L16 4 M3 8 L16 8 M3 13 L16 13' },
  { key: 'fibchannel', label: '斐波那契通道', points: 3,
    icon: 'M3 13 L13 3 M7 15 L16 6 M11 15 L16 10' },
  { key: 'fibtz', label: '斐波那契时区', points: 2,
    icon: 'M4 3 L4 15 M9 3 L9 15 M14 3 L14 15' },
  { key: 'fibfan', label: '斐波那契速度阻力扇', points: 2,
    icon: 'M3 14 L16 5 M3 14 L16 10 M3 14 L16 14' },
  { key: 'fibttz', label: '斐波那契趋势时间', points: 3,
    icon: 'M3 12 L8 6 L12 9 L16 3 M6 5 L6 16 M11 8 L11 16' },
  { key: 'fibcirc', label: '斐波那契圆', points: 2,
    icon: 'M9 7.5 A1.5 1.5 0 1 0 9.01 7.5 M9 3.5 A5.5 5.5 0 1 0 9.01 3.5' },
  { key: 'fibspiral', label: '斐波那契螺旋', points: 2,
    icon: 'M9 9 A1.5 1.5 0 1 1 6 10.5 A4.5 4.5 0 0 1 12 6 A6 6 0 0 1 15.5 12' },
  { key: 'fibarc', label: '斐波那契速度阻力弧', points: 2,
    icon: 'M3 14 A8 8 0 0 1 15 8 M3 14 A5 5 0 0 1 11 10' },
  { key: 'fibwedge', label: '斐波那契楔形', points: 2,
    icon: 'M3 15 A12 12 0 0 1 15 15 L3 15 M3 15 A7 7 0 0 1 10 15' },
  { key: 'tiltfan', label: '倾斜扇形', points: 2,
    icon: 'M3 14 L15 6 M3 14 L16 11 M3 14 L13 3' },
  { key: 'gannbox', label: '江恩箱', points: 2,
    icon: 'M3 4 L15 4 L15 14 L3 14 Z M7 4 L7 14 M11 4 L11 14 M3 8 L15 8 M3 11 L15 11 M3 4 L15 14' },
  { key: 'gannsqf', label: '固定江恩正方', points: 2,
    icon: 'M3 3 L15 3 L15 15 L3 15 Z M7 3 L7 15 M11 3 L11 15 M3 7 L15 7 M3 11 L15 11 M3 3 L15 15' },
  { key: 'gannsq', label: '江恩正方', points: 2,
    icon: 'M3 6 L12 6 L12 15 L3 15 Z M6 6 L6 15 M9 6 L9 15 M3 9 L12 9 M3 12 L12 12' },
  // —— 设计稿「图表形态」子菜单新增的十四种（图表形态 + 艾略特波浪 + 循环） ——
  { key: 'xabcd', label: 'XABCD形态', points: 5,
    icon: 'M2 14 L6 4 L10 12 L13 6 L16 10' },
  { key: 'shark', label: '赛福形态', points: 5,
    icon: 'M2 6 L6 13 L10 4 L14 10 L16 6' },
  { key: 'hs', label: '头肩形态', points: 5,
    icon: 'M2 13 L5 6 L7 10 L10 3 L13 10 L15 7 L16 9' },
  { key: 'abcd', label: 'ABCD形态', points: 4,
    icon: 'M2 13 L7 4 L11 11 L16 5' },
  { key: 'tri', label: '三角形态', points: 5,
    icon: 'M2 5 L7 12 L11 6 L14 10 L16 8' },
  { key: 'threedrives', label: '三驱形态', points: 6,
    icon: 'M2 14 L5 8 L8 11 L11 5 L14 8 L16 4' },
  { key: 'ewimpulse', label: '艾略特脉冲波（1-2-3-4-5）', points: 6,
    icon: 'M2 13 L5 5 L8 11 L11 4 L14 10 L16 6' },
  { key: 'ewcorrection', label: '艾略特修正波（A-B-C）', points: 4,
    icon: 'M2 6 L6 12 L10 5 L15 10' },
  { key: 'ewtriangle', label: '艾略特三角波（A-B-C-D-E）', points: 5,
    icon: 'M2 4 L6 10 L10 6 L13 10 L16 8' },
  { key: 'ewdouble', label: '艾略特双重组合浪（W-X-Y）', points: 4,
    icon: 'M2 5 L5 11 L8 7 L12 12' },
  { key: 'ewtriple', label: '艾略特三重组合浪（W-X-Y-Z）', points: 5,
    icon: 'M2 5 L5 11 L8 7 L11 12 L15 9' },
  { key: 'cycle', label: '循环线', points: 2,
    icon: 'M3 4 L3 14 M5 4 L5 14 M8 4 L8 14 M10 4 L10 14 M13 4 L13 14 M15 4 L15 14' },
  { key: 'timecycle', label: '时间循环', points: 2,
    icon: 'M3 4 L3 14 M7 4 L7 14 M11 4 L11 14 M15 4 L15 14' },
  { key: 'sine', label: '正弦线', points: 2,
    icon: 'M2 9 C4 4 6 4 8 9 C10 14 12 14 14 9 C15 6.5 16 6 16 7' },
  // —— 设计稿「预测/基于成交量/测量」子菜单（多头仓位按钮）新增的十二种 ——
  { key: 'longpos', label: '多头仓位', points: 2,
    icon: 'M2 12 L16 12 M2 5 L16 5 M2 5 L2 12 M6 8 L9 5 M6 8 L9 11' },
  { key: 'shortpos', label: '空头仓位', points: 2,
    icon: 'M2 8 L16 8 M2 15 L16 15 M2 8 L2 15 M9 5 L12 8 M12 8 L9 11' },
  { key: 'forecast', label: '仓位预测', points: 3,
    icon: 'M2 14 L8 6 L14 10 M11 9 L15 10 L14 6' },
  { key: 'kpattern', label: 'K线形态', points: 1,
    icon: 'M3 13 L4 5 L4 13 Z M8 12 L9 7 L9 12 Z M13 5 L14 12 L13 5 Z' },
  { key: 'simcandle', label: '模拟K线', points: 2,
    icon: 'M3 6 L3 13 M4.5 7 L4.5 11 M2.5 7 L6.5 7 L6.5 12 L2.5 12 Z M8 5 L8 12 M9.5 6 L9.5 10 M7.5 6 L11.5 6 L11.5 10 L7.5 10 Z M13 4 L13 11 M14.5 5 L14.5 9 M12.5 5 L16.5 5 L16.5 9 L12.5 9 Z' },
  { key: 'fan', label: '扇形', points: 2,
    icon: 'M3 14 L3 4 M3 14 L12 5 M3 14 L15 14 M3 4 A11 11 0 0 1 15 14' },
  { key: 'avwap', label: '锚定VWAP', points: 1,
    icon: 'M2 6 C5 4 7 8 10 6 C13 4 15 7 17 5 M4 5 L4 3 M4 4 L4 7' },
  { key: 'vprofile', label: '固定范围成交量分布图', points: 2,
    icon: 'M3 3 L3 15 M5 13 L8 13 M5 10 L11 10 M5 7 L13 7 M5 4 L9 4' },
  { key: 'avprofile', label: '锚定成交量分布图', points: 1,
    icon: 'M3 3 L3 15 M5 13 L8 13 M5 10 L11 10 M5 7 L13 7 M5 4 L9 4 M13 3 L13 15' },
  { key: 'prange', label: '价格范围', points: 2,
    icon: 'M8 3 L8 14 M5 3 L11 3 M5 14 L11 14 M13 4 L13 8 M11 6 L13 4 L15 6' },
  { key: 'drange', label: '日期范围', points: 2,
    icon: 'M3 8 L14 8 M3 5 L3 11 M14 5 L14 11 M13 3 L13 5 M15 3 L15 5 M13 2 L15 2' },
  { key: 'dprange', label: '日期和价格范围', points: 2,
    icon: 'M3 3 L15 3 L15 14 L3 14 Z M3 3 L3 14 M8 8 L8 11 M15 8 L15 11 M8 11 L15 11' },
  // —— 设计稿「笔刷」子菜单：笔刷/箭头/形状三组新增的 11 种 ——
  { key: 'brush', label: '笔刷', points: 0,
    icon: 'M2 13 C4 9 6 12 8 8 C10 5 12 9 15 4' },
  { key: 'arrowmark', label: '箭头标记', points: 1,
    icon: 'M9 3 L13 9 L10.5 9 L10.5 14 L7.5 14 L7.5 9 L5 9 Z' },
  { key: 'uparrow', label: '向上箭头', points: 1,
    icon: 'M9 3 L13 8 L11 8 L11 14 L7 14 L7 8 L5 8 Z' },
  { key: 'downarrow', label: '向下箭头', points: 1,
    icon: 'M9 14 L5 9 L7 9 L7 3 L11 3 L11 9 L13 9 Z' },
  { key: 'rotrect', label: '旋转矩形', points: 3,
    icon: 'M4 6 L12 3 L14 10 L6 13 Z' },
  { key: 'path', label: '路径', points: 4,
    icon: 'M2 13 L7 6 L11 10 L16 4' },
  { key: 'circle', label: '圆', points: 2,
    icon: 'M9 3.5 A5.5 5.5 0 1 0 9 14.5 A5.5 5.5 0 1 0 9 3.5 Z M9 9 L13 6' },
  { key: 'polyline', label: '折线', points: 4,
    icon: 'M3 4 L15 4 L3 13 L15 13' },
  { key: 'arc', label: '弧形', points: 2,
    icon: 'M3 13 C3 7 7 4 15 4' },
  { key: 'curve', label: '曲线', points: 3,
    icon: 'M3 13 C5 4 9 14 15 4' },
  { key: 'hyperbola', label: '双曲线', points: 2,
    icon: 'M4 3 C6 8 6 10 4 14 M14 3 C12 8 12 10 14 14' },
  // —— 对齐 TradingView charting_library（本地参考库 100 种线工具）：音叉/文本标注/形状补齐 17 种 ——
  { key: 'pitchfork', label: '安德鲁音叉', points: 3,
    icon: 'M2 4 L16 12 M2 4 L16 7 M2 4 L16 17' },
  { key: 'schiff', label: '希夫音叉', points: 3,
    icon: 'M5 9 L16 12 M5 9 L16 8 M5 9 L16 16' },
  { key: 'schiff2', label: '改良希夫音叉', points: 3,
    icon: 'M5 12 L16 12 M5 12 L16 8 M5 12 L16 16' },
  { key: 'innerfork', label: '内部分叉', points: 3,
    icon: 'M2 9 L16 9 M2 9 L16 6.5 M2 9 L16 11.5' },
  { key: 'pitchfan', label: '扇形分叉', points: 3,
    icon: 'M3 15 L16 4 M3 15 L16 7 M3 15 L16 11 M3 15 L16 15' },
  { key: 'note', label: '便签', points: 1,
    icon: 'M3 3 L12 3 L15 6 L15 15 L3 15 Z M12 3 L12 6 L15 6' },
  { key: 'callout', label: '标注', points: 1,
    icon: 'M3 4 L15 4 L15 11 L9 11 L6 14 L6 11 L3 11 Z' },
  { key: 'comment', label: '评论', points: 1,
    icon: 'M3 5 L15 5 L15 12 L3 12 Z M6 12 L6 15 L10 12' },
  { key: 'balloon', label: '气泡', points: 1,
    icon: 'M9 3 C13 3 15 5.5 15 8 C15 10.5 12.5 12 9 12 C5.5 12 3 10.5 3 8 C3 5.5 5 3 9 3 Z M8 12 L7 15 L10.5 12' },
  { key: 'pricenote', label: '价格便签', points: 1,
    icon: 'M3 3 L12 3 L15 6 L15 15 L3 15 Z M9 7 L9 13 M7 9 L9 7 L11 9' },
  { key: 'pricelabel', label: '价格标签', points: 1,
    icon: 'M3 7 L13 7 L16 9 L13 11 L3 11 Z' },
  { key: 'signpost', label: '路标', points: 1,
    icon: 'M9 2 L9 16 M4 5 L14 5 L16 7 L14 9 L4 9 Z' },
  { key: 'circlelines', label: '圆加十字线', points: 2,
    icon: 'M9 4 A5 5 0 1 0 9 14 A5 5 0 1 0 9 4 Z M1 9 L17 9 M9 1 L9 17' },
  { key: 'beziercubic', label: '三次贝塞尔', points: 4,
    icon: 'M2 14 C4 3 12 3 16 14 M2 14 L6 10 M16 14 L12 10' },
  { key: 'flatbottom', label: '平底', points: 2,
    icon: 'M9 3 L15 14 L3 14 Z M3 14 L15 14' },
  { key: 'arrowmarl', label: '左箭头', points: 1,
    icon: 'M5 9 L10 5 L10 7.5 L15 7.5 L15 10.5 L10 10.5 L10 13 Z' },
  { key: 'arrowmarr', label: '右箭头', points: 1,
    icon: 'M13 9 L8 5 L8 7.5 L3 7.5 L3 10.5 L8 10.5 L8 13 Z' },
];

export const FIB_LEVELS: { l: number; c: string }[] = [
  { l: 0, c: '#787b86' },
  { l: 0.236, c: '#f23645' },
  { l: 0.382, c: '#ff9800' },
  { l: 0.5, c: '#ffeb3b' },
  { l: 0.618, c: '#089981' },
  { l: 0.786, c: '#2962ff' },
  { l: 1, c: '#787b86' },
];

/** 斐波那契档位配色（扇/弧/通道按序取色用） */
export const FIB_COLORS: string[] = FIB_LEVELS.map((l) => l.c);

/**
 * 斐波那契趋势扩展档位：0..1 复用回撤配色，>1 为向趋势方向延伸的档位。
 * 价格 = p2.price + l * (p1.price - p0.price)。
 */
export const FIB_EXT_LEVELS: { l: number; c: string }[] = [
  ...FIB_LEVELS,
  { l: 1.618, c: '#b39ddb' },
  { l: 2.618, c: '#81d4fa' },
  { l: 4.236, c: '#a5d6a7' },
];

/** 斐波那契通道的偏移倍数（基线沿宽度向量平移） */
export const FIB_CHANNEL_R: number[] = [0, 0.236, 0.382, 0.618, 1, 1.618, 2.618, 4.236];

/** 斐波那契比例组（扇/圆/弧共用） */
export const FIB_RATIOS: number[] = [0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** 时区/趋势时间的垂直线倍数（第一根在锚点上，之后按 1, φ, φ², … 向右排布） */
export const FIB_EXTENSIONS: number[] = [1, 1.618, 2.618, 4.236, 6.854];

/** 江恩网格分割（1/8） */
export const GANN_DIVS: number[] = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];

/**
 * 有「档位」的工具 → 档位数量（下标 = 档位序号）。
 * 官方这些工具都实现了 `processErase(model, eraseMarker)`：⌘/Ctrl + 橡皮擦
 * 只隐藏被点到的那一档，而不是整条删掉。其余工具没有档位，模改键不生效。
 */
export const LEVEL_TOOLS: Record<string, number> = {
  fib: FIB_LEVELS.length,
  fibext: FIB_EXT_LEVELS.length,
  fibchannel: FIB_CHANNEL_R.length,
  fibfan: FIB_RATIOS.length + 1,          // 0 档 + 各比例
  fibtz: FIB_EXTENSIONS.length + 1,       // 起点 + 各倍数
  fibttz: FIB_EXTENSIONS.length + 1,
};

/**
 * 橡皮擦光标 —— 对齐官方的 `pane--cursor-eraser`：`charting_library/bundles` 里是
 * `eraser.c80610a04a92d2465b03.cur`（32×32、热点 **5,5**、白身 + #353535 描边、
 * 斜置橡皮右上角实心）。这里用同样造型的 SVG（不搬官方位图），
 * `url() 5 5` 的热点与官方一致；不支持 SVG 光标的浏览器退回 crosshair。
 */
export const ERASER_CURSOR = 'url("data:image/svg+xml;utf8,'
  + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
    + '<path d="M2.6 5h4.8M5 2.6v4.8" stroke="#353535" stroke-width="1.3" stroke-linecap="round"/>'
    + '<g transform="rotate(-42 15 14)">'
    + '<rect x="5.5" y="9.6" width="19" height="9" rx="1.3" fill="#fff" stroke="#353535" stroke-width="1.5"/>'
    + '<path d="M13.6 9.6h9.6a1.3 1.3 0 0 1 1.3 1.3v6.4a1.3 1.3 0 0 1-1.3 1.3h-9.6z" fill="#353535"/>'
    + '</g></svg>',
  ) + '") 5 5, crosshair';

/**
 * emoji 标注的默认字号（px）—— 对齐官方 `linetoolemoji.size = 40`。
 * 选中框边长与命中热区都按实际字号算（拖角手柄可改）。
 */
export const EMOJI_SIZE = 40;

/** 拖角缩小/放大的上下限（px 字号） */
export const EMOJI_MIN = 12;
export const EMOJI_MAX = 200;

/** 选中框四个圆角手柄的半径（像素，屏幕坐标） */
export const EMOJI_KNOB_R = 5;

/** 循环线：绘制的周期数（每周期一对垂直线，副线在周期起点右侧 18% 处） */
export const CYCLE_COUNT: number = 6;
export const CYCLE_PAIR_OFF: number = 0.18;

/** 时间循环：绘制的垂直线根数（每个周期一根，带序号标签） */
export const TIMECYCLE_COUNT: number = 8;

/* —— 设计稿「预测/基于成交量/测量」子菜单（多头仓位按钮）常量 —— */
/** 多/空仓位：目标价 = 入场价 + (入场价 − 止损价) × 盈亏比（空头同样成立：风险为负即向下） */
export const POS_RR: number = 2;

/** K线形态：锚点处绘制的启明星三根迷你K线（数值为相对比例，1 ≈ 锚点价） */
export const CANDLE_PATTERN: { o: number; h: number; l: number; c: number }[] = [
  { o: 1.0, h: 1.006, l: 0.972, c: 0.98 },    // 大阴线
  { o: 0.974, h: 0.98, l: 0.952, c: 0.968 },  // 十字星
  { o: 0.964, h: 1.002, l: 0.958, c: 0.996 }, // 大阳线
];

/** K线形态：迷你K线区总高（px） */
export const KPATTERN_H: number = 48;

/** 模拟K线：延长段生成的假K线根数 */
export const SIM_CANDLES: number = 8;

/** 扇形：相对基线方向的射线角度（度，0 = 基线方向） */
export const FAN_DEG: number[] = [-45, 0, 45];

/** 成交量分布图：价格分箱数 */
export const VP_BINS: number = 24;

/** 锚定成交量分布图：直方图区宽（px） */
export const VP_WIDTH: number = 140;

/**
 * 形态/波浪类工具的锚点字母标签（渲染与自检共用；键 = 工具 key）。
 * 锚点按 zigzag 顺序放置，峰顶（屏幕 y 更小）标签画在点上方，谷底画在下方。
 */
export const PATTERN_LABELS: { [key: string]: string[] } = {
  xabcd: ['X', 'A', 'B', 'C', 'D'],
  shark: ['0', 'X', 'A', 'B', 'C'],
  hs: ['A', 'B', 'C', 'D', 'E'],
  abcd: ['A', 'B', 'C', 'D'],
  tri: ['A', 'B', 'C', 'D', 'E'],
  threedrives: ['0', '1', 'A', '2', 'B', '3'],
  ewimpulse: ['0', '1', '2', '3', '4', '5'],
  ewcorrection: ['0', 'A', 'B', 'C'],
  ewtriangle: ['A', 'B', 'C', 'D', 'E'],
  ewdouble: ['0', 'W', 'X', 'Y'],
  ewtriple: ['0', 'W', 'X', 'Y', 'Z'],
};

/** 正弦线采样：沿 p0→p1 的弦线叠加指定个整周期正弦，振幅 = 弦长 × 0.18 */
export function sinePts(
  ax: number, ay: number, bx: number, by: number,
  periods = 2, samples = 64,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const amp = Math.hypot(bx - ax, by - ay) * 0.18;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    out.push({
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t + amp * Math.sin(t * periods * 2 * Math.PI),
    });
  }
  return out;
}

/** K线形态：锚点右侧绘制的迷你K线（像素空间；ay = 基准价所在 y，屏幕坐标 y 向下） */
export function kpatternCandles(
  ax: number, ay: number,
): { x: number; w: number; o: number; h: number; l: number; c: number }[] {
  const cw = 7;
  const gap = 4;
  let mn = Infinity;
  let mx = -Infinity;
  for (const k of CANDLE_PATTERN) { mn = Math.min(mn, k.l); mx = Math.max(mx, k.h); }
  const s = KPATTERN_H / (mx - mn);
  const y = (v: number) => ay - (v - mn) * s; // 价高 → y 小
  return CANDLE_PATTERN.map((k, i) => ({ x: ax + i * (cw + gap), w: cw, o: y(k.o), h: y(k.h), l: y(k.l), c: y(k.c) }));
}

/** 模拟K线：从 (ax,ay) 到 (bx,by) 生成 n 根确定性假K线（线性漂移 + 正弦扰动，像素空间） */
export function simCandlePx(
  ax: number, ay: number, bx: number, by: number, n: number = SIM_CANDLES,
): { x: number; w: number; o: number; h: number; l: number; c: number }[] {
  const out: { x: number; w: number; o: number; h: number; l: number; c: number }[] = [];
  const w = (bx - ax) / n;
  const drift = (by - ay) / n;
  const wob = Math.abs(by - ay) * 0.08 + 4;
  let price = ay;
  for (let i = 0; i < n; i++) {
    const o = price;
    const c = o + drift + Math.sin(i * 2.7) * wob;
    const h = Math.min(o, c) - Math.abs(Math.sin(i * 1.3)) * wob - 1.5;
    const l = Math.max(o, c) + Math.abs(Math.cos(i * 1.7)) * wob + 1.5;
    out.push({ x: ax + i * w + w / 2 - w * 0.3, w: w * 0.6, o, h, l, c });
    price = c;
  }
  return out;
}

/** 锚定 VWAP：从 from 起逐根累计 (典型价×成交量)/累计成交量 的序列 */
export function vwapSeries(bars: Bar[], from: number): number[] {
  let pv = 0;
  let vv = 0;
  const out: number[] = [];
  for (let i = Math.max(0, from); i < bars.length; i++) {
    const b = bars[i];
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    vv += b.volume;
    out.push(vv ? pv / vv : tp);
  }
  return out;
}

/** 成交量分布：bars[from..to] 的典型价按 [lo,hi] 分 bins 箱累计成交量；返回每箱量与 POC 箱号 */
export function volumeProfile(
  bars: Bar[], from: number, to: number, bins: number, lo: number, hi: number,
): { vol: number[]; poc: number } {
  const vol = new Array<number>(bins).fill(0);
  const step = (hi - lo) / bins || 1;
  for (let i = Math.max(0, from); i <= to && i < bars.length; i++) {
    const b = bars[i];
    const tp = (b.high + b.low + b.close) / 3;
    let k = Math.floor((tp - lo) / step);
    if (k < 0) k = 0;
    if (k >= bins) k = bins - 1;
    vol[k] += b.volume;
  }
  let poc = 0;
  for (let k = 1; k < bins; k++) if (vol[k] > vol[poc]) poc = k;
  return { vol, poc };
}

/* —— 设计稿「笔刷」子菜单：箭头/形状组几何（纯函数，好测） —— */

/** 标记 / 空心箭头字形的半边长（px） */
export const MARKER_SIZE: number = 13;

export interface PxPt { x: number; y: number }

/* —— emoji 选中框：以锚点为中心的方形，四角圆手柄可拖拽改字号 —— */

/** 4 个角的 part 名（顺序：左上 / 右上 / 右下 / 左下） */
export const EMOJI_CORNERS = ['emoji-nw', 'emoji-ne', 'emoji-se', 'emoji-sw'] as const;

/** emoji 的方形包围盒：边长 = 字号（官方框贴合字形，不留内边距） */
export function emojiBox(cx: number, cy: number, size: number): { l: number; t: number; r: number; b: number } {
  const h = size / 2;
  return { l: cx - h, t: cy - h, r: cx + h, b: cy + h };
}

/** 4 个角点（左上 / 右上 / 右下 / 左下），渲染与命中同源 */
export function emojiCornerPts(cx: number, cy: number, size: number): PxPt[] {
  const b = emojiBox(cx, cy, size);
  return [
    { x: b.l, y: b.t },
    { x: b.r, y: b.t },
    { x: b.r, y: b.b },
    { x: b.l, y: b.b },
  ];
}

/**
 * 拖角手柄算出的新字号：边长跟手（取两轴位移的较大者），**中心不动**。
 * 夹在 [EMOJI_MIN, EMOJI_MAX]，取整避免亚像素字号。
 */
export function emojiSizeFromCorner(cx: number, cy: number, px: number, py: number): number {
  const half = Math.max(Math.abs(px - cx), Math.abs(py - cy));
  return Math.round(Math.min(EMOJI_MAX, Math.max(EMOJI_MIN, half * 2)));
}

/** 二次贝塞尔曲线采样：p0 起点、p1 控制点、p2 终点 */
export function quadBezierPts(p0: PxPt, p1: PxPt, p2: PxPt, seg = 32): PxPt[] {
  const out: PxPt[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    });
  }
  return out;
}

/** 椭圆弧采样：中心 (cx,cy)、半轴 rx/ry，角度 a0 → a1（弧度，屏幕坐标系顺时针） */
export function ellipseArcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, seg = 32): PxPt[] {
  const out: PxPt[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/**
 * 双曲线采样：p0/p1 为两焦点，横轴沿弦方向，两支对称张开。
 * 实半轴取半焦距的 0.45 倍（开口不至于太尖/太扁）。
 */
export function hyperbolaPts(ax: number, ay: number, bx: number, by: number, seg = 40): PxPt[] {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const c = Math.hypot(dx, dy) / 2; // 半焦距
  const ux = c > 0 ? dx / (2 * c) : 1;
  const uy = c > 0 ? dy / (2 * c) : 0;
  const A = Math.max(c * 0.45, 6); // 实半轴
  const B = Math.sqrt(Math.max(A * A - (c > 0 ? c * c * 0.2025 : 0), 4)); // 虚半轴 √(A²−a'²)，a'≈0.45c
  const branch = (dir: 1 | -1): PxPt[] => {
    const out: PxPt[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = -1.5 + (3 * i) / seg;
      const lx = dir * A * Math.cosh(t);
      const ly = B * Math.sinh(t);
      out.push({ x: mx + lx * ux + ly * -uy, y: my + lx * uy + ly * ux });
    }
    return out;
  };
  return branch(1).concat(branch(-1));
}

/** 空心箭头字形（↑ 朝向）的单位顶点，供上/下/左/右四个方向复用 */
const ARROW_RAW: PxPt[] = [
  { x: 0, y: -1 },                    // 头顶点
  { x: 0.62, y: -0.18 },              // 头右翼
  { x: 0.28, y: -0.18 },              // 杆右上
  { x: 0.28, y: 0.82 },               // 杆右下
  { x: -0.28, y: 0.82 },              // 杆左下
  { x: -0.28, y: -0.18 },             // 杆左上
  { x: -0.62, y: -0.18 },             // 头左翼
];

/**
 * 空心箭头字形（↑ 方向）的 7 个顶点，以 (cx,cy) 为中心；dir=-1 时旋转 180°（↓）。
 * 箭头头部宽 1.24s、高 0.82s，杆宽 0.56s、杆长 1.82s。
 */
export function arrowGlyphPts(cx: number, cy: number, s = MARKER_SIZE, dir: 1 | -1 = 1): PxPt[] {
  return ARROW_RAW.map((q) => ({ x: cx + q.x * s * dir, y: cy + q.y * s * dir }));
}

/**
 * 左/右箭头字形：把 ↑ 字形顺时针转 90° 得到 →（dir=1），逆时针 90° 得到 ←（dir=-1）。
 * 屏幕坐标下 (x,y) → (-y, x) 即顺时针 90°。
 */
export function arrowSideGlyphPts(cx: number, cy: number, s = MARKER_SIZE, dir: 1 | -1 = 1): PxPt[] {
  return ARROW_RAW.map((q) => ({ x: cx + -q.y * s * dir, y: cy + q.x * s * dir }));
}

/** 三次贝塞尔采样：p0/p3 端点，p1/p2 控制点（与 quadBezierPts 同一采样密度风格） */
export function cubicBezierPts(p0: PxPt, p1: PxPt, p2: PxPt, p3: PxPt, seg = 40): PxPt[] {
  const out: PxPt[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const e = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + e * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + e * p3.y,
    });
  }
  return out;
}

/**
 * 音叉族（安德鲁音叉 / 希夫 / 改良希夫 / 内部分叉 / 扇形分叉）的射线组。
 * 统一以「a = 起点锚、b/c = 两个外点」描述：
 *   · 中线起点：pitchfork = a；schiff = a·b 中点；schiff2 = 只把价格轴取中点（时间轴留在 a）
 *   · 三条平行线：中线（a → mid(b,c)），另两条过 b、c 且与中线同向
 *   · innerfork：两条平行线取到中线的半距（TV 的「内部分叉」）
 *   · pitchfan：从起点向 b→c 段上 5 等分点各引一条线
 * 返回 { o: 射线起点, d: 方向参照点 }，渲染/命中共用，口径不会漂。
 */
export function pitchforkRays(kind: string, a: PxPt, b: PxPt, c: PxPt): { o: PxPt; d: PxPt }[] {
  const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  let o: PxPt = a;
  if (kind === 'schiff') o = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  else if (kind === 'schiff2') o = { x: a.x, y: (a.y + b.y) / 2 };
  if (kind === 'pitchfan') {
    const out: { o: PxPt; d: PxPt }[] = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      out.push({ o, d: { x: b.x + (c.x - b.x) * t, y: b.y + (c.y - b.y) * t } });
    }
    return out;
  }
  const dir = { x: mid.x - o.x, y: mid.y - o.y };
  if (kind === 'innerfork') {
    const half = (p: PxPt): PxPt => ({ x: o.x + (p.x - o.x) / 2, y: o.y + (p.y - o.y) / 2 });
    const hb = half(b);
    const hc = half(c);
    return [
      { o, d: mid },
      { o: hb, d: { x: hb.x + dir.x, y: hb.y + dir.y } },
      { o: hc, d: { x: hc.x + dir.x, y: hc.y + dir.y } },
    ];
  }
  return [
    { o, d: mid },
    { o: b, d: { x: b.x + dir.x, y: b.y + dir.y } },
    { o: c, d: { x: c.x + dir.x, y: c.y + dir.y } },
  ];
}

export function drawStyle(color?: string): DrawStyle {
  return {
    color: color || '#2962ff',
    width: 1.6,
    dash: [],
    fill: 'rgba(41,98,255,0.14)',
    fontSize: 12,
    // 每根 bar 的 OHLC 候选，磁吸用
    text: '',
  };
}

/* ===========================================================================
 * 2.5 「测量」—— 逐条对齐 charting_library 的 MeasurePaneView
 *
 * 参考实现（本机 charting_library/bundles/library.*.js，模块 44381 附近）：
 *
 *   const _i = color-tv-blue-500 (#2962FF), mi = color-ripe-red-400 (#F7525F)
 *   gi = { bgColorPositive: generateColor(_i, 80), bgColorNegative: generateColor(mi, 80),
 *          colorPositive: color-tv-blue-600 (#1E53E5), colorNegative: mi,
 *          labelBgColorPositive: _i, labelBgColorNegative: mi }
 *
 * 所以官方测量**不是**「涨绿跌红」，而是涨蓝跌红：矩形用 20% 透明度的蓝/红，
 * 中线与箭头用同色系实色，卡片底色是 90% 不透明的标签色、白色 12px 字；
 * 时间轴 / 价格轴的起止标签则是蓝底白字（axisLineToolLabelBackgroundColorCommon）。
 * ========================================================================= */

/** 上涨（终点价 ≥ 起点价）：蓝。fill 是 generateColor(blue500, 80) → alpha 0.2 */
export const MEASURE_UP = { fill: 'rgba(41,98,255,0.20)', line: '#1e53e5', label: '#2962ff' };
/** 下跌：红（ripe-red-400）。官方中线与标签底色同色 */
export const MEASURE_DOWN = { fill: 'rgba(247,82,95,0.20)', line: '#f7525f', label: '#f7525f' };

/** 卡片底色透明度：官方 TextRenderer 的 backgroundTransparency = 10 → alpha 0.9 */
export const MEASURE_LABEL_ALPHA = 0.9;
/** 卡片字号（官方 fontsize 12） */
export const MEASURE_FONT = 12;
/** 行与行之间的间距（官方 TextRenderer 的 padding = 8；与字高一起构成行高 20） */
export const MEASURE_LINE_GAP = 8;
/** 底色相对文字的外扩（官方 backgroundHorzInflate / backgroundVertInflate = 5） */
export const MEASURE_INFLATE_X = 5;
export const MEASURE_INFLATE_Y = 5;
/** 文字到底色内边距（官方 boxPadding 缺省 = ceil(fontSize/3) = 4） */
export const MEASURE_BOX_PAD = 4;
/** 底色圆角（官方 backgroundRoundRect 4） */
export const MEASURE_RADIUS = 4;
/** 卡片离矩形端点的距离（官方 offsetY 10） */
export const MEASURE_LABEL_OFFSET = 10;
/** 轴线出箭头的门槛（官方：水平 |dx| ≥ 50、垂直 |dy| ≥ 50 才画箭头） */
export const MEASURE_ARROW_MIN = 50;
/** 轴标签高度（与十字光标胶囊一致，18） */
export const MEASURE_AXIS_LABEL_H = 18;

/** Unicode 减号 —— 官方 PriceFormatter / PercentageFormatter 的负号就是这个 */
export const MINUS_SIGN = '−';

/** 去掉小数末尾多余的 0（官方 PriceFormatter._removeEndingZeros） */
function trimZeros(s: string): string {
  return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
}

/** 价格：带符号（+ / −），按 dec 位小数并去掉尾零。0 不带符号。 */
export function fmtMeasurePrice(v: number, dec = 2): string {
  const d = Math.max(0, Math.min(8, Math.round(dec)));
  const body = trimZeros(Math.abs(v).toFixed(d));
  if (v > 0) return '+' + body;
  if (v < 0) return MINUS_SIGN + body;
  return body;
}

/** 百分比：官方 PercentageFormatter（两位小数、带符号、% 后缀） */
export function fmtMeasurePercent(v: number): string {
  const body = trimZeros(Math.abs(v).toFixed(2));
  if (v > 0) return '+' + body + '%';
  if (v < 0) return MINUS_SIGN + body + '%';
  return body + '%';
}

/**
 * 时间跨度：官方 TimeSpanFormatter 的逐单位拼接 —— 天 / 小时 / 分钟 / 秒，
 * 为 0 的单位直接跳过（"5天 19小时 30分钟"），负值前置 ASCII 减号。
 */
export function fmtMeasureSpan(seconds: number): string {
  if (!isFinite(seconds)) return '';
  const neg = seconds < 0;
  let rest = Math.abs(seconds);
  const days = Math.floor(rest / 86400); rest -= days * 86400;
  const hours = Math.floor(rest / 3600); rest -= hours * 3600;
  const mins = Math.floor(rest / 60); rest -= mins * 60;
  const secs = Math.floor(rest);
  let out = '';
  if (days) out += days + '天 ';
  if (hours) out += hours + '小时 ';
  if (mins) out += mins + '分钟 ';
  if (secs) out += secs + '秒 ';
  out = out.trim();
  return neg && out ? '-' + out : out;
}

/**
 * 区间成交量：官方 VolumeFormatter 的口径 —— <995 取整，<999995 以 K，
 * 其余 M / B / T；K 以上先按进位单位取整再缩位（3,630,000 → "3.63M"）。
 */
export function fmtMeasureVolume(v: number): string {
  if (!isFinite(v)) return '---';
  let sign = '';
  let n = v;
  if (n < 0) { sign = MINUS_SIGN; n = -n; }
  const num = (x: number): string => trimZeros(String(+x.toFixed(6)));
  if (n < 995) return sign + num(Math.round(n));
  if (n < 999995) return sign + num(n / 1e3) + 'K';
  if (n < 999999995) return sign + num((1e3 * Math.round(n / 1e3)) / 1e6) + 'M';
  if (n < 999999999995) return sign + num((1e6 * Math.round(n / 1e6)) / 1e9) + 'B';
  return sign + num((1e9 * Math.round(n / 1e9)) / 1e12) + 'T';
}

/** 一次测量的全部标量（渲染、轴标签、单测共用同一套口径） */
export interface MeasureInfo {
  /** 终点价 ≥ 起点价 */
  up: boolean;
  /** 价差（终点 − 起点） */
  delta: number;
  /** 百分比（相对起点价的绝对值） */
  percent: number;
  /** 终点索引 − 起点索引（可负） */
  bars: number;
  /** 起止两根 bar 的时间差（秒）；索引对不上时为 null */
  seconds: number | null;
  /** 区间成交量（含两端）；没有数据时为 null */
  volume: number | null;
  /** 起 / 终点 bar 索引（可能为 null） */
  fromIndex: number | null;
  toIndex: number | null;
  /** 卡片三行文字 */
  lines: string[];
}

/**
 * 测量标注的数值与文案。host 只用到 bars / indexAtTime，
 * 所以 Node 里的假宿主也能跑（自检与单测走这里）。
 */
export function measureInfo(
  host: Pick<DrawHost, 'bars' | 'indexAtTime'>,
  pts: { time: number; price: number }[],
  dec = 2,
): MeasureInfo {
  const start = pts[0];
  const end = pts[1] || pts[0];
  const delta = end.price - start.price;
  const percent = Math.abs(start.price) > 1e-8 ? (delta / Math.abs(start.price)) * 100 : 0;
  const bars = host.bars || [];
  const i0 = bars.length ? host.indexAtTime(start.time) : null;
  const i1 = bars.length ? host.indexAtTime(end.time) : null;
  const fromIndex = i0 == null ? null : Math.max(0, Math.min(bars.length - 1, i0));
  const toIndex = i1 == null ? null : Math.max(0, Math.min(bars.length - 1, i1));
  const up = delta >= 0;

  let seconds: number | null = null;
  if (bars.length && fromIndex != null && toIndex != null) {
    seconds = (bars[toIndex].time - bars[fromIndex].time) / 1000;
  }

  let volume: number | null = null;
  if (bars.length && fromIndex != null && toIndex != null) {
    const lo = Math.min(fromIndex, toIndex);
    const hi = Math.max(fromIndex, toIndex);
    let sum = 0;
    let any = false;
    for (let i = lo; i <= hi; i++) {
      const v = bars[i].volume;
      if (isFinite(v)) { sum += v; any = true; }
    }
    if (any) volume = sum;
  }

  const barCount = fromIndex != null && toIndex != null ? toIndex - fromIndex : 0;

  // ① 价差 (百分比) + 跳动数（官方：price + " (" + pct + ") " + pipFormatter(delta)）
  let line1 = fmtMeasurePrice(delta, dec) + ' (' + fmtMeasurePercent(percent) + ')';
  if (dec > 0) {
    const ticks = Math.round(delta * Math.pow(10, dec));
    line1 += ' ' + (ticks > 0 ? '+' : ticks < 0 ? MINUS_SIGN : '') + Math.abs(ticks);
  }
  // ② {n}根K线, 时间跨度
  let line2 = barCount + '根K线';
  const span = seconds == null ? '' : fmtMeasureSpan(seconds);
  if (span) line2 += ', ' + span;
  // ③ 成交量
  const lines = [line1, line2];
  if (volume != null) lines.push('成交量 ' + fmtMeasureVolume(volume));

  return { up, delta, percent, bars: barCount, seconds, volume, fromIndex, toIndex, lines };
}

/** 卡片尺寸：官方 TextRenderer 的 boxHeight / boxWidth 公式（行数、字号可推） */
export function measureLabelBox(maxTextW: number, lineCount: number, font = MEASURE_FONT): { w: number; h: number } {
  const lines = Math.max(1, lineCount);
  return {
    w: Math.ceil(maxTextW) + 2 * MEASURE_INFLATE_X + 2 * MEASURE_BOX_PAD,
    h: lines * font + (lines - 1) * MEASURE_LINE_GAP + 2 * MEASURE_INFLATE_Y + 2 * MEASURE_BOX_PAD,
  };
}

/**
 * 卡片的锚点：官方 calculateLabelPosition —— 水平取两端中点，
 * 竖直贴着**终点**那一侧外侧：起点在终点上方时卡片在上，否则在下。
 */
export function measureLabelAnchor(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  boxH: number,
  paneT: number,
  paneB: number,
  offset = MEASURE_LABEL_OFFSET,
): { x: number; y: number } {
  const x = (p1.x + p2.x) / 2;
  let y = p2.y;
  if (p1.y > p2.y) y = Math.max(paneT + boxH / 2, y - boxH / 2 - offset);
  else y = Math.min(paneB - boxH / 2, y + boxH / 2 + offset);
  return { x, y };
}

/** 测量的两条中线（水平取两端 midY、垂直取 midX），以及各自要不要出箭头 */
export function measureGuides(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): { h: { a: PxPt; b: PxPt; arrow: boolean }; v: { a: PxPt; b: PxPt; arrow: boolean } } {
  const my = Math.round((p1.y + p2.y) / 2);
  const mx = Math.round((p1.x + p2.x) / 2);
  return {
    h: { a: { x: p1.x, y: my }, b: { x: p2.x, y: my }, arrow: Math.abs(p2.x - p1.x) >= MEASURE_ARROW_MIN },
    v: { a: { x: mx, y: p1.y }, b: { x: mx, y: p2.y }, arrow: Math.abs(p2.y - p1.y) >= MEASURE_ARROW_MIN },
  };
}

/* ===========================================================================
 * 2.6 自由笔迹：笔刷 / 荧光笔（对齐 charting_library）
 *
 * 参考库事实（bundles/library.*.js 默认属性表 + lt-pane-views 的 BrushBasePaneView）：
 *   · linetoolbrush:       linecolor = color-sky-blue-500 #00bcd4、linewidth 1、
 *                          linestyle 实线、smooth 5、fillBackground false
 *   · linetoolhighlighter: linecolor = generateColor(color-ripe-red-500 #F23645, 80)
 *                          → rgba(242,54,69,0.2)，smooth 5
 *   · HighlighterPaneView 把 linewidth 写死 20、linecap / linejoin 都是 round；
 *     笔刷只用 linecap round（linejoin 走默认 miter）。两者都**不额外套 globalAlpha** ——
 *     半透明来自颜色本身，再乘一层就会比官方淡一半。
 *   · 采样：LineToolBrushBase.addPoint 里「与上一点的屏幕距离 < 2px 就丢弃这个点」。
 *   · 平滑：每段先按 ≤ smooth 像素重采样（每段最多插 5 个点），
 *     再做半径 = smooth 的箱式模糊（越界邻居夹到端点），最后补一个原始末点收尾。
 *   · 选中态：只在首/末点各画一个「白底 + tv-blue-600 环」的圆点
 *     （SelectionRenderer 在 DPR1 下外径 5.5、内环 3.5），没有包围盒；
 *     也没有可拖手柄 —— LineToolBrushBase.hasEditableCoordinates() === false。
 * ========================================================================= */

/** 笔刷默认色 = color-sky-blue-500 */
export const BRUSH_COLOR = '#00bcd4';
/** 笔刷默认线宽 = linetoolbrush.linewidth */
export const BRUSH_WIDTH = 1;
/** 荧光笔默认色 = generateColor(ripe-red-500, 80) → alpha 0.2 */
export const HIGHLIGHT_COLOR = 'rgba(242,54,69,0.2)';
/** 荧光笔线宽：官方 HighlighterPaneView 里写死的 20 */
export const HIGHLIGHT_WIDTH = 20;
/** 平滑度（官方 smooth 默认 5，同时也是箱式模糊的半径） */
export const STROKE_SMOOTH = 5;
/** 采点最小步长（屏幕像素）：官方 addPoint 丢弃 <2px 的点 */
export const STROKE_MIN_STEP = 2;
/** 选中态端点圆点的内环半径与白底半径（官方 SelectionRenderer @DPR1） */
export const STROKE_ANCHOR_R = 3.5;
export const STROKE_ANCHOR_RING = 5.5;
/** 端点圆点环色 = color-tv-blue-600 */
export const STROKE_ANCHOR_COLOR = '#1e53e5';

/** 自由笔迹类工具（笔刷 / 荧光笔）：走平滑 + 端点圆点这一套 */
export function isFreehand(type: string): boolean {
  return type === 'brush' || type === 'highlight';
}

/**
 * 自由笔迹平滑：官方 BrushBasePaneView._updateImpl + _smoothArray 的等价实现。
 * 输入屏幕坐标点列，输出「重采样 + 箱式模糊 + 补末点」后的点列。
 */
export function smoothStroke(pts: PxPt[], smooth = STROKE_SMOOTH): PxPt[] {
  if (pts.length === 0) return [];
  const s = Math.max(1, smooth);
  // ① 重采样：每段切成 ≤ s 像素的小段（官方 Math.min(5, floor(len / smooth))）
  const res: PxPt[] = [{ x: pts[0].x, y: pts[0].y }];
  for (let n = 1; n < pts.length; n++) {
    const dx = pts[n].x - pts[n - 1].x;
    const dy = pts[n].y - pts[n - 1].y;
    const len = Math.hypot(dx, dy);
    const cnt = Math.min(5, Math.floor(len / s));
    for (let k = 0; k < cnt - 1; k++) {
      res.push({ x: pts[n - 1].x + (dx / cnt) * k, y: pts[n - 1].y + (dy / cnt) * k });
    }
    res.push({ x: pts[n].x, y: pts[n].y });
  }
  if (res.length === 1) return res;
  // ② 箱式模糊：半径 = smooth，r-i / r+i 越界时夹到端点（官方做法，不做环绕）
  const out: PxPt[] = new Array(res.length);
  const k2 = 0.5 / s;
  for (let r = 0; r < res.length; r++) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < s; i++) {
      const a = res[Math.max(r - i, 0)];
      const b = res[Math.min(r + i, res.length - 1)];
      sx += a.x + b.x;
      sy += a.y + b.y;
    }
    out[r] = { x: sx * k2, y: sy * k2 };
  }
  // ③ 官方补一个原始末点：笔迹必须收在松手处，不能被模糊拽回来
  out.push({ x: res[res.length - 1].x, y: res[res.length - 1].y });
  return out;
}

/** 笔迹命中容差：官方 PolygonRenderer.hitTest = max(interactionTolerance().line, ceil(w/2)) */
export function strokeHitTol(width: number): number {
  return Math.max(3, Math.ceil(width / 2));
}

/**
 * 我们的工具 key → 官方 linetoolXXX（`TradingView.defaultProperties` 的键去掉 linetool 前缀）。
 * 只收「语义确定」的对应关系；官方没有同义工具的（dot/curve/hyperbola/tiltfan/xabcd…）
 * 不进表，落回 drawStyle() 的蓝色默认。
 */
export const TV_TOOL_KEY: Record<string, string> = {
  trend: 'trendline',
  hline: 'horzline',
  vline: 'vertline',
  ray: 'ray',
  hray: 'horzray',
  extline: 'extended',
  arrow: 'arrow',
  rect: 'rectangle',
  ellipse: 'ellipse',
  triangle: 'triangle',
  channel: 'parallelchannel',
  fib: 'fibretracement',
  text: 'text',
  infoline: 'infoline',
  angle: 'trendangle',
  crossline: 'crossline',
  fibext: 'trendbasedfibextension',
  fibchannel: 'fibchannel',
  fibtz: 'fibtimezone',
  fibfan: 'fibspeedresistancefan',
  fibttz: 'trendbasedfibtime',
  fibcirc: 'fibcircles',
  fibspiral: 'fibspiral',
  fibarc: 'fibspeedresistancearcs',
  fibwedge: 'fibwedge',
  gannsqf: 'gannfixed',
  gannsq: 'gannsquare',
  hs: 'headandshoulders',
  abcd: 'abcd',
  tri: 'trianglepattern',
  shark: 'cypherpattern',
  threedrives: 'threedrivers',
  ewimpulse: 'elliottimpulse',
  ewcorrection: 'elliottcorrection',
  ewtriangle: 'elliotttriangle',
  ewdouble: 'elliottdoublecombo',
  ewtriple: 'elliotttriplecombo',
  timecycle: 'timecycles',
  sine: 'sineline',
  longpos: 'riskrewardlong',
  shortpos: 'riskrewardshort',
  forecast: 'prediction',
  kpattern: 'barspattern',
  brush: 'brush',
  highlight: 'highlighter',
  arrowmark: 'arrowmarker',
  uparrow: 'arrowmarkup',
  downarrow: 'arrowmarkdown',
  rotrect: 'rotatedrectangle',
  path: 'path',
  circle: 'circle',
  polyline: 'polyline',
  arc: 'arc',
  pitchfork: 'pitchfork',
  schiff: 'schiffpitchfork',
  schiff2: 'schiffpitchfork2',
  innerfork: 'insidepitchfork',
  pitchfan: 'pitchfan',
  note: 'note',
  callout: 'callout',
  comment: 'comment',
  balloon: 'balloon',
  pricenote: 'pricenote',
  pricelabel: 'pricelabel',
  signpost: 'signpost',
  circlelines: 'circlelines',
  beziercubic: 'beziercubic',
  flatbottom: 'flatbottom',
  arrowmarl: 'arrowmarkleft',
  arrowmarr: 'arrowmarkright',
};

/** 官方虚线口径（LINESTYLE_SOLID/DASHED/DOTTED）→ canvas dash */
const DASH_OF: Record<string, number[]> = { solid: [], dashed: [8, 5], dotted: [2, 4] };

type TvToolDefault = {
  color?: string;
  fillColor?: string;
  linewidth?: number;
  linestyle?: string;
  fillBackground?: boolean;
  fontSize?: number;
  medianColor?: string;
  nestedColor?: string;
};

const TV_DEFAULTS: Record<string, TvToolDefault> =
  (TV_TOOL_DEFAULTS as unknown as { tools: Record<string, TvToolDefault> }).tools;

/** 官方默认样式；没有对应工具时返回 null */
export function tvToolStyle(key: string): Partial<DrawStyle> | null {
  const name = TV_TOOL_KEY[key];
  const d = name ? TV_DEFAULTS[name] : undefined;
  if (!d) return null;
  const out: Partial<DrawStyle> = {};
  // 音叉的主色在 median 上、斐波那契/回归在主色在 trendline / styles 里
  const color = d.color || d.medianColor || d.nestedColor;
  if (color) out.color = color;
  if (typeof d.linewidth === 'number') out.width = d.linewidth;
  if (d.linestyle) out.dash = (DASH_OF[d.linestyle] || []).slice();
  // 官方的 fill 只由 backgroundColor 决定；fillBackground=false 就是不填
  if (d.fillBackground === true && d.fillColor) out.fill = d.fillColor;
  else if (d.fillBackground === false) out.fill = 'transparent';
  if (typeof d.fontSize === 'number') out.fontSize = d.fontSize;
  return out;
}

/** 按工具给默认样式（官方默认属性表）；显式 patch 优先 */
export function styleForTool(type: string, patch?: Partial<DrawStyle>): DrawStyle {
  const s = drawStyle();
  const off = tvToolStyle(type);
  if (off) Object.assign(s, off);
  // 笔刷/荧光笔的线宽在官方的 PaneView 里另有定值（荧光笔写死 20）
  if (type === 'brush') {
    s.color = BRUSH_COLOR;
    s.width = BRUSH_WIDTH;
    s.dash = [];
  } else if (type === 'highlight') {
    s.color = HIGHLIGHT_COLOR;
    s.width = HIGHLIGHT_WIDTH;
    s.dash = [];
    s.fill = 'transparent';
  }
  return Object.assign(s, patch || {});
}

/* ===========================================================================
 * 3. 几何小工具（纯函数，好测）
 * ========================================================================= */

/** 点到线段的距离（像素空间） */
export function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** 把射线从 (x0,y0) 经 (x1,y1) 延伸到 x = edgeX */
export function rayToX(x0: number, y0: number, x1: number, y1: number, edgeX: number): { x: number; y: number } {
  if (x1 === x0) return { x: x0, y: y0 };
  const k = (edgeX - x0) / (x1 - x0);
  return { x: edgeX, y: y0 + k * (y1 - y0) };
}

export function inRect(px: number, py: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const l = Math.min(x0, x1);
  const r = Math.max(x0, x1);
  const t = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  return px >= l && px <= r && py >= t && py <= b;
}

/** 点在三角形内（含边缘）：三条边的叉积同号即在内 */
export function inTriangle(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): boolean {
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
}

/**
 * 点在平行四边形内：以 a 为原点、ab / ad 两个边向量做参数化，
 * 两个投影参数都落在 [0,1] 即在内。channel 的命中用这个。
 */
export function inParallelogram(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number, dx: number, dy: number,
): boolean {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const dotAB = abx * abx + aby * aby;
  const t = dotAB ? (apx * abx + apy * aby) / dotAB : 0;
  const dotDD = dx * dx + dy * dy;
  const u = dotDD ? (apx * dx + apy * dy) / dotDD : 0;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** 圆弧采样折线：中心 (cx,cy)、半径 r、角 a0→a1（弧度，屏幕坐标 y 向下）、seg 段 */
export function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, seg = 32): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= seg; i++) {
    const ang = a0 + (a1 - a0) * (i / seg);
    out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
  }
  return out;
}

/** 对数螺旋采样：中心 (cx,cy)、起始半径 r0、每 90° 半径增长 g、共 turns 圈 */
export function spiralPts(cx: number, cy: number, r0: number, g: number, turns = 1.5, seg = 72): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i <= seg; i++) {
    const ang = (i / seg) * turns * Math.PI * 2;
    const r = r0 * Math.pow(g, ang / (Math.PI / 2));
    out.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
  }
  return out;
}

/** 点到折线的最短距离 */
export function distToPolyline(px: number, py: number, pts: { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSeg(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < best) best = d;
  }
  return best;
}

/* ===========================================================================
 * 4. 绘图层
 * ========================================================================= */

export class DrawLayer {
  host: DrawHost;
  tool: string;
  drawings: Drawing[];
  activeId: number | null;
  magnet: boolean;
  hidden: boolean;
  /** emoji 工具待放置的字符（由左侧「图标」面板选中后经 drawBus 同步） */
  emojiChar = '😀';
  /** 「重复绘制」：画完一个图形后不切回光标，继续用当前工具（设计稿浮动条 aria-pressed 按钮） */
  repeatDraw = false;
  /**
   * 橡皮擦悬停到的图形（只影响**渲染**：画它的锚点方块 + 置顶，和官方
   * `setHoveredSource` → `areAnchorsVisible()` 同一套口径）。
   * 不改选中态、不接管拖动 —— 松开鼠标它就该消失。
   */
  hoverId: number | null = null;

  private nextId: number;
  private pending: Drawing | null;
  /** 待定图形已放置的锚点数（≥1）。三点工具（三角形 / 平行通道）要放满 3 个才成型 */
  private pendingPlaced: number;
  private drag: { d: Drawing; part: number | string; orig: DrawAnchor[]; px: number; py: number } | null = null;
  private snapshots: string[];
  private redoStack: string[];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private listeners: { el: EventTarget; type: string; fn: any }[] = [];

  constructor(host: DrawHost) {
    this.host = host;
    this.tool = 'cursor';
    this.drawings = [];
    this.activeId = null;
    this.magnet = false;
    this.hidden = false;
    this.nextId = 1;
    this.pending = null;
    this.pendingPlaced = 0;
    this.snapshots = [];
    this.redoStack = [];
  }

  /* ---------------------------------------------------------- 坐标换算 */

  /**
   * 时间 → 像素 x。在相邻两根 bar 之间**线性插值**，
   * 不然放大到一根 bar 很宽时，画的东西会一格一格地跳。
   */
  timeToX(t: number): number {
    const ch = this.host;
    const b = ch.bars;
    if (!b.length) return ch.plot.l;
    if (t <= b[0].time) return ch.xCenter(0);
    if (t >= b[b.length - 1].time) return ch.xCenter(b.length - 1);
    const i = ch.indexAtTime(t);
    if (i >= b.length - 1) return ch.xCenter(b.length - 1);
    const t0 = b[i].time;
    const t1 = b[i + 1].time;
    const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    return ch.xCenter(i) + f * (ch.xCenter(i + 1) - ch.xCenter(i));
  }

  /** 像素 x → 时间。和 timeToX 互为反函数（iOf(xCenter(i)) === i + 0.5）。 */
  xToTime(px: number): number {
    const ch = this.host;
    const b = ch.bars;
    if (!b.length) return 0;
    const fi = ch.iOf(px) - 0.5;
    const i = Math.floor(fi);
    const f = fi - i;
    if (i < 0) return b[0].time;
    if (i >= b.length - 1) return b[b.length - 1].time;
    return b[i].time + f * (b[i + 1].time - b[i].time);
  }

  /** 像素点 → 锚点（考虑磁吸） */
  anchorAt(px: number, py: number): DrawAnchor {
    const ch = this.host;
    let time = this.xToTime(px);
    let price = ch.pOf(py);
    if (!this.magnet || !ch.bars.length) return { time, price };
    const i = ch.indexAtTime(time);
    const b = ch.bars[i];
    if (!b) return { time, price };
    const cands = [b.open, b.high, b.low, b.close];
    let best = price;
    let bd = Infinity;
    for (const c of cands) {
      const d = Math.abs(c - price);
      if (d < bd) { bd = d; best = c; }
    }
    // 只在「够近」时吸附 —— 否则鼠标在两根 bar 中间会被硬拽过去，很难画
    const span = ch.scale.max - ch.scale.min || 1;
    if (bd > span * 0.08) return { time, price };
    return { time: b.time, price: best };
  }

  /* ------------------------------------------------------------ 像素几何 */

  /** 某个 drawing 在像素空间的端点；返回 null 表示当前不可见 */
  pixelPts(d: Drawing): { x: number; y: number }[] {
    const ch = this.host;
    const out: { x: number; y: number }[] = [];
    for (const p of d.pts) out.push({ x: this.timeToX(p.time), y: ch.yOf(p.price) });
    return out;
  }

  /* -------------------------------------------------------------- 命中 */

  /** 某条档位是否已被橡皮擦擦掉（官方 `properties().child('levelN').visible === false`） */
  private levelHidden(d: Drawing, i: number): boolean {
    return !!d.style.hiddenLevels && d.style.hiddenLevels.includes(i);
  }

  /**
   * 曲线类工具（螺旋/弧/楔形）的采样折线（渲染与命中共用一套几何）。
   * 弧半径 = ratio * |ab|；楔形再补两条边界射线。
   */
  private curvePolylines(d: Drawing, a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[][] {
    const R = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 2);
    const th = Math.atan2(b.y - a.y, b.x - a.x);
    if (d.type === 'fibarc') {
      // 朝趋势方向的半圆弧组
      return FIB_RATIOS.map((r) => arcPts(a.x, a.y, r * R, th - Math.PI / 2, th + Math.PI / 2));
    }
    if (d.type === 'fibwedge') {
      // 楔形：趋势方向 90° 扇区内的 3 条 fib 弧 + 两条边界射线
      const arcs = [0.382, 0.618, 1].map((r) => arcPts(a.x, a.y, r * R, th, th + Math.PI / 2));
      for (const ang of [th, th + Math.PI / 2]) {
        arcs.push([a, { x: a.x + R * Math.cos(ang), y: a.y + R * Math.sin(ang) }]);
      }
      return arcs;
    }
    // 斐波那契螺旋：从中心按 φ/90° 长出约 1.5 圈，最外半径 ≈ |ab|
    return [spiralPts(a.x, a.y, Math.max(R * 0.05, 2), 1.618)];
  }

  /** 江恩网格的几何（箱/固定正方/正方共用）：1/8 网格线 + 两条对角线 + 外框 */
  private gannLines(x0: number, y0: number, x1: number, y1: number): { x1: number; y1: number; x2: number; y2: number }[] {
    const l = Math.min(x0, x1);
    const r = Math.max(x0, x1);
    const t = Math.min(y0, y1);
    const b = Math.max(y0, y1);
    const w = r - l;
    const h = b - t;
    const out: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const dv of GANN_DIVS) {
      if (dv > 0 && dv < 1) {
        out.push({ x1: l + w * dv, y1: t, x2: l + w * dv, y2: b });
        out.push({ x1: l, y1: t + h * dv, x2: r, y2: t + h * dv });
      }
    }
    out.push({ x1: l, y1: t, x2: r, y2: b });
    out.push({ x1: r, y1: t, x2: l, y2: b });
    out.push({ x1: l, y1: t, x2: r, y2: t });
    out.push({ x1: r, y1: t, x2: r, y2: b });
    out.push({ x1: r, y1: b, x2: l, y2: b });
    out.push({ x1: l, y1: b, x2: l, y2: t });
    return out;
  }

  /**
   * 命中检测。返回 `{ d, part }`：
   *   part 是 'body'（整条线/整个框）或锚点下标（0/1，拖手柄改形状）。
   */
  hitTest(px: number, py: number): { d: Drawing; part: number | string } | null {
    const ch = this.host;
    const tol = 5;
    // 从后往前测：后画的在上面。锁定的图形也参与命中 —— 选中它才好弹属性工具条去解锁，
    // 「不能动」由 onDown 的 drag 分支保证（见 ③）
    for (let k = this.drawings.length - 1; k >= 0; k--) {
      const d = this.drawings[k];
      if (!d.visible || this.hidden) continue;
      const p = this.pixelPts(d);
      if (!p.length) continue;

      // 先测手柄（选中态才有），手柄优先级最高。荧光笔/笔刷是自由笔迹，只整体拖动，不提供逐锚点手柄；
      // emoji 的中点是「位置」不是手柄，它只给四个角手柄（拖角改字号）
      if (this.activeId === d.id && d.type !== 'highlight' && d.type !== 'brush' && d.type !== 'emoji') {
        for (let i = 0; i < p.length; i++) {
          if (Math.abs(px - p[i].x) <= tol && Math.abs(py - p[i].y) <= tol) {
            return { d, part: i };
          }
        }
      }
      // emoji 的四个角手柄（白圆点），比通用方块手柄大好点中
      if (this.activeId === d.id && d.type === 'emoji') {
        const sz = d.style.fontSize || EMOJI_SIZE;
        const corners = emojiCornerPts(p[0].x, p[0].y, sz);
        for (let i = 0; i < corners.length; i++) {
          if (Math.hypot(px - corners[i].x, py - corners[i].y) <= EMOJI_KNOB_R + 3) {
            return { d, part: EMOJI_CORNERS[i] };
          }
        }
      }

      const a = p[0];
      const b = p[1] || p[0];
      const c = p[2] || p[1] || p[0];
      if (d.type === 'hline') {
        if (Math.abs(py - a.y) <= tol) return { d, part: 'body' };
      } else if (d.type === 'dot') {
        // 圆心附近（半径 4px + 容差）
        if (Math.hypot(px - a.x, py - a.y) <= 4 + tol) return { d, part: 'body' };
      } else if (isFreehand(d.type)) {
        // 自由笔迹：按**平滑后**的轨迹算距离（和画出来的一致，不会出现「看着在线上却点不中」）。
        // 容差照官方 PolygonRenderer.hitTest：max(3, ceil(linewidth/2)) ——
        // 于是荧光笔（宽 20）的点击带是 ±10px，笔刷（宽 1）只有 ±3px。
        const fw = Math.max(1, d.style.width || (d.type === 'highlight' ? HIGHLIGHT_WIDTH : BRUSH_WIDTH));
        const ftol = strokeHitTol(fw);
        const sp = smoothStroke(p, STROKE_SMOOTH);
        if (sp.length === 1) {
          if (Math.hypot(px - sp[0].x, py - sp[0].y) <= ftol) return { d, part: 'body' };
        } else {
          for (let i = 0; i < sp.length - 1; i++) {
            if (distToSeg(px, py, sp[i].x, sp[i].y, sp[i + 1].x, sp[i + 1].y) <= ftol) return { d, part: 'body' };
          }
        }
      } else if (d.type === 'arrowmark' || d.type === 'uparrow' || d.type === 'downarrow') {
        // 单击标记：以锚点为中心的字形包围盒
        const s = d.type === 'arrowmark' ? MARKER_SIZE * 1.15 : MARKER_SIZE;
        if (Math.abs(px - a.x) <= s * 0.75 + tol && Math.abs(py - a.y) <= s + tol) return { d, part: 'body' };
      } else if (d.type === 'hray') {
        // 从锚点向右的半条水平线
        if (distToSeg(px, py, a.x, a.y, ch.plot.r + 50, a.y) <= tol) return { d, part: 'body' };
      } else if (d.type === 'vline') {
        if (Math.abs(px - a.x) <= tol) return { d, part: 'body' };
      } else if (d.type === 'crossline') {
        // 横线 = 过锚点的水平线 + 垂直线（十字）
        if (Math.abs(py - a.y) <= tol || Math.abs(px - a.x) <= tol) return { d, part: 'body' };
      } else if (d.type === 'extline') {
        // 两端都延伸出绘图区
        const l = rayToX(a.x, a.y, b.x, b.y, ch.plot.l - 50);
        const r = rayToX(a.x, a.y, b.x, b.y, ch.plot.r + 50);
        if (distToSeg(px, py, l.x, l.y, r.x, r.y) <= tol) return { d, part: 'body' };
      } else if (d.type === 'ellipse') {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const rx = Math.abs(b.x - a.x) / 2;
        const ry = Math.abs(b.y - a.y) / 2;
        if (rx < 1 || ry < 1) {
          // 退化成线段
          if (distToSeg(px, py, a.x, a.y, b.x, b.y) <= tol) return { d, part: 'body' };
        } else {
          // 标准化椭圆方程；1.08 ≈ 边缘容差（短轴 40px 时约 2px）
          const v = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
          if (v <= 1.08) return { d, part: 'body' };
        }
      } else if (d.type === 'triangle') {
        const onEdge =
          distToSeg(px, py, a.x, a.y, b.x, b.y) <= tol ||
          distToSeg(px, py, b.x, b.y, c.x, c.y) <= tol ||
          distToSeg(px, py, c.x, c.y, a.x, a.y) <= tol;
        if (onEdge || inTriangle(px, py, a.x, a.y, b.x, b.y, c.x, c.y)) return { d, part: 'body' };
      } else if (d.type === 'channel') {
        // 通道 = ab 线段沿 (c - a) 平移出的平行四边形；两条边线或内部都算命中
        const wx = c.x - a.x;
        const wy = c.y - a.y;
        const onEdge =
          distToSeg(px, py, a.x, a.y, b.x, b.y) <= tol ||
          distToSeg(px, py, a.x + wx, a.y + wy, b.x + wx, b.y + wy) <= tol;
        if (onEdge || inParallelogram(px, py, a.x, a.y, b.x, b.y, wx, wy)) return { d, part: 'body' };
      } else if (d.type === 'rect' || d.type === 'measure') {
        // 边框 或 内部
        const onEdge =
          distToSeg(px, py, a.x, a.y, b.x, a.y) <= tol ||
          distToSeg(px, py, b.x, a.y, b.x, b.y) <= tol ||
          distToSeg(px, py, b.x, b.y, a.x, b.y) <= tol ||
          distToSeg(px, py, a.x, b.y, a.x, a.y) <= tol;
        if (onEdge || inRect(px, py, a.x, a.y, b.x, b.y)) return { d, part: 'body' };
      } else if (d.type === 'ray') {
        const e = rayToX(a.x, a.y, b.x, b.y, ch.plot.r + 50);
        if (distToSeg(px, py, a.x, a.y, e.x, e.y) <= tol) return { d, part: 'body' };
      } else if (d.type === 'fib') {
        // 任意一条水平档位线；part 带上档位下标，⌘/Ctrl + 橡皮擦才知道要擦哪一条
        for (let i = 0; i < FIB_LEVELS.length; i++) {
          if (this.levelHidden(d, i)) continue;
          const y = a.y + FIB_LEVELS[i].l * (b.y - a.y);
          if (distToSeg(px, py, Math.min(a.x, b.x), y, Math.max(a.x, b.x), y) <= tol) {
            return { d, part: 'level:' + i };
          }
        }
      } else if (d.type === 'fibext') {
        // 档位横跨整个绘图区的水平线（价格锚定 p2，单位价差 = p1-p0）
        const dp = d.pts[1].price - d.pts[0].price;
        for (let i = 0; i < FIB_EXT_LEVELS.length; i++) {
          if (this.levelHidden(d, i)) continue;
          const y = ch.yOf(d.pts[2].price + FIB_EXT_LEVELS[i].l * dp);
          if (distToSeg(px, py, ch.plot.l, y, ch.plot.r, y) <= tol) return { d, part: 'level:' + i };
        }
      } else if (d.type === 'fibchannel') {
        // 基线 p0→p1 沿宽度向量 (p2-p0) 的斐波那契倍数平移出的平行线（两端延伸出绘图区）
        const wx = c.x - a.x;
        const wy = c.y - a.y;
        for (let i = 0; i < FIB_CHANNEL_R.length; i++) {
          if (this.levelHidden(d, i)) continue;
          const r = FIB_CHANNEL_R[i];
          const sx = a.x + wx * r;
          const sy = a.y + wy * r;
          const ex = b.x + wx * r;
          const ey = b.y + wy * r;
          const l = rayToX(sx, sy, ex, ey, ch.plot.l - 50);
          const rt = rayToX(sx, sy, ex, ey, ch.plot.r + 50);
          if (distToSeg(px, py, l.x, l.y, rt.x, rt.y) <= tol) return { d, part: 'level:' + i };
        }
      } else if (d.type === 'fibtz' || d.type === 'fibttz') {
        // 垂直线组：时区单位 = |p1.x-p0.x| 从 p0 起；趋势时间单位 = p1.x-p0.x 从 p2 起
        const unit = b.x - a.x;
        const origin = d.type === 'fibtz' ? a.x : c.x;
        if (Math.abs(px - origin) <= tol) return { d, part: 'level:0' };
        for (let i = 0; i < FIB_EXTENSIONS.length; i++) {
          if (this.levelHidden(d, i + 1)) continue;
          if (Math.abs(px - (origin + FIB_EXTENSIONS[i] * unit)) <= tol) return { d, part: 'level:' + (i + 1) };
        }
      } else if (d.type === 'fibfan') {
        // 从 p0 出发、穿过 (p1.x, p0.y + r*(p1.y-p0.y)) 的射线组
        const rays = [0, ...FIB_RATIOS];
        for (let i = 0; i < rays.length; i++) {
          if (this.levelHidden(d, i)) continue;
          const e = rayToX(a.x, a.y, b.x, a.y + rays[i] * (b.y - a.y), ch.plot.r + 50);
          if (distToSeg(px, py, a.x, a.y, e.x, e.y) <= tol) return { d, part: 'level:' + i };
        }
      } else if (d.type === 'fibcirc') {
        // 同心圆：圆心 p0，半径 r*|p0p1|
        const R = Math.hypot(b.x - a.x, b.y - a.y);
        const rr = Math.hypot(px - a.x, py - a.y);
        for (const r of FIB_RATIOS) {
          if (Math.abs(rr - r * R) <= tol + 1) return { d, part: 'body' };
        }
      } else if (d.type === 'fibspiral' || d.type === 'fibarc' || d.type === 'fibwedge') {
        // 曲线类统一按采样折线命中
        for (const poly of this.curvePolylines(d, a, b)) {
          if (distToPolyline(px, py, poly) <= tol) return { d, part: 'body' };
        }
      } else if (d.type === 'tiltfan') {
        // 以趋势方向为基准 ±60°/±30°/0° 的射线扇
        const th = Math.atan2(b.y - a.y, b.x - a.x);
        const R = ch.plot.w + ch.plot.h;
        for (const off of [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]) {
          const x2 = a.x + R * Math.cos(th + off);
          const y2 = a.y + R * Math.sin(th + off);
          if (distToSeg(px, py, a.x, a.y, x2, y2) <= tol) return { d, part: 'body' };
        }
      } else if (d.type === 'gannbox' || d.type === 'gannsqf' || d.type === 'gannsq') {
        // 江恩箱：矩形网格；固定正方/正方：以 |dx|,|dy| 的较大值为边长的正方形
        let ex = b.x;
        let ey = b.y;
        if (d.type !== 'gannbox') {
          const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
          ex = a.x + (b.x >= a.x ? side : -side);
          ey = a.y + (b.y >= a.y ? side : -side);
        }
        for (const s of this.gannLines(a.x, a.y, ex, ey)) {
          if (distToSeg(px, py, s.x1, s.y1, s.x2, s.y2) <= tol) return { d, part: 'body' };
        }
        if (inRect(px, py, a.x, a.y, ex, ey)) return { d, part: 'body' };
      } else if (PATTERN_LABELS[d.type]) {
        // 形态/波浪类：折线段上或锚点附近
        if (distToPolyline(px, py, p) <= tol) return { d, part: 'body' };
      } else if (d.type === 'cycle' || d.type === 'timecycle') {
        // 循环线（每周期一对垂直线）/ 时间循环（每周期一根）
        const unit = b.x - a.x;
        const n = d.type === 'cycle' ? CYCLE_COUNT : TIMECYCLE_COUNT;
        for (let i = 0; i < n; i++) {
          const xs = d.type === 'cycle'
            ? [a.x + i * unit, a.x + i * unit + unit * CYCLE_PAIR_OFF]
            : [a.x + i * unit];
          for (const x of xs) {
            if (Math.abs(px - x) <= tol) return { d, part: 'body' };
          }
        }
      } else if (d.type === 'sine') {
        if (distToPolyline(px, py, sinePts(a.x, a.y, b.x, b.y)) <= tol) return { d, part: 'body' };
      } else if (d.type === 'longpos' || d.type === 'shortpos') {
        // 双箱：目标箱（入场→目标）与止损箱（入场→止损），时间跨度取 p0..p1
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const tgtY = ch.yOf(d.pts[0].price + (d.pts[0].price - d.pts[1].price) * POS_RR);
        if (inRect(px, py, x0, a.y, x1, tgtY) || inRect(px, py, x0, a.y, x1, b.y)) return { d, part: 'body' };
      } else if (d.type === 'forecast') {
        if (distToPolyline(px, py, p) <= tol) return { d, part: 'body' };
      } else if (d.type === 'kpattern') {
        const cs = kpatternCandles(a.x, a.y);
        const last = cs[cs.length - 1];
        if (inRect(px, py, a.x - 6, a.y - KPATTERN_H - 6, last.x + last.w + 6, a.y + 8)) return { d, part: 'body' };
      } else if (d.type === 'simcandle') {
        const cs = simCandlePx(a.x, a.y, b.x, b.y);
        let mnY = Infinity;
        let mxY = -Infinity;
        for (const k of cs) { mnY = Math.min(mnY, k.h); mxY = Math.max(mxY, k.l); }
        if (inRect(px, py, Math.min(a.x, b.x), mnY, Math.max(a.x, b.x), mxY)) return { d, part: 'body' };
      } else if (d.type === 'fan') {
        // 基线 ± FAN_DEG 的射线 + 同半径连接弧
        const th = Math.atan2(b.y - a.y, b.x - a.x);
        const R = ch.plot.w + ch.plot.h;
        for (const deg of FAN_DEG) {
          const a2 = th + (deg * Math.PI) / 180;
          if (distToSeg(px, py, a.x, a.y, a.x + R * Math.cos(a2), a.y + R * Math.sin(a2)) <= tol) {
            return { d, part: 'body' };
          }
        }
        const r = Math.hypot(b.x - a.x, b.y - a.y);
        if (r > 2) {
          const degs = FAN_DEG.map((v) => (v * Math.PI) / 180);
          const arc = arcPts(a.x, a.y, r, th + Math.min(...degs), th + Math.max(...degs));
          if (distToPolyline(px, py, arc) <= tol) return { d, part: 'body' };
        }
      } else if (d.type === 'avwap') {
        // 锚点 → 最后一根 bar 的 VWAP 曲线
        const i0 = ch.indexAtTime(d.pts[0].time);
        const series = vwapSeries(ch.bars, i0);
        const poly = series.map((v, i) => ({ x: ch.xCenter(i0 + i), y: ch.yOf(v) }));
        if (distToPolyline(px, py, poly) <= tol) return { d, part: 'body' };
      } else if (d.type === 'vprofile' || d.type === 'dprange') {
        // 直方图区 / 双范围框：矩形边框或内部
        const onEdge =
          distToSeg(px, py, a.x, a.y, b.x, a.y) <= tol ||
          distToSeg(px, py, b.x, a.y, b.x, b.y) <= tol ||
          distToSeg(px, py, b.x, b.y, a.x, b.y) <= tol ||
          distToSeg(px, py, a.x, b.y, a.x, a.y) <= tol;
        if (onEdge || inRect(px, py, a.x, a.y, b.x, b.y)) return { d, part: 'body' };
      } else if (d.type === 'avprofile') {
        const i0 = ch.indexAtTime(d.pts[0].time);
        let mn = Infinity;
        let mx = -Infinity;
        for (let i = i0; i < ch.bars.length; i++) {
          if (ch.bars[i].low < mn) mn = ch.bars[i].low;
          if (ch.bars[i].high > mx) mx = ch.bars[i].high;
        }
        if (inRect(px, py, a.x, ch.yOf(mx), Math.min(a.x + VP_WIDTH, ch.plot.r), ch.yOf(mn))) {
          return { d, part: 'body' };
        }
      } else if (d.type === 'prange') {
        // 竖线 + 上下端帽
        if (distToSeg(px, py, a.x, a.y, a.x, b.y) <= tol) return { d, part: 'body' };
        if (distToSeg(px, py, a.x - 8, a.y, a.x + 8, a.y) <= tol) return { d, part: 'body' };
        if (distToSeg(px, py, a.x - 8, b.y, a.x + 8, b.y) <= tol) return { d, part: 'body' };
      } else if (d.type === 'drange') {
        // 横线 + 左右端帽
        if (distToSeg(px, py, a.x, a.y, b.x, a.y) <= tol) return { d, part: 'body' };
        if (distToSeg(px, py, a.x, a.y - 8, a.x, a.y + 8) <= tol) return { d, part: 'body' };
        if (distToSeg(px, py, b.x, a.y - 8, b.x, a.y + 8) <= tol) return { d, part: 'body' };
      } else if (d.type === 'rotrect') {
        // 旋转矩形：p0p1 一条边，p2 定高度（off = p2 - p0 的平行四边形，两邻边垂直时即旋转矩形）
        const wx = c.x - a.x;
        const wy = c.y - a.y;
        const onEdge =
          distToSeg(px, py, a.x, a.y, b.x, b.y) <= tol ||
          distToSeg(px, py, b.x, b.y, b.x + wx, b.y + wy) <= tol ||
          distToSeg(px, py, b.x + wx, b.y + wy, a.x + wx, a.y + wy) <= tol ||
          distToSeg(px, py, a.x + wx, a.y + wy, a.x, a.y) <= tol;
        if (onEdge || inParallelogram(px, py, a.x, a.y, b.x, b.y, wx, wy)) return { d, part: 'body' };
      } else if (d.type === 'path' || d.type === 'polyline' || d.type === 'hyperbola') {
        // 多段折线 / 双曲线两支：任意一段附近（双曲线两支分开测，拼接连线不算图形）
        if (d.type === 'hyperbola') {
          const hp = hyperbolaPts(a.x, a.y, b.x, b.y);
          const half = hp.length / 2;
          if (distToPolyline(px, py, hp.slice(0, half)) <= tol) return { d, part: 'body' };
          if (distToPolyline(px, py, hp.slice(half)) <= tol) return { d, part: 'body' };
        } else if (d.type === 'polyline') {
          if (distToPolyline(px, py, [...p, p[0]]) <= tol) return { d, part: 'body' }; // 折线闭合
        } else {
          if (distToPolyline(px, py, p) <= tol) return { d, part: 'body' };
        }
      } else if (d.type === 'circle') {
        // 圆：圆心 a、半径 |ab|；圆环带内或圆内（与椭圆一致的「内部也算」策略）
        const r = Math.hypot(b.x - a.x, b.y - a.y);
        if (Math.hypot(px - a.x, py - a.y) <= r + tol) return { d, part: 'body' };
      } else if (d.type === 'arc') {
        // 弧形：外接框的椭圆四分之一弧（右上开口，与 fibarc 同向）
        const rx = Math.abs(b.x - a.x) / 2;
        const ry = Math.abs(b.y - a.y) / 2;
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        if (distToPolyline(px, py, ellipseArcPts(cx, cy, rx, ry, 0, -Math.PI / 2)) <= tol) {
          return { d, part: 'body' };
        }
      } else if (d.type === 'curve') {
        // 曲线：二次贝塞尔（p1 为控制点）
        if (distToPolyline(px, py, quadBezierPts(a, b, c)) <= tol) return { d, part: 'body' };
      } else if (d.type === 'pitchfork' || d.type === 'schiff' || d.type === 'schiff2'
        || d.type === 'innerfork' || d.type === 'pitchfan') {
        // 音叉族：任意一条射线带内（与渲染同一几何来源）
        const rays = pitchforkRays(d.type, a, b, c);
        for (const r of rays) {
          const e = rayToX(r.o.x, r.o.y, r.d.x, r.d.y, ch.plot.r + 40);
          if (distToSeg(px, py, r.o.x, r.o.y, e.x, e.y) <= tol) return { d, part: 'body' };
        }
      } else if (d.type === 'note' || d.type === 'callout' || d.type === 'comment'
        || d.type === 'balloon' || d.type === 'pricenote' || d.type === 'pricelabel' || d.type === 'signpost') {
        // 文本类标注：卡片矩形内或锚点附近
        const bx = this.cardBox(d, a);
        if (inRect(px, py, bx.x, bx.y, bx.x + bx.w, bx.y + bx.h)) return { d, part: 'body' };
        if (Math.hypot(px - a.x, py - a.y) <= tol + 4) return { d, part: 'body' };
      } else if (d.type === 'circlelines') {
        // 圆环带内或十字线附近
        const r = Math.hypot(b.x - a.x, b.y - a.y);
        if (Math.abs(Math.hypot(px - a.x, py - a.y) - r) <= tol) return { d, part: 'body' };
        if (Math.abs(py - a.y) <= tol || Math.abs(px - a.x) <= tol) return { d, part: 'body' };
      } else if (d.type === 'beziercubic') {
        // 三次贝塞尔采样折线
        if (distToPolyline(px, py, cubicBezierPts(a, b, c, p[3] || c)) <= tol) return { d, part: 'body' };
      } else if (d.type === 'flatbottom') {
        // 平底三角形：三条边或内部
        const x0 = Math.min(a.x, b.x);
        const x1 = Math.max(a.x, b.x);
        const yb = Math.max(a.y, b.y);
        const apex = { x: (x0 + x1) / 2, y: yb - Math.abs(x1 - x0) * 0.6 };
        const onEdge =
          distToSeg(px, py, apex.x, apex.y, x1, yb) <= tol ||
          distToSeg(px, py, x1, yb, x0, yb) <= tol ||
          distToSeg(px, py, x0, yb, apex.x, apex.y) <= tol;
        if (onEdge || inTriangle(px, py, apex.x, apex.y, x1, yb, x0, yb)) return { d, part: 'body' };
      } else if (d.type === 'arrowmarl' || d.type === 'arrowmarr') {
        // 左右箭头：横放的字形包围盒（宽 = s，高 = 0.75s）
        if (Math.abs(px - a.x) <= MARKER_SIZE + tol && Math.abs(py - a.y) <= MARKER_SIZE * 0.75 + tol) {
          return { d, part: 'body' };
        }
      } else if (d.type === 'text') {
        const w = Math.max(24, d.style.text.length * 7);
        if (inRect(px, py, a.x - 2, a.y - 10, a.x + w, a.y + 6)) return { d, part: 'body' };
      } else if (d.type === 'emoji') {
        // emoji 标注：以锚点为中心、边长 = 字号 的方形热区（拖角改字号后热区跟着变）
        const h = (d.style.fontSize || EMOJI_SIZE) / 2;
        if (inRect(px, py, a.x - h, a.y - h, a.x + h, a.y + h)) return { d, part: 'body' };
      } else {
        if (distToSeg(px, py, a.x, a.y, b.x, b.y) <= tol) return { d, part: 'body' };
      }
    }
    return null;
  }

  /* ---------------------------------------------------------- 增删改查 */

  find(id: number): Drawing | null {
    for (const d of this.drawings) if (d.id === id) return d;
    return null;
  }

  active(): Drawing | null {
    return this.activeId == null ? null : this.find(this.activeId);
  }

  add(type: string, pts: DrawAnchor[], style?: Partial<DrawStyle>): Drawing {
    this.pushHistory();
    const d: Drawing = {
      id: this.nextId++,
      type,
      pts: pts.map((p) => ({ time: p.time, price: p.price })),
      style: styleForTool(type, style),
      locked: false,
      visible: true,
    };
    this.drawings.push(d);
    this.activeId = d.id;
    this.host.invalidate();
    return d;
  }

  remove(id: number): boolean {
    for (let i = 0; i < this.drawings.length; i++) {
      if (this.drawings[i].id !== id) continue;
      this.pushHistory();
      this.drawings.splice(i, 1);
      if (this.activeId === id) this.activeId = null;
      this.host.invalidate();
      return true;
    }
    return false;
  }

  removeActive(): boolean {
    if (this.activeId == null) return false;
    const d = this.find(this.activeId);
    if (d && d.locked) return false; // 锁定的受保护：先解锁再删
    return this.remove(this.activeId);
  }

  clear(): void {
    if (!this.drawings.length) return;
    this.pushHistory();
    this.drawings.length = 0;
    this.activeId = null;
    this.host.invalidate();
  }

  select(id: number | null): void {
    this.activeId = id;
    this.host.invalidate();
  }

  /**
   * 擦掉某个图形的一条档位（官方 `processErase`：把 `levelN.visible` 置 false，
   * 图形本身留着）。只对 `LEVEL_TOOLS` 里的工具生效；入撤销栈。
   * @returns 没这一档 / 已经擦过 都返回 false
   */
  hideLevel(id: number, i: number): boolean {
    const d = this.find(id);
    if (!d) return false;
    const n = LEVEL_TOOLS[d.type];
    if (!n || !Number.isInteger(i) || i < 0 || i >= n) return false;
    if (this.levelHidden(d, i)) return false;
    this.pushHistory();
    d.style.hiddenLevels = [...(d.style.hiddenLevels ?? []), i].sort((a, b) => a - b);
    this.host.invalidate();
    return true;
  }

  /** 「重复绘制」开关（浮动属性工具条的 aria-pressed 按钮） */
  setRepeat(on: boolean): void {
    this.repeatDraw = !!on;
  }

  /**
   * 改某个图形的样式（颜色 / 线宽 / 线型……）。先 pushHistory，样式改动可撤销可重做。
   * @returns 找不到图形返回 false
   */
  setStyle(id: number, patch: Partial<DrawStyle>): boolean {
    const d = this.find(id);
    if (!d) return false;
    this.pushHistory();
    Object.assign(d.style, patch);
    this.host.invalidate();
    return true;
  }

  /**
   * 锁定 / 解锁。锁定的图形：能被选中（好弹工具条解锁），但不能拖动，
   * Delete 键也删不掉。**橡皮擦是例外** —— 官方的锁定判断排在橡皮分支之后，
   * 照着擦也能擦掉（见 onDown ⓪'）。同样入撤销栈。
   */
  setLocked(id: number, on: boolean): boolean {
    const d = this.find(id);
    if (!d) return false;
    this.pushHistory();
    d.locked = !!on;
    this.host.invalidate();
    return true;
  }

  /**
   * 全部锁定 / 全部解锁（左栏「锁定所有绘图」）。
   * 只改状态真的变了的那些，并且**只在有变化时**入撤销栈 ——
   * 否则连点两次「锁定所有绘图」会堆出一摞内容相同的快照，撤销要按好几次才动。
   * 返回被改动的图形数（0 表示本来就是目标状态）。
   */
  setAllLocked(on: boolean): number {
    const hit = this.drawings.filter((d) => d.locked !== !!on);
    if (!hit.length) return 0;
    this.pushHistory();
    for (const d of hit) d.locked = !!on;
    this.host.invalidate();
    return hit.length;
  }

  /**
   * 克隆：复制一份并按像素偏移 (48px, -36px) 换位，新副本自动选中。
   * 挂在浮动工具条「⋯」菜单里。
   */
  clone(id: number): Drawing | null {
    const d = this.find(id);
    if (!d) return null;
    const off = d.pts.map((p) => {
      const x = this.timeToX(p.time);
      const y = this.host.yOf(p.price);
      return { time: this.xToTime(x + 48), price: this.host.pOf(y - 36) };
    });
    return this.add(d.type, off, JSON.parse(JSON.stringify(d.style)));
  }

  /**
   * 选中图形的浮动属性工具条锚点（画布像素坐标）：图形包围盒水平居中、
   * 放在盒顶上方 46px（放不下就翻转到盒底下方 8px）。
   * 未选中 / 隐藏 / 图形不可见时返回 null。
   */
  selectionToolbarAnchor(): { x: number; y: number } | null {
    if (this.activeId == null || this.hidden) return null;
    const d = this.find(this.activeId);
    if (!d || !d.visible) return null;
    const p = this.pixelPts(d);
    if (!p.length) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of p) {
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
    const plot = this.host.plot;
    const BAR_W = 190; // 工具条估宽，用于水平方向夹取
    const x = Math.min(Math.max((x0 + x1) / 2 - BAR_W / 2, plot.l + 4), Math.max(plot.l + 4, plot.r - BAR_W - 4));
    let y = y0 - 46;
    if (y < plot.t + 4) y = y1 + 8; // 顶部放不下 → 底部
    if (y > plot.b - 44) y = plot.b - 44;
    return { x, y };
  }

  setTool(t: string): void {
    this.pending = null;
    this.pendingPlaced = 0;
    this.tool = t;
    // 换工具时把橡皮擦的悬停高亮收掉（官方悬停态只属于当前工具）
    if (t !== 'eraser') this.hoverId = null;
    this.applyCursor();
    this.host.invalidate();
  }

  /**
   * 画完一个图形 / 按 Esc 之后自动回到光标。
   * 除了改自己的 tool，还要告诉外部一声：左侧工具栏的主按钮图标得跟着拨回十字线，
   * 否则画完一条线，侧栏还停在「箭头」上（官方是跟着变的）。
   */
  private backToCursor(): void {
    this.setTool('cursor');
    this.host.onToolAutoChange?.('cursor');
  }

  setMagnet(on: boolean): void {
    this.magnet = !!on;
  }

  setHidden(on: boolean): void {
    this.hidden = !!on;
    this.host.invalidate();
  }

  getHidden(): boolean {
    return this.hidden;
  }

  /* -------------------------------------------------------- 撤销 / 重做 */

  private history(): string {
    return JSON.stringify(this.drawings);
  }

  private pushHistory(): void {
    this.snapshots.push(this.history());
    if (this.snapshots.length > 200) this.snapshots.shift();
    this.redoStack.length = 0;
  }

  canUndo(): boolean { return this.snapshots.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  /**
   * 待定图形已放置的锚点数（0 = 没有半成品）。
   * 供自检 / E2E 确认「点数刚好放满」：三点工具放满 3 个点后不该留下半成品。
   */
  pendingCount(): number { return this.pending ? this.pendingPlaced : 0; }

  undo(): boolean {
    if (!this.snapshots.length) return false;
    this.redoStack.push(this.history());
    this.drawings = JSON.parse(this.snapshots.pop() as string);
    if (this.activeId != null && !this.find(this.activeId)) this.activeId = null;
    this.host.invalidate();
    return true;
  }

  redo(): boolean {
    if (!this.redoStack.length) return false;
    this.snapshots.push(this.history());
    this.drawings = JSON.parse(this.redoStack.pop() as string);
    if (this.activeId != null && !this.find(this.activeId)) this.activeId = null;
    this.host.invalidate();
    return true;
  }

  /* -------------------------------------------------------- 持久化 */

  toJSON(): any {
    return { tool: this.tool, magnet: this.magnet, drawings: JSON.parse(this.history()) };
  }

  fromJSON(doc: any): void {
    if (!doc) return;
    this.drawings = Array.isArray(doc.drawings) ? doc.drawings : [];
    this.magnet = !!doc.magnet;
    this.tool = doc.tool || 'cursor';
    this.activeId = null;
    this.pending = null;
    this.pendingPlaced = 0;
    // id 不能和已有的撞
    let mx = 0;
    for (const d of this.drawings) mx = Math.max(mx, d.id || 0);
    this.nextId = mx + 1;
    this.snapshots.length = 0;
    this.redoStack.length = 0;
    this.host.invalidate();
  }

  score(): { total: number; byType: { [k: string]: number } } {
    const byType: { [k: string]: number } = {};
    for (const d of this.drawings) byType[d.type] = (byType[d.type] || 0) + 1;
    return { total: this.drawings.length, byType };
  }

  /* ======================================================== 事件接管 */

  /**
   * 给 KChart 用的三个钩子。
   * onDown 返回 true = 这次点击被绘图层接管，KChart **不要平移**。
   */
  onDown(px: number, py: number, mod = false): boolean {
    const def = toolDef(this.tool);

    // ⓪ 荧光笔/笔刷：按下开始采点，拖动收集轨迹，onUp 收笔成一笔
    if (this.tool === 'highlight' || this.tool === 'brush') {
      if (this.pending) return true;
      const a = this.anchorAt(px, py);
      this.pending = {
        id: this.nextId++,
        type: this.tool,
        pts: [a],
        style: styleForTool(this.tool),
        locked: false,
        visible: true,
      };
      this.pendingPlaced = 1;
      this.host.invalidate();
      return true;
    }

    // ⓪' 橡皮擦（对齐官方 `LineToolEraser` / `_tryHandleEraserMouseDown`）：
    //     · 只有「按下」就擦，没有拖拽连擦（官方只在 mousedown 里处理）；
    //     · 点空什么也不做，但这次点击被消费掉（不平移图表）；
    //     · **锁定的图形照样擦得掉** —— 官方的 `lockDrawings` / `isLocked` 判断排在橡皮分支
    //       之后，`removeSource` 只看 `isUserDeletable()`（= userEditEnabled），与冻结无关；
    //     · ⌘/Ctrl + 点某条档位线：只把那一档隐藏（官方 `processErase`，图形本身还在）。
    if (this.tool === 'eraser') {
      const hit = this.hitTest(px, py);
      if (hit) {
        const lvl = typeof hit.part === 'string' && hit.part.startsWith('level:')
          ? Number(hit.part.slice(6)) : null;
        if (mod && lvl != null && LEVEL_TOOLS[hit.d.type] != null) this.hideLevel(hit.d.id, lvl);
        else this.remove(hit.d.id);
        this.setHover(null);   // 擦掉的那条不该再高亮
      }
      this.host.invalidate();
      return true;
    }

    // ① 正在画多锚点图形：放一个点，放满 def.points 个才成型
    if (this.pending) {
      this.pending.pts[this.pendingPlaced] = this.anchorAt(px, py);
      this.pendingPlaced++;
      if (this.pendingPlaced >= this.pending.pts.length) this.commitPending();
      this.host.invalidate();
      return true;
    }

    // ② 选了工具，开始放点
    if (this.tool !== 'cursor' && def.points > 0) {
      const a = this.anchorAt(px, py);
      if (def.points === 1) {
        let style: Partial<DrawStyle> | undefined;
        if (this.tool === 'text') {
          let t = '文字';
          try { t = (window.prompt('输入文字', '文字') || '文字'); } catch (_e) { /* headless 里没有 prompt */ }
          style = { text: t };
        } else if (this.tool === 'emoji') {
          style = { text: this.emojiChar, fontSize: EMOJI_SIZE };
        }
        this.add(this.tool, [a, a], style);
        if (!this.repeatDraw) this.backToCursor();
      } else {
        this.pending = {
          id: this.nextId++,
          type: this.tool,
          pts: Array.from({ length: def.points }, () => ({ time: a.time, price: a.price })),
          style: styleForTool(this.tool, this.tool === 'measure' ? { color: '#787b86' } : undefined),
          locked: false,
          visible: true,
        };
        this.pendingPlaced = 1;
        this.host.invalidate();
      }
      return true;
    }

    // ③ 光标模式：命中就拖，没命中就让 KChart 平移。
    //     锁定的图形：只选中（弹属性工具条解锁），不进入拖拽
    const hit = this.hitTest(px, py);
    if (!hit) {
      if (this.activeId != null) this.select(null);
      return false;
    }
    this.select(hit.d.id);
    if (hit.d.locked) return true;
    this.drag = {
      d: hit.d,
      // 档位命中（'level:n'）只是给橡皮擦用的标记；光标模式下抓档位线 = 整体平移
      part: typeof hit.part === 'string' && hit.part.startsWith('level:') ? 'body' : hit.part,
      orig: hit.d.pts.map((p) => ({ time: p.time, price: p.price })),
      px,
      py,
    };
    this.pushHistory();
    return true;
  }

  onMove(px: number, py: number): void {
    // 荧光笔/笔刷：轨迹采点 —— 官方 addPoint 会丢掉「与上一点屏幕距离 < 2px」的点，
    // 2px 以上的才记（数据量由平滑算法兜住：每段最多插 5 个点）
    if (this.pending && isFreehand(this.pending.type)) {
      const a = this.anchorAt(px, py);
      const pts = this.pending.pts;
      const last = pts[pts.length - 1];
      const dx = this.timeToX(a.time) - this.timeToX(last.time);
      const dy = this.host.yOf(a.price) - this.host.yOf(last.price);
      if (Math.hypot(dx, dy) >= STROKE_MIN_STEP) pts.push(a);
      this.host.invalidate();
      return;
    }
    if (this.pending) {
      // 预览点 = 下一个要放的位置（已放满时夹到最后一个，三点工具放点间隙也有预览）
      const k = Math.min(this.pendingPlaced, this.pending.pts.length - 1);
      this.pending.pts[k] = this.anchorAt(px, py);
      this.host.invalidate();
      return;
    }
    if (this.drag) {
      const d = this.drag.d;
      if (this.drag.part === 'body') {
        // 整体平移：按**像素位移**换算成 (时间, 价格) 位移，整体一致
        const t0 = this.xToTime(this.drag.px);
        const p0 = this.host.pOf(this.drag.py);
        const t1 = this.xToTime(px);
        const p1 = this.host.pOf(py);
        const dt = t1 - t0;
        const dp = p1 - p0;
        for (let i = 0; i < d.pts.length; i++) {
          d.pts[i] = { time: this.drag.orig[i].time + dt, price: this.drag.orig[i].price + dp };
        }
      } else if (typeof this.drag.part === 'string') {
        // emoji 拖角：中心不动，只按角到中心的距离改字号
        const c = this.pixelPts(d)[0];
        d.style.fontSize = emojiSizeFromCorner(c.x, c.y, px, py);
      } else {
        d.pts[this.drag.part] = this.anchorAt(px, py);
      }
      this.host.invalidate();
      return;
    }
    const hit = this.hitTest(px, py);
    // 橡皮擦：悬停到谁就把谁的锚点亮出来（官方 setHoveredSource → areAnchorsVisible）。
    // 锁定的不亮 —— 官方那句 `isHoveredSource() && !isLocked()` 就是这个意思。
    this.setHover(this.tool === 'eraser' && hit && !hit.d.locked ? hit.d.id : null);
    this.applyCursor(hit);
  }

  /** 橡皮擦悬停高亮（不动选中态、不接管拖动） */
  setHover(id: number | null): void {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.host.invalidate();
  }

  /** 指针离开画布：悬停高亮跟着消失 */
  onLeave(): void {
    this.setHover(null);
    if (this.tool === 'eraser') {
      const c = this.host.canvas;
      if (c) c.style.cursor = '';
    }
  }

  onUp(): void {
    // 荧光笔/笔刷收笔：一笔 = 一次快照（undo 一次退一整笔）。
    // 官方单击只留 1 个点，PolygonRenderer 画半径 = 线宽/2 的实心圆；这里补成
    // 退化短划（圆头笔帽同样画出一个点），视觉一致且不会留下一根看不见的线
    if (this.pending && isFreehand(this.pending.type)) {
      if (this.pending.pts.length < 2) {
        const a = this.pending.pts[0];
        this.pending.pts.push({ time: a.time, price: a.price });
      }
      this.commitPending();
    } else if (this.pending && this.pending.type === 'measure' && this.pendingPlaced === 1) {
      // 官方测量是「按住拖一下就量完」。这里保留点两下的老路：
      // 松手时终点已经拉开 ≥4px 就算拖拽，直接成型；没拉动就继续等第二次点击。
      const q = this.pixelPts(this.pending);
      if (q.length === 2 && Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y) >= 4) this.commitPending();
    }
    this.drag = null;
  }

  /** 把半成品转正（入撤销栈、选中、按需切回光标） */
  private commitPending(): void {
    if (!this.pending) return;
    this.pushHistory();
    this.drawings.push(this.pending);
    this.activeId = this.pending.id;
    this.pending = null;
    this.pendingPlaced = 0;
    // 「重复绘制」开着时留在当前工具，方便连画
    if (!this.repeatDraw) this.backToCursor();
  }

  /**
   * 当前该显示的光标。chart.ts 每次 pointermove 都会自己写 canvas 的 cursor，
   * 所以真正吃这个值的是它的 `cursorFor` 钩子（它按这里返回的写）。
   * 官方口径：`setCursorForTool()` 里 `tool === 'eraser'` → `pane--cursor-eraser`，
   * 也就是那张 32×32、热点 (5,5) 的橡皮光标。
   */
  cursorAt(px: number, py: number): string {
    return this.cursorForHit(this.hitTest(px, py));
  }

  private cursorForHit(hit: { d: Drawing; part: number | string } | null): string {
    if (this.tool === 'eraser') return ERASER_CURSOR;
    if (this.tool !== 'cursor') return 'crosshair';
    if (!hit) return 'crosshair';
    // emoji 四角：给出缩放光标（与官方一致，拖角就是改大小）
    if (hit.part === 'emoji-nw' || hit.part === 'emoji-se') return 'nwse-resize';
    if (hit.part === 'emoji-ne' || hit.part === 'emoji-sw') return 'nesw-resize';
    if (hit.part === 'body' || (typeof hit.part === 'string' && hit.part.startsWith('level:'))) return 'move';
    return 'pointer';
  }

  private applyCursor(hit?: { d: Drawing; part: number | string } | null): void {
    const c = this.host.canvas;
    if (!c) return;
    c.style.cursor = this.cursorForHit(hit ?? null);
  }

  /* ---------------------------------------------------------- 键盘 */

  attachKeys(target: EventTarget): void {
    if (this.keyHandler) return;
    this.keyHandler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement) && (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { this.pending = null; this.pendingPlaced = 0; this.backToCursor(); this.select(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.removeActive()) e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) this.redo(); else this.undo();
        e.preventDefault();
        return;
      }
      for (const t of DRAW_TOOLS) {
        if (t.key2 && t.key2.length === 1 && e.key.toLowerCase() === t.key2 && !e.ctrlKey && !e.metaKey) {
          this.setTool(t.key);
          e.preventDefault();
          return;
        }
        // ⌥ 组合快捷键（设计稿「⌥T / ⌥H / ⌥J / ⌥V / ⌥C」）
        if (t.key3 && e.altKey && !e.ctrlKey && !e.metaKey) {
          const k = t.key3.replace('⌥', '').toLowerCase();
          if (e.key.toLowerCase() === k) {
            this.setTool(t.key);
            e.preventDefault();
            return;
          }
        }
      }
    };
    target.addEventListener('keydown', this.keyHandler as any);
    this.listeners.push({ el: target, type: 'keydown', fn: this.keyHandler });
  }

  dispose(): void {
    for (const l of this.listeners) l.el.removeEventListener(l.type, l.fn);
    this.listeners.length = 0;
    this.keyHandler = null;
  }

  /* ======================================================== 渲染 */

  /** 由 KChart 的 onDraw 钩子调用（已经在绘图区裁剪内） */
  render(ctx: CanvasRenderingContext2D): void {
    if (this.hidden) return;
    // 橡皮擦悬停到的那条最后画（官方 showOnTopOnHovering），锚点方块才不会被别的图形压住
    const hov = this.hoverId != null && this.hoverId !== this.activeId ? this.find(this.hoverId) : null;
    for (const d of this.drawings) {
      if (!d.visible) continue;
      if (hov && d.id === hov.id) continue;
      this.renderOne(ctx, d, d.id === this.activeId);
    }
    if (hov && hov.visible) this.renderOne(ctx, hov, false, true);
    if (this.pending) this.renderOne(ctx, this.pending, false);
  }

  private renderOne(ctx: CanvasRenderingContext2D, d: Drawing, selected: boolean, hovered = false): void {
    const ch = this.host;
    const p = this.pixelPts(d);
    if (!p.length) return;
    const a = p[0];
    const b = p[1] || p[0];
    const c = p[2] || p[1] || p[0];
    const col = selected ? '#1f6feb' : d.style.color;

    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = d.style.fill;
    ctx.lineWidth = d.style.width;
    ctx.setLineDash(d.style.dash);

    if (d.type === 'hline') {
      ctx.beginPath();
      ctx.moveTo(ch.plot.l, a.y);
      ctx.lineTo(ch.plot.r, a.y);
      ctx.stroke();
      this.label(ctx, '  ' + d.pts[0].price.toFixed(2), ch.plot.l + 4, a.y - 4, col);
    } else if (d.type === 'dot') {
      // 实心圆点，大小不随缩放变（锚点只定圆心）
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (isFreehand(d.type)) {
      // 自由笔迹（官方 BrushPaneView / HighlighterPaneView）：
      // 先平滑再描边，圆头笔帽，单击画半径 = 线宽/2 的实心圆。
      // 半透明来自颜色本身（荧光笔的 rgba(242,54,69,0.2)），不再叠 globalAlpha。
      const hl = d.type === 'highlight';
      const fw = Math.max(1, d.style.width || (hl ? HIGHLIGHT_WIDTH : BRUSH_WIDTH));
      const sp = smoothStroke(p, STROKE_SMOOTH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = d.style.color;
      ctx.fillStyle = d.style.color;
      ctx.lineWidth = fw;
      ctx.lineCap = 'round';
      ctx.lineJoin = hl ? 'round' : 'miter';
      // 笔刷官方有 linestyle 属性，虚线是合法设置；荧光笔没有，恒实线
      ctx.setLineDash(hl ? [] : d.style.dash);
      if (sp.length === 1) {
        ctx.beginPath();
        ctx.arc(sp[0].x, sp[0].y, fw / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(sp[0].x, sp[0].y);
        for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
        ctx.stroke();
      }
      // 选中/悬停：官方 `areAnchorsVisible() = (isHovered && !isLocked) || isSelected`，
      // 悬停和选中画的是同一套锚点，区别只在「悬停不改线色」
      if (selected || hovered) {
        const ends = [sp[0], sp[sp.length - 1]];
        for (const q of ends) {
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(q.x, q.y, STROKE_ANCHOR_RING, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(q.x, q.y, STROKE_ANCHOR_R, 0, Math.PI * 2);
          ctx.lineWidth = 1;
          ctx.strokeStyle = STROKE_ANCHOR_COLOR;
          ctx.stroke();
        }
      }
      ctx.restore();
      return;
    } else if (d.type === 'hray') {
      // 从锚点向右的水平射线 + 起点价格标签
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(ch.plot.r, a.y);
      ctx.stroke();
      this.label(ctx, '  ' + d.pts[0].price.toFixed(2), a.x + 4, a.y - 4, col);
    } else if (d.type === 'extline') {
      const l = rayToX(a.x, a.y, b.x, b.y, ch.plot.l - 50);
      const r = rayToX(a.x, a.y, b.x, b.y, ch.plot.r + 50);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
    } else if (d.type === 'crossline') {
      // 过锚点的水平线 + 垂直线（十字），带价格标签
      ctx.beginPath();
      ctx.moveTo(ch.plot.l, a.y);
      ctx.lineTo(ch.plot.r, a.y);
      ctx.moveTo(a.x, ch.plot.t);
      ctx.lineTo(a.x, ch.plot.b);
      ctx.stroke();
      this.label(ctx, '  ' + d.pts[0].price.toFixed(2), ch.plot.l + 4, a.y - 4, col);
    } else if (d.type === 'infoline') {
      // 信息线：线段 + 两端价格标签 + 涨跌幅
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const dp = d.pts[1].price - d.pts[0].price;
      const pct = d.pts[0].price ? (dp / d.pts[0].price) * 100 : 0;
      const sg = (v: number) => (v >= 0 ? '+' : '');
      this.label(ctx, d.pts[0].price.toFixed(2), a.x + 4, a.y - 4, col);
      this.label(ctx, d.pts[1].price.toFixed(2) + '  ' + sg(dp) + dp.toFixed(2) +
        ' (' + sg(pct) + pct.toFixed(2) + '%)', b.x + 4, b.y - 4, col);
    } else if (d.type === 'angle') {
      // 趋势角度：线段 + 中点角度标签（屏幕 y 向下，取负才是数学角度）
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const deg = (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
      this.label(ctx, deg.toFixed(1) + '°', (a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 6, col);
    } else if (d.type === 'vline') {
      ctx.beginPath();
      ctx.moveTo(a.x, ch.plot.t);
      ctx.lineTo(a.x, ch.plot.b);
      ctx.stroke();
    } else if (d.type === 'rect') {
      const l = Math.min(a.x, b.x);
      const t = Math.min(a.y, b.y);
      ctx.beginPath();
      ctx.rect(l, t, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'ray') {
      const e = rayToX(a.x, a.y, b.x, b.y, ch.plot.r + 50);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
    } else if (d.type === 'arrow') {
      // 线段 + 实心箭头（箭头指向第二个锚点）
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const hl = 9 + 2 * d.style.width;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - hl * Math.cos(ang - 0.42), b.y - hl * Math.sin(ang - 0.42));
      ctx.lineTo(b.x - hl * Math.cos(ang + 0.42), b.y - hl * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    } else if (d.type === 'ellipse') {
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      ctx.beginPath();
      if (rx < 1 || ry < 1) ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(rx * 2, 0.5), Math.max(ry * 2, 0.5));
      else ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'channel') {
      // 两条平行线 + 中间带状填充（ab 沿 c-a 平移）
      const wx = c.x - a.x;
      const wy = c.y - a.y;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x + wx, b.y + wy);
      ctx.lineTo(a.x + wx, a.y + wy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'fib') {
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const dPrice = d.pts[1].price - d.pts[0].price;
      for (let li = 0; li < FIB_LEVELS.length; li++) {
        if (this.levelHidden(d, li)) continue;      // 被 ⌘/Ctrl + 橡皮擦擦掉的那一档不画
        const lv = FIB_LEVELS[li];
        const y = a.y + lv.l * (b.y - a.y);
        ctx.strokeStyle = lv.c;
        ctx.setLineDash(lv.l === 0 || lv.l === 1 ? [] : [5, 4]);
        ctx.beginPath();
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        const price = d.pts[0].price + lv.l * dPrice;
        this.label(ctx, (lv.l * 100).toFixed(1) + '%  ' + price.toFixed(2), x1 + 4, y, lv.c);
      }
    } else if (d.type === 'fibext') {
      // 趋势扩展：横跨全区的水平档位，价格锚定 p2，单位价差 = p1-p0
      const dp = d.pts[1].price - d.pts[0].price;
      for (let li = 0; li < FIB_EXT_LEVELS.length; li++) {
        if (this.levelHidden(d, li)) continue;
        const lv = FIB_EXT_LEVELS[li];
        const price = d.pts[2].price + lv.l * dp;
        const y = ch.yOf(price);
        ctx.strokeStyle = lv.c;
        ctx.setLineDash(lv.l === 0 || lv.l === 1 ? [] : [5, 4]);
        ctx.beginPath();
        ctx.moveTo(ch.plot.l, y);
        ctx.lineTo(ch.plot.r, y);
        ctx.stroke();
        this.label(ctx, (lv.l * 100).toFixed(1) + '%  ' + price.toFixed(2), ch.plot.l + 4, y - 4, lv.c);
      }
    } else if (d.type === 'fibchannel') {
      // 斐波那契通道：基线沿宽度向量 (p2-p0) 的倍数平移出的平行线，两端延伸出绘图区
      const wx = c.x - a.x;
      const wy = c.y - a.y;
      for (let i = 0; i < FIB_CHANNEL_R.length; i++) {
        if (this.levelHidden(d, i)) continue;
        const r = FIB_CHANNEL_R[i];
        const sx = a.x + wx * r;
        const sy = a.y + wy * r;
        const ex = b.x + wx * r;
        const ey = b.y + wy * r;
        const l = rayToX(sx, sy, ex, ey, ch.plot.l - 50);
        const rt = rayToX(sx, sy, ex, ey, ch.plot.r + 50);
        ctx.strokeStyle = FIB_COLORS[i % FIB_COLORS.length];
        ctx.setLineDash(r === 0 ? [] : [5, 4]);
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(rt.x, rt.y);
        ctx.stroke();
        this.label(ctx, (r * 100).toFixed(1) + '%', rt.x - 44, rt.y - 4, ctx.strokeStyle as string);
      }
    } else if (d.type === 'fibtz' || d.type === 'fibttz') {
      // 时区 / 趋势时间：垂直线组（时区锚 p0；趋势时间单位取 p0→p1、锚 p2）
      const unit = b.x - a.x;
      const origin = d.type === 'fibtz' ? a.x : c.x;
      ctx.strokeStyle = '#787b86';
      ctx.setLineDash([]);
      const xs = [origin, ...FIB_EXTENSIONS.map((r) => origin + r * unit)];
      for (let i = 0; i < xs.length; i++) {
        if (this.levelHidden(d, i)) continue;
        const x = xs[i];
        if (x < ch.plot.l - 2 || x > ch.plot.r + 2) continue;
        ctx.beginPath();
        ctx.moveTo(x, ch.plot.t);
        ctx.lineTo(x, ch.plot.b);
        ctx.stroke();
        this.label(ctx, String(i === 0 ? 0 : FIB_EXTENSIONS[i - 1]), x + 3, ch.plot.t + 14, '#787b86');
      }
    } else if (d.type === 'fibfan') {
      // 速度阻力扇：从 p0 发出的射线组（0 与各 fib 比例）
      for (let i = 0; i <= FIB_RATIOS.length; i++) {
        if (this.levelHidden(d, i)) continue;
        const r = i === 0 ? 0 : FIB_RATIOS[i - 1];
        const e = rayToX(a.x, a.y, b.x, a.y + r * (b.y - a.y), ch.plot.r + 50);
        ctx.strokeStyle = i === 0 ? '#787b86' : FIB_COLORS[(i - 1) % FIB_COLORS.length];
        ctx.setLineDash(r === 0 || r === 1 ? [] : [5, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(e.x, e.y);
        ctx.stroke();
        this.label(ctx, (r * 100).toFixed(1) + '%', e.x - 36, e.y - 4, ctx.strokeStyle as string);
      }
    } else if (d.type === 'fibcirc') {
      // 斐波那契圆：圆心 p0 的同心圆组 + 中线
      const R = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.strokeStyle = '#787b86';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 0; i < FIB_RATIOS.length; i++) {
        const rr = FIB_RATIOS[i] * R;
        if (rr < 2) continue;
        ctx.strokeStyle = FIB_COLORS[i % FIB_COLORS.length];
        ctx.beginPath();
        ctx.arc(a.x, a.y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (d.type === 'fibspiral' || d.type === 'fibarc' || d.type === 'fibwedge') {
      // 曲线类：按采样折线绘制（弧/楔形分档配色，螺旋单色金）
      const polys = this.curvePolylines(d, a, b);
      if (d.type === 'fibspiral') {
        ctx.strokeStyle = d.type === 'fibspiral' ? '#b8860b' : col;
        ctx.setLineDash([]);
        const poly = polys[0];
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.stroke();
      } else {
        for (let i = 0; i < polys.length; i++) {
          const isRay = i >= (d.type === 'fibwedge' ? 3 : FIB_RATIOS.length);
          ctx.strokeStyle = isRay ? '#787b86' : FIB_COLORS[i % FIB_COLORS.length];
          ctx.setLineDash(isRay ? [5, 4] : []);
          const poly = polys[i];
          ctx.beginPath();
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let j = 1; j < poly.length; j++) ctx.lineTo(poly[j].x, poly[j].y);
          ctx.stroke();
        }
      }
    } else if (d.type === 'tiltfan') {
      // 倾斜扇形：趋势方向 ±60°/±30°/0° 的射线
      const th = Math.atan2(b.y - a.y, b.x - a.x);
      const R = ch.plot.w + ch.plot.h;
      ctx.strokeStyle = '#787b86';
      ctx.setLineDash([]);
      for (const off of [-Math.PI / 3, -Math.PI / 6, 0, Math.PI / 6, Math.PI / 3]) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + R * Math.cos(th + off), a.y + R * Math.sin(th + off));
        ctx.stroke();
      }
    } else if (d.type === 'gannbox' || d.type === 'gannsqf' || d.type === 'gannsq') {
      // 江恩箱 / 固定江恩正方 / 江恩正方：1/8 网格 + 对角线
      let ex = b.x;
      let ey = b.y;
      if (d.type !== 'gannbox') {
        // 固定正方 / 正方：边长取 |dx|、|dy| 的较大者（正方是可旋转版本的近似）
        const side = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ex = a.x + (b.x >= a.x ? side : -side);
        ey = a.y + (b.y >= a.y ? side : -side);
      }
      const l = Math.min(a.x, ex);
      const t = Math.min(a.y, ey);
      ctx.fillStyle = 'rgba(120,123,134,0.08)';
      ctx.fillRect(l, t, Math.abs(ex - a.x), Math.abs(ey - a.y));
      ctx.strokeStyle = '#787b86';
      ctx.setLineDash([]);
      for (const s of this.gannLines(a.x, a.y, ex, ey)) {
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
    } else if (PATTERN_LABELS[d.type]) {
      // 形态/波浪类：锚点折线 + 空心圆点 + 字母标签（峰顶标上方、谷底标下方）
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.stroke();
      const labels = PATTERN_LABELS[d.type];
      for (let i = 0; i < p.length; i++) {
        ctx.beginPath();
        ctx.arc(p[i].x, p[i].y, 3, 0, Math.PI * 2);
        ctx.stroke();
        const prev = p[i - 1] || p[i];
        const next = p[i + 1] || p[i];
        const above = p[i].y <= prev.y && p[i].y <= next.y; // 屏幕 y 向下：y 小 = 峰顶
        this.label(ctx, labels[i] || '', p[i].x + 5, p[i].y + (above ? -5 : 13), col);
      }
    } else if (d.type === 'cycle' || d.type === 'timecycle') {
      // 循环线 / 时间循环：垂直线组（循环线每周期一对：主线 + 18% 处副线）
      const unit = b.x - a.x;
      const n = d.type === 'cycle' ? CYCLE_COUNT : TIMECYCLE_COUNT;
      ctx.strokeStyle = '#787b86';
      ctx.setLineDash([]);
      for (let i = 0; i < n; i++) {
        const xs = d.type === 'cycle'
          ? [a.x + i * unit, a.x + i * unit + unit * CYCLE_PAIR_OFF]
          : [a.x + i * unit];
        for (const x of xs) {
          if (x < ch.plot.l - 2 || x > ch.plot.r + 2) continue;
          ctx.beginPath();
          ctx.moveTo(x, ch.plot.t);
          ctx.lineTo(x, ch.plot.b);
          ctx.stroke();
        }
        if (d.type === 'timecycle') {
          this.label(ctx, String(i), a.x + i * unit + 3, ch.plot.t + 14, '#787b86');
        }
      }
    } else if (d.type === 'sine') {
      // 正弦线：沿弦线叠加 2 个整周期正弦
      const poly = sinePts(a.x, a.y, b.x, b.y);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.stroke();
    } else if (d.type === 'longpos' || d.type === 'shortpos') {
      // 多/空仓位：目标箱（绿）+ 止损箱（红）+ 三条价位线 + 标签
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const tgt = d.pts[0].price + (d.pts[0].price - d.pts[1].price) * POS_RR;
      const tgtY = ch.yOf(tgt);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(8,153,129,0.25)';
      ctx.fillRect(x0, Math.min(a.y, tgtY), x1 - x0, Math.abs(tgtY - a.y));
      ctx.fillStyle = 'rgba(242,54,69,0.25)';
      ctx.fillRect(x0, Math.min(a.y, b.y), x1 - x0, Math.abs(b.y - a.y));
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#089981';
      ctx.beginPath(); ctx.moveTo(x0, tgtY); ctx.lineTo(x1, tgtY); ctx.stroke();
      ctx.strokeStyle = '#f23645';
      ctx.beginPath(); ctx.moveTo(x0, b.y); ctx.lineTo(x1, b.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(x0, a.y); ctx.lineTo(x1, a.y); ctx.stroke();
      this.label(ctx, '目标 ' + tgt.toFixed(2), x1 + 4, tgtY - 4, '#089981');
      this.label(ctx, (d.type === 'longpos' ? '多单 ' : '空单 ') + d.pts[0].price.toFixed(2), x0 + 4, a.y - 4, '#d1d4dc');
      this.label(ctx, '止损 ' + d.pts[1].price.toFixed(2), x1 + 4, b.y - 4, '#f23645');
    } else if (d.type === 'forecast') {
      // 仓位预测：两段折线 + 箭头 + 各段涨跌幅
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.stroke();
      const th = Math.atan2(p[2].y - p[1].y, p[2].x - p[1].x);
      ctx.beginPath();
      ctx.moveTo(p[2].x, p[2].y);
      ctx.lineTo(p[2].x - 9 * Math.cos(th - Math.PI / 6), p[2].y - 9 * Math.sin(th - Math.PI / 6));
      ctx.moveTo(p[2].x, p[2].y);
      ctx.lineTo(p[2].x - 9 * Math.cos(th + Math.PI / 6), p[2].y - 9 * Math.sin(th + Math.PI / 6));
      ctx.stroke();
      for (let i = 0; i < 2 && i + 1 < d.pts.length; i++) {
        const pct = d.pts[i].price ? ((d.pts[i + 1].price - d.pts[i].price) / d.pts[i].price) * 100 : 0;
        this.label(ctx, (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%',
          (p[i].x + p[i + 1].x) / 2 + 4, (p[i].y + p[i + 1].y) / 2 - 6, col);
      }
    } else if (d.type === 'kpattern') {
      // K线形态：锚点右侧三根迷你K线（启明星）+ 基准虚线
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#787b86';
      ctx.beginPath(); ctx.moveTo(a.x - 24, a.y); ctx.lineTo(a.x + 34, a.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      for (const k of kpatternCandles(a.x, a.y)) {
        const bull = k.c < k.o; // 屏幕 y 向下：收盘 y 更小 = 阳线
        ctx.strokeStyle = ctx.fillStyle = bull ? '#089981' : '#f23645';
        ctx.beginPath();
        ctx.moveTo(k.x + k.w / 2, k.h);
        ctx.lineTo(k.x + k.w / 2, k.l);
        ctx.stroke();
        ctx.fillRect(k.x, Math.min(k.o, k.c), k.w, Math.max(1, Math.abs(k.c - k.o)));
      }
    } else if (d.type === 'simcandle') {
      // 模拟K线：p0→p1 之间 8 根确定性假K线
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      for (const k of simCandlePx(a.x, a.y, b.x, b.y)) {
        const bull = k.c < k.o;
        ctx.strokeStyle = '#787b86';
        ctx.beginPath();
        ctx.moveTo(k.x + k.w / 2, k.h);
        ctx.lineTo(k.x + k.w / 2, k.l);
        ctx.stroke();
        ctx.fillStyle = bull ? 'rgba(8,153,129,0.85)' : 'rgba(242,54,69,0.85)';
        ctx.fillRect(k.x, Math.min(k.o, k.c), k.w, Math.max(1, Math.abs(k.c - k.o)));
      }
    } else if (d.type === 'fan') {
      // 扇形：基线 ± FAN_DEG 射线 + 同半径连接弧
      const th = Math.atan2(b.y - a.y, b.x - a.x);
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
      if (r > 2) {
        const degs = FAN_DEG.map((v) => (v * Math.PI) / 180);
        const arc = arcPts(a.x, a.y, r, th + Math.min(...degs), th + Math.max(...degs));
        ctx.strokeStyle = '#787b86';
        ctx.beginPath();
        ctx.moveTo(arc[0].x, arc[0].y);
        for (let i = 1; i < arc.length; i++) ctx.lineTo(arc[i].x, arc[i].y);
        ctx.stroke();
      }
      const R = ch.plot.w + ch.plot.h;
      ctx.strokeStyle = col;
      for (const deg of FAN_DEG) {
        const a2 = th + (deg * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + R * Math.cos(a2), a.y + R * Math.sin(a2));
        ctx.stroke();
      }
    } else if (d.type === 'avwap') {
      // 锚定 VWAP：锚点 → 最后一根 bar 的橙色曲线
      const i0 = ch.indexAtTime(d.pts[0].time);
      const series = vwapSeries(ch.bars, i0);
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ch.xCenter(i0), ch.yOf(series[0]));
      for (let i = 1; i < series.length; i++) ctx.lineTo(ch.xCenter(i0 + i), ch.yOf(series[i]));
      ctx.stroke();
      this.label(ctx, 'VWAP', ch.xCenter(i0) + 4, ch.yOf(series[0]) - 6, '#ff9800');
    } else if (d.type === 'vprofile' || d.type === 'avprofile') {
      // 成交量分布图：区间价格分箱水平直方图，POC 箱高亮
      let i0: number;
      let i1: number;
      let l: number;
      let t: number;
      let w: number;
      let lo: number;
      let hi: number;
      if (d.type === 'vprofile') {
        i0 = ch.indexAtTime(Math.min(d.pts[0].time, d.pts[1].time));
        i1 = ch.indexAtTime(Math.max(d.pts[0].time, d.pts[1].time));
        l = Math.min(a.x, b.x);
        t = Math.min(a.y, b.y);
        w = Math.abs(b.x - a.x);
        lo = Math.min(d.pts[0].price, d.pts[1].price);
        hi = Math.max(d.pts[0].price, d.pts[1].price);
      } else {
        i0 = ch.indexAtTime(d.pts[0].time);
        i1 = ch.bars.length - 1;
        l = a.x;
        lo = Infinity;
        hi = -Infinity;
        for (let i = i0; i < ch.bars.length; i++) {
          if (ch.bars[i].low < lo) lo = ch.bars[i].low;
          if (ch.bars[i].high > hi) hi = ch.bars[i].high;
        }
        t = ch.yOf(hi);
        w = Math.min(VP_WIDTH, ch.plot.r - a.x);
      }
      const { vol, poc } = volumeProfile(ch.bars, i0, i1, VP_BINS, lo, hi);
      const bh = (ch.yOf(lo) - ch.yOf(hi)) / VP_BINS;
      const maxV = Math.max(...vol, 1);
      const yBot = ch.yOf(lo);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      for (let k = 0; k < VP_BINS; k++) {
        if (!vol[k]) continue;
        const len = (vol[k] / maxV) * w * 0.7;
        ctx.fillStyle = k === poc ? 'rgba(242,54,69,0.55)' : 'rgba(41,98,255,0.45)';
        ctx.fillRect(l, yBot - (k + 1) * bh, len, Math.max(1, bh - 0.5));
      }
      ctx.strokeStyle = '#787b86';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(l, t, w, ch.yOf(lo) - ch.yOf(hi));
      const pocY = yBot - (poc + 0.5) * bh;
      this.label(ctx, 'POC', l + (vol[poc] / maxV) * w * 0.7 + 4, pocY, '#f23645');
    } else if (d.type === 'prange') {
      // 价格范围：竖线 + 上下端帽 + 涨跌标签
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, b.y);
      ctx.moveTo(a.x - 8, a.y); ctx.lineTo(a.x + 8, a.y);
      ctx.moveTo(a.x - 8, b.y); ctx.lineTo(a.x + 8, b.y);
      ctx.stroke();
      const dp = d.pts[1].price - d.pts[0].price;
      const pct = d.pts[0].price ? (dp / d.pts[0].price) * 100 : 0;
      this.label(ctx, (dp >= 0 ? '+' : '') + dp.toFixed(2) + '  (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)',
        a.x + 12, (a.y + b.y) / 2, col);
    } else if (d.type === 'drange') {
      // 日期范围：横线 + 左右端帽 + bar 数标签
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, a.y);
      ctx.moveTo(a.x, a.y - 8); ctx.lineTo(a.x, a.y + 8);
      ctx.moveTo(b.x, a.y - 8); ctx.lineTo(b.x, a.y + 8);
      ctx.stroke();
      const n = Math.abs(ch.indexAtTime(d.pts[1].time) - ch.indexAtTime(d.pts[0].time));
      this.label(ctx, n + ' 根', (a.x + b.x) / 2 - 12, a.y - 12, col);
    } else if (d.type === 'dprange') {
      // 日期和价格范围：虚线框 + 价格标签（右上）+ bar 数标签（底部居中）
      const l = Math.min(a.x, b.x);
      const t = Math.min(a.y, b.y);
      ctx.setLineDash([4, 3]);
      ctx.fillStyle = 'rgba(120,123,134,0.14)';
      ctx.beginPath();
      ctx.rect(l, t, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      const dp = d.pts[1].price - d.pts[0].price;
      const pct = d.pts[0].price ? (dp / d.pts[0].price) * 100 : 0;
      const n = Math.abs(ch.indexAtTime(d.pts[1].time) - ch.indexAtTime(d.pts[0].time));
      this.label(ctx, (dp >= 0 ? '+' : '') + dp.toFixed(2) + '  (' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)',
        Math.max(a.x, b.x) + 6, Math.min(a.y, b.y) + 10, col);
      this.label(ctx, n + ' 根', (a.x + b.x) / 2 - 12, Math.max(a.y, b.y) + 18, col);
    } else if (d.type === 'arrowmark' || d.type === 'uparrow' || d.type === 'downarrow') {
      // 箭头标记：实心箭头；向上/向下箭头：空心描边箭头（锚点即字形中心）
      ctx.setLineDash([]);
      const s = d.type === 'arrowmark' ? MARKER_SIZE * 1.15 : MARKER_SIZE;
      const g = arrowGlyphPts(a.x, a.y, s, d.type === 'downarrow' ? -1 : 1);
      ctx.beginPath();
      ctx.moveTo(g[0].x, g[0].y);
      for (let i = 1; i < g.length; i++) ctx.lineTo(g[i].x, g[i].y);
      ctx.closePath();
      if (d.type === 'arrowmark') {
        ctx.fillStyle = col;
        ctx.fill();
      } else {
        ctx.fillStyle = d.style.fill || 'rgba(41,98,255,0.14)';
        ctx.fill();
        ctx.stroke();
      }
    } else if (d.type === 'rotrect') {
      // 旋转矩形：p0p1 一条边 + p2 定高度的平行四边形
      const wx = c.x - a.x;
      const wy = c.y - a.y;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.x + wx, b.y + wy);
      ctx.lineTo(a.x + wx, a.y + wy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'path' || d.type === 'polyline') {
      // 路径（开放）/ 折线（闭合）：逐段连线
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
      if (d.type === 'polyline') ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'circle') {
      // 圆：圆心 a、半径 |ab|
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.beginPath();
      ctx.arc(a.x, a.y, Math.max(r, 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'arc') {
      // 弧形：外接框的椭圆右上四分之一弧，不填充
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, -Math.PI / 2, 0);
      ctx.stroke();
    } else if (d.type === 'curve') {
      // 曲线：二次贝塞尔（p0 起点、p1 控制点、p2 终点）
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(b.x, b.y, c.x, c.y);
      ctx.stroke();
    } else if (d.type === 'hyperbola') {
      // 双曲线：p0/p1 为焦点的两支
      ctx.beginPath();
      const hp = hyperbolaPts(a.x, a.y, b.x, b.y);
      ctx.moveTo(hp[0].x, hp[0].y);
      for (let i = 1; i < hp.length; i++) {
        // 两支之间跳笔
        if (i === hp.length / 2) {
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(hp[i].x, hp[i].y);
        } else {
          ctx.lineTo(hp[i].x, hp[i].y);
        }
      }
      ctx.stroke();
    } else if (d.type === 'pitchfork' || d.type === 'schiff' || d.type === 'schiff2'
      || d.type === 'innerfork' || d.type === 'pitchfan') {
      // 音叉族：三条（扇形五条）射线延长到绘图区右缘；非扇形时在两条外侧线之间淡填充
      const rays = pitchforkRays(d.type, a, b, c);
      const ends = rays.map((r) => rayToX(r.o.x, r.o.y, r.d.x, r.d.y, ch.plot.r + 40));
      if (rays.length === 3) {
        ctx.beginPath();
        ctx.moveTo(rays[0].o.x, rays[0].o.y);
        ctx.lineTo(ends[0].x, ends[0].y);
        ctx.lineTo(ends[2].x, ends[2].y);
        ctx.lineTo(rays[2].o.x, rays[2].o.y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(120,123,134,0.08)';
        ctx.fill();
      }
      for (let i = 0; i < rays.length; i++) {
        ctx.beginPath();
        ctx.moveTo(rays[i].o.x, rays[i].o.y);
        ctx.lineTo(ends[i].x, ends[i].y);
        ctx.stroke();
      }
    } else if (d.type === 'note' || d.type === 'callout' || d.type === 'comment'
      || d.type === 'balloon' || d.type === 'pricenote' || d.type === 'pricelabel' || d.type === 'signpost') {
      // 文本类标注：白底卡片 + 引线/尾巴指向锚点
      this.renderCard(ctx, d, a, col);
    } else if (d.type === 'circlelines') {
      // 圆加十字线：圆 + 过圆心的水平/垂直线（延伸到绘图区边界）
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.beginPath();
      ctx.arc(a.x, a.y, Math.max(r, 1), 0, Math.PI * 2);
      ctx.moveTo(ch.plot.l, a.y);
      ctx.lineTo(ch.plot.r, a.y);
      ctx.moveTo(a.x, ch.plot.t);
      ctx.lineTo(a.x, ch.plot.b);
      ctx.stroke();
    } else if (d.type === 'beziercubic') {
      // 三次贝塞尔：p1/p2 是控制点，曲线不过它们（与二次曲线同一采样器风格）
      const q = cubicBezierPts(a, b, c, p[3] || c);
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y);
      for (let i = 1; i < q.length; i++) ctx.lineTo(q[i].x, q[i].y);
      ctx.stroke();
    } else if (d.type === 'flatbottom') {
      // 平底：底线水平（取两锚点的较低边），顶点在底边中点上方 0.6×宽度
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const yb = Math.max(a.y, b.y);
      const apex = { x: (x0 + x1) / 2, y: yb - Math.abs(x1 - x0) * 0.6 };
      ctx.beginPath();
      ctx.moveTo(apex.x, apex.y);
      ctx.lineTo(x1, yb);
      ctx.lineTo(x0, yb);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,123,134,0.10)';
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'arrowmarl' || d.type === 'arrowmarr') {
      // 左/右箭头：与上/下箭头同款字形，旋转 90°，空心
      const g = arrowSideGlyphPts(a.x, a.y, MARKER_SIZE, d.type === 'arrowmarr' ? 1 : -1);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(g[0].x, g[0].y);
      for (let i = 1; i < g.length; i++) ctx.lineTo(g[i].x, g[i].y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.stroke();
    } else if (d.type === 'text') {
      ctx.setLineDash([]);
      this.label(ctx, d.style.text || '文字', a.x, a.y, col, d.style.fontSize);
    } else if (d.type === 'emoji') {
      // emoji 标注：锚点为中心、边长 = size 的方形（官方 EmojiPaneView 把 twemoji
      // 的 **svg** 渲染进 size×size 的 viewBox，不是画系统字体字形 —— 所以换机器、
      // 换系统字体都不会变样）。图还没下完时先画原生字形占位，加载完再重绘一次。
      const size = d.style.fontSize || EMOJI_SIZE;
      const ch = d.style.text || '😀';
      ctx.setLineDash([]);
      ctx.save();
      ctx.globalAlpha = 1;
      const glyph = loadEmojiImage(ch, () => this.host.invalidate());
      if (glyph) {
        ctx.drawImage(glyph, a.x - size / 2, a.y - size / 2, size, size);
      } else {
        // 占位/兜底：fillStyle 必须是不透明白 —— 默认样式里的填充是 rgba(…,0.14)，
        // 彩色字形会把 fillStyle 的 alpha 一起吃掉，落笔就是一个「幽灵表情」。
        ctx.fillStyle = '#000';
        ctx.font = size + 'px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch, a.x, a.y);
      }
      ctx.restore();
      // 选中/悬停：贴合字形的细框 + 四个白色圆手柄（对齐 charting_library 的 emoji 选中样式），
      // 四角可拖拽改字号；中点是位置而不是手柄，所以不画通用方块手柄
      if (selected || hovered) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#1f6feb';
        ctx.lineWidth = 1;
        ctx.strokeRect(a.x - size / 2, a.y - size / 2, size, size);
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        for (const q of emojiCornerPts(a.x, a.y, size)) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, EMOJI_KNOB_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    } else if (d.type === 'measure') {
      this.renderMeasure(ctx, d, selected || hovered);
    } else {
      // trend（默认）
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // 选中 / 悬停都画锚点手柄（emoji 用自己的四角圆手柄，见上面的 emoji 分支）
    if ((selected || hovered) && d.type !== 'emoji') {
      ctx.save();
      ctx.fillStyle = '#0e1116';
      ctx.strokeStyle = '#1f6feb';
      ctx.lineWidth = 1.5;
      for (const q of p) {
        ctx.beginPath();
        ctx.rect(q.x - 3.5, q.y - 3.5, 7, 7);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ---------------------------------------------------------- 测量 */

  /** 宿主给的价格小数位（KChart 的 dec()）；假宿主没有就按 2 位 */
  priceDecimals(): number {
    const h = this.host as DrawHost;
    return typeof h.priceDecimals === 'function' ? h.priceDecimals() : 2;
  }

  /** 轴条带几何（KChart.axisBox）；轴标签必须画在绘图区之外，所以由宿主给 */
  private axisBox(): DrawAxisBox | null {
    const h = this.host as DrawHost;
    return typeof h.axisBox === 'function' ? h.axisBox() : null;
  }

  /** 圆角矩形路径（不依赖 ctx.roundRect，旧浏览器 / 测试桩都能走） */
  private pathRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  /** 线段末端箭头：两笔 45° 的「V」（官方 drawArrow 的视觉等价物，臂长 6px） */
  private arrowHead(ctx: CanvasRenderingContext2D, from: PxPt, to: PxPt): void {
    const len = Math.min(6, Math.max(3, Math.hypot(to.x - from.x, to.y - from.y) * 0.35));
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    for (const s of [-1, 1]) {
      const a = ang + Math.PI + (s * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x + Math.cos(a) * len, to.y + Math.sin(a) * len);
      ctx.stroke();
    }
  }

  /**
   * 「测量」的图形：对齐官方 MeasurePaneView 的三层 ——
   *   ① 20% 透明度的蓝/红矩形（官方 linewidth 0，没有边框）
   *   ② 过中点的水平/垂直中线，终点侧带箭头（跨度 ≥ 50px 才画）
   *   ③ 终点外侧的三行卡片：价差(百分比) 跳动数 / 根K线, 时间跨度 / 成交量
   */
  private renderMeasure(ctx: CanvasRenderingContext2D, d: Drawing, selected: boolean): void {
    const p = this.pixelPts(d);
    if (p.length < 2) return;
    const a = p[0];
    const b = p[1];
    const ch = this.host;
    const info = measureInfo(ch, d.pts, this.priceDecimals());
    const pal = info.up ? MEASURE_UP : MEASURE_DOWN;

    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    const accent = selected ? '#1f6feb' : pal.line;

    ctx.save();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.fill;
    ctx.fillRect(left, top, w, h);
    if (selected) {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(w), Math.round(h));
    }

    const guides = measureGuides(a, b);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    for (const g of [guides.h, guides.v]) {
      ctx.beginPath();
      ctx.moveTo(g.a.x, g.a.y);
      ctx.lineTo(g.b.x, g.b.y);
      ctx.stroke();
      if (g.arrow) this.arrowHead(ctx, g.a, g.b);
    }

    /* 卡片：官方 TextRenderer（padding 8 / inflate 5 / 圆角 4 / 透明度 0.9） */
    const family = '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.font = MEASURE_FONT + 'px ' + family;
    let maxW = 0;
    for (const ln of info.lines) maxW = Math.max(maxW, ctx.measureText(ln).width);
    const box = measureLabelBox(maxW, info.lines.length);
    const anchor = measureLabelAnchor(a, b, box.h, ch.plot.t, ch.plot.b);
    // 卡片不能横向出绘图区（官方靠裁剪，这里夹一下更稳）
    const halfW = Math.min(box.w / 2, ch.plot.w / 2);
    const cx = Math.min(Math.max(anchor.x, ch.plot.l + halfW), ch.plot.r - halfW);
    const bx = Math.round(cx - box.w / 2);
    const by = Math.round(anchor.y - box.h / 2);

    ctx.globalAlpha = MEASURE_LABEL_ALPHA;
    ctx.fillStyle = pal.label;
    this.pathRoundRect(ctx, bx, by, box.w, box.h, MEASURE_RADIUS);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textTop = by + MEASURE_INFLATE_Y + MEASURE_BOX_PAD;
    const lineH = MEASURE_FONT + MEASURE_LINE_GAP;
    info.lines.forEach((ln, i) => {
      ctx.fillText(ln, bx + box.w / 2, textTop + MEASURE_FONT / 2 + i * lineH);
    });
    ctx.restore();
  }

  /**
   * 轴上的起止标签（官方的 start/end price & time axis views）：蓝底白字。
   * 由 KChart 的 onAxisDraw 钩子在坐标轴画完之后调用 —— 在 onDraw 里画会被轴色块盖掉。
   */
  renderAxisLabels(ctx: CanvasRenderingContext2D): void {
    if (this.hidden) return;
    const ax = this.axisBox();
    if (!ax) return;
    const ch = this.host;
    const dec = this.priceDecimals();
    ctx.save();
    ctx.font = '12px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'middle';
    for (const d of this.drawings) {
      if (!d.visible || d.type !== 'measure') continue;
      const p = this.pixelPts(d);
      if (p.length < 2) continue;
      const info = measureInfo(ch, d.pts, dec);
      const spanDays = info.seconds != null ? Math.abs(info.seconds) / 86400 : 30;

      // 价格轴：起点价 / 终点价
      for (const [pt, price] of [[p[0], d.pts[0].price], [p[1], d.pts[1].price]] as [PxPt, number][]) {
        const y = Math.round(Math.min(Math.max(pt.y, ch.plot.t + 9), ch.plot.b - 9));
        const label = price.toFixed(dec);
        ctx.fillStyle = MEASURE_UP.label;
        ctx.fillRect(ax.priceL + 2, y - MEASURE_AXIS_LABEL_H / 2, ax.priceW - 4, MEASURE_AXIS_LABEL_H);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.fillText(label, ax.priceL + 8, y);
      }

      // 时间轴：起点 / 终点时刻
      if (info.fromIndex != null && info.toIndex != null) {
        for (const idx of [info.fromIndex, info.toIndex]) {
          const bar = ch.bars[idx];
          if (!bar) continue;
          const label = fmtCrossTime(bar.time, spanDays);
          const bw = Math.round(ctx.measureText(label).width) + 14;
          const x = Math.min(Math.max(this.timeToX(bar.time), ax.left + bw / 2), ax.right - bw / 2);
          ctx.fillStyle = MEASURE_UP.label;
          ctx.fillRect(Math.round(x - bw / 2), Math.round(ax.timeY - MEASURE_AXIS_LABEL_H / 2), bw, MEASURE_AXIS_LABEL_H);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(label, Math.round(x), ax.timeY);
        }
      }
    }
    ctx.restore();
  }

  /** 1 点文本类标注的卡片矩形（相对锚点的偏移 + 尺寸），渲染与命中共用 */
  private cardBox(d: Drawing, a: PxPt): { x: number; y: number; w: number; h: number } {
    const map: Record<string, [number, number, number, number]> = {
      note: [10, -62, 112, 52],
      callout: [12, -56, 108, 40],
      comment: [10, -46, 96, 32],
      balloon: [12, -62, 104, 44],
      pricenote: [10, -54, 108, 42],
      pricelabel: [8, -11, 78, 22],
      signpost: [-6, -38, 104, 28],
    };
    const m = map[d.type] || [10, -50, 100, 36];
    return { x: a.x + m[0], y: a.y + m[1], w: m[2], h: m[3] };
  }

  /** 文本类标注（便签/标注/评论/气泡/价格便签/价格标签/路标）的绘制 */
  private renderCard(ctx: CanvasRenderingContext2D, d: Drawing, a: PxPt, col: string): void {
    const b = this.cardBox(d, a);
    const rr = (ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
    ctx.save();
    ctx.setLineDash([]);
    ctx.font = '11px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // 卡片底：气泡 = 椭圆，路标 = 右尖箭头牌，其余圆角矩形
    ctx.beginPath();
    if (d.type === 'balloon') {
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    } else if (d.type === 'signpost') {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + b.w - 14, b.y);
      ctx.lineTo(b.x + b.w, b.y + b.h / 2);
      ctx.lineTo(b.x + b.w - 14, b.y + b.h);
      ctx.lineTo(b.x, b.y + b.h);
      ctx.closePath();
    } else if (rr) {
      rr.call(ctx, b.x, b.y, b.w, b.h, d.type === 'pricelabel' ? 4 : 6);
    } else {
      ctx.rect(b.x, b.y, b.w, b.h);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1, d.style.width);
    ctx.stroke();
    // 引线 / 尾巴 / 立柱
    ctx.beginPath();
    if (d.type === 'callout' || d.type === 'comment') {
      ctx.moveTo(b.x + 14, b.y + b.h);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
    } else if (d.type === 'balloon') {
      ctx.moveTo(b.x + 16, b.y + b.h - 6);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(b.x + 34, b.y + b.h - 10);
      ctx.stroke();
    } else if (d.type === 'note' || d.type === 'pricenote') {
      ctx.moveTo(b.x + 6, b.y + b.h);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
    } else if (d.type === 'signpost') {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x, b.y + b.h);
      ctx.stroke();
    } else if (d.type === 'pricelabel') {
      ctx.moveTo(b.x, b.y + b.h / 2);
      ctx.lineTo(a.x, a.y);
      ctx.stroke();
    }
    // 便签折角
    if (d.type === 'note') {
      ctx.beginPath();
      ctx.moveTo(b.x + b.w - 12, b.y);
      ctx.lineTo(b.x + b.w - 12, b.y + 12);
      ctx.lineTo(b.x + b.w, b.y + 12);
      ctx.stroke();
    }
    // 文本
    const price = d.pts[0].price.toFixed(2);
    ctx.fillStyle = col;
    if (d.type === 'pricelabel') {
      ctx.fillText(price, b.x + 8, b.y + b.h / 2);
    } else if (d.type === 'pricenote') {
      ctx.fillText('价格便签', b.x + 10, b.y + 14);
      ctx.font = 'bold 13px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.fillText(price, b.x + 10, b.y + 31);
    } else {
      const def: Record<string, string> = { note: '便签', callout: '标注', comment: '评论', balloon: '气泡', signpost: '路标' };
      ctx.fillText(d.style.text || def[d.type] || '文字', b.x + 10, b.y + b.h / 2);
      if (d.type === 'note') {
        // 内容两行示意（浅色横线），让便签看起来是「有字的卡片」
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(b.x + 10, b.y + 32);
        ctx.lineTo(b.x + b.w - 14, b.y + 32);
        ctx.moveTo(b.x + 10, b.y + 40);
        ctx.lineTo(b.x + b.w - 28, b.y + 40);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size?: number): void {
    ctx.save();
    ctx.font = (size || 12) + 'px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(text).width;
    const h = (size || 12) + 4;
    ctx.fillStyle = 'rgba(14,17,22,0.78)';
    ctx.fillRect(x - 2, y - h, w + 6, h);
    ctx.fillStyle = color;
    ctx.fillText(text, x + 1, y - 2);
    ctx.restore();
  }
}

export function toolDef(key: string): DrawToolDef {
  for (const t of DRAW_TOOLS) if (t.key === key) return t;
  return DRAW_TOOLS[0];
}

/* ===========================================================================
 * 5. 自检 —— 用假宿主跑纯几何，Node 里也能跑
 * ========================================================================= */

/** 一个最小假图：足够让 DrawLayer 算坐标，不需要 canvas */
export function makeFakeHost(closes: number[], barW: number): DrawHost {
  const bars: Bar[] = [];
  let t = new Date(2020, 0, 2, 9, 30, 0, 0).getTime();
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const o = i === 0 ? c : closes[i - 1];
    bars.push({ time: t, open: o, high: Math.max(o, c) + 0.5, low: Math.min(o, c) - 0.5, close: c, volume: 100 });
    t += 86400000;
  }
  const from = 0;
  const plot = { l: 0, t: 0, r: 700, b: 400, w: 700, h: 400 };
  // 价格区间取 min..max，上下各留 5%
  let mn = Infinity;
  let mx = -Infinity;
  for (const b of bars) { if (b.low < mn) mn = b.low; if (b.high > mx) mx = b.high; }
  const pad = (mx - mn) * 0.05 || 1;
  const scale = { min: mn - pad, max: mx + pad };
  return {
    bars,
    plot,
    scale,
    xCenter(i: number) { return plot.l + (i - from) * barW + barW / 2; },
    iOf(px: number) { return from + (px - plot.l) / barW; },
    yOf(price: number) { return plot.t + ((scale.max - price) / (scale.max - scale.min)) * plot.h; },
    pOf(py: number) { return scale.max - ((py - plot.t) / plot.h) * (scale.max - scale.min); },
    indexAtTime(tt: number) {
      let r = 0;
      for (let i = 0; i < bars.length; i++) { if (bars[i].time <= tt) r = i; else break; }
      return r;
    },
    invalidate() { /* 假宿主不需要重绘 */ },
  };
}

export interface DrawTestResult {
  pass: number;
  fail: number;
  names: string[];
}

export function drawSelfTest(): DrawTestResult {
  let pass = 0;
  let fail = 0;
  const names: string[] = [];
  const t = (name: string, ok: boolean, extra: string = '') => {
    names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
    if (ok) pass++; else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };
  const near = (a: number, b: number, eps: number = 1e-6) => Math.abs(a - b) <= eps;

  const closes: number[] = [];
  for (let i = 0; i < 60; i++) closes.push(100 + Math.sin(i / 6) * 8 + i * 0.2);
  const host = makeFakeHost(closes, 10);
  const L = new DrawLayer(host);

  // --- 坐标互逆 ---
  let inv = true;
  for (const i of [0, 1, 12, 30, 58, 59]) {
    const x = L.timeToX(host.bars[i].time);
    const back = L.xToTime(x);
    if (!near(back, host.bars[i].time, 1)) inv = false;
  }
  t('timeToX / xToTime 在整根 bar 上互逆', inv);
  const midT = (host.bars[20].time + host.bars[21].time) / 2;
  t('相邻 bar 中间的时间能插值回来',
    near(L.xToTime(L.timeToX(midT)), midT, 1), String(L.xToTime(L.timeToX(midT)) - midT));

  // --- 增删 + 命中 ---
  const d1 = L.add('trend', [
    { time: host.bars[5].time, price: closes[5] },
    { time: host.bars[40].time, price: closes[40] },
  ]);
  t('add() 后能查到', L.find(d1.id) === d1 && L.score().total === 1);

  const pa = L.pixelPts(d1);
  const mx = (pa[0].x + pa[1].x) / 2;
  const my = (pa[0].y + pa[1].y) / 2;
  t('点在线上能命中', !!L.hitTest(mx, my) && L.hitTest(mx, my)!.d.id === d1.id);
  t('点远离线不命中', L.hitTest(mx, my + 60) === null);
  t('命中部位是 body', L.hitTest(mx, my)!.part === 'body');

  // add() 会自动选中新图形（参考实现也是这样），所以这里要先取消选中
  L.select(null);
  t('未选中时端点不算手柄（part 是 body）', L.hitTest(pa[0].x, pa[0].y)!.part === 'body');
  L.select(d1.id);
  t('选中后端点变成手柄', L.hitTest(pa[0].x, pa[0].y)!.part === 0);

  // --- 手柄拖动改形状 ---
  L.onDown(pa[1].x, pa[1].y);          // 抓住 1 号手柄
  const newY = pa[1].y + 100;
  L.onMove(pa[1].x, newY);
  L.onUp();
  const pb = L.pixelPts(d1);
  t('拖手柄只动被拖的那个端点',
    near(pb[0].x, pa[0].x, 0.5) && near(pb[0].y, pa[0].y, 0.5) && Math.abs(pb[1].y - newY) < 2,
    'p0 位移=' + Math.abs(pb[0].x - pa[0].x).toFixed(3));

  // --- 整体平移：两个锚点位移必须一致 ---
  const before = d1.pts.map((p) => ({ time: p.time, price: p.price }));
  const mid2 = L.pixelPts(d1);
  L.onDown((mid2[0].x + mid2[1].x) / 2, (mid2[0].y + mid2[1].y) / 2);
  L.onMove((mid2[0].x + mid2[1].x) / 2 + 40, (mid2[0].y + mid2[1].y) / 2 + 25);
  L.onUp();
  const dtA = d1.pts[0].time - before[0].time;
  const dtB = d1.pts[1].time - before[1].time;
  const dpA = d1.pts[0].price - before[0].price;
  const dpB = d1.pts[1].price - before[1].price;
  t('整体平移：两个锚点的 Δ时间 / Δ价格 完全一致',
    near(dtA, dtB, 1) && near(dpA, dpB, 1e-9),
    'dt=' + dtA.toFixed(0) + '/' + dtB.toFixed(0) + '  dp=' + dpA.toFixed(6) + '/' + dpB.toFixed(6));

  // --- 撤销 / 重做 ---
  const afterDrag = JSON.stringify(d1.pts);
  L.undo();
  t('undo 能把平移退回去', JSON.stringify(L.find(d1.id)!.pts) !== afterDrag);
  L.redo();
  t('redo 能再推回来', JSON.stringify(L.find(d1.id)!.pts) === afterDrag);

  // --- 各类型的像素几何：**每种用一个独立图层** ---
  // 混在一个图层里测会互相干扰：点到水平线外 6px 可能正好碰到旁边的趋势线，
  // 于是「没命中水平线」这条断言就假失败了。夹具要隔离。
  const Lh = new DrawLayer(host);
  const h = Lh.add('hline', [{ time: host.bars[10].time, price: 105 }]);
  const hp = Lh.pixelPts(h)[0];
  t('水平线：横跨整宽，任意 x 都能命中',
    !!Lh.hitTest(host.plot.r - 20, hp.y) && Lh.hitTest(20, hp.y)!.d.id === h.id);
  t('水平线：y 偏 6px（容差 5）就不命中', Lh.hitTest(300, hp.y + 6) === null);

  const Lv = new DrawLayer(host);
  const v = Lv.add('vline', [{ time: host.bars[25].time, price: 100 }]);
  const vp = Lv.pixelPts(v)[0];
  t('垂直线：同一 x 上下都能命中', !!Lv.hitTest(vp.x, 10) && !!Lv.hitTest(vp.x, 380));
  t('垂直线：x 偏 6px 就不命中', Lv.hitTest(vp.x + 6, 200) === null);

  const Lr = new DrawLayer(host);
  const rc = Lr.add('rect', [
    { time: host.bars[10].time, price: 100 },
    { time: host.bars[35].time, price: 112 },
  ]);
  const rp = Lr.pixelPts(rc);
  t('矩形：内部命中（不是只有边框）',
    !!Lr.hitTest((rp[0].x + rp[1].x) / 2, (rp[0].y + rp[1].y) / 2));
  t('矩形：边框命中', !!Lr.hitTest((rp[0].x + rp[1].x) / 2, rp[0].y));

  const Lf = new DrawLayer(host);
  const fb = Lf.add('fib', [
    { time: host.bars[8].time, price: 96 },
    { time: host.bars[45].time, price: 116 },
  ]);
  const fp = Lf.pixelPts(fb);
  let fibHitAll = true;
  for (const lv of FIB_LEVELS) {
    const y = fp[0].y + lv.l * (fp[1].y - fp[0].y);
    if (!Lf.hitTest((fp[0].x + fp[1].x) / 2, y)) fibHitAll = false;
  }
  t('斐波那契：7 条档位线全部可命中', fibHitAll);
  t('斐波那契：档位之间（0.3）不命中',
    !Lf.hitTest((fp[0].x + fp[1].x) / 2, fp[0].y + 0.3 * (fp[1].y - fp[0].y)));

  // --- 磁吸 ---
  const target = host.bars[30];
  const pxNear = L.timeToX(target.time);
  const pyNear = host.yOf(target.high + (host.scale.max - host.scale.min) * 0.01);
  L.setMagnet(false);
  const free = L.anchorAt(pxNear, pyNear);
  L.setMagnet(true);
  const snapped = L.anchorAt(pxNear, pyNear);
  t('磁吸开启时价格吸附到该 bar 的 OHLC',
    [target.open, target.high, target.low, target.close].some((v) => near(snapped.price, v, 1e-9)),
    'snapped=' + snapped.price.toFixed(4));
  t('磁吸开启时时间吸附到该 bar 的开盘时间', near(snapped.time, target.time, 1e-9));
  t('磁吸关闭时不吸附', !near(free.time, target.time, 1) || !near(free.price, snapped.price, 1e-9));

  const farPy = host.yOf((host.scale.min + host.scale.max) / 2);
  t('磁吸只在够近时生效（离得远保持自由）',
    !near(L.anchorAt(pxNear, farPy).price, snapped.price, 1e-9) ||
      Math.abs(L.anchorAt(pxNear, farPy).price - snapped.price) > 1e-9);

  // --- 单点工具一次画完 ---
  L.setTool('hline');
  const n0 = L.drawings.length;
  L.onDown(300, 200);
  t('单点工具点一下就成形并自动切回光标',
    L.drawings.length === n0 + 1 && L.tool === 'cursor');

  // --- 两点工具需要两次点击 ---
  L.setTool('trend');
  const n1 = L.drawings.length;
  L.onDown(100, 100);
  t('两点工具第一次点击只是待定，还没进列表', L.drawings.length === n1);
  L.onDown(300, 250);
  t('两点工具第二次点击才成型', L.drawings.length === n1 + 1);

  // --- 光标模式下空点不接管（要留给 KChart 平移）---
  L.setTool('cursor');
  L.select(null);
  t('光标模式点空白返回 false（让 KChart 平移）', L.onDown(650, 380) === false);
  t('光标模式点已有图形返回 true（接管，不平移）', L.onDown(300, 250) === true);
  L.onUp();

  // --- 锁定：仍可命中（选中弹属性条解锁），但拖不动、橡皮擦与 Delete 都删不掉 ---
  const lockMe = L.drawings[L.drawings.length - 1];
  const lockPt = L.pixelPts(lockMe)[0];
  const lockMid = (() => { const q = L.pixelPts(lockMe); return { x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 }; })();
  L.setLocked(lockMe.id, true);
  L.select(null);
  const lockHit = L.hitTest(lockMid.x, lockMid.y);
  t('锁定后仍能命中（可选中弹属性工具条）', !!lockHit && lockHit.d.id === lockMe.id);
  t('锁定后 onDown 只选中不拖拽、onMove 不改锚点',
    (() => {
      L.onDown(lockMid.x, lockMid.y);
      const dragOn = L['drag'] != null;
      L.onMove(lockMid.x + 50, lockMid.y + 30);
      L.onUp();
      const q = L.find(lockMe.id)!.pts;
      const orig = L['drag'] === null && !dragOn && q[0].time === lockMe.pts[0].time;
      return L.activeId === lockMe.id && !dragOn && orig;
    })());
  t('锁定后 Delete 键（removeActive）删不掉',
    (() => { const n = L.drawings.length; const ok = !L.removeActive() && L.drawings.length === n; L.select(null); return ok; })());
  L.setLocked(lockMe.id, false);
  t('setLocked 两次入撤销栈：undo 一次回到「锁定」，再 undo 回「未锁」',
    (() => {
      const wasLocked = L.find(lockMe.id)!.locked;
      L.undo();
      const afterOne = L.find(lockMe.id)!.locked;
      L.undo();
      const afterTwo = L.find(lockMe.id)!.locked;
      L.redo(); L.redo();
      return !wasLocked && afterOne && !afterTwo;
    })());
  t('锁定图形手柄不参与拖动（part 返回下标但 drag 为空）', (() => {
    L.setLocked(lockMe.id, true);
    L.select(lockMe.id);
    const h = L.hitTest(lockPt.x, lockPt.y);
    L.onDown(lockPt.x, lockPt.y);
    const noDrag = L['drag'] === null;
    L.onUp();
    L.setLocked(lockMe.id, false);
    return !!h && h.part === 0 && noDrag;
  })());

  // --- 隐藏 ---
  L.setHidden(true);
  t('隐藏后 hitTest 什么都测不到', L.hitTest(300, 250) === null);
  L.setHidden(false);

  // --- 持久化 ---
  const doc = L.toJSON();
  const L2 = new DrawLayer(makeFakeHost(closes, 10));
  L2.fromJSON(JSON.parse(JSON.stringify(doc)));
  t('toJSON / fromJSON 往返一致',
    L2.drawings.length === L.drawings.length &&
    JSON.stringify(L2.drawings) === JSON.stringify(L.drawings),
    L2.drawings.length + ' vs ' + L.drawings.length);
  t('fromJSON 后新加的 id 不与旧的冲突', (() => {
    const before = L2.drawings.map((x) => x.id);
    const nd = L2.add('trend', [
      { time: host.bars[1].time, price: 100 },
      { time: host.bars[2].time, price: 101 },
    ]);
    return before.indexOf(nd.id) < 0;
  })());

  // --- 删除 / 清空 ---
  const cnt = L.drawings.length;
  L.select(L.drawings[0].id);
  L.removeActive();
  t('removeActive 删掉选中的那条', L.drawings.length === cnt - 1 && L.activeId === null);
  L.clear();
  t('clear 清空全部', L.drawings.length === 0);
  t('clear 之后能 undo 回来', L.undo() && L.drawings.length === cnt - 1);

  // --- 几何纯函数 ---
  t('distToSeg：点到线段（含端点夹紧）',
    near(distToSeg(5, 5, 0, 0, 10, 0), 5) &&
    near(distToSeg(-5, 0, 0, 0, 10, 0), 5) &&
    near(distToSeg(15, 0, 0, 0, 10, 0), 5));
  t('rayToX：射线延伸到右边界的 y 正确',
    near(rayToX(0, 0, 10, 10, 100).y, 100) &&
    near(rayToX(0, 0, 10, 0, 100).y, 0));
  t('rayToX：垂直线不会除零', isFinite(rayToX(5, 0, 5, 100, 500).x));

  // --- 2.8 新工具：每种至少 命中 on/off 两条；三点工具加交互断言 ---
  const n28: Drawing[] = [];
  {
    const Lh2 = new DrawLayer(host);
    n28.push(Lh2.add('hray', [{ time: host.bars[10].time, price: 105 }]));
    const hp2 = Lh2.pixelPts(n28[0])[0];
    t('水平射线：起点向右能命中', !!Lh2.hitTest(host.plot.r - 20, hp2.y));
    t('水平射线：起点向左命中不到', Lh2.hitTest(hp2.x - 40, hp2.y) === null);

    const Le = new DrawLayer(host);
    const de = Le.add('extline', [
      { time: host.bars[8].time, price: 96 },
      { time: host.bars[45].time, price: 116 },
    ]);
    const pe = Le.pixelPts(de);
    const ee = rayToX(pe[0].x, pe[0].y, pe[1].x, pe[1].y, host.plot.r - 10);
    t('延长线：两端延伸段都能命中', !!Le.hitTest(ee.x, ee.y) && !!Le.hitTest((pe[0].x + pe[1].x) / 2, (pe[0].y + pe[1].y) / 2));
    t('延长线：离线远点不命中', Le.hitTest((pe[0].x + pe[1].x) / 2, (pe[0].y + pe[1].y) / 2 + 40) === null);

    const La = new DrawLayer(host);
    n28.push(La.add('arrow', [
      { time: host.bars[5].time, price: 98 },
      { time: host.bars[35].time, price: 114 },
    ]));
    const pa2 = La.pixelPts(n28[1]);
    t('箭头：线段中点能命中', !!La.hitTest((pa2[0].x + pa2[1].x) / 2, (pa2[0].y + pa2[1].y) / 2));
    t('箭头：线段外不命中', La.hitTest((pa2[0].x + pa2[1].x) / 2, (pa2[0].y + pa2[1].y) / 2 + 40) === null);

    const Ll = new DrawLayer(host);
    n28.push(Ll.add('ellipse', [
      { time: host.bars[10].time, price: 98 },
      { time: host.bars[35].time, price: 114 },
    ]));
    const pl = Ll.pixelPts(n28[2]);
    t('椭圆：内部命中（不只边缘）', !!Ll.hitTest((pl[0].x + pl[1].x) / 2, (pl[0].y + pl[1].y) / 2));
    t('椭圆：外部不命中', Ll.hitTest((pl[0].x + pl[1].x) / 2, Math.min(pl[0].y, pl[1].y) - 40) === null);

    // 三点交互：三角形两次点击仍待定，第三次成型
    const Lt = new DrawLayer(host);
    Lt.setTool('triangle');
    Lt.onDown(100, 300);
    Lt.onDown(500, 300);
    t('三角形：两次点击仍是待定', Lt.drawings.length === 0);
    Lt.onDown(300, 80);
    t('三角形：第三次点击成型为 3 锚点', Lt.drawings.length === 1 && Lt.drawings[0].pts.length === 3);
    const pt3 = Lt.pixelPts(Lt.drawings[0]);
    t('三角形：内部与边命中、外部不命中',
      !!Lt.hitTest((pt3[0].x + pt3[1].x + pt3[2].x) / 3, (pt3[0].y + pt3[1].y + pt3[2].y) / 3) &&
      Lt.hitTest(pt3[1].x, pt3[1].y + 60) === null);

    const Lc = new DrawLayer(host);
    const dc = Lc.add('channel', [
      { time: host.bars[8].time, price: 100 },
      { time: host.bars[40].time, price: 100 },
      { time: host.bars[8].time, price: 110 },
    ]);
    const pc = Lc.pixelPts(dc);
    const topY = Math.min(pc[0].y, pc[2].y);
    t('平行通道：带内与两条边都能命中',
      !!Lc.hitTest((pc[0].x + pc[1].x) / 2 + (pc[2].x - pc[0].x) / 2, (pc[0].y + pc[1].y) / 2 + (pc[2].y - pc[0].y) / 2) &&
      !!Lc.hitTest((pc[0].x + pc[1].x) / 2, pc[0].y) &&
      !!Lc.hitTest((pc[0].x + pc[1].x) / 2, pc[2].y));
    t('平行通道：带外不命中', Lc.hitTest((pc[0].x + pc[1].x) / 2, topY - 30) === null);

    t('2.8 几何：inTriangle / inParallelogram',
      inTriangle(5, 5, 0, 0, 10, 0, 5, 10) && !inTriangle(20, 20, 0, 0, 10, 0, 5, 10) &&
      inParallelogram(5, 3, 0, 0, 10, 0, 0, 6) && !inParallelogram(5, 8, 0, 0, 10, 0, 0, 6));

    // --- 光标组新工具：圆点 / 荧光笔 / 橡皮擦（设计稿「十字线」子菜单） ---
    const Ld = new DrawLayer(host);
    const dd = Ld.add('dot', [{ time: host.bars[20].time, price: 105 }]);
    const pd = Ld.pixelPts(dd)[0];
    t('圆点：圆心命中 / 40px 外不命中', !!Ld.hitTest(pd.x, pd.y) && Ld.hitTest(pd.x + 40, pd.y) === null);
    t('光标组：工具表 72 种且新三项就位',
      DRAW_TOOLS.length === 89 &&
      toolDef('dot').points === 1 && toolDef('highlight').points === 0 && toolDef('eraser').points === 0);
    t('线组：信息线/趋势角度/横线 就位',
      toolDef('infoline').points === 2 && toolDef('angle').points === 2 && toolDef('crossline').points === 1 &&
      toolDef('trend').key3 === '⌥T' && toolDef('crossline').key3 === '⌥C');
    t('斐波那契/江恩组：13 种新工具就位（锚点数 + ⌥F）',
      toolDef('fib').key3 === '⌥F' &&
      ['fibext', 'fibchannel', 'fibttz'].every((k) => toolDef(k).points === 3) &&
      ['fibtz', 'fibfan', 'fibcirc', 'fibspiral', 'fibarc', 'fibwedge', 'tiltfan', 'gannbox', 'gannsqf', 'gannsq'].every((k) => toolDef(k).points === 2));

    // --- 设计稿「图表形态」子菜单：形态/波浪 + 循环组 ---
    t('形态/波浪组：11 种工具就位（标签数 = 锚点数）',
      ['xabcd', 'shark', 'hs', 'abcd', 'tri', 'threedrives', 'ewimpulse', 'ewcorrection', 'ewtriangle', 'ewdouble', 'ewtriple']
        .every((k) => PATTERN_LABELS[k].length === toolDef(k).points));

    const Lp = new DrawLayer(host);
    const dpat = Lp.add('xabcd', [
      { time: host.bars[6].time, price: 100 },
      { time: host.bars[12].time, price: 108 },
      { time: host.bars[18].time, price: 102 },
      { time: host.bars[26].time, price: 110 },
      { time: host.bars[34].time, price: 104 },
    ]);
    const pp = Lp.pixelPts(dpat);
    const segMid = { x: (pp[1].x + pp[2].x) / 2, y: (pp[1].y + pp[2].y) / 2 };
    t('XABCD 形态：折线段与锚点都能命中 / 远点不命中',
      !!Lp.hitTest(segMid.x, segMid.y) && !!Lp.hitTest(pp[3].x, pp[3].y) &&
      Lp.hitTest(segMid.x, segMid.y + 50) === null);

    const Lcy = new DrawLayer(host);
    const dcy = Lcy.add('cycle', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[20].time, price: 100 },
    ]);
    const pcy = Lcy.pixelPts(dcy);
    const cunit = pcy[1].x - pcy[0].x;
    t('循环线：每周期主线与 18% 副线都能命中 / 周期中间不命中',
      !!Lcy.hitTest(pcy[0].x + 2 * cunit, 200) &&
      !!Lcy.hitTest(pcy[0].x + 2 * cunit + 0.18 * cunit, 200) &&
      Lcy.hitTest(pcy[0].x + 0.5 * cunit, 200) === null);

    const Ltc = new DrawLayer(host);
    const dtc = Ltc.add('timecycle', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[20].time, price: 100 },
    ]);
    const ptc = Ltc.pixelPts(dtc);
    t('时间循环：第 3 根垂直线命中 / 两根之间不命中',
      !!Ltc.hitTest(ptc[0].x + 3 * (ptc[1].x - ptc[0].x), 200) &&
      Ltc.hitTest(ptc[0].x + 3.5 * (ptc[1].x - ptc[0].x), 200) === null);

    const Lsi = new DrawLayer(host);
    const dsi = Lsi.add('sine', [
      { time: host.bars[8].time, price: 105 },
      { time: host.bars[40].time, price: 105 },
    ]);
    const psi = Lsi.pixelPts(dsi);
    const spoly = sinePts(psi[0].x, psi[0].y, psi[1].x, psi[1].y);
    const sm2 = spoly[Math.floor(spoly.length * 0.25)];
    t('正弦线：波峰附近采样点能命中 / 远离弦线不命中',
      !!Lsi.hitTest(sm2.x, sm2.y) && Lsi.hitTest(psi[0].x + 100, psi[0].y - 90) === null);
    t('几何：sinePts 起点在弦上、振幅 = 0.18 × 弦长',
      near(spoly[0].x, psi[0].x, 0.5) && near(spoly[0].y, psi[0].y, 0.5) &&
      near(Math.max(...spoly.map((q) => q.y)) - psi[0].y, Math.hypot(psi[1].x - psi[0].x, psi[1].y - psi[0].y) * 0.18, 1));

    // --- 斐波那契/江恩组抽测：时区垂直线 + 江恩箱网格 + 螺旋折线 ---
    const Lz = new DrawLayer(host);
    const dz = Lz.add('fibtz', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[20].time, price: 100 },
    ]);
    const pz = Lz.pixelPts(dz);
    const zunit = pz[1].x - pz[0].x;
    t('斐波那契时区：锚点与 φ/φ² 倍数处的垂直线都能命中',
      !!Lz.hitTest(pz[0].x, 200) &&
      !!Lz.hitTest(pz[0].x + 1.618 * zunit, 200) &&
      Lz.hitTest(pz[0].x + 0.5 * zunit, 200) === null);

    const Lg = new DrawLayer(host);
    const dg = Lg.add('gannbox', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[35].time, price: 112 },
    ]);
    const pg = Lg.pixelPts(dg);
    const gl = Math.min(pg[0].x, pg[1].x);
    const gt = Math.min(pg[0].y, pg[1].y);
    const gw = Math.abs(pg[1].x - pg[0].x);
    const gh = Math.abs(pg[1].y - pg[0].y);
    const gbot = Math.max(pg[0].y, pg[1].y);
    t('江恩箱：内部 / 对角线 / 外部',
      !!Lg.hitTest((pg[0].x + pg[1].x) / 2, (pg[0].y + pg[1].y) / 2) &&
      !!Lg.hitTest(gl + gw * 0.25, gt + gh * 0.25) &&
      Lg.hitTest((pg[0].x + pg[1].x) / 2, gbot + 30) === null);

    const Ls = new DrawLayer(host);
    const ds = Ls.add('fibspiral', [
      { time: host.bars[10].time, price: 105 },
      { time: host.bars[30].time, price: 105 },
    ]);
    const ps = Ls.pixelPts(ds);
    const sp = spiralPts(ps[0].x, ps[0].y, Math.max(Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y) * 0.05, 2), 1.618);
    const sm = sp[Math.floor(sp.length / 2)];
    t('斐波那契螺旋：采样折线上的点能命中 / 远点不命中',
      !!Ls.hitTest(sm.x, sm.y) && Ls.hitTest(ps[0].x, ps[0].y - 150) === null);
    t('几何：distToPolyline / arcPts / spiralPts',
      near(distToPolyline(5, 5, [{ x: 0, y: 0 }, { x: 10, y: 0 }]), 5) &&
      arcPts(0, 0, 10, 0, Math.PI).length === 33 &&
      near(spiralPts(0, 0, 2, 1.618, 1.5, 4)[4].x, -2 * Math.pow(1.618, 6), 1e-6));

    const Lh = new DrawLayer(host);
    Lh.setTool('highlight');
    Lh.onDown(host.xCenter(10), host.yOf(105));
    Lh.onMove(host.xCenter(16), host.yOf(105));
    Lh.onMove(host.xCenter(22), host.yOf(105));
    Lh.onUp();
    const dh = Lh.drawings[0];
    t('荧光笔：拖动采点收笔成型，一笔一次 undo',
      !!dh && dh.type === 'highlight' && dh.pts.length >= 3 && Lh.tool === 'cursor' &&
      (() => { const n = Lh.drawings.length; Lh.undo(); const ok = Lh.drawings.length === n - 1; Lh.redo(); return ok && Lh.drawings.length === n; })());
    const ph = Lh.pixelPts(dh);
    t('荧光笔：笔迹段命中 / 远点不命中 / 无逐锚点手柄',
      !!Lh.hitTest((ph[1].x + ph[2].x) / 2, ph[1].y) &&
      Lh.hitTest(ph[1].x, ph[1].y + 40) === null &&
      Lh.hitTest(ph[1].x, ph[1].y)!.part === 'body');

    const Lr = new DrawLayer(host);
    const dr0 = Lr.add('hline', [{ time: host.bars[10].time, price: 105 }]);
    Lr.add('dot', [{ time: host.bars[30].time, price: 112 }]);
    Lr.setTool('eraser');
    Lr.onDown(host.xCenter(40), host.yOf(130));
    const kept1 = Lr.drawings.length === 2;
    Lr.onDown(host.xCenter(20), Lr.pixelPts(Lr.drawings.find((x) => x.id === dr0.id)!)[0].y);
    t('橡皮擦：点空消费点击不误删', kept1);
    const erased = Lr.drawings.length === 1;
    Lr.undo();
    t('橡皮擦：点中删除且 undo 复原', erased && Lr.drawings.length === 2);

    // --- 橡皮擦对齐官方 LineToolEraser：悬停高亮 / 锁定照擦 / ⌘+点擦档位 ---
    const Ler = new DrawLayer(host);
    const der1 = Ler.add('trend', [
      { time: host.bars[5].time, price: 100 },
      { time: host.bars[45].time, price: 118 },
    ]);
    const per1 = Ler.pixelPts(Ler.drawings.find((x) => x.id === der1.id)!);
    const emid = { x: (per1[0].x + per1[1].x) / 2, y: (per1[0].y + per1[1].y) / 2 };
    Ler.select(null);
    Ler.onMove(emid.x, emid.y);
    const noHoverInCursor = Ler.hoverId === null;
    Ler.setTool('eraser');
    Ler.onMove(emid.x, emid.y);
    t('橡皮擦：悬停到图形就点亮锚点（光标模式不亮、只亮不选）',
      noHoverInCursor && Ler.hoverId === der1.id && Ler.activeId === null);
    Ler.onMove(emid.x, host.plot.b - 4);
    t('橡皮擦：移开就收掉悬停高亮', Ler.hoverId === null);
    t('橡皮擦：光标是带热点 5 5 的 url（官方 .cur 同款）',
      ERASER_CURSOR.startsWith('url("data:image/svg+xml') && ERASER_CURSOR.includes('5 5, crosshair'));

    Ler.setLocked(der1.id, true);
    Ler.onMove(emid.x, emid.y);
    const lockedNoHover = Ler.hoverId === null;
    Ler.onDown(emid.x, emid.y);
    t('橡皮擦：锁定的图形悬停不亮，但照样擦得掉（官方锁定判断在橡皮分支之后）',
      lockedNoHover && Ler.drawings.length === 0);

    const Lf2 = new DrawLayer(host);
    const df2 = Lf2.add('fib', [
      { time: host.bars[5].time, price: 96 },
      { time: host.bars[45].time, price: 124 },
    ]);
    const pf2 = Lf2.pixelPts(Lf2.drawings.find((x) => x.id === df2.id)!);
    const li2 = 3;                                  // 0.5 档
    const ly2 = pf2[0].y + FIB_LEVELS[li2].l * (pf2[1].y - pf2[0].y);
    const fx2 = host.xCenter(25);
    const partLv = Lf2.hitTest(fx2, ly2);
    Lf2.setTool('eraser');
    Lf2.onDown(fx2, ly2, true);
    const oneLervel = Lf2.drawings.length === 1 &&
      JSON.stringify(Lf2.drawings[0].style.hiddenLevels) === '[' + li2 + ']';
    const gone = Lf2.hitTest(fx2, ly2);
    Lf2.undo();
    t('橡皮擦：⌘/Ctrl + 点档位线只擦那一档（图形还在、该档不再命中、undo 复原）',
      !!partLv && String(partLv.part) === 'level:' + li2 && oneLervel &&
      (gone ? String(gone.part) : '') !== 'level:' + li2 &&
      (Lf2.drawings[0].style.hiddenLevels ?? []).length === 0);

    // --- 设计稿「预测/基于成交量/测量」子菜单（多头仓位按钮）：12 种新工具 ---
    t('预测组：多/空仓位 2 锚点、仓位预测 3 锚点、K线形态 1 锚点',
      toolDef('longpos').points === 2 && toolDef('shortpos').points === 2 &&
      toolDef('forecast').points === 3 && toolDef('kpattern').points === 1 &&
      toolDef('simcandle').points === 2 && toolDef('fan').points === 2);
    t('成交量/测量组：VWAP 与锚定分布 1 锚点、范围类 2 锚点',
      toolDef('avwap').points === 1 && toolDef('avprofile').points === 1 &&
      toolDef('vprofile').points === 2 && ['prange', 'drange', 'dprange'].every((k) => toolDef(k).points === 2));

    const Llp = new DrawLayer(host);
    const dlp = Llp.add('longpos', [
      { time: host.bars[10].time, price: 104 },
      { time: host.bars[30].time, price: 100 },
    ]);
    const plp = Llp.pixelPts(dlp);
    t('多头仓位：目标箱（104+4×2=112）/ 止损箱内能命中，箱外不命中',
      !!Llp.hitTest((plp[0].x + plp[1].x) / 2, host.yOf(108)) &&
      !!Llp.hitTest((plp[0].x + plp[1].x) / 2, host.yOf(101)) &&
      Llp.hitTest((plp[0].x + plp[1].x) / 2, host.yOf(95)) === null);

    const Lsp = new DrawLayer(host);
    const dsp = Lsp.add('shortpos', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[30].time, price: 104 },
    ]);
    const psp = Lsp.pixelPts(dsp);
    t('空头仓位：目标箱（100−4×2=92）/ 止损箱内能命中，上方箱外不命中',
      !!Lsp.hitTest((psp[0].x + psp[1].x) / 2, host.yOf(96)) &&
      !!Lsp.hitTest((psp[0].x + psp[1].x) / 2, host.yOf(103)) &&
      Lsp.hitTest((psp[0].x + psp[1].x) / 2, host.yOf(109)) === null);

    const Lfc = new DrawLayer(host);
    const dfc = Lfc.add('forecast', [
      { time: host.bars[8].time, price: 100 },
      { time: host.bars[20].time, price: 108 },
      { time: host.bars[34].time, price: 104 },
    ]);
    const pfc = Lfc.pixelPts(dfc);
    t('仓位预测：两段折线中点能命中，线外不命中',
      !!Lfc.hitTest((pfc[0].x + pfc[1].x) / 2, (pfc[0].y + pfc[1].y) / 2) &&
      !!Lfc.hitTest((pfc[1].x + pfc[2].x) / 2, (pfc[1].y + pfc[2].y) / 2) &&
      Lfc.hitTest((pfc[1].x + pfc[2].x) / 2, (pfc[1].y + pfc[2].y) / 2 + 50) === null);

    const Lkp = new DrawLayer(host);
    const dkp = Lkp.add('kpattern', [{ time: host.bars[15].time, price: 105 }]);
    const pkp = Lkp.pixelPts(dkp)[0];
    t('K线形态：迷你K线区内能命中，下方不命中',
      !!Lkp.hitTest(pkp.x + 12, pkp.y - KPATTERN_H / 2) &&
      Lkp.hitTest(pkp.x + 12, pkp.y + 40) === null);

    const Lsc = new DrawLayer(host);
    const dsc = Lsc.add('simcandle', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[24].time, price: 108 },
    ]);
    const psc = Lsc.pixelPts(dsc);
    t('模拟K线：K线区间内能命中，区间外不命中',
      !!Lsc.hitTest((psc[0].x + psc[1].x) / 2, (psc[0].y + psc[1].y) / 2) &&
      Lsc.hitTest((psc[0].x + psc[1].x) / 2 + 300, (psc[0].y + psc[1].y) / 2) === null);

    const Lfn = new DrawLayer(host);
    const dfn = Lfn.add('fan', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[30].time, price: 110 },
    ]);
    const pfn = Lfn.pixelPts(dfn);
    t('扇形：0° 基线方向射线能命中，垂直偏移远处不命中',
      !!Lfn.hitTest(pfn[0].x + (pfn[1].x - pfn[0].x) * 0.5, pfn[0].y + (pfn[1].y - pfn[0].y) * 0.5) &&
      Lfn.hitTest(pfn[0].x + (pfn[1].x - pfn[0].x) * 0.5, pfn[0].y + (pfn[1].y - pfn[0].y) * 0.5 + 40) === null);

    const Lav = new DrawLayer(host);
    const dav = Lav.add('avwap', [{ time: host.bars[10].time, price: 105 }]);
    const iav = host.indexAtTime(dav.pts[0].time);
    const vav = vwapSeries(host.bars, iav);
    t('锚定VWAP：曲线上（锚点处）能命中，曲线上方远处不命中',
      !!Lav.hitTest(host.xCenter(iav), host.yOf(vav[0])) &&
      Lav.hitTest(host.xCenter(iav), host.yOf(vav[0]) - 80) === null);

    const Lvp = new DrawLayer(host);
    const dvp = Lvp.add('vprofile', [
      { time: host.bars[10].time, price: 98 },
      { time: host.bars[34].time, price: 112 },
    ]);
    const pvp = Lvp.pixelPts(dvp);
    t('成交量分布图：框内能命中，框外不命中',
      !!Lvp.hitTest((pvp[0].x + pvp[1].x) / 2, (pvp[0].y + pvp[1].y) / 2) &&
      Lvp.hitTest((pvp[0].x + pvp[1].x) / 2, Math.max(pvp[0].y, pvp[1].y) + 30) === null);

    const Lap = new DrawLayer(host);
    const dap = Lap.add('avprofile', [{ time: host.bars[10].time, price: 105 }]);
    const pap = Lap.pixelPts(dap)[0];
    let amn = Infinity;
    let amx = -Infinity;
    for (let i = 10; i < host.bars.length; i++) {
      if (host.bars[i].low < amn) amn = host.bars[i].low;
      if (host.bars[i].high > amx) amx = host.bars[i].high;
    }
    t('锚定成交量分布图：区间内能命中，锚点左侧不命中',
      !!Lap.hitTest(pap.x + VP_WIDTH / 2, host.yOf((amn + amx) / 2)) &&
      Lap.hitTest(Math.max(4, pap.x - 60), host.yOf((amn + amx) / 2)) === null);

    const Lpr = new DrawLayer(host);
    const dpr = Lpr.add('prange', [
      { time: host.bars[12].time, price: 100 },
      { time: host.bars[12].time, price: 112 },
    ]);
    const ppr = Lpr.pixelPts(dpr);
    t('价格范围：竖线中点与端帽能命中，右侧远处不命中',
      !!Lpr.hitTest(ppr[0].x, (ppr[0].y + ppr[1].y) / 2) &&
      !!Lpr.hitTest(ppr[0].x + 5, ppr[0].y) &&
      Lpr.hitTest(ppr[0].x + 40, (ppr[0].y + ppr[1].y) / 2) === null);

    const Ldr = new DrawLayer(host);
    const ddr = Ldr.add('drange', [
      { time: host.bars[10].time, price: 105 },
      { time: host.bars[30].time, price: 105 },
    ]);
    const pdr = Ldr.pixelPts(ddr);
    t('日期范围：横线中点与端帽能命中，下方远处不命中',
      !!Ldr.hitTest((pdr[0].x + pdr[1].x) / 2, pdr[0].y) &&
      !!Ldr.hitTest(pdr[0].x, pdr[0].y - 5) &&
      Ldr.hitTest((pdr[0].x + pdr[1].x) / 2, pdr[0].y + 40) === null);

    const Ldp = new DrawLayer(host);
    const ddp = Ldp.add('dprange', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[30].time, price: 112 },
    ]);
    const pdp = Ldp.pixelPts(ddp);
    t('日期和价格范围：框内与边框能命中，框外不命中',
      !!Ldp.hitTest((pdp[0].x + pdp[1].x) / 2, (pdp[0].y + pdp[1].y) / 2) &&
      !!Ldp.hitTest((pdp[0].x + pdp[1].x) / 2, pdp[0].y) &&
      Ldp.hitTest((pdp[0].x + pdp[1].x) / 2, Math.max(pdp[0].y, pdp[1].y) + 30) === null);

    t('几何：vwapSeries 首值 = 首 bar 典型价；volumeProfile 总量守恒且 POC 为最大箱',
      near(vwapSeries(host.bars, 5)[0], (host.bars[5].high + host.bars[5].low + host.bars[5].close) / 3, 1e-9) &&
      (() => {
        const vp = volumeProfile(host.bars, 0, 59, 24, host.scale.min, host.scale.max);
        const total = host.bars.reduce((s, b) => s + b.volume, 0);
        return Math.abs(vp.vol.reduce((s, v) => s + v, 0) - total) < 1e-9 &&
          vp.vol[vp.poc] === Math.max(...vp.vol);
      })());

    // --- 设计稿「笔刷」子菜单：笔刷/箭头/形状三组 ---
    t('笔刷/箭头/形状组：11 种新工具就位（锚点数 + ⌥R）',
      DRAW_TOOLS.length === 89 &&
      toolDef('brush').points === 0 && toolDef('rect').key3 === '⌥R' &&
      ['arrowmark', 'uparrow', 'downarrow'].every((k) => toolDef(k).points === 1) &&
      toolDef('rotrect').points === 3 && toolDef('curve').points === 3 &&
      ['path', 'polyline'].every((k) => toolDef(k).points === 4) &&
      ['circle', 'arc', 'hyperbola'].every((k) => toolDef(k).points === 2));

    // --- 设计稿 emoji 面板：「图标」按钮 → 分类面板 → 放置 emoji 标注 ---
    const Lem = new DrawLayer(host);
    Lem.emojiChar = '🚀';
    Lem.setTool('emoji');
    Lem.onDown(host.xCenter(18), host.yOf(104));
    Lem.onUp();
    t('emoji：放置后字符/字号入 style、工具回 cursor',
      Lem.drawings.length === 1 && Lem.drawings[0].style.text === '🚀' &&
      Lem.drawings[0].style.fontSize === EMOJI_SIZE && Lem.tool === 'cursor');
    const pem = Lem.pixelPts(Lem.drawings[0])[0];
    t('emoji：中心命中 / 字形外不命中；拖动换位 undo 复原',
      !!Lem.hitTest(pem.x, pem.y) && Lem.hitTest(pem.x + 40, pem.y) === null &&
      (() => {
        Lem.select(Lem.drawings[0].id);
        const d0 = Lem.drawings[0];
        const before = { ...d0.pts[0] };
        Lem.onDown(pem.x, pem.y);
        Lem.onMove(pem.x + 30, pem.y - 20);
        Lem.onUp();
        const moved = d0.pts[0].time !== before.time;
        Lem.undo();
        const back = Lem.find(d0.id)!.pts[0].time === before.time;
        return moved && back;
      })());

    // emoji 选中框：对齐官方 —— 贴合字形的细蓝框 + 四角白圆手柄，拖角改字号
    Lem.select(Lem.drawings[0].id);
    const emCs = emojiCornerPts(pem.x, pem.y, EMOJI_SIZE);
    const emBox = emojiBox(pem.x, pem.y, EMOJI_SIZE);
    const emHits = emCs.map((q) => Lem.hitTest(q.x, q.y));
    t('emoji 选中框：四角各返回自己的手柄、中点是本体、框边长 = 字号',
      emHits.every((h, i) => !!h && h.part === EMOJI_CORNERS[i]) &&
      !!Lem.hitTest(pem.x, pem.y) && Lem.hitTest(pem.x, pem.y)!.part === 'body' &&
      emBox.r - emBox.l === EMOJI_SIZE);
    t('emoji 拖角改字号：字号变大、锚点不动、undo 复原',
      (() => {
        const d0 = Lem.drawings[0];
        const before = { ...d0.pts[0] };
        const c0 = emojiCornerPts(pem.x, pem.y, d0.style.fontSize || EMOJI_SIZE)[2];
        Lem.onDown(c0.x, c0.y);
        Lem.onMove(pem.x + 30, pem.y + 30);
        Lem.onUp();
        const ok = d0.style.fontSize === 60 &&
          d0.pts[0].time === before.time && d0.pts[0].price === before.price;
        Lem.undo();
        return ok && Lem.find(d0.id)!.style.fontSize === EMOJI_SIZE;
      })());
    t('emoji 拖角夹取：拉回中心不缩成 0、甩出画布不超过上限',
      (() => {
        const d0 = Lem.drawings[0];
        let c0 = emojiCornerPts(pem.x, pem.y, d0.style.fontSize || EMOJI_SIZE)[2];
        Lem.onDown(c0.x, c0.y);
        Lem.onMove(pem.x + 1, pem.y + 1);
        Lem.onUp();
        const low = d0.style.fontSize === EMOJI_MIN;
        c0 = emojiCornerPts(pem.x, pem.y, d0.style.fontSize || EMOJI_SIZE)[2];
        Lem.onDown(c0.x, c0.y);
        Lem.onMove(pem.x + 4000, pem.y + 4000);
        Lem.onUp();
        const high = d0.style.fontSize === EMOJI_MAX;
        Lem.undo();
        Lem.undo();
        return low && high;
      })());

    // 笔刷：自由笔迹（与荧光笔同机制，默认色细线）
    const Lb = new DrawLayer(host);
    Lb.setTool('brush');
    Lb.onDown(host.xCenter(10), host.yOf(105));
    Lb.onMove(host.xCenter(16), host.yOf(107));
    Lb.onMove(host.xCenter(22), host.yOf(103));
    Lb.onUp();
    const brushed = Lb.drawings.length === 1 && Lb.drawings[0].type === 'brush' &&
      Lb.drawings[0].pts.length >= 3 && Lb.tool === 'cursor' &&
      Lb.drawings[0].style.width === 1 && Lb.drawings[0].style.color === '#00bcd4';
    Lb.undo();
    t('笔刷：拖动采点收笔成型、一笔一次 undo', brushed && Lb.drawings.length === 0);

    // --- 笔刷/荧光笔：对齐 charting_library（§2.6） ---
    const sm0 = smoothStroke([{ x: 0, y: 0 }, { x: 10, y: 0 }], STROKE_SMOOTH);
    t('笔刷/荧光笔：官方默认值（笔刷 #00bcd4·1px、荧光笔 20% 红·20px、smooth 5）',
      styleForTool('brush').color === BRUSH_COLOR && styleForTool('brush').width === BRUSH_WIDTH &&
      styleForTool('highlight').width === HIGHLIGHT_WIDTH &&
      styleForTool('highlight').color === HIGHLIGHT_COLOR &&
      STROKE_SMOOTH === 5 && STROKE_MIN_STEP === 2);
    t('笔刷/荧光笔：平滑 = 重采样 + 箱式模糊 + 补原始末点；命中带宽 max(3, 线宽/2)',
      sm0.length === 4 && Math.round(sm0[0].x) === 3 && Math.round(sm0[sm0.length - 1].x) === 10 &&
      smoothStroke([]).length === 0 && smoothStroke([{ x: 5, y: 5 }]).length === 1 &&
      strokeHitTol(20) === 10 && strokeHitTol(1) === 3 && STROKE_ANCHOR_RING === 5.5);

    // 箭头标记 / 向上 / 向下箭头：单击放置的字形
    const Lmk = new DrawLayer(host);
    const dmk = Lmk.add('arrowmark', [{ time: host.bars[20].time, price: 105 }]);
    const pmk = Lmk.pixelPts(dmk)[0];
    const dup = Lmk.add('uparrow', [{ time: host.bars[28].time, price: 105 }]);
    const pup = Lmk.pixelPts(dup)[0];
    const ddn = Lmk.add('downarrow', [{ time: host.bars[36].time, price: 105 }]);
    const pdn = Lmk.pixelPts(ddn)[0];
    t('箭头标记/上下箭头：字形中心能命中，远处不命中',
      !!Lmk.hitTest(pmk.x, pmk.y) && !!Lmk.hitTest(pup.x, pup.y) && !!Lmk.hitTest(pdn.x, pdn.y) &&
      Lmk.hitTest(pmk.x + 40, pmk.y + 40) === null);

    // 旋转矩形：p0p1 边 + p2 高度
    const Lrr = new DrawLayer(host);
    const drr = Lrr.add('rotrect', [
      { time: host.bars[8].time, price: 100 },
      { time: host.bars[24].time, price: 100 },
      { time: host.bars[8].time, price: 108 },
    ]);
    const prr = Lrr.pixelPts(drr);
    t('旋转矩形：形内与边框能命中，形外不命中',
      !!Lrr.hitTest((prr[0].x + prr[2].x) / 2, (prr[0].y + prr[2].y) / 2) &&
      !!Lrr.hitTest((prr[0].x + prr[1].x) / 2, prr[0].y) &&
      Lrr.hitTest(prr[0].x - 40, (prr[0].y + prr[2].y) / 2) === null);

    // 路径（开放）与折线（闭合）
    const Lpl = new DrawLayer(host);
    const dpath = Lpl.add('path', [
      { time: host.bars[6].time, price: 100 },
      { time: host.bars[14].time, price: 108 },
      { time: host.bars[22].time, price: 102 },
      { time: host.bars[30].time, price: 110 },
    ]);
    const ppath = Lpl.pixelPts(dpath);
    const dpoly = Lpl.add('polyline', [
      { time: host.bars[36].time, price: 100 },
      { time: host.bars[44].time, price: 108 },
      { time: host.bars[52].time, price: 102 },
    ]);
    const ppoly = Lpl.pixelPts(dpoly);
    const closeMid = { x: (ppoly[0].x + ppoly[2].x) / 2, y: (ppoly[0].y + ppoly[2].y) / 2 };
    t('路径：折线段上能命中，段外不命中；折线：首尾闭合边上也能命中',
      !!Lpl.hitTest((ppath[1].x + ppath[2].x) / 2, (ppath[1].y + ppath[2].y) / 2) &&
      Lpl.hitTest((ppath[1].x + ppath[2].x) / 2, (ppath[1].y + ppath[2].y) / 2 + 60) === null &&
      !!Lpl.hitTest(closeMid.x, closeMid.y));

    // 圆 / 弧形 / 曲线 / 双曲线
    const Lsh = new DrawLayer(host);
    const dcir = Lsh.add('circle', [
      { time: host.bars[10].time, price: 105 },
      { time: host.bars[20].time, price: 105 },
    ]);
    const pcir = Lsh.pixelPts(dcir);
    const rcir = Math.hypot(pcir[1].x - pcir[0].x, pcir[1].y - pcir[0].y);
    const darc = Lsh.add('arc', [
      { time: host.bars[30].time, price: 100 },
      { time: host.bars[40].time, price: 110 },
    ]);
    const parc = Lsh.pixelPts(darc);
    const dcv = Lsh.add('curve', [
      { time: host.bars[8].time, price: 100 },
      { time: host.bars[16].time, price: 112 },
      { time: host.bars[24].time, price: 100 },
    ]);
    const pcv = Lsh.pixelPts(dcv);
    const dhb = Lsh.add('hyperbola', [
      { time: host.bars[34].time, price: 100 },
      { time: host.bars[42].time, price: 100 },
    ]);
    const phb = Lsh.pixelPts(dhb);
    const arcHit = ellipseArcPts((parc[0].x + parc[1].x) / 2, (parc[0].y + parc[1].y) / 2,
      Math.abs(parc[1].x - parc[0].x) / 2, Math.abs(parc[1].y - parc[0].y) / 2, -Math.PI / 4, -Math.PI / 4)[0];
    t('圆：圆心与环带能命中；弧形：右上四分之一弧上能命中',
      !!Lsh.hitTest(pcir[0].x, pcir[0].y) &&
      !!Lsh.hitTest(pcir[0].x + rcir, pcir[0].y) &&
      !!Lsh.hitTest(arcHit.x, arcHit.y));
    t('曲线：贝塞尔中点能命中；双曲线：顶点（焦点中点右侧实半轴处）能命中',
      (() => {
        const mid = quadBezierPts(pcv[0], pcv[1], pcv[2])[16];
        const vx = (phb[0].x + phb[1].x) / 2;
        const vy = (phb[0].y + phb[1].y) / 2;
        const c = Math.hypot(phb[1].x - phb[0].x, phb[1].y - phb[0].y) / 2;
        const vtxX = vx + Math.max(c * 0.45, 6);
        return !!Lsh.hitTest(mid.x, mid.y) && !!Lsh.hitTest(vtxX, vy);
      })());

    // —— 浮动属性工具条（设计稿「画图时线的设置与删除」）相关引擎能力 ——
    const Lpb = new DrawLayer(host);
    const dp = Lpb.add('trend', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[30].time, price: 110 },
    ]);
    t('setStyle：改颜色 / 线宽立即生效，undo 退回，redo 复原',
      (() => {
        const c0 = dp.style.color;
        const w0 = dp.style.width;
        Lpb.setStyle(dp.id, { color: '#f23645', width: 4 });
        const after = Lpb.find(dp.id)!.style;
        Lpb.undo();
        const back = Lpb.find(dp.id)!.style;
        Lpb.redo();
        const again = Lpb.find(dp.id)!.style;
        return after.color === '#f23645' && after.width === 4 &&
          back.color === c0 && back.width === w0 &&
          again.color === '#f23645' && again.width === 4;
      })());
    t('setStyle：未知 id 返回 false 且不入撤销栈',
      (() => { const n = Lpb['snapshots'].length; return Lpb.setStyle(99999, { width: 8 }) === false && Lpb['snapshots'].length === n; })());
    t('selectionToolbarAnchor：无选中为 null；选中后 x 居中、y 在包围盒上方 46px',
      (() => {
        Lpb.select(null);
        if (Lpb.selectionToolbarAnchor() !== null) return false;
        Lpb.select(dp.id);
        const p = Lpb.pixelPts(Lpb.find(dp.id)!);
        const a = Lpb.selectionToolbarAnchor();
        if (!a) return false;
        const cx = (p[0].x + p[1].x) / 2 - 95; // BAR_W/2 = 95
        const top = Math.min(p[0].y, p[1].y);
        return Math.abs(a.x - Math.min(Math.max(cx, Lpb.host.plot.l + 4), Lpb.host.plot.r - 194)) < 0.5 &&
          Math.abs(a.y - (top - 46)) < 0.5;
      })());
    t('selectionToolbarAnchor：图形贴近顶部时翻转到下方',
      (() => {
        const dup = Lpb.add('trend', [
          { time: host.bars[10].time, price: host.scale.max },
          { time: host.bars[30].time, price: host.scale.max - 0.001 },
        ]);
        const a = Lpb.selectionToolbarAnchor();
        Lpb.remove(dup.id);
        return !!a && a.y > Lpb.host.plot.t;
      })());
    t('repeatDraw：开启后两点工具成型不切回光标；关闭后恢复',
      (() => {
        const Lq = new DrawLayer(host);
        Lq.setTool('trend');
        Lq.setRepeat(true);
        Lq.onDown(host.xCenter(10), host.yOf(105));
        Lq.onDown(host.xCenter(20), host.yOf(108));
        const stay = Lq.tool === 'trend' && Lq.drawings.length === 1;
        Lq.setRepeat(false);
        Lq.onDown(host.xCenter(24), host.yOf(106));
        Lq.onDown(host.xCenter(34), host.yOf(109));
        return stay && Lq.tool === 'cursor' && Lq.drawings.length === 2;
      })());
    t('clone：副本偏移 +48px/-36px、样式一致、自动选中、一次 undo 消失',
      (() => {
        const src = Lpb.find(dp.id)!;
        const cp = Lpb.clone(src.id);
        if (!cp) return false;
        const sp = Lpb.pixelPts(src);
        const pp = Lpb.pixelPts(cp);
        const dx = pp[0].x - sp[0].x;
        const dy = pp[0].y - sp[0].y;
        const okGeom = Math.abs(dx - 48) < 2 && Math.abs(dy + 36) < 2;
        const okStyle = JSON.stringify(cp.style) === JSON.stringify(src.style);
        Lpb.undo();
        const gone = Lpb.find(cp.id) === null;
        return okGeom && okStyle && Lpb.activeId !== cp.id && gone;
      })());

    // --- 对齐 charting_library（本地参考库）：音叉 / 文本标注 / 形状补齐 17 种 ---
    t('音叉族 + 文本标注 + 形状补齐：17 种工具就位（锚点数）',
      DRAW_TOOLS.length === 89 &&
      ['pitchfork', 'schiff', 'schiff2', 'innerfork', 'pitchfan'].every((k) => toolDef(k).points === 3) &&
      ['note', 'callout', 'comment', 'balloon', 'pricenote', 'pricelabel', 'signpost'].every((k) => toolDef(k).points === 1) &&
      toolDef('circlelines').points === 2 && toolDef('beziercubic').points === 4 &&
      toolDef('flatbottom').points === 2 && toolDef('arrowmarl').points === 1 && toolDef('arrowmarr').points === 1);
    t('pitchforkRays：音叉 3 条 / 扇形 5 条；希夫起点在 a·b 中点；平行线与中线同向',
      (() => {
        const A = { x: 10, y: 100 };
        const B = { x: 60, y: 80 };
        const C = { x: 60, y: 120 };
        const pf = pitchforkRays('pitchfork', A, B, C);
        const sf = pitchforkRays('schiff', A, B, C);
        const s2 = pitchforkRays('schiff2', A, B, C);
        const fan = pitchforkRays('pitchfan', A, B, C);
        const d0 = { x: pf[0].d.x - pf[0].o.x, y: pf[0].d.y - pf[0].o.y };
        const d1 = { x: pf[1].d.x - pf[1].o.x, y: pf[1].d.y - pf[1].o.y };
        const parallel = Math.abs(d0.x * d1.y - d0.y * d1.x) < 1e-9;
        return pf.length === 3 && fan.length === 5 &&
          Math.abs(sf[0].o.x - 35) < 1e-9 && Math.abs(sf[0].o.y - 90) < 1e-9 &&
          Math.abs(s2[0].o.x - 10) < 1e-9 && Math.abs(s2[0].o.y - 90) < 1e-9 &&
          parallel;
      })());
    t('cubicBezierPts：41 个采样点、首尾等于端点',
      (() => {
        const q = cubicBezierPts({ x: 0, y: 0 }, { x: 10, y: 30 }, { x: 30, y: -20 }, { x: 40, y: 10 });
        return q.length === 41 && q[0].x === 0 && q[0].y === 0 &&
          Math.abs(q[40].x - 40) < 1e-9 && Math.abs(q[40].y - 10) < 1e-9;
      })());
    t('arrowSideGlyphPts：右箭头头顶点在最右、左箭头在最左（同一字形旋转）',
      (() => {
        const r = arrowSideGlyphPts(100, 100, 13, 1);
        const lf = arrowSideGlyphPts(100, 100, 13, -1);
        return r[0].x > 100 && lf[0].x < 100 &&
          Math.abs(r[0].y - 100) < 1e-9 && Math.abs(lf[0].y - 100) < 1e-9;
      })());

    const Lnote = new DrawLayer(host);
    const dnote = Lnote.add('note', [{ time: host.bars[20].time, price: 105 }]);
    const an = Lnote.pixelPts(dnote)[0];
    t('便签：卡片区域内命中 / 卡外（锚点下方 70px）不命中',
      !!Lnote.hitTest(an.x + 40, an.y - 40) && Lnote.hitTest(an.x + 40, an.y + 70) === null);

    const Lcl = new DrawLayer(host);
    const dcl = Lcl.add('circlelines', [
      { time: host.bars[20].time, price: 105 },
      { time: host.bars[28].time, price: 108 },
    ]);
    const pcl = Lcl.pixelPts(dcl);
    const rcl = Math.hypot(pcl[1].x - pcl[0].x, pcl[1].y - pcl[0].y);
    t('圆加十字线：圆周与过圆心的水平线都能命中 / 圆外角点不命中',
      !!Lcl.hitTest(pcl[0].x + rcl, pcl[0].y) &&
      !!Lcl.hitTest(pcl[0].x + 20, pcl[0].y) &&
      Lcl.hitTest(pcl[0].x + rcl * 0.55, pcl[0].y - rcl * 0.55) === null);

    const Lbc = new DrawLayer(host);
    const dbc = Lbc.add('beziercubic', [
      { time: host.bars[6].time, price: 100 },
      { time: host.bars[14].time, price: 110 },
      { time: host.bars[26].time, price: 96 },
      { time: host.bars[36].time, price: 106 },
    ]);
    const pbc = Lbc.pixelPts(dbc);
    const bcmid = cubicBezierPts(pbc[0], pbc[1], pbc[2], pbc[3])[20];
    t('三次贝塞尔：曲线中点命中 / 曲线下 80px 不命中',
      !!Lbc.hitTest(bcmid.x, bcmid.y) && Lbc.hitTest(bcmid.x, bcmid.y + 80) === null);

    const Lfb = new DrawLayer(host);
    const dfb = Lfb.add('flatbottom', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[30].time, price: 100 },
    ]);
    const pfb = Lfb.pixelPts(dfb);
    t('平底：底边中点与内部命中 / 底边下 60px 不命中',
      !!Lfb.hitTest((pfb[0].x + pfb[1].x) / 2, pfb[0].y) &&
      !!Lfb.hitTest((pfb[0].x + pfb[1].x) / 2, pfb[0].y - 8) &&
      Lfb.hitTest((pfb[0].x + pfb[1].x) / 2, pfb[0].y + 60) === null);

    // --- 左栏「锁定所有绘图」：全锁 / 幂等 / 一次撤销回滚 ---
    const Llk = new DrawLayer(host);
    Llk.add('trend', [{ time: host.bars[4].time, price: 98 }, { time: host.bars[18].time, price: 104 }]);
    Llk.add('hline', [{ time: host.bars[8].time, price: 101 }]);
    Llk.add('rect', [{ time: host.bars[12].time, price: 99 }, { time: host.bars[28].time, price: 106 }]);
    const nLock = Llk.setAllLocked(true);
    t('setAllLocked(true)：3 个图形全上锁，返回改动数 3',
      nLock === 3 && Llk.drawings.every((d) => d.locked));
    t('setAllLocked 幂等：重复调用返回 0，且只入一次撤销栈',
      Llk.setAllLocked(true) === 0 && (() => { Llk.undo(); return Llk.drawings.every((d) => !d.locked); })());
    t('全锁后撤销已回滚，再调 setAllLocked(false) 是空操作（返回 0）',
      Llk.setAllLocked(false) === 0 && Llk.drawings.every((d) => !d.locked));

    // --- 测量：对齐 charting_library 的 MeasurePaneView ---
    const Lm = new DrawLayer(host);
    const dm = Lm.add('measure', [
      { time: host.bars[10].time, price: 100 },
      { time: host.bars[36].time, price: 99.74 },
    ]);
    const mi = measureInfo(host, dm.pts, 2);
    t('测量：跌 → 红（ripe-red-400），涨 → 蓝（tv-blue-500），不是涨绿跌红',
      !mi.up && MEASURE_DOWN.label === '#f7525f' && MEASURE_UP.label === '#2962ff' &&
      measureInfo(host, [{ time: host.bars[10].time, price: 100 }, { time: host.bars[36].time, price: 101 }], 2).up);
    t('测量：26 根K线 / 26 天 / 含两端 27 根成交量 2.7K',
      mi.bars === 26 && mi.seconds === 26 * 86400 && mi.volume === 27 * 100 &&
      mi.lines[1] === '26根K线, 26天' && mi.lines[2] === '成交量 2.7K');
    t('测量：卡片首行 = 价差(百分比) 跳动数（官方 −0.26 (−0.26%) −26）',
      mi.lines[0] === '−0.26 (−0.26%) −26');
    const mg = measureGuides({ x: 0, y: 0 }, { x: 60, y: 60 });
    const mg2 = measureGuides({ x: 0, y: 0 }, { x: 49, y: 49 });
    const mg3 = measureGuides({ x: 0, y: 0 }, { x: 60, y: 40 });
    t('测量：中线取两端中点、跨度 ≥ 50px 才出箭头（49 不画 / 只够一边也只画那一边）',
      mg.h.a.y === 30 && mg.v.a.x === 30 && mg.h.arrow && mg.v.arrow &&
      !mg2.h.arrow && !mg2.v.arrow && mg3.h.arrow && !mg3.v.arrow);
    const mbox = measureLabelBox(120, 3);
    const mAbove = measureLabelAnchor({ x: 0, y: 200 }, { x: 100, y: 100 }, mbox.h, 0, 400);
    const mBelow = measureLabelAnchor({ x: 0, y: 100 }, { x: 100, y: 200 }, mbox.h, 0, 400);
    t('测量：卡片三行 70 高；贴在终点外侧（上/下各 45px）',
      mbox.h === 70 && mAbove.y === 100 - 45 && mBelow.y === 200 + 45);

    const Lmd = new DrawLayer(host);
    Lmd.setTool('measure');
    Lmd.onDown(300, 100);
    Lmd.onMove(420, 220);
    Lmd.onUp();
    t('测量：按住拖一下就量完（官方手势），松手即成型并回到光标',
      Lmd.drawings.length === 1 && Lmd.drawings[0].type === 'measure' &&
      Lmd.pendingCount() === 0 && Lmd.tool === 'cursor');

    // 官方 defaultProperties（模块 64548）：形状不是一种颜色，线条是 2px
    const dRect = styleForTool('rect');
    const dCir = styleForTool('circle');
    const dTri = styleForTool('triangle');
    const dTrd = styleForTool('trend');
    const dFib = styleForTool('fib');
    t('默认属性对齐官方：矩形紫 #9c27b0 / 圆橙 #FF9800 / 三角绿 #089981',
      dRect.color === '#9c27b0' && dCir.color === '#FF9800' && dTri.color === '#089981');
    t('默认属性对齐官方：趋势线 2px 蓝、斐波那契灰、形状 20% 同色底',
      dTrd.color === '#2962FF' && dTrd.width === 2 && dFib.color === '#787B86' &&
      dRect.fill === 'rgba(156,39,176,0.2)' && dRect.width === 1);
  }

  log('绘图层自检：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail, names };
}
