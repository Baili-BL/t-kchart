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
  DOT, ARROW_ICON, ARROW_CURSOR, HIGHLIGHTER, ERASER,
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
import { EMOJI_PANEL } from './emoji-panel-metrics';
import { emojiPngUrl } from '../../engine/emojiAssets';
import { toolKeyForLabel } from '../drawBus';

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
/* 深色主题：这份样式原本是写死的浅色稿，过去靠 app.css 里对 .kc-sidebar 整体
   `filter: invert(.9) hue-rotate(180deg)` 硬翻。但子菜单和 emoji 面板都挂在
   <body> 下（fixed 定位，否则会被 sidebar 的 overflow 裁掉），压根不在那个
   filter 的作用域里 —— 深色下就是「白卡 + 浅灰字」，字基本看不见。
   现在改成正经的两套色板：变量定义在 :root（body 下的弹层也能继承到），
   :root[data-theme='dark'] 换一套值；图标一律 currentColor，跟着文字色走。 */
/** 侧栏样式（导出只为单测能核对色板：深色 / 浅色两套变量都要齐全且够对比度） */
export const SIDEBAR_CSS = `
:root {
  --kcs-base: rgb(235,235,235);      /* 轨道底色（比卡片深一档） */  --kcs-card: #fff;                  /* 分组卡片（浅色下是白） */
  --kcs-ink: rgb(15,15,15);          /* 图标 / 文字 */
  --kcs-muted: rgb(140,140,145);     /* 分组标题 / 快捷键 */
  --kcs-hover: rgb(242,242,242);     /* 悬停药丸 */
  --kcs-sel: rgb(235,235,235);       /* 选中药丸 */
  --kcs-on: rgb(231,240,255);        /* 开关类按钮打开态 */
  --kcs-rule: rgb(235,235,235);      /* 分割线 */
  --kcs-pop-bg: #fff;                /* 弹层（子菜单 / emoji 面板） */
  --kcs-pop-sel: #2e2e2e;            /* 弹层里选中的那一行（官方：深底白字，不是浅灰） */
  --kcs-sel-ink: #fff;               /* 选中行的文字色 */
  --kcs-pop-div: rgb(235,235,235);   /* 弹层内分隔线（官方 #ebebeb） */
  --kcs-pop-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04);
  --kcs-sw-on: rgb(46,46,46);        /* 开关：开（官方 #2e2e2e） */
  --kcs-sw-off: rgb(156,156,156);    /* 开关：关（官方 #9c9c9c） */
  --kcs-sw-knob: #fff;
}
/* 深色：底色 / 阴影直接取 app 的 tokens（tokens.css），保证和顶栏、面板同族 */
:root[data-theme='dark'] {
  --kcs-base: var(--bg-subtle);      /* #151a20 */
  --kcs-card: var(--bg);             /* #0f1216 */
  --kcs-ink: var(--text);            /* #e8ecf1 */
  --kcs-muted: #8a919e;
  --kcs-hover: var(--bg-hover);      /* #212832 */
  --kcs-sel: var(--bg-active);       /* #29313c */
  --kcs-on: var(--accent-soft);      /* #1b2a4d */
  --kcs-rule: var(--border);         /* #242c36 */
  --kcs-pop-bg: var(--bg-sunken);    /* #1b2128 */
  --kcs-pop-sel: var(--bg-active);
  --kcs-sel-ink: var(--text);
  --kcs-pop-div: var(--border-strong);
  --kcs-pop-shadow: 0 8px 24px rgba(0,0,0,.55), 0 0 0 1px var(--border-strong);
  --kcs-sw-on: #e8ecf1;
  --kcs-sw-off: #323c49;
  --kcs-sw-knob: #0f1216;
}
.kc-sidebar {
  display: flex; flex-direction: column; flex: 0 0 auto; width: 52px;
  background: var(--kcs-base); color: var(--kcs-ink); user-select: none; position: relative; z-index: 100;
  font: 400 14px/normal -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  font-feature-settings: "lnum","tnum";
  overflow-y: auto; overflow-x: hidden; scrollbar-width: none;
}
.kc-sidebar::-webkit-scrollbar { display: none; }
.kc-sb-section { background: var(--kcs-card); padding: 6px 0; position: relative; }
.kc-sb-div { height: 1px; background: var(--kcs-base); margin: 0 8px; }
.kc-sb-section + .kc-sb-div + .kc-sb-section { padding-bottom: 6px; }
/* —— 工具行：52×38，主按钮 + 悬停浮现的箭头区 —— */
.kc-sb-tool { position: relative; width: 52px; }
.kc-sb-btn {
  position: relative; z-index: 0; display: block; width: 52px; height: 38px;
  border: 0; background: transparent; padding: 0; cursor: pointer;
  transition: background-color .06s ease, opacity .06s ease, color .06s ease;
}
/* 图标在 34×34 的 pill 里居中。用 50% + translate 而不是写死 left/top：
   28×28 的图标落点与原来 left:12/top:5 完全一致，而橡皮擦是 29×31（官方尺寸），
   写死会向右下偏 1px，居中就不会。主按钮图标会随组内选中的工具换（见 mainButtonView）。 */
.kc-sb-btn > svg { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
.kc-sb-btn .pill {
  position: absolute; z-index: -1; left: 9px; right: 9px; top: 2px; bottom: 2px;
  width: 34px; height: 34px; border-radius: 6px; background: transparent;
}
.kc-sb-btn:hover .pill { background: var(--kcs-hover); }
.kc-sb-btn.kc-sel .pill { background: var(--kcs-sel); }
.kc-sb-btn.kc-on .pill { background: var(--kcs-on); }
/* —— 小箭头：默认隐藏，悬停浮现。（z-index 必须高于主按钮：btn 在 DOM 里更靠后，否则箭头永远被盖住点不到） —— */
.kc-sb-caret {
  position: absolute; right: 0; top: 2px; width: 11px; height: 34px; z-index: 1;
  border: 0; padding: 0; background: transparent; cursor: pointer;
  border-radius: 4px 0 0 4px; opacity: 0; overflow: hidden;
  transition: opacity .1s ease;
}
.kc-sb-tool:hover .kc-sb-caret { opacity: 1; }
.kc-sb-caret > svg { position: absolute; left: 3px; top: 13px; width: 4px; height: 7px; fill: var(--kcs-ink); transition: transform .5s cubic-bezier(.175,.885,.32,1.275); }
.kc-sb-caret:hover > svg { transform: scale(1.25); }
.kc-sb-tool.open .kc-sb-caret > svg { transform: rotate(180deg); }
/* —— 子菜单：白卡阴影，右侧弹出。挂在 body 下用 fixed 定位，
      避免 sidebar 的 overflow-x:hidden 把整张菜单裁掉（裁剪后既不可见也不可点） —— */
.kc-sb-menu {
  /* 官方「光标」下拉实测：244 宽、四周 6px 内边距、14px 字；行是 232×40 的圆角块 */
  position: fixed; min-width: 244px; padding: 6px; margin: 0;
  list-style: none; background: var(--kcs-pop-bg); color: var(--kcs-ink); border-radius: 6px;
  box-shadow: var(--kcs-pop-shadow);
  font-size: 14px; line-height: 18px; z-index: 1200; display: none;
}
.kc-sb-menu.open { display: block; }
/* —— emoji 面板（设计稿「图标」按钮）：顶部分类 tab + 滚动网格 ——
   尺寸取自官方面板 DOM 快照（见 emoji-panel-metrics.ts）：宽 349、一行 9 格、
   格子高 38、图标 24×24 的 twemoji 图片；分组标题 30 高 / 11px / 字距 .4 / 左缩进 18。 */
.kc-emoji-panel {
  position: fixed; width: ${EMOJI_PANEL.width}px; padding: 0 0 6px; background: ${EMOJI_PANEL.background};
  border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04);
  z-index: 1200; font: 400 13px/normal ${EMOJI_PANEL.fontFamily}; color: ${EMOJI_PANEL.color};
  display: none; user-select: none;
}
.kc-emoji-panel.open { display: block; }
.kc-emoji-tabs {
  display: flex; align-items: center; gap: 0; padding: 6px ${EMOJI_PANEL.paddingInline}px 0;
  margin-bottom: 4px; border-bottom: 1px solid rgb(235,235,235);
}
.kc-emoji-tabs button {
  flex: 1 1 0; min-width: 0; height: 32px; border: 0; background: transparent; border-radius: 6px;
  cursor: pointer; color: rgb(15,15,15); display: flex; align-items: center; justify-content: center;
  transition: background-color .06s ease;
}
.kc-emoji-tabs button:hover { background: rgb(242,242,242); }
.kc-emoji-body {
  width: ${EMOJI_PANEL.width}px; max-height: 330px; overflow-y: auto; overflow-x: hidden;
  overscroll-behavior: contain; scrollbar-width: thin;
}
.kc-emoji-section.empty { display: none; }
.kc-emoji-group {
  display: flex; align-items: center; height: ${EMOJI_PANEL.header.height}px; box-sizing: border-box;
  padding: ${EMOJI_PANEL.header.paddingBlockStart}px ${EMOJI_PANEL.paddingInline}px 0 ${EMOJI_PANEL.header.paddingInlineStart}px;
  color: ${EMOJI_PANEL.header.color}; font-size: ${EMOJI_PANEL.header.fontSize}px;
  letter-spacing: ${EMOJI_PANEL.header.letterSpacing}px; text-transform: ${EMOJI_PANEL.header.textTransform};
}
.kc-emoji-grid {
  display: grid; grid-template-columns: repeat(${EMOJI_PANEL.columns}, minmax(0, 1fr));
  padding: 0 ${EMOJI_PANEL.paddingInline}px;
}
.kc-emoji-grid button {
  height: ${EMOJI_PANEL.rowHeight}px; border: 0; background: transparent; border-radius: 4px;
  cursor: pointer; padding: 0; display: flex; align-items: center; justify-content: center;
  min-width: 0; overflow: hidden; transition: background-color .06s ease;
}
.kc-emoji-grid button:hover { background: rgb(242,242,242); }
.kc-emoji-grid img {
  width: ${EMOJI_PANEL.icon}px; height: ${EMOJI_PANEL.icon}px; display: block; pointer-events: none;
}
/* 图片挂了（断网 / CDN 不通）才用系统字形兜底，字号贴着 24px 图标 */
.kc-emoji-grid button.fallback {
  font-size: 22px; line-height: ${EMOJI_PANEL.rowHeight}px;
  font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}
/* —— 深色主题：弹层（子菜单 / emoji 面板）不跟着 sidebar 的 filter 走，
      必须自己换一套色（浅色值来自官方快照，保持不变） —— */
:root[data-theme='dark'] .kc-emoji-panel { background: var(--kcs-pop-bg); color: var(--kcs-ink); box-shadow: var(--kcs-pop-shadow); }
:root[data-theme='dark'] .kc-emoji-tabs { border-bottom-color: var(--kcs-rule); }
:root[data-theme='dark'] .kc-emoji-tabs button { color: var(--kcs-ink); }
:root[data-theme='dark'] .kc-emoji-tabs button:hover,
:root[data-theme='dark'] .kc-emoji-grid button:hover { background: var(--kcs-hover); }
:root[data-theme='dark'] .kc-emoji-group { color: var(--kcs-muted); }
.kc-sb-menu li {
  display: flex; align-items: center; gap: 4px; height: 40px; padding: 0 4px; cursor: pointer;
  border-radius: 6px; transition: background-color .06s ease; white-space: nowrap;
}
.kc-sb-menu li:hover { background: var(--kcs-hover); }
.kc-sb-menu li > svg { flex: 0 0 auto; }
/* 选中项：整行灰底（设计稿 rgb(240,240,243)），文字保持墨色 */
.kc-sb-menu li.sel { background: var(--kcs-pop-sel); color: var(--kcs-sel-ink); }
.kc-sb-menu li.sel .kc-menu-key { color: rgba(255,255,255,.62); }
.kc-sb-menu li.sel .kc-star { color: inherit; }
/* —— 子菜单内的分隔线 + 开关行（设计稿「长按时显示数值工具提示」） —— */
.kc-sb-menu .kc-menu-div { height: 1px; margin: 6px 0; padding: 0; background: var(--kcs-pop-div); cursor: default; }
.kc-sb-menu .kc-menu-div:hover { background: var(--kcs-pop-div); }
.kc-menu-toggle {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  height: 32px; padding: 0 8px; font-size: 14px; cursor: pointer; white-space: nowrap;
  border-radius: 6px; transition: background-color .06s ease;
}
.kc-menu-toggle:hover { background: var(--kcs-hover); }
.kc-menu-switch {
  /* 官方开关实测：38×20 轨道（圆角 20），旋钮 14×14、内缩 3，开 #2e2e2e / 关 #9c9c9c */
  position: relative; flex: 0 0 auto; width: 38px; height: 20px; border-radius: 20px;
  background: var(--kcs-sw-on); transition: background-color .15s ease;
}
.kc-menu-switch::after {
  content: ''; position: absolute; left: 21px; top: 3px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--kcs-sw-knob); transition: left .15s ease;
}
.kc-menu-toggle.off .kc-menu-switch { background: var(--kcs-sw-off); }
.kc-menu-toggle.off .kc-menu-switch::after { left: 3px; }
/* —— 分组标题 / 快捷键提示 / 信息徽标 / 收藏星（设计稿「趋势线」子菜单） —— */
.kc-sb-menu .kc-menu-group {
  display: block; height: auto; padding: 8px 6px 2px; margin: 0;
  color: var(--kcs-muted); font-size: 11px; cursor: default;
}
.kc-sb-menu .kc-menu-group:hover { background: transparent; }
.kc-sb-menu li .kc-li-spacer { flex: 1 1 auto; }
.kc-sb-menu li .kc-menu-key { color: var(--kcs-muted); font-size: 12px; }
.kc-sb-menu li .kc-info-badge { display: inline-flex; }
.kc-sb-menu li .kc-star {
  display: inline-flex; color: inherit; opacity: 0; cursor: pointer;
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
  s.textContent = SIDEBAR_CSS;
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
/** 菜单项里的「这里插一条分隔线」占位（官方把橡皮擦单独隔在一条线下面）。
 *  不是一行可点的行 —— buildToolMenu 见到它就换成 .kc-menu-div，
 *  tests/sidebarWiring 收叶子行时也会跳过它。 */
export const MENU_SEP = '—';

/** 在这个工具定义里找某个子项的图标（items 或 groups 里都找）。找不到返回 null。 */
export function itemIcon(t: ToolDef, label: string): string | null {
  if (label === MENU_SEP || !label) return null;
  const all: MenuItem[] = [...(t.items ?? []), ...(t.groups ?? []).flatMap(g => g.items)];
  const hit = all.find(it => it[0] === label);
  // 分隔线占位的 icon 是空串，别把它当成一个可用的图标
  return hit && hit[1] ? hit[1] : null;
}

/**
 * 主按钮此刻该显示什么、点下去该派发谁。
 *
 * 官方的分组按钮不是「永远是组名那个图标」：在「光标」下拉里选了箭头，
 * 左边那颗按钮就变成鼠标指针，再点它画的是箭头（不是十字线）。
 * 所以组内要记住「当前工具」，主按钮的图标与点击派发的 label 都跟着它走。
 *
 * 没在组里找到（纯动作按钮、或第一次还没选过）就退回组名 + 组图标。
 */
export function mainButtonView(
  t: ToolDef,
  activeLabel?: string,
): { label: string; icon: string; switched: boolean } {
  const icon = activeLabel ? itemIcon(t, activeLabel) : null;
  if (icon && activeLabel !== undefined) {
    return { label: activeLabel, icon, switched: activeLabel !== t.label };
  }
  return { label: t.label, icon: t.icon, switched: false };
}

/**
 * 工具 key → 侧栏里那一行的中文名（反查 SECTIONS）。
 * 画完一个图形 / 按 Esc 会回到光标，左栏主按钮要跟着变回十字线 —— 从 key 找回 label 才能同步。
 * 认不出（emoji 之类）返回 null，调用方就不动侧栏。
 */
export function sidebarLabelForTool(key: string): string | null {
  for (const sec of SECTIONS) {
    for (const t of sec.tools) {
      const labels = [
        t.label,
        ...(t.items ?? []).map(i => i[0]),
        ...(t.groups ?? []).flatMap(g => g.items.map(i => i[0])),
      ];
      const hit = labels.find(l => l !== MENU_SEP && toolKeyForLabel(l) === key);
      if (hit) return hit;
    }
  }
  return null;
}

export const SECTIONS: Section[] = [
  { tools: [
    { icon: CROSS, caret: CARET, label: '十字线', items: [
      // 「橡皮擦」在官方是在分隔线下面的（和上面四个不是一个组），'—' 就是那条线的占位
      ['十字线', CROSS], ['圆点', DOT], ['箭头', ARROW_CURSOR], ['荧光笔', HIGHLIGHTER],
      [MENU_SEP, ''], ['橡皮擦', ERASER],
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
function buildToolMenu(t: ToolDef, pick: (label: string, icon: string) => void): HTMLUListElement {
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
      if (label === MENU_SEP) { menu.appendChild(el('li', 'kc-menu-div')); continue; }
      const li = el('li');
      li.dataset.label = label;
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
        pick(label, icon);
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

  /** 造一格：点击后记最近使用（只刷新区块，不重建整块面板） */
  const makeButtons = (grid: HTMLElement, items: readonly string[]): void => {
    for (const ch of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', ch);
      // 官方那格是 <img src="…/72x72/<code>.png" width=24 height=24 decoding=async
      // draggable=false alt="">，不是字体字形 —— 换平台/换系统字体也不会变样。
      // 1720 张图不能一次全下，加 loading=lazy（官方是虚拟列表，效果等价）。
      const img = document.createElement('img');
      img.src = emojiPngUrl(ch);
      img.width = EMOJI_PANEL.icon;
      img.height = EMOJI_PANEL.icon;
      img.decoding = 'async';
      img.loading = 'lazy';
      img.draggable = false;
      img.alt = '';
      // 断网 / CDN 被墙时退回系统字形，至少还能选
      img.addEventListener('error', () => {
        img.remove();
        b.classList.add('fallback');
        b.textContent = ch;
      });
      b.appendChild(img);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        saveEmojiRecent(ch);
        renderRecents();
        onEmoji(ch);
      });
      grid.appendChild(b);
    }
  };
  const makeSection = (label: string, items: readonly string[]): HTMLDivElement => {
    const sec = el('div', 'kc-emoji-section');
    const title = el('div', 'kc-emoji-group');
    title.textContent = label;
    const grid = el('div', 'kc-emoji-grid');
    makeButtons(grid, items);
    sec.appendChild(title);
    sec.appendChild(grid);
    return sec;
  };

  // 最近使用（官方第一组，无记录时整块隐藏）
  const recentSec = makeSection('最近使用', []);
  const renderRecents = (): void => {
    const list = loadEmojiRecents();
    recentSec.classList.toggle('empty', list.length === 0);
    const grid = recentSec.querySelector('.kc-emoji-grid') as HTMLElement;
    grid.innerHTML = '';
    makeButtons(grid, list);
  };
  renderRecents();
  body.appendChild(recentSec);

  // 官方 8 组：静态渲染一次（共 1720 项，重绘面板的代价太高）
  for (const cat of EMOJI_CATEGORIES) body.appendChild(makeSection(cat.label, cat.items));

  /** 当前可见的分组标题（最近使用为空时不算） */
  const sectionTitles = (): HTMLElement[] =>
    [...body.querySelectorAll('.kc-emoji-group')] as HTMLElement[];

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
      // 分组顺序 = [最近使用?] + 8 个分类；最近使用为空时它不在 sectionTitles 里
      const hasRecents = sectionTitles().length > EMOJI_CATEGORIES.length;
      const target = sectionTitles()[EMOJI_CATEGORIES.indexOf(cat) + (hasRecents ? 1 : 0)];
      if (target) {
        // 用两个 rect 的差算偏移，不用 offsetTop —— 面板是 position:fixed，
        // offsetParent 链会把 tab 条的高度也算进去，跳过去会顶掉 4px 标题
        const delta = target.getBoundingClientRect().top - body.getBoundingClientRect().top;
        body.scrollTop = Math.max(0, body.scrollTop + delta - 4);
      }
    });
    tabs.appendChild(b);
  }

  panel.appendChild(tabs);
  panel.appendChild(body);
  return panel;
}

/**
 * 侧栏实例 → 「把主按钮拨到某个工具」的入口。
 * 画完一个图形 / 按 Esc 会自动回到光标，左侧那颗按钮的图标得跟着拨回十字线
 * （官方就是这样），所以 DrawToolbar 拿 drawBus 的工具名来这里同步。
 */
const syncers = new WeakMap<HTMLElement, (label: string) => void>();

/** 外部同步：把 root 这个侧栏的主按钮切到 `label` 那一行（不在任何组里就忽略）。 */
export function setSidebarActive(root: HTMLElement, label: string): void {
  syncers.get(root)?.(label);
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

  /** 每个分组按钮「组内当前工具」：主按钮的图标与点击派发都跟着它（同官方行为） */
  const activeOf = new WeakMap<HTMLButtonElement, string>();
  /** 分组按钮 ↔ 工具定义：外部按 label 反查该拨哪颗按钮（setSidebarActive） */
  const groups: Array<{ btn: HTMLButtonElement; t: ToolDef }> = [];
  const menus: HTMLElement[] = [];
  const closeMenus = (except?: HTMLElement): void => {
    menus.forEach(m => { if (m !== except) m.classList.remove('open'); });
    root.querySelectorAll('.kc-sb-tool.open').forEach(c => c.classList.remove('open'));
  };
  /** 菜单挂在 body 下（fixed）：贴着 cell 右缘弹出，底部越界时上收 */
  const openMenuAt = (menu: HTMLElement, cell: HTMLElement): void => {
    menu.classList.add('open');
    cell.classList.add('open');
    // 菜单打开时把「组内当前工具」那一行标成选中：官方下拉里当前工具是深色块，
    // 而菜单只构建一次，不重新同步的话重开就丢了选中态
    const b = cell.querySelector('.kc-sb-btn') as HTMLButtonElement | null;
    const active = b ? activeOf.get(b) : undefined;
    menu.querySelectorAll<HTMLElement>('li[data-label]').forEach(li => {
      li.classList.toggle('sel', li.dataset.label === active);
    });
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
  const pick = (btn: HTMLButtonElement, label: string, icon?: string): void => {
    selected?.classList.remove('kc-sel');
    btn.classList.add('kc-sel');
    selected = btn;
    if (icon) {
      // 主按钮换成这个工具的图标：在「光标」里选了箭头，左边那颗就变鼠标指针，
      // 再点它画的是箭头而不是十字线（官方就是这样）
      btn.innerHTML = `<span class="pill"></span>${icon}`;
      btn.dataset.tool = label;
      btn.title = label;
      activeOf.set(btn, label);
    }
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
      const init = mainButtonView(t);
      btn.title = init.label;
      btn.dataset.tool = init.label;
      btn.innerHTML = `<span class="pill"></span>${init.icon}`;
      activeOf.set(btn, init.label);
      if (t.caret) {
        const caret = el('button', 'kc-sb-caret') as HTMLButtonElement;
        // 主按钮：工具类 → 选中；开关类 → 直接切换
        btn.addEventListener('click', () => {
          if (['锁定绘图和指标', '隐藏所有图形', '移除对象'].includes(t.label)) {
            const on = btn.classList.toggle('kc-on');
            cb.onToggle?.(t.label, on);
          } else {
            // 派发「组内当前工具」而不是组名：选了箭头之后点主按钮应当继续画箭头
            pick(btn, activeOf.get(btn) ?? t.label);
          }
        });
        caret.type = 'button';
        caret.tabIndex = -1;
        caret.setAttribute('aria-label', t.label + '（子菜单）');
        caret.innerHTML = t.caret;
        const menu = buildToolMenu(t, (label, icon) => {
          closeMenus();
          pick(btn, label, icon);
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
            if (!was) { pick(btn, activeOf.get(btn) ?? t.label); openMenuAt(emojiPanel, cell); }
          } else {
            pick(btn, activeOf.get(btn) ?? t.label);
          }
        });
      }
      cell.appendChild(btn);
      groups.push({ btn, t });
      sec.appendChild(cell);
    }
    root.appendChild(sec);
    root.appendChild(el('div', 'kc-sb-div'));
  }

  document.addEventListener('click', () => closeMenus());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
  // sidebar 滚动时菜单不再贴合原位，直接关掉
  root.addEventListener('scroll', () => closeMenus());

  syncers.set(root, (label: string) => {
    // 分组里的子项按图标反查；没有子菜单的单按钮（测量 / 图标）就按组名匹配
    const g = groups.find(x => itemIcon(x.t, label) || x.t.label === label);
    if (!g) return;
    pick(g.btn, label, itemIcon(g.t, label) ?? undefined);
  });

  mount.appendChild(root);
  // 默认选中第一个工具（十字线），对应原稿 #ebebeb 选中药丸
  const first = root.querySelector('.kc-sb-btn') as HTMLButtonElement;
  first.classList.add('kc-sel');
  selected = first;
  return root;
}
