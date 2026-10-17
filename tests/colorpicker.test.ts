/**
 * 颜色选择器 —— 与线上 TradingView 的取色器逐项对齐（快照 tests/fixtures/tv-palette.json，
 * 2026-10-18 Playwright 从 cn.tradingview.com「设置 → 商品代码 → 主体颜色」抓取）。
 *
 * 官方量到的：弹层 248 宽 / 6px 12px / 圆角 6 / 0 2px 4px rgba(0,0,0,.2)；
 * 调色板 10 列 × 8 行、格子 17×17、间距 6、圆角 2、1px 描边（白块 #dbdbdb）；
 * 环 = ::after inset -5px / 2px / 圆角 6；分隔线 1px #dbdbdb（上下 12）；「+」17×17、线长 13。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE, PALETTE_COLS, PALETTE_ROWS, normalizeHex, swatchEdge } from '../src/ui/palette';

const FX = JSON.parse(readFileSync(new URL('./fixtures/tv-palette.json', import.meta.url), 'utf8')) as {
  menu: { width: number; padding: string; radius: number; shadow: string };
  grid: { cols: number; rows: number; cell: number; gap: number; radius: number; borderWidth: number; whiteBorder: string };
  ring: { inset: number; borderWidth: number; radius: number; selectedColor: string; hoverColor: string };
  separator: { thickness: number; color: string; marginY: number };
  plus: { size: number; line: number; thickness: number; marginY: number; title: string };
  rows: string[][];
};

const CSS = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');
const PROPS = readFileSync(new URL('../src/workspace/dom/DrawPropsBar.ts', import.meta.url), 'utf8');

/** 取某个选择器的整条声明块（含嵌套伪元素时取第一段） */
function rule(sel: string): string {
  const i = CSS.indexOf(sel + ' {');
  expect(i, `CSS 里找不到 ${sel}`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf('}', i) + 1);
}

describe('ColorPicker：hex 规范化', () => {
  it('6 位大写规范化', () => {
    expect(normalizeHex('#089981')).toBe('#089981');
    expect(normalizeHex('089981')).toBe('#089981');
    expect(normalizeHex('#f23645'.toUpperCase())).toBe('#F23645');
  });
  it('3 位扩成 6 位', () => {
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('f00')).toBe('#FF0000');
  });
  it('非法输入返回 null（不静默吃掉）', () => {
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex('#12')).toBeNull();
    expect(normalizeHex('#1234567')).toBeNull();
    expect(normalizeHex('#gggggg')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });
});

describe('调色板：与官方 80 色逐值相等', () => {
  it('10 列 × 8 行 = 80 色', () => {
    expect(PALETTE_COLS).toBe(FX.grid.cols);
    expect(PALETTE_ROWS.length).toBe(FX.grid.rows);
    expect(PALETTE_ROWS.every((r) => r.length === FX.grid.cols)).toBe(true);
    expect(PALETTE.length).toBe(FX.grid.cols * FX.grid.rows);
  });

  it('每一行逐字符等于官方快照', () => {
    expect(PALETTE_ROWS.map((r) => [...r])).toEqual(FX.rows);
  });

  it('无重复、全部是合法 #rrggbb（小写，与官方 innerHTML 一致）', () => {
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
    expect(PALETTE.every((c) => normalizeHex(c) === c.toUpperCase())).toBe(true);
    expect(PALETTE.every((c) => c === c.toLowerCase())).toBe(true);
  });

  it('第 1 行是 10 级灰阶（白 → 黑）', () => {
    const g = FX.rows[0].map((c) => parseInt(c.slice(1, 3), 16));
    expect(g).toEqual([...g].sort((a, b) => b - a));
    expect(PALETTE_ROWS[0][0]).toBe('#ffffff');
    expect(PALETTE_ROWS[0][9]).toBe('#000000');
  });

  it('第 2 行是 10 个基色（红橙黄绿青蓝紫……项目红绿蓝都在）', () => {
    expect(PALETTE_ROWS[1]).toEqual([
      '#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981',
      '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63',
    ]);
    expect(PALETTE).toContain('#f23645');
    expect(PALETTE).toContain('#089981');
    expect(PALETTE).toContain('#2962ff');
  });

  it('3~8 行是同一批基色由浅到深（同列亮度单调递减）', () => {
    const lum = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    };
    for (let col = 0; col < FX.grid.cols; col++) {
      const shades = FX.rows.slice(2).map((r) => lum(r[col]));
      for (let i = 1; i < shades.length; i++) {
        expect(shades[i], `第 ${col + 1} 列的色阶应当越往下越深`).toBeLessThan(shades[i - 1]);
      }
    }
  });

  it('白块描边用 #dbdbdb，其余块描边就是自己', () => {
    expect(swatchEdge('#ffffff')).toBe('#dbdbdb');
    expect(swatchEdge('#FFFFFF')).toBe('#dbdbdb');
    expect(swatchEdge('#f23645')).toBe('#f23645');
    expect(swatchEdge('#0f0f0f')).toBe('#0f0f0f');
  });
});

describe('取色器度量：与官方 CSS 逐项相等', () => {
  it(`弹层 ${FX.menu.width} 宽 / ${FX.menu.padding} / 圆角 ${FX.menu.radius} / 官方阴影`, () => {
    const pop = rule('.cp-pop');
    expect(pop).toContain(`width: ${FX.menu.width}px`);
    expect(pop).toContain(`padding: ${FX.menu.padding}`);
    expect(pop).toContain(`border-radius: ${FX.menu.radius}px`);
    expect(pop).toContain(`box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2)`);
  });

  it(`网格 ${FX.grid.cols} 列 × ${FX.grid.cell}px、间距 ${FX.grid.gap}px`, () => {
    const g = rule('.cp-grid');
    expect(g).toContain(`grid-template-columns: repeat(${FX.grid.cols}, ${FX.grid.cell}px)`);
    expect(g).toContain(`gap: ${FX.grid.gap}px`);
  });

  it(`格子 ${FX.grid.cell}×${FX.grid.cell}、圆角 ${FX.grid.radius}、1px 当前色描边`, () => {
    const c = rule('.cp-cell');
    expect(c).toContain(`width: ${FX.grid.cell}px`);
    expect(c).toContain(`height: ${FX.grid.cell}px`);
    expect(c).toContain(`border-radius: ${FX.grid.radius}px`);
    expect(c).toContain(`border: ${FX.grid.borderWidth}px solid currentColor`);
    expect(c).toContain('background: currentColor');
  });

  it(`选中/悬停外环：inset ${FX.ring.inset}px、${FX.ring.borderWidth}px、圆角 ${FX.ring.radius}`, () => {
    const after = CSS.slice(CSS.indexOf('.cp-cell::after {'));
    const block = after.slice(0, after.indexOf('}') + 1);
    expect(block).toContain(`inset: ${FX.ring.inset}px`);
    expect(block).toContain(`border: ${FX.ring.borderWidth}px solid transparent`);
    expect(block).toContain(`border-radius: ${FX.ring.radius}px`);
    expect(CSS).toContain('.cp-cell:hover::after { border-color: var(--border-strong); }');
    expect(CSS).toContain('.cp-cell.on::after { border-color: var(--text); }');
  });

  it(`分隔线 ${FX.separator.thickness}px，上下各 ${FX.separator.marginY}px`, () => {
    const s = rule('.cp-sep');
    expect(s).toContain(`height: ${FX.separator.thickness}px`);
    expect(s).toContain(`margin: ${FX.separator.marginY}px 0`);
    expect(s).toContain('background: var(--border-strong)');
  });

  it(`「+」${FX.plus.size}×${FX.plus.size}、两条 ${FX.plus.line}px 的 1px 线`, () => {
    const p = rule('.cp-plus');
    expect(p).toContain(`width: ${FX.plus.size}px`);
    expect(p).toContain(`height: ${FX.plus.size}px`);
    expect(p).toContain(`margin: ${FX.plus.marginY}px 0`);
    expect(CSS).toContain(`.cp-plus::before { width: ${FX.plus.line}px; height: ${FX.plus.thickness}px; }`);
    expect(CSS).toContain(`.cp-plus::after { width: ${FX.plus.thickness}px; height: ${FX.plus.line}px; }`);
  });
});

describe('绘图属性条的调色板用的是同一份官方色板', () => {
  it('源码里引用 PALETTE_ROWS，且不再有自选的 SWATCHES 数组', () => {
    expect(PROPS).toContain("import { PALETTE_ROWS, normalizeHex, swatchEdge } from '../../ui/palette';");
    expect(PROPS).not.toContain('const SWATCHES =');
  });

  it('属性条网格同样 10 列 × 17px / 间距 6 / 圆角 2', () => {
    const i = PROPS.indexOf('.kc-propsbar-swatches {');
    const block = PROPS.slice(i, PROPS.indexOf('}', i) + 1);
    expect(block).toContain(`repeat(${FX.grid.cols}, ${FX.grid.cell}px)`);
    expect(block).toContain(`gap: ${FX.grid.gap}px`);
    expect(PROPS).toContain(`.kc-propsbar-swatches button::after {`);
    expect(PROPS).toContain(`inset: ${FX.ring.inset}px`);
  });
});
