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
  it('工具表：9 → 18 种，新工具的锚点数与快捷键就位', () => {
    expect(DRAW_TOOLS.length).toBe(18);
    const want: Record<string, number> = {
      hray: 1, extline: 2, arrow: 2, ellipse: 2, triangle: 3, channel: 3,
      dot: 1, highlight: 0, eraser: 0,
    };
    for (const [key, points] of Object.entries(want)) {
      const def = DRAW_TOOLS.find((t) => t.key === key);
      expect(def && def.points === points).toBe(true);
      expect(def && def.key2 && def.key2.length === 1).toBe(true);
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
