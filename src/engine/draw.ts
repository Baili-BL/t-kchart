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

import { Bar, log } from './chart';

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
  { key: 'rect', label: '矩形', points: 2, key2: 'b',
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

/** 循环线：绘制的周期数（每周期一对垂直线，副线在周期起点右侧 18% 处） */
export const CYCLE_COUNT: number = 6;
export const CYCLE_PAIR_OFF: number = 0.18;

/** 时间循环：绘制的垂直线根数（每个周期一根，带序号标签） */
export const TIMECYCLE_COUNT: number = 8;

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
    // 从后往前测：后画的在上面
    for (let k = this.drawings.length - 1; k >= 0; k--) {
      const d = this.drawings[k];
      if (!d.visible || this.hidden || d.locked) continue;
      const p = this.pixelPts(d);
      if (!p.length) continue;

      // 先测手柄（选中态才有），手柄优先级最高。荧光笔是自由笔迹，只整体拖动，不提供逐锚点手柄
      if (this.activeId === d.id && d.type !== 'highlight') {
        for (let i = 0; i < p.length; i++) {
          if (Math.abs(px - p[i].x) <= tol && Math.abs(py - p[i].y) <= tol) {
            return { d, part: i };
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
      } else if (d.type === 'highlight') {
        // 自由笔迹：任意一段的宽笔画带内
        for (let i = 0; i < p.length - 1; i++) {
          if (distToSeg(px, py, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y) <= 5 + 6) return { d, part: 'body' };
        }
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
        // 任意一条水平档位线
        for (const lv of FIB_LEVELS) {
          const y = a.y + lv.l * (b.y - a.y);
          if (distToSeg(px, py, Math.min(a.x, b.x), y, Math.max(a.x, b.x), y) <= tol) {
            return { d, part: 'body' };
          }
        }
      } else if (d.type === 'fibext') {
        // 档位横跨整个绘图区的水平线（价格锚定 p2，单位价差 = p1-p0）
        const dp = d.pts[1].price - d.pts[0].price;
        for (const lv of FIB_EXT_LEVELS) {
          const y = ch.yOf(d.pts[2].price + lv.l * dp);
          if (distToSeg(px, py, ch.plot.l, y, ch.plot.r, y) <= tol) return { d, part: 'body' };
        }
      } else if (d.type === 'fibchannel') {
        // 基线 p0→p1 沿宽度向量 (p2-p0) 的斐波那契倍数平移出的平行线（两端延伸出绘图区）
        const wx = c.x - a.x;
        const wy = c.y - a.y;
        for (const r of FIB_CHANNEL_R) {
          const sx = a.x + wx * r;
          const sy = a.y + wy * r;
          const ex = b.x + wx * r;
          const ey = b.y + wy * r;
          const l = rayToX(sx, sy, ex, ey, ch.plot.l - 50);
          const rt = rayToX(sx, sy, ex, ey, ch.plot.r + 50);
          if (distToSeg(px, py, l.x, l.y, rt.x, rt.y) <= tol) return { d, part: 'body' };
        }
      } else if (d.type === 'fibtz' || d.type === 'fibttz') {
        // 垂直线组：时区单位 = |p1.x-p0.x| 从 p0 起；趋势时间单位 = p1.x-p0.x 从 p2 起
        const unit = b.x - a.x;
        const origin = d.type === 'fibtz' ? a.x : c.x;
        if (Math.abs(px - origin) <= tol) return { d, part: 'body' };
        for (const r of FIB_EXTENSIONS) {
          if (Math.abs(px - (origin + r * unit)) <= tol) return { d, part: 'body' };
        }
      } else if (d.type === 'fibfan') {
        // 从 p0 出发、穿过 (p1.x, p0.y + r*(p1.y-p0.y)) 的射线组
        for (const r of [0, ...FIB_RATIOS]) {
          const e = rayToX(a.x, a.y, b.x, a.y + r * (b.y - a.y), ch.plot.r + 50);
          if (distToSeg(px, py, a.x, a.y, e.x, e.y) <= tol) return { d, part: 'body' };
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
      } else if (d.type === 'text') {
        const w = Math.max(24, d.style.text.length * 7);
        if (inRect(px, py, a.x - 2, a.y - 10, a.x + w, a.y + 6)) return { d, part: 'body' };
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
      style: Object.assign(drawStyle(), style || {}),
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
    return this.activeId == null ? false : this.remove(this.activeId);
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

  setTool(t: string): void {
    this.pending = null;
    this.pendingPlaced = 0;
    this.tool = t;
    this.applyCursor();
    this.host.invalidate();
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
  onDown(px: number, py: number): boolean {
    const def = toolDef(this.tool);

    // ⓪ 荧光笔：按下开始采点，拖动收集轨迹，onUp 收笔成一笔
    if (this.tool === 'highlight') {
      if (this.pending) return true;
      const a = this.anchorAt(px, py);
      this.pending = {
        id: this.nextId++,
        type: 'highlight',
        pts: [a],
        style: Object.assign(drawStyle(), { color: '#f7c52f' }),
        locked: false,
        visible: true,
      };
      this.pendingPlaced = 1;
      this.host.invalidate();
      return true;
    }

    // ⓪' 橡皮擦：点中谁删谁（remove 内部先 pushHistory，可撤销）；点空也消费掉这次点击（不平移）
    if (this.tool === 'eraser') {
      const hit = this.hitTest(px, py);
      if (hit) this.remove(hit.d.id);
      this.host.invalidate();
      return true;
    }

    // ① 正在画多锚点图形：放一个点，放满 def.points 个才成型
    if (this.pending) {
      this.pending.pts[this.pendingPlaced] = this.anchorAt(px, py);
      this.pendingPlaced++;
      if (this.pendingPlaced >= this.pending.pts.length) {
        this.pushHistory();
        this.drawings.push(this.pending);
        this.activeId = this.pending.id;
        this.pending = null;
        this.pendingPlaced = 0;
        this.setTool('cursor');
      }
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
        }
        this.add(this.tool, [a, a], style);
        this.setTool('cursor');
      } else {
        this.pending = {
          id: this.nextId++,
          type: this.tool,
          pts: Array.from({ length: def.points }, () => ({ time: a.time, price: a.price })),
          style: drawStyle(this.tool === 'measure' ? '#787b86' : undefined),
          locked: false,
          visible: true,
        };
        this.pendingPlaced = 1;
        this.host.invalidate();
      }
      return true;
    }

    // ③ 光标模式：命中就拖，没命中就让 KChart 平移
    const hit = this.hitTest(px, py);
    if (!hit) {
      if (this.activeId != null) this.select(null);
      return false;
    }
    this.select(hit.d.id);
    this.drag = {
      d: hit.d,
      part: hit.part,
      orig: hit.d.pts.map((p) => ({ time: p.time, price: p.price })),
      px,
      py,
    };
    this.pushHistory();
    return true;
  }

  onMove(px: number, py: number): void {
    // 荧光笔：轨迹采点 —— 距上一锚点 ≥6px 才记一个，太密了笔迹数据爆炸
    if (this.pending && this.pending.type === 'highlight') {
      const a = this.anchorAt(px, py);
      const pts = this.pending.pts;
      const last = pts[pts.length - 1];
      const dx = this.timeToX(a.time) - this.timeToX(last.time);
      const dy = this.host.yOf(a.price) - this.host.yOf(last.price);
      if (Math.hypot(dx, dy) >= 6) pts.push(a);
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
      } else {
        d.pts[this.drag.part as number] = this.anchorAt(px, py);
      }
      this.host.invalidate();
      return;
    }
    this.applyCursor(this.hitTest(px, py));
  }

  onUp(): void {
    // 荧光笔收笔：一笔 = 一次快照（undo 一次退一整笔）；单击无轨迹时补成一个小短划
    if (this.pending && this.pending.type === 'highlight') {
      if (this.pending.pts.length < 2) {
        const a = this.pending.pts[0];
        this.pending.pts.push({ time: a.time, price: a.price });
      }
      this.pushHistory();
      this.drawings.push(this.pending);
      this.activeId = this.pending.id;
      this.pending = null;
      this.pendingPlaced = 0;
      this.setTool('cursor');
    }
    this.drag = null;
  }

  private applyCursor(hit?: { d: Drawing; part: number | string } | null): void {
    const c = this.host.canvas;
    if (!c) return;
    if (this.tool !== 'cursor') { c.style.cursor = 'crosshair'; return; }
    if (hit) { c.style.cursor = hit.part === 'body' ? 'move' : 'pointer'; return; }
    c.style.cursor = 'crosshair';
  }

  /* ---------------------------------------------------------- 键盘 */

  attachKeys(target: EventTarget): void {
    if (this.keyHandler) return;
    this.keyHandler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement) && (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { this.pending = null; this.pendingPlaced = 0; this.setTool('cursor'); this.select(null); return; }
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
    for (const d of this.drawings) {
      if (!d.visible) continue;
      this.renderOne(ctx, d, d.id === this.activeId);
    }
    if (this.pending) this.renderOne(ctx, this.pending, false);
  }

  private renderOne(ctx: CanvasRenderingContext2D, d: Drawing, selected: boolean): void {
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
    } else if (d.type === 'highlight') {
      // 荧光笔迹：宽笔画 + 半透明 + 圆头，视觉上是「划过一道」
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = col;
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      if (p.length === 1) {
        // 单击：画一个小圆斑，保证至少留下痕迹
        ctx.arc(p[0].x, p[0].y, 5, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      } else {
        for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
        ctx.stroke();
      }
      ctx.restore();
      // 选中态只描一个包围盒，不做逐锚点手柄
      if (selected) {
        let l = Infinity, t = Infinity, r2 = -Infinity, b2 = -Infinity;
        for (const q of p) { l = Math.min(l, q.x); t = Math.min(t, q.y); r2 = Math.max(r2, q.x); b2 = Math.max(b2, q.y); }
        ctx.save();
        ctx.strokeStyle = '#1f6feb';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(l - 8, t - 8, r2 - l + 16, b2 - t + 16);
        ctx.restore();
      }
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
      for (const lv of FIB_LEVELS) {
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
      for (const lv of FIB_EXT_LEVELS) {
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
    } else if (d.type === 'text') {
      ctx.setLineDash([]);
      this.label(ctx, d.style.text || '文字', a.x, a.y, col, d.style.fontSize);
    } else if (d.type === 'measure') {
      const l = Math.min(a.x, b.x);
      const t = Math.min(a.y, b.y);
      ctx.setLineDash([4, 3]);
      ctx.fillStyle = 'rgba(120,123,134,0.16)';
      ctx.beginPath();
      ctx.rect(l, t, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      const dp = d.pts[1].price - d.pts[0].price;
      const pct = d.pts[0].price ? (dp / d.pts[0].price) * 100 : 0;
      const i0 = ch.indexAtTime(d.pts[0].time);
      const i1 = ch.indexAtTime(d.pts[1].time);
      const txt = (dp >= 0 ? '+' : '') + dp.toFixed(2) + '  (' +
        (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)  ' + Math.abs(i1 - i0) + ' 根';
      this.label(ctx, txt, (a.x + b.x) / 2 + 6, Math.min(a.y, b.y) - 6, '#e6edf3');
    } else {
      // trend（默认）
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();

    // 选中态画手柄
    if (selected) {
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

  // --- 锁定后不可命中 ---
  const lockMe = L.drawings[L.drawings.length - 1];
  lockMe.locked = true;
  L.select(null);
  t('锁定后 hitTest 跳过它', L.hitTest(300, 250) === null || L.hitTest(300, 250)!.d.id !== lockMe.id);
  lockMe.locked = false;

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
    t('光标组：工具表 48 种且新三项就位',
      DRAW_TOOLS.length === 48 &&
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
  }

  log('绘图层自检：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail, names };
}
