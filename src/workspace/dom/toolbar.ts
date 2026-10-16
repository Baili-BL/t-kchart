// kc-toolbar —— 图表页顶部横排工具栏
// 依据设计稿 1:1 还原：
// 高 38px、白底、文字 rgb(15,15,15)、分隔线 rgb(235,235,235)、
// 悬停底 rgb(242,242,242)、强调色 rgb(41,98,255)。
// 用法：createToolbar(document.getElementById('mount'));
// 需要从外部同步状态（品种 / 周期 / 布局名 / 撤销态）时用 createToolbarHandle。
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
// 手绘的三枚 28×28 备用图形（K线以外的图表样式）
const I_BARS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><g stroke="currentColor" stroke-width="1.6" fill="none"><path d="M6 6v16M4 8h4M4 20h4"/><path d="M14 4v18M12 6h4M12 18h4"/><path d="M22 8v14M20 10h4M20 20h4"/></g></svg>';
const I_LINE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><path stroke="currentColor" stroke-width="1.6" fill="none" d="M3 20l6-8 5 4 5-9 6 5"/></svg>';
const I_AREA = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28"><path fill="currentColor" opacity=".25" d="M3 20l6-8 5 4 5-9 6 5v10H3z"/><path stroke="currentColor" stroke-width="1.6" fill="none" d="M3 20l6-8 5 4 5-9 6 5"/></svg>';

const INTERVALS: Array<[string, string]> = [
  ['1分', '1m'], ['5分', '5m'], ['15分', '15m'], ['30分', '30m'],
  ['1时', '1h'], ['4时', '4h'], ['天', '1D'], ['周', '1W'], ['月', '1M'],
];

const CHART_STYLES: Array<[string, string]> = [
  ['K线图', CANDLES], ['美国线', I_BARS], ['线形图', I_LINE], ['面积图', I_AREA],
];

const CHECK = '<svg class="check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="14" height="14" fill="none"><path stroke="currentColor" stroke-width="1.6" d="M2.5 7.5l3 3 6-7"/></svg>';

/* ------------------------------------------------------------------ 组件 */
export interface ToolbarCallbacks {
  onSymbol?: () => void;
  onInterval?: (label: string, code: string) => void;
  onStyle?: (label: string) => void;
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
  const styleMenu = buildMenu(styleBtn, CHART_STYLES, true, label => {
    applyStyle(label);
    cb.onStyle?.(label);
  }, 0);
  function applyStyle(label: string): void {
    const found = CHART_STYLES.find(x => x[0] === label);
    if (!found) return;
    styleIcon.innerHTML = found[1];
    styleBtn.title = label;
    markSel(styleMenu, CHART_STYLES.findIndex(x => x[0] === label));
  }
  gStyle.appendChild(styleBtn);
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
