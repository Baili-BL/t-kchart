/**
 * paneLayout 纯函数单测：默认布局与旧公式一致 / 权重分配守恒 / 最大化 / 折叠 / 面积区间夹紧。
 * 布局常量见 src/engine/paneLayout.ts。
 */
import { describe, expect, it } from 'vitest';
import {
  computePaneLayout, defaultPaneState, defaultPaneTotal, paneTotalRange,
  PANE_COLLAPSED_H, PANE_MAX_MAIN_H, PANE_MIN_H, PANE_MAIN_MIN_H,
} from '../src/engine/paneLayout';
import type { PaneLayoutState } from '../src/engine/paneLayout';

const states = (k: number, patch: Partial<PaneLayoutState> = {}): PaneLayoutState[] =>
  Array.from({ length: k }, () => ({ ...defaultPaneState(), ...patch }));

describe('paneLayout 默认布局（与旧版 paneHeight 公式一致）', () => {
  it('没有副图：主图占满全部可用高度', () => {
    const L = computePaneLayout(800, [], null);
    expect(L.mainH).toBe(800);
    expect(L.heights).toEqual([]);
    expect(L.paneTotal).toBe(0);
  });

  it('默认等高：与旧公式 each=clamp(round(avail*0.22),60,200), 总高=min(each*k, avail*0.6) 一致', () => {
    const avail = 786;
    const each = Math.min(200, Math.max(60, Math.round(avail * 0.22)));
    const total = Math.min(each * 3, avail * 0.6);
    const L = computePaneLayout(avail, states(3), null);
    // 旧版每格 = max(24, floor(total/k))；新版把 floor 余数给最后一个，主图严格 = avail - 总高
    expect(L.heights[0]).toBe(Math.floor(total / 3));
    expect(L.heights[1]).toBe(Math.floor(total / 3));
    expect(L.heights.reduce((s, h) => s + h, 0)).toBeCloseTo(total, 6);
    expect(L.mainH).toBeCloseTo(avail - total, 6);
  });

  it('主图至少留 40%（副图总高 ≤ 60% avail）——既有断言不变红', () => {
    const avail = 786;
    for (const k of [1, 3, 5, 8]) {
      const L = computePaneLayout(avail, states(k), null);
      expect(L.paneTotal).toBeLessThanOrEqual(avail * 0.6 + 1);
      expect(L.mainH).toBeGreaterThanOrEqual(avail * 0.4 - 1);
      expect(L.mainH + L.heights.reduce((s, h) => s + h, 0)).toBeCloseTo(avail, 6);
    }
  });

  it('defaultPaneTotal / paneTotalRange 出口存在且自洽', () => {
    expect(defaultPaneTotal(786, 0)).toBe(0);
    const r = paneTotalRange(786, states(3));
    expect(r.min).toBeLessThanOrEqual(r.max);
    expect(r.max).toBeCloseTo(786 - PANE_MAIN_MIN_H, 6);
  });
});

describe('paneLayout 拖拽面积（paneTotalPx）', () => {
  it('拖大：面积增加、主图变矮，且不超过 avail - 主图最小高度', () => {
    const avail = 786;
    const L = computePaneLayout(avail, states(2), avail - 100);
    expect(L.mainH).toBeCloseTo(100, 6);
    expect(L.paneTotal).toBeCloseTo(avail - 100, 6);
  });

  it('越界被夹住：paneTotalPx 超出区间时按边界取值', () => {
    const avail = 786;
    // 想拖到只剩 10px 主图 → 被夹到 avail - PANE_MAIN_MIN_H
    const L = computePaneLayout(avail, states(2), avail - 10);
    expect(L.mainH).toBeGreaterThanOrEqual(PANE_MAIN_MIN_H - 0.5);
    // 想拖到负面积 → 被夹到最小值
    const L2 = computePaneLayout(avail, states(2), 1);
    expect(L2.paneTotal).toBeGreaterThanOrEqual(PANE_MIN_H * 2 - 0.5);
  });

  it('高度按权重分配：2:1 权重 → 高度 2:1，总和守恒', () => {
    const avail = 786;
    const ss = states(3);
    ss[0].weight = 200;
    ss[1].weight = 100;
    ss[2].weight = 100;
    const total = defaultPaneTotal(avail, 3);
    const L = computePaneLayout(avail, ss, total);
    expect(L.heights[0]).toBeGreaterThan(L.heights[1]);
    // h1 与 h2 等权 → 等高（最后一个吸收 floor 余数，差 < 3px）
    expect(Math.abs(L.heights[1] - L.heights[2])).toBeLessThan(3);
    expect(L.heights.reduce((s, h) => s + h, 0)).toBeLessThanOrEqual(total + 2);
  });
});

describe('paneLayout 最大化 / 折叠', () => {
  it('最大化：主图压成细条，被最大化的占满，其余收窄到最小高度', () => {
    const avail = 786;
    const ss = states(3);
    ss[1].maximized = true;
    const L = computePaneLayout(avail, ss, null);
    expect(L.mainH).toBeLessThanOrEqual(PANE_MAX_MAIN_H);
    expect(L.heights[1]).toBeGreaterThan(avail * 0.5);
    expect(L.heights[0]).toBe(PANE_MIN_H);
    expect(L.heights[2]).toBe(PANE_MIN_H);
    expect(L.mainH + L.heights.reduce((s, h) => s + h, 0)).toBeCloseTo(avail, 6);
  });

  it('折叠：细标题栏高度；其余副图分剩余面积；全部折叠时主图占满除细条外的一切', () => {
    const avail = 786;
    const ss = states(3);
    ss[0].collapsed = true;
    const L = computePaneLayout(avail, ss, null);
    expect(L.heights[0]).toBe(PANE_COLLAPSED_H);
    expect(L.heights[1]).toBeGreaterThan(PANE_MIN_H);
    expect(L.mainH + L.heights.reduce((s, h) => s + h, 0)).toBeCloseTo(avail, 6);

    const all = states(2, { collapsed: true });
    const L2 = computePaneLayout(avail, all, null);
    expect(L2.heights.every((h) => h === PANE_COLLAPSED_H)).toBe(true);
    expect(L2.mainH).toBeCloseTo(avail - PANE_COLLAPSED_H * 2, 6);
  });

  it('最大化与折叠并存：折叠的保持细条，最大化的吃掉剩余', () => {
    const avail = 786;
    const ss = states(3);
    ss[0].collapsed = true;
    ss[2].maximized = true;
    const L = computePaneLayout(avail, ss, null);
    expect(L.heights[0]).toBe(PANE_COLLAPSED_H);
    expect(L.heights[1]).toBe(PANE_MIN_H);
    expect(L.heights[2]).toBeGreaterThan(avail * 0.5);
    expect(L.mainH + L.heights.reduce((s, h) => s + h, 0)).toBeCloseTo(avail, 6);
  });
});
