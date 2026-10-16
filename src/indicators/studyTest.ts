/**
 * 指标（study）的浏览器侧自检：副图布局 / 叠加 / 出错隔离 / 像素 / 指针分流 / 回放 / 实时 tick。
 * 需要 canvas（要读像素、派发指针事件），所以放在浏览器自检里跑，不进 vitest。
 */
import type { KChart } from '../engine/chart';
import { log } from '../engine/chart';
import type { StudyDef } from '../engine/studies';
import { indicatorById, makeStudyDef } from './index';

export interface StudyTestResult {
  pass: number;
  fail: number;
  names: string[];
}

export function studySelfTest(chart: KChart): StudyTestResult {
  let pass = 0;
  let fail = 0;
  const names: string[] = [];
  const t = (name: string, ok: boolean, extra: string = ''): void => {
    names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
    if (ok) pass++; else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };
  const def = (id: string, inputs: { [k: string]: any } = {}): StudyDef => makeStudyDef(indicatorById(id)!, inputs);
  const custom = (name: string, body: string, overlay: boolean): StudyDef => ({
    uid: 'x#' + name, name, source: `//@version=6\nindicator("${name}", overlay=${overlay})\n${body}\n`, inputs: {},
  });

  chart.setStudies([]);
  chart.drawNow();
  const base = { h: chart.plot.h, b: chart.plot.b, H: chart.H, axis: chart.opts().axisHeight };
  t('没有指标时没有副图，主图一直铺到时间轴', chart.paneRects().length === 0 && Math.abs(base.b - (base.H - base.axis)) < 0.5, JSON.stringify(base));

  // ---- 副图布局
  chart.setStudies([def('rsi')]);
  chart.drawNow();
  const p1 = chart.paneRects();
  t('加 RSI → 1 个副图，贴着主图下沿', p1.length === 1 && Math.abs(p1[0].rect.t - chart.plot.b) < 0.5);
  t('副图下沿 = 时间轴上沿', Math.abs(p1[0].rect.b - (chart.H - chart.opts().axisHeight)) < 0.5);
  t('主图被副图挤矮了', chart.plot.h < base.h - 20, chart.plot.h + ' < ' + base.h);

  chart.setStudies([def('rsi'), def('macd'), def('stoch'), def('cci'), def('adx')]);
  chart.drawNow();
  const p5 = chart.paneRects();
  const total = p5.reduce((s, p) => s + p.rect.h, 0);
  const avail = chart.H - chart.opts().axisHeight - 6;
  t('5 个副图：依次首尾相接', p5.length === 5 && p5.every((p, i) => i === 0 || Math.abs(p.rect.t - p5[i - 1].rect.b) < 0.5));
  t('副图总高度 ≤ 可用高度的 60%（主图至少留 40%）', total <= avail * 0.6 + 1 && chart.plot.h >= avail * 0.4 - 6, `total=${total} avail=${avail} main=${chart.plot.h}`);

  chart.setStudies([]);
  chart.drawNow();
  t('指标全删后主图高度完全恢复', Math.abs(chart.plot.h - base.h) < 0.5, chart.plot.h + ' vs ' + base.h);

  // ---- 叠加指标：画在主图，参与自动量程
  chart.setStudies([custom('far', 'plot(close * 10, "far")', true)]);
  chart.drawNow();
  const lastClose = chart.bars[chart.bars.length - 1].close;
  t('overlay 指标不占副图', chart.paneRects().length === 0);
  t('overlay 指标参与主图自动量程（把量程撑到 10× 收盘价附近）', chart.scale.max >= lastClose * 10 * 0.9, `max=${chart.scale.max.toFixed(1)}`);

  // ---- 出错隔离
  chart.setStudies([def('rsi'), custom('bad', 'plot(nosuchfn(close))', false), def('ema')]);
  chart.drawNow();
  const st = chart.studyList();
  t('坏脚本：error 说明原因，output 为空', st[1].output === null && /nosuchfn/.test(st[1].error || ''), String(st[1].error));
  t('坏脚本不影响其它指标', !!st[0].output && !!st[2].output && st[0].error === null && st[2].error === null);
  t('坏脚本不占副图（只剩 RSI 一个）', chart.paneRects().length === 1);

  // ---- 像素：副图里确实画了东西，而且是指标的颜色
  chart.setStudies([custom('hist', 'plot(close - open, "d", style=plot.style_histogram, color=#ff0000)', false)]);
  chart.drawNow();
  const pr = chart.paneRects()[0].rect;
  const dpr = chart.dpr;
  const img = chart.ctx.getImageData(Math.round(pr.l * dpr), Math.round((pr.t + 2) * dpr), Math.round(pr.w * dpr), Math.round((pr.h - 4) * dpr));
  let red = 0;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] > 200 && img.data[i + 1] < 40 && img.data[i + 2] < 40) red++;
  t('副图里画出了红色柱（color=#ff0000 生效）', red > 30, 'red px=' + red);

  // ---- 指针分流：副图里的点击不交给绘图层；按钮可点
  let downs = 0;
  chart.setHooks({ onDown: () => { downs++; return false; }, onMove: () => undefined, onUp: () => undefined, onDraw: () => undefined });
  const rect = chart.canvas.getBoundingClientRect();
  const fire = (type: string, x: number, y: number): void => {
    chart.canvas.dispatchEvent(new PointerEvent(type, { clientX: rect.left + x, clientY: rect.top + y, pointerId: 1, bubbles: true }));
  };
  fire('pointerdown', 100, chart.plot.t + 40);
  fire('pointerup', 100, chart.plot.t + 40);
  const mainDowns = downs;
  fire('pointerdown', 100, pr.t + pr.h / 2);
  fire('pointerup', 100, pr.t + pr.h / 2);
  t('主图点击交给绘图层，副图点击不交', mainDowns === 1 && downs === 1, `main=${mainDowns} total=${downs}`);
  chart.setHooks(null);

  const actions: string[] = [];
  chart.setStudyHandler((uid, action) => void actions.push(uid + ':' + action));
  fire('pointermove', 120, pr.t + pr.h / 2);
  chart.drawNow();
  const hits = (chart as unknown as { studyHits: { uid: string; action: string; x: number; y: number; w: number; h: number }[] }).studyHits;
  t('悬停副图 → 出现 ⚙ ✕ 两个按钮', hits.length === 2 && hits.map((h) => h.action).join() === 'settings,remove', JSON.stringify(hits.map((h) => h.action)));
  const rm = hits.find((h) => h.action === 'remove');
  if (rm) { fire('pointerdown', rm.x + 8, rm.y + 8); fire('pointerup', rm.x + 8, rm.y + 8); }
  t('点 ✕ → 回调 (uid, "remove")，且不会被当成拖拽', actions.join() === 'x#hist:remove', actions.join());
  chart.setStudyHandler(null);

  // ---- 回放 / 实时 tick：指标始终按当前 bars 重算
  chart.setStudies([def('sma')]);
  const full = chart.bars.length;
  const len0 = chart.studyList()[0].output!.plots[0].values.length;
  chart.setReplayCount(120);
  const cutVals = chart.studyList()[0].output!.plots[0].values;
  chart.setReplayCount(null);
  const backVals = chart.studyList()[0].output!.plots[0].values;
  t('回放截断到 120：指标长度 = 120；退出后恢复全长', len0 === full && cutVals.length === 120 && backVals.length === full, `${len0}/${cutVals.length}/${backVals.length}`);
  t('回放中的值与全量前 120 根逐根相同（不泄露未来）', cutVals.every((v, i) => v === backVals[i]));
  const last = chart.bars[chart.bars.length - 1];
  chart.update({ ...last, time: last.time + 86400000, close: last.close + 1, high: last.high + 1, open: last.close });
  t('实时追加一根 → 指标多一个点', chart.studyList()[0].output!.plots[0].values.length === full + 1);

  chart.setStudies([]);
  chart.drawNow();
  log('指标自检：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail, names };
}
