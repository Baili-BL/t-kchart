/**
 * 指标（study）的浏览器侧自检：副图布局 / 叠加 / 出错隔离 / 像素 / 指针分流 / 回放 / 实时 tick。
 * 需要 canvas（要读像素、派发指针事件），所以放在浏览器自检里跑，不进 vitest。
 */
import type { KChart } from '../engine/chart';
import { log } from '../engine/chart';
import type { StudyDef } from '../engine/studies';
import { paneScale, paneTicks } from '../engine/studies';
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
  t('悬停副图 → ⚙ ✕ □ ▼ 四个按钮（2.6 窗格控制）',
    hits.length === 4 && hits.map((h) => h.action).join() === 'settings,remove,max,collapse', JSON.stringify(hits.map((h) => h.action)));
  const rm = hits.find((h) => h.action === 'remove');
  if (rm) { fire('pointerdown', rm.x + 8, rm.y + 8); fire('pointerup', rm.x + 8, rm.y + 8); }
  t('点 ✕ → 回调 (uid, "remove")，且不会被当成拖拽', actions.join() === 'x#hist:remove', actions.join());
  chart.setStudyHandler(null);

  // ---- 2.6 副图窗格：拖分隔条改高 / 最大化 / 折叠 / 各自坐标轴
  chart.setStudies([def('rsi'), def('macd')]);
  chart.drawNow();
  const avail26 = chart.H - chart.opts().axisHeight - 6;
  let prs = chart.paneRects();
  const mainH0 = chart.plot.h;
  const p0h0 = prs[0].rect.h;
  const p1h0 = prs[1].rect.h;
  // 拖主图↔副图分隔条：向下 60px
  fire('pointerdown', 100, prs[0].rect.t);
  fire('pointermove', 100, prs[0].rect.t + 60);
  fire('pointerup', 100, prs[0].rect.t + 60);
  chart.drawNow();
  prs = chart.paneRects();
  t('拖主图↔副图分隔条：副图变高 60、主图等量变矮',
    Math.abs(prs[0].rect.h - (p0h0 + 60)) < 2 && Math.abs(chart.plot.h - (mainH0 - 60)) < 2,
    `pane=${prs[0].rect.h} (was ${p0h0}) main=${chart.plot.h} (was ${mainH0})`);
  t('拖主图边界不影响其它副图高度', Math.abs(prs[1].rect.h - p1h0) < 0.5, `p1=${prs[1].rect.h} vs ${p1h0}`);
  // 拖副图↔副图分隔条：向下 40px → 上面变矮、下面变高、总量不变
  const b1 = prs[1].rect.t;
  const tot0 = prs[0].rect.h + prs[1].rect.h;
  fire('pointerdown', 100, b1);
  fire('pointermove', 100, b1 + 40);
  fire('pointerup', 100, b1 + 40);
  chart.drawNow();
  prs = chart.paneRects();
  t('拖副图间分隔条：下面的变高、上面的变矮、总量不变',
    prs[1].rect.h > p1h0 && Math.abs(prs[0].rect.h + prs[1].rect.h - tot0) < 1.5,
    `h0=${prs[0].rect.h} h1=${prs[1].rect.h} tot0=${tot0}`);
  // 最大化
  const macdUid = prs[1].study.def.uid;
  const preMax = { h0: prs[0].rect.h, h1: prs[1].rect.h, main: chart.plot.h };
  chart.togglePaneMode(macdUid, 'max');
  chart.drawNow();
  prs = chart.paneRects();
  t('最大化：主图压成细条', chart.plot.h <= 64 + 1, `main=${chart.plot.h}`);
  t('最大化：该副图占满其余空间', prs[1].rect.h > avail26 * 0.5, `h=${prs[1].rect.h}`);
  t('最大化：其它副图收窄到最小高度', Math.abs(prs[0].rect.h - 40) < 1, `h0=${prs[0].rect.h}`);
  // 各自坐标轴：刻度密度目标 = h/38（paneTicks 的输入），随自身高度变化；
  // 实际 tick 数还会被量程步长截断（小窗口下可能相等），所以目标值必须增长、实际值不回退
  const densBig = Math.round(prs[1].rect.h / 38);
  const ticksBig = paneTicks(paneScale(prs[1].study.output!, 0, chart.bars.length - 1).min,
    paneScale(prs[1].study.output!, 0, chart.bars.length - 1).max, prs[1].rect.h).ticks.length;
  chart.togglePaneMode(macdUid, 'max');
  chart.drawNow();
  prs = chart.paneRects();
  const densSmall = Math.round(prs[1].rect.h / 38);
  const ticksSmall = paneTicks(paneScale(prs[1].study.output!, 0, chart.bars.length - 1).min,
    paneScale(prs[1].study.output!, 0, chart.bars.length - 1).max, prs[1].rect.h).ticks.length;
  t('还原后布局回到拖拽后的状态', Math.abs(prs[0].rect.h - preMax.h0) < 1 && Math.abs(prs[1].rect.h - preMax.h1) < 1 && Math.abs(chart.plot.h - preMax.main) < 1,
    `h0=${prs[0].rect.h} h1=${prs[1].rect.h} main=${chart.plot.h}`);
  t('每个副图有自己的坐标轴：刻度密度随自身高度自适应', densBig > densSmall && ticksBig >= ticksSmall,
    `target ${densBig}→${densSmall} ticks ${ticksBig}→${ticksSmall}`);
  // 折叠
  const mainBeforeCollapse = chart.plot.h;
  chart.togglePaneMode(prs[0].study.def.uid, 'collapse');
  chart.drawNow();
  prs = chart.paneRects();
  t('折叠：副图收成 22px 细条', prs[0].collapsed && Math.abs(prs[0].rect.h - 22) < 0.5, `h=${prs[0].rect.h}`);
  t('折叠不动主图高度', Math.abs(chart.plot.h - mainBeforeCollapse) < 0.5, `main=${chart.plot.h}`);
  chart.togglePaneMode(prs[0].study.def.uid, 'collapse');
  chart.resetPaneLayout();
  chart.drawNow();
  prs = chart.paneRects();
  t('重置布局：回到默认等高、主图恢复',
    Math.abs(prs[0].rect.h - prs[1].rect.h) < 1 && Math.abs(chart.plot.h - mainH0) < 1,
    `h0=${prs[0].rect.h} h1=${prs[1].rect.h} main=${chart.plot.h}`);
  // 分隔条按下不交给绘图层
  let sepDowns = 0;
  chart.setHooks({ onDown: () => { sepDowns++; return false; }, onMove: () => undefined, onUp: () => undefined, onDraw: () => undefined });
  fire('pointerdown', 100, chart.plot.b);
  fire('pointerup', 100, chart.plot.b);
  t('分隔条按下不交给绘图层、不平移', sepDowns === 0, `downs=${sepDowns}`);
  chart.setHooks(null);

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
