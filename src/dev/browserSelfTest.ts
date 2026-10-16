/**
 * 浏览器侧自检（需要 canvas）。原来挂在 index.html 的「自检」按钮上，现在在控制台 / E2E 里调用：
 *
 *   await __app.runBrowserSelfTests()   // { chart: {pass, fail}, grid: {pass, fail} }
 *
 * 基线（改造前）：图表 48 + 网格 6 = 54；权益图 35（纯计算 24 + canvas 11）；统计 46（纯计算 30 + canvas 16）。
 * 用一个脱离页面布局的隐藏容器 + 引擎默认演示数据，不碰当前正在用的图表。
 */
import { selfTest } from '../engine/chart';
import { ChartGrid, gridSelfTest } from '../engine/grid';
import { equitySelfTest } from '../engine/equity';
import { analyticsSelfTest } from '../engine/analytics';
import { studySelfTest } from '../indicators/studyTest';

export interface BrowserSelfTestResult {
  chart: { pass: number; fail: number };
  grid: { pass: number; fail: number };
  equity: { pass: number; fail: number };
  analytics: { pass: number; fail: number };
  study: { pass: number; fail: number };
}

export function runBrowserSelfTests(): BrowserSelfTestResult {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1000px;height:640px;';
  document.body.appendChild(host);
  const grid = new ChartGrid(host, { rows: 2, cols: 2, theme: 'dark' });
  try {
    const c = selfTest(grid.charts()[0]);
    const g = gridSelfTest(grid);
    const e = equitySelfTest();
    const a = analyticsSelfTest();
    const sy = studySelfTest(grid.charts()[1]);
    return {
      chart: { pass: c.pass, fail: c.fail },
      grid: { pass: g.pass, fail: g.fail },
      equity: { pass: e.pass, fail: e.fail },
      analytics: { pass: a.pass, fail: a.fail },
      study: { pass: sy.pass, fail: sy.fail },
    };
  } finally {
    grid.dispose();
    host.remove();
  }
}
