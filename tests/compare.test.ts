/**
 * 比较商品（Compare）：纯计算 + store。
 *
 * 这一层不碰 canvas，所以能在 Node 里直接跑：
 * 对齐 / 归一 / 折回等价价格 三件事是这条功能唯一容易算错的地方。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { alignCloses, equivPrices, firstValueIndex, lastValueIndex, percentAt } from '../src/engine/compare';
import { COMPARE_COLORS, COMPARE_MAX, useCompareStore } from '../src/store/compareStore';

const bar = (time: number, close: number) => ({
  time, open: close, high: close, low: close, close, volume: 0,
});

describe('compare · 时间对齐', () => {
  it('按 time（开盘时间）对齐，不是按位置', () => {
    const main = [{ time: 10 }, { time: 20 }, { time: 30 }];
    const other = [bar(30, 3), bar(10, 1)];
    expect(alignCloses(main, other)).toEqual([1, null, 3]);
  });

  it('长度恒等于主图（缺的交易日就是 null，不用前值填充）', () => {
    const main = [{ time: 1 }, { time: 2 }, { time: 3 }, { time: 4 }];
    expect(alignCloses(main, [bar(1, 5), bar(4, 7)])).toEqual([5, null, null, 7]);
  });

  it('非有限收盘价当缺值', () => {
    const main = [{ time: 1 }, { time: 2 }];
    expect(alignCloses(main, [bar(1, 5), bar(2, NaN)])).toEqual([5, null]);
  });

  it('主图为空时返回空数组', () => {
    expect(alignCloses([], [bar(1, 5)])).toEqual([]);
  });
});

describe('compare · 基准与百分比', () => {
  it('firstValueIndex 从 lo 起找第一个非空', () => {
    expect(firstValueIndex([null, null, 3, 4], 0, 3)).toBe(2);
    expect(firstValueIndex([null, null, 3, 4], 3, 3)).toBe(3);
    expect(firstValueIndex([null, null], 0, 1)).toBe(-1);
  });

  it('lastValueIndex 从 hi 往回找', () => {
    expect(lastValueIndex([1, null, null], 0, 2)).toBe(0);
    expect(lastValueIndex([1, 2, 3], 0, 1)).toBe(1);
  });

  it('equivPrices 把起点归一成主图基准价，之后保持同比例', () => {
    const r = equivPrices([50, 55, 60], 100, 0, 2);
    expect(r).not.toBeNull();
    expect(r!.baseIndex).toBe(0);
    expect(r!.prices[0]).toBeCloseTo(100, 9);
    expect(r!.prices[1]).toBeCloseTo(110, 9);
    expect(r!.prices[2]).toBeCloseTo(120, 9);
  });

  it('equivPrices 忽略可见范围之前的空值，基准取范围内第一个有值的根', () => {
    const r = equivPrices([null, 80, 40], 100, 1, 2);
    expect(r).not.toBeNull();
    expect(r!.baseIndex).toBe(1);
    expect(r!.prices[0]).toBeNull();
    expect(r!.prices[1]).toBeCloseTo(100, 9);
    expect(r!.prices[2]).toBeCloseTo(50, 9); // 80 → 40 = −50%
  });

  it('equivPrices 在空缺处保持 null（画线时断开）', () => {
    const r = equivPrices([10, null, 20], 100, 0, 2);
    expect(r!.prices).toEqual([100, null, 200]);
  });

  it('equivPrices 没有数据 / 基准为 0 时返回 null', () => {
    expect(equivPrices([null, null], 100, 0, 1)).toBeNull();
    expect(equivPrices([0, 1], 100, 0, 1)).toBeNull();
  });

  it('percentAt 返回相对基准的百分比', () => {
    expect(percentAt([50, 55], 0, 1)).toBeCloseTo(10, 9);
    expect(percentAt([50, 100], 0, 1)).toBeCloseTo(100, 9);
    expect(percentAt([50, 25], 0, 1)).toBeCloseTo(-50, 9);
  });

  it('percentAt 在当根缺数据时退到前一根', () => {
    expect(percentAt([50, 60, null], 0, 2)).toBeCloseTo(20, 9);
  });

  it('percentAt 在基准之前返回 null', () => {
    expect(percentAt([50, 60], 1, 0)).toBeNull();
  });
});

describe('compare · store', () => {
  beforeEach(() => useCompareStore.setState({ items: [] }));

  it('添加：第一条用官方默认蓝', () => {
    expect(useCompareStore.getState().add('SPX')).toBe('added');
    expect(useCompareStore.getState().items).toEqual([{ ticker: 'SPX', color: COMPARE_COLORS[0], visible: true }]);
  });

  it('重复添加返回 exists 且不产生第二条', () => {
    useCompareStore.getState().add('SPX');
    expect(useCompareStore.getState().add('SPX')).toBe('exists');
    expect(useCompareStore.getState().items.length).toBe(1);
  });

  it('颜色按顺序发、互不重复', () => {
    for (const t of ['SPX', 'NDX', 'DJI']) useCompareStore.getState().add(t);
    const colors = useCompareStore.getState().items.map((i) => i.color);
    expect(new Set(colors).size).toBe(3);
    expect(colors).toEqual(COMPARE_COLORS.slice(0, 3));
  });

  it('删掉中间一条后，新加的颜色会补上这个空位', () => {
    const s = useCompareStore.getState();
    s.add('A'); s.add('B'); s.add('C');
    s.remove('B');
    s.add('D');
    expect(useCompareStore.getState().items.find((i) => i.ticker === 'D')!.color).toBe(COMPARE_COLORS[1]);
  });

  it('超过上限返回 full 且不加', () => {
    for (let i = 0; i < COMPARE_MAX; i++) useCompareStore.getState().add('T' + i);
    expect(useCompareStore.getState().add('OVER')).toBe('full');
    expect(useCompareStore.getState().items.length).toBe(COMPARE_MAX);
  });

  it('toggle 只改目标那条的可见性', () => {
    const s = useCompareStore.getState();
    s.add('A'); s.add('B');
    s.toggle('A');
    const items = useCompareStore.getState().items;
    expect(items[0].visible).toBe(false);
    expect(items[1].visible).toBe(true);
    s.toggle('A');
    expect(useCompareStore.getState().items[0].visible).toBe(true);
  });

  it('remove / setColor / clear', () => {
    const s = useCompareStore.getState();
    s.add('A'); s.add('B');
    s.setColor('A', '#123456');
    expect(useCompareStore.getState().items[0].color).toBe('#123456');
    s.remove('A');
    expect(useCompareStore.getState().items.map((i) => i.ticker)).toEqual(['B']);
    s.clear();
    expect(useCompareStore.getState().items).toEqual([]);
  });
});
