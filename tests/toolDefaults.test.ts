/* ===========================================================================
 * 「每种工具的默认属性」对齐 charting_library
 *
 * 官方这张表在参考库 webpack 模块 64548（`TradingView.defaultProperties`），
 * 由 scripts/sync-tv-tool-defaults.mjs 抽成 src/engine/tv-tool-defaults.json。
 * 这里只钉两件事：
 *   ① 快照本身没抄错（关键工具的色/线宽/线型逐条对上官方真值）
 *   ② styleForTool 真的用了它，而且显式 patch 仍然优先
 * ========================================================================= */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import TV_DEFAULTS from '../src/engine/tv-tool-defaults.json';
import {
  TV_TOOL_KEY, tvToolStyle, styleForTool,
  BRUSH_COLOR, BRUSH_WIDTH, HIGHLIGHT_COLOR, HIGHLIGHT_WIDTH,
} from '../src/engine/draw';

const TOOLS = (TV_DEFAULTS as unknown as {
  tools: Record<string, {
    color?: string; fillColor?: string; linewidth?: number; linestyle?: string;
    fillBackground?: boolean; fontSize?: number; medianColor?: string;
    nestedColor?: string; levels?: boolean; transparency?: number; smooth?: number;
  }>;
}).tools;

const REPO = path.resolve(__dirname, '..');

describe('官方线工具默认属性快照', () => {
  it('覆盖 85+ 个线工具，且引自 charting_library 的模块 64548', () => {
    expect(Object.keys(TOOLS).length).toBeGreaterThanOrEqual(85);
    expect((TV_DEFAULTS as any).source.module).toBe(64548);
    expect((TV_DEFAULTS as any).source.library).toMatch(/^charting_library\/bundles\/library\..*\.js$/);
  });

  it('线条类：趋势线/水平线 2px 蓝、实线（不是我们原来的 1.6px）', () => {
    expect(TOOLS.trendline).toMatchObject({ color: '#2962FF', linewidth: 2, linestyle: 'solid' });
    expect(TOOLS.horzline).toMatchObject({ color: '#2962FF', linewidth: 2, linestyle: 'solid' });
    expect(TOOLS.vertline).toMatchObject({ color: '#2962FF', linewidth: 2 });
    expect(TOOLS.ray).toMatchObject({ color: '#2962FF', linewidth: 2 });
  });

  it('形状类各有专属默认色：矩形紫、圆橙、椭圆红、三角绿、旋转矩形绿', () => {
    // color-grapes-purple-500 / tan-orange-500 / ripe-red-500 / minty-green-500 / iguana-green-500
    expect(TOOLS.rectangle.color).toBe('#9c27b0');
    expect(TOOLS.circle.color).toBe('#FF9800');
    expect(TOOLS.ellipse.color).toBe('#F23645');
    expect(TOOLS.triangle.color).toBe('#089981');
    expect(TOOLS.rotatedrectangle.color).toBe('#4caf50');
    expect(TOOLS.arc.color).toBe('#e91e63');
    // 形状的填充色 = generateColor(同色, 80) → 20% 透明
    expect(TOOLS.rectangle.fillColor).toBe('rgba(156,39,176,0.2)');
    expect(TOOLS.ellipse.fillColor).toBe('rgba(242,54,69,0.2)');
    expect(TOOLS.rectangle.fillBackground).toBe(true);
  });

  it('形态类：头肩/ABCD 绿、三驱/三角形态深蓝紫、箭头标记向上绿向下红', () => {
    expect(TOOLS.headandshoulders.color).toBe('#089981');
    expect(TOOLS.abcd.color).toBe('#089981');
    expect(TOOLS.threedrivers.color).toBe('#673ab7');
    expect(TOOLS.trianglepattern.color).toBe('#673ab7');
    expect(TOOLS.arrowmarkup.color).toBe('#089981');
    expect(TOOLS.arrowmarkdown.color).toBe('#CC2F3C');
  });

  it('斐波那契：默认灰色 + 虚线，且颜色是逐 level 给的（没有单一主色）', () => {
    expect(TOOLS.fibretracement.nestedColor).toBe('#787B86');
    expect(TOOLS.fibretracement.levels).toBe(true);
    expect(TOOLS.fibretracement.transparency).toBe(80);
    expect(TOOLS.fibchannel.levels).toBe(true);
  });

  it('音叉/江恩：主色在嵌套的 median 上（ripe-red-500）', () => {
    expect(TOOLS.pitchfork.medianColor).toBe('#F23645');
    expect(TOOLS.schiffpitchfork.medianColor).toBe('#F23645');
    expect(TOOLS.pitchfork.levels).toBe(true);
  });

  it('笔刷/荧光笔与上一轮实现的常量一致（同一份官方数据）', () => {
    expect(TOOLS.brush.color).toBe(BRUSH_COLOR);
    expect(TOOLS.brush.linewidth).toBe(BRUSH_WIDTH);
    expect(TOOLS.brush.smooth).toBe(5);
    expect(TOOLS.highlighter.color).toBe(HIGHLIGHT_COLOR);
    expect(TOOLS.highlighter.transparency).toBe(80);
  });
});

describe('styleForTool 接官方默认值', () => {
  it('映射表里的每个官方名都必须真实存在于快照（不许编名字）', () => {
    const missing = Object.entries(TV_TOOL_KEY).filter(([, name]) => !TOOLS[name]);
    expect(missing).toEqual([]);
  });

  it('矩形：紫 + 1px + 20% 紫底（原来一律 #2962ff / 1.6px / 14% 蓝）', () => {
    const s = styleForTool('rect');
    expect(s.color).toBe('#9c27b0');
    expect(s.width).toBe(1);
    expect(s.fill).toBe('rgba(156,39,176,0.2)');
  });

  it('趋势线：蓝 + 2px；圆：橙 + 20% 橙底；三角：绿', () => {
    expect(styleForTool('trend')).toMatchObject({ color: '#2962FF', width: 2 });
    expect(styleForTool('circle')).toMatchObject({ color: '#FF9800', fill: 'rgba(255,152,0,0.2)' });
    expect(styleForTool('triangle')).toMatchObject({ color: '#089981', fill: 'rgba(8,153,129,0.2)' });
  });

  it('斐波那契：取到灰线，但保持实线 —— 官方虚线只属于编辑期的基准线，各 level 本身是实线', () => {
    const s = styleForTool('fib');
    expect(s.color).toBe('#787B86');
    expect(s.dash).toEqual([]);
    // 快照里 fibretracement 没有顶层 linestyle（虚线在 trendline / levelsStyle 上，各自不同）
    expect(TOOLS.fibretracement.linestyle).toBeUndefined();
  });

  it('官方 fillBackground=false 的工具：填充是 transparent，不留淡蓝底', () => {
    expect(styleForTool('text').fill).toBe('transparent');
  });

  it('没有官方对应的工具（dot / curve / measure…）仍走 drawStyle 的蓝色默认', () => {
    expect(tvToolStyle('dot')).toBeNull();
    expect(styleForTool('dot').color).toBe('#2962ff');
  });

  it('显式 patch 永远优先（用户改过的颜色不被默认值盖掉）', () => {
    expect(styleForTool('rect', { color: '#ffffff', width: 4 }))
      .toMatchObject({ color: '#ffffff', width: 4 });
    // 只改颜色时，其余字段仍是官方默认
    expect(styleForTool('rect', { color: '#123456' }).width).toBe(1);
  });

  it('笔刷/荧光笔不受映射影响：荧光笔仍是 20px 的 20% 红', () => {
    const h = styleForTool('highlight');
    expect(h.color).toBe(HIGHLIGHT_COLOR);
    expect(h.width).toBe(HIGHLIGHT_WIDTH);
    expect(h.dash).toEqual([]);
  });
});

describe('快照与参考库逐字节同步', () => {
  const hasLib = ['/Users/kevin/Desktop/charting_library/charting_library/bundles', '/Users/kevin/Desktop/charting_library/bundles']
    .some((p) => fs.existsSync(path.join(p, 'library.63466897dbd7710a003a.js')) || fs.existsSync(p));

  it.runIf(hasLib)('node scripts/sync-tv-tool-defaults.mjs --check 通过', () => {
    const out = execFileSync(process.execPath, ['scripts/sync-tv-tool-defaults.mjs', '--check'], {
      cwd: REPO, encoding: 'utf8',
    });
    expect(out).toContain('一致');
  });
});
