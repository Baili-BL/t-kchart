/**
 * 浮动绘图属性工具条（设计稿：选中图形后出现的横条 ——
 * 拖拽手柄 / 克隆 / 取色（铅笔+色条）/ 线宽 Npx / 设置（线型）/ 重复绘制 / 锁定 / 删除 / 更多）。
 * 挂 body + position:fixed（和 sidebar 子菜单同一套路，避免被画布容器裁剪）；
 * 位置由 ChartGridView 在每帧 onDraw 后 sync()，跟着图形走（拖动 / 平移缩放都不掉队）。
 */
import type { DrawLayer, Drawing } from '../../engine/draw';

/* ------------------------------------------------------------------ 样式 */

const CSS = `
.kc-propsbar {
  position: fixed; display: none; align-items: center; height: 38px;
  background: #fff; border-radius: 6px; padding: 0 2px; z-index: 1150;
  box-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04);
  font-size: 13px; color: rgb(15,15,15); user-select: none;
  font-family: -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
}
.kc-propsbar.open { display: flex; }
.kc-propsbar-grip {
  width: 24px; height: 38px; display: flex; align-items: center; justify-content: center;
  color: rgb(184,184,184); cursor: grab; flex: 0 0 auto; touch-action: none;
}
.kc-propsbar-grip:active { cursor: grabbing; }
.kc-propsbar-btn {
  position: relative; width: 38px; height: 38px; border: 0; padding: 0;
  background: transparent; cursor: default; display: flex; align-items: center;
  justify-content: center; color: rgb(15,15,15); box-sizing: border-box;
  transition: background-color .06s ease, color .06s ease;
}
.kc-propsbar-btn .pill {
  position: absolute; left: 2px; right: 2px; top: 2px; bottom: 2px;
  border-radius: 6px; background: transparent; z-index: 0;
}
.kc-propsbar-btn:hover .pill { background: rgb(242,242,242); }
.kc-propsbar-btn[disabled] { opacity: .35; }
.kc-propsbar-btn > svg { position: relative; z-index: 1; display: block; }
.kc-propsbar-btn.on .pill { background: rgb(231,240,255); }
.kc-propsbar-stack {
  position: relative; z-index: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 4px;
}
.kc-propsbar-chip {
  width: 22px; height: 4px; border-radius: 2px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='2' height='2' fill='%23ddd'/%3E%3Crect x='2' y='2' width='2' height='2' fill='%23ddd'/%3E%3C/svg%3E");
  background-size: 4px auto; overflow: hidden;
}
.kc-propsbar-chip > div { width: 100%; height: 100%; border-radius: 2px; }
.kc-propsbar-wlabel { margin-inline-start: 7px; }
.kc-propsbar-wrow { display: flex; align-items: center; padding: 10px 11px 10px 10px; }
/* —— 弹出小面板：调色 / 线宽 / 线型 —— */
.kc-propsbar-pop {
  position: fixed; display: none; background: #fff; border-radius: 8px; padding: 8px;
  box-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04); z-index: 1200;
}
.kc-propsbar-pop.open { display: block; }
.kc-propsbar-pop .pop-title { color: rgb(140,140,145); font-size: 11px; padding: 2px 4px 6px; }
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
  color: rgb(15,15,15); transition: background-color .06s ease;
}
.kc-propsbar-rows button:hover { background: rgb(242,242,242); }
.kc-propsbar-rows button.sel { background: rgb(240,240,243); }
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

/* ------------------------------------------------------------------ 图标（对齐设计稿的 path） */

const ICON_GRIP = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 12" width="8" height="12" fill="currentColor">'
  + '<rect width="2" height="2" rx="1"/><rect width="2" height="2" rx="1" y="5"/><rect width="2" height="2" rx="1" y="10"/>'
  + '<rect width="2" height="2" rx="1" x="6"/><rect width="2" height="2" rx="1" x="6" y="5"/><rect width="2" height="2" rx="1" x="6" y="10"/></svg>';

// 克隆（三方块 + 加号）
const ICON_CLONE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor">'
  + '<path stroke-linecap="round" d="M15.5 18.5h6m-3 3v-6"/>'
  + '<rect width="6" height="6" rx="1.5" x="6.5" y="6.5"/><rect width="6" height="6" rx="1.5" x="15.5" y="6.5"/>'
  + '<rect width="6" height="6" rx="1.5" x="6.5" y="15.5"/></svg>';

// 铅笔（取色按钮上半）
const ICON_PENCIL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">'
  + '<path fill="currentColor" d="M10.62.72a2.47 2.47 0 0 1 3.5 0l1.16 1.16c.96.97.96 2.54 0 3.5l-.58.58-8.9 8.9-1 1-.14.14H0v-4.65l.14-.15 1-1 8.9-8.9.58-.58Zm2.8.7a1.48 1.48 0 0 0-2.1 0l-.23.23 3.26 3.26.23-.23c.58-.58.58-1.52 0-2.1l-1.16-1.16Zm.23 4.2-3.26-3.27-8.2 8.2 3.25 3.27 8.2-8.2Zm-8.9 8.9-3.27-3.26-.5.5V15h3.27l.5-.5Z"/></svg>';

// 线宽（18x4 圆角厚线）
const ICON_WIDTH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 4" width="18" height="4">'
  + '<rect width="18" height="4" fill="currentColor" rx="2"/></svg>';

// 设置（六角螺母）
const ICON_SETTINGS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" fill="currentColor">'
  + '<path fill-rule="evenodd" d="M18 14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-1 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>'
  + '<path fill-rule="evenodd" d="M8.5 5h11l5 9-5 9h-11l-5-9 5-9Zm-3.86 9L9.1 6h9.82l4.45 8-4.45 8H9.1l-4.45-8Z"/></svg>';

// 重复绘制（循环箭头 + 时钟加号）
const ICON_REPEAT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">'
  + '<path fill="currentColor" d="m19.54 4.5 3.96 4.32-.74.68-3.96-4.32.74-.68ZM7.46 4.5 3.5 8.82l.74.68L8.2 5.18l-.74-.68ZM19.74 10.33A7.5 7.5 0 0 1 21 14.5v.5h1v-.5a8.5 8.5 0 1 0-8.5 8.5h.5v-1h-.5a7.5 7.5 0 1 1 6.24-11.67Z"/>'
  + '<path fill="currentColor" d="M13 9v5h-3v1h4V9h-1ZM19 20v-4h1v4h4v1h-4v4h-1v-4h-4v-1h4Z"/></svg>';

// 锁（解锁态）
const ICON_LOCK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">'
  + '<path fill="currentColor" fill-rule="evenodd" d="M14 6a3 3 0 0 0-3 3v3h8.5a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 6 21.5v-7A2.5 2.5 0 0 1 8.5 12H10V9a4 4 0 0 1 8 0h-1a3 3 0 0 0-3-3zm-1 11a1 1 0 1 1 2 0v2a1 1 0 1 1-2 0v-2zm-6-2.5c0-.83.67-1.5 1.5-1.5h11c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-11A1.5 1.5 0 0 1 7 21.5v-7z"/></svg>';

// 删除（垃圾桶）
const ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">'
  + '<path fill="currentColor" d="M18 7h5v1h-2.01l-1.33 14.64a1.5 1.5 0 0 1-1.5 1.36H9.84a1.5 1.5 0 0 1-1.49-1.36L7.01 8H5V7h5V6c0-1.1.9-2 2-2h4a2 2 0 0 1 2 2v1Zm-6-2a1 1 0 0 0-1 1v1h6V6a1 1 0 0 0-1-1h-4ZM8.02 8l1.32 14.54a.5.5 0 0 0 .5.46h8.33a.5.5 0 0 0 .5-.46L19.99 8H8.02Z"/></svg>';

// 更多（三点）
const ICON_MORE = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" fill="none">'
  + '<path fill="currentColor" d="M7.5 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM5 14.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0zm9.5-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 14.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0zm9.5-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19 14.5a2.5 2.5 0 1 1 5 0 2.5 2.5 0 0 1-5 0z"/></svg>';

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

const fmtPx = (w: number): string => (Number.isInteger(w) ? String(w) : w.toFixed(1)) + 'px';

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

  /** 造一个 38x38 按钮（hover 灰 pill 由 CSS 画） */
  const mkBtn = (icon: string, title: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = 'kc-propsbar-btn';
    b.title = title;
    b.innerHTML = '<span class="pill"></span>' + icon;
    return b;
  };

  /* —— 拖拽手柄：抓着挪整条 —— */
  const grip = document.createElement('div');
  grip.className = 'kc-propsbar-grip';
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

  const cur = (): { d: Drawing; l: DrawLayer } | null => {
    const l = getLayer();
    const d = l ? l.active() : null;
    return l && d ? { d, l } : null;
  };

  /* —— 克隆（三方块 + 加号）—— */
  const cloneBtn = mkBtn(ICON_CLONE, '克隆副本');
  cloneBtn.addEventListener('click', () => { const c = cur(); if (c) c.l.clone(c.d.id); });
  bar.appendChild(cloneBtn);

  /* —— 取色：铅笔 + 当前色条，点开调色板 —— */
  const colorBtn = document.createElement('button');
  colorBtn.className = 'kc-propsbar-btn';
  colorBtn.title = '颜色';
  const colorChipInner = document.createElement('div');
  colorChipInner.style.background = '#2962ff';
  colorChipInner.innerHTML = '';
  const colorChip = document.createElement('div');
  colorChip.className = 'kc-propsbar-chip';
  colorChip.appendChild(colorChipInner);
  colorBtn.innerHTML = '<span class="pill"></span>';
  const colorStack = document.createElement('span');
  colorStack.className = 'kc-propsbar-stack';
  colorStack.innerHTML = ICON_PENCIL;
  colorStack.appendChild(colorChip);
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

  /* —— 线宽：厚线图标 + 「Npx」，点开宽度选择 —— */
  const widthBtn = document.createElement('button');
  widthBtn.className = 'kc-propsbar-btn';
  widthBtn.title = '线宽';
  widthBtn.innerHTML = '<span class="pill"></span>';
  const widthRow = document.createElement('span');
  widthRow.className = 'kc-propsbar-wrow';
  const widthIcon = document.createElement('span');
  widthIcon.innerHTML = ICON_WIDTH;
  const widthLabel = document.createElement('span');
  widthLabel.className = 'kc-propsbar-wlabel';
  widthLabel.textContent = '4px';
  widthRow.appendChild(widthIcon.firstChild as HTMLElement);
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
      sample.style.height = Math.min(w + 2, 10) + 'px';
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

  /* —— 设置：线型（实线 / 虚线 / 点线）—— */
  const setBtn = mkBtn(ICON_SETTINGS, '设置');
  setBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'kc-propsbar-pop';
    el.innerHTML = '<div class="pop-title">线型</div>';
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
        const cc = cur();
        if (!cc) return;
        c.l.setStyle(cc.d.id, { dash: dash.slice() });
        closePop();
      });
      rows.appendChild(b);
    }
    el.appendChild(rows);
    openPop(setBtn, el);
  });
  bar.appendChild(setBtn);

  /* —— 重复绘制（aria-pressed 开关）—— */
  const repeatBtn = mkBtn(ICON_REPEAT, '重复绘制');
  repeatBtn.setAttribute('aria-pressed', 'false');
  repeatBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    c.l.setRepeat(!c.l.repeatDraw);
    sync();
  });
  bar.appendChild(repeatBtn);

  /* —— 锁定（aria-pressed 开关；锁定后不能拖、Delete 删不掉；橡皮擦照擦，同官方）—— */
  const lockBtn = mkBtn(ICON_LOCK, '锁定');
  lockBtn.setAttribute('aria-pressed', 'false');
  lockBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    c.l.setLocked(c.d.id, !c.d.locked);
    sync();
  });
  bar.appendChild(lockBtn);

  /* —— 删除（锁定时禁用）—— */
  const trashBtn = mkBtn(ICON_TRASH, '删除');
  trashBtn.addEventListener('click', () => {
    const c = cur();
    if (!c || c.d.locked) return;
    c.l.remove(c.d.id);
  });
  bar.appendChild(trashBtn);

  /* —— 更多：克隆 / 删除全部 —— */
  const moreBtn = mkBtn(ICON_MORE, '更多');
  moreBtn.addEventListener('click', () => {
    const c = cur();
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'kc-propsbar-pop';
    const rows = document.createElement('div');
    rows.className = 'kc-propsbar-rows';
    const mkRow = (label: string, fn: () => void): void => {
      const b = document.createElement('button');
      const lab = document.createElement('span');
      lab.textContent = label;
      b.appendChild(lab);
      b.addEventListener('click', () => { fn(); closePop(); });
      rows.appendChild(b);
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
    }
    const r = cv.getBoundingClientRect();
    const left = r.left + a.x + (manual ? manual.dx : 0);
    const top = r.top + a.y + (manual ? manual.dy : 0);
    bar.style.left = Math.max(8, Math.min(left, window.innerWidth - bar.offsetWidth - 8)) + 'px';
    bar.style.top = Math.max(8, Math.min(top, window.innerHeight - bar.offsetHeight - 8)) + 'px';
    bar.classList.add('open');
    // 状态回填
    widthLabel.textContent = fmtPx(c.d.style.width);
    colorChipInner.style.background = c.d.style.color;
    repeatBtn.setAttribute('aria-pressed', String(c.l.repeatDraw));
    repeatBtn.classList.toggle('on', c.l.repeatDraw);
    lockBtn.setAttribute('aria-pressed', String(c.d.locked));
    lockBtn.classList.toggle('on', c.d.locked);
    trashBtn.disabled = c.d.locked;
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
