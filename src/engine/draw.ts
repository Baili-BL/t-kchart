/**
 * tv-chart / draw.ts
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
 * ② **依赖的是 `DrawHost` 接口，不是 `TVChart` 类。**
 *    TVChart 结构化地满足这个接口，所以真图能直接用；测试里塞一个假图
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
 * TVChart 天然满足；测试里可以用一个几十行的假对象。
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
}

/* ===========================================================================
 * 2. 工具表
 * ========================================================================= */

export const DRAW_TOOLS: DrawToolDef[] = [
  { key: 'cursor', label: '光标 / 拖动', points: 0, key2: 'Escape',
    icon: 'M4 2 L4 16 L8 12 L11 17 L13 16 L10 11 L15 11 Z' },
  { key: 'trend', label: '趋势线', points: 2, key2: 't',
    icon: 'M3 15 L15 3' },
  { key: 'hline', label: '水平线', points: 1, key2: 'h',
    icon: 'M2 9 L16 9' },
  { key: 'vline', label: '垂直线', points: 1, key2: 'v',
    icon: 'M9 2 L9 16' },
  { key: 'ray', label: '射线', points: 2, key2: 'r',
    icon: 'M3 14 L15 4 M11 4 L15 4 L15 8' },
  { key: 'rect', label: '矩形', points: 2, key2: 'b',
    icon: 'M3 5 L15 5 L15 14 L3 14 Z' },
  { key: 'fib', label: '斐波那契回撤', points: 2, key2: 'f',
    icon: 'M2 4 L16 4 M2 7.5 L16 7.5 M2 11 L16 11 M2 14.5 L16 14.5' },
  { key: 'text', label: '文字', points: 1, key2: 'x',
    icon: 'M4 4 L14 4 M9 4 L9 15' },
  { key: 'measure', label: '测量', points: 2, key2: 'm',
    icon: 'M3 12 L14 5 M5 13 L6 11 M7 11 L8 9 M9 9 L10 7 M11 7 L12 5' },
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

      // 先测手柄（选中态才有），手柄优先级最高
      if (this.activeId === d.id) {
        for (let i = 0; i < p.length; i++) {
          if (Math.abs(px - p[i].x) <= tol && Math.abs(py - p[i].y) <= tol) {
            return { d, part: i };
          }
        }
      }

      const a = p[0];
      const b = p[1] || p[0];
      if (d.type === 'hline') {
        if (Math.abs(py - a.y) <= tol) return { d, part: 'body' };
      } else if (d.type === 'vline') {
        if (Math.abs(px - a.x) <= tol) return { d, part: 'body' };
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
   * 给 TVChart 用的三个钩子。
   * onDown 返回 true = 这次点击被绘图层接管，TVChart **不要平移**。
   */
  onDown(px: number, py: number): boolean {
    const def = toolDef(this.tool);

    // ① 正在画多锚点图形
    if (this.pending) {
      this.pending.pts[1] = this.anchorAt(px, py);
      this.pushHistory();
      this.drawings.push(this.pending);
      this.activeId = this.pending.id;
      this.pending = null;
      this.setTool('cursor');
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
          pts: [a, { time: a.time, price: a.price }],
          style: drawStyle(this.tool === 'measure' ? '#787b86' : undefined),
          locked: false,
          visible: true,
        };
        this.host.invalidate();
      }
      return true;
    }

    // ③ 光标模式：命中就拖，没命中就让 TVChart 平移
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
    if (this.pending) {
      this.pending.pts[1] = this.anchorAt(px, py);
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
      if (e.key === 'Escape') { this.pending = null; this.setTool('cursor'); this.select(null); return; }
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

  /** 由 TVChart 的 onDraw 钩子调用（已经在绘图区裁剪内） */
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

  // add() 会自动选中新图形（TradingView 也是这样），所以这里要先取消选中
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

  // --- 光标模式下空点不接管（要留给 TVChart 平移）---
  L.setTool('cursor');
  L.select(null);
  t('光标模式点空白返回 false（让 TVChart 平移）', L.onDown(650, 380) === false);
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

  log('绘图层自检：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail, names };
}
