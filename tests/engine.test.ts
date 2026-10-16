/**
 * 引擎自检（纯 Node，不需要浏览器）。
 * 原来的 run-tests.js 是在 vm 里拼接 .js 跑的；现在引擎是 ESM 模块，直接 import。
 *
 * 基线（改造前）：绘图 39 + Pine 49 + 权益 24 + 统计 30 = 142 PASS / 0 FAIL
 * 任何改动之后这套数字只增不减。
 */
import { describe, expect, it } from 'vitest';
import { drawSelfTest } from '../src/engine/draw';
import { pineSelfTest } from '../src/engine/pine';
import { equitySelfTest } from '../src/engine/equity';
import { analyticsSelfTest } from '../src/engine/analytics';

interface SelfTestResult {
  pass: number;
  fail: number;
  names: string[];
}

function failures(r: SelfTestResult): string[] {
  return r.names.filter((n) => n.indexOf('FAIL') === 0);
}

describe('引擎自检', () => {
  it('绘图层 ≥ 39 条且全部通过', () => {
    const r = drawSelfTest() as SelfTestResult;
    expect(failures(r)).toEqual([]);
    expect(r.fail).toBe(0);
    expect(r.pass).toBeGreaterThanOrEqual(39);
  });

  it('Pine 引擎 ≥ 49 条且全部通过', () => {
    const r = pineSelfTest() as SelfTestResult;
    expect(failures(r)).toEqual([]);
    expect(r.fail).toBe(0);
    expect(r.pass).toBeGreaterThanOrEqual(49);
  });

  it('权益曲线（纯计算部分）≥ 24 条且全部通过', () => {
    const r = equitySelfTest() as SelfTestResult;
    expect(failures(r)).toEqual([]);
    expect(r.fail).toBe(0);
    expect(r.pass).toBeGreaterThanOrEqual(24);
  });

  it('统计组件（纯计算部分）≥ 30 条且全部通过', () => {
    const r = analyticsSelfTest() as SelfTestResult;
    expect(failures(r)).toEqual([]);
    expect(r.fail).toBe(0);
    expect(r.pass).toBeGreaterThanOrEqual(30);
  });
});
