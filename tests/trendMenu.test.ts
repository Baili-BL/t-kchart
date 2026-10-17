/**
 * 「趋势线」下拉（趋势工具组）与线上 TradingView 的对齐。
 *
 * 依据：tests/fixtures/tv-trend-menu.json —— 2026-10-18 用 Playwright 打开
 * cn.tradingview.com 的匿名图表，点开左栏「趋势工具」下拉，把 20 行
 * （3 个分组标题 + 17 个工具）的标签、顺序、快捷键、行内 <svg> 和
 * getComputedStyle 度量逐条抄下来。
 *
 * 这个文件钉四件事：
 *   ① 分组 / 顺序 / 条目数完全等于官方：线 9（趋势线…横线）、通道 4、分叉线 4；
 *      「箭头」不在这个下拉里（官方把它放在标注组）；
 *   ② 17 个图标逐字符等于官方（含替换掉的 8 个手绘图标：射线/信息线/延长线/
 *      趋势角度/水平线/水平射线/垂直线/横线）；
 *   ③ 度量：菜单 224（光标那份 244）、行 40 高 / 2px 4px 内边距 / 圆角 6、
 *      分组标题 24 高 / 11px / 字距 .4 / 左缩进 8 / 组间空 13、快捷键 12px；
 *   ④ 每一项都能落到真实工具（toolKeyForLabel → DRAW_TOOLS 有锚点数），
 *      不允许「菜单里有、点下去没反应」。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_CSS, SECTIONS } from '../src/workspace/dom/sidebar';
import { toolKeyForLabel } from '../src/workspace/drawBus';
import { DRAW_TOOLS, EXTRA_LINE_TYPES, linreg } from '../src/engine/draw';
import {
  TRENDLINE, RAY_ICON, INFOLINE_ICON, EXTLINE_ICON, ANGLE_ICON,
  HLINE_ICON, HRAY_ICON, VLINE_ICON, CROSSLINE_ICON,
  PARALLEL_ICON, REGRESSION_ICON, FLAT_ICON, DISJOINT_ICON,
  PITCHFORK_ICON, SCHIFF_ICON, MSCHIFF_ICON, INSIDE_FORK_ICON,
} from '../src/workspace/dom/sidebar-icons';

interface FixtureItem { label: string; shortcut?: string; svg: string }
interface Fixture {
  menu: { width: number; padding: string; rowHeight: number; rowWidth: number; rowPadding: string; fontSize: number; iconGap: number; iconLeftInRow: number; hotkeyFontSize: number };
  header: { height: number; fontSize: number; letterSpacing: number; paddingLeft: number; gapBeforeGroup: number };
  groups: Array<{ label: string; items: FixtureItem[] }>;
}

const FX: Fixture = JSON.parse(
  readFileSync(new URL('./fixtures/tv-trend-menu.json', import.meta.url), 'utf8'),
);

/** 官方标签 → 我们仓库里的图标常量（趋势线复用主图标 TRENDLINE，官方同一份） */
const ICONS: Record<string, string> = {
  趋势线: TRENDLINE, 射线: RAY_ICON, 信息线: INFOLINE_ICON, 延长线: EXTLINE_ICON,
  趋势角度: ANGLE_ICON, 水平线: HLINE_ICON, 水平射线: HRAY_ICON, 垂直线: VLINE_ICON,
  横线: CROSSLINE_ICON, 平行通道: PARALLEL_ICON, 回归趋势: REGRESSION_ICON,
  '平顶/平底': FLAT_ICON, 不相交通道: DISJOINT_ICON, 分叉线: PITCHFORK_ICON,
  希夫干草叉: SCHIFF_ICON, 改良希夫干草叉: MSCHIFF_ICON, 内部分叉线: INSIDE_FORK_ICON,
};

const TOOL = SECTIONS.flatMap((s) => s.tools).find((t) => t.label === '趋势线')!;
const GROUPS = TOOL.groups ?? [];

/** 从 SIDEBAR_CSS 里抠出某条规则的大括号块 */
function block(css: string, sel: string): string {
  const i = css.indexOf(sel);
  if (i < 0) return '';
  return css.slice(i, css.indexOf('}', i) + 1);
}

describe('趋势工具下拉：分组 / 顺序 / 快捷键', () => {
  it('三组、17 项，标题与顺序与官方一致', () => {
    expect(GROUPS.map((g) => g.label)).toEqual(FX.groups.map((g) => g.label));
    expect(GROUPS.map((g) => g.items.length)).toEqual(FX.groups.map((g) => g.items.length));
    const ours = GROUPS.flatMap((g) => g.items.map((it) => it[0]));
    const theirs = FX.groups.flatMap((g) => g.items.map((it) => it.label));
    expect(ours).toEqual(theirs);
    expect(ours.length).toBe(17);
  });

  it('「箭头」不在这个下拉里（官方把它放进标注组）', () => {
    const all = GROUPS.flatMap((g) => g.items.map((it) => it[0]));
    expect(all).not.toContain('箭头');
    // 但标注组里仍然有它，别顺手删掉入口
    const annot = SECTIONS.flatMap((s) => s.tools).some((t) =>
      [...(t.items ?? []), ...(t.groups ?? []).flatMap((g) => g.items)].some((it) => it[0] === '箭头'));
    expect(annot).toBe(true);
  });

  it('快捷键：⌥ T / ⌥ H / ⌥ J / ⌥ V / ⌥ C（官方带空格），其余项没有', () => {
    for (const g of FX.groups) {
      for (const it of g.items) {
        const mine = GROUPS.flatMap((x) => x.items).find((x) => x[0] === it.label)!;
        expect(mine[2] ?? null).toBe(it.shortcut ?? null);
      }
    }
    const keys = GROUPS.flatMap((g) => g.items).filter((it) => it[2]).map((it) => it[0] + '=' + it[2]);
    expect(keys).toEqual(['趋势线=⌥ T', '水平线=⌥ H', '水平射线=⌥ J', '垂直线=⌥ V', '横线=⌥ C']);
  });

  it('信息线带 info 徽标（官方是行内问号，悬停才出现）', () => {
    const info = GROUPS.flatMap((g) => g.items).find((it) => it[0] === '信息线')!;
    expect(info[3]).toBe('info');
  });
});

describe('趋势工具下拉：17 个图标逐字符等于官方', () => {
  for (const row of FX.groups.flatMap((g) => g.items)) {
    it(`「${row.label}」`, () => {
      const mine = ICONS[row.label];
      expect(mine, `缺少 ${row.label} 的图标常量`).toBeDefined();
      expect(mine).toBe(row.svg);
      // 尺寸/视框也必须一致：官方全是 28×28
      expect(mine).toContain('viewBox="0 0 28 28"');
      expect(mine).toContain('width="28"');
    });
  }
});

describe('趋势工具下拉：度量等于官方实测值', () => {
  const menu = block(SIDEBAR_CSS, '.kc-sb-menu {');
  const row = block(SIDEBAR_CSS, '.kc-sb-menu li {');
  const header = block(SIDEBAR_CSS, '.kc-sb-menu .kc-menu-group {');

  it(`菜单宽 ${FX.menu.width}（光标那份 244 仍各自保留）`, () => {
    expect(TOOL.menuWidth).toBe(FX.menu.width);
    expect(menu).toContain(`padding: ${FX.menu.padding}`);
    expect(menu).toContain('box-sizing: border-box');
  });

  it(`行高 ${FX.menu.rowHeight} / 内边距 ${FX.menu.rowPadding} / 图标间距 ${FX.menu.iconGap} / 圆角 6`, () => {
    expect(row).toContain(`height: ${FX.menu.rowHeight}px`);
    expect(row).toContain(`padding: ${FX.menu.rowPadding}`);
    expect(row).toContain(`gap: ${FX.menu.iconGap}px`);
    expect(row).toContain('border-radius: 6px');
  });

  it(`分组标题 ${FX.header.height} 高 / ${FX.header.fontSize}px / 字距 ${FX.header.letterSpacing} / 左缩进 ${FX.header.paddingLeft}`, () => {
    expect(header).toContain(`height: ${FX.header.height}px`);
    expect(header).toContain(`font-size: ${FX.header.fontSize}px`);
    expect(header).toContain(`letter-spacing: .${String(FX.header.letterSpacing).split('.')[1]}px`);
    expect(header).toContain(`padding: 0 ${FX.header.paddingLeft}px`);
  });

  it(`组间空 ${FX.header.gapBeforeGroup}px；快捷键 ${FX.menu.hotkeyFontSize}px`, () => {
    expect(SIDEBAR_CSS).toContain(`margin-top: ${FX.header.gapBeforeGroup}px`);
    expect(block(SIDEBAR_CSS, '.kc-sb-menu li .kc-menu-key')).toContain(`font-size: ${FX.menu.hotkeyFontSize}px`);
  });
});

describe('趋势工具下拉：每一项都能落地成真实工具', () => {
  it('17 项的 toolKeyForLabel 都有 key，且 DRAW_TOOLS 里有这个工具（锚点数 > 0）', () => {
    const missing: string[] = [];
    for (const it of FX.groups.flatMap((g) => g.items)) {
      const key = toolKeyForLabel(it.label);
      if (!key) { missing.push(it.label + ' → (无 key)'); continue; }
      const def = DRAW_TOOLS.find((d) => d.key === key);
      if (!def || def.points <= 0) missing.push(it.label + ' → ' + key);
    }
    expect(missing).toEqual([]);
  });

  it('分叉线四个变体复用已有几何（pitchfork / schiff / schiff2 / innerfork），没有另起 key', () => {
    expect(toolKeyForLabel('分叉线')).toBe('pitchfork');
    expect(toolKeyForLabel('希夫干草叉')).toBe('schiff');
    expect(toolKeyForLabel('改良希夫干草叉')).toBe('schiff2');
    expect(toolKeyForLabel('内部分叉线')).toBe('innerfork');
    for (const k of ['pitchfork', 'schiff', 'schiff2', 'innerfork']) {
      expect(DRAW_TOOLS.find((d) => d.key === k)?.points).toBe(3);
    }
  });

  it('新加的三种线段组工具在表里、锚点数正确', () => {
    expect([...EXTRA_LINE_TYPES].sort()).toEqual(['disjoint', 'flat', 'regression']);
    expect(DRAW_TOOLS.find((d) => d.key === 'regression')?.points).toBe(2);
    expect(DRAW_TOOLS.find((d) => d.key === 'flat')?.points).toBe(2);
    expect(DRAW_TOOLS.find((d) => d.key === 'disjoint')?.points).toBe(2);
  });
});

describe('回归趋势的一元最小二乘', () => {
  it('完美直线：斜率 2、截距 1、σ=0', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => ({ i, v: 2 * i + 1 }));
    const r = linreg(pts);
    expect(r.m).toBeCloseTo(2, 10);
    expect(r.q).toBeCloseTo(1, 10);
    expect(r.sigma).toBeCloseTo(0, 10);
  });

  it('带噪声：斜率/截距仍贴住整体走势，σ 是残差量级', () => {
    // 残差与下标正交（+1 -1 -1 +1），斜率/截距不被噪声带偏
    const noise = [1, -1, -1, 1];
    const pts = noise.map((e, i) => ({ i, v: 2 * i + e }));
    const r = linreg(pts);
    expect(r.m).toBeCloseTo(2, 10);
    expect(r.q).toBeCloseTo(0, 10);
    expect(r.sigma).toBeCloseTo(1, 10);
  });

  it('空数组 / 单点不炸', () => {
    expect(linreg([])).toEqual({ m: 0, q: 0, sigma: 0 });
    expect(linreg([{ i: 3, v: 7 }]).sigma).toBe(0);
  });
});
