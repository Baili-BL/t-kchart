// tv-bottom —— TradingView 图表页底部区域（工具条 + 策略报告面板）
// 依据 magicpatterns 导入稿（cn.tradingview.com）1:1 还原：
// 工具条 38px、bg rgb(249,249,249)；按钮 38×38、悬停药丸 34×34 圆角 6px；
// 面板白底、头部 34px，report-tabs 分段控件（bg rgb(242,242,242)、圆角 8、
// 内衬 3px、激活片白底圆角 5、字重 600）。
// 用法：
//   const bottom = createBottom(mount, callbacks);
//   bottom.collapse(true/false)  折叠/展开面板
import { PANEL_COLLAPSE, PANEL_MAXIMIZE, INDICATORS, TRADE, DATE_RANGE, INTERVAL, PRECISION, SCRIPT_RUN, SETTINGS, ALERT_ADD, ZOOM, SNAPSHOT, EXPAND_CHART, UPGRADE, } from './bottom-icons.js';
/* ------------------------------------------------------------------ 工具 */
function el(tag, cls = '', html = '') {
    const e = document.createElement(tag);
    if (cls)
        e.className = cls;
    if (html)
        e.innerHTML = html;
    return e;
}
/* --------------------------------------------------------------- 样式注入 */
const CSS = `
.tv-bottom { display: flex; flex-direction: column; flex: 0 0 auto; background: rgb(235,235,235); }
/* —— 工具条 38px —— */
.tv-bt-bar {
  display: flex; align-items: center; height: 38px; flex: 0 0 auto;
  background: rgb(249,249,249); border-top: 1px solid rgb(235,235,235);
  color: rgb(15,15,15); user-select: none; position: relative; z-index: 100;
  font: 400 14px/normal -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  font-feature-settings: "lnum","tnum";
}
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
.tv-bt-btn:hover .pill { background: rgb(242,242,242); }
.tv-bt-btn.tv-on .pill { background: rgb(235,235,235); }
.tv-bt-btn.tv-on { color: rgb(41,98,255); }
/* 白卡片按钮（面板标签） */
.tv-bt-card {
  display: flex; align-items: center; gap: 6px; height: 38px; margin: 0 2px; padding: 0 10px;
  background: #fff; border: 0; cursor: pointer; color: rgb(15,15,15);
  font: 400 14px/normal -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  transition: background-color .06s ease;
}
.tv-bt-card:hover { background: rgb(242,242,242); }
/* 文字按钮（日期/周期/精度） */
.tv-bt-text {
  display: flex; align-items: center; gap: 6px; height: 38px; margin: 0; padding: 0 10px;
  border: 0; background: transparent; cursor: pointer; color: rgb(15,15,15); white-space: nowrap;
  transition: background-color .06s ease;
}
.tv-bt-text:hover { background: rgb(242,242,242); }
.tv-bt-text svg { flex: 0 0 auto; }
.tv-bt-spacer { flex: 1 1 100%; min-width: 0; }
.tv-bt-div { width: 1px; height: 22px; margin: 0 4px; border-left: 1px solid rgb(235,235,235); flex: 0 0 auto; }
/* —— 面板 —— */
.tv-bt-panel {
  background: #fff; height: 280px; display: flex; flex-direction: column;
  border-top: 1px solid rgb(235,235,235); color: rgb(15,15,15); overflow: hidden;
  transition: height .2s ease;
}
.tv-bt-panel.collapsed { height: 0; border-top-width: 0; }
.tv-bt-head {
  display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 8px 0 6px; flex: 0 0 auto;
}
/* report-tabs 分段控件（原稿：65px 宽双图标版，此处扩展为文字版，样式值一致） */
.tv-bt-tabs {
  display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  gap: 3px; padding: 3px; border-radius: 8px; background: rgb(242,242,242);
}
.tv-bt-tab {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  height: 28px; min-width: 29px; padding: 0 10px;
  border: 0; border-radius: 5px; background: transparent; cursor: pointer; color: rgb(15,15,15);
  font: 400 14px/18px -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  transition: background-color .06s ease;
}
.tv-bt-tab:hover { background: rgba(255,255,255,.7); }
.tv-bt-tab.on { background: #fff; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.tv-bt-body { flex: 1 1 auto; overflow-y: auto; padding: 4px 16px 16px; }
/* 关键统计网格 */
.tv-bt-sec { margin: 10px 0 6px; font: 600 15px/22px -apple-system, "system-ui", sans-serif; }
.tv-bt-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 1px;
  background: rgb(235,235,235); border: 1px solid rgb(235,235,235); border-radius: 6px; overflow: hidden;
}
.tv-bt-metric { background: #fff; padding: 10px 12px; }
.tv-bt-metric .k { font: 400 12px/16px -apple-system, "system-ui", sans-serif; color: rgb(120,123,134); }
.tv-bt-metric .v { font: 600 18px/26px -apple-system, "system-ui", sans-serif; margin-top: 2px; font-variant-numeric: tabular-nums; }
.tv-bt-metric .v.up { color: rgb(38,166,154); }
.tv-bt-metric .v.down { color: rgb(242,54,69); }
.tv-bt-foot {
  display: flex; align-items: center; gap: 8px; padding: 6px 16px;
  border-top: 1px solid rgb(235,235,235); color: rgb(120,123,134);
  font: 400 12px/16px -apple-system, "system-ui", sans-serif; flex: 0 0 auto;
}
.tv-bt-foot svg { color: rgb(41,98,255); }
`;
function injectStyle() {
    if (document.getElementById('tv-bottom-css'))
        return;
    const s = document.createElement('style');
    s.id = 'tv-bottom-css';
    s.textContent = CSS;
    document.head.appendChild(s);
}
/* ------------------------------------------------------------ 关键统计数据 */
const METRICS = [
    ['总损益', '+3,456.78', 'up'],
    ['总损益%', '+34.57%', 'up'],
    ['最大回撤', '-1,234.56 (-12.35%)', 'down'],
    ['盈利交易', '61.54%'],
    ['盈利因子', '1.842'],
    ['毛利润', '+12,345.67', 'up'],
    ['毛亏损', '-8,888.89', 'down'],
    ['手续费成本', '-456.78', 'down'],
    ['最大盈利', '+987.65', 'up'],
    ['最大亏损', '-654.32', 'down'],
    ['平均利润', '+123.45', 'up'],
    ['平均亏损', '-89.01', 'down'],
    ['盈亏平衡点', '0.8123'],
    ['总交易', '26'],
    ['赢家', '16', 'up'],
    ['输家', '10', 'down'],
];
export function createBottom(mount, cb = {}) {
    injectStyle();
    const root = el('div', 'tv-bottom');
    /* ================= 工具条 ================= */
    const bar = el('div', 'tv-bt-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', '底部工具条');
    const mkIconBtn = (icon, label, onClick) => {
        const btn = el('button', 'tv-bt-btn');
        btn.type = 'button';
        btn.tabIndex = -1;
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.innerHTML = `<span class="pill"></span>${icon}`;
        if (onClick)
            btn.addEventListener('click', onClick);
        return btn;
    };
    const panel = el('div', 'tv-bt-panel');
    const collapse = (collapsed) => {
        panel.classList.toggle('collapsed', collapsed);
        collapseBtn.classList.toggle('tv-on', collapsed);
        cb.onCollapse?.(collapsed);
    };
    const collapseBtn = mkIconBtn(PANEL_COLLAPSE, '折叠面板', () => collapse(!panel.classList.contains('collapsed')));
    const maxBtn = mkIconBtn(PANEL_MAXIMIZE, '最大化面板', () => cb.onMaximize?.(true));
    // 面板收起态标签（指标 / 交易）
    const tabInd = mkIconBtn(INDICATORS, '指标', () => collapse(false));
    const tabTrade = mkIconBtn(TRADE, '交易', () => collapse(false));
    bar.append(collapseBtn, maxBtn, tabInd, tabTrade, mkIconBtn(DATE_RANGE, '2025年9月9日 — 2026年10月16日', () => cb.onDateRange?.()), mkIconBtn(INTERVAL, '100 K', () => cb.onInterval?.()), mkIconBtn(PRECISION, '默认精度', () => cb.onPrecision?.()), mkIconBtn(SCRIPT_RUN, '脚本执行', () => cb.onScript?.()), el('span', 'tv-bt-div'), mkIconBtn(SETTINGS, '设置', () => cb.onSettings?.()), mkIconBtn(ALERT_ADD, '添加警报', () => cb.onAlert?.()));
    bar.appendChild(el('div', 'tv-bt-spacer'));
    bar.append(mkIconBtn(ZOOM, '缩放'), mkIconBtn(SNAPSHOT, '生成快照', () => cb.onSnapshot?.()), mkIconBtn(EXPAND_CHART, '展开图表', () => cb.onExpand?.()));
    /* ================= 策略报告面板 ================= */
    const head = el('div', 'tv-bt-head');
    const tabs = el('div', 'tv-bt-tabs');
    tabs.setAttribute('role', 'tablist');
    const TABS = ['表现', '表现分析', '明细', '期刊', '基准'];
    TABS.forEach((t, i) => {
        const tab = el('button', i === 0 ? 'tv-bt-tab on' : 'tv-bt-tab');
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(i === 0));
        tab.textContent = t;
        tab.addEventListener('click', () => {
            tabs.querySelectorAll('.tv-bt-tab').forEach(x => {
                x.classList.remove('on');
                x.setAttribute('aria-selected', 'false');
            });
            tab.classList.add('on');
            tab.setAttribute('aria-selected', 'true');
        });
        tabs.appendChild(tab);
    });
    head.appendChild(tabs);
    const body = el('div', 'tv-bt-body');
    const sec = el('div', 'tv-bt-sec');
    sec.textContent = '关键统计';
    const grid = el('div', 'tv-bt-grid');
    for (const [k, v, dir] of METRICS) {
        const m = el('div', 'tv-bt-metric');
        m.innerHTML = `<div class="k">${k}</div><div class="v${dir ? ' ' + dir : ''}">${v}</div>`;
        grid.appendChild(m);
    }
    body.append(sec, grid);
    const foot = el('div', 'tv-bt-foot');
    foot.innerHTML = `${UPGRADE}<span>升级即可完全访问策略报告数据</span>`;
    panel.append(head, body, foot);
    root.append(bar, panel);
    mount.appendChild(root);
    return { root, collapse };
}
