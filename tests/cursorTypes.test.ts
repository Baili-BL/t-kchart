/**
 * 光标类型（页面上的鼠标光标）—— 对齐线上 TradingView 的 `setCursorForTool()`：
 *
 * | 工具 | 官方 CSS cursor | 官方还画什么 |
 * |---|---|---|
 * | 十字线 | `crosshair` | 虚线十字线（吸附到 bar） |
 * | 圆点   | `dot.<hash>.cur`（32×32、热点 **11,11**） | 十字线 |
 * | 箭头   | `default` | **什么都不画** |
 * | 荧光笔 | `default` | 十字线 + 粉色光晕（r18、rgba(242,54,69,.25)） |
 * | 橡皮擦 | `eraser.<hash>.cur`（32×32、热点 **5,5**） | 十字线 + 同一个粉色光晕 |
 *
 * 量值来源：`cn.tradingview.com/chart/?symbol=BTCUSDT` 匿名页，
 * 选完工具后读 canvas 的 `getComputedStyle().cursor`；光晕是把「有光晕 / 无光晕」
 * 两张同位置截图逐像素作差、按 alpha 合成方程反解出来的（alpha 0.25、原色 #f23645），
 * 外接框 76 设备像素 @dpr2 = **半径 18 CSS**。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CURSOR_HALO_COLOR,
  CURSOR_HALO_R,
  DOT_CURSOR,
  DrawLayer,
  ERASER_CURSOR,
  cursorForTool,
  hasCursorHalo,
  makeFakeHost,
} from '../src/engine/draw';

const CLOSES: number[] = [];
for (let i = 0; i < 60; i++) CLOSES.push(100 + Math.sin(i / 6) * 8 + i * 0.2);
const HOST = makeFakeHost(CLOSES, 10);

/** data URI 里的 SVG 源文本（decodeURIComponent 之后） */
function svgOf(cursor: string): string {
  const m = /^url\("data:image\/svg\+xml;utf8,(.*)"\)\s+(-?\d+)\s+(-?\d+),\s*(\w+)$/.exec(cursor);
  if (!m) throw new Error('不是 data: URI 光标：' + cursor.slice(0, 40));
  return decodeURIComponent(m[1]);
}
function hotspotOf(cursor: string): [number, number, string] {
  const m = /^url\("data:image\/svg\+xml;utf8,(.*)"\)\s+(-?\d+)\s+(-?\d+),\s*(\w+)$/.exec(cursor);
  if (!m) throw new Error('不是 data: URI 光标');
  return [Number(m[2]), Number(m[3]), m[4]];
}

/** 只记 arc / fill 的记录型 ctx（fillStyle 在 arc 之后才设，所以颜色在 fill() 时落到最近那个 arc 上） */
function recordCtx() {
  const arcs: { x: number; y: number; r: number; fill: string }[] = [];
  let fillStyle = '';
  const ctx = {
    save() { /* no-op */ },
    restore() { /* no-op */ },
    beginPath() { /* no-op */ },
    arc(x: number, y: number, r: number) { arcs.push({ x, y, r, fill: '' }); },
    fill() { if (arcs.length) arcs[arcs.length - 1].fill = fillStyle; },
    set fillStyle(v: string) { fillStyle = v; },
    get fillStyle() { return fillStyle; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, arcs };
}

describe('光标类型：CSS cursor 与官方逐项一致', () => {
  it('圆点光标：热点 11 11（官方 dot.cur 的 ICONDIRENTRY 就是 11,11），造型 #353535 实心点 + 白边', () => {
    expect(DOT_CURSOR.startsWith('url("data:image/svg+xml')).toBe(true);
    const [hx, hy, fallback] = hotspotOf(DOT_CURSOR);
    expect([hx, hy]).toEqual([11, 11]);
    expect(fallback).toBe('crosshair');
    const svg = svgOf(DOT_CURSOR);
    expect(svg).toContain('viewBox="0 0 32 32"');
    expect(svg).toContain('#353535');
    expect(svg).toContain('fill-opacity="0.8"');   // 白边：深色底上保住轮廓
    // 白边比实心点大一圈（否则白边看不见）
    const rs = [...svg.matchAll(/r="([\d.]+)"/g)].map(m => Number(m[1]));
    expect(rs.length).toBe(2);
    expect(Math.max(...rs)).toBeGreaterThan(Math.min(...rs));
  });

  it('橡皮擦光标：热点 5 5（官方 eraser.cur），不是圆点的 11 11', () => {
    expect(hotspotOf(ERASER_CURSOR).slice(0, 2)).toEqual([5, 5]);
    expect(ERASER_CURSOR).not.toBe(DOT_CURSOR);
  });

  it('五个光标工具 → 官方那五个 CSS 值', () => {
    expect(cursorForTool('cursor')).toBeNull();          // 交给命中判定
    expect(cursorForTool('dot')).toBe(DOT_CURSOR);
    expect(cursorForTool('arrow')).toBe('default');
    expect(cursorForTool('highlight')).toBe('default');
    expect(cursorForTool('eraser')).toBe(ERASER_CURSOR);
  });

  it('其余绘图工具一律 crosshair（官方画图工具都是十字线）', () => {
    for (const t of ['trend', 'hline', 'vline', 'ray', 'fib', 'rect', 'text', 'measure', 'emoji']) {
      expect(cursorForTool(t), t).toBe('crosshair');
    }
  });

  it('只有荧光笔 / 橡皮擦带光晕（官方那四张截图里圆点、箭头都没有粉色圈）', () => {
    expect(hasCursorHalo('eraser')).toBe(true);
    expect(hasCursorHalo('highlight')).toBe(true);
    for (const t of ['cursor', 'dot', 'arrow', 'trend', 'hline']) expect(hasCursorHalo(t), t).toBe(false);
  });
});

describe('光标类型：DrawLayer.cursorAt 走的是同一张表', () => {
  const layer = new DrawLayer(HOST);

  it('默认（十字线）+ 空图：crosshair', () => {
    expect(layer.cursorAt(10, 10)).toBe('crosshair');
  });

  it('圆点 / 箭头 / 荧光笔 / 橡皮擦 各自一套，且不看命中', () => {
    const table: [string, string][] = [
      ['dot', DOT_CURSOR],
      ['arrow', 'default'],
      ['highlight', 'default'],
      ['eraser', ERASER_CURSOR],
    ];
    for (const [tool, want] of table) {
      layer.setTool(tool);
      expect(layer.cursorAt(10, 10), tool).toBe(want);
      expect(layer.cursorAt(600, 300), tool).toBe(want);   // 空处也一样
    }
  });

  it('十字线模式下命中图形仍然是 move（这条不能被光标表盖掉）', () => {
    const L = new DrawLayer(HOST);
    const d = L.add('hline', [{ time: HOST.bars[10].time, price: 105 }]);
    L.setTool('cursor');
    const p = L.pixelPts(L.find(d.id)!)[0];
    expect(L.cursorAt(HOST.xCenter(20), p.y)).toBe('move');
    expect(L.cursorAt(5, 5)).toBe('crosshair');
  });

  it('圆点工具压在图形上也不会变成 move（工具级光标优先）', () => {
    const L = new DrawLayer(HOST);
    const d = L.add('hline', [{ time: HOST.bars[10].time, price: 105 }]);
    L.setTool('dot');
    const p = L.pixelPts(L.find(d.id)!)[0];
    expect(L.cursorAt(HOST.xCenter(20), p.y)).toBe(DOT_CURSOR);
  });
});

describe('光标光晕：尺寸与颜色（线上反解出来的值）', () => {
  it('半径 18、色 rgba(242,54,69,0.25)', () => {
    expect(CURSOR_HALO_R).toBe(18);
    expect(CURSOR_HALO_COLOR).toBe('rgba(242,54,69,0.25)');
    // 原色就是 TradingView 的红 #f23645
    const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(CURSOR_HALO_COLOR)!;
    const hex = '#' + [m[1], m[2], m[3]]
      .map(v => Number(v).toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('#f23645');
    expect(Number(m[4])).toBeCloseTo(0.25, 5);
  });
});

describe('光标光晕：画不画、画在哪', () => {
  const inside = { x: 300, y: 200 };

  it('橡皮擦：指针在绘图区内 → 一个 r18 的实心圆，圆心就是指针', () => {
    const L = new DrawLayer(HOST);
    L.setTool('eraser');
    const { ctx, arcs } = recordCtx();
    L.renderCursorHalo(ctx, inside);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toEqual({ x: 300, y: 200, r: CURSOR_HALO_R, fill: CURSOR_HALO_COLOR });
  });

  it('荧光笔：同一个光晕（官方这两张截图逐字节相同）', () => {
    const L = new DrawLayer(HOST);
    L.setTool('highlight');
    const { ctx, arcs } = recordCtx();
    L.renderCursorHalo(ctx, inside);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].fill).toBe(CURSOR_HALO_COLOR);
  });

  it('其它工具不画（十字线 / 圆点 / 箭头 / 普通画图工具）', () => {
    for (const tool of ['cursor', 'dot', 'arrow', 'trend']) {
      const L = new DrawLayer(HOST);
      L.setTool(tool);
      const { ctx, arcs } = recordCtx();
      L.renderCursorHalo(ctx, inside);
      expect(arcs, tool).toHaveLength(0);
    }
  });

  it('指针为空（已离开画布）不画', () => {
    const L = new DrawLayer(HOST);
    L.setTool('eraser');
    const { ctx, arcs } = recordCtx();
    L.renderCursorHalo(ctx, null);
    expect(arcs).toHaveLength(0);
  });

  it('指针贴到价格轴 / 时间轴 / 图例上不画（不在绘图区内）', () => {
    const L = new DrawLayer(HOST);
    L.setTool('eraser');
    const p = HOST.plot;                       // l0 t0 r700 b400
    for (const pt of [
      { x: p.r + 5, y: 200 }, { x: 300, y: p.b + 5 },
      { x: p.l - 5, y: 200 }, { x: 300, y: p.t - 5 },
    ]) {
      const { ctx, arcs } = recordCtx();
      L.renderCursorHalo(ctx, pt);
      expect(arcs, JSON.stringify(pt)).toHaveLength(0);
    }
  });

  it('光晕不塞在 render() 里（那一层在十字线之下，官方是压在上面）', () => {
    const L = new DrawLayer(HOST);
    L.setTool('eraser');
    const { ctx, arcs } = recordCtx();
    L.render(ctx);
    expect(arcs).toHaveLength(0);
  });
});

describe('接线：光晕由图表在十字线之后回调', () => {
  const chart = readFileSync(resolve(__dirname, '../src/engine/chart.ts'), 'utf8');
  const view = readFileSync(resolve(__dirname, '../src/workspace/ChartGridView.tsx'), 'utf8');

  it('draw() 里 onDraw → drawCrosshairV → drawCrosshairH → onOverlay 的先后不能乱', () => {
    const iOnDraw = chart.indexOf('this.hooks.onDraw(ctx)');
    const iV = chart.indexOf('this.drawCrosshairV();', iOnDraw);
    const iH = chart.indexOf('this.drawCrosshairH();', iV);
    const iOverlay = chart.indexOf('this.hooks.onOverlay(ctx', iH);
    expect(iOnDraw).toBeGreaterThan(0);
    expect(iV).toBeGreaterThan(iOnDraw);
    expect(iH).toBeGreaterThan(iV);
    expect(iOverlay).toBeGreaterThan(iH);
  });

  it('onOverlay 拿到的是图表自己的 pointer（不是外部图层记的过期坐标）', () => {
    expect(chart).toContain('this.hooks.onOverlay(ctx, this.pointer)');
    expect(chart).toMatch(/onOverlay\?\(ctx: CanvasRenderingContext2D, pointer: \{ x: number; y: number \} \| null\)/);
  });

  it('ChartGridView 把 onOverlay 接到 renderCursorHalo', () => {
    expect(view).toContain('onOverlay: (ctx: CanvasRenderingContext2D, pt: { x: number; y: number } | null) =>');
    expect(view).toContain('layer.renderCursorHalo(ctx, pt)');
  });
});
