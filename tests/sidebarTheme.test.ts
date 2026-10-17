/**
 * 侧栏深色主题：不是「看着还行」，而是把色板本身钉住。
 *
 * 背景：左栏原本是写死的浅色稿，深色主题靠 app.css 里给 `.kc-sidebar` 整体
 * `filter: invert(.9) hue-rotate(180deg)` 硬翻。但子菜单和 emoji 面板都挂在
 * <body> 下（fixed 定位，不然被 sidebar 的 overflow 裁掉），不在 filter 作用域里
 * —— 深色下弹出的是「白卡 + #e8ecf1 浅灰字」，字几乎看不见。
 *
 * 这个文件检查四件事：
 *   ① 浅 / 深两套 `--kcs-*` 变量必须**同名同数量**（少一个就意味着某个元素
 *      在深色下还留着浅色值）；
 *   ② 样式里用到的每个 `--kcs-*` 都真的有定义，深色值能顺着 tokens.css 解析到底；
 *   ③ 弹层（子菜单 / 面板）的文字与底色对比度够（WCAG AA：正文 ≥ 4.5，次要文字 ≥ 3）——
 *      这条直接挡「白卡浅灰字」这类事故；
 *   ④ 浅色设计稿的原始色值没被顺手改掉，也不再有人把整栏塞回 filter 里。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_CSS } from '../src/workspace/dom/sidebar';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** 取一条规则的声明体（`selector {` 到独占一行的 `}`） */
function block(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + '\\s*\\{([\\s\\S]*?)\\n\\}').exec(css);
  if (!m) throw new Error('找不到规则：' + selector);
  return m[1];
}

/** 规则体里的 `--x: y;` 声明 */
function vars(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** `#rgb` / `#rrggbb` / `rgb(r,g,b)` → [0..255]×3 */
function rgb(color: string): [number, number, number] {
  const c = color.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16)) as [number, number, number];
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  throw new Error('认不出的颜色：' + color);
}

/** WCAG 相对亮度 */
function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 顺着 var() 链解析到具体颜色；scopes 按优先级从内到外 */
function resolve(value: string, scopes: Record<string, string>[]): string {
  let v = value.trim();
  for (let i = 0; i < 8; i++) {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (!m) return v;
    const hit = scopes.find((s) => s[m[1]]);
    if (!hit) throw new Error(`未定义的变量：${m[1]}（值 ${value}）`);
    v = hit[m[1]];
  }
  throw new Error('var() 链太深：' + value);
}

const TOK = read('../src/styles/tokens.css');
const TOK_LIGHT = vars(block(TOK, ':root'));
const TOK_DARK = vars(block(TOK, ":root[data-theme='dark']"));

const KCS_LIGHT = vars(block(SIDEBAR_CSS, ':root'));
const KCS_DARK = vars(block(SIDEBAR_CSS, ":root[data-theme='dark']"));

/** 深色下某个 --kcs-* 最终落到的颜色 */
const dark = (name: string): string => resolve(KCS_DARK[name], [KCS_DARK, TOK_DARK, TOK_LIGHT]);
/** 浅色下某个 --kcs-* 最终落到的颜色 */
const light = (name: string): string => resolve(KCS_LIGHT[name], [KCS_LIGHT, TOK_LIGHT]);

describe('侧栏色板：浅 / 深两套必须对齐', () => {
  it('两套变量同名同数量（少一个 = 某个元素深色下还是浅色）', () => {
    expect(Object.keys(KCS_DARK).sort()).toEqual(Object.keys(KCS_LIGHT).sort());
    expect(Object.keys(KCS_LIGHT).length).toBeGreaterThanOrEqual(15);
  });

  it('样式里用到的每个 --kcs-* 都有定义，深色值能解析到具体颜色', () => {
    const used = new Set([...SIDEBAR_CSS.matchAll(/var\((--kcs-[\w-]+)\)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(10);
    for (const name of used) {
      expect(KCS_LIGHT[name], `浅色缺 ${name}`).toBeTruthy();
      expect(KCS_DARK[name], `深色缺 ${name}`).toBeTruthy();
      expect(() => resolve(KCS_DARK[name], [KCS_DARK, TOK_DARK, TOK_LIGHT])).not.toThrow();
    }
  });

  it('浅色仍是设计稿那套值（rgb(235,235,235) 轨道 / 白卡片 / 墨色图标）', () => {
    expect(light('--kcs-base')).toBe('rgb(235,235,235)');
    expect(KCS_LIGHT['--kcs-card'].replace('#fff', '#ffffff')).toBe('#ffffff');
    expect(light('--kcs-ink')).toBe('rgb(15,15,15)');
    expect(light('--kcs-pop-bg')).toBe('#fff');
  });

  it('深色不再是浅色：轨道 / 卡片 / 文字都换了值', () => {
    const base = rgb(dark('--kcs-base'));
    const card = rgb(dark('--kcs-card'));
    const ink = rgb(dark('--kcs-ink'));
    expect(Math.max(...base)).toBeLessThan(40);      // 深色底
    expect(Math.max(...card)).toBeLessThan(40);
    expect(Math.min(...ink)).toBeGreaterThan(200);   // 浅色字
    expect(rgb(light('--kcs-base'))).not.toEqual(base);
  });
});

describe('弹层（子菜单 / emoji 面板）在深色下读得清', () => {
  const pairs: Array<[string, string, number, string]> = [
    ['--kcs-ink', '--kcs-pop-bg', 7, '深色：菜单正文 / 面板文字（AA 4.5，这里要求更高）'],
    ['--kcs-ink', '--kcs-base', 7, '深色：侧栏图标压在轨道底上'],
    ['--kcs-ink', '--kcs-hover', 7, '深色：悬停 / 选中行上的文字'],
    ['--kcs-muted', '--kcs-pop-bg', 3, '深色：分组标题、快捷键（次要文字）'],
    ['--kcs-sw-knob', '--kcs-sw-on', 3, '深色：开关旋钮与轨道'],
  ];
  for (const [fg, bg, min, label] of pairs) {
    it(`${label} ≥ ${min}:1`, () => {
      const c = contrast(dark(fg), dark(bg));
      expect(c, `${fg} on ${bg} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    });
  }

  it('浅色下同样是这套对比度（没在修深色时把浅色改坏）', () => {
    expect(contrast(light('--kcs-ink'), light('--kcs-pop-bg'))).toBeGreaterThanOrEqual(7);
    expect(contrast(light('--kcs-muted'), light('--kcs-pop-bg'))).toBeGreaterThanOrEqual(3);
  });

  it('子菜单与 emoji 面板都改吃变量（不再写死 #fff / rgb(15,15,15)）', () => {
    const menu = block(SIDEBAR_CSS, '.kc-sb-menu');
    expect(menu).toContain('background: var(--kcs-pop-bg)');
    expect(menu).toContain('color: var(--kcs-ink)');
    expect(menu).toContain('box-shadow: var(--kcs-pop-shadow)');
    expect(SIDEBAR_CSS).toContain(":root[data-theme='dark'] .kc-emoji-panel");
    expect(SIDEBAR_CSS).toContain(":root[data-theme='dark'] .kc-emoji-group");
  });

  it('不再靠 filter 反相整栏（反相声明的子菜单 / 面板不在其作用域内）', () => {
    const app = read('../src/styles/app.css');
    expect(/\.kc-sidebar[^{]*\{[^}]*filter:\s*invert/.test(app)).toBe(false);
  });
});
