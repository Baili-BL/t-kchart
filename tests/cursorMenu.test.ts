/**
 * 「十字线」下拉（光标工具组）与线上 TradingView 的对齐。
 *
 * 依据不是印象，是 tests/fixtures/tv-cursor-menu.json —— 2026-10-17 用 Playwright
 * 打开 cn.tradingview.com 的匿名图表，把左栏「光标」下拉里每一行的行内 <svg>
 * 和 getComputedStyle 度量直接抄下来。
 *
 * 这个文件钉三件事：
 *   ① 五个图标（十字线 / 圆点 / 箭头 / 荧光笔 / 橡皮擦）的 SVG 必须**逐字符**等于官方；
 *   ② 行 / 菜单 / 开关的度量（40 高、244 宽、14px 字、38×20 开关…）必须等于官方；
 *   ③ 选中行是官方的「深底白字」，不是浅灰底深字 —— 顺带保证对比度够。
 *
 * 为什么值得这么较真：这几个图标原来是按设计稿手绘的（圆点 r=3.6、箭头是一根斜线、
 * 荧光笔是一支笔、橡皮擦是描边的方块），尺寸也按 34 高 / 13px 字排的。
 * 看着「差不多」，摆到官方旁边就露馅 —— 手绘的那套形状压根不是同一批图。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_CSS } from '../src/workspace/dom/sidebar';
import {
  CROSS, DOT, ARROW_CURSOR, HIGHLIGHTER, ERASER,
} from '../src/workspace/dom/sidebar-icons';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

interface Fixture {
  menu: {
    width: number; padding: string; rowHeight: number; rowPadding: string;
    fontSize: number; lineHeight: number; iconBox: number; iconGap: number; iconLeftInRow: number;
  };
  selected: { background: string; color: string };
  hover: { background: string };
  divider: { lineColor: string; blockPadding: string; height: number };
  toggle: { rowHeight: number; fontSize: number; textLeftInRow: number };
  switch: {
    width: number; height: number; radius: number; thumb: number; thumbInset: number;
    onColor: string; offColor: string; thumbColor: string;
  };
  items: { key: string; label: string; svg: string }[];
}

const FX: Fixture = JSON.parse(read('./fixtures/tv-cursor-menu.json'));
const SIDEBAR_SRC = read('../src/workspace/dom/sidebar.ts');

/** 只抹平标签之间的空白（属性值里的空格不能动，viewBox 就是靠它） */
const norm = (svg: string): string => svg.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

/** 取一条规则的声明体 */
function block(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + '\\s*\\{([\\s\\S]*?)\\n\\}').exec(css);
  if (!m) throw new Error('找不到规则：' + selector);
  return m[1];
}
const vars = (src: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
};

/** 说明：全部取自 fixture，测试里不许出现「我自己觉得应该是」的数字 */
const KCS_LIGHT = vars(block(SIDEBAR_CSS, ':root'));
const KCS_DARK = vars(block(SIDEBAR_CSS, ":root[data-theme='dark']"));

describe('光标组图标：逐字符等于线上 SVG', () => {
  const ours: Record<string, string> = {
    cursor: CROSS, dot: DOT, arrow: ARROW_CURSOR, demonstration: HIGHLIGHTER, eraser: ERASER,
  };

  it('官方那一组正好是这 5 项（顺序也是官方的顺序）', () => {
    expect(FX.items.map((i) => i.key)).toEqual(['cursor', 'dot', 'arrow', 'demonstration', 'eraser']);
    expect(FX.items.map((i) => i.label)).toEqual(['十字线', '圆点', '箭头', '荧光笔', '橡皮擦']);
  });

  for (const item of FX.items) {
    it(`${item.label}（${item.key}）与官方 SVG 一致`, () => {
      const mine = ours[item.key];
      expect(mine, `缺 ${item.key} 图标`).toBeTruthy();
      expect(norm(mine)).toBe(norm(item.svg));
    });
  }

  it('图标尺寸是官方的 28×28，橡皮擦 29×31（不是统一 28）', () => {
    expect(DOT).toContain('viewBox="0 0 28 28"');
    expect(DOT).toContain('r="3"');                 // 官方 r=3，手绘那版是 3.6
    expect(ERASER).toContain('viewBox="0 0 29 31"');
    expect(ERASER).toContain('width="29" height="31"');
  });

  it('侧栏那个「箭头」接的是鼠标指针（ARROW_CURSOR），不是画线的箭头', () => {
    const src = SIDEBAR_SRC;
    const at = src.indexOf("['十字线', CROSS]");
    expect(at, '找不到光标组的 items').toBeGreaterThan(-1);
    // 从这一项到 toggle 之间就是这一组的 items（中间可能换行，所以整段拼起来看）
    const group = src.slice(at, src.indexOf('toggle:', at)).replace(/\s+/g, ' ');
    expect(group).toContain("['圆点', DOT]");
    expect(group).toContain("['箭头', ARROW_CURSOR]");
    expect(group).toContain("['荧光笔', HIGHLIGHTER]");
    expect(group).toContain("['橡皮擦', ERASER]");
    // 官方在「荧光笔」和「橡皮擦」之间有一条分隔线，这里用 MENU_SEP 占位
    expect(group).toContain('[MENU_SEP, \'\']');
    expect(group.indexOf('MENU_SEP')).toBeLessThan(group.indexOf("['橡皮擦'"));
  });
});

describe('下拉的行 / 菜单度量：等于官方实测值', () => {
  const menu = block(SIDEBAR_CSS, '.kc-sb-menu');
  const row = block(SIDEBAR_CSS, '.kc-sb-menu li');
  const toggle = block(SIDEBAR_CSS, '.kc-menu-toggle');
  const divider = block(SIDEBAR_CSS, '.kc-sb-menu .kc-menu-div');
  const sw = block(SIDEBAR_CSS, '.kc-menu-switch');
  const knob = block(SIDEBAR_CSS, '.kc-menu-switch::after');

  it(`菜单 244 宽 / ${FX.menu.padding} 内边距 / ${FX.menu.fontSize}px 字`, () => {
    expect(menu).toContain(`min-width: ${FX.menu.width}px`);
    expect(menu).toContain(`padding: ${FX.menu.padding}`);
    expect(menu).toContain(`font-size: ${FX.menu.fontSize}px`);
    expect(menu).toContain(`line-height: ${FX.menu.lineHeight}px`);
  });

  it(`行高 ${FX.menu.rowHeight} / 左右 ${FX.menu.iconLeftInRow}px / 图标与文字间距 ${FX.menu.iconGap} / 圆角 6`, () => {
    expect(row).toContain(`height: ${FX.menu.rowHeight}px`);
    expect(row).toContain(`padding: 0 ${FX.menu.iconLeftInRow}px`);
    expect(row).toContain(`gap: ${FX.menu.iconGap}px`);
    expect(row).toContain('border-radius: 6px');
  });

  it(`开关行 ${FX.toggle.rowHeight} 高（比普通行矮 8）`, () => {
    expect(toggle).toContain(`height: ${FX.toggle.rowHeight}px`);
    expect(toggle).toContain(`font-size: ${FX.toggle.fontSize}px`);
  });

  it(`分隔线：${FX.divider.height}px 线 + 上下 ${FX.divider.blockPadding}`, () => {
    expect(divider).toContain(`height: ${FX.divider.height}px`);
    expect(divider).toContain(`margin: ${FX.divider.blockPadding}`);
  });

  it(`开关 ${FX.switch.width}×${FX.switch.height}，旋钮 ${FX.switch.thumb}、内缩 ${FX.switch.thumbInset}`, () => {
    expect(sw).toContain(`width: ${FX.switch.width}px`);
    expect(sw).toContain(`height: ${FX.switch.height}px`);
    expect(sw).toContain(`border-radius: ${FX.switch.radius}px`);
    expect(knob).toContain(`width: ${FX.switch.thumb}px`);
    expect(knob).toContain(`height: ${FX.switch.thumb}px`);
    expect(knob).toContain(`top: ${FX.switch.thumbInset}px`);
    // 开：旋钮贴右（38 - 14 - 3 = 21）；关：贴左 3
    expect(knob).toContain(`left: ${FX.switch.width - FX.switch.thumb - FX.switch.thumbInset}px`);
    expect(SIDEBAR_CSS).toContain('.kc-menu-toggle.off .kc-menu-switch::after { left: 3px; }');
  });
});

describe('颜色：选中行是官方那套深底白字', () => {
  /** `#rgb` / `#rrggbb` / `rgb(r,g,b)` → 0..255×3 */
  const rgb = (c: string): number[] => {
    const hex6 = /^#([0-9a-f]{6})$/i.exec(c.trim());
    if (hex6) {
      const n = parseInt(hex6[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const hex3 = /^#([0-9a-f]{3})$/i.exec(c.trim());
    if (hex3) return [...hex3[1]].map((h) => parseInt(h + h, 16));
    const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(c.trim());
    if (!m) throw new Error('认不出的颜色：' + c);
    return [+m[1], +m[2], +m[3]];
  };
  const lum = (c: string): number => {
    const [r, g, b] = rgb(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('浅色：选中行底色 = 官方 rgb(46,46,46)，文字 = 白', () => {
    expect(rgb(KCS_LIGHT['--kcs-pop-sel'])).toEqual(rgb(FX.selected.background));
    expect(rgb(KCS_LIGHT['--kcs-sel-ink'])).toEqual(rgb(FX.selected.color));
  });

  it('选中行白字压在深底上，对比度够（≥ 7:1）', () => {
    const c = contrast(FX.selected.color, FX.selected.background);
    expect(c, `白字 / #2e2e2e = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(7);
  });

  it('悬停底色 = 官方 rgb(242,242,242)', () => {
    expect(rgb(KCS_LIGHT['--kcs-hover'])).toEqual(rgb(FX.hover.background));
  });

  it('分隔线色 = 官方 rgb(235,235,235)', () => {
    expect(rgb(KCS_LIGHT['--kcs-pop-div'])).toEqual(rgb(FX.divider.lineColor));
  });

  it('开关：开 #2e2e2e / 关 #9c9c9c / 旋钮白', () => {
    expect(rgb(KCS_LIGHT['--kcs-sw-on'])).toEqual(rgb(FX.switch.onColor));
    expect(rgb(KCS_LIGHT['--kcs-sw-off'])).toEqual(rgb(FX.switch.offColor));
    expect(rgb(KCS_LIGHT['--kcs-sw-knob'])).toEqual(rgb(FX.switch.thumbColor));
  });

  it('深色下这三个变量也都在（不然深色又回落到浅色值）', () => {
    for (const k of ['--kcs-pop-sel', '--kcs-sel-ink', '--kcs-sw-on', '--kcs-sw-off', '--kcs-pop-div']) {
      expect(KCS_DARK[k], `深色缺 ${k}`).toBeTruthy();
    }
  });

  it('选中行与开关行都用了圆角（官方的行是 232×40 圆角块，不是通栏）', () => {
    expect(SIDEBAR_CSS).toContain('.kc-sb-menu li.sel { background: var(--kcs-pop-sel); color: var(--kcs-sel-ink); }');
    expect(block(SIDEBAR_CSS, '.kc-menu-toggle')).toContain('border-radius: 6px');
  });
});
