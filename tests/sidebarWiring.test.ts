/**
 * 侧栏接线闭合：左栏上「看得见的每一行」都必须真的做事。
 *
 * 背景：曾有一批菜单行（移除图形 / 隐藏指标 / 锁定所有绘图 / 继续绘图 / 三角形 …）
 * 上线了但没接引擎，点了统一弹「暂未实现」——上线清单和能力对不上。
 * 这个文件把「菜单项 → 意图」的翻译固定下来，并给新加的两条能力补行为断言。
 */
import { describe, expect, it, afterAll } from 'vitest';
import { DRAW_TOOLS, DrawLayer, makeFakeHost } from '../src/engine/draw';
import { drawBus, drawIntent, toolKeyForLabel, isMagnetLabel } from '../src/workspace/drawBus';
import { SECTIONS, MENU_SEP } from '../src/workspace/dom/sidebar';
import { useStudyStore } from '../src/store/studyStore';

/* ------------------------------------------------------------ 收集所有叶子行 */

/** 侧栏数据里的一行：['标签', ICON] / ['标签', ICON, '⌥T'] / ['标签', ICON, undefined, badge] */
type Row = readonly [string, unknown, ...unknown[]];

function leafLabels(): string[] {
  const out: string[] = [];
  for (const sec of SECTIONS) {
    for (const t of sec.tools) {
      const anyT = t as unknown as { label: string; items?: Row[]; groups?: { items: Row[] }[] };
      const hasMenu = (anyT.items?.length ?? 0) > 0 || (anyT.groups?.length ?? 0) > 0;
      // 有子菜单的按钮只展开菜单、不派发；没有子菜单的按钮本身就是一个动作（图标 / 测量 / 放大 / 继续绘图）
      if (!hasMenu) out.push(anyT.label);
      // MENU_SEP 是分隔线占位，不是一行，别算进「叶子行」
      const push = (r: Row): void => { if (r[0] !== MENU_SEP) out.push(r[0]); };
      for (const r of anyT.items ?? []) push(r);
      for (const g of anyT.groups ?? []) for (const r of g.items) push(r);
    }
  }
  return out;
}

const LABELS = leafLabels();
/** 叶子行里只有这些是「已知没接引擎」的，新增一行若也没接，下面的用例会红 */
const KNOWN_STUBS = new Set(['放大']);

describe('侧栏接线：每一行都有真意图', () => {
  it(`叶子行 ${LABELS.length} 条（数据没被抽空）`, () => {
    expect(LABELS.length).toBeGreaterThan(90);
    expect(new Set(LABELS).size).toBeGreaterThan(80);
  });

  it('没有「点了只会 toast」的行，除 KNOWN_STUBS 之外', () => {
    const stubs = LABELS.filter((l) => drawIntent(l).kind === 'stub');
    expect(new Set(stubs)).toEqual(KNOWN_STUBS);
  });

  it('每个 tool 意图都指向真实存在的 DRAW_TOOLS key', () => {
    const keys = new Set(DRAW_TOOLS.map((t) => t.key));
    const bad = LABELS
      .map((l) => drawIntent(l))
      .filter((it): it is { kind: 'tool'; label: string; key: string } => it.kind === 'tool')
      .filter((it) => !keys.has(it.key));
    expect(bad).toEqual([]);
  });

  it('89 种绘图工具全都能从侧栏点到（没有「实现了却点不到」）', () => {
    const reached = new Set(
      LABELS.map((l) => drawIntent(l))
        .filter((it): it is { kind: 'tool'; label: string; key: string } => it.kind === 'tool')
        .map((it) => it.key),
    );
    const dead = DRAW_TOOLS.map((t) => t.key).filter((k) => !reached.has(k));
    expect(dead).toEqual([]);
  });
});

describe('侧栏接线：动作行的意图', () => {
  const cases: [string, unknown][] = [
    ['移除图形', { kind: 'clear', target: 'drawings' }],
    ['移除指标', { kind: 'clear', target: 'studies' }],
    ['移除全部', { kind: 'clear', target: 'all' }],
    ['隐藏绘图', { kind: 'hide', target: 'drawings' }],
    ['隐藏指标', { kind: 'hide', target: 'studies' }],
    ['锁定所有绘图', { kind: 'lock', target: 'drawings' }],
    ['锁定指标', { kind: 'lock', target: 'studies' }],
    ['继续绘图', { kind: 'toggle', label: '继续绘图', what: 'repeatDraw' }],
  ];
  for (const [label, want] of cases) {
    it(`「${label}」→ ${JSON.stringify(want)}`, () => {
      expect(drawIntent(label)).toEqual(want);
    });
  }

  it('磁铁三档都归到 magnet（不是掉进「暂未实现」）', () => {
    for (const l of ['磁铁', '强力磁铁', '弱磁铁']) {
      expect(isMagnetLabel(l)).toBe(true);
      expect(drawIntent(l).kind).toBe('magnet');
    }
  });

  it('三角形（笔刷→形状）真的映射到 triangle —— 之前这里只有「三角形形态」别名，点主行是空动作', () => {
    expect(drawIntent('三角形')).toEqual({ kind: 'tool', label: '三角形', key: 'triangle' });
    expect(toolKeyForLabel('三角形')).toBe('triangle');
  });
});

/* --------------------------------------------------- 新增能力：全锁 / 全隐藏 */

const CLOSES: number[] = [];
for (let i = 0; i < 60; i++) CLOSES.push(100 + Math.sin(i / 6) * 8 + i * 0.2);
const HOST = makeFakeHost(CLOSES, 10);
const anchor = (i: number, price: number) => ({ time: HOST.bars[i].time, price });

describe('setAllLocked：锁定所有绘图', () => {
  const mk = (): DrawLayer => {
    const L = new DrawLayer(HOST);
    L.add('trend', [anchor(5, 101), anchor(20, 106)]);
    L.add('hline', [anchor(8, 103)]);
    L.add('rect', [anchor(10, 100), anchor(30, 107)]);
    return L;
  };

  it('全部上锁，返回被改动的个数', () => {
    const L = mk();
    expect(L.setAllLocked(true)).toBe(3);
    expect(L.drawings.every((d) => d.locked)).toBe(true);
  });

  it('已经是目标状态时不返回改动、也不入撤销栈（连点两次不会堆空快照）', () => {
    const L = mk();
    L.setAllLocked(true);
    expect(L.setAllLocked(true)).toBe(0);
    // 一次 undo 就回到全未锁（若堆了重复快照，这里会仍是全锁）
    L.undo();
    expect(L.drawings.some((d) => d.locked)).toBe(false);
  });

  it('一次 undo 回到上锁前；redo 再锁回去', () => {
    const L = mk();
    L.setAllLocked(true);
    L.undo();
    expect(L.drawings.every((d) => !d.locked)).toBe(true);
    L.redo();
    expect(L.drawings.every((d) => d.locked)).toBe(true);
  });

  it('解锁只挑锁定中的那些', () => {
    const L = mk();
    L.setLocked(L.drawings[1].id, true);
    expect(L.setAllLocked(false)).toBe(1);
    expect(L.drawings.every((d) => !d.locked)).toBe(true);
    expect(L.setAllLocked(false)).toBe(0);
  });

  it('空图层上全锁是空操作', () => {
    const L = new DrawLayer(HOST);
    expect(L.setAllLocked(true)).toBe(0);
    expect(L.canUndo()).toBe(false);
  });
});

describe('drawBus：新动作的状态广播（新格建层要跟着）', () => {
  const seen: string[] = [];
  const off = drawBus.subscribe((ev) => seen.push(ev.type + ('on' in ev ? ':' + String(ev.on) : '')));
  afterAll(() => off());

  it('setRepeatDraw 广播 repeat，且同值重复调用不再广播', () => {
    seen.length = 0;
    drawBus.setRepeatDraw(true);
    drawBus.setRepeatDraw(true);
    expect(seen).toEqual(['repeat:true']);
    expect(drawBus.repeatDraw).toBe(true);
    drawBus.setRepeatDraw(false);
    expect(seen).toEqual(['repeat:true', 'repeat:false']);
  });

  it('setLockAll 记住状态（新建格子时按这个值补锁）', () => {
    seen.length = 0;
    drawBus.setLockAll(true);
    expect(drawBus.lockAll).toBe(true);
    expect(seen).toEqual(['lock:true']);
    drawBus.setLockAll(false);
    expect(drawBus.lockAll).toBe(false);
  });

  it('setHidden 与 clear 仍然照旧', () => {
    seen.length = 0;
    drawBus.setHidden(true);
    drawBus.clear();
    drawBus.setHidden(false);
    expect(seen).toEqual(['hidden:true', 'clear', 'hidden:false']);
  });
});

describe('studyStore：隐藏指标 / 锁定指标', () => {
  const reset = () => {
    useStudyStore.setState({ studies: [], editingUid: null, locked: false, dialogOpen: false });
  };

  it('setAllHidden(true/false) 在全部定义上往返', () => {
    reset();
    useStudyStore.setState({
      studies: [
        { uid: 'a', name: 'MA', source: '', inputs: {}, hidden: false },
        { uid: 'b', name: 'RSI', source: '', inputs: {} },
      ],
    });
    useStudyStore.getState().setAllHidden(true);
    expect(useStudyStore.getState().studies.every((d) => d.hidden)).toBe(true);
    useStudyStore.getState().setAllHidden(false);
    expect(useStudyStore.getState().studies.every((d) => !d.hidden)).toBe(true);
    reset();
  });

  it('锁定时 edit(uid) 被拒，但 edit(null)（退出编辑）仍放行', () => {
    reset();
    useStudyStore.setState({ studies: [{ uid: 'a', name: 'MA', source: '', inputs: {} }] });
    useStudyStore.getState().setLocked(true);
    expect(useStudyStore.getState().edit('a')).toBe(false);
    expect(useStudyStore.getState().editingUid).toBeNull();
    expect(useStudyStore.getState().edit(null)).toBe(true);
    useStudyStore.getState().setLocked(false);
    expect(useStudyStore.getState().edit('a')).toBe(true);
    expect(useStudyStore.getState().editingUid).toBe('a');
    reset();
  });

  it('锁定时删指标、改参数都拒绝', () => {
    reset();
    useStudyStore.setState({ studies: [{ uid: 'a', name: 'MA', source: '', inputs: { L: 9 } }] });
    useStudyStore.getState().setLocked(true);
    expect(useStudyStore.getState().removeStudy('a')).toBe(false);
    useStudyStore.getState().setInputs('a', { L: 20 });
    expect(useStudyStore.getState().studies[0].inputs.L).toBe(9);
    useStudyStore.getState().setLocked(false);
    expect(useStudyStore.getState().removeStudy('a')).toBe(true);
    reset();
  });

  it('上锁会顺带退出编辑态（不然参数面板卡着还能改）', () => {
    reset();
    useStudyStore.setState({ studies: [{ uid: 'a', name: 'MA', source: '', inputs: {} }] });
    useStudyStore.getState().edit('a');
    expect(useStudyStore.getState().editingUid).toBe('a');
    useStudyStore.getState().setLocked(true);
    expect(useStudyStore.getState().editingUid).toBeNull();
    reset();
  });
});
