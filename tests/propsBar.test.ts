/**
 * 浮动属性工具条 —— 与官方线上那条（docs/ref-tv-propsbar.png）逐项对齐。
 *
 * 截图是 2x 的：量出来的像素除以 2 就是 CSS 值。这里把这些数字钉死，
 * 免得以后「看着差不多」又改回手绘风格。
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  BAR_H, BTN, WIDTH_BTN, GRIP_W, BAR_ORDER, fmtPx, widthSampleH,
  ICON_GRIP, ICON_CLONE, ICON_PENCIL, ICON_DASH, ICON_SETTINGS,
  ICON_LOCK_OPEN, ICON_LOCK_CLOSED, ICON_TRASH, ICON_MORE,
} from '../src/workspace/dom/DrawPropsBar';

const SRC = readFileSync(new URL('../src/workspace/dom/DrawPropsBar.ts', import.meta.url), 'utf8');

/** 从 SVG 字符串里取 width / height / viewBox */
function box(svg: string): { w: number; h: number; vb: string } {
  const w = /width="([\d.]+)"/.exec(svg);
  const h = /height="([\d.]+)"/.exec(svg);
  const vb = /viewBox="([^"]+)"/.exec(svg);
  return { w: Number(w?.[1]), h: Number(h?.[1]), vb: vb?.[1] ?? '' };
}

describe('属性条：整体尺寸（官方实测）', () => {
  it('条高 38、普通按钮 38、线宽按钮 70、手柄 22', () => {
    expect(BAR_H).toBe(38);
    expect(BTN).toBe(38);
    expect(WIDTH_BTN).toBe(70);
    expect(GRIP_W).toBe(22);
  });

  it('CSS 里条高/圆角/内边距与常量一致', () => {
    expect(SRC).toContain('height: ${BAR_H}px');
    expect(SRC).toMatch(/border-radius: 8px/);
    expect(SRC).toMatch(/padding: 0 2px/);
  });

  it('按钮只有「线宽」那颗是 70 宽', () => {
    expect(SRC).toMatch(/\.kc-propsbar-btn \{ width: \$\{BTN\}px; \}/);
    expect(SRC).toMatch(/\.kc-propsbar-btn\.wide \{ width: \$\{WIDTH_BTN\}px; \}/);
    // 全文件只有 widthBtn 一处带 wide
    expect(SRC.match(/kc-propsbar-btn wide/g)?.length).toBe(1);
  });
});

describe('属性条：顺序与官方截图一致', () => {
  it('手柄 → 克隆 → 颜色 → 线宽 → 线型 → 设置 → 锁 → 垃圾桶 → 更多', () => {
    expect([...BAR_ORDER]).toEqual(['grip', 'clone', 'color', 'width', 'dash', 'settings', 'lock', 'trash', 'more']);
  });

  it('DOM 里按同一顺序挂上去（源码自上而下 = appendChild 次序）', () => {
    // 两种写法都要认：mkBtn(icon, title, 'item') 与 xxx.setAttribute('data-item', 'item')
    const hits: { line: number; item: string }[] = [];
    SRC.split('\n').forEach((ln, i) => {
      const a = /mkBtn\(ICON_\w+, '[^']+', '([a-z]+)'/.exec(ln);
      const b = /setAttribute\('data-item', '([a-z]+)'\)/.exec(ln);
      const hit = a?.[1] ?? b?.[1];
      if (hit && (BAR_ORDER as readonly string[]).includes(hit)) hits.push({ line: i, item: hit });
    });
    expect(hits.map((h) => h.item)).toEqual([...BAR_ORDER]);
  });
});

describe('属性条：每个图标的盒子尺寸（截图量出来的）', () => {
  it('手柄 8×12（2 列 × 3 行圆点）', () => {
    const b = box(ICON_GRIP);
    expect([b.w, b.h]).toEqual([8, 12]);
    // 6 个点，且不是矩形块
    expect(ICON_GRIP.match(/<circle/g)?.length).toBe(6);
    expect(ICON_GRIP).not.toContain('<rect');
  });

  it('克隆 16×16：三个方框 + 一个加号（右下那格是加号）', () => {
    const b = box(ICON_CLONE);
    expect([b.w, b.h]).toEqual([16, 16]);
    expect(ICON_CLONE.match(/<rect/g)?.length).toBe(3);
    expect(ICON_CLONE).toContain('M12.15 10.1v4.5');   // 加号的竖
    expect(ICON_CLONE).toContain('M9.9 12.35h4.5');    // 加号的横
  });

  it('铅笔 20×20（含笔帽分隔线）', () => {
    const b = box(ICON_PENCIL);
    expect([b.w, b.h]).toEqual([20, 20]);
    expect(ICON_PENCIL).toContain('stroke="currentColor"');
  });

  it('线型是一条贯穿的细线（20 长）', () => {
    const b = box(ICON_DASH);
    expect([b.w, b.h]).toEqual([20, 20]);
    expect(ICON_DASH).toContain('d="M0 10h20"');
    expect(ICON_DASH).toContain('stroke-linecap="round"');
  });

  it('设置是六边形 + 内圆，21×18', () => {
    const b = box(ICON_SETTINGS);
    expect([b.w, b.h]).toEqual([21, 18]);
    expect(ICON_SETTINGS).toContain('<circle');
    // 六边形：6 个顶点 = 6 段边（path 里混用了绝对/相对指令）
    const edges = ICON_SETTINGS.match(/[LlHhVv]/g) ?? [];
    expect(edges.length).toBeGreaterThanOrEqual(5);
    expect(ICON_SETTINGS).toContain('stroke-linejoin="round"');
  });

  it('锁 16×19，开/闭两套，锁孔是实心竖条', () => {
    for (const svg of [ICON_LOCK_OPEN, ICON_LOCK_CLOSED]) {
      const b = box(svg);
      expect([b.w, b.h]).toEqual([16, 19]);
      expect(svg).toContain('fill="currentColor"');   // 锁孔
      expect(svg).toContain('<rect');                 // 锁体
    }
    expect(ICON_LOCK_OPEN).not.toBe(ICON_LOCK_CLOSED);
  });

  it('垃圾桶 18×20：梯形桶身 + 顶盖 + 提手', () => {
    const b = box(ICON_TRASH);
    expect([b.w, b.h]).toEqual([18, 20]);
    expect(ICON_TRASH.match(/<path/g)?.length).toBe(3);
  });

  it('更多是三个空心圆（19×5，不是实心点）', () => {
    const b = box(ICON_MORE);
    expect([b.w, b.h]).toEqual([19, 5]);
    expect(ICON_MORE.match(/<circle/g)?.length).toBe(3);
    expect(ICON_MORE).toContain('stroke="currentColor"');
    expect(ICON_MORE).toContain('fill="none"');
    // 不能有实心填充的圆
    expect(ICON_MORE).not.toContain('fill="currentColor"');
  });
});

describe('属性条：铅笔下面那条彩虹', () => {
  it('是渐变（8 个色标），不是纯色块', () => {
    expect(SRC).toContain('linear-gradient(90deg');
    const stops = SRC.match(/#[0-9a-f]{6} \d+%/gi) ?? [];
    expect(stops.length).toBe(8);
  });

  it('色标两端是紫 → 红（按截图像素采样写的）', () => {
    expect(SRC).toMatch(/linear-gradient\(90deg, #8a09ff 0%/);
    expect(SRC).toMatch(/#ff4500 100%/);
  });

  it('尺寸 22×4、圆角 2', () => {
    expect(SRC).toMatch(/\.kc-propsbar-chip \{\s*width: 22px; height: 4px; border-radius: 2px/);
  });

  it('不再写死一条纯色（老实现是「取色条的底色」）', () => {
    expect(SRC).not.toContain('colorChipInner');
  });
});

describe('属性条：线宽那颗的线样', () => {
  it('线样高度代表当前线宽（1px 也给 2px 才看得见，最大 8）', () => {
    expect(widthSampleH(1)).toBe(2);
    expect(widthSampleH(2)).toBe(2);
    expect(widthSampleH(4)).toBe(4);
    expect(widthSampleH(8)).toBe(8);
    expect(widthSampleH(12)).toBe(8);
  });

  it('线样宽 18、文字 14px（官方量出来的字号）', () => {
    expect(SRC).toMatch(/\.kc-propsbar-wline \{ flex: 0 0 auto; width: 18px/);
    expect(SRC).toMatch(/\.kc-propsbar-wlabel \{ font-size: 14px/);
  });

  it('「Npx」文案与线样同步更新', () => {
    expect(SRC).toContain('widthLabel.textContent = fmtPx(c.d.style.width)');
    expect(SRC).toContain('widthBar.style.height = widthSampleH(c.d.style.width)');
    expect(fmtPx(2)).toBe('2px');
    expect(fmtPx(1.5)).toBe('1.5px');
  });
});

describe('属性条：颜色与逻辑', () => {
  it('手柄点色是官方那个浅灰 rgb(184,184,184)', () => {
    expect(SRC).toMatch(/GRIP_DOT = 'rgb\(184,184,184\)'/);
    expect(SRC).toMatch(/--kpb-grip: rgb\(184,184,184\)/);
    expect(SRC).toContain('color: var(--kpb-grip)');
  });

  it('图标描边色走 currentColor（深色主题跟 --text 走）', () => {
    for (const svg of [ICON_CLONE, ICON_PENCIL, ICON_DASH, ICON_SETTINGS, ICON_LOCK_OPEN, ICON_TRASH, ICON_MORE]) {
      expect(svg).toContain('currentColor');
    }
  });

  it('锁定时换闭合图标、标题变「解锁」、垃圾桶禁用', () => {
    expect(SRC).toContain("(c.d.locked ? ICON_LOCK_CLOSED : ICON_LOCK_OPEN)");
    expect(SRC).toContain("lockBtn.title = c.d.locked ? '解锁' : '锁定'");
    expect(SRC).toContain('trashBtn.disabled = c.d.locked');
  });

  it('sync 每帧都跑，锁/线宽只在值变了才动 DOM', () => {
    expect(SRC).toContain('if (lockPainted !== c.d.locked)');
    expect(SRC).toContain('if (widthPainted !== c.d.style.width)');
  });
});

/* ------------------------------------------------------------------ 深色主题 */

const TOKENS = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

/** 取出某个选择器块里的自定义属性 */
function varBlock(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(selector + ' {');
  if (at < 0) throw new Error('找不到选择器：' + selector);
  const body = css.slice(at + selector.length + 2, css.indexOf('}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** `rgb()` / `#rrggbb` → [r,g,b] */
function rgbOf(c: string): number[] {
  const t = c.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
  if (hex3) return [parseInt(hex3[1] + hex3[1], 16), parseInt(hex3[2] + hex3[2], 16), parseInt(hex3[3] + hex3[3], 16)];
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(t);
  if (!m) throw new Error('认不出的颜色：' + c);
  return [+m[1], +m[2], +m[3]];
}

const lum = (c: number[]): number => {
  const f = (v: number): number => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a: number[], b: number[]): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('属性条：深色主题（条挂 body 下，靠 :root 变量继承）', () => {
  const light = varBlock(SRC, ':root');
  const dark = varBlock(SRC, ":root[data-theme='dark']");
  const keys = (o: Record<string, string>): string[] => Object.keys(o).filter((k) => k.startsWith('--kpb-'));
  const tokensDark = varBlock(TOKENS, ":root[data-theme='dark']");

  it('浅色 / 深色两套 --kpb-* 同名同数量', () => {
    expect(keys(light).sort()).toEqual(keys(dark).sort());
    expect(keys(light).length).toBe(8);
  });

  it('深色指向 tokens（不是另写一批硬编码色）', () => {
    expect(dark['--kpb-bg']).toBe('var(--bg-sunken)');
    expect(dark['--kpb-ink']).toBe('var(--text)');
    expect(dark['--kpb-hover']).toBe('var(--bg-hover)');
    expect(dark['--kpb-on']).toBe('var(--accent-soft)');
  });

  it('深色底够暗、字够亮（不会出现白底浅字）', () => {
    const bg = rgbOf(tokensDark['--bg-sunken']);
    const ink = rgbOf(tokensDark['--text']);
    expect(Math.max(...bg)).toBeLessThan(48);
    expect(Math.min(...ink)).toBeGreaterThan(200);
  });

  it('正文对比度 ≥ 4.5:1（AA）', () => {
    const bg = rgbOf(tokensDark['--bg-sunken']);
    expect(contrast(rgbOf(tokensDark['--text']), bg)).toBeGreaterThanOrEqual(4.5);
    // 「Npx」也是正文，用同一个 --kpb-ink
    expect(SRC).toMatch(/\.kc-propsbar-wlabel \{[^}]*color: var\(--kpb-ink\)/);
  });

  it('浅色下仍是官方截图的白底黑字', () => {
    expect(rgbOf(light['--kpb-bg'])).toEqual([255, 255, 255]);
    expect(contrast(rgbOf(light['--kpb-ink']), [255, 255, 255])).toBeGreaterThan(15);
  });

  it('弹层与按钮 hover 也吃变量（深色下不会留白块）', () => {
    expect(SRC).toMatch(/\.kc-propsbar-pop \{[^}]*background: var\(--kpb-bg\)/);
    expect(SRC).toContain('.kc-propsbar-btn:hover .pill { background: var(--kpb-hover); }');
    expect(SRC).toContain('.kc-propsbar-rows button.sel { background: var(--kpb-on); }');
  });
});
