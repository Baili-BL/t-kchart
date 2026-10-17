// kc-sidebar —— 图表页左侧纵向绘图工具栏
// 依据设计稿 1:1 还原：
// 宽 52px、白底、行高 38px、图标 28×28；悬停/选中为 34×34 圆角药丸
// （悬停 rgb(242,242,242)，选中 rgb(235,235,235)）；带小箭头的按钮悬停时
// 右侧浮现 11px 宽箭头区（borderRadius 4px 0 0 4px），点击弹出子菜单；
// 箭头开合动画 cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.5s。
// 用法：createSidebar(document.getElementById('mount'));
import {
  CROSS, TRENDLINE, FIB, PATTERN, LONG_POS, BRUSH, TEXT, STICKER,
  MEASURE, ZOOM, MAGNET, STAY_DRAWING, LOCK, HIDE_ALL, TRASH, CARET,
  DOT, ARROW_ICON, HIGHLIGHTER, ERASER,
  RAY_ICON, INFOLINE_ICON, EXTLINE_ICON, ANGLE_ICON,
  HLINE_ICON, HRAY_ICON, VLINE_ICON, CROSSLINE_ICON,
  STAR, INFO_BADGE,
  FIBEXT_ICON, FIBCHAN_ICON, FIBTZ_ICON, FIBFAN_ICON, FIBTTZ_ICON,
  FIBCIRC_ICON, FIBSPI_ICON, FIBARC_ICON, FIBWEDGE_ICON, TILTFAN_ICON,
  GANNBOX_ICON, GANNSQF_ICON, GANNSQ_ICON,
  XABCD_ICON, SHARK_ICON, HS_ICON, ABCD_ICON, TRIPAT_ICON, DRV3_ICON,
  EW_IMP_ICON, EW_CORR_ICON, EW_TRI_ICON, EW_WXY_ICON, EW_WXYZ_ICON,
  CYCLE_ICON, TIMECYC_ICON, SINE_ICON,
  LONGPOS_ICON, SHORTPOS_ICON, FORECAST_ICON, KPATTERN_ICON, SIMCANDLE_ICON,
  FAN_ICON, AVWAP_ICON, VPROFILE_ICON, AVPROFILE_ICON,
  PRANGE_ICON, DRANGE_ICON, DPRANGE_ICON,
  ARROWMARK, UPARROW, DNARROW, RECT_ICON, ROTRECT, PATH_ICON,
  CIRCLE_ICON, ELLIPSE_ICON, POLYLINE_ICON, TRIANGLE_ICON, ARC_ICON,
  CURVE_ICON, HYPERBOLA,
  FORK, PITCHFAN, NOTE_ICON, CALLOUT_ICON, COMMENT_ICON, BALLOON_ICON,
  PRICENOTE_ICON, PRICELABEL_ICON, SIGNPOST_ICON,
  CIRCLELINES_ICON, BEZIERCUBIC_ICON, FLATBOTTOM_ICON, ARROWL_ICON, ARROWR_ICON,
} from './sidebar-icons';
import {
  EMOJI_CATEGORIES, EMOJI_CLOCK_ICON, loadEmojiRecents, saveEmojiRecent,
} from './emoji-data';

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
.kc-sidebar {
  display: flex; flex-direction: column; flex: 0 0 auto; width: 52px;
  background: rgb(235,235,235); color: rgb(15,15,15); user-select: none; position: relative; z-index: 100;
  font: 400 14px/normal -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  font-feature-settings: "lnum","tnum";
  overflow-y: auto; overflow-x: hidden; scrollbar-width: none;
}
.kc-sidebar::-webkit-scrollbar { display: none; }
.kc-sb-section { background: #fff; padding: 6px 0; position: relative; }
.kc-sb-div { height: 1px; background: rgb(235,235,235); margin: 0 8px; }
.kc-sb-section + .kc-sb-div + .kc-sb-section { padding-bottom: 6px; }
/* —— 工具行：52×38，主按钮 + 悬停浮现的箭头区 —— */
.kc-sb-tool { position: relative; width: 52px; }
.kc-sb-btn {
  position: relative; z-index: 0; display: block; width: 52px; height: 38px;
  border: 0; background: transparent; padding: 0; cursor: pointer;
  transition: background-color .06s ease, opacity .06s ease, color .06s ease;
}
.kc-sb-btn > svg { position: absolute; left: 12px; top: 5px; }
.kc-sb-btn .pill {
  position: absolute; z-index: -1; left: 9px; right: 9px; top: 2px; bottom: 2px;
  width: 34px; height: 34px; border-radius: 6px; background: transparent;
}
.kc-sb-btn:hover .pill { background: rgb(242,242,242); }
.kc-sb-btn.kc-sel .pill { background: rgb(235,235,235); }
.kc-sb-btn.kc-on .pill { background: rgb(231,240,255); }
/* —— 小箭头：默认隐藏，悬停浮现。（z-index 必须高于主按钮：btn 在 DOM 里更靠后，否则箭头永远被盖住点不到） —— */
.kc-sb-caret {
  position: absolute; right: 0; top: 2px; width: 11px; height: 34px; z-index: 1;
  border: 0; padding: 0; background: transparent; cursor: pointer;
  border-radius: 4px 0 0 4px; opacity: 0; overflow: hidden;
  transition: opacity .1s ease;
}
.kc-sb-tool:hover .kc-sb-caret { opacity: 1; }
.kc-sb-caret > svg { position: absolute; left: 3px; top: 13px; width: 4px; height: 7px; fill: rgb(15,15,15); transition: transform .5s cubic-bezier(.175,.885,.32,1.275); }
.kc-sb-caret:hover > svg { transform: scale(1.25); }
.kc-sb-tool.open .kc-sb-caret > svg { transform: rotate(180deg); }
/* —— 子菜单：白卡阴影，右侧弹出。挂在 body 下用 fixed 定位，
      避免 sidebar 的 overflow-x:hidden 把整张菜单裁掉（裁剪后既不可见也不可点） —— */
.kc-sb-menu {
  position: fixed; min-width: 220px; padding: 6px 0; margin: 0;
  list-style: none; background: #fff; border-radius: 6px;
  box-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04);
  font-size: 13px; z-index: 1200; display: none;
}
.kc-sb-menu.open { display: block; }
/* —— emoji 面板（设计稿「图标」按钮）：顶部分类 tab + 滚动网格 —— */
.kc-emoji-panel {
  position: fixed; width: 434px; padding: 8px 10px 10px; background: #fff;
  border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04);
  z-index: 1200; font-size: 13px; display: none; user-select: none;
}
.kc-emoji-panel.open { display: block; }
.kc-emoji-tabs {
  display: flex; align-items: center; gap: 2px; padding-bottom: 6px; margin-bottom: 4px;
  border-bottom: 1px solid rgb(235,235,235);
}
.kc-emoji-tabs button {
  width: 40px; height: 32px; border: 0; background: transparent; border-radius: 6px;
  cursor: pointer; color: rgb(15,15,15); display: flex; align-items: center; justify-content: center;
  transition: background-color .06s ease;
}
.kc-emoji-tabs button:hover { background: rgb(242,242,242); }
.kc-emoji-body { max-height: 330px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.kc-emoji-group { margin: 8px 0 2px; color: rgb(130,130,130); font-size: 13px; }
.kc-emoji-grid { display: grid; grid-template-columns: repeat(9, 44px); }
.kc-emoji-grid button {
  width: 44px; height: 42px; border: 0; background: transparent; border-radius: 6px; cursor: pointer;
  font-size: 26px; line-height: 42px; padding: 0; font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  transition: background-color .06s ease;
}
.kc-emoji-grid button:hover { background: rgb(242,242,242); }
.kc-sb-menu li {
  display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; cursor: pointer;
  transition: background-color .06s ease; white-space: nowrap;
}
.kc-sb-menu li:hover { background: rgb(242,242,242); }
.kc-sb-menu li > svg { flex: 0 0 auto; }
/* 选中项：整行灰底（设计稿 rgb(240,240,243)），文字保持墨色 */
.kc-sb-menu li.sel { background: rgb(240,240,243); color: rgb(15,15,15); }
/* —— 子菜单内的分隔线 + 开关行（设计稿「长按时显示数值工具提示」） —— */
.kc-sb-menu .kc-menu-div { height: 1px; margin: 5px 12px; padding: 0; background: rgb(218,218,218); cursor: default; }
.kc-sb-menu .kc-menu-div:hover { background: rgb(218,218,218); }
.kc-menu-toggle {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  height: 34px; padding: 0 12px; font-size: 13px; cursor: pointer; white-space: nowrap;
  transition: background-color .06s ease;
}
.kc-menu-toggle:hover { background: rgb(242,242,242); }
.kc-menu-switch {
  position: relative; flex: 0 0 auto; width: 34px; height: 20px; border-radius: 10px;
  background: rgb(15,15,15); transition: background-color .15s ease;
}
.kc-menu-switch::after {
  content: ''; position: absolute; left: 15px; top: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: left .15s ease;
}
.kc-menu-toggle.off .kc-menu-switch { background: rgb(200,200,200); }
.kc-menu-toggle.off .kc-menu-switch::after { left: 3px; }
/* —— 分组标题 / 快捷键提示 / 信息徽标 / 收藏星（设计稿「趋势线」子菜单） —— */
.kc-sb-menu .kc-menu-group {
  display: block; height: auto; padding: 8px 12px 2px; margin: 0;
  color: rgb(140,140,145); font-size: 11px; cursor: default;
}
.kc-sb-menu .kc-menu-group:hover { background: transparent; }
.kc-sb-menu li .kc-li-spacer { flex: 1 1 auto; }
.kc-sb-menu li .kc-menu-key { color: rgb(140,140,145); font-size: 12px; }
.kc-sb-menu li .kc-info-badge { display: inline-flex; }
.kc-sb-menu li .kc-star {
  display: inline-flex; color: rgb(15,15,15); opacity: 0; cursor: pointer;
  transition: opacity .1s ease;
}
.kc-sb-menu li:hover .kc-star { opacity: 0.55; }
.kc-sb-menu li .kc-star:hover { opacity: 1; }
.kc-sb-menu li .kc-star.on { opacity: 1; color: #f0a70a; }
.kc-sb-menu li .kc-star.on svg path { fill: #f0a70a; stroke: #f0a70a; }
`;

function injectStyle(): void {
  if (document.getElementById('kc-sidebar-css')) return;
  const s = document.createElement('style');
  s.id = 'kc-sidebar-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------- 子菜单数据 */
// 主图标 / 箭头图标 / 悬停标题 / 子菜单项（标签 + 图标）。
// 「十字线」子菜单 = 光标工具组，按设计稿：十字线/圆点/箭头/荧光笔/橡皮擦 + 长按提示开关。
// 「趋势线」子菜单 = 线工具组，按设计稿分组：「线」组（趋势线⌥T/射线/信息线/延长线/趋势角度）
// + 水平组（水平线⌥H/水平射线⌥J/垂直线⌥V/横线⌥C）；箭头/平行通道作为补充组保留入口。
type MenuItem = [label: string, icon: string, hint?: string] | [label: string, icon: string, hint?: string, badge?: 'info'];
interface ToolDef {
  icon: string; caret?: string; label: string;
  items?: MenuItem[];
  /** 分组子菜单：有 label 时渲染灰色小标题行（设计稿「线」） */
  groups?: Array<{ label?: string; items: MenuItem[] }>;
  /** 子菜单末尾（分隔线之下）的开关行；点击走 onToggle */
  toggle?: { label: string; on?: boolean };
}
type Section = { pad?: string; tools: ToolDef[] };

export const LONGPRESS_TIP_LABEL = '长按时显示数值工具提示';

// 分段与原稿分隔线位置一致：十字线 | 趋势/斐波 | 形态/仓位/笔刷/文字 | 图标 |
// 测量/放大 | 磁铁/继续/锁定/隐藏 | 移除。
const SECTIONS: Section[] = [
  { tools: [
    { icon: CROSS, caret: CARET, label: '十字线', items: [
      ['十字线', CROSS], ['圆点', DOT], ['箭头', ARROW_ICON], ['荧光笔', HIGHLIGHTER], ['橡皮擦', ERASER],
    ], toggle: { label: LONGPRESS_TIP_LABEL, on: true } },
  ]},
  { tools: [
    { icon: TRENDLINE, caret: CARET, label: '趋势线', groups: [
      { label: '线', items: [
        ['趋势线', TRENDLINE, '⌥T'],
        ['射线', RAY_ICON],
        ['信息线', INFOLINE_ICON, undefined, 'info'],
        ['延长线', EXTLINE_ICON],
        ['趋势角度', ANGLE_ICON],
      ] },
      { items: [
        ['水平线', HLINE_ICON, '⌥H'],
        ['水平射线', HRAY_ICON, '⌥J'],
        ['垂直线', VLINE_ICON, '⌥V'],
        ['横线', CROSSLINE_ICON, '⌥C'],
      ] },
      { items: [
        ['箭头', ARROW_ICON],
        ['平行通道', TRENDLINE],
      ] },
    ] },
    { icon: FIB, caret: CARET, label: '斐波那契回撤', groups: [
      { label: '斐波那契', items: [
        ['斐波那契回撤', FIB, '⌥F'],
        ['斐波那契趋势扩展', FIBEXT_ICON],
        ['斐波那契通道', FIBCHAN_ICON],
        ['斐波那契时区', FIBTZ_ICON],
        ['斐波那契速度阻力扇', FIBFAN_ICON],
        ['斐波那契趋势时间', FIBTTZ_ICON],
        ['斐波那契圆', FIBCIRC_ICON],
        ['斐波那契螺旋', FIBSPI_ICON],
        ['斐波那契速度阻力弧', FIBARC_ICON],
        ['斐波那契楔形', FIBWEDGE_ICON],
        ['倾斜扇形', TILTFAN_ICON],
      ] },
      { label: '江恩', items: [
        ['江恩箱', GANNBOX_ICON],
        ['固定江恩正方', GANNSQF_ICON],
        ['江恩正方', GANNSQ_ICON],
      ] },
      { label: '音叉', items: [
        ['安德鲁音叉', FORK],
        ['希夫音叉', FORK],
        ['改良希夫音叉', FORK],
        ['内部分叉', FORK],
        ['扇形分叉', PITCHFAN],
      ] },
    ] },
  ]},
  { tools: [
    { icon: PATTERN, caret: CARET, label: 'XABCD形态', groups: [
      { label: '图表形态', items: [
        ['XABCD形态', XABCD_ICON],
        ['赛福形态', SHARK_ICON],
        ['头肩形态', HS_ICON],
        ['ABCD形态', ABCD_ICON],
        ['三角形态', TRIPAT_ICON],
        ['三驱形态', DRV3_ICON],
      ] },
      { label: '艾略特波浪', items: [
        ['艾略特脉冲波（1-2-3-4-5）', EW_IMP_ICON],
        ['艾略特修正波（A-B-C）', EW_CORR_ICON],
        ['艾略特三角波（A-B-C-D-E）', EW_TRI_ICON],
        ['艾略特双重组合浪（W-X-Y）', EW_WXY_ICON],
        ['艾略特三重组合浪（W-X-Y-Z）', EW_WXYZ_ICON],
      ] },
      { label: '循环', items: [
        ['循环线', CYCLE_ICON],
        ['时间循环', TIMECYC_ICON],
        ['正弦线', SINE_ICON],
      ] },
    ] },
    { icon: LONG_POS, caret: CARET, label: '多头仓位', groups: [
      { label: '预测', items: [
        ['多头仓位', LONGPOS_ICON],
        ['空头仓位', SHORTPOS_ICON],
        ['仓位预测', FORECAST_ICON],
        ['K线形态', KPATTERN_ICON],
        ['模拟K线', SIMCANDLE_ICON],
        ['扇形', FAN_ICON],
      ] },
      { label: '基于成交量', items: [
        ['锚定VWAP', AVWAP_ICON],
        ['固定范围成交量分布图', VPROFILE_ICON],
        ['锚定成交量分布图', AVPROFILE_ICON],
      ] },
      { label: '测量', items: [
        ['价格范围', PRANGE_ICON],
        ['日期范围', DRANGE_ICON],
        ['日期和价格范围', DPRANGE_ICON],
      ] },
    ] },
    { icon: BRUSH, caret: CARET, label: '笔刷', groups: [
      { label: '笔刷', items: [
        ['笔刷', BRUSH],
        ['荧光笔', HIGHLIGHTER],
      ] },
      { label: '箭头', items: [
        ['箭头标记', ARROWMARK],
        ['箭头', ARROW_ICON],
        ['向上箭头', UPARROW],
        ['向下箭头', DNARROW],
        ['左箭头', ARROWL_ICON],
        ['右箭头', ARROWR_ICON],
      ] },
      { label: '形状', items: [
        ['矩形', RECT_ICON, '⌥R'],
        ['旋转矩形', ROTRECT],
        ['路径', PATH_ICON],
        ['圆', CIRCLE_ICON],
        ['椭圆', ELLIPSE_ICON],
        ['折线', POLYLINE_ICON],
        ['三角形', TRIANGLE_ICON],
        ['弧形', ARC_ICON],
        ['曲线', CURVE_ICON],
        ['双曲线', HYPERBOLA],
        ['圆加十字线', CIRCLELINES_ICON],
        ['三次贝塞尔', BEZIERCUBIC_ICON],
        ['平底', FLATBOTTOM_ICON],
      ] },
    ] },
    { icon: TEXT, caret: CARET, label: '文字', groups: [
      { label: '文本', items: [
        ['文字', TEXT],
        ['标注', CALLOUT_ICON],
        ['评论', COMMENT_ICON],
        ['气泡', BALLOON_ICON],
        ['便签', NOTE_ICON],
        ['价格便签', PRICENOTE_ICON],
        ['价格标签', PRICELABEL_ICON],
        ['路标', SIGNPOST_ICON],
      ] },
      { label: '形状', items: [
        ['椭圆', ELLIPSE_ICON],
        ['日期范围', DRANGE_ICON],
      ] },
    ] },
  ]},
  { tools: [
    { icon: STICKER, label: '图标' },
  ]},
  { tools: [
    { icon: MEASURE, label: '测量' },
    { icon: ZOOM, label: '放大' },
  ]},
  { tools: [
    { icon: MAGNET, caret: CARET, label: '磁铁模式会将放置在价格K线附近的绘图吸附到最近的OHLC值。', items: [['磁铁', MAGNET], ['强力磁铁', MAGNET], ['弱磁铁', MAGNET]] },
    { icon: STAY_DRAWING, label: '继续绘图' },
    { icon: LOCK, caret: CARET, label: '锁定绘图和指标', items: [['锁定所有绘图', LOCK], ['锁定指标', LOCK]] },
    { icon: HIDE_ALL, caret: CARET, label: '隐藏所有图形', items: [['隐藏所有图形', HIDE_ALL], ['隐藏绘图', HIDE_ALL], ['隐藏指标', HIDE_ALL]] },
  ]},
  { pad: '0 0 20px', tools: [
    { icon: TRASH, caret: CARET, label: '移除对象', items: [['移除图形', TRASH], ['移除指标', TRASH], ['移除全部', TRASH]] },
  ]},
];

/* ------------------------------------------------------------------ 组件 */
export interface SidebarCallbacks {
  onTool?: (label: string) => void;
  onToggle?: (label: string, on: boolean) => void;
  /** emoji 面板选中一个字符（设计稿「图标」按钮） */
  onEmoji?: (char: string) => void;
}

/* —— 收藏（设计稿悬停行右侧的星标），localStorage 持久化 —— */
const FAV_KEY = 'kc-draw-favs';
function loadFavs(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]') as string[]); }
  catch (_e) { return new Set(); }
}
function saveFavs(s: Set<string>): void {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...s])); } catch (_e) { /* 忽略 */ }
}

/**
 * 工具子菜单：分组（灰色小标题）+ 行（图标 标签 [徽标] [快捷键] [收藏星]）+ 末尾开关行。
 * pick 在用户点某一行时回调。
 */
function buildToolMenu(t: ToolDef, pick: (label: string) => void): HTMLUListElement {
  const menu = el('ul', 'kc-sb-menu');
  const favs = loadFavs();
  const groups = t.groups ?? [{ items: t.items ?? [] }];
  for (const g of groups) {
    if (g.label) {
      const gl = el('li', 'kc-menu-group');
      gl.textContent = g.label;
      menu.appendChild(gl);
    }
    for (const item of g.items) {
      const [label, icon, hint, badge] = item;
      const li = el('li');
      li.innerHTML = icon + `<span>${label}</span>`
        + (badge === 'info' ? `<span class="kc-info-badge">${INFO_BADGE}</span>` : '')
        + '<span class="kc-li-spacer"></span>'
        + (hint ? `<span class="kc-menu-key">${hint}</span>` : '')
        + `<span class="kc-star${favs.has(label) ? ' on' : ''}" title="收藏">${STAR}</span>`;
      const star = li.querySelector('.kc-star') as HTMLElement;
      star.addEventListener('click', e => {
        e.stopPropagation();
        const on = !favs.has(label);
        if (on) favs.add(label); else favs.delete(label);
        saveFavs(favs);
        star.classList.toggle('on', on);
      });
      li.addEventListener('click', e => {
        e.stopPropagation();
        menu.querySelectorAll('li').forEach(x => x.classList.remove('sel'));
        li.classList.add('sel');
        pick(label);
      });
      menu.appendChild(li);
    }
  }
  // 子菜单末尾的开关行（设计稿：分隔线 + 「长按时显示数值工具提示」）
  if (t.toggle) {
    const div = el('li', 'kc-menu-div');
    menu.appendChild(div);
    const row = el('div', 'kc-menu-toggle' + (t.toggle.on === false ? ' off' : ''));
    row.innerHTML = `<span>${t.toggle.label}</span><span class="kc-menu-switch"></span>`;
    row.addEventListener('click', e => {
      e.stopPropagation();
      const on = row.classList.toggle('off') === false;
      cb_onToggle(t.toggle!.label, on);
    });
    menu.appendChild(row);
  }
  return menu;
}

/**
 * emoji 面板（设计稿「图标」按钮）：顶部 9 分类 tab + 滚动网格（最近使用 + 各分组）。
 * 点选 emoji 后回调 onEmoji 并记录到 localStorage 最近使用。
 */
function buildEmojiPanel(onEmoji: (char: string) => void): HTMLDivElement {
  const panel = el('div', 'kc-emoji-panel');
  const tabs = el('div', 'kc-emoji-tabs');
  const body = el('div', 'kc-emoji-body');

  let recents = loadEmojiRecents();
  const renderGroups = (): void => {
    body.innerHTML = '';
    recents = loadEmojiRecents();
    const groups: { label: string; items: string[] }[] = [];
    if (recents.length) groups.push({ label: '最近使用', items: recents });
    for (const cat of EMOJI_CATEGORIES) groups.push({ label: cat.label, items: cat.items });
    for (const g of groups) {
      const title = el('div', 'kc-emoji-group');
      title.textContent = g.label;
      body.appendChild(title);
      const grid = el('div', 'kc-emoji-grid');
      for (const ch of g.items) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = ch;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          saveEmojiRecent(ch);
          renderGroups(); // 最近使用行即时刷新
          onEmoji(ch);
        });
        grid.appendChild(b);
      }
      body.appendChild(grid);
    }
  };
  renderGroups();

  // tab：时钟 = 回顶部（最近使用）；其余点击滚动到对应分组
  const topTab = document.createElement('button');
  topTab.type = 'button';
  topTab.title = '最近使用';
  topTab.setAttribute('aria-label', '最近使用');
  topTab.innerHTML = EMOJI_CLOCK_ICON;
  topTab.addEventListener('click', (e) => {
    e.stopPropagation();
    body.scrollTop = 0;
  });
  tabs.appendChild(topTab);
  for (const cat of EMOJI_CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = cat.label;
    b.setAttribute('aria-label', cat.label);
    b.innerHTML = cat.icon;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = EMOJI_CATEGORIES.indexOf(cat);
      // 分组顺序 = [最近使用] + 分类 → 目标分组偏移 idx+1
      const titles = body.querySelectorAll('.kc-emoji-group');
      const target = titles[recents.length ? idx + 1 : idx];
      if (target) body.scrollTop = (target as HTMLElement).offsetTop - 4;
    });
    tabs.appendChild(b);
  }

  panel.appendChild(tabs);
  panel.appendChild(body);
  return panel;
}

// 开关行的回调由 createSidebar 注入（buildToolMenu 在模块层定义，避免每层传参）
let cb_onToggle: (label: string, on: boolean) => void = () => { /* 由 createSidebar 赋值 */ };

export function createSidebar(mount: HTMLElement, cb: SidebarCallbacks = {}): HTMLElement {
  injectStyle();
  cb_onToggle = (label, on) => cb.onToggle?.(label, on);
  // 组件单例：清理上次 mount 残留在 body 下的子菜单（React 严格模式 / 热重载会重复挂载）
  document.body.querySelectorAll(':scope > .kc-sb-menu, :scope > .kc-emoji-panel').forEach(m => m.remove());

  const root = el('div', 'kc-sidebar');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-orientation', 'vertical');
  root.setAttribute('aria-label', '左侧绘图工具栏');

  const menus: HTMLElement[] = [];
  const closeMenus = (except?: HTMLElement): void => {
    menus.forEach(m => { if (m !== except) m.classList.remove('open'); });
    root.querySelectorAll('.kc-sb-tool.open').forEach(c => c.classList.remove('open'));
  };
  /** 菜单挂在 body 下（fixed）：贴着 cell 右缘弹出，底部越界时上收 */
  const openMenuAt = (menu: HTMLElement, cell: HTMLElement): void => {
    menu.classList.add('open');
    cell.classList.add('open');
    const r = cell.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let x = r.right + 2;
    if (x + mw > window.innerWidth - 8) x = Math.max(8, r.left - mw - 2);
    const y = Math.max(8, Math.min(r.top, window.innerHeight - mh - 8));
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  };

  let selected: HTMLButtonElement | null = null;
  const pick = (btn: HTMLButtonElement, label: string): void => {
    selected?.classList.remove('kc-sel');
    btn.classList.add('kc-sel');
    selected = btn;
    cb.onTool?.(label);
  };

  // emoji 面板（设计稿「图标」按钮）：挂 body fixed 定位，选中字符回调 onEmoji
  const emojiPanel = buildEmojiPanel((ch) => {
    closeMenus();
    cb.onEmoji?.(ch);
  });
  document.body.appendChild(emojiPanel);
  menus.push(emojiPanel);

  for (const section of SECTIONS) {
    const sec = el('div', 'kc-sb-section');
    if (section.pad) sec.style.padding = section.pad;
    for (const t of section.tools) {
      const cell = el('div', 'kc-sb-tool');
      const btn = el('button', 'kc-sb-btn') as HTMLButtonElement;
      btn.type = 'button';
      btn.tabIndex = -1;
      btn.setAttribute('aria-label', t.label);
      btn.title = t.label;
      btn.innerHTML = `<span class="pill"></span>${t.icon}`;
      if (t.caret) {
        const caret = el('button', 'kc-sb-caret') as HTMLButtonElement;
        // 主按钮：工具类 → 选中；开关类 → 直接切换
        btn.addEventListener('click', () => {
          if (['锁定绘图和指标', '隐藏所有图形', '移除对象'].includes(t.label)) {
            const on = btn.classList.toggle('kc-on');
            cb.onToggle?.(t.label, on);
          } else {
            pick(btn, t.label);
          }
        });
        caret.type = 'button';
        caret.tabIndex = -1;
        caret.setAttribute('aria-label', t.label + '（子菜单）');
        caret.innerHTML = t.caret;
        const menu = buildToolMenu(t, (label) => {
          closeMenus();
          pick(btn, label);
        });
        caret.addEventListener('click', e => {
          e.stopPropagation();
          const was = menu.classList.contains('open');
          closeMenus();
          if (!was) openMenuAt(menu, cell);
        });
        menus.push(menu);
        cell.appendChild(caret);
        // 菜单挂 body（fixed 定位），避免被 sidebar 的 overflow 裁剪；cell 只留引用关系
        document.body.appendChild(menu);
      } else {
        btn.addEventListener('click', (e) => {
          if (t.label === '继续绘图') {
            const on = btn.classList.toggle('kc-on');
            cb.onToggle?.(t.label, on);
          } else if (t.label === '图标') {
            // 「图标」→ emoji 面板（设计稿直开面板，无子菜单箭头）；
            // 阻止冒泡到 document 的 closeMenus，否则刚打开就被关掉
            e.stopPropagation();
            const was = emojiPanel.classList.contains('open');
            closeMenus();
            if (!was) { pick(btn, t.label); openMenuAt(emojiPanel, cell); }
          } else {
            pick(btn, t.label);
          }
        });
      }
      cell.appendChild(btn);
      sec.appendChild(cell);
    }
    root.appendChild(sec);
    root.appendChild(el('div', 'kc-sb-div'));
  }

  document.addEventListener('click', () => closeMenus());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
  // sidebar 滚动时菜单不再贴合原位，直接关掉
  root.addEventListener('scroll', () => closeMenus());

  mount.appendChild(root);
  // 默认选中第一个工具（十字线），对应原稿 #ebebeb 选中药丸
  const first = root.querySelector('.kc-sb-btn') as HTMLButtonElement;
  first.classList.add('kc-sel');
  selected = first;
  return root;
}
