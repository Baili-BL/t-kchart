/**
 * kc-chart / studies.ts
 * ---------------------------------------------------------------------------
 * 「指标」（study）的数据模型 + 画法。
 *
 * 分工：
 *   - 指标本身是 **Pine v6 脚本**，由 PineEngine 执行（见 src/indicators/）。
 *   - 本文件只关心「执行完的结果怎么画」：plot / hline / fill 三类输出，
 *     overlay=true 画在主图上，overlay=false 单独占一个副图（pane）。
 *   - 本文件**不 import pine.ts**（pine.ts 要 import chart.ts，会成环）。
 *     chart.ts 通过 registerStudyRunner() 拿到「脚本 → 输出」的函数。
 * ========================================================================= */

import type { Bar } from './chart';
import { niceStep, decimalsFor } from './chart';

/** 一条 plot 输出 */
export interface StudyPlot {
  title: string;
  color: string;
  width: number;
  /** line / linebr / stepline / histogram / columns / area / cross / circles */
  style: string;
  values: (number | null)[];
  /** 逐根颜色；null / 缺省 = 沿用 color */
  colors: (string | null)[];
  /** display=display.none：参与计算、不画线（数据窗口里仍有值） */
  hidden: boolean;
}

export interface StudyHline {
  price: number;
  title: string;
  color: string;
  linestyle: string;
}

/** fill 的一端：某条 plot，或某条 hline 的价位 */
export type StudyFillRef = { kind: 'plot'; index: number } | { kind: 'hline'; price: number };

export interface StudyFill {
  a: StudyFillRef;
  b: StudyFillRef;
  colors: (string | null)[];
}

/** 脚本 input.* 的声明（参数表单就是据此生成的） */
export interface StudyInputDef {
  title: string;
  kind: string;
  def: any;
  min?: number;
  max?: number;
  step?: number;
}

export interface StudyOutput {
  title: string;
  overlay: boolean;
  plots: StudyPlot[];
  hlines: StudyHline[];
  fills: StudyFill[];
  inputDefs: StudyInputDef[];
  /** 本次运行实际用到的参数值（标题 → 值），图例里的「(20, 2)」就是它拼的 */
  inputs: { [title: string]: any };
}

/** 图上一个指标实例的「定义」：来源脚本 + 参数。存在 store 里，每一格图都会按它各自运行 */
export interface StudyDef {
  uid: string;
  /** 来自内置清单的哪个指标（自定义脚本为空） */
  indicatorId?: string;
  name: string;
  /** 图例里用的短名（如 MACD）；缺省用 name */
  short?: string;
  /** Pine v6 源码 */
  source: string;
  inputs: { [title: string]: any };
  /** 隐藏（左栏「隐藏指标」）：照常运行、图例仍在，只是不画 */
  hidden?: boolean;
}

/** 图上一个指标实例的「运行结果」 */
export interface Study {
  def: StudyDef;
  output: StudyOutput | null;
  /** 运行失败（语法错 / 不支持的写法 / 运行时错误）时的原因；output 为 null */
  error: string | null;
}

export type StudyRunner = (def: StudyDef, bars: Bar[], meta: { symbol: string; timeframe: string }) => StudyOutput;

let runner: StudyRunner | null = null;

/** 由 src/indicators/runner.ts 注册（避免 chart.ts ↔ pine.ts 循环依赖） */
export function registerStudyRunner(fn: StudyRunner | null): void {
  runner = fn;
}

export function getStudyRunner(): StudyRunner | null {
  return runner;
}

/** 副图里的指标（overlay=false 且运行成功的） */
export function paneStudies(list: Study[]): Study[] {
  return list.filter((s) => s.output && !s.output.overlay && !s.def.hidden);
}

/* ===========================================================================
 * 数值格式
 * ========================================================================= */

/** 副图数值的紧凑格式：大数用 K / M / B，小数按量级给小数位 */
export function fmtStudyValue(v: number | null | undefined, step?: number): string {
  if (v == null || !isFinite(v)) return '--';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return (v / 1e3).toFixed(2) + 'K';
  if (step && step > 0) return v.toFixed(Math.min(6, decimalsFor(step)));
  if (a >= 100) return v.toFixed(2);
  if (a >= 1) return v.toFixed(3);
  return v.toFixed(4);
}

/* ===========================================================================
 * 量程 / 刻度
 * ========================================================================= */

const isHist = (p: StudyPlot): boolean => p.style === 'histogram' || p.style === 'columns' || p.style === 'area';

/** 副图的纵轴量程：可见区间内所有 plot + hline；柱状 / 面积把 0 也算进去 */
export function paneScale(out: StudyOutput, lo: number, hi: number): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of out.plots) {
    if (p.hidden) continue;
    for (let i = lo; i <= hi; i++) {
      const v = p.values[i];
      if (v == null || !isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (isHist(p) && isFinite(min)) {
      if (0 < min) min = 0;
      if (0 > max) max = 0;
    }
  }
  for (const h of out.hlines) {
    if (h.price < min) min = h.price;
    if (h.price > max) max = h.price;
  }
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
  if (max - min < 1e-12) { min -= 0.5; max += 0.5; }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

export function paneTicks(min: number, max: number, h: number): { ticks: number[]; step: number } {
  const target = Math.max(2, Math.round(h / 38));
  const step = niceStep((max - min) / target);
  const out: number[] = [];
  const first = Math.ceil(min / step);
  for (let k = 0; k < 40; k++) {
    const v = (first + k) * step;
    if (v > max) break;
    out.push(v);
  }
  return { ticks: out, step };
}

/* ===========================================================================
 * 画法
 * ========================================================================= */

/** 画一份输出所需要的几何：每个区域（主图 / 某个副图）各给一份 */
export interface StudyGeom {
  l: number;
  r: number;
  t: number;
  b: number;
  barW: number;
  xCenter: (i: number) => number;
  yOf: (v: number) => number;
  i0: number;
  i1: number;
}

function refValue(out: StudyOutput, ref: StudyFillRef, i: number): number | null {
  if (ref.kind === 'hline') return ref.price;
  const v = out.plots[ref.index].values[i];
  return v == null ? null : v;
}

function dashOf(style: string): number[] {
  return style === 'solid' ? [] : style === 'dotted' ? [1, 3] : [4, 4];
}

/**
 * 把一份指标输出画进 ctx（调用方负责 clip）。层序：fill → hline → plot。
 * 颜色逐根变化时按颜色分段画，线不会因为换色断开（段与段共用端点）。
 */
export function drawStudyOutput(ctx: CanvasRenderingContext2D, out: StudyOutput, g: StudyGeom): void {
  const lo = Math.max(0, g.i0);
  const hi = g.i1;

  // fill —— 两端之间的色带，逐根一个梯形（颜色逐根可变）
  for (const f of out.fills) {
    for (let i = Math.max(lo, 0); i <= hi; i++) {
      const col = f.colors[i];
      if (!col) continue;
      const a0 = refValue(out, f.a, i);
      const b0 = refValue(out, f.b, i);
      if (a0 == null || b0 == null) continue;
      const a1 = i + 1 <= hi ? refValue(out, f.a, i + 1) : null;
      const b1 = i + 1 <= hi ? refValue(out, f.b, i + 1) : null;
      const x0 = g.xCenter(i);
      const x1 = a1 != null && b1 != null && f.colors[i + 1] ? g.xCenter(i + 1) : x0 + g.barW * 0.5;
      const ya1 = a1 != null && b1 != null && f.colors[i + 1] ? g.yOf(a1) : g.yOf(a0);
      const yb1 = a1 != null && b1 != null && f.colors[i + 1] ? g.yOf(b1) : g.yOf(b0);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x0, g.yOf(a0));
      ctx.lineTo(x1, ya1);
      ctx.lineTo(x1, yb1);
      ctx.lineTo(x0, g.yOf(b0));
      ctx.closePath();
      ctx.fill();
    }
  }

  // hline
  for (const h of out.hlines) {
    const y = Math.round(g.yOf(h.price)) + 0.5;
    if (y < g.t || y > g.b) continue;
    ctx.save();
    ctx.strokeStyle = h.color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dashOf(h.linestyle));
    ctx.beginPath();
    ctx.moveTo(g.l, y);
    ctx.lineTo(g.r, y);
    ctx.stroke();
    ctx.restore();
  }

  // plot
  for (const p of out.plots) {
    if (p.hidden) continue;
    drawPlot(ctx, p, g, lo, hi);
  }
}

function drawPlot(ctx: CanvasRenderingContext2D, p: StudyPlot, g: StudyGeom, lo: number, hi: number): void {
  const colorAt = (i: number): string => p.colors[i] || p.color;
  const style = p.style;

  if (style === 'histogram' || style === 'columns') {
    const base = g.yOf(0);
    const baseY = Math.min(g.b, Math.max(g.t, base));
    const bw = Math.max(1, Math.floor(g.barW * (style === 'columns' ? 0.8 : 0.6)));
    for (let i = lo; i <= hi; i++) {
      const v = p.values[i];
      if (v == null) continue;
      const y = Math.min(g.b, Math.max(g.t, g.yOf(v)));
      const x = Math.round(g.xCenter(i) - bw / 2);
      ctx.fillStyle = colorAt(i);
      const top = Math.min(y, baseY);
      ctx.fillRect(x, top, bw, Math.max(1, Math.abs(y - baseY)));
    }
    return;
  }

  if (style === 'cross' || style === 'circles') {
    for (let i = lo; i <= hi; i++) {
      const v = p.values[i];
      if (v == null) continue;
      const x = g.xCenter(i);
      const y = g.yOf(v);
      ctx.fillStyle = colorAt(i);
      ctx.strokeStyle = colorAt(i);
      ctx.lineWidth = 1;
      if (style === 'circles') {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.5, p.width), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
        ctx.moveTo(x, y - 3);
        ctx.lineTo(x, y + 3);
        ctx.stroke();
      }
    }
    return;
  }

  // 折线（含 area / stepline / linebr）：按颜色分段
  const step = style === 'stepline';
  ctx.lineWidth = Math.max(1, p.width);
  ctx.lineJoin = 'round';
  let runStart = -1;
  let curColor = '';
  let prevI = -1;
  let prevY = 0;
  let prevX = 0;
  const flush = (): void => {
    if (runStart >= 0) ctx.stroke();
    runStart = -1;
  };
  for (let i = lo; i <= hi; i++) {
    const v = p.values[i];
    if (v == null) {
      flush();
      prevI = -1;
      continue;
    }
    const x = g.xCenter(i);
    const y = g.yOf(v);
    const col = colorAt(i);
    if (prevI < 0) {
      flush();
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, y);
      runStart = i;
      curColor = col;
    } else {
      if (col !== curColor) {
        // 换色：旧段先收尾，新段从上一个点接着画
        flush();
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        runStart = i;
        curColor = col;
      }
      if (step) ctx.lineTo(x, prevY);
      ctx.lineTo(x, y);
    }
    prevI = i;
    prevX = x;
    prevY = y;
  }
  flush();

  if (style === 'area') {
    const baseY = Math.min(g.b, Math.max(g.t, g.yOf(0)));
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = p.color;
    let started = false;
    let firstX = 0;
    let lastX = 0;
    ctx.beginPath();
    for (let i = lo; i <= hi; i++) {
      const v = p.values[i];
      if (v == null) {
        if (started) { ctx.lineTo(lastX, baseY); ctx.lineTo(firstX, baseY); ctx.closePath(); ctx.fill(); ctx.beginPath(); started = false; }
        continue;
      }
      const x = g.xCenter(i);
      if (!started) { ctx.moveTo(x, baseY); firstX = x; started = true; }
      ctx.lineTo(x, g.yOf(v));
      lastX = x;
    }
    if (started) { ctx.lineTo(lastX, baseY); ctx.lineTo(firstX, baseY); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
}

/** 图例里「(20, 2)」这一段：把脚本的 input 值按声明顺序拼起来（只拼数值 / 字符串，颜色和开关不拼） */
export function studyParamsText(out: StudyOutput): string {
  const parts: string[] = [];
  for (const d of out.inputDefs) {
    if (d.kind === 'bool' || d.kind === 'color') continue;
    const v = d.title in out.inputs ? out.inputs[d.title] : d.def;
    if (v === undefined || v === null) continue;
    parts.push(String(v));
  }
  return parts.join(', ');
}
