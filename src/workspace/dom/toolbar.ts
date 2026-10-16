// kc-toolbar —— 图表页顶部横排工具栏
// 依据设计稿 1:1 还原：
// 高 38px、白底、文字 rgb(15,15,15)、分隔线 rgb(235,235,235)、
// 悬停底 rgb(242,242,242)、强调色 rgb(41,98,255)。
// 用法：createToolbar(document.getElementById('mount'));
// 需要从外部同步状态（品种 / 周期 / 布局名 / 撤销态）时用 createToolbarHandle。
import * as SI from './style-icons';
import { DATA_TYPE, COMPARE, CANDLES, INDICATORS, CARET_INDICATORS, IND_TEMPLATES, ALERT, REPLAY, UNDO, REDO, LAYOUT, CARET_LAYOUT, QUICK_SEARCH, SETTINGS, FULLSCREEN, SNAPSHOT } from './toolbar-icons';

/* ------------------------------------------------------------------ 工具 */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', html = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/* --------------------------------------------------------------- 样式注入 */
const CSS = `
.kc-toolbar {
  display: flex; align-items: stretch; width: 100%; height: 38px;
  background: #fff; color: rgb(15,15,15); user-select: none; position: relative; z-index: 100;
  font: 400 14px/normal -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  font-feature-settings: "lnum","tnum";
}
.kc-toolbar svg { display: block; }
.kc-tb-group { display: flex; align-items: center; height: 38px; flex: 0 0 auto; }
.kc-tb-spacer { flex: 1 1 100%; min-width: 0; }
.kc-tb-div {
  flex: 0 0 auto; width: 0; height: 22px; margin: 0 4px;
  border-left: 1px solid rgb(235,235,235);
}
/* —— 通用按钮 —— */
.kc-tb-btn {
  display: flex; align-items: center; justify-content: center; height: 38px;
  border: 0; background: transparent; color: rgb(15,15,15); padding: 0 5px;
  font: inherit; cursor: pointer; border-radius: 0; position: relative;
  transition: background-color .06s ease, color .06s ease; white-space: nowrap;
}
.kc-tb-btn:hover { background: rgb(242,242,242); }
.kc-tb-btn:active { background: rgb(235,235,235); }
.kc-tb-btn[disabled] { opacity: .5; cursor: default; pointer-events: none; }
.kc-tb-btn.kc-on { background: rgb(231,240,255); color: rgb(41,98,255); }
.kc-tb-label { margin-inline-start: 4px; }
.kc-tb-caret { margin: 0 8px; display: flex; align-items: center; }
.kc-tb-caret svg { width: 8px; height: 4px; }
/* —— 品种胶囊 —— */
.kc-tb-symbol-wrap { position: relative; width: 128px; height: 28px; margin: 0 4px; }
.kc-tb-symbol {
  display: flex; align-items: center; justify-content: space-between; width: 128px; height: 28px;
  padding: 0 34px 0 12px; border: 0; border-radius: 14px; background: rgb(235,235,235);
  font: 600 14px/18px -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  color: rgb(15,15,15); cursor: pointer; position: relative; overflow: hidden;
}
.kc-tb-symbol:hover { background: rgb(228,228,228); }
.kc-tb-symbol .fade {
  position: absolute; inset-inline-end: 0; top: 0; width: 18px; height: 18px;
  background: linear-gradient(90deg, rgba(235,235,235,0) 0%, rgb(235,235,235) 100%);
  pointer-events: none;
}
.kc-tb-symbol:hover .fade { background: linear-gradient(90deg, rgba(228,228,228,0) 0%, rgb(228,228,228) 100%); }
.kc-tb-symbol .name { max-width: 82px; overflow: hidden; }
.kc-tb-datatype {
  position: absolute; top: 0; inset-inline-end: 0; width: 28px; height: 24px;
  padding: 2px; border: 0; border-radius: 999px; background: transparent; cursor: pointer;
}
.kc-tb-datatype span {
  display: flex; align-items: center; justify-content: center; width: 24px; height: 20px;
  background: #fff; border-radius: 999px; color: rgb(15,15,15);
}
.kc-tb-datatype:hover span { background: rgb(242,242,242); }
/* —— 周期激活态 —— */
.kc-tb-interval { padding: 0 10px; }
.kc-tb-interval.kc-on { background: rgb(242,242,242); border-radius: 6px; }
/* —— 保存块 —— */
.kc-tb-save { display: flex; flex-direction: column; align-items: center; line-height: 14px; }
.kc-tb-save .name { max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
.kc-tb-save .state {
  color: rgb(41,98,255); font-size: 10px; line-height: 10px; height: 10px;
  overflow: hidden; max-width: 100px;
}
/* —— 下拉菜单 —— */
.kc-tb-menu {
  position: absolute; top: 40px; min-width: 132px; padding: 6px 0; margin: 0; list-style: none;
  background: #fff; border-radius: 6px; box-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04);
  font-size: 13px; z-index: 110; display: none;
}
.kc-tb-menu.open { display: block; }
.kc-tb-menu li {
  display: flex; align-items: center; gap: 8px; padding: 6px 14px; cursor: pointer;
  transition: background-color .06s ease;
}
.kc-tb-menu li:hover { background: rgb(242,242,242); }
.kc-tb-menu li .check { width: 14px; visibility: hidden; }
.kc-tb-menu li.sel .check { visibility: visible; }
.kc-tb-menu li svg { flex: 0 0 auto; color: rgb(15,15,15); }
/* —— 图表样式菜单（分组 + 说明 + 收藏） —— */
.kc-tb-menu.kc-sm { width: 266px; padding: 6px; max-height: calc(100vh - 80px); overflow-y: auto; }
.kc-tb-menu.kc-sm li.kc-sm-row {
  height: 36px; padding: 2px 4px; gap: 4px; border-radius: 6px; box-sizing: border-box;
}
.kc-sm-row .kc-sm-label { flex: 1 1 auto; display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 14px; line-height: 18px; }
.kc-sm-row .kc-sm-help, .kc-sm-row .kc-sm-star {
  display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; flex: 0 0 auto;
  color: rgb(184,184,184); opacity: 0; cursor: pointer;
}
.kc-sm-row:hover .kc-sm-help, .kc-sm-row:hover .kc-sm-star, .kc-sm-row .kc-sm-star.on { opacity: 1; }
.kc-sm-row .kc-sm-help:hover, .kc-sm-row .kc-sm-star:hover { color: rgb(15,15,15); }
.kc-sm-row .kc-sm-star.on { color: rgb(255,171,0); }
.kc-sm-row .kc-sm-star { margin-right: 4px; }
.kc-tb-menu li.kc-sm-row.sel { background: rgb(231,240,255); color: rgb(41,98,255); }
.kc-tb-menu li.kc-sm-row.sel svg:first-child { color: rgb(41,98,255); }
.kc-tb-menu li.kc-sm-row.na { opacity: .45; cursor: not-allowed; }
.kc-tb-menu li.kc-sm-row.na:hover { background: transparent; }
.kc-tb-menu li.kc-sm-sep { height: 1px; padding: 0; margin: 6px 4px; background: rgb(235,235,235); cursor: default; }
.kc-tb-menu li.kc-sm-sep:hover { background: rgb(235,235,235); }
.kc-tb-fav { padding: 0 3px; }
.kc-tb-fav.kc-on { background: rgb(231,240,255); color: rgb(41,98,255); }
/* —— 窄屏降级：按容器宽度（而非视口）逐级收起次要按钮，避免挤出右侧面板 —— */
.kc-toolbar { container-type: inline-size; container-name: tvtb; }
@container tvtb (max-width: 1000px) {
  .kc-tb-label, .kc-p1 { display: none; }
}
@container tvtb (max-width: 800px) {
  .kc-p2 { display: none; }
}
@container tvtb (max-width: 640px) {
  .kc-p3 { display: none; }
}
`;

function injectStyle(): void {
  if (document.getElementById('kc-toolbar-css')) return;
  const s = document.createElement('style');
  s.id = 'kc-toolbar-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------ 下拉菜单定义 */
const INTERVALS: Array<[string, string]> = [
  ['1分', '1m'], ['5分', '5m'], ['15分', '15m'], ['30分', '30m'],
  ['1时', '1h'], ['4时', '4h'], ['天', '1D'], ['周', '1W'], ['月', '1M'],
];

/** 图表样式菜单的一行。`unavailable` 有值 = 做不了，灰显，点击只提示原因（不切换） */
interface StyleRow { label: string; icon: string; help: string; unavailable?: string }

const NEED_INTRABAR = '需要逐笔 / 更小周期的成交数据，现有数据源只有 OHLC';
const NON_TIME = '按价格变动出 bar 的非时间序列图，会改变 bar 数量与时间轴，指标 / 回放 / 联动都要跟着改，暂未实现';

/** 与设计稿一致：6 组（组间有分隔线），共 21 行，目前可用 13 行 */
const STYLE_GROUPS: StyleRow[][] = [
  [
    { label: '美国线', icon: SI.ST_BARS, help: '用竖线连接最高价与最低价，左短线为开盘价，右短线为收盘价。' },
    { label: 'K线图', icon: SI.ST_CANDLES, help: '实体显示开盘到收盘，影线显示最高与最低价。' },
    { label: '空心K线图', icon: SI.ST_HOLLOW, help: '收盘高于开盘的 K 线实体为空心，反之为实心。' },
    { label: '成交量蜡烛', icon: SI.ST_VOLCANDLES, help: '蜡烛实体的宽度与该根的成交量成正比。' },
  ],
  [
    { label: '线形图', icon: SI.ST_LINE, help: '连接每根 K 线收盘价的折线。' },
    { label: '带标记线', icon: SI.ST_LINEMARKERS, help: '在每根 K 线的收盘价处加一个标记点的折线。' },
    { label: '阶梯线', icon: SI.ST_STEP, help: '收盘价变化时先横后竖的阶梯折线。' },
  ],
  [
    { label: '面积图', icon: SI.ST_AREA, help: '收盘价折线，线下方做渐变填充。' },
    { label: 'HLC区域', icon: SI.ST_HLCAREA, help: '最高价线与最低价线之间填充，并叠加收盘价线。' },
    { label: '基准线', icon: SI.ST_BASELINE, help: '以可见范围收盘价的中点为基准，之上用涨色、之下用跌色。' },
  ],
  [
    { label: '柱状图', icon: SI.ST_COLUMNS, help: '以柱子表示收盘价，颜色按相对上一根收盘价的涨跌。' },
    { label: '高-低', icon: SI.ST_HIGHLOW, help: '每根 K 线一根从最低价到最高价的悬浮柱。' },
  ],
  [
    { label: '成交量轨迹', icon: SI.ST_FOOTPRINT, help: '每根 K 线内按价位拆分买卖成交量。', unavailable: NEED_INTRABAR },
    { label: '时间价格机会', icon: SI.ST_TPO, help: '市场轮廓（TPO）图。', unavailable: NEED_INTRABAR },
    { label: '交易时段成交量分布图', icon: SI.ST_SESSIONVP, help: '按交易时段统计各价位的成交量。', unavailable: NEED_INTRABAR },
  ],
  [
    { label: '平均K线图', icon: SI.ST_HEIKIN, help: 'Heikin-Ashi：用前后两根的平均值平滑 K 线，更容易看出趋势。' },
    { label: '砖形图', icon: SI.ST_RENKO, help: '只在价格移动一个固定幅度时才画一块砖，忽略时间。', unavailable: NON_TIME },
    { label: '新价线', icon: SI.ST_LINEBREAK, help: '三线反转图：只在价格突破前几条线时才画反转线。', unavailable: NON_TIME },
    { label: '卡吉图', icon: SI.ST_KAGI, help: '用粗细变化的竖线记录价格趋势，忽略时间。', unavailable: NON_TIME },
    { label: '点数图', icon: SI.ST_PNF, help: '用 X 和 O 的列记录价格上涨和下跌，忽略时间。', unavailable: NON_TIME },
    { label: '范围图', icon: SI.ST_RANGE, help: '每根 bar 的价格振幅固定，忽略时间。', unavailable: '每根 bar 的价格范围固定，准确切分需要根内逐笔数据，现有数据源只有 OHLC，暂未实现' },
  ],
];
const STYLE_ROWS: StyleRow[] = STYLE_GROUPS.flat();
const FAV_KEY = 'kc.style.favorites';

const CHECK = '<svg class="check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="14" height="14" fill="none"><path stroke="currentColor" stroke-width="1.6" d="M2.5 7.5l3 3 6-7"/></svg>';

/* ------------------------------------------------------------------ 组件 */
export interface ToolbarCallbacks {
  onSymbol?: () => void;
  onInterval?: (label: string, code: string) => void;
  /** 选中样式。`unavailable` 有值表示该样式暂不可用（原因），调用方应提示而不是切换 */
  onStyle?: (label: string, unavailable?: string) => void;
  onCompare?: () => void;
  onIndicators?: () => void;
  onAlert?: (on: boolean) => void;
  onReplay?: (on: boolean) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDataType?: () => void;
  onLayout?: () => void;
  onSave?: () => void;
  onManageLayouts?: () => void;
  onQuickSearch?: () => void;
  onSettings?: () => void;
  onSnapshot?: () => void;
}

/** 外部驱动工具栏显示状态的句柄（单一真相在 store，工具栏只负责呈现）。 */
export interface ToolbarHandle {
  root: HTMLElement;
  setSymbol(name: string): void;
  /** 周期码：1m / 5m / … / 1D / 1W / 1M */
  setInterval(code: string): void;
  setStyle(label: string): void;
  setLayoutName(name: string): void;
  setIndicatorsOn(on: boolean): void;
  setAlertOn(on: boolean): void;
  setReplayOn(on: boolean): void;
  setUndoRedo(canUndo: boolean, canRedo: boolean): void;
}

export function createToolbar(mount: HTMLElement, cb: ToolbarCallbacks = {}): HTMLElement {
  return createToolbarHandle(mount, cb).root;
}

export function createToolbarHandle(mount: HTMLElement, cb: ToolbarCallbacks = {}): ToolbarHandle {
  injectStyle();

  const root = el('div', 'kc-toolbar');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', '图表顶部工具栏');

  const menus: HTMLElement[] = [];
  const closeMenus = (): void => { menus.forEach(m => m.classList.remove('open')); };

  /* —— 下拉菜单构建：anchor 为定位参照（root 内相对 root 绝对定位） —— */
  function buildMenu(
    anchor: HTMLElement,
    items: Array<[string, string]>,
    isIcon: boolean,
    onPick: (label: string) => void,
    initialSel = 0,
  ): HTMLElement {
    const menu = el('ul', 'kc-tb-menu');
    items.forEach(([label, payload], i) => {
      const li = el('li', i === initialSel ? 'sel' : '');
      li.innerHTML = CHECK + (isIcon ? payload : '') + `<span>${label}</span>`;
      li.addEventListener('click', e => {
        e.stopPropagation();
        menu.querySelectorAll('li').forEach(x => x.classList.remove('sel'));
        li.classList.add('sel');
        closeMenus();
        onPick(label);
      });
      menu.appendChild(li);
    });
    anchor.appendChild(menu);
    menus.push(menu);
    anchor.addEventListener('click', e => {
      e.stopPropagation();
      const was = menu.classList.contains('open');
      closeMenus();
      if (!was) menu.classList.add('open');
    });
    return menu;
  }

  function markSel(menu: HTMLElement, idx: number): void {
    menu.querySelectorAll('li').forEach((x, i) => x.classList.toggle('sel', i === idx));
  }

  /* ================= 左侧：品种 ================= */
  const gSymbol = el('div', 'kc-tb-group');
  const symWrap = el('div', 'kc-tb-symbol-wrap');
  const symBtn = el('button', 'kc-tb-symbol') as HTMLButtonElement;
  symBtn.type = 'button';
  symBtn.id = 'header-toolbar-symbol-search';
  const symName = el('span', 'name');
  symName.textContent = 'FUTUON';
  symName.appendChild(el('span', 'fade'));
  symBtn.appendChild(symName);
  symBtn.addEventListener('click', () => cb.onSymbol?.());
  const dtype = el('button', 'kc-tb-datatype') as HTMLButtonElement;
  dtype.type = 'button';
  dtype.id = 'header-toolbar-switch-data-type';
  dtype.title = '切换数据类型';
  dtype.innerHTML = `<span>${DATA_TYPE}</span>`;
  dtype.addEventListener('click', () => cb.onDataType?.());
  symWrap.append(symBtn, dtype);

  const compare = el('button', 'kc-tb-btn kc-p3') as HTMLButtonElement;
  compare.type = 'button';
  compare.id = 'header-toolbar-compare';
  compare.title = '比较商品';
  compare.innerHTML = COMPARE;
  compare.addEventListener('click', () => cb.onCompare?.());
  gSymbol.append(symWrap, compare);
  root.appendChild(gSymbol);

  /* ================= 周期 ================= */
  root.appendChild(Object.assign(el('span', 'kc-tb-div')));
  const gInt = el('div', 'kc-tb-group');
  const intBtn = el('button', 'kc-tb-btn kc-tb-interval kc-on') as HTMLButtonElement;
  intBtn.type = 'button';
  intBtn.id = 'header-toolbar-intervals';
  const intLabel = el('div', '', '天');
  intBtn.appendChild(intLabel);
  const intMenu = buildMenu(intBtn, INTERVALS, false, label => {
    intLabel.textContent = label;
    cb.onInterval?.(label, INTERVALS.find(x => x[0] === label)![1]);
  }, 6); // 默认选中「日」
  gInt.appendChild(intBtn);
  root.appendChild(gInt);

  /* ================= 图表样式 ================= */
  root.appendChild(Object.assign(el('span', 'kc-tb-div')));
  const gStyle = el('div', 'kc-tb-group');
  const styleBtn = el('button', 'kc-tb-btn') as HTMLButtonElement;
  styleBtn.type = 'button';
  styleBtn.id = 'header-toolbar-chart-styles';
  styleBtn.title = 'K线图';
  const styleIcon = el('span', '', CANDLES);
  styleIcon.style.display = 'flex';
  styleBtn.appendChild(styleIcon);
  let curStyle = 'K线图';
  const favs: string[] = (() => {
    try {
      const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as unknown;
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && STYLE_ROWS.some(r => r.label === x && !r.unavailable)) : [];
    } catch { return []; }
  })();
  const favBox = el('span', 'kc-tb-favbox kc-p2');
  favBox.style.display = 'flex';
  const styleMenu = el('ul', 'kc-tb-menu kc-sm');
  const rowEls = new Map<string, HTMLElement>();
  const pickStyle = (row: StyleRow): void => {
    if (row.unavailable) {
      cb.onStyle?.(row.label, row.unavailable);
      return;
    }
    applyStyle(row.label);
    cb.onStyle?.(row.label);
  };
  function renderFavs(): void {
    favBox.innerHTML = '';
    for (const label of favs) {
      const row = STYLE_ROWS.find(r => r.label === label);
      if (!row) continue;
      const b = el('button', 'kc-tb-btn kc-tb-fav' + (label === curStyle ? ' kc-on' : '')) as HTMLButtonElement;
      b.type = 'button';
      b.title = label;
      b.dataset.style = label;
      b.innerHTML = row.icon;
      b.addEventListener('click', () => pickStyle(row));
      favBox.appendChild(b);
    }
    rowEls.forEach((li, label) => {
      const on = favs.includes(label);
      const star = li.querySelector('.kc-sm-star');
      if (star) { star.classList.toggle('on', on); star.innerHTML = on ? SI.ST_STAR_ON : SI.ST_STAR; star.setAttribute('aria-pressed', String(on)); }
    });
  }
  STYLE_GROUPS.forEach((group, gi) => {
    if (gi > 0) styleMenu.appendChild(el('li', 'kc-sm-sep'));
    for (const row of group) {
      const li = el('li', 'kc-sm-row' + (row.unavailable ? ' na' : '') + (row.label === curStyle ? ' sel' : ''));
      li.dataset.style = row.label;
      li.title = row.unavailable ? `${row.label}：暂不可用 — ${row.unavailable}` : row.label;
      li.setAttribute('role', 'menuitem');
      li.innerHTML = row.icon;
      const lab = el('span', 'kc-sm-label');
      lab.append(row.label);
      const help = el('span', 'kc-sm-help');
      help.innerHTML = SI.ST_HELP;
      help.title = row.help;
      lab.appendChild(help);
      li.appendChild(lab);
      if (!row.unavailable) {
        const star = el('span', 'kc-sm-star');
        star.innerHTML = SI.ST_STAR;
        star.title = '收藏：在工具栏上显示快捷按钮';
        star.setAttribute('role', 'button');
        star.addEventListener('click', e => {
          e.stopPropagation();
          const k = favs.indexOf(row.label);
          if (k >= 0) favs.splice(k, 1); else favs.push(row.label);
          try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch { /* 隐私模式 */ }
          renderFavs();
        });
        li.appendChild(star);
      }
      li.addEventListener('click', e => {
        e.stopPropagation();
        closeMenus();
        pickStyle(row);
      });
      rowEls.set(row.label, li);
      styleMenu.appendChild(li);
    }
  });
  styleBtn.appendChild(styleMenu);
  menus.push(styleMenu);
  styleBtn.addEventListener('click', e => {
    e.stopPropagation();
    const was = styleMenu.classList.contains('open');
    closeMenus();
    if (!was) styleMenu.classList.add('open');
  });
  function applyStyle(label: string): void {
    const found = STYLE_ROWS.find(x => x.label === label);
    if (!found || found.unavailable) return;
    curStyle = label;
    styleIcon.innerHTML = found.icon;
    styleBtn.title = label;
    rowEls.forEach((li, l) => li.classList.toggle('sel', l === label));
    favBox.querySelectorAll('button').forEach(b => b.classList.toggle('kc-on', (b as HTMLElement).dataset.style === label));
  }
  renderFavs();
  gStyle.appendChild(styleBtn);
  gStyle.appendChild(favBox);
  root.appendChild(gStyle);

  /* ================= 指标 ================= */
  root.appendChild(Object.assign(el('span', 'kc-tb-div')));
  const gInd = el('div', 'kc-tb-group');
  const indBtn = el('button', 'kc-tb-btn') as HTMLButtonElement;
  indBtn.type = 'button';
  indBtn.id = 'header-toolbar-indicators';
  indBtn.title = '指标、衡量标准和策略';
  indBtn.innerHTML = `${INDICATORS}<div class="kc-tb-label">指标</div>`;
  indBtn.addEventListener('click', () => cb.onIndicators?.());
  const indCaret = el('button', 'kc-tb-btn kc-p1') as HTMLButtonElement;
  indCaret.type = 'button';
  indCaret.title = '收藏指标';
  indCaret.innerHTML = `<span class="kc-tb-caret">${CARET_INDICATORS}</span>`;
  const tplBtn = el('button', 'kc-tb-btn kc-p1') as HTMLButtonElement;
  tplBtn.type = 'button';
  tplBtn.id = 'header-toolbar-study-templates';
  tplBtn.title = '指标模板';
  tplBtn.innerHTML = IND_TEMPLATES;
  gInd.append(indBtn, indCaret, tplBtn);
  root.appendChild(gInd);

  /* ================= 警报 / 回放 ================= */
  root.appendChild(Object.assign(el('span', 'kc-tb-div')));
  const gAlert = el('div', 'kc-tb-group');
  const alertBtn = el('button', 'kc-tb-btn kc-p3') as HTMLButtonElement;
  alertBtn.type = 'button';
  alertBtn.id = 'header-toolbar-alerts';
  alertBtn.title = '创建警报';
  alertBtn.innerHTML = `${ALERT}<div class="kc-tb-label">警报</div>`;
  alertBtn.addEventListener('click', () => {
    const on = alertBtn.classList.toggle('kc-on');
    cb.onAlert?.(on);
  });
  const replayBtn = el('button', 'kc-tb-btn') as HTMLButtonElement;
  replayBtn.type = 'button';
  replayBtn.id = 'header-toolbar-replay';
  replayBtn.title = 'K线回放';
  replayBtn.setAttribute('aria-pressed', 'false');
  replayBtn.innerHTML = `${REPLAY}<div class="kc-tb-label">回放</div>`;
  replayBtn.addEventListener('click', () => {
    const on = replayBtn.classList.toggle('kc-on');
    replayBtn.setAttribute('aria-pressed', String(on));
    cb.onReplay?.(on);
  });
  gAlert.append(alertBtn, replayBtn);
  root.appendChild(gAlert);

  /* ================= 撤销 / 重做 ================= */
  root.appendChild(Object.assign(el('span', 'kc-tb-div')));
  const gUndo = el('div', 'kc-tb-group kc-p2');
  const undo = el('button', 'kc-tb-btn') as HTMLButtonElement;
  undo.type = 'button'; undo.disabled = true; undo.title = '撤销';
  undo.addEventListener('click', () => cb.onUndo?.());
  undo.innerHTML = `<span style="padding:5px">${UNDO}</span>`;
  const redo = el('button', 'kc-tb-btn') as HTMLButtonElement;
  redo.type = 'button'; redo.disabled = true; redo.title = '重做';
  redo.addEventListener('click', () => cb.onRedo?.());
  redo.innerHTML = `<span style="padding:5px">${REDO}</span>`;
  gUndo.append(undo, redo);
  root.appendChild(gUndo);

  /* ================= 弹性占位 ================= */
  root.appendChild(el('div', 'kc-tb-spacer'));

  /* ================= 布局 / 保存 ================= */
  const gRight = el('div', 'kc-tb-group');
  const layoutBtn = el('button', 'kc-tb-btn') as HTMLButtonElement;
  layoutBtn.type = 'button';
  layoutBtn.id = 'header-toolbar-layouts';
  layoutBtn.title = '布局设置';
  layoutBtn.style.width = '38px';
  layoutBtn.innerHTML = `<span style="display:block">${LAYOUT}</span>`;
  layoutBtn.addEventListener('click', () => cb.onLayout?.());
  const save = el('button', 'kc-tb-btn') as HTMLButtonElement;
  save.type = 'button';
  save.id = 'header-toolbar-save-load';
  save.title = '所有更改已保存';
  save.style.minWidth = '65px';
  save.style.padding = '0 6px 0 5px';
  save.innerHTML = `<div class="kc-tb-save"><span class="name">Unnamed</span><span class="state">保存</span></div>`;
  const saveName = save.querySelector('.name') as HTMLElement;
  save.addEventListener('click', () => cb.onSave?.());
  const saveCaret = el('button', 'kc-tb-btn kc-p3') as HTMLButtonElement;
  saveCaret.type = 'button';
  saveCaret.title = '管理布局';
  saveCaret.addEventListener('click', () => cb.onManageLayouts?.());
  saveCaret.innerHTML = `<span class="kc-tb-caret">${CARET_LAYOUT}</span>`;
  gRight.append(layoutBtn, save, saveCaret);
  root.appendChild(gRight);

  /* ================= 搜索 / 设置 / 全屏 / 快照 ================= */
  root.appendChild(Object.assign(el('span', 'kc-tb-div')));
  const gUtil = el('div', 'kc-tb-group');
  const quick = el('button', 'kc-tb-btn kc-p2') as HTMLButtonElement;
  quick.type = 'button';
  quick.id = 'header-toolbar-quick-search';
  quick.title = '快速搜索';
  quick.innerHTML = QUICK_SEARCH;
  quick.addEventListener('click', () => cb.onQuickSearch?.());
  const props = el('button', 'kc-tb-btn kc-p2') as HTMLButtonElement;
  props.type = 'button';
  props.id = 'header-toolbar-properties';
  props.title = '设置';
  props.innerHTML = SETTINGS;
  props.addEventListener('click', () => cb.onSettings?.());
  const full = el('button', 'kc-tb-btn') as HTMLButtonElement;
  full.type = 'button';
  full.id = 'header-toolbar-fullscreen';
  full.title = '全屏模式';
  full.innerHTML = FULLSCREEN;
  full.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  });
  const shot = el('button', 'kc-tb-btn kc-p1') as HTMLButtonElement;
  shot.type = 'button';
  shot.title = '生成快照';
  shot.innerHTML = `<div id="header-toolbar-screenshot" style="padding:0 5px">${SNAPSHOT}</div>`;
  shot.addEventListener('click', () => cb.onSnapshot?.());
  gUtil.append(quick, props, full, shot);
  root.appendChild(gUtil);

  /* —— 菜单外点击 / Esc 关闭 —— */
  const onDocClick = (): void => closeMenus();
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeMenus(); };
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);

  mount.appendChild(root);

  const handle: ToolbarHandle = {
    root,
    setSymbol(name) {
      symName.firstChild!.textContent = name;
    },
    setInterval(code) {
      const idx = INTERVALS.findIndex(x => x[1] === code);
      if (idx < 0) return;
      intLabel.textContent = INTERVALS[idx][0];
      markSel(intMenu, idx);
    },
    setStyle: applyStyle,
    setLayoutName(name) {
      saveName.textContent = name;
      save.title = name;
    },
    setIndicatorsOn(on) { indBtn.classList.toggle('kc-on', on); },
    setAlertOn(on) { alertBtn.classList.toggle('kc-on', on); },
    setReplayOn(on) {
      replayBtn.classList.toggle('kc-on', on);
      replayBtn.setAttribute('aria-pressed', String(on));
    },
    setUndoRedo(canUndo, canRedo) {
      undo.disabled = !canUndo;
      redo.disabled = !canRedo;
    },
  };
  // 卸载时摘掉全局监听（React 严格模式会挂载两次）
  const obs = new MutationObserver(() => {
    if (!root.isConnected) {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      obs.disconnect();
    }
  });
  obs.observe(mount, { childList: true });
  return handle;
}
