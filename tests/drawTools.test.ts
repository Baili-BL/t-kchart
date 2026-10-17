/**
 * TODO 2.8 绘图工具扩充：每种新工具四条判据都要有断言 ——
 *   ① 画法（render 走到对应分支、产生描边/填充/文本且不抛错）
 *   ② 命中（图形上能 hitTest 到、图形外命中不到）
 *   ③ 手柄（选中后端点是手柄；拖手柄只动被拖的那个锚点）
 *   ④ 撤销（undo 退回 / redo 复原）
 * 全部在 Node 里跑：makeFakeHost 假宿主 + 计数 stub ctx，不需要浏览器。
 */
import { describe, expect, it } from 'vitest';
import {
  DRAW_TOOLS, DrawLayer, makeFakeHost, rayToX, inTriangle, inParallelogram,
  MARKER_SIZE, quadBezierPts, ellipseArcPts, hyperbolaPts, arrowGlyphPts,
  cubicBezierPts, pitchforkRays, arrowSideGlyphPts,
} from '../src/engine/draw';
import type { DrawHost, Drawing } from '../src/engine/draw';

const CLOSES: number[] = [];
for (let i = 0; i < 60; i++) CLOSES.push(100 + Math.sin(i / 6) * 8 + i * 0.2);
const HOST: DrawHost = makeFakeHost(CLOSES, 10);

/** 计数 stub：renderOne 只依赖这十几个方法 */
function makeCtx() {
  const ops = { stroke: 0, fill: 0, text: 0, ellipse: 0, path: 0, arc: 0 };
  const ctx: any = {
    save() { /* no-op */ },
    restore() { /* no-op */ },
    beginPath() { ops.path++; },
    moveTo() { /* no-op */ },
    lineTo() { /* no-op */ },
    closePath() { /* no-op */ },
    rect() { /* no-op */ },
    strokeRect() { /* no-op */ },
    ellipse() { ops.ellipse++; },
    arc() { ops.arc++; },
    stroke() { ops.stroke++; },
    fill() { ops.fill++; },
    fillRect() { /* no-op */ },
    fillText() { ops.text++; },
    measureText: (s: string) => ({ width: s.length * 7 }),
    setLineDash() { /* no-op */ },
    quadraticCurveTo() { /* no-op */ },
    globalAlpha: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  return { ctx, ops };
}

/** 画一个图形（走 add 的完整链路） */
function draw(type: string, pts: { time: number; price: number }[]): { L: DrawLayer; d: Drawing } {
  const L = new DrawLayer(HOST);
  const d = L.add(type, pts);
  return { L, d };
}

const anchor = (i: number, price: number) => ({ time: HOST.bars[i].time, price });

describe('2.8 新工具：水平射线 hray', () => {
  const { L, d } = draw('hray', [anchor(10, 105)]);
  const p = L.pixelPts(d)[0];

  it('画法：render 产生描边与价格标签', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
    expect(ops.text).toBeGreaterThanOrEqual(1);
  });
  it('命中：起点右侧的半条线上能命中，起点左侧命中不到', () => {
    const hit = L.hitTest(HOST.plot.r - 20, p.y);
    expect(hit && hit.d.id === d.id).toBe(true);
    expect(L.hitTest(Math.max(HOST.plot.l + 2, p.x - 40), p.y)).toBeNull();
  });
  it('手柄：唯一端点是手柄，拖它改价格不改时间', () => {
    L.select(d.id);
    expect(L.hitTest(p.x, p.y)!.part).toBe(0);
    L.onDown(p.x, p.y);
    L.onMove(p.x, p.y + 60);
    L.onUp();
    expect(d.pts[0].price).not.toBe(105);
    expect(d.pts[0].time).toBe(HOST.bars[10].time);
  });
  it('撤销：undo 移除 / redo 复原（前面拖过手柄，历史有两个快照）', () => {
    const n = L.drawings.length;
    L.undo(); // 退回拖拽
    L.undo(); // 移除图形
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('2.8 新工具：延长线 extline', () => {
  const { L, d } = draw('extline', [anchor(8, 96), anchor(45, 116)]);
  const p = L.pixelPts(d);

  it('画法：render 产生描边', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
  });
  it('命中：中点、以及两端延伸出锚点范围的位置都能命中', () => {
    const mid = L.hitTest((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
    expect(mid && mid.d.id === d.id).toBe(true);
    // 右端延伸：把 b 沿 ab 方向延到绘图区右缘，y 线性外推
    const e = rayToX(p[0].x, p[0].y, p[1].x, p[1].y, HOST.plot.r - 10);
    const hitR = L.hitTest(HOST.plot.r - 10, e.y);
    expect(hitR && hitR.d.id === d.id).toBe(true);
  });
  it('命中：离线远点不命中', () => {
    expect(L.hitTest((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2 + 40)).toBeNull();
  });
  it('手柄 + 撤销：拖 0 号手柄只动 p0；undo/redo 往返', () => {
    L.select(d.id);
    expect(L.hitTest(p[0].x, p[0].y)!.part).toBe(0);
    const orig1 = { ...d.pts[1] };
    L.onDown(p[0].x, p[0].y);
    L.onMove(p[0].x + 50, p[0].y + 20);
    L.onUp();
    expect(d.pts[1].time).toBe(orig1.time); // p1 不动
    expect(d.pts[1].price).toBeCloseTo(orig1.price, 9);
    const moved = { ...d.pts[0] };
    expect(moved.time).not.toBe(HOST.bars[8].time);
    L.undo(); // 退回拖拽（undo 会 JSON 重建对象，必须用 find() 取最新引用）
    expect(L.find(d.id)!.pts[0].time).toBe(HOST.bars[8].time);
    L.redo();
    expect(L.find(d.id)!.pts[0].time).toBe(moved.time);
  });
});

describe('2.8 新工具：箭头 arrow', () => {
  const { L, d } = draw('arrow', [anchor(5, 98), anchor(35, 114)]);
  const p = L.pixelPts(d);

  it('画法：render 产生描边 + 实心箭头填充', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
    expect(ops.fill).toBeGreaterThanOrEqual(1);
  });
  it('命中：线段上能命中、线段外 40px 不命中', () => {
    const mid = L.hitTest((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
    expect(mid && mid.d.id === d.id).toBe(true);
    expect(L.hitTest((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2 + 40)).toBeNull();
  });
  it('手柄：拖 1 号端点，箭头跟随（p1 被改写）', () => {
    L.select(d.id);
    expect(L.hitTest(p[1].x, p[1].y)!.part).toBe(1);
    L.onDown(p[1].x, p[1].y);
    L.onMove(p[1].x, p[1].y - 50);
    L.onUp();
    expect(d.pts[1].price).toBeGreaterThan(114);
  });
  it('撤销（拖过手柄，历史两个快照）', () => {
    const n = L.drawings.length;
    L.undo();
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('2.8 新工具：椭圆 ellipse', () => {
  const { L, d } = draw('ellipse', [anchor(10, 98), anchor(35, 114)]);
  const p = L.pixelPts(d);
  const cx = (p[0].x + p[1].x) / 2;
  const cy = (p[0].y + p[1].y) / 2;

  it('画法：render 走 ellipse 分支 + 填充 + 描边', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.ellipse).toBe(1);
    expect(ops.fill).toBeGreaterThanOrEqual(1);
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
  });
  it('命中：内部命中（不只边缘）、外部 40px 不命中', () => {
    const inHit = L.hitTest(cx, cy);
    expect(inHit && inHit.d.id === d.id).toBe(true);
    expect(L.hitTest(cx, cy - (Math.abs(p[1].y - p[0].y) / 2 + 40))).toBeNull();
  });
  it('手柄：两个端点都是手柄，拖 0 号只动 p0', () => {
    L.select(d.id);
    expect(L.hitTest(p[0].x, p[0].y)!.part).toBe(0);
    const orig1 = { ...d.pts[1] };
    L.onDown(p[0].x, p[0].y);
    L.onMove(p[0].x - 30, p[0].y);
    L.onUp();
    expect(d.pts[0].time).not.toBe(orig1.time);
    expect(d.pts[1].time).toBe(orig1.time);
  });
  it('撤销（拖过手柄，历史两个快照）', () => {
    const n = L.drawings.length;
    L.undo();
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('2.8 新工具：三角形 triangle（三点交互）', () => {
  it('交互：两次点击仍是待定，第三次才成型为 3 锚点', () => {
    const L = new DrawLayer(HOST);
    L.setTool('triangle');
    L.onDown(HOST.xCenter(8), HOST.yOf(98));
    expect(L.drawings.length).toBe(0); // 待定
    L.onDown(HOST.xCenter(30), HOST.yOf(116));
    expect(L.drawings.length).toBe(0); // 还差一点
    L.onMove(HOST.xCenter(18), HOST.yOf(92)); // 预览第三点
    L.onDown(HOST.xCenter(18), HOST.yOf(92));
    expect(L.drawings.length).toBe(1);
    expect(L.drawings[0].pts.length).toBe(3);
    expect(L.tool).toBe('cursor'); // 成型后自动切回光标
  });

  const { L, d } = draw('triangle', [anchor(8, 96), anchor(40, 96), anchor(20, 116)]);
  const p = L.pixelPts(d);

  it('画法：render 产生填充 + 描边', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.fill).toBeGreaterThanOrEqual(1);
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
  });
  it('命中：重心内命中、三条边中点命中、外部不命中', () => {
    const gx = (p[0].x + p[1].x + p[2].x) / 3;
    const gy = (p[0].y + p[1].y + p[2].y) / 3;
    expect(L.hitTest(gx, gy)!.d.id === d.id).toBe(true);
    for (let i = 0; i < 3; i++) {
      const q = p[(i + 1) % 3];
      expect(L.hitTest((p[i].x + q.x) / 2, (p[i].y + q.y) / 2)!.d.id === d.id).toBe(true);
    }
    expect(L.hitTest(p[1].x, p[1].y + 60)).toBeNull();
  });
  it('手柄：3 个锚点都是手柄（part 0/1/2）', () => {
    L.select(d.id);
    for (let i = 0; i < 3; i++) expect(L.hitTest(p[i].x, p[i].y)!.part).toBe(i);
  });
  it('撤销', () => {
    const n = L.drawings.length;
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('2.8 新工具：平行通道 channel（三点交互）', () => {
  const { L, d } = draw('channel', [anchor(8, 100), anchor(40, 100), anchor(8, 110)]);
  const p = L.pixelPts(d);

  it('画法：render 产生填充 + 描边', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.fill).toBeGreaterThanOrEqual(1);
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
  });
  it('命中：通道带内部、两条边线都能命中；带外不命中', () => {
    // 带内中点：ab 中点沿 (c-a) 平移一半
    const midX = (p[0].x + p[1].x) / 2 + (p[2].x - p[0].x) / 2;
    const midY = (p[0].y + p[1].y) / 2 + (p[2].y - p[0].y) / 2;
    expect(L.hitTest(midX, midY)!.d.id === d.id).toBe(true);
    // 上边线中点 / 下边线中点
    expect(L.hitTest((p[0].x + p[1].x) / 2, p[0].y)!.d.id === d.id).toBe(true);
    expect(L.hitTest((p[0].x + p[1].x) / 2, p[2].y)!.d.id === d.id).toBe(true);
    // 带外：整条通道上方 30px（a、b 同价、c 在上方，带向 y 减小方向延伸）
    const topY = Math.min(p[0].y, p[2].y);
    expect(L.hitTest((p[0].x + p[1].x) / 2, topY - 30)).toBeNull();
  });
  it('手柄：拖 2 号锚点改通道宽度，前两个锚点不动', () => {
    L.select(d.id);
    expect(L.hitTest(p[2].x, p[2].y)!.part).toBe(2);
    const o0 = { ...d.pts[0] };
    const o1 = { ...d.pts[1] };
    L.onDown(p[2].x, p[2].y);
    L.onMove(p[2].x, p[2].y + 40);
    L.onUp();
    expect(d.pts[0].price).toBe(o0.price);
    expect(d.pts[1].price).toBe(o1.price);
    expect(d.pts[2].price).toBeCloseTo(HOST.pOf(p[2].y + 40), 6);
  });
  it('撤销（拖过手柄，历史两个快照）', () => {
    const n = L.drawings.length;
    L.undo();
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('2.8 几何纯函数与回归', () => {
  it('inTriangle：内 / 外 / 边缘', () => {
    expect(inTriangle(5, 5, 0, 0, 10, 0, 5, 10)).toBe(true);
    expect(inTriangle(20, 20, 0, 0, 10, 0, 5, 10)).toBe(false);
    expect(inTriangle(5, 0, 0, 0, 10, 0, 5, 10)).toBe(true); // 边上算内
  });
  it('inParallelogram：内 / 外 / 两个方向各有界', () => {
    expect(inParallelogram(5, 3, 0, 0, 10, 0, 0, 6)).toBe(true);
    expect(inParallelogram(5, 8, 0, 0, 10, 0, 0, 6)).toBe(false);
    expect(inParallelogram(12, 3, 0, 0, 10, 0, 0, 6)).toBe(false);
  });
  it('旧的两点工具回归：两点工具第二次点击才成型（pendingPlaced 改造不改行为）', () => {
    const L = new DrawLayer(HOST);
    L.setTool('trend');
    L.onDown(100, 100);
    expect(L.drawings.length).toBe(0);
    L.onDown(300, 250);
    expect(L.drawings.length).toBe(1);
    expect(L.drawings[0].pts.length).toBe(2);
  });
  it('工具表：9 → 89 种，新工具的锚点数与快捷键就位', () => {
    expect(DRAW_TOOLS.length).toBe(89);
    const want: Record<string, number> = {
      hray: 1, extline: 2, arrow: 2, ellipse: 2, triangle: 3, channel: 3,
      dot: 1, highlight: 0, eraser: 0, infoline: 2, angle: 2, crossline: 1,
      xabcd: 5, shark: 5, hs: 5, abcd: 4, tri: 5, threedrives: 6,
      ewimpulse: 6, ewcorrection: 4, ewtriangle: 5, ewdouble: 4, ewtriple: 5,
      cycle: 2, timecycle: 2, sine: 2,
      longpos: 2, shortpos: 2, forecast: 3, kpattern: 1, simcandle: 2, fan: 2,
      avwap: 1, vprofile: 2, avprofile: 1, prange: 2, drange: 2, dprange: 2,
      brush: 0, arrowmark: 1, uparrow: 1, downarrow: 1,
      rotrect: 3, path: 4, circle: 2, polyline: 4, arc: 2, curve: 3, hyperbola: 2,
      emoji: 1,
      // 对齐 charting_library 的 17 种
      pitchfork: 3, schiff: 3, schiff2: 3, innerfork: 3, pitchfan: 3,
      note: 1, callout: 1, comment: 1, balloon: 1, pricenote: 1, pricelabel: 1, signpost: 1,
      circlelines: 2, beziercubic: 4, flatbottom: 2, arrowmarl: 1, arrowmarr: 1,
    };
    for (const [key, points] of Object.entries(want)) {
      expect(DRAW_TOOLS.find((t) => t.key === key)?.points === points).toBe(true);
    }
    // 普通快捷键 + ⌥ 组合快捷键（设计稿「趋势线」子菜单）
    const key2: Record<string, string> = { trend: 't', hline: 'h', hray: 'y', vline: 'v' };
    for (const [key, k] of Object.entries(key2)) {
      expect(DRAW_TOOLS.find((t) => t.key === key)?.key2).toBe(k);
    }
    const alt: Record<string, string> = { trend: '⌥T', hline: '⌥H', hray: '⌥J', vline: '⌥V', crossline: '⌥C', rect: '⌥R' };
    for (const [key, k3] of Object.entries(alt)) {
      expect(DRAW_TOOLS.find((t) => t.key === key)?.key3).toBe(k3);
    }
  });
});

/* ===========================================================================
 * 设计稿「十字线」子菜单新增的三种工具：圆点 / 荧光笔 / 橡皮擦
 * ========================================================================= */

describe('光标组新工具：圆点 dot', () => {
  const { L, d } = draw('dot', [anchor(20, 105)]);
  const p = L.pixelPts(d)[0];

  it('画法：render 产生实心填充（arc 圆）', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.arc).toBeGreaterThanOrEqual(1);
    expect(ops.fill).toBeGreaterThanOrEqual(1);
  });
  it('命中：圆心命中、40px 外不命中', () => {
    const hit = L.hitTest(p.x, p.y);
    expect(hit && hit.d.id === d.id).toBe(true);
    expect(L.hitTest(p.x + 40, p.y)).toBeNull();
  });
  it('手柄：唯一锚点即手柄，拖动改价格不改时间', () => {
    L.select(d.id);
    expect(L.hitTest(p.x, p.y)!.part).toBe(0);
    L.onDown(p.x, p.y);
    L.onMove(p.x, p.y + 50);
    L.onUp();
    expect(d.pts[0].time).toBe(HOST.bars[20].time);
    expect(d.pts[0].price).not.toBe(105);
  });
  it('撤销（拖过手柄，历史两个快照）', () => {
    const n = L.drawings.length;
    L.undo();
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('光标组新工具：荧光笔 highlight（自由笔迹）', () => {
  it('交互：按下→拖动采点→松手收笔，一笔一次 undo；收笔自动回光标', () => {
    const L = new DrawLayer(HOST);
    L.setTool('highlight');
    L.onDown(HOST.xCenter(10), HOST.yOf(105));
    expect(L.drawings.length).toBe(0); // 拖动中待定
    L.onMove(HOST.xCenter(16), HOST.yOf(105));
    L.onMove(HOST.xCenter(22), HOST.yOf(105));
    L.onMove(HOST.xCenter(28), HOST.yOf(105));
    L.onUp();
    expect(L.drawings.length).toBe(1);
    const d0 = L.drawings[0];
    expect(d0.type).toBe('highlight');
    expect(d0.pts.length).toBeGreaterThanOrEqual(3); // 采了 ≥3 个轨迹点
    expect(L.tool).toBe('cursor');
    const n = L.drawings.length;
    L.undo();
    expect(L.drawings.length).toBe(n - 1); // 一笔 = 一次快照
    L.redo();
    expect(L.drawings.length).toBe(n);
  });

  const { L, d } = draw('highlight', [
    anchor(10, 105), anchor(14, 105), anchor(18, 105), anchor(22, 105),
  ]);
  const p = L.pixelPts(d);

  it('画法：render 产生描边、不抛错', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
  });
  it('命中：笔迹段上命中、离轨迹 40px 不命中；荧光笔无逐锚点手柄', () => {
    const hit = L.hitTest((p[1].x + p[2].x) / 2, p[1].y);
    expect(hit && hit.d.id === d.id).toBe(true);
    expect(hit!.part).toBe('body');
    expect(L.hitTest(p[1].x, p[1].y + 40)).toBeNull();
    L.select(d.id);
    // 手柄优先级逻辑对 highlight 关闭：锚点处命中的也是 body（整体拖）
    expect(L.hitTest(p[1].x, p[1].y)!.part).toBe('body');
  });
  it('拖动：整体平移，轨迹点数不变', () => {
    const before = d.pts.map((q) => ({ ...q }));
    L.onDown(p[1].x, p[1].y);
    L.onMove(p[1].x + 30, p[1].y + 25);
    L.onUp();
    expect(d.pts.length).toBe(before.length);
    expect(d.pts[0].price).toBeCloseTo(before[0].price + (HOST.pOf(p[1].y + 25) - HOST.pOf(p[1].y)), 6);
    expect(d.pts[3].time).toBeCloseTo(before[3].time + (HOST.bars[17].time - HOST.bars[14].time), -1);
  });
  it('撤销（拖过 body，历史两个快照）', () => {
    const n = L.drawings.length;
    L.undo();
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('光标组新工具：橡皮擦 eraser', () => {
  it('点中删除 / 点空不删但消费点击 / undo 复原', () => {
    const L = new DrawLayer(HOST);
    const h = L.add('hline', [anchor(10, 105)]);
    L.add('dot', [anchor(30, 112)]);
    L.setTool('eraser');

    // 点空：什么都不删，但这次点击不落空（不平移）
    const empty = L.onDown(HOST.xCenter(40), HOST.yOf(130));
    expect(empty).toBe(true);
    expect(L.drawings.length).toBe(2);

    // 点中 hline：删除
    const y = L.pixelPts(h)[0].y;
    L.onDown(HOST.xCenter(20), y);
    expect(L.drawings.length).toBe(1);
    expect(L.find(h.id)).toBeNull();

    // undo 复原
    L.undo();
    expect(L.drawings.length).toBe(2);
    expect(L.find(h.id)).not.toBeNull();
  });
});

/* ===========================================================================
 * 设计稿「趋势线」子菜单（线工具组）新增：信息线 / 趋势角度 / 横线
 * ========================================================================= */

describe('线组新工具：信息线 infoline', () => {
  const { L, d } = draw('infoline', [anchor(8, 98), anchor(35, 114)]);
  const p = L.pixelPts(d);

  it('画法：render 产生描边 + 两处价格标签，不抛错', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
    expect(ops.text).toBeGreaterThanOrEqual(2);
  });
  it('命中：线段中点命中、离线 40px 不命中', () => {
    const mid = L.hitTest((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
    expect(mid && mid.d.id === d.id).toBe(true);
    expect(L.hitTest((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2 + 40)).toBeNull();
  });
  it('手柄：拖 1 号端点，另一端不动', () => {
    L.select(d.id);
    expect(L.hitTest(p[1].x, p[1].y)!.part).toBe(1);
    const o0 = { ...d.pts[0] };
    L.onDown(p[1].x, p[1].y);
    L.onMove(p[1].x, p[1].y - 40);
    L.onUp();
    expect(d.pts[0].time).toBe(o0.time);
    expect(d.pts[1].price).toBeGreaterThan(114);
  });
  it('撤销（拖过手柄，历史两个快照）', () => {
    const n = L.drawings.length;
    L.undo();
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('线组新工具：趋势角度 angle', () => {
  const { L, d } = draw('angle', [anchor(10, 100), anchor(30, 112)]);
  const p = L.pixelPts(d);

  it('画法：render 产生描边 + 角度标签', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
    expect(ops.text).toBeGreaterThanOrEqual(1);
  });
  it('命中：线段上命中、线段外不命中', () => {
    const mid = L.hitTest((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2);
    expect(mid && mid.d.id === d.id).toBe(true);
    expect(L.hitTest((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2 - 40)).toBeNull();
  });
  it('手柄：3 点不变，拖 0 号端点只动 p0', () => {
    L.select(d.id);
    expect(L.hitTest(p[0].x, p[0].y)!.part).toBe(0);
    const o1 = { ...d.pts[1] };
    L.onDown(p[0].x, p[0].y);
    L.onMove(p[0].x + 30, p[0].y);
    L.onUp();
    expect(d.pts[1].time).toBe(o1.time);
    expect(d.pts[1].price).toBeCloseTo(o1.price, 9);
  });
  it('撤销（拖过手柄，历史两个快照）', () => {
    const n = L.drawings.length;
    L.undo();
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

describe('线组新工具：横线 crossline（十字）', () => {
  const { L, d } = draw('crossline', [anchor(20, 105)]);
  const p = L.pixelPts(d)[0];

  it('画法：render 产生描边 + 价格标签', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
    expect(ops.text).toBeGreaterThanOrEqual(1);
  });
  it('命中：水平线与垂直线上都能命中，两线之外不命中', () => {
    expect(L.hitTest(HOST.plot.r - 30, p.y)!.d.id === d.id).toBe(true);
    expect(L.hitTest(p.x, HOST.plot.b - 20)!.d.id === d.id).toBe(true);
    expect(L.hitTest(p.x + 60, p.y + 60)).toBeNull();
  });
  it('手柄：唯一锚点即手柄，拖动改价格与时间', () => {
    L.select(d.id);
    expect(L.hitTest(p.x, p.y)!.part).toBe(0);
    L.onDown(p.x, p.y);
    L.onMove(p.x + 50, p.y + 40);
    L.onUp();
    expect(d.pts[0].time).not.toBe(HOST.bars[20].time);
    expect(d.pts[0].price).not.toBe(105);
  });
  it('撤销（拖过手柄，历史两个快照）', () => {
    const n = L.drawings.length;
    L.undo();
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
});

/* ===========================================================================
 * 设计稿「斐波那契回撤」子菜单（斐波那契 + 江恩组）：13 种新工具 × 四判据
 * 数据驱动：每种工具给「图形上应命中的点」与「图形外不应命中的点」两个探针。
 * ========================================================================= */

import { FIB_RATIOS, FIB_EXTENSIONS, spiralPts, distToPolyline } from '../src/engine/draw';

interface ToolSpec {
  key: string;
  pts: { time: number; price: number }[];
  /** 返回一个在图形上的像素点 */
  inside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  /** 返回一个确定不在图形上的像素点 */
  outside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  minStrokes: number;
}

const px = (i: number) => HOST.xCenter(i);

const SPECS: ToolSpec[] = [
  {
    key: 'fibext',
    pts: [anchor(8, 96), anchor(45, 116), anchor(30, 106)],
    // 0.5 档：price = 106 + 0.5*20 = 116，横跨全区
    inside: (L, d) => ({ x: HOST.plot.r - 30, y: L.host.yOf(d.pts[2].price + 0.5 * (d.pts[1].price - d.pts[0].price)) }),
    // 0.3 不是档位（与 0.236/0.382 相距约 1.3 price 单位 ≈ 19px）
    outside: (L, d) => ({ x: 350, y: L.host.yOf(d.pts[2].price + 0.3 * (d.pts[1].price - d.pts[0].price)) }),
    minStrokes: 10,
  },
  {
    key: 'fibchannel',
    pts: [anchor(8, 100), anchor(40, 100), anchor(8, 110)],
    // r=1 的平行线：price 110 的水平线
    inside: (L, d) => ({ x: px(20), y: L.host.yOf(110) }),
    outside: (L, d) => ({ x: px(20), y: L.host.yOf(105) }),
    minStrokes: 8,
  },
  {
    key: 'fibtz',
    pts: [anchor(10, 100), anchor(20, 100)],
    inside: (_L, d) => ({ x: px(10), y: 200 }),  // 锚点垂直线
    outside: (_L, d) => ({ x: (px(10) + px(10) + (px(20) - px(10)) * (FIB_EXTENSIONS[0])) / 2, y: 200 }),
    minStrokes: 6,
  },
  {
    key: 'fibfan',
    pts: [anchor(8, 100), anchor(40, 110)],
    // 0.5 射线在 x=px(40) 处经过 y = y(100)+0.5*(y(110)-y(100))
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[1].x, y: p[0].y + 0.5 * (p[1].y - p[0].y) };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[1].x, y: p[0].y + 0.7 * (p[1].y - p[0].y) };
    },
    minStrokes: 7,
  },
  {
    key: 'fibttz',
    pts: [anchor(8, 100), anchor(18, 100), anchor(30, 105)],
    inside: (_L, d) => ({ x: px(30), y: 200 }),  // 锚在 p2 的第一根垂直线
    outside: (_L, d) => ({ x: px(30) + 0.5 * (px(18) - px(8)), y: 200 }),
    minStrokes: 6,
  },
  {
    key: 'fibcirc',
    pts: [anchor(10, 105), anchor(30, 105)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      const R = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      return { x: p[0].x + 0.5 * R, y: p[0].y };  // 0.5 圆与中线的交点
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      const R = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      return { x: p[0].x + 1.4 * R, y: p[0].y };  // 最大圆 (1*R) 之外
    },
    minStrokes: 7,
  },
  {
    key: 'fibspiral',
    pts: [anchor(10, 105), anchor(30, 105)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      const R = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      const poly = spiralPts(p[0].x, p[0].y, Math.max(R * 0.05, 2), 1.618);
      return poly[Math.floor(poly.length * 0.6)];
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      const R = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      return { x: p[0].x - R * 0.6, y: p[0].y - R * 0.6 };
    },
    minStrokes: 1,
  },
  {
    key: 'fibarc',
    pts: [anchor(10, 105), anchor(30, 105)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      const R = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      return { x: p[0].x + 0.618 * R, y: p[0].y };  // 半圆朝 b 方向，0.618 弧与中线交点
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      const R = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      return { x: p[0].x - 0.618 * R, y: p[0].y };  // 反方向没有弧
    },
    minStrokes: 6,
  },
  {
    key: 'fibwedge',
    pts: [anchor(8, 100), anchor(40, 100)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      const R = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      // 45° 方向、0.382*R 半径处正好在第一条弧上
      return { x: p[0].x + 0.382 * R * Math.SQRT1_2, y: p[0].y + 0.382 * R * Math.SQRT1_2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      const R = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
      // 45° 方向、0.85*R：不在 0.382/0.618/1 任何弧上，也不在两条边界射线上
      return { x: p[0].x + 0.85 * R * Math.SQRT1_2, y: p[0].y + 0.85 * R * Math.SQRT1_2 };
    },
    minStrokes: 5,
  },
  {
    key: 'tiltfan',
    pts: [anchor(10, 105), anchor(30, 105)],
    inside: (L, d) => ({ x: px(20), y: L.pixelPts(d)[0].y }),  // 0° 射线
    outside: (L, d) => {
      const p = L.pixelPts(d);
      // ±30° 射线在 x=px(20) 处偏移 100*tan30°≈57.7px，取中间 25px 处
      return { x: px(20), y: p[0].y + 25 };
    },
    minStrokes: 5,
  },
  {
    key: 'gannbox',
    pts: [anchor(10, 100), anchor(35, 112)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: Math.max(p[0].y, p[1].y) + 30 };
    },
    minStrokes: 20,
  },
  {
    key: 'gannsqf',
    pts: [anchor(10, 105), anchor(30, 105)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      const side = Math.max(Math.abs(p[1].x - p[0].x), Math.abs(p[1].y - p[0].y));
      return { x: p[0].x + side * 0.5, y: p[0].y + side * 0.5 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + 50, y: p[0].y - 40 };
    },
    minStrokes: 20,
  },
  {
    key: 'gannsq',
    pts: [anchor(10, 105), anchor(30, 105)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      const side = Math.max(Math.abs(p[1].x - p[0].x), Math.abs(p[1].y - p[0].y));
      return { x: p[0].x + side * 0.5, y: p[0].y + side * 0.5 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + 50, y: p[0].y - 40 };
    },
    minStrokes: 14,
  },
];

describe('设计稿「斐波那契/江恩」组：13 种工具 × 四判据（数据驱动）', () => {
  for (const spec of SPECS) {
    describe(spec.key, () => {
      const { L, d } = draw(spec.key, spec.pts);

      it(`① 画法：render 不抛错且 stroke ≥ ${spec.minStrokes}`, () => {
        const { ctx, ops } = makeCtx();
        expect(() => L.render(ctx)).not.toThrow();
        expect(ops.stroke).toBeGreaterThanOrEqual(spec.minStrokes);
      });
      it('② 命中：图形上的点能命中', () => {
        const pt = spec.inside(L, d);
        const hit = L.hitTest(pt.x, pt.y);
        expect(hit && hit.d.id === d.id).toBe(true);
      });
      it('③ 命中外：图形外的点不命中', () => {
        const pt = spec.outside(L, d);
        expect(L.hitTest(pt.x, pt.y)).toBeNull();
      });
      it('④ 手柄+撤销：拖 0 号手柄只动 p0，undo×2 退回 / redo 复原', () => {
        const p0px = L.pixelPts(d)[0];
        L.select(d.id);
        expect(L.hitTest(p0px.x, p0px.y)!.part).toBe(0);
        const orig1 = { ...d.pts[1] };
        L.onDown(p0px.x, p0px.y);
        L.onMove(p0px.x + 40, p0px.y + 20);
        L.onUp();
        expect(d.pts[1].time).toBe(orig1.time);
        expect(d.pts[1].price).toBeCloseTo(orig1.price, 9);
        const movedTime = L.find(d.id)!.pts[0].time;
        expect(movedTime).not.toBe(spec.pts[0].time);
        L.undo(); // 退回拖拽
        expect(L.find(d.id)!.pts[0].time).toBe(spec.pts[0].time);
        L.undo(); // 移除图形
        expect(L.drawings.length).toBe(0);
        L.redo();
        expect(L.drawings.length).toBe(1);
      });
    });
  }

  it('⌥F 组合键映射就位（斐波那契回撤）', () => {
    expect(DRAW_TOOLS.find((t) => t.key === 'fib')?.key3).toBe('⌥F');
  });
  it('螺旋采样几何：最外圈半径 ≈ |ab|（r0=0.05R, φ^(1.5圈×4)）', () => {
    const R = 200;
    const poly = spiralPts(0, 0, R * 0.05, 1.618);
    const last = poly[poly.length - 1];
    expect(Math.hypot(last.x, last.y)).toBeCloseTo(R * 0.05 * Math.pow(1.618, 6), 0);
  });
  it('distToPolyline：多段折线取最短', () => {
    expect(distToPolyline(5, 5, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(5);
  });
  it('FIB_RATIOS / FIB_EXTENSIONS / 档位表常量就位', () => {
    expect(FIB_RATIOS).toContain(0.618);
    expect(FIB_EXTENSIONS[0]).toBe(1);
    expect(FIB_EXTENSIONS[FIB_EXTENSIONS.length - 1]).toBeCloseTo(6.854, 2);
  });
});

/* ===========================================================================
 * 设计稿「图表形态」子菜单（图表形态 + 艾略特波浪 + 循环组）：14 种新工具 × 四判据
 * 数据驱动：形态/波浪类 inside = 折线段中点；循环组 inside = 垂直线/采样点。
 * ========================================================================= */

import { PATTERN_LABELS, sinePts, CYCLE_PAIR_OFF, TIMECYCLE_COUNT } from '../src/engine/draw';

interface PatSpec {
  key: string;
  pts: { time: number; price: number }[];
  inside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  outside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  minStrokes: number;
}

/** 形态/波浪类通用探针：折线 p1→p2 段的中点命中；中点下方 50px 不命中 */
function zigSpec(key: string, prices: number[], minStrokes: number): PatSpec {
  return {
    key,
    pts: prices.map((price, i) => anchor(6 + i * 7, price)),
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 + 50 };
    },
    minStrokes,
  };
}

const PAT_SPECS: PatSpec[] = [
  zigSpec('xabcd', [100, 108, 102, 110, 104], 6),
  zigSpec('shark', [100, 108, 102, 110, 104], 6),
  zigSpec('hs', [110, 102, 106, 98, 106], 6),
  zigSpec('abcd', [100, 108, 102, 110], 5),
  zigSpec('tri', [100, 108, 102, 106, 104], 6),
  zigSpec('threedrives', [110, 102, 106, 98, 103, 96], 7),
  zigSpec('ewimpulse', [100, 108, 102, 110, 104, 112], 7),
  zigSpec('ewcorrection', [100, 108, 102, 110], 5),
  zigSpec('ewtriangle', [100, 108, 102, 106, 104], 6),
  zigSpec('ewdouble', [100, 108, 102, 110], 5),
  zigSpec('ewtriple', [100, 108, 102, 110, 104], 6),
  {
    key: 'cycle',
    pts: [anchor(10, 100), anchor(20, 100)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + 2 * (p[1].x - p[0].x) + CYCLE_PAIR_OFF * (p[1].x - p[0].x), y: 200 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + 0.5 * (p[1].x - p[0].x), y: 200 };
    },
    minStrokes: 10,
  },
  {
    key: 'timecycle',
    pts: [anchor(10, 100), anchor(20, 100)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + 3 * (p[1].x - p[0].x), y: 200 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + 3.5 * (p[1].x - p[0].x), y: 200 };
    },
    minStrokes: 8,
  },
  {
    key: 'sine',
    pts: [anchor(8, 105), anchor(40, 105)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      const poly = sinePts(p[0].x, p[0].y, p[1].x, p[1].y);
      return poly[Math.floor(poly.length * 0.125)]; // 第一个波峰
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      // 弦中点处波形回到弦上，振幅 0.18×320px≈58px —— 上方 70px 必在波外
      return { x: (p[0].x + p[1].x) / 2, y: p[0].y - 70 };
    },
    minStrokes: 1,
  },
];

describe('设计稿「图表形态」组：14 种工具 × 四判据（数据驱动）', () => {
  for (const spec of PAT_SPECS) {
    describe(spec.key, () => {
      const { L, d } = draw(spec.key, spec.pts);

      it(`① 画法：render 不抛错且 stroke ≥ ${spec.minStrokes}`, () => {
        const { ctx, ops } = makeCtx();
        expect(() => L.render(ctx)).not.toThrow();
        expect(ops.stroke).toBeGreaterThanOrEqual(spec.minStrokes);
      });
      it('② 命中：图形上的点能命中', () => {
        const pt = spec.inside(L, d);
        const hit = L.hitTest(pt.x, pt.y);
        expect(hit && hit.d.id === d.id).toBe(true);
      });
      it('③ 命中外：图形外的点不命中', () => {
        const pt = spec.outside(L, d);
        expect(L.hitTest(pt.x, pt.y)).toBeNull();
      });
      it('④ 手柄+撤销：拖 0 号手柄只动 p0，undo×2 退回 / redo 复原', () => {
        const p0px = L.pixelPts(d)[0];
        L.select(d.id);
        expect(L.hitTest(p0px.x, p0px.y)!.part).toBe(0);
        const orig1 = { ...d.pts[1] };
        L.onDown(p0px.x, p0px.y);
        L.onMove(p0px.x + 40, p0px.y + 20);
        L.onUp();
        expect(d.pts[1].time).toBe(orig1.time);
        expect(d.pts[1].price).toBeCloseTo(orig1.price, 9);
        const movedTime = L.find(d.id)!.pts[0].time;
        expect(movedTime).not.toBe(spec.pts[0].time);
        L.undo(); // 退回拖拽
        expect(L.find(d.id)!.pts[0].time).toBe(spec.pts[0].time);
        L.undo(); // 移除图形
        expect(L.drawings.length).toBe(0);
        L.redo();
        expect(L.drawings.length).toBe(1);
      });
    });
  }

  it('PATTERN_LABELS：每种形态/波浪的标签数与锚点数一致', () => {
    expect(Object.keys(PATTERN_LABELS).length).toBe(11);
    for (const [key, labels] of Object.entries(PATTERN_LABELS)) {
      expect(labels.length).toBe(DRAW_TOOLS.find((t) => t.key === key)?.points);
    }
  });
  it('循环组常量：CYCLE_PAIR_OFF / TIMECYCLE_COUNT 就位', () => {
    expect(CYCLE_PAIR_OFF).toBeGreaterThan(0);
    expect(CYCLE_PAIR_OFF).toBeLessThan(0.5);
    expect(TIMECYCLE_COUNT).toBeGreaterThanOrEqual(4);
  });
  it('sinePts：起点终点在弦上、峰谷振幅 = 0.18 × 弦长、2 个整周期', () => {
    const poly = sinePts(0, 0, 200, 0);
    expect(poly[0].y).toBe(0);
    expect(poly[poly.length - 1].y).toBeCloseTo(0, 9);
    expect(Math.max(...poly.map((q) => q.y))).toBeCloseTo(200 * 0.18, 6);
    expect(Math.min(...poly.map((q) => q.y))).toBeCloseTo(-200 * 0.18, 6);
  });
  it('多锚点交互：xabcd 五次点击才成型，中间是待定态', () => {
    const L = new DrawLayer(HOST);
    L.setTool('xabcd');
    L.onDown(HOST.xCenter(5), HOST.yOf(100));
    L.onDown(HOST.xCenter(12), HOST.yOf(108));
    L.onDown(HOST.xCenter(19), HOST.yOf(102));
    L.onDown(HOST.xCenter(26), HOST.yOf(110));
    expect(L.drawings.length).toBe(0); // 还差一点，待定
    L.onDown(HOST.xCenter(33), HOST.yOf(104));
    expect(L.drawings.length).toBe(1);
    expect(L.drawings[0].pts.length).toBe(5);
    expect(L.tool).toBe('cursor');
  });
});

/* ===========================================================================
 * 设计稿「预测/基于成交量/测量」子菜单（多头仓位按钮）：12 种新工具 × 四判据
 * 数据驱动：多锚点工具走通用四判据；单点工具（kpattern/avwap/avprofile）单独 describe。
 * ========================================================================= */

import {
  POS_RR, KPATTERN_H, VP_WIDTH, vwapSeries, volumeProfile,
  kpatternCandles, simCandlePx, CANDLE_PATTERN, FAN_DEG, SIM_CANDLES, VP_BINS,
} from '../src/engine/draw';

interface PosSpec {
  key: string;
  pts: { time: number; price: number }[];
  inside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  outside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  minStrokes: number;
}

const POS_SPECS: PosSpec[] = [
  {
    key: 'longpos',
    pts: [anchor(10, 104), anchor(30, 100)],
    // 目标价 = 104 + 4×2 = 112，目标箱中部
    inside: (L, d) => ({ x: (px(10) + px(30)) / 2, y: L.host.yOf(104 + (104 - 100) * POS_RR * 0.5) }),
    outside: (L, d) => ({ x: (px(10) + px(30)) / 2, y: L.host.yOf(95) }),
    minStrokes: 4,
  },
  {
    key: 'shortpos',
    pts: [anchor(10, 100), anchor(30, 104)],
    inside: (L, d) => ({ x: (px(10) + px(30)) / 2, y: L.host.yOf(100 - 4 * POS_RR * 0.5) }),
    outside: (L, d) => ({ x: (px(10) + px(30)) / 2, y: L.host.yOf(109) }),
    minStrokes: 4,
  },
  {
    key: 'forecast',
    pts: [anchor(8, 100), anchor(20, 108), anchor(34, 104)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 + 50 };
    },
    minStrokes: 3,
  },
  {
    key: 'simcandle',
    pts: [anchor(10, 100), anchor(24, 108)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 + 90 };
    },
    minStrokes: SIM_CANDLES,
  },
  {
    key: 'fan',
    pts: [anchor(10, 100), anchor(30, 110)],
    // 0° 基线方向射线上的点
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + (p[1].x - p[0].x) * 0.5, y: p[0].y + (p[1].y - p[0].y) * 0.5 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      // 中点 + 垂直偏移 40px：±45°/0° 三条射线都够不到
      return { x: p[0].x + (p[1].x - p[0].x) * 0.5, y: p[0].y + (p[1].y - p[0].y) * 0.5 + 40 };
    },
    minStrokes: FAN_DEG.length + 1,
  },
  {
    key: 'vprofile',
    pts: [anchor(10, 98), anchor(34, 112)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: Math.max(p[0].y, p[1].y) + 30 };
    },
    minStrokes: 2,
  },
  {
    key: 'prange',
    pts: [anchor(12, 100), anchor(12, 112)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x, y: (p[0].y + p[1].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + 40, y: (p[0].y + p[1].y) / 2 };
    },
    minStrokes: 3,
  },
  {
    key: 'drange',
    pts: [anchor(10, 105), anchor(30, 105)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: p[0].y };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: p[0].y + 40 };
    },
    minStrokes: 3,
  },
  {
    key: 'dprange',
    pts: [anchor(10, 100), anchor(30, 112)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: Math.max(p[0].y, p[1].y) + 30 };
    },
    minStrokes: 3,
  },
];

describe('设计稿「预测/成交量/测量」组：多锚点工具 × 四判据（数据驱动）', () => {
  for (const spec of POS_SPECS) {
    describe(spec.key, () => {
      const { L, d } = draw(spec.key, spec.pts);

      it(`① 画法：render 不抛错且 stroke ≥ ${spec.minStrokes}`, () => {
        const { ctx, ops } = makeCtx();
        expect(() => L.render(ctx)).not.toThrow();
        expect(ops.stroke).toBeGreaterThanOrEqual(spec.minStrokes);
      });
      it('② 命中：图形上的点能命中', () => {
        const pt = spec.inside(L, d);
        const hit = L.hitTest(pt.x, pt.y);
        expect(hit && hit.d.id === d.id).toBe(true);
      });
      it('③ 命中外：图形外的点不命中', () => {
        const pt = spec.outside(L, d);
        expect(L.hitTest(pt.x, pt.y)).toBeNull();
      });
      it('④ 手柄+撤销：拖 0 号手柄只动 p0，undo×2 退回 / redo 复原', () => {
        const p0px = L.pixelPts(d)[0];
        L.select(d.id);
        expect(L.hitTest(p0px.x, p0px.y)!.part).toBe(0);
        const orig1 = { ...d.pts[1] };
        L.onDown(p0px.x, p0px.y);
        L.onMove(p0px.x + 40, p0px.y + 20);
        L.onUp();
        expect(d.pts[1].time).toBe(orig1.time);
        expect(d.pts[1].price).toBeCloseTo(orig1.price, 9);
        const movedTime = L.find(d.id)!.pts[0].time;
        expect(movedTime).not.toBe(spec.pts[0].time);
        L.undo(); // 退回拖拽
        expect(L.find(d.id)!.pts[0].time).toBe(spec.pts[0].time);
        L.undo(); // 移除图形
        expect(L.drawings.length).toBe(0);
        L.redo();
        expect(L.drawings.length).toBe(1);
      });
    });
  }
});

/* —— 单点工具：kpattern / avwap / avprofile —— */

describe('预测组单点工具：K线形态 kpattern', () => {
  const { L, d } = draw('kpattern', [anchor(15, 105)]);
  const p = L.pixelPts(d)[0];
  const cs = kpatternCandles(p.x, p.y);

  it('画法：render 不抛错，3 根迷你K线 = 3 影线 + 3 实体', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(4); // 基线 + 3 影线
    expect(cs.length).toBe(CANDLE_PATTERN.length);
  });
  it('命中：迷你K线区内命中，下方不命中', () => {
    const last = cs[cs.length - 1];
    expect(L.hitTest(p.x + 10, p.y - KPATTERN_H / 2) && L.hitTest(p.x + 10, p.y - KPATTERN_H / 2)!.d.id === d.id).toBe(true);
    expect(L.hitTest(last.x + last.w + 30, p.y)).toBeNull();
  });
  it('手柄 + 撤销：唯一锚点即手柄；undo 退回 / redo 复原', () => {
    L.select(d.id);
    expect(L.hitTest(p.x, p.y)!.part).toBe(0);
    L.onDown(p.x, p.y);
    L.onMove(p.x + 30, p.y - 40);
    L.onUp();
    expect(d.pts[0].price).not.toBe(105);
    L.undo();
    expect(L.find(d.id)!.pts[0].price).toBe(105);
    L.redo();
    expect(L.find(d.id)!.pts[0].price).not.toBe(105);
  });
});

describe('成交量组单点工具：锚定VWAP avwap / 锚定成交量分布图 avprofile', () => {
  it('vwapSeries：首值 = 首 bar 典型价；全长与从半程起算不同', () => {
    const s0 = vwapSeries(HOST.bars, 0);
    const tp0 = (HOST.bars[0].high + HOST.bars[0].low + HOST.bars[0].close) / 3;
    expect(s0[0]).toBeCloseTo(tp0, 9);
    const sHalf = vwapSeries(HOST.bars, 30);
    expect(sHalf.length).toBe(30);
  });
  it('volumeProfile：总量守恒、POC 为最大箱、边界外量滑入边箱', () => {
    const total = HOST.bars.reduce((s, b) => s + b.volume, 0);
    const vp = volumeProfile(HOST.bars, 0, HOST.bars.length - 1, VP_BINS, HOST.scale.min, HOST.scale.max);
    expect(vp.vol.reduce((s, v) => s + v, 0)).toBeCloseTo(total, 9);
    expect(vp.vol[vp.poc]).toBe(Math.max(...vp.vol));
    const clipped = volumeProfile(HOST.bars, 0, 10, 8, 50, 60); // 价格远超范围也应收敛
    expect(clipped.vol.reduce((s, v) => s + v, 0)).toBeCloseTo(HOST.bars.slice(0, 11).reduce((s, b) => s + b.volume, 0), 9);
  });
  it('avwap：锚点处曲线命中，上方远处不命中；undo/redo 往返', () => {
    const L = new DrawLayer(HOST);
    const d = L.add('avwap', [anchor(10, 105)]);
    const i0 = HOST.indexAtTime(d.pts[0].time);
    const series = vwapSeries(HOST.bars, i0);
    const hit = L.hitTest(HOST.xCenter(i0), HOST.yOf(series[0]));
    expect(hit && hit.d.id === d.id).toBe(true);
    expect(L.hitTest(HOST.xCenter(i0), HOST.yOf(series[0]) - 80)).toBeNull();
    const n = L.drawings.length;
    L.undo();
    expect(L.drawings.length).toBe(n - 1);
    L.redo();
    expect(L.drawings.length).toBe(n);
  });
  it('avprofile：直方图区内命中，锚点左侧不命中', () => {
    const L = new DrawLayer(HOST);
    const d = L.add('avprofile', [anchor(10, 105)]);
    const p0 = L.pixelPts(d)[0];
    const hi = Math.max(...HOST.bars.slice(10).map((b) => b.high));
    const lo = Math.min(...HOST.bars.slice(10).map((b) => b.low));
    const hit = L.hitTest(p0.x + VP_WIDTH / 2, HOST.yOf((hi + lo) / 2));
    expect(hit && hit.d.id === d.id).toBe(true);
    expect(L.hitTest(Math.max(4, p0.x - 60), HOST.yOf((hi + lo) / 2))).toBeNull();
  });
  it('simCandlePx：n 根、首根开在 ay、单调推进（屏幕 y 向下则收盘可上可下）', () => {
    const cs = simCandlePx(100, 200, 300, 160);
    expect(cs.length).toBe(SIM_CANDLES);
    expect(cs[0].o).toBe(200);
    expect(cs[cs.length - 1].x).toBeLessThan(300);
    for (const k of cs) {
      expect(k.h).toBeLessThanOrEqual(Math.min(k.o, k.c)); // 影线顶不超过实体上缘
      expect(k.l).toBeGreaterThanOrEqual(Math.max(k.o, k.c));
    }
  });
});

/* ===========================================================================
 * 设计稿「笔刷」子菜单（笔刷/箭头/形状三组）：11 种新工具
 *   - brush：freehand，与荧光笔同机制，单独 describe
 *   - arrowmark / uparrow / downarrow：单击标记，单独 describe
 *   - rotrect / path / circle / polyline / arc / curve / hyperbola：数据驱动四判据
 * ========================================================================= */

describe('笔刷组：笔刷 brush（自由笔迹，默认色细线）', () => {
  it('交互：按下→拖动采点→松手收笔，一笔一次 undo；与荧光笔互不影响', () => {
    const L = new DrawLayer(HOST);
    L.setTool('brush');
    L.onDown(HOST.xCenter(10), HOST.yOf(105));
    L.onMove(HOST.xCenter(16), HOST.yOf(106));
    L.onMove(HOST.xCenter(22), HOST.yOf(104));
    L.onMove(HOST.xCenter(28), HOST.yOf(105));
    L.onUp();
    expect(L.drawings.length).toBe(1);
    const d0 = L.drawings[0];
    expect(d0.type).toBe('brush');
    expect(d0.pts.length).toBeGreaterThanOrEqual(3);
    expect(d0.style.color).not.toBe('#f7c52f'); // 笔刷走默认蓝，不是荧光笔的黄色
    expect(L.tool).toBe('cursor');
    L.undo();
    expect(L.drawings.length).toBe(0);
    L.redo();
    expect(L.drawings.length).toBe(1);
  });

  const { L, d } = draw('brush', [
    anchor(10, 105), anchor(14, 106), anchor(18, 104), anchor(22, 105),
  ]);
  const p = L.pixelPts(d);

  it('画法：render 产生描边、不抛错', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
  });
  it('命中：笔迹段上命中（无逐锚点手柄），离轨迹 40px 不命中', () => {
    const hit = L.hitTest((p[1].x + p[2].x) / 2, (p[1].y + p[2].y) / 2);
    expect(hit && hit.d.id === d.id).toBe(true);
    expect(hit!.part).toBe('body');
    expect(L.hitTest(p[1].x, p[1].y + 40)).toBeNull();
    L.select(d.id);
    expect(L.hitTest(p[1].x, p[1].y)!.part).toBe('body');
  });
  it('拖动：整体平移，轨迹点数不变；undo/redo 往返', () => {
    const before = d.pts.map((q) => ({ ...q }));
    L.onDown(p[1].x, p[1].y);
    L.onMove(p[1].x + 30, p[1].y + 25);
    L.onUp();
    expect(d.pts.length).toBe(before.length);
    L.undo(); // 退回拖拽
    L.undo(); // 移除
    expect(L.drawings.length).toBe(0);
    L.redo();
    expect(L.drawings.length).toBe(1);
  });
});

describe('箭头组：单击标记 arrowmark / uparrow / downarrow', () => {
  const L = new DrawLayer(HOST);
  const dmk = L.add('arrowmark', [anchor(20, 105)]);
  const pmk = L.pixelPts(dmk)[0];
  const dup = L.add('uparrow', [anchor(30, 105)]);
  const pup = L.pixelPts(dup)[0];
  const ddn = L.add('downarrow', [anchor(40, 105)]);
  const pdn = L.pixelPts(ddn)[0];

  it('画法：render 不抛错；标记产生填充、空心箭头产生填充+描边', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.fill).toBeGreaterThanOrEqual(3);
    expect(ops.stroke).toBeGreaterThanOrEqual(2);
  });
  it('命中：字形中心能命中，字形外（对角 40px）不命中', () => {
    expect(L.hitTest(pmk.x, pmk.y)!.d.id).toBe(dmk.id);
    expect(L.hitTest(pup.x, pup.y)!.d.id).toBe(dup.id);
    expect(L.hitTest(pdn.x, pdn.y)!.d.id).toBe(ddn.id);
    expect(L.hitTest(pmk.x + 40, pmk.y + 40)).toBeNull();
  });
  it('手柄：唯一锚点即手柄，拖动改位置', () => {
    L.select(dmk.id);
    expect(L.hitTest(pmk.x, pmk.y)!.part).toBe(0);
    L.onDown(pmk.x, pmk.y);
    L.onMove(pmk.x + 20, pmk.y - 30);
    L.onUp();
    expect(dmk.pts[0].price).not.toBe(105);
  });
  it('撤销：undo 退回拖拽 / 移除图形，redo×3 复原（undo 后对象重建，用 find 取新引用）', () => {
    L.undo(); // 退回拖拽
    expect(L.find(dmk.id)!.pts[0].price).toBe(105);
    L.undo();
    expect(L.drawings.length).toBe(2);
    L.undo();
    expect(L.drawings.length).toBe(1);
    L.redo();
    L.redo();
    L.redo();
    expect(L.drawings.length).toBe(3); // 全部复原（含拖拽后的状态，价格不再是 105）
    expect(L.find(dmk.id)!.pts[0].price).not.toBe(105);
  });
  it('字形纯函数：7 个顶点、dir=-1 时上下翻转', () => {
    const up = arrowGlyphPts(0, 0, 10);
    const dn = arrowGlyphPts(0, 0, 10, -1);
    expect(up.length).toBe(7);
    expect(up[0].y).toBe(-10);
    expect(dn[0].y).toBe(10);
    expect(up[0].x).toBeCloseTo(dn[0].x, 9);
  });
});

/* —— 形状组：多锚点工具 × 四判据（数据驱动） —— */

interface ShapeSpec {
  key: string;
  pts: { time: number; price: number }[];
  inside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  outside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  minStrokes: number;
}

const SHAPE_SPECS: ShapeSpec[] = [
  {
    key: 'rotrect',
    pts: [anchor(8, 100), anchor(24, 100), anchor(8, 108)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[2].x) / 2, y: Math.max(p[0].y, p[2].y) + 40 };
    },
    minStrokes: 1,
  },
  {
    key: 'path',
    pts: [anchor(6, 100), anchor(14, 108), anchor(22, 102), anchor(30, 110)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 + 50 };
    },
    minStrokes: 1,
  },
  {
    key: 'circle',
    pts: [anchor(10, 105), anchor(22, 105)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x, y: p[0].y }; // 圆心
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: p[0].x + Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) + 60, y: p[0].y };
    },
    minStrokes: 1,
  },
  {
    key: 'polyline',
    pts: [anchor(36, 100), anchor(44, 108), anchor(52, 102)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 };
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[1].x + p[2].x) / 2, y: (p[1].y + p[2].y) / 2 + 50 };
    },
    minStrokes: 1,
  },
  {
    key: 'arc',
    pts: [anchor(30, 100), anchor(42, 110)],
    inside: (L, d) => {
      // 右上四分之一弧的 45° 采样点
      const p = L.pixelPts(d);
      return ellipseArcPts((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2,
        Math.abs(p[1].x - p[0].x) / 2, Math.abs(p[1].y - p[0].y) / 2, -Math.PI / 4, -Math.PI / 4)[0];
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      // 左下角（弧的对角）不在这条弧上
      return { x: Math.min(p[0].x, p[1].x) - 10, y: Math.max(p[0].y, p[1].y) + 10 };
    },
    minStrokes: 1,
  },
  {
    key: 'curve',
    pts: [anchor(8, 100), anchor(16, 112), anchor(24, 100)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      return quadBezierPts(p[0], p[1], p[2])[16]; // t=0.5 附近
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[2].x) / 2, y: (p[0].y + p[2].y) / 2 + 45 }; // 弦中点下方
    },
    minStrokes: 1,
  },
  {
    key: 'hyperbola',
    pts: [anchor(34, 100), anchor(44, 100)],
    inside: (L, d) => {
      const p = L.pixelPts(d);
      const vx = (p[0].x + p[1].x) / 2;
      const vy = (p[0].y + p[1].y) / 2;
      const c = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) / 2;
      return { x: vx + Math.max(c * 0.45, 6), y: vy }; // 顶点
    },
    outside: (L, d) => {
      const p = L.pixelPts(d);
      return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; // 两支之间的中心空档
    },
    minStrokes: 2,
  },
];

describe('形状组：rotrect/path/circle/polyline/arc/curve/hyperbola × 四判据（数据驱动）', () => {
  for (const spec of SHAPE_SPECS) {
    describe(spec.key, () => {
      const { L, d } = draw(spec.key, spec.pts);

      it(`① 画法：render 不抛错且 stroke ≥ ${spec.minStrokes}`, () => {
        const { ctx, ops } = makeCtx();
        expect(() => L.render(ctx)).not.toThrow();
        expect(ops.stroke).toBeGreaterThanOrEqual(spec.minStrokes);
      });
      it('② 命中：图形上的点能命中', () => {
        const pt = spec.inside(L, d);
        const hit = L.hitTest(pt.x, pt.y);
        expect(hit && hit.d.id === d.id).toBe(true);
      });
      it('③ 命中外：图形外的点不命中', () => {
        const pt = spec.outside(L, d);
        expect(L.hitTest(pt.x, pt.y)).toBeNull();
      });
      it('④ 手柄+撤销：拖 0 号手柄只动 p0，undo×2 退回 / redo 复原', () => {
        const p0px = L.pixelPts(d)[0];
        L.select(d.id);
        expect(L.hitTest(p0px.x, p0px.y)!.part).toBe(0);
        const orig1 = { ...d.pts[1] };
        L.onDown(p0px.x, p0px.y);
        L.onMove(p0px.x + 40, p0px.y + 20);
        L.onUp();
        expect(d.pts[1].time).toBe(orig1.time);
        expect(d.pts[1].price).toBeCloseTo(orig1.price, 9);
        const movedTime = L.find(d.id)!.pts[0].time;
        expect(movedTime).not.toBe(spec.pts[0].time);
        L.undo(); // 退回拖拽
        expect(L.find(d.id)!.pts[0].time).toBe(spec.pts[0].time);
        L.undo(); // 移除图形
        expect(L.drawings.length).toBe(0);
        L.redo();
        expect(L.drawings.length).toBe(1);
      });
    });
  }

  it('几何纯函数：quadBezier 端点守恒 / ellipseArc 端点在椭圆上 / hyperbola 两支对称', () => {
    const bez = quadBezierPts({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 });
    expect(bez[0]).toEqual({ x: 0, y: 0 });
    expect(bez[bez.length - 1]).toEqual({ x: 100, y: 0 });
    expect(bez[16].y).toBeCloseTo(50, 6); // t=0.5 → y = 100/2

    const arc = ellipseArcPts(0, 0, 30, 20, -Math.PI / 2, 0);
    expect(arc[0].y).toBeCloseTo(-20, 9); // 顶部
    expect(arc[arc.length - 1].x).toBeCloseTo(30, 9); // 右侧

    const hb = hyperbolaPts(-40, 0, 40, 0);
    expect(hb.length).toBe(82); // 2 支 × 41 点
    expect(hb[0].x + hb[hb.length - 1].x).toBeCloseTo(0, 6); // 两支关于 x=0 对称（镜像点 x 和）
  });
});

/* ===========================================================================
 * 设计稿 emoji 面板（「图标」按钮）：emoji 标注工具
 * ========================================================================= */

import { EMOJI_SIZE } from '../src/engine/draw';

describe('emoji 标注（图标按钮 → 分类面板 → 放置）', () => {
  // 真实交互流：面板选中字符（emojiChar）→ setTool('emoji') → 图上单击放置
  const L = new DrawLayer(HOST);
  L.emojiChar = '😀';
  L.setTool('emoji');
  L.onDown(HOST.xCenter(20), HOST.yOf(105));
  L.onUp();
  const d = L.find(L.drawings[0].id)!;
  const p = L.pixelPts(d)[0];

  it('画法：render 不抛错且产生文本填充；字符与字号入 style', () => {
    expect(d.style.text).toBe('😀');
    expect(d.style.fontSize).toBe(EMOJI_SIZE);
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.text).toBeGreaterThanOrEqual(1);
  });
  it('命中：以锚点为中心的方形热区，字形外不命中', () => {
    expect(L.hitTest(p.x, p.y)!.d.id).toBe(d.id);
    const h = EMOJI_SIZE / 2 - 1;
    expect(L.hitTest(p.x - h, p.y - h)!.d.id).toBe(d.id);
    expect(L.hitTest(p.x + 40, p.y)).toBeNull();
  });
  it('手柄 + 撤销：拖唯一锚点换位；undo 退回 / redo 复原', () => {
    L.select(d.id);
    expect(L.hitTest(p.x, p.y)!.part).toBe(0);
    L.onDown(p.x, p.y);
    L.onMove(p.x + 30, p.y - 25);
    L.onUp();
    expect(d.pts[0].price).not.toBe(105);
    L.undo();
    expect(L.find(d.id)!.pts[0].price).toBe(105);
    L.redo();
    expect(L.find(d.id)!.pts[0].price).not.toBe(105);
  });
});

/* ===========================================================================
 * 设计稿「画图时线的设置与删除」：选中图形后的浮动属性工具条（引擎侧能力）
 *   —— setStyle / setLocked / repeatDraw / clone / selectionToolbarAnchor
 * ========================================================================= */

describe('浮动属性工具条：setStyle 改颜色/线宽/线型，可撤销可重做', () => {
  const L = new DrawLayer(HOST);
  const d = L.add('trend', [anchor(10, 100), anchor(30, 110)]);
  const c0 = d.style.color;
  const w0 = d.style.width;

  it('setStyle：改颜色 + 线宽立即生效', () => {
    expect(L.setStyle(d.id, { color: '#f23645', width: 4 })).toBe(true);
    expect(d.style.color).toBe('#f23645');
    expect(d.style.width).toBe(4);
  });
  it('undo 退回原样式，redo 复原新样式', () => {
    L.undo();
    expect(L.find(d.id)!.style.color).toBe(c0);
    expect(L.find(d.id)!.style.width).toBe(w0);
    L.redo();
    expect(L.find(d.id)!.style.color).toBe('#f23645');
    expect(L.find(d.id)!.style.width).toBe(4);
  });
  it('线型 dash 同样走 setStyle', () => {
    expect(L.setStyle(d.id, { dash: [8, 5] })).toBe(true);
    expect(L.find(d.id)!.style.dash).toEqual([8, 5]);
    L.undo();
    expect(L.find(d.id)!.style.dash).toEqual([]);
  });
  it('未知 id 返回 false 且不入撤销栈', () => {
    const n = L.canUndo();
    expect(L.setStyle(99999, { width: 8 })).toBe(false);
    expect(L.canUndo()).toBe(n);
  });
  it('改样式后渲染不抛错且走描边分支', () => {
    const { ctx, ops } = makeCtx();
    expect(() => L.render(ctx)).not.toThrow();
    expect(ops.stroke).toBeGreaterThanOrEqual(1);
  });
});

describe('浮动属性工具条：锁定 setLocked —— 可选中、拖不动、删不掉', () => {
  const L = new DrawLayer(HOST);
  const d = L.add('trend', [anchor(8, 100), anchor(28, 112)]);
  const mid = (() => { const p = L.pixelPts(d); return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; })();
  L.setLocked(d.id, true);

  it('锁定后仍能命中（选中才好弹工具条解锁）', () => {
    L.select(null);
    const hit = L.hitTest(mid.x, mid.y);
    expect(hit && hit.d.id === d.id).toBe(true);
  });
  it('onDown 只选中不进入拖拽；onMove 不改锚点', () => {
    L.onDown(mid.x, mid.y);
    expect(L.activeId).toBe(d.id);
    L.onMove(mid.x + 50, mid.y + 30);
    L.onUp();
    expect(d.pts[0]).toEqual(anchor(8, 100));
    expect(d.pts[1]).toEqual(anchor(28, 112));
  });
  it('removeActive（Delete 键路径）删不掉；remove 也被工具条禁用侧保护', () => {
    expect(L.removeActive()).toBe(false);
    expect(L.drawings.length).toBe(1);
  });
  it('橡皮擦路径：锁定图形受保护（erase 保护在 onDown 分支，这里验证 hit 后手动判 locked）', () => {
    // 引擎里橡皮擦调用 this.remove 前会检查 hit.d.locked；remove 本身不拦（工具条 trash 用 disabled 拦）
    expect(L.remove(d.id)).toBe(true); // 引擎级 remove 不拦锁定（无 UI 语义），工具条层面禁用
    L.undo();
    expect(L.drawings.length).toBe(1);
  });
  it('setLocked 两次入撤销栈：undo 回锁定，再 undo 回未锁，redo 复原', () => {
    L.setLocked(d.id, false);
    expect(L.find(d.id)!.locked).toBe(false);
    L.undo();
    expect(L.find(d.id)!.locked).toBe(true);
    L.undo();
    expect(L.find(d.id)!.locked).toBe(false);
    L.redo();
    L.redo();
    expect(L.find(d.id)!.locked).toBe(false);
  });
  it('解锁后恢复可拖', () => {
    const dd = L.find(d.id)!;
    const p = L.pixelPts(dd);
    L.select(dd.id);
    L.onDown(p[0].x, p[0].y);
    L.onMove(p[0].x, p[0].y + 40);
    L.onUp();
    expect(L.find(d.id)!.pts[0].price).not.toBe(100);
  });
});

describe('浮动属性工具条：repeatDraw 重复绘制', () => {
  it('开启后两点工具成型不切回光标，可连续画', () => {
    const L = new DrawLayer(HOST);
    L.setTool('trend');
    L.setRepeat(true);
    expect(L.repeatDraw).toBe(true);
    L.onDown(HOST.xCenter(10), HOST.yOf(105));
    L.onDown(HOST.xCenter(20), HOST.yOf(108));
    expect(L.tool).toBe('trend');
    expect(L.drawings.length).toBe(1);
    L.onDown(HOST.xCenter(24), HOST.yOf(106));
    L.onDown(HOST.xCenter(34), HOST.yOf(109));
    expect(L.drawings.length).toBe(2);
  });
  it('关闭后恢复画完自动切回光标', () => {
    const L = new DrawLayer(HOST);
    L.setTool('hline');
    L.setRepeat(false);
    L.onDown(HOST.xCenter(12), HOST.yOf(104));
    L.onUp();
    expect(L.tool).toBe('cursor');
    expect(L.drawings.length).toBe(1);
  });
  it('repeat 画出的一笔 undo 一次消失', () => {
    const L = new DrawLayer(HOST);
    L.setTool('trend');
    L.setRepeat(true);
    L.onDown(HOST.xCenter(10), HOST.yOf(105));
    L.onDown(HOST.xCenter(20), HOST.yOf(108));
    L.undo();
    expect(L.drawings.length).toBe(0);
  });
});

describe('浮动属性工具条：clone 克隆副本', () => {
  const L = new DrawLayer(HOST);
  const d = L.add('trend', [anchor(10, 100), anchor(30, 110)]);
  const cp = L.clone(d.id)!;

  it('副本存在、样式一致、按 (48px, -36px) 偏移', () => {
    expect(cp).not.toBeNull();
    const sp = L.pixelPts(d);
    const pp = L.pixelPts(cp);
    expect(pp[0].x - sp[0].x).toBeCloseTo(48, 0);
    expect(pp[0].y - sp[0].y).toBeCloseTo(-36, 0);
    expect(JSON.stringify(cp.style)).toBe(JSON.stringify(d.style));
  });
  it('副本自动选中；一次 undo 后消失', () => {
    expect(L.activeId).toBe(cp.id);
    L.undo();
    expect(L.find(cp.id)).toBeNull();
  });
  it('未知 id 克隆返回 null', () => {
    expect(L.clone(424242)).toBeNull();
  });
});

describe('浮动属性工具条：selectionToolbarAnchor 定位', () => {
  const L = new DrawLayer(HOST);

  it('无选中返回 null', () => {
    expect(L.selectionToolbarAnchor()).toBeNull();
  });
  it('选中后 x = 包围盒中心 − 95，y = 盒顶 − 46（含 plot 夹取）', () => {
    const d = L.add('trend', [anchor(10, 100), anchor(30, 110)]);
    L.select(d.id);
    const p = L.pixelPts(d);
    const a = L.selectionToolbarAnchor()!;
    const cx = (p[0].x + p[1].x) / 2 - 95;
    const clampedX = Math.min(Math.max(cx, HOST.plot.l + 4), HOST.plot.r - 194);
    expect(a.x).toBeCloseTo(clampedX, 6);
    expect(a.y).toBeCloseTo(Math.min(p[0].y, p[1].y) - 46, 6);
  });
  it('图形贴近顶部时翻转到包围盒下方', () => {
    const d = L.add('trend', [anchor(10, HOST.scale.max), anchor(30, HOST.scale.max - 0.001)]);
    L.select(d.id);
    const a = L.selectionToolbarAnchor()!;
    expect(a.y).toBeGreaterThan(HOST.plot.t);
    L.remove(d.id);
  });
  it('隐藏整层时返回 null', () => {
    const d = L.add('trend', [anchor(10, 100), anchor(30, 110)]);
    L.select(d.id);
    L.setHidden(true);
    expect(L.selectionToolbarAnchor()).toBeNull();
    L.setHidden(false);
    expect(L.selectionToolbarAnchor()).not.toBeNull();
  });
});

/* ===========================================================================
 * 对齐 charting_library（本地参考库 100 种线工具）：音叉 / 文本标注 / 形状补齐 17 种
 *   —— 四判据数据驱动：画法 / 命中 on / 命中 off / 手柄 + undo·redo 往返
 * ========================================================================= */

interface AlignSpec {
  key: string;
  pts: { time: number; price: number }[];
  inside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  outside: (L: DrawLayer, d: Drawing) => { x: number; y: number };
  minStrokes: number;
}

const midOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const ALIGN_SPECS: AlignSpec[] = [
  // —— 音叉族（3 锚点）——
  {
    key: 'pitchfork',
    pts: [anchor(8, 100), anchor(30, 110), anchor(30, 90)],
    inside: (L, d) => L.pixelPts(d)[1],      // 过 b 的平行线
    outside: (L, d) => { const p = L.pixelPts(d); return { x: p[1].x, y: Math.max(p[0].y, p[1].y, p[2].y) + 200 }; },
    minStrokes: 3,
  },
  {
    key: 'schiff',
    pts: [anchor(8, 100), anchor(30, 110), anchor(30, 90)],
    inside: (L, d) => L.pixelPts(d)[1],
    outside: (L, d) => { const p = L.pixelPts(d); return { x: p[1].x, y: Math.max(p[0].y, p[1].y, p[2].y) + 200 }; },
    minStrokes: 3,
  },
  {
    key: 'schiff2',
    pts: [anchor(8, 100), anchor(30, 110), anchor(30, 90)],
    inside: (L, d) => L.pixelPts(d)[1],
    outside: (L, d) => { const p = L.pixelPts(d); return { x: p[1].x, y: Math.max(p[0].y, p[1].y, p[2].y) + 200 }; },
    minStrokes: 3,
  },
  {
    key: 'innerfork',
    pts: [anchor(8, 100), anchor(30, 110), anchor(30, 90)],
    inside: (L, d) => { const p = L.pixelPts(d); return midOf(p[0], p[1]); }, // 半距平行线过 a·b 中点
    outside: (L, d) => { const p = L.pixelPts(d); return { x: p[1].x, y: Math.max(p[0].y, p[1].y, p[2].y) + 200 }; },
    minStrokes: 3,
  },
  {
    key: 'pitchfan',
    pts: [anchor(8, 100), anchor(30, 110), anchor(30, 90)],
    inside: (L, d) => L.pixelPts(d)[1],      // 扇形第 1 条正过 b
    outside: (L, d) => { const p = L.pixelPts(d); return { x: p[1].x, y: Math.max(p[0].y, p[1].y, p[2].y) + 200 }; },
    minStrokes: 5,
  },
  // —— 文本类标注（1 锚点，卡片 + 引线）——
  {
    key: 'note',
    pts: [anchor(20, 105)],
    inside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y - 40 }; },
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y + 70 }; },
    minStrokes: 2,
  },
  {
    key: 'callout',
    pts: [anchor(20, 105)],
    inside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y - 40 }; },
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y + 70 }; },
    minStrokes: 2,
  },
  {
    key: 'comment',
    pts: [anchor(20, 105)],
    inside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y - 36 }; },
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y + 70 }; },
    minStrokes: 2,
  },
  {
    key: 'balloon',
    pts: [anchor(20, 105)],
    inside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 60, y: p.y - 40 }; },
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y + 70 }; },
    minStrokes: 2,
  },
  {
    key: 'pricenote',
    pts: [anchor(20, 105)],
    inside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y - 40 }; },
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y + 70 }; },
    minStrokes: 2,
  },
  {
    key: 'pricelabel',
    pts: [anchor(20, 105)],
    inside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y }; },
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y - 60 }; },
    minStrokes: 2,
  },
  {
    key: 'signpost',
    pts: [anchor(20, 105)],
    inside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y - 30 }; },
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x + 40, y: p.y + 70 }; },
    minStrokes: 2,
  },
  // —— 形状补齐 ——
  {
    key: 'circlelines',
    pts: [anchor(16, 105), anchor(26, 108)],
    inside: (L, d) => { const p = L.pixelPts(d); const r = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y); return { x: p[0].x + r, y: p[0].y }; },
    outside: (L, d) => { const p = L.pixelPts(d); const r = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y); return { x: p[0].x + r * 0.55, y: p[0].y - r * 0.55 }; },
    minStrokes: 1,
  },
  {
    key: 'beziercubic',
    pts: [anchor(6, 100), anchor(14, 110), anchor(26, 96), anchor(36, 106)],
    inside: (L, d) => { const p = L.pixelPts(d); return cubicBezierPts(p[0], p[1], p[2], p[3])[20]; },
    outside: (L, d) => { const p = L.pixelPts(d); const q = cubicBezierPts(p[0], p[1], p[2], p[3])[20]; return { x: q.x, y: q.y + 90 }; },
    minStrokes: 1,
  },
  {
    key: 'flatbottom',
    pts: [anchor(10, 100), anchor(30, 100)],
    inside: (L, d) => { const p = L.pixelPts(d); return { x: (p[0].x + p[1].x) / 2, y: p[0].y }; },
    outside: (L, d) => { const p = L.pixelPts(d); return { x: (p[0].x + p[1].x) / 2, y: p[0].y + 60 }; },
    minStrokes: 1,
  },
  {
    key: 'arrowmarl',
    pts: [anchor(20, 105)],
    inside: (L, d) => L.pixelPts(d)[0],
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x, y: p.y + 50 }; },
    minStrokes: 1,
  },
  {
    key: 'arrowmarr',
    pts: [anchor(20, 105)],
    inside: (L, d) => L.pixelPts(d)[0],
    outside: (L, d) => { const p = L.pixelPts(d)[0]; return { x: p.x, y: p.y + 50 }; },
    minStrokes: 1,
  },
];

describe('对齐 charting_library：17 种新工具 × 四判据（数据驱动）', () => {
  for (const spec of ALIGN_SPECS) {
    describe(spec.key, () => {
      const { L, d } = draw(spec.key, spec.pts);

      it(`① 画法：render 不抛错且 stroke ≥ ${spec.minStrokes}`, () => {
        const { ctx, ops } = makeCtx();
        expect(() => L.render(ctx)).not.toThrow();
        expect(ops.stroke).toBeGreaterThanOrEqual(spec.minStrokes);
      });
      it('② 命中：图形上的点能命中', () => {
        const pt = spec.inside(L, d);
        const hit = L.hitTest(pt.x, pt.y);
        expect(hit && hit.d.id === d.id).toBe(true);
      });
      it('③ 命中外：图形外的点不命中', () => {
        const pt = spec.outside(L, d);
        expect(L.hitTest(pt.x, pt.y)).toBeNull();
      });
      it('④ 手柄+撤销：拖 0 号手柄只动 p0，其它锚点不动；undo×2 退回 / redo 复原', () => {
        const p0px = L.pixelPts(d)[0];
        L.select(d.id);
        expect(L.hitTest(p0px.x, p0px.y)!.part).toBe(0);
        const others = spec.pts.slice(1).map((q) => ({ ...q }));
        L.onDown(p0px.x, p0px.y);
        L.onMove(p0px.x + 40, p0px.y + 20);
        L.onUp();
        const cur = L.find(d.id)!;
        others.forEach((q, i) => {
          expect(cur.pts[i + 1].time).toBe(q.time);
          expect(cur.pts[i + 1].price).toBeCloseTo(q.price, 9);
        });
        expect(cur.pts[0].time).not.toBe(spec.pts[0].time);
        L.undo();
        expect(L.find(d.id)!.pts[0].time).toBe(spec.pts[0].time);
        L.undo();
        expect(L.drawings.length).toBe(0);
        L.redo();
        expect(L.drawings.length).toBe(1);
      });
    });
  }

  it('几何纯函数：pitchforkRays 三变体起点 / 扇形 5 条；三次贝塞尔端点守恒；左右箭头镜像', () => {
    const A = { x: 0, y: 0 };
    const B = { x: 100, y: -20 };
    const C = { x: 100, y: 20 };
    expect(pitchforkRays('pitchfork', A, B, C)).toHaveLength(3);
    expect(pitchforkRays('pitchfan', A, B, C)).toHaveLength(5);
    expect(pitchforkRays('schiff', A, B, C)[0].o).toEqual({ x: 50, y: -10 }); // a·b 中点
    expect(pitchforkRays('schiff2', A, B, C)[0].o).toEqual({ x: 0, y: -10 });  // 只移价格轴

    const q = cubicBezierPts({ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 60, y: -60 }, { x: 90, y: 0 });
    expect(q).toHaveLength(41);
    expect(q[0]).toEqual({ x: 0, y: 0 });
    expect(q[40].x).toBeCloseTo(90, 9);
    // t=0.5：x = (0 + 3*30 + 3*60 + 90)/8 = 45；y = 0
    expect(q[20].x).toBeCloseTo(45, 9);
    expect(q[20].y).toBeCloseTo(0, 9);

    const r = arrowSideGlyphPts(10, 10, 10, 1);
    const l = arrowSideGlyphPts(10, 10, 10, -1);
    expect(r[0].x).toBeCloseTo(20, 9);  // 向右：头顶点在右侧
    expect(l[0].x).toBeCloseTo(0, 9);   // 向左
    expect(r[0].y).toBeCloseTo(10, 9);
  });
});
