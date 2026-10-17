/**
 * 浮动绘图属性工具条（选中图形后出现）。
 * 挂 body + position:fixed（和 sidebar 子菜单同一套路，避免被画布容器裁剪）；
 * 位置由 ChartGridView 在每帧 onDraw 后 sync()，跟着图形走（拖动 / 平移缩放都不掉队）。
 *
 * 结构照官方线上那条（`docs/ref-tv-propsbar.png` 逐像素量出来的）：
 *   拖拽手柄(22) / 克隆(38) / 颜色·铅笔+彩虹条(38) / 线宽·线+2px(70) /
 *   线型·细线(38) / 设置·六边形(38) / 锁(38) / 垃圾桶(38) / 更多·三点(38)
 * 全部 38 步进（线宽那颗 70 宽），条高 38、圆角 8。
 */
import type { DrawLayer, Drawing } from '../../engine/draw';

/* ------------------------------------------------------------------ 尺寸（官方实测，单位 CSS px） */

/** 条高 */
export const BAR_H = 38;
/** 普通按钮边长 */
export const BTN = 38;
/** 线宽那颗（线 + 文字）比别的宽 */
export const WIDTH_BTN = 70;
/** 拖拽手柄宽度 */
export const GRIP_W = 22;

/** 官方图标的主色与手柄点色 */
const INK = 'rgb(15,15,15)';
const GRIP_DOT = 'rgb(184,184,184)';

/* ------------------------------------------------------------------ 样式 */

const CSS = `
/* 两套色板：浅色照官方截图，深色吃 tokens（条挂 body 下，靠 :root 上的变量继承） */
:root {
  --kpb-bg: #fff;
  --kpb-ink: rgb(15,15,15);
  --kpb-hover: rgb(242,242,242);
  --kpb-on: rgb(231,240,255);
  --kpb-sub: rgb(140,140,145);
  --kpb-grip: rgb(184,184,184);
  --kpb-shadow: 0 2px 10px rgba(0,0,0,.10), 0 0 0 1px rgba(0,0,0,.04);
  --kpb-pop-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04);
}
:root[data-theme='dark'] {
  --kpb-bg: var(--bg-sunken);
  --kpb-ink: var(--text);
  --kpb-hover: var(--bg-hover);
  --kpb-on: var(--accent-soft);
  --kpb-sub: #8a919e;
  --kpb-grip: #6e7886;
  --kpb-shadow: 0 6px 18px rgba(0,0,0,.55), 0 0 0 1px var(--border-strong);
  --kpb-pop-shadow: 0 8px 24px rgba(0,0,0,.55), 0 0 0 1px var(--border-strong);
}
.kc-propsbar {
  position: fixed; display: none; align-items: center; height: ${BAR_H}px;
  background: var(--kpb-bg); border-radius: 8px; padding: 0 2px; z-index: 1150;
  box-shadow: var(--kpb-shadow);
  font-size: 14px; color: var(--kpb-ink); user-select: none;
  font-family: -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
}
.kc-propsbar.open { display: flex; }
.kc-propsbar-grip {
  width: ${GRIP_W}px; height: ${BAR_H}px; display: flex; align-items: center; justify-content: center;
  color: var(--kpb-grip); cursor: grab; flex: 0 0 auto; touch-action: none;
}
.kc-propsbar-grip:active { cursor: grabbing; }
.kc-propsbar-btn {
  position: relative; height: ${BAR_H}px; border: 0; padding: 0;
  background: transparent; cursor: default; display: flex; align-items: center;
  justify-content: center; color: var(--kpb-ink); box-sizing: border-box;
  transition: background-color .06s ease, color .06s ease;
}
/* 普通按钮 38×38；线宽那颗 70 宽 */
.kc-propsbar-btn { width: ${BTN}px; }
.kc-propsbar-btn.wide { width: ${WIDTH_BTN}px; }
.kc-propsbar-btn .pill {
  position: absolute; left: 2px; right: 2px; top: 2px; bottom: 2px;
  border-radius: 6px; background: transparent; z-index: 0;
}
.kc-propsbar-btn:hover .pill { background: var(--kpb-hover); }
.kc-propsbar-btn[disabled] { opacity: .35; }
.kc-propsbar-btn > svg { position: relative; z-index: 1; display: block; }
.kc-propsbar-btn.on .pill { background: var(--kpb-on); }
.kc-propsbar-stack {
  position: relative; z-index: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px;
}
/* 铅笔下面那条彩虹：官方是 22×4 的圆角渐变条（照着采样点写的色标） */
.kc-propsbar-chip {
  width: 22px; height: 4px; border-radius: 2px; overflow: hidden;
  background: linear-gradient(90deg, #8a09ff 0%, #4368ff 14%, #08c4f5 28%,
    #3ee95a 43%, #88f900 57%, #e8ea03 71%, #ffa100 86%, #ff4500 100%);
}
/* 线宽那颗：18 的线样 + 4 间距 + 文字，整体居中 */
.kc-propsbar-wrow { position: relative; z-index: 1; display: flex; align-items: center; gap: 4px; }
.kc-propsbar-wline { flex: 0 0 auto; width: 18px; display: flex; align-items: center; }
.kc-propsbar-wline > i {
  display: block; width: 100%; background: currentColor; border-radius: 99px;
  min-height: 2px; max-height: 8px;
}
.kc-propsbar-wlabel { font-size: 14px; line-height: 18px; color: var(--kpb-ink); }
/* —— 弹出小面板：调色 / 线宽 / 线型 —— */
.kc-propsbar-pop {
  position: fixed; display: none; background: var(--kpb-bg); border-radius: 8px; padding: 8px;
  box-shadow: var(--kpb-pop-shadow); z-index: 1200;
}
.kc-propsbar-pop.open { display: block; }
.kc-propsbar-pop .pop-title { color: var(--kpb-sub); font-size: 11px; padding: 2px 4px 6px; }
.kc-propsbar-swatches { display: grid; grid-template-columns: repeat(5, 28px); gap: 6px; }
.kc-propsbar-swatches button {
  width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(0,0,0,.12);
  cursor: pointer; padding: 0; transition: transform .06s ease;
}
.kc-propsbar-swatches button:hover { transform: scale(1.12); }
.kc-propsbar-rows { min-width: 150px; }
.kc-propsbar-rows button {
  display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: transparent;
  height: 34px; padding: 0 10px; border-radius: 6px; cursor: pointer; font-size: 13px;
  color: var(--kpb-ink); transition: background-color .06s ease;
}
.kc-propsbar-rows button:hover { background: var(--kpb-hover); }
.kc-propsbar-rows button.sel { background: var(--kpb-on); }
.kc-propsbar-rows .sample { flex: 0 0 auto; border-radius: 2px; background: currentColor; }
.kc-propsbar-rows .sample.dashed { background: transparent; border-top: 3px dashed currentColor; height: 0 !important; }
.kc-propsbar-rows .sample.dotted { background: transparent; border-top: 3px dotted currentColor; height: 0 !important; }
`;

function injectStyle(): void {
  if (document.getElementById('kc-propsbar-css')) return;
  const s = document.createElement('style');
  s.id = 'kc-propsbar-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ 图标（按官方截图逐个量的尺寸重绘） */

/** 拖拽手柄：2 列 × 3 行圆点，整块 8×12（点 r=1、列距 6、行距 5） */
export const ICON_GRIP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 12" width="8" height="12" fill="currentColor">'
  + '<circle cx="1" cy="1" r="1"/><circle cx="1" cy="6" r="1"/><circle cx="1" cy="11" r="1"/>'
  + '<circle cx="7" cy="1" r="1"/><circle cx="7" cy="6" r="1"/><circle cx="7" cy="11" r="1"/></svg>';

/** 克隆：2×2 网格缺右下（换成加号），整块 16×16（描边 1.5、方格 6、圆角 1.5） */
export const ICON_CLONE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25">'
  + '<rect x="1" y="1" width="5.8" height="5.8" rx="2.4"/>'
  + '<rect x="9.2" y="1" width="5.8" height="5.8" rx="2.4"/>'
  + '<rect x="1" y="9.2" width="5.8" height="5.8" rx="2.4"/>'
  + '<path stroke-linecap="round" d="M12.15 10.1v4.5M9.9 12.35h4.5"/></svg>';

/** 铅笔：斜握的一支，20×20（笔尖朝左下，笔身右上有笔帽分隔） */
export const ICON_PENCIL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">'
  + '<g transform="translate(10 10) scale(1.1) rotate(45) translate(-10 -10)">'
  + '<path d="M7.1 14.6V4.6a2.1 2.1 0 0 1 2.1-2.1h1.6a2.1 2.1 0 0 1 2.1 2.1v10"/>'
  + '<path d="M7.1 14.6 10 19.2 12.9 14.6Z"/>'
  + '<path d="M7.1 12.4h5.8"/>'
  + '</g></svg>';

/** 线型：一条 20 长的细线（1.4 描边、圆头） */
export const ICON_DASH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">'
  + '<path d="M0 10h20"/></svg>';

/** 设置：六边形 + 内圆，21×18（描边 1.5） */
export const ICON_SETTINGS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 18" width="21" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">'
  + '<path d="M6 1h9l5.2 8L15 17H6L0.8 9 6 1Z"/>'
  + '<circle cx="10.5" cy="9" r="2.6"/></svg>';

/** 锁（解锁态）：锁梁向右上敞开，锁体 16×12、锁孔是实心竖条，整块 16×19 */
export const ICON_LOCK_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 19" width="16" height="19" fill="none" stroke="currentColor" stroke-width="1.3">'
  + '<path stroke-linecap="round" d="M4.4 8.2V5.3a3.3 3.3 0 0 1 6.6 0V5.5"/>'
  + '<rect x="1.4" y="7.6" width="13.2" height="10.4" rx="2.8"/>'
  + '<path stroke="none" fill="currentColor" d="M7.1 11.5h1.8v3.9a.9.9 0 0 1-1.8 0v-3.9Z"/></svg>';

/** 锁（锁定态）：锁梁闭合 */
export const ICON_LOCK_CLOSED = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 19" width="16" height="19" fill="none" stroke="currentColor" stroke-width="1.3">'
  + '<path stroke-linecap="round" d="M4.4 8.2V5.3a3.3 3.3 0 0 1 6.6 0V8.2"/>'
  + '<rect x="1.4" y="7.6" width="13.2" height="10.4" rx="2.8"/>'
  + '<path stroke="none" fill="currentColor" d="M7.1 11.5h1.8v3.9a.9.9 0 0 1-1.8 0v-3.9Z"/></svg>';

/** 删除：梯形桶身 + 顶盖 + 提手，18×20（描边 1.5） */
export const ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 20" width="18" height="20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">'
  + '<path stroke-linecap="round" d="M1 4.4h16"/>'
  + '<path d="M3.3 4.4h11.4l-1.2 13.1a1.5 1.5 0 0 1-1.5 1.4H6a1.5 1.5 0 0 1-1.5-1.4L3.3 4.4Z"/>'
  + '<path stroke-linecap="round" d="M6.1 4.4V3.4c0-.6.4-1 1-1h3.8c.6 0 1 .4 1 1v1"/></svg>';

/** 更多：三个空心圆（点直径 5、中心距 7），整块 19×5 */
export const ICON_MORE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 19 5" width="19" height="5" fill="none" stroke="currentColor" stroke-width="1.3">'
  + '<circle cx="2.5" cy="2.5" r="1.6"/><circle cx="9.5" cy="2.5" r="1.6"/><circle cx="16.5" cy="2.5" r="1.6"/></svg>';

/* ------------------------------------------------------------------ 数据 */

const SWATCHES = ['#2962ff', '#f23645', '#089981', '#ff9800', '#9c27b0', '#00bcd4', '#e91e63', '#787b86', '#131722', '#ffffff'];
const WIDTHS = [1, 2, 4, 8];
const DASH_ROWS: [string, string, number[]][] = [
  ['实线', '', []],
  ['虚线', 'dashed', [8, 5]],
  ['点线', 'dotted', [2, 4]],
];

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export const fmtPx = (w: number): string => (Number.isInteger(w) ? String(w) : w.toFixed(1)) + 'px';

/** 线宽预览条的高度：官方那条粗线就代表当前线宽（1px 也给 2 才看得见） */
export const widthSampleH = (w: number): number => Math.max(2, Math.min(w, 8));

/** 工具条上按钮的顺序（官方截图从左到右；测试按这个核对） */
export const BAR_ORDER = ['grip', 'clone', 'color', 'width', 'dash', 'settings', 'lock', 'trash', 'more'] as const;
export type BarItem = (typeof BAR_ORDER)[number];

/* ------------------------------------------------------------------ 组件 */

export interface DrawPropsBar {
  sync(): void;
  hide(): void;
  dispose(): void;
}

export function createDrawPropsBar(getLayer: () => DrawLayer | null): DrawPropsBar {
  injectStyle();

  const bar = document.createElement('div');
  bar.className = 'kc-propsbar';

  let manual: { dx: number; dy: number } | null = null;
  let curId: number | null = null;
  /** sync 每帧都跑：这两个记住上次画过的值，值没变就不动 DOM */
  let lockPainted: boolean | null = null;
  let widthPainted = -1;
  let pop: HTMLElement | null = null;
  let popCleanup: (() => void) | null = null;

  const closePop = (): void => {
    if (pop) { pop.remove(); pop = null; }
    if (popCleanup) { popCleanup(); popCleanup = null; }
  };

  /** 弹出小面板：挂在 body，fixed 定位在按钮下方 */
  const openPop = (btn: HTMLElement, el: HTMLElement): void => {
    closePop();
    document.body.appendChild(el);
    const r = btn.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - el.offsetWidth - 8)) + 'px';
    el.style.top = Math.min(r.bottom + 6, window.innerHeight - el.offsetHeight - 8) + 'px';
    el.classList.add('open');
    pop = el;
    const onDoc = (e: MouseEvent): void => { if (!el.contains(e.target as Node)) closePop(); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closePop(); };
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
    popCleanup = () => {
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  };

  /** 造一个按钮（宽度默认 38，线宽那颗加 .wide）；data-item 供测试/调试定位 */
  const mkBtn = (icon: string, title: string, item: BarItem, wide = false): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'kc-propsbar-btn' + (wide ? ' wide' : '');
    b.title = title;
    b.setAttribute('data-item', item);
    b.innerHTML = '<span class="pill"></span>' + icon;
    return b;
  };

  const cur = (): { d: Drawing; l: DrawLayer } | null => {
    const l = getLayer();
    const d = l ? l.active() : null;
    return l && d ? { d, l } : null;
  };

  /* —— 拖拽手柄：抓着挪整条 —— */
  const grip = document.createElement('div');
  grip.className = 'kc-propsbar-grip';
  grip.setAttribute('data-item', 'grip');
  grip.innerHTML = ICON_GRIP;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const startLeft = parseFloat(bar.style.left || '0');
    const startTop = parseFloat(bar.style.top || '0');
    const startDx = manual ? manual.dx : 0;
    const startDy = manual ? manual.dy : 0;
    const move = (ev: PointerEvent): void => {
      manual = { dx: startDx + ev.clientX - sx, dy: startDy + ev.clientY - sy };
      bar.style.left = startLeft + ev.clientX - sx + 'px';
      bar.style.top = startTop + ev.clientY - sy + 'px';
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  bar.appendChild(grip);

  /* —— 克隆（2×2 缺一格 + 加号）—— */
  const cloneBtn = mkBtn(ICON_CLONE, '克隆副本', 'clone');
  cloneBtn.addEventListener('click', () => { const c = cur(); if (c) c.l.clone(c.d.id); });
  bar.appendChild(cloneBtn);

  /* —— 颜色：铅笔 + 彩虹条，点开调色板 —— */
  const colorBtn = document.createElement('button');
  colorBtn.className = 'kc-propsbar-btn';
  colorBtn.title = '颜色';
  colorBtn.setAttribute('data-item', 'color');
  const colorStack = document.createElement('span');
  colorStack.className = 'kc-propsbar-stack';
  colorStack.innerHTML = ICON_PENCIL;
  const colorChip = document.createElement('div');
  colorChip.className = 'kc-propsbar-chip';
  colorStack.appendChild(colorChip);
  colorBtn.innerHTML = '<span class="pill"></span>';
  colorBtn.appendChild(colorStack);
  colorBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'kc-propsbar-pop';
    el.innerHTML = '<div class="pop-title">线条颜色</div>';
    const grid = document.createElement('div');
    grid.className = 'kc-propsbar-swatches';
    for (const col of SWATCHES) {
      const sw = document.createElement('button');
      sw.style.background = col;
      sw.title = col;
      sw.addEventListener('click', () => {
        const cc = cur();
        if (!cc) return;
        c.l.setStyle(cc.d.id, { color: col, fill: hexToRgba(col, 0.14) });
        closePop();
      });
      grid.appendChild(sw);
    }
    el.appendChild(grid);
    openPop(colorBtn, el);
  });
  bar.appendChild(colorBtn);

  /* —— 线宽：一条代表当前粗细的线 + 「Npx」—— */
  const widthBtn = document.createElement('button');
  widthBtn.className = 'kc-propsbar-btn wide';
  widthBtn.title = '线宽';
  widthBtn.setAttribute('data-item', 'width');
  widthBtn.innerHTML = '<span class="pill"></span>';
  const widthRow = document.createElement('span');
  widthRow.className = 'kc-propsbar-wrow';
  const widthLine = document.createElement('span');
  widthLine.className = 'kc-propsbar-wline';
  const widthBar = document.createElement('i');
  widthLine.appendChild(widthBar);
  const widthLabel = document.createElement('span');
  widthLabel.className = 'kc-propsbar-wlabel';
  widthLabel.textContent = '2px';
  widthRow.appendChild(widthLine);
  widthRow.appendChild(widthLabel);
  widthBtn.appendChild(widthRow);
  widthBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'kc-propsbar-pop';
    el.innerHTML = '<div class="pop-title">线宽</div>';
    const rows = document.createElement('div');
    rows.className = 'kc-propsbar-rows';
    for (const w of WIDTHS) {
      const b = document.createElement('button');
      const sample = document.createElement('span');
      sample.className = 'sample';
      sample.style.width = '36px';
      sample.style.height = widthSampleH(w) + 'px';
      const lab = document.createElement('span');
      lab.textContent = fmtPx(w);
      b.appendChild(sample);
      b.appendChild(lab);
      b.addEventListener('click', () => {
        const cc = cur();
        if (!cc) return;
        c.l.setStyle(cc.d.id, { width: w });
        closePop();
      });
      rows.appendChild(b);
    }
    el.appendChild(rows);
    openPop(widthBtn, el);
  });
  bar.appendChild(widthBtn);

  /** 造一个「实线/虚线/点线」的选择面板（线型和设置里的线型段共用） */
  const dashRows = (onPick: (dash: number[]) => void): HTMLElement => {
    const rows = document.createElement('div');
    rows.className = 'kc-propsbar-rows';
    for (const [label, cls, dash] of DASH_ROWS) {
      const b = document.createElement('button');
      const sample = document.createElement('span');
      sample.className = 'sample' + (cls ? ' ' + cls : '');
      sample.style.width = '36px';
      sample.style.height = cls ? '0' : '3px';
      const lab = document.createElement('span');
      lab.textContent = label;
      b.appendChild(sample);
      b.appendChild(lab);
      b.addEventListener('click', () => {
        if (!cur()) return;
        onPick(dash);
        closePop();
      });
      rows.appendChild(b);
    }
    return rows;
  };

  /* —— 线型：一条细线，点开选实线 / 虚线 / 点线 —— */
  const dashBtn = mkBtn(ICON_DASH, '线型', 'dash');
  dashBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'kc-propsbar-pop';
    el.innerHTML = '<div class="pop-title">线型</div>';
    el.appendChild(dashRows((dash) => c.l.setStyle(c.d.id, { dash: dash.slice() })));
    openPop(dashBtn, el);
  });
  bar.appendChild(dashBtn);

  /* —— 设置：六边形，里面放「重复绘制」开关和整条删除 —— */
  const setBtn = mkBtn(ICON_SETTINGS, '设置', 'settings');
  setBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'kc-propsbar-pop';
    el.innerHTML = '<div class="pop-title">设置</div>';
    const rows = document.createElement('div');
    rows.className = 'kc-propsbar-rows';
    const rep = document.createElement('button');
    const repLab = document.createElement('span');
    repLab.textContent = '重复绘制';
    const repMark = document.createElement('span');
    repMark.style.marginLeft = 'auto';
    repMark.textContent = c.l.repeatDraw ? '开' : '关';
    rep.appendChild(repLab);
    rep.appendChild(repMark);
    rep.addEventListener('click', () => {
      const cc = cur();
      if (!cc) return;
      cc.l.setRepeat(!cc.l.repeatDraw);
      repMark.textContent = cc.l.repeatDraw ? '开' : '关';
      sync();
    });
    rows.appendChild(rep);
    const all = document.createElement('button');
    const allLab = document.createElement('span');
    allLab.textContent = '删除全部';
    all.appendChild(allLab);
    all.addEventListener('click', () => { const cc = cur(); if (cc) cc.l.clear(); closePop(); });
    rows.appendChild(all);
    el.appendChild(rows);
    openPop(setBtn, el);
  });
  bar.appendChild(setBtn);

  /* —— 锁定（锁定后不能拖、Delete 删不掉；橡皮擦照擦，同官方）—— */
  const lockBtn = mkBtn(ICON_LOCK_OPEN, '锁定', 'lock');
  lockBtn.setAttribute('aria-pressed', 'false');
  lockBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    c.l.setLocked(c.d.id, !c.d.locked);
    sync();
  });
  bar.appendChild(lockBtn);

  /* —— 删除（锁定时禁用）—— */
  const trashBtn = mkBtn(ICON_TRASH, '删除', 'trash');
  trashBtn.addEventListener('click', () => {
    const c = cur();
    if (!c || c.d.locked) return;
    c.l.remove(c.d.id);
  });
  bar.appendChild(trashBtn);

  /* —— 更多：克隆 / 重复绘制 / 删除全部 —— */
  const moreBtn = mkBtn(ICON_MORE, '更多', 'more');
  moreBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'kc-propsbar-pop';
    const rows = document.createElement('div');
    rows.className = 'kc-propsbar-rows';
    const mkRow = (label: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      const lab = document.createElement('span');
      lab.textContent = label;
      b.appendChild(lab);
      b.addEventListener('click', () => { fn(); closePop(); });
      rows.appendChild(b);
      return b;
    };
    mkRow('克隆副本', () => { const cc = cur(); if (cc) cc.l.clone(cc.d.id); });
    mkRow('删除全部', () => { const cc = cur(); if (cc) cc.l.clear(); });
    el.appendChild(rows);
    openPop(moreBtn, el);
  });
  bar.appendChild(moreBtn);

  document.body.appendChild(bar);

  /* -------------------------------------------------------------- 同步 */

  function sync(): void {
    const c = cur();
    if (!c || !c.l.selectionToolbarAnchor()) { hide(); return; }
    const a = c.l.selectionToolbarAnchor() as { x: number; y: number };
    const cv = c.l.host.canvas;
    if (!cv) { hide(); return; }
    if (curId !== c.d.id) {
      curId = c.d.id;
      manual = null;
      closePop();
      // 换了一条图形 → 锁/线宽两处缓存失效，下一段重新写
      lockPainted = null;
      widthPainted = -1;
    }
    const r = cv.getBoundingClientRect();
    const left = r.left + a.x + (manual ? manual.dx : 0);
    const top = r.top + a.y + (manual ? manual.dy : 0);
    bar.style.left = Math.max(8, Math.min(left, window.innerWidth - bar.offsetWidth - 8)) + 'px';
    bar.style.top = Math.max(8, Math.min(top, window.innerHeight - bar.offsetHeight - 8)) + 'px';
    bar.classList.add('open');
    // 状态回填（sync 每帧都跑，只在值变了才动 DOM）
    if (widthPainted !== c.d.style.width) {
      widthPainted = c.d.style.width;
      widthLabel.textContent = fmtPx(c.d.style.width);
      widthBar.style.height = widthSampleH(c.d.style.width) + 'px';
    }
    if (lockPainted !== c.d.locked) {
      lockPainted = c.d.locked;
      lockBtn.innerHTML = '<span class="pill"></span>' + (c.d.locked ? ICON_LOCK_CLOSED : ICON_LOCK_OPEN);
      lockBtn.title = c.d.locked ? '解锁' : '锁定';
      lockBtn.setAttribute('aria-pressed', String(c.d.locked));
      lockBtn.classList.toggle('on', c.d.locked);
      trashBtn.disabled = c.d.locked;
    }
  }

  function hide(): void {
    if (!bar.classList.contains('open') && !pop) return;
    bar.classList.remove('open');
    closePop();
  }

  return {
    sync,
    hide,
    dispose(): void {
      hide();
      bar.remove();
    },
  };
}
