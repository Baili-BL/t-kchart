/**
 * 默认缩放：最近 200 根。
 *
 * 用户反馈（本轮）：「每次最好展示最近 200 根 bar，默认时缩放」。
 * 之前构造函数与 `setBars` 都写死 `showLast(180)`：打开是 180 根，
 * 换标的 / 换周期也回到 180 根 —— 比官方（约 200 根）少一段上下文。
 *
 * 这里锁三件事：
 *   ① 常量就是 200，且**只有一处**（构造函数与 setBars 都走 applyDefaultView）；
 *   ② 行为：applyDefaultView 之后可见根数恰好 200、右端贴住最新一根；
 *   ③ autoView 语义：还停在默认视图时 resize 会按 200 重算（画布宽度先小后大不会留错），
 *      一旦用户缩放 / 平移 / 选范围 / 联动，就不再被 resize 拉回去。
 *
 * 测试手法沿用 crosshair.test.ts：只借 `KChart.prototype` 上的方法 + 一个假 this，
 * 因为它只碰 bars / plot / view，不需要 DOM（vitest 这里是 node 环境）。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_VISIBLE_BARS, KChart, makeBars } from '../src/engine/chart';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type AnyThis = Record<string, unknown>;
const proto = KChart.prototype as unknown as Record<string, (this: AnyThis, ...a: never[]) => unknown>;

function fakeChart(n = 1000, plotW = 800): AnyThis {
  const bars = makeBars(n, 42, 100);
  const c: AnyThis = {
    bars,
    plot: { l: 0, t: 0, r: plotW, b: 400, w: plotW, h: 400 },
    view: { from: 0, barW: 8 },
    autoView: true,
    notifyView() { /* 不广播 */ },
    invalidate() { /* 不重绘 */ },
  };
  for (const m of [
    'clampView', 'iOf', 'indexAtTime', 'visible', 'setViewTimes',
    'applyShowLast', 'applyDefaultView', 'showLast', 'fitContent', 'zoomAt', 'revealSpan',
  ]) {
    c[m] = proto[m].bind(c);
  }
  return c;
}

const visibleCount = (c: AnyThis): number => {
  const v = (c.visible as () => [number, number])();
  return v[1] - v[0];
};

const source = readFileSync(fileURLToPath(new URL('../src/engine/chart.ts', import.meta.url)), 'utf8');

describe('默认缩放：常量', () => {
  it('DEFAULT_VISIBLE_BARS = 200', () => {
    expect(DEFAULT_VISIBLE_BARS).toBe(200);
  });

  it('构造函数与 setBars 都用 applyDefaultView，不再留 showLast(180) 的硬编码', () => {
    // 构造函数里那一次（`this.bind(); this.resize(); ...`）
    expect(/this\.bind\(\);\s*\n\s*this\.resize\(\);\s*\n\s*this\.applyDefaultView\(\);/.test(source)).toBe(true);
    // setBars 里那一句，注释说明是「一次新的默认视图」
    expect(/一次新的「默认视图」[\s\S]{0,200}this\.applyDefaultView\(\);/.test(source)).toBe(true);
    // 全文件不再有 showLast(180) 被当作默认值
    expect(source.includes('showLast(180)')).toBe(false);
  });
});

describe('默认缩放：行为（假 this 直调私有方法）', () => {
  it('800px 视口 → 恰好 200 根，右端贴住最新一根', () => {
    const c = fakeChart(1000, 800);
    (c.applyDefaultView as () => void)();
    expect((c.view as { barW: number }).barW).toBeCloseTo(4, 12);
    expect((c.view as { from: number }).from).toBe(800); // n - 200
    expect(visibleCount(c)).toBe(DEFAULT_VISIBLE_BARS);
  });

  it('浮点边界：各种宽度下都数出整 200 根（不允许 199 / 201）', () => {
    for (const w of [449, 600, 733, 800, 1000, 1277, 1441]) {
      const c = fakeChart(1000, w);
      (c.applyDefaultView as () => void)();
      expect(visibleCount(c)).toBe(200);
    }
  });

  it('数据不足 200 根 → 全显示，第一根可见', () => {
    const c = fakeChart(120, 800);
    (c.applyDefaultView as () => void)();
    expect((c.view as { from: number }).from).toBe(0);
    expect(visibleCount(c)).toBe(120);
  });

  it('视口比 200px 还窄（4×4 布局）→ barW 压到 1px 下限，仍然靠右对齐最新一根', () => {
    const c = fakeChart(1000, 150);
    (c.applyDefaultView as () => void)();
    expect((c.view as { barW: number }).barW).toBe(1);
    const v = (c.visible as () => [number, number])();
    expect(v[1]).toBeGreaterThanOrEqual(999);
    expect(visibleCount(c)).toBe(150);
  });
});

describe('autoView：默认视图会跟着 resize 自愈，用户一动就撒手', () => {
  it('applyDefaultView 置 true；showLast / fitContent / zoomAt / revealSpan 置 false', () => {
    const c = fakeChart();
    (c.applyDefaultView as () => void)();
    expect(c.autoView).toBe(true);

    c.autoView = true;
    (c.showLast as (k: number) => void)(50);
    expect(c.autoView).toBe(false);

    c.autoView = true;
    (c.fitContent as () => void)();
    expect(c.autoView).toBe(false);

    c.autoView = true;
    (c.zoomAt as (px: number, k: number) => void)(400, 1.5);
    expect(c.autoView).toBe(false);

    c.autoView = true;
    const bars = c.bars as { time: number }[];
    (c.revealSpan as (a: number, b: number) => void)(bars[500].time, bars[700].time);
    expect(c.autoView).toBe(false);
  });

  it('resize 语义：autoView 时按 200 根重算 barW（宽度 300 → 900 后仍是 200 根）', () => {
    const c = fakeChart(1000, 300);
    (c.applyDefaultView as () => void)();
    expect(visibleCount(c)).toBe(200);
    const bwAt300 = (c.view as { barW: number }).barW;
    expect(bwAt300).toBeCloseTo(1.5, 12);

    // 模拟 resize：画布变宽后 computePlot 重新算 plot.w，autoView 为真 → 重算
    (c.plot as { w: number; r: number }).w = 900;
    (c.plot as { w: number; r: number }).r = 900;
    (c.applyShowLast as (k: number) => void)(DEFAULT_VISIBLE_BARS);
    expect((c.view as { barW: number }).barW).toBeCloseTo(4.5, 12);
    expect(visibleCount(c)).toBe(200);

    // 用户缩放过后（autoView=false）再 resize，barW 不变 —— 只是夹边
    c.autoView = false;
    (c.zoomAt as (px: number, k: number) => void)(400, 2);
    const bwZoomed = (c.view as { barW: number }).barW;
    (c.clampView as () => void)();
    expect((c.view as { barW: number }).barW).toBe(bwZoomed);
  });
});
