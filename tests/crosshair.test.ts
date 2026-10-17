/**
 * 页面上的「光标」= 十字光标（crosshair）—— 不是左侧工具栏里那组 cursor 图标。
 *
 * 这一套数值全部来自线上 TradingView 的**像素测量**，不是凭印象挑色：
 * 用 Playwright 打开 https://cn.tradingview.com/chart/?symbol=BTCUSDT（1600×900，dpr=2），
 * 把鼠标移到绘图区，截图后逐像素扫十字线所在的那一列 / 那一行：
 *
 *   竖线列 x=1397..1398（2 设备像素 = 1 CSS px），颜色恒为 rgb(156,156,156)，
 *   亮段 10 / 暗段 12 设备像素 → CSS 5 亮 6 暗，周期 11；
 *   横线行 y=799..800，节奏与颜色与竖线**完全一致**（官方两条线是一套）；
 *   价格轴标签块 y=779..820（42 设备 = 21 CSS），底色 rgb(15,15,15)，字白；
 *   时间轴标签块 y=1666..1713（≈ 46 设备 = 23 CSS），底色同上，内容带星期几。
 *
 * 老实现的三处偏差（也就是用户截图里那根「近黑虚线 + 浅灰实线」）：
 *   ① 只画竖线，横线根本没画（截图中那条浅灰横线其实是网格线）；
 *   ② 浅色主题的线色是 #131722（近黑，对比度 17:1，官方只有 2.7:1）；
 *   ③ 虚线节奏 4/4，官方 5/6。
 */
import { describe, expect, it } from 'vitest';
import {
  CROSS_DASH,
  CROSS_PRICE_LABEL_H,
  CROSS_TIME_LABEL_H,
  CROSS_TIME_PAD_X,
  DEFAULTS,
  KChart,
  THEMES,
  crossPriceLabelRect,
  crossTimeLabelRect,
  fillRoundRect,
} from '../src/engine/chart';

/* ---------------------------------------------------------------- 颜色工具 */

function rgbOf(hex: string): [number, number, number] {
  const h = hex.trim();
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m3 = /^#([0-9a-f]{3})$/i.exec(h);
  if (m3) return [...m3[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  throw new Error('无法解析颜色：' + hex);
}

/** WCAG 相对亮度 */
function luminance(hex: string): number {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ------------------------------------------------------------- 记录型 canvas */

interface Rec {
  ops: string[];
  fillStyle: string;
  strokeStyle: string;
  dashes: number[][];
  lines: { x: number; y: number }[][];
  strokes: { dash: number[]; color: string }[];
  saved: number;
}

function fakeCtx(roundRect = true): { ctx: CanvasRenderingContext2D; rec: Rec } {
  const rec: Rec = { ops: [], fillStyle: '', strokeStyle: '', dashes: [], lines: [], strokes: [], saved: 0 };
  const cur: { x: number; y: number }[] = [];
  let dash: number[] = [];
  const ctx = {
    beginPath(): void { rec.ops.push('beginPath'); },
    rect(): void { rec.ops.push('rect'); },
    roundRect(): void { rec.ops.push('roundRect'); },
    fill(): void { rec.ops.push('fill'); },
    save(): void { rec.saved++; },
    restore(): void { rec.saved--; },
    set fillStyle(v: string) { rec.fillStyle = v; },
    get fillStyle(): string { return rec.fillStyle; },
    set strokeStyle(v: string) { rec.strokeStyle = v; },
    get strokeStyle(): string { return rec.strokeStyle; },
    moveTo(x: number, y: number): void { cur.push({ x, y }); },
    lineTo(x: number, y: number): void { cur.push({ x, y }); },
    stroke(): void {
      rec.lines.push(cur.splice(0));
      rec.strokes.push({ dash: dash.slice(), color: rec.strokeStyle });
    },
    setLineDash(d: number[]): void { dash = d.slice(); rec.dashes.push(d); },
  } as unknown as CanvasRenderingContext2D;
  if (!roundRect) delete (ctx as unknown as { roundRect?: unknown }).roundRect;
  return { ctx, rec };
}

describe('十字光标：官方像素测量值', () => {
  it('虚线节奏是 5 亮 / 6 暗（设备像素 10/12 @dpr2）', () => {
    expect(CROSS_DASH).toEqual([5, 6]);
  });

  it('价格轴标签块高 21、时间轴标签块高 23', () => {
    expect(CROSS_PRICE_LABEL_H).toBe(21);
    expect(CROSS_TIME_LABEL_H).toBe(23);
  });

  it('时间轴标签左右各留 10px（官方标签宽 ≈ 文字宽 + 20）', () => {
    expect(CROSS_TIME_PAD_X).toBe(10);
  });
});

describe('十字光标：两套主题的三色', () => {
  it('浅色：线是中性灰 #9c9c9c，标签块是近黑 #0f0f0f，字纯白', () => {
    expect(THEMES.light.cross).toBe('#9c9c9c');
    expect(THEMES.light.crossLabel).toBe('#0f0f0f');
    expect(THEMES.light.crossInk).toBe('#ffffff');
  });

  it('深色：线 #797979，标签块 #3d3d3d（取自同一套调色板的深色主题）', () => {
    expect(THEMES.dark.cross).toBe('#797979');
    expect(THEMES.dark.crossLabel).toBe('#3d3d3d');
    expect(THEMES.dark.crossInk).toBe('#ffffff');
  });

  it('线是**中性灰**：R=G=B，不能带蓝调（老值 #131722 就是带蓝的近黑）', () => {
    for (const k of ['light', 'dark'] as const) {
      const [r, g, b] = rgbOf(THEMES[k].cross);
      expect(r, k + ' 的线色 R/B').toBe(b);
      expect(r, k + ' 的线色 R/G').toBe(g);
    }
  });

  it('浅色下线的对比度落在 2.2~3.2：看得见但不抢戏（老值 #131722 是 17:1，太黑）', () => {
    const c = contrast(THEMES.light.cross, THEMES.light.bg);
    expect(c).toBeGreaterThan(2.2);
    expect(c).toBeLessThan(3.2);
  });

  it('深色下线的对比度 ≥ 3（在 #0e1116 上要能看清）', () => {
    expect(contrast(THEMES.dark.cross, THEMES.dark.bg)).toBeGreaterThanOrEqual(3);
  });

  it('标签底色 ≠ 线色：两个用途不能用同一个值（老实现混用，浅色下标签成了灰底）', () => {
    expect(THEMES.light.crossLabel).not.toBe(THEMES.light.cross);
    expect(THEMES.dark.crossLabel).not.toBe(THEMES.dark.cross);
  });

  it('标签文字对比度 ≥ 4.5（AA 正文）', () => {
    expect(contrast(THEMES.light.crossInk, THEMES.light.crossLabel)).toBeGreaterThan(4.5);
    expect(contrast(THEMES.dark.crossInk, THEMES.dark.crossLabel)).toBeGreaterThan(4.5);
  });

  it('默认值（未套主题时）也用同一套三色', () => {
    expect(DEFAULTS.crossColor).toBe(THEMES.dark.cross);
    expect(DEFAULTS.crossLabelColor).toBe(THEMES.dark.crossLabel);
    expect(DEFAULTS.crossInkColor).toBe(THEMES.dark.crossInk);
  });
});

describe('十字光标：标签矩形', () => {
  it('价格标签贴着轴内侧（plotR + 2）、垂直居中在鼠标行上', () => {
    const r = crossPriceLabelRect(500, 40, 66, 300);
    expect(r.x).toBe(502);
    expect(r.h).toBe(21);
    expect(r.y).toBe(290); // round(300 - 21/2) —— 21 是奇数，只能差半像素
    expect(Math.abs(r.y + r.h / 2 - 300)).toBeLessThanOrEqual(0.5);
    expect(r.w).toBe(62); // axisWidth - 4
  });

  it('价格文字超宽时标签撑开（不裁字）', () => {
    expect(crossPriceLabelRect(500, 120, 66, 300).w).toBe(132);
  });

  it('时间标签宽度 = 文字宽 + 2×10，并以 bar 中心居中', () => {
    const r = crossTimeLabelRect(400, 80, 10, 800, 700);
    expect(r.w).toBe(100);
    expect(r.x).toBe(350);
    expect(r.y).toBe(Math.round(700 - 11.5));
    expect(r.h).toBe(23);
  });

  it('贴到最左边那根 bar 时标签被顶回绘图区，不出血', () => {
    const r = crossTimeLabelRect(20, 100, 10, 800, 700);
    expect(r.x).toBe(10);
    expect(r.x + r.w).toBeLessThanOrEqual(800);
  });

  it('贴到最右边那根 bar 时同样被顶回', () => {
    const r = crossTimeLabelRect(795, 100, 10, 800, 700);
    expect(r.x + r.w).toBe(800);
    expect(r.x).toBeGreaterThanOrEqual(10);
  });
});

describe('十字光标：标签底色绘制', () => {  it('fillRoundRect 用圆角矩形 + 指定填充色（官方标签有小圆角）', () => {
    const { ctx, rec } = fakeCtx(true);
    fillRoundRect(ctx, 10, 20, 62, 21, 2, '#0f0f0f');
    expect(rec.ops).toEqual(['beginPath', 'roundRect', 'fill']);
    expect(rec.fillStyle).toBe('#0f0f0f');
  });

  it('没有 ctx.roundRect 时退化成直角，仍然填充（旧 Safari 兼容）', () => {
    const { ctx, rec } = fakeCtx(false);
    fillRoundRect(ctx, 10, 20, 62, 21, 2, '#3d3d3d');
    expect(rec.ops).toEqual(['beginPath', 'rect', 'fill']);
    expect(rec.fillStyle).toBe('#3d3d3d');
  });

  it('不改动调用方的 save/restore 栈（自己不开栈）', () => {
    const { ctx, rec } = fakeCtx(true);
    fillRoundRect(ctx, 0, 0, 10, 10, 2, '#000');
    expect(rec.saved).toBe(0);
  });
});

/* ---------------------------------------------------------------- 真画一遍 */

/**
 * 只拿 KChart.prototype 上的两个私有方法，手工造一个「假 this」——
 * 这两个方法只碰 ctx / plot / pointer / o，不需要 DOM，也就没必要为它们上 jsdom。
 */
type AnyThis = Record<string, unknown>;

function stubChart(over: AnyThis = {}): AnyThis {
  const { ctx } = fakeCtx();
  const base: AnyThis = {
    ctx,
    plot: { l: 10, t: 20, r: 810, b: 620, w: 800, h: 600 },
    pointer: { x: 400, y: 300 },
    o: { ...DEFAULTS, crossColor: THEMES.light.cross },
    snapIndex: () => 7,
    xCenter: () => 400.4,
  };
  return Object.assign(base, over);
}

const proto = KChart.prototype as unknown as Record<string, (this: AnyThis) => void>;

describe('十字光标：纵向 + 横向都画，且是同一套', () => {
  it('竖线：1px 虚线，节奏 5/6，颜色取主题线色，铺满绘图区上下沿', () => {
    const { ctx, rec } = fakeCtx();
    const c = stubChart({ ctx });
    proto.drawCrosshairV.call(c);
    expect(rec.strokes).toHaveLength(1);
    expect(rec.strokes[0].dash).toEqual(CROSS_DASH);
    expect(rec.strokes[0].color).toBe(THEMES.light.cross);
    expect(rec.lines[0]).toEqual([
      { x: 400.5, y: 20 },
      { x: 400.5, y: 620 },
    ]);
  });

  it('横线：官方有这条线，老实现漏画 —— 同节奏同颜色，从左沿铺到右沿', () => {
    const { ctx, rec } = fakeCtx();
    const c = stubChart({ ctx });
    proto.drawCrosshairH.call(c);
    expect(rec.strokes).toHaveLength(1);
    expect(rec.strokes[0].dash).toEqual(CROSS_DASH);
    expect(rec.strokes[0].color).toBe(THEMES.light.cross);
    expect(rec.lines[0]).toEqual([
      { x: 10, y: 300.5 },
      { x: 810, y: 300.5 },
    ]);
  });

  it('横线只在鼠标落在绘图区内时画（鼠标在上方轴 / 下方轴都不画）', () => {
    for (const y of [19, 621, -50]) {
      const { ctx, rec } = fakeCtx();
      const c = stubChart({ ctx, pointer: { x: 400, y } });
      proto.drawCrosshairH.call(c);
      expect(rec.strokes, 'pointer.y=' + y).toHaveLength(0);
    }
  });

  it('鼠标移出画布（pointer=null）时也不画横线', () => {
    const { ctx, rec } = fakeCtx();
    const c = stubChart({ ctx, pointer: null });
    proto.drawCrosshairH.call(c);
    expect(rec.strokes).toHaveLength(0);
  });

  it('深色主题下同一条横线换成深色线色（不是写死的灰）', () => {
    const { ctx, rec } = fakeCtx();
    const c = stubChart({ ctx, o: { ...DEFAULTS, crossColor: THEMES.dark.cross } });
    proto.drawCrosshairH.call(c);
    expect(rec.strokes[0].color).toBe('#797979');
  });
});
