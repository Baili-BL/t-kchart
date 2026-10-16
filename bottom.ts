// tv-bottom —— TradingView 底部区域（策略报告工具条 + 概览面板）
// 按 cn.tradingview.com 策略报告概览页 1:1 还原：
// 工具条：左侧策略标签白卡片（MACD strategy）、右侧最小化/最大化；
// 面板：关键统计四联大数字 → 表现组合图（每笔盈亏柱 + 累计损益折线，
// 悬停深色 tooltip、右侧价格轴、终点红色徽标）→ 表现分析胶囊标签。
// 用法：
//   const bottom = createBottom(mount, callbacks, { strategyName: 'MACD strategy' });
//   bottom.collapse(true/false)  折叠/展开面板
import {
  PANEL_COLLAPSE, PANEL_MAXIMIZE, INDICATORS, SETTINGS, SNAPSHOT, EXPAND_CHART, UPGRADE,
} from './bottom-icons.js';
import { CARET_INDICATORS } from './toolbar-icons.js';

/* ------------------------------------------------------------------ 工具 */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', html = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}

/** 千分位 + 2 位小数（负数带 -） */
function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* --------------------------------------------------------------- 样式注入 */
const CSS = `
.tv-bottom { display: flex; flex-direction: column; flex: 0 0 auto; background: rgb(235,235,235);
  font: 400 14px/normal -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  font-feature-settings: "lnum","tnum"; color: rgb(15,15,15); }
/* —— 工具条 38px —— */
.tv-bt-bar {
  display: flex; align-items: center; height: 38px; flex: 0 0 auto;
  background: rgb(249,249,249); border-top: 1px solid rgb(235,235,235);
  user-select: none; position: relative; z-index: 100;
}
/* 策略标签白卡片 */
.tv-bt-strat {
  display: flex; align-items: center; gap: 7px; height: 30px; margin-left: 6px; padding: 0 6px 0 10px;
  background: #fff; border: 0; border-radius: 6px; cursor: pointer; color: rgb(15,15,15);
  font: 600 13px/normal -apple-system, "system-ui", sans-serif;
  transition: background-color .06s ease;
}
.tv-bt-strat:hover { background: rgb(242,242,242); }
.tv-bt-strat .cw { display: flex; color: rgb(120,123,134); }
.tv-bt-btn {
  position: relative; z-index: 0; display: flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; margin: 0; padding: 0; flex: 0 0 auto;
  border: 0; background: transparent; cursor: pointer; color: rgb(15,15,15);
  transition: background-color .06s ease;
}
.tv-bt-btn .pill {
  position: absolute; z-index: -1; left: 2px; top: 2px; width: 34px; height: 34px;
  border-radius: 6px; background: transparent;
}
.tv-bt-btn:hover .pill { background: rgb(235,235,235); }
.tv-bt-btn.tv-on .pill { background: rgb(235,235,235); }
.tv-bt-btn.tv-on { color: rgb(41,98,255); }
.tv-bt-spacer { flex: 1 1 100%; min-width: 0; }
/* —— 面板 —— */
.tv-bt-panel {
  background: #fff; height: 300px; display: flex; flex-direction: column;
  border-top: 1px solid rgb(235,235,235); overflow: hidden; transition: height .2s ease;
}
.tv-bt-panel.collapsed { height: 0; border-top-width: 0; }
.tv-bt-body { flex: 1 1 auto; overflow-y: auto; padding: 10px 28px 16px; }
.tv-bt-h2 { font: 600 24px/32px -apple-system, "system-ui", sans-serif; margin: 4px 0 14px; }
/* 关键统计四联（列宽比例对齐原稿：29%/27%/23%/21%） */
.tv-bt-stats { display: grid; grid-template-columns: 29% 27% 23% minmax(0, 1fr); gap: 0; margin-bottom: 26px; }
.tv-bt-stat .k { font: 400 13px/18px -apple-system, "system-ui", sans-serif; color: rgb(120,123,134); }
.tv-bt-stat .vrow { display: flex; align-items: baseline; gap: 10px; margin-top: 2px; }
.tv-bt-stat .v { font: 600 22px/30px -apple-system, "system-ui", sans-serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
.tv-bt-stat .s { font: 600 17px/24px -apple-system, "system-ui", sans-serif; color: rgb(15,15,15); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tv-bt-stat .v.down, .tv-bt-stat .s.down { color: rgb(242,54,69); }
/* 小节标题 */
.tv-bt-sechead { display: flex; align-items: center; gap: 6px; margin: 6px 0 4px; }
.tv-bt-sechead .tt { font: 600 20px/28px -apple-system, "system-ui", sans-serif; }
.tv-bt-sechead .help { display: flex; color: rgb(120,123,134); cursor: pointer; }
.tv-bt-sechead .sp { flex: 1 1 auto; }
.tv-bt-mini {
  display: flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: rgb(15,15,15);
  transition: background-color .06s ease;
}
.tv-bt-mini:hover { background: rgb(242,242,242); }
/* 图表区 */
.tv-bt-chart { position: relative; }
.tv-bt-legend { position: absolute; z-index: 3; left: 2px; top: 0; font: 400 12px/18px -apple-system, sans-serif; color: rgb(15,15,15); pointer-events: none; }
.tv-bt-legend .row { display: flex; align-items: center; gap: 4px; pointer-events: auto; }
.tv-bt-legend .row .eye { display: flex; border: 0; background: transparent; padding: 2px; cursor: pointer; color: rgb(120,123,134); border-radius: 4px; }
.tv-bt-legend .row .eye:hover { background: rgb(242,242,242); color: rgb(15,15,15); }
.tv-bt-legend .row .eye.off { color: rgb(180,183,190); cursor: default; }
.tv-bt-legend .row .eye.off:hover { background: transparent; color: rgb(180,183,190); }
.tv-bt-legend .sub { color: rgb(120,123,134); margin-top: 2px; }
.tv-bt-legend .exp {
  margin-top: 6px; display: flex; align-items: center; justify-content: center;
  width: 24px; height: 18px; border: 1px solid rgb(210,212,220); border-radius: 4px;
  background: #fff; cursor: pointer; color: rgb(15,15,15); pointer-events: auto; padding: 0;
}
.tv-bt-legend .exp svg { transition: transform .2s ease; }
.tv-bt-legend .exp.on svg { transform: rotate(180deg); }
.tv-bt-xaxis { position: relative; height: 22px; font: 400 12px/22px -apple-system, sans-serif; color: rgb(15,15,15); }
.tv-bt-xaxis span { position: absolute; top: 0; white-space: nowrap; }
.tv-bt-xaxis span.y { font-weight: 600; }
.tv-bt-strip { display: flex; gap: 1px; height: 4px; margin-top: 2px; }
.tv-bt-strip i { flex: 1 1 0; border-radius: 1px; }
/* 深色 tooltip */
.tv-bt-tip {
  position: absolute; z-index: 5; pointer-events: none; display: none;
  background: rgba(30,30,30,.96); color: #fff; border-radius: 6px; padding: 8px 12px 7px;
  font: 400 12px/20px -apple-system, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.25);
  white-space: nowrap;
}
.tv-bt-tip .ti { color: rgba(255,255,255,.75); }
.tv-bt-tip .tr { display: flex; align-items: center; gap: 6px; }
.tv-bt-tip .tr i { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.tv-bt-tip .tr b { font-weight: 600; font-variant-numeric: tabular-nums; }
.tv-bt-tip .td { color: rgba(255,255,255,.6); margin-top: 2px; }
.tv-bt-tip .th { color: rgba(255,255,255,.45); font-size: 11px; }
/* 表现分析胶囊 */
.tv-bt-pills { display: flex; gap: 8px; margin: 10px 0 16px; flex-wrap: wrap; }
.tv-bt-pill {
  height: 28px; padding: 0 14px; border: 0; border-radius: 14px; cursor: pointer;
  background: rgb(240,242,245); color: rgb(15,15,15);
  font: 500 13px/28px -apple-system, "system-ui", sans-serif;
  transition: background-color .06s ease;
}
.tv-bt-pill:hover { background: rgb(232,235,240); }
.tv-bt-pill.on { background: rgb(15,15,15); color: #fff; }
/* 明细指标行 */
.tv-bt-dgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px 24px; }
.tv-bt-dgrid .k { font: 400 12px/16px -apple-system, sans-serif; color: rgb(120,123,134); }
.tv-bt-dgrid .v { font: 600 15px/22px -apple-system, sans-serif; margin-top: 2px; font-variant-numeric: tabular-nums; }
.tv-bt-dgrid .v.up { color: rgb(38,166,154); }
.tv-bt-dgrid .v.down { color: rgb(242,54,69); }
.tv-bt-foot {
  display: flex; align-items: center; gap: 8px; padding: 6px 16px;
  border-top: 1px solid rgb(235,235,235); color: rgb(120,123,134);
  font: 400 12px/16px -apple-system, sans-serif; flex: 0 0 auto;
}
.tv-bt-foot svg { color: rgb(41,98,255); }
`;

function injectStyle(): void {
  if (document.getElementById('tv-bottom-css')) return;
  const s = document.createElement('style');
  s.id = 'tv-bottom-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------- 示例数据 */
// 每笔交易：[盈亏, 有利波动, 不利波动]；第 9 笔取自原稿 tooltip 数值
const TRADES: Array<[number, number, number]> = [
  [-2350.00, 282.00, 1645.00], [-1890.00, 266.80, 1323.00], [2755.71, 2480.14, 330.68],
  [-1880.00, 265.60, 1316.00], [-1900.00, 268.00, 1330.00], [-2100.00, 292.00, 1470.00],
  [2095.14, 1885.63, 251.42], [-740.00, 128.80, 518.00], [-2861.51, 189.30, 147.68],
  [-1020.00, 162.40, 714.00], [-1240.00, 188.80, 868.00], [-1560.00, 219.20, 1092.00],
  [-1890.00, 266.90, 1323.00], [-2120.00, 296.80, 1484.00], [2895.02, 2605.52, 347.40],
  [-1960.00, 274.40, 1372.00], [-2230.00, 308.20, 1561.00], [-2870.00, 391.80, 2009.00],
  [-1980.00, 271.20, 1386.00], [3400.87, 3060.78, 408.10], [-2140.00, 295.60, 1498.00],
  [4012.72, 3611.45, 481.53], [-5990.00, 838.60, 4193.00], [-2450.00, 338.00, 1715.00],
  [-9870.00, 1381.80, 6909.00], [-10540.00, 1475.60, 7378.00], [-8390.00, 1174.60, 5873.00],
  [-6340.00, 887.60, 4438.00], [2225.71, 2003.14, 267.09], [-981.89, 157.83, 687.32],
  [-890.00, 146.80, 623.00], [-670.00, 120.40, 469.00], [-5132.92, 718.61, 3593.04],
];
const CUM: number[] = [];
{
  let acc = 0;
  for (const [d] of TRADES) { acc += d; CUM.push(acc); }
}
const WINS = TRADES.filter(t => t[0] > 0).length; // 6
const N = TRADES.length;                          // 33
const GROSS_WIN = TRADES.reduce((s, t) => s + Math.max(0, t[0]), 0);   // 17,385.17
const GROSS_LOSS = TRADES.reduce((s, t) => s + Math.min(0, t[0]), 0);  // -83,986.32

// 交易日期：2025-11-05 起，每 11 天一笔
const T0 = new Date(2025, 10, 5).getTime();
const STEP = 11 * 86400e3;
function tradeDate(i: number): Date { return new Date(T0 + i * STEP); }
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function fmtDate(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日周${WEEK[d.getDay()]}`;
}
// X 轴刻度：横向位置比例对齐原稿（0 / 19% / 28.6% / 40.7% / 56% / 76% / 92%）
const X_TICKS: Array<[number, string, boolean]> = [
  [0, '11月', false],
  [0.19, '2026年', true],
  [0.286, '3月', false],
  [0.407, '16日', false],
  [0.56, '4月', false],
  [0.76, '6月', false],
  [0.92, '10月', false],
];

const TEAL = 'rgb(38,166,154)';
const RED = 'rgb(242,54,69)';
const EYE = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path stroke="currentColor" stroke-width="1.3" d="M1.5 9s2.8-4.8 7.5-4.8S16.5 9 16.5 9s-2.8 4.8-7.5 4.8S1.5 9 1.5 9z"/><circle cx="9" cy="9" r="2.1" stroke="currentColor" stroke-width="1.3"/></svg>';
const EYE_OFF = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path stroke="currentColor" stroke-width="1.3" d="M1.5 9s2.8-4.8 7.5-4.8S16.5 9 16.5 9s-2.8 4.8-7.5 4.8S1.5 9 1.5 9z"/><path stroke="currentColor" stroke-width="1.3" d="M3 15L15 3"/></svg>';
const HELP = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.6" stroke="currentColor" stroke-width="1.2"/><text x="8" y="11" text-anchor="middle" font-size="8.5" font-weight="600" fill="currentColor">?</text></svg>';
const CHEV = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path stroke="currentColor" stroke-width="1.4" d="M2 6.5L5 3.5L8 6.5"/></svg>';

/* ------------------------------------------------------------------ 组件 */
export interface BottomCallbacks {
  onStrategy?: () => void;
  onCollapse?: (collapsed: boolean) => void;
  onMaximize?: (max: boolean) => void;
  onChartTool?: (label: string) => void;
}
export interface BottomOptions { strategyName?: string; }
export interface BottomHandle {
  root: HTMLElement;
  collapse: (collapsed: boolean) => void;
}

export function createBottom(mount: HTMLElement, cb: BottomCallbacks = {}, opts: BottomOptions = {}): BottomHandle {
  injectStyle();
  const name = opts.strategyName ?? 'MACD strategy';

  const root = el('div', 'tv-bottom');

  /* ================= 工具条 ================= */
  const bar = el('div', 'tv-bt-bar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '策略报告工具条');

  const panel = el('div', 'tv-bt-panel');
  const strat = el('button', 'tv-bt-strat') as HTMLButtonElement;
  strat.type = 'button';
  strat.title = name;
  strat.setAttribute('aria-label', `策略 ${name}`);
  strat.innerHTML = `${INDICATORS}<span class="nm">${name}</span><span class="cw">${CARET_INDICATORS}</span>`;
  strat.addEventListener('click', () => cb.onStrategy?.());

  const minBtn = el('button', 'tv-bt-btn') as HTMLButtonElement;
  minBtn.type = 'button';
  minBtn.title = '最小化面板';
  minBtn.setAttribute('aria-label', '最小化面板');
  minBtn.innerHTML = `<span class="pill"></span>${PANEL_COLLAPSE}`;
  const maxBtn = el('button', 'tv-bt-btn') as HTMLButtonElement;
  maxBtn.type = 'button';
  maxBtn.title = '最大化面板';
  maxBtn.setAttribute('aria-label', '最大化面板');
  maxBtn.innerHTML = `<span class="pill"></span>${PANEL_MAXIMIZE}`;
  maxBtn.addEventListener('click', () => cb.onMaximize?.(true));

  const collapse = (collapsed: boolean): void => {
    panel.classList.toggle('collapsed', collapsed);
    minBtn.classList.toggle('tv-on', collapsed);
    cb.onCollapse?.(collapsed);
  };
  minBtn.addEventListener('click', () => collapse(!panel.classList.contains('collapsed')));

  bar.append(strat, el('div', 'tv-bt-spacer'), minBtn, maxBtn);

  /* ================= 面板 ================= */
  const body = el('div', 'tv-bt-body');

  /* —— 关键统计 —— */
  body.appendChild(el('div', 'tv-bt-h2', '关键统计'));
  const stats = el('div', 'tv-bt-stats');
  const statDefs: Array<[string, string, string | null, string | null]> = [
    ['总损益', `-${fmt(Math.abs(CUM[N - 1]))} USD`, `${(CUM[N - 1] / 1000).toFixed(2)}%`, 'down'],
    ['最大回撤', '69,312.24 USD', '69.31%', null],
    ['盈利交易', '18.18%', `${WINS}/${N}`, null],
    ['盈利因子', '0.207', null, null],
  ];
  for (const [k, v, s, dir] of statDefs) {
    const m = el('div', 'tv-bt-stat');
    m.innerHTML = `<div class="k">${k}</div><div class="vrow"><span class="v${dir ? ' ' + dir : ''}">${v}</span>`
      + (s ? `<span class="s${dir ? ' ' + dir : ''}">${s}</span>` : '') + '</div>';
    stats.appendChild(m);
  }
  body.appendChild(stats);

  /* —— 表现（组合图） —— */
  const secHead = el('div', 'tv-bt-sechead');
  secHead.innerHTML = `<span class="tt">表现</span><span class="help" title="了解报告指标">${HELP}</span><span class="sp"></span>`;
  const mkTool = (icon: string, label: string): HTMLButtonElement => {
    const b = el('button', 'tv-bt-mini') as HTMLButtonElement;
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    b.addEventListener('click', () => cb.onChartTool?.(label));
    return b;
  };
  secHead.append(mkTool(SETTINGS, '设置'), mkTool(SNAPSHOT, '生成快照'), mkTool(EXPAND_CHART, '全屏模式'));
  body.appendChild(secHead);

  // 图表列（svg + X 轴 + 底部盈亏条）
  const chartCol = el('div');
  chartCol.style.display = 'flex';
  chartCol.style.flexDirection = 'column';
  const chartWrap = el('div', 'tv-bt-chart');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chartWrap.appendChild(svg);

  // 图例（左上）
  const legend = el('div', 'tv-bt-legend');
  const eyeBtn = el('button', 'eye') as HTMLButtonElement;
  eyeBtn.type = 'button';
  eyeBtn.title = '隐藏累计损益';
  eyeBtn.innerHTML = EYE;
  legend.innerHTML = `<div class="row">累计损益</div>`
    + `<div class="row">买入和持有<span class="eye off">${EYE_OFF}</span></div>`
    + `<div class="sub">交易波动幅度</div><div class="sub">上涨和回撤</div>`;
  const row0 = legend.querySelector('.row') as HTMLElement;
  row0.appendChild(eyeBtn);
  const expBtn = el('button', 'exp') as HTMLButtonElement;
  expBtn.type = 'button';
  expBtn.title = '展开图表';
  expBtn.innerHTML = CHEV;
  legend.appendChild(expBtn);
  chartWrap.appendChild(legend);

  // 深色 tooltip
  const tip = el('div', 'tv-bt-tip');
  chartWrap.appendChild(tip);

  // X 轴 + 底部盈亏条
  const xaxis = el('div', 'tv-bt-xaxis');
  const strip = el('div', 'tv-bt-strip');
  for (const [d] of TRADES) {
    const seg = document.createElement('i');
    seg.style.background = d > 0 ? TEAL : RED;
    strip.appendChild(seg);
  }
  chartCol.append(chartWrap, strip, xaxis);
  body.appendChild(chartCol);

  /* —— 图表渲染 —— */
  let chartH = 260;
  let showLine = true;

  function render(): void {
    const W = Math.max(320, chartWrap.clientWidth || 640);
    const AXIS_W = 88;
    const plotW = W - AXIS_W;
    const TOP = 10, BOT = 14;
    const plotH = chartH - TOP - BOT;
    const V_TOP = 10000, SPAN = 80000; // +10k … -70k
    const yFor = (v: number): number => TOP + (V_TOP - v) / SPAN * plotH;
    const colW = plotW / N;
    const cx = (i: number): number => (i + 0.5) * colW;

    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(chartH));
    svg.setAttribute('viewBox', `0 0 ${W} ${chartH}`);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // 右侧价格轴（0 … -70,000.00）
    for (let v = 0; v >= -70000; v -= 10000) {
      const y = yFor(v);
      svg.appendChild(svgEl('text', {
        x: W - 6, y: y + 4, 'text-anchor': 'end', 'font-size': 11.5,
        fill: 'rgb(15,15,15)', 'font-family': '-apple-system, sans-serif',
      })).textContent = v === 0 ? '0' : `-${fmt(Math.abs(v))}`;
    }
    // 零轴虚线
    svg.appendChild(svgEl('line', {
      x1: 0, y1: yFor(0), x2: plotW, y2: yFor(0),
      stroke: 'rgb(180,183,190)', 'stroke-dasharray': '2 3', 'stroke-width': 1,
    }));

    // 累计损益面积（线下方淡红）
    if (showLine) {
      const pts = CUM.map((v, i) => `${cx(i)},${yFor(v)}`).join(' ');
      svg.appendChild(svgEl('polygon', {
        points: `0,${yFor(0)} ${pts} ${plotW - colW / 2},${yFor(0)}`,
        fill: 'rgba(242,54,69,.08)',
      }));
    }
    // 每笔盈亏柱
    TRADES.forEach(([d], i) => {
      const y0 = yFor(0);
      const y1 = yFor(d);
      const x = cx(i) - colW * 0.28;
      svg.appendChild(svgEl('rect', {
        x, y: Math.min(y0, y1), width: colW * 0.56, height: Math.max(1.5, Math.abs(y1 - y0)),
        fill: d > 0 ? TEAL : RED, rx: 1,
      }));
    });
    // 累计折线 + 圆点
    if (showLine) {
      svg.appendChild(svgEl('polyline', {
        points: CUM.map((v, i) => `${cx(i)},${yFor(v)}`).join(' '),
        fill: 'none', stroke: RED, 'stroke-width': 1.6,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
      CUM.forEach((v, i) => {
        svg.appendChild(svgEl('circle', { cx: cx(i), cy: yFor(v), r: 2.4, fill: RED }));
      });
      // 终点红色徽标
      const ly = yFor(CUM[N - 1]);
      svg.appendChild(svgEl('rect', {
        x: plotW + 2, y: ly - 11, width: AXIS_W - 8, height: 22, rx: 3, fill: RED,
      }));
      svg.appendChild(svgEl('text', {
        x: W - 6, y: ly + 4, 'text-anchor': 'end', 'font-size': 12, 'font-weight': 600,
        fill: '#fff', 'font-family': '-apple-system, sans-serif',
      })).textContent = `-${fmt(Math.abs(CUM[N - 1]))}`;
    }

    // 悬停热区 + tooltip
    const tipHtml = (i: number): string => {
      const [d, fav, adv] = TRADES[i];
      const long = (i + 1) % 5 === 3;
      return `<span class="ti">交易${i + 1} ${long ? '做多' : '做空'}</span>`
        + `<div class="tr"><i style="background:${RED}"></i>累计损益 <b>${fmt(CUM[i])} USD</b></div>`
        + `<div class="tr"><i style="background:${TEAL}"></i>有利波动 <b>${fmt(fav)} USD</b></div>`
        + `<div class="tr"><i style="background:rgba(242,54,69,.55)"></i>不利波动 <b>-${fmt(adv)} USD</b></div>`
        + `<div class="td">${fmtDate(tradeDate(i))}</div>`
        + `<div class="th">点击显示在图表上</div>`;
    };
    TRADES.forEach((_, i) => {
      const hit = svgEl('rect', {
        x: i * colW, y: 0, width: colW, height: chartH, fill: 'transparent',
      });
      hit.style.pointerEvents = 'all';
      hit.addEventListener('mouseenter', () => {
        tip.innerHTML = tipHtml(i);
        tip.style.display = 'block';
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        const lx = Math.min(Math.max(cx(i) - tw / 2, 4), W - tw - 4);
        const ly = yFor(CUM[i]);
        tip.style.left = `${lx}px`;
        tip.style.top = `${Math.max(2, ly - th - 10)}px`;
      });
      hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
      svg.appendChild(hit);
    });

    // X 轴刻度 + 底部盈亏条（与 plot 对齐）
    xaxis.innerHTML = '';
    xaxis.style.width = `${plotW}px`;
    xaxis.style.marginLeft = '0';
    for (const [t, label, bold] of X_TICKS) {
      const sp = document.createElement('span');
      if (bold) sp.className = 'y';
      sp.textContent = label;
      sp.style.left = `calc(${(t * 100).toFixed(2)}% - 2px)`;
      xaxis.appendChild(sp);
    }
    strip.style.width = `${plotW}px`;
  }

  // 图例交互
  eyeBtn.addEventListener('click', () => {
    showLine = !showLine;
    eyeBtn.innerHTML = showLine ? EYE : EYE_OFF;
    eyeBtn.title = showLine ? '隐藏累计损益' : '显示累计损益';
    render();
  });
  expBtn.addEventListener('click', () => {
    chartH = chartH === 260 ? 420 : 260;
    expBtn.classList.toggle('on', chartH === 420);
    render();
  });

  render();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => render()).observe(chartWrap);
  }

  /* —— 表现分析 —— */
  const sec2 = el('div', 'tv-bt-sechead');
  sec2.innerHTML = `<span class="tt">表现分析</span>`;
  body.appendChild(sec2);

  const pills = el('div', 'tv-bt-pills');
  const PILL_DEFS = ['明细', '期刊', '基准', '保证金使用', '增长与衰退'];
  PILL_DEFS.forEach((p, i) => {
    const b = el('button', i === 0 ? 'tv-bt-pill on' : 'tv-bt-pill') as HTMLButtonElement;
    b.type = 'button';
    b.textContent = p;
    b.addEventListener('click', () => {
      pills.querySelectorAll('.tv-bt-pill').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    });
    pills.appendChild(b);
  });
  body.appendChild(pills);

  const dgrid = el('div', 'tv-bt-dgrid');
  const detailDefs: Array<[string, string, string | null]> = [
    ['毛利润', `${fmt(GROSS_WIN)} USD`, 'up'],
    ['毛损', `${fmt(GROSS_LOSS)} USD`, 'down'],
    ['盈利因子', '0.207', null],
    ['手续费成本', '-1,234.56 USD', 'down'],
  ];
  for (const [k, v, dir] of detailDefs) {
    const m = el('div');
    m.innerHTML = `<div class="k">${k}</div><div class="v${dir ? ' ' + dir : ''}">${v}</div>`;
    dgrid.appendChild(m);
  }
  body.appendChild(dgrid);

  const foot = el('div', 'tv-bt-foot');
  foot.innerHTML = `${UPGRADE}<span>升级即可完全访问策略报告数据</span>`;

  panel.append(body, foot);
  root.append(bar, panel);
  mount.appendChild(root);

  return { root, collapse };
}
