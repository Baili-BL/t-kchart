import { describe, expect, it } from 'vitest';
import { replaySelfTest, ReplayController } from '../src/engine/replay';
import { PineEngine, pineTestBars } from '../src/engine/pine';
import { simulateMaCross } from '../src/engine/equity';

describe('Bar Replay', () => {
  it('状态机自检 ≥ 25 条且全部通过', () => {
    const r = replaySelfTest();
    expect(r.names.filter((n) => n.startsWith('FAIL'))).toEqual([]);
    expect(r.fail).toBe(0);
    expect(r.pass).toBeGreaterThanOrEqual(25);
  });

  it('Pine 指标是因果的：喂前 k 根的结果 == 喂全部后取前 k 根（回放不泄露未来）', () => {
    const closes: number[] = [];
    for (let i = 0; i < 150; i++) closes.push(100 + 10 * Math.sin(i / 6) + 4 * Math.cos(i / 2.3) + i * 0.05);
    const bars = pineTestBars(closes);
    const code =
      'indicator("t")\nplot(ta.sma(close, 7))\nplot(ta.ema(close, 9))\nplot(ta.rsi(close, 14))\nplot(ta.atr(14))\n' +
      'plot(ta.highest(high, 5))\nplot(ta.crossover(close, ta.sma(close, 10)) ? 1 : 0)';
    const full = new PineEngine(code, bars).run();
    for (const k of [20, 60, 99, 150]) {
      const part = new PineEngine(code, bars.slice(0, k)).run();
      for (let p = 0; p < full.plots.length; p++) {
        expect(part.plots[p].values).toEqual(full.plots[p].values.slice(0, k));
      }
    }
  });

  it('回测也是因果的：只喂前 k 根，权益曲线 == 全量曲线的前 k 个点', () => {
    const closes: number[] = [];
    for (let i = 0; i < 200; i++) closes.push(100 + 12 * Math.sin(i / 7) + 6 * Math.sin(i / 3.1) + i * 0.03);
    const bars = pineTestBars(closes);
    const full = simulateMaCross(bars, 5, 20, 100000);
    for (const k of [40, 90, 150]) {
      const part = simulateMaCross(bars.slice(0, k), 5, 20, 100000);
      expect(part.points.map((p) => p.equity)).toEqual(full.points.slice(0, k).map((p) => p.equity));
    }
  });

  it('播放驱动：用 100ms 一次的 tick 走 3 秒，与速度精确对应', () => {
    const c = new ReplayController(1000);
    c.start(0);
    c.setSpeed(10);
    c.play();
    for (let i = 0; i < 30; i++) c.tick(100);
    expect(c.state().index).toBe(30);
  });
});
