import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SECTIONS, MENU_SEP, itemIcon, mainButtonView, sidebarLabelForTool,
} from '../src/workspace/dom/sidebar';
import { CROSS, DOT, ARROW_CURSOR, HIGHLIGHTER, ERASER, HLINE_ICON } from '../src/workspace/dom/sidebar-icons';

/**
 * 左侧分组按钮的「组内当前工具」。
 *
 * 用户报的现象：在「光标」下拉里选了箭头，左边那颗按钮还是十字线，
 * 再点它画的也还是十字线 —— 官方的分组按钮是跟着当前工具换图标、也换点击行为的。
 *
 * 这里钉的是纯逻辑（node 环境没有 DOM）：图标怎么找、退回规则、
 * 以及真实 DOM 里那两条接线（pick 换图标 / 主按钮派发 activeOf）。
 */

const SRC = readFileSync(new URL('../src/workspace/dom/sidebar.ts', import.meta.url), 'utf8');

const cursor = SECTIONS[0].tools[0]; // 「十字线」= 光标工具组

describe('分组主按钮：图标与点击都跟随组内当前工具', () => {
  it('还没选过时就是组名 + 组图标（十字线）', () => {
    const v = mainButtonView(cursor);
    expect(v).toEqual({ label: '十字线', icon: CROSS, switched: false });
  });

  it('显式传组名也一样，不算「切换过」', () => {
    const v = mainButtonView(cursor, '十字线');
    expect(v.label).toBe('十字线');
    expect(v.icon).toBe(CROSS);
    expect(v.switched).toBe(false);
  });

  it('选了箭头 → 图标变成鼠标指针（不是画线的箭头）', () => {
    const v = mainButtonView(cursor, '箭头');
    expect(v.label).toBe('箭头');
    expect(v.icon).toBe(ARROW_CURSOR);
    expect(v.switched).toBe(true);
    expect(v.icon).not.toContain('stroke-linejoin'); // 画线箭头 ARROW_ICON 才带这句
  });

  it('圆点 / 荧光笔 / 橡皮擦各自换成自己的图标', () => {
    expect(mainButtonView(cursor, '圆点').icon).toBe(DOT);
    expect(mainButtonView(cursor, '荧光笔').icon).toBe(HIGHLIGHTER);
    expect(mainButtonView(cursor, '橡皮擦').icon).toBe(ERASER);
  });

  it('橡皮擦图标是官方的 29×31（比其他四个高 3px），主按钮要能居中', () => {
    expect(mainButtonView(cursor, '橡皮擦').icon).toContain('height="31"');
    expect(mainButtonView(cursor, '圆点').icon).toContain('height="28"');
  });

  it('认不出的 label 退回组名 + 组图标（不会把按钮换成空白）', () => {
    const v = mainButtonView(cursor, '根本没有这个工具');
    expect(v).toEqual({ label: '十字线', icon: CROSS, switched: false });
  });

  it('分隔线占位（MENU_SEP）不是可选的项，不能当图标用', () => {
    expect(itemIcon(cursor, MENU_SEP)).toBeNull();
    expect(mainButtonView(cursor, MENU_SEP).label).toBe('十字线');
  });

  it('别的组同样适用：趋势线组选「水平线」→ 换水平线图标', () => {
    const trend = SECTIONS[1].tools[0];
    const v = mainButtonView(trend, '水平线');
    expect(v.label).toBe('水平线');
    expect(v.icon).toBe(HLINE_ICON);
  });

  it('每个组里每个子项都能取到图标（分组子菜单也算）', () => {
    const missing: string[] = [];
    for (const sec of SECTIONS) {
      for (const t of sec.tools) {
        const labels = [
          ...(t.items ?? []).map((i) => i[0]),
          ...(t.groups ?? []).flatMap((g) => g.items.map((i) => i[0])),
        ];
        for (const label of labels) {
          if (label === MENU_SEP) continue;
          const icon = itemIcon(t, label);
          if (!icon || !icon.includes('<svg')) missing.push(t.label + ' → ' + label);
        }
      }
    }
    expect(missing, '这些子项没有可用图标：' + missing.join('、')).toEqual([]);
  });
});

describe('接线：pick 换图标 / 主按钮派发 activeOf', () => {
  it('pick 带 icon 时替换按钮内容并记住当前工具', () => {
    expect(SRC).toContain('btn.innerHTML = `<span class="pill"></span>${icon}`;');
    expect(SRC).toContain('activeOf.set(btn, label);');
    expect(SRC).toContain('btn.dataset.tool = label;');
  });

  it('菜单回调把该行的图标一起传出去', () => {
    expect(SRC).toContain('buildToolMenu(t, (label, icon) => {');
    expect(SRC).toContain('pick(btn, label, icon);');
  });

  it('主按钮点击派发的是组内当前工具，不是组名', () => {
    expect(SRC).toContain('pick(btn, activeOf.get(btn) ?? t.label);');
    expect(SRC).not.toContain('pick(btn, t.label);');
  });

  it('菜单打开时把当前工具那一行标成选中（否则重开就丢选中态）', () => {
    expect(SRC).toContain("menu.querySelectorAll<HTMLElement>('li[data-label]')");
    expect(SRC).toContain("li.classList.toggle('sel', li.dataset.label === active);");
    expect(SRC).toContain('li.dataset.label = label;');
  });

  it('图标在 pill 里居中（写死 left/top 会让 29×31 的橡皮擦偏 1px）', () => {
    expect(SRC).toMatch(/\.kc-sb-btn > svg \{[^}]*left: 50%;[^}]*top: 50%;[^}]*translate\(-50%, -50%\)/);
  });
});

describe('反向：工具 key → 侧栏那一行（画完回光标时把图标拨回去）', () => {
  it('cursor → 十字线（画完 / Esc 之后主按钮变回十字线）', () => {
    expect(sidebarLabelForTool('cursor')).toBe('十字线');
  });

  it('光标组四个工具都能反查到', () => {
    expect(sidebarLabelForTool('dot')).toBe('圆点');
    expect(sidebarLabelForTool('arrow')).toBe('箭头');
    expect(sidebarLabelForTool('highlight')).toBe('荧光笔');
    expect(sidebarLabelForTool('eraser')).toBe('橡皮擦');
  });

  it('别的组：趋势线 / 水平线 / 斐波那契', () => {
    expect(sidebarLabelForTool('trend')).toBe('趋势线');
    expect(sidebarLabelForTool('hline')).toBe('水平线');
    expect(sidebarLabelForTool('fib')).toBe('斐波那契回撤');
  });

  it('没有子菜单的单按钮也能反查（测量 / 图标）', () => {
    expect(sidebarLabelForTool('measure')).toBe('测量');
    expect(sidebarLabelForTool('emoji')).toBe('图标');
  });

  it('认不出的 key 返回 null（调用方就不动侧栏）', () => {
    expect(sidebarLabelForTool('根本没有这个工具')).toBeNull();
    expect(sidebarLabelForTool('')).toBeNull();
  });

  it('反查回来的 label 一定能换成图标，且换完仍是同一工具', () => {
    const keys = ['cursor', 'dot', 'arrow', 'highlight', 'eraser', 'trend', 'hline', 'fib'];
    for (const key of keys) {
      const label = sidebarLabelForTool(key);
      expect(label, key).toBeTruthy();
      const hit = SECTIONS.flatMap((s) => s.tools).some((t) => {
        const v = mainButtonView(t, label!);
        return v.switched || v.label === label;
      });
      expect(hit, key + ' → ' + label + ' 找不到按钮').toBe(true);
    }
  });
});
