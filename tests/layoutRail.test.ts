/**
 * 布局契约：左栏（绘图工具栏）直接穿到底。
 *
 * 用户口径：`左侧栏直接穿到底` —— 底部那条范围条只占左栏右边那一块，
 * 不允许从绘图工具栏下面横过去（以前的 .ws-middle 就是这种「被截断」的结构）。
 *
 * 这里没有 jsdom / testing-library，就直接把两个源文件当文本读，
 * 钉住「谁包着谁」和「谁有高度」这两件事。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tsx = readFileSync(resolve(__dirname, '../src/workspace/ChartWorkspace.tsx'), 'utf8');
const css = readFileSync(resolve(__dirname, '../src/styles/app.css'), 'utf8');
const sidebar = readFileSync(resolve(__dirname, '../src/workspace/dom/sidebar.ts'), 'utf8');

/** 取一条 CSS 规则的声明块（'null' 表示没这条规则） */
function rule(selector: string): string | null {
  const i = css.indexOf(selector + ' {');
  if (i < 0) return null;
  const j = css.indexOf('}', i);
  return css.slice(i, j + 1);
}

describe('布局：左栏穿到底', () => {
  it('DOM：左栏与右列是兄弟，右列里才是「图表 + 范围条」', () => {
    expect(/<div className="ws-body">/.test(tsx)).toBe(true);
    expect(/<div className="ws-body">[\s\S]*<DrawToolbar \/>[\s\S]*<div className="ws-stack">/.test(tsx)).toBe(true);
  });

  it('DOM：范围条在右列里（.ws-stack），不是整页最后一行', () => {
    const stack = tsx.indexOf('className="ws-stack"');
    const bar = tsx.indexOf('<RangeBar />');
    const gridEnd = tsx.indexOf('</div>', tsx.indexOf('<ReplayBar />'));
    expect(stack).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(stack);      // 在 ws-stack 之后开始
    expect(gridEnd).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(gridEnd);    // 在图表块闭合之后 —— 也就是右列的第二行
  });

  it('DOM：老的截断容器 .ws-middle 已经删干净（不留死结构）', () => {
    expect(tsx.includes('ws-middle')).toBe(false);
    expect(css.includes('.ws-middle')).toBe(false);
  });

  it('CSS：.ws-body 撑满剩余高度，左栏才能一穿到底', () => {
    const r = rule('.ws-body');
    expect(r).toBeTruthy();
    expect(r).toMatch(/flex:\s*1/);
    expect(r).toMatch(/min-height:\s*0/);   // 不加这两条，flex 列里会溢出/塌陷
    expect(r).toMatch(/display:\s*flex/);
    // 不能把子项顶部对齐，否则左栏会「按内容高度」而不是撑满
    expect(r).not.toMatch(/align-items:\s*flex-start/);
  });

  it('CSS：.ws-stack 是纵向的「图表 + 范围条」，并且允许收缩', () => {
    const r = rule('.ws-stack');
    expect(r).toBeTruthy();
    expect(r).toMatch(/flex-direction:\s*column/);
    expect(r).toMatch(/min-height:\s*0/);
    expect(r).toMatch(/min-width:\s*0/);
    expect(r).toMatch(/flex:\s*1/);
  });

  it('CSS：.ws-grid 在纵向容器里也要能收缩（否则画布把范围条挤出去）', () => {
    const r = rule('.ws-grid');
    expect(r).toBeTruthy();
    expect(r).toMatch(/flex:\s*1/);
    expect(r).toMatch(/min-height:\s*0/);
  });

  it('CSS：左栏宽度仍是 52 + 1px 右边线，那条线现在会一直画到窗口底部', () => {
    const r = rule('.draw-toolbar');
    expect(r).toBeTruthy();
    expect(r).toMatch(/flex:\s*0 0 52px/);
    expect(r).toMatch(/border-right:\s*1px solid/);
    // 左栏自己不能定高（定高就穿不到底）
    expect(r).not.toMatch(/(^|;)\s*height:/);
  });

  it('CSS：范围条还是 32 高的固定行，且带一条上边线与图表分开', () => {
    const r = rule('.rangebar');
    expect(r).toBeTruthy();
    expect(r).toMatch(/flex:\s*0 0 32px/);
    expect(r).toMatch(/border-top:\s*1px solid/);
  });

  it('CSS：范围按钮 13px（改成中文后 12px 的汉字偏小；官方那一行是 14px，本应用基准 13px）', () => {
    const r = rule('.range-btn');
    expect(r).toBeTruthy();
    expect(r).toMatch(/font-size:\s*13px/);
    // 24 高的按钮塞得下 13px 汉字
    expect(r).toMatch(/height:\s*24px/);
  });

  it('左栏底色与页面同色（工具排完之后的空白段不能再露一条灰带）', () => {
    const i = sidebar.indexOf('.kc-sidebar {');
    expect(i).toBeGreaterThan(-1);
    const block = sidebar.slice(i, sidebar.indexOf('}', i));
    expect(block).toMatch(/background:\s*var\(--kcs-card\)/);
    expect(block).not.toMatch(/background:\s*var\(--kcs-base\)/);
    // 分隔线色单独走 --kcs-rule，别再用轨道底色
    const d = sidebar.indexOf('.kc-sb-div {');
    const dblock = sidebar.slice(d, sidebar.indexOf('}', d));
    expect(dblock).toMatch(/background:\s*var\(--kcs-rule\)/);
  });

  it('最后一段后面不再补分隔线（那条线下面是空的，穿到底后是悬空灰线）', () => {
    expect(sidebar).toMatch(/if \(si < SECTIONS\.length - 1\) root\.appendChild\(el\('div', 'kc-sb-div'\)\)/);
  });
});
