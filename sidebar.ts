// tv-sidebar —— TradingView 图表页左侧纵向绘图工具栏
// 依据 magicpatterns 导入稿（cn.tradingview.com）1:1 还原：
// 宽 52px、白底、行高 38px、图标 28×28；悬停/选中为 34×34 圆角药丸
// （悬停 rgb(242,242,242)，选中 rgb(235,235,235)）；带小箭头的按钮悬停时
// 右侧浮现 11px 宽箭头区（borderRadius 4px 0 0 4px），点击弹出子菜单；
// 箭头开合动画 cubic-bezier(0.175, 0.885, 0.32, 1.275) 0.5s。
// 用法：createSidebar(document.getElementById('mount'));
import {
  CROSS, TRENDLINE, FIB, PATTERN, LONG_POS, BRUSH, TEXT, STICKER,
  MEASURE, ZOOM, MAGNET, STAY_DRAWING, LOCK, HIDE_ALL, TRASH, CARET,
} from './sidebar-icons.js';

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
.tv-sidebar {
  display: flex; flex-direction: column; flex: 0 0 auto; width: 52px;
  background: rgb(235,235,235); color: rgb(15,15,15); user-select: none; position: relative; z-index: 100;
  font: 400 14px/normal -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  font-feature-settings: "lnum","tnum";
  overflow-y: auto; overflow-x: hidden; scrollbar-width: none;
}
.tv-sidebar::-webkit-scrollbar { display: none; }
.tv-sb-section { background: #fff; padding: 6px 0; position: relative; }
.tv-sb-div { height: 1px; background: rgb(235,235,235); margin: 0 8px; }
.tv-sb-section + .tv-sb-div + .tv-sb-section { padding-bottom: 6px; }
/* —— 工具行：52×38，主按钮 + 悬停浮现的箭头区 —— */
.tv-sb-tool { position: relative; width: 52px; }
.tv-sb-btn {
  position: relative; z-index: 0; display: block; width: 52px; height: 38px;
  border: 0; background: transparent; padding: 0; cursor: pointer;
  transition: background-color .06s ease, opacity .06s ease, color .06s ease;
}
.tv-sb-btn > svg { position: absolute; left: 12px; top: 5px; }
.tv-sb-btn .pill {
  position: absolute; z-index: -1; left: 9px; right: 9px; top: 2px; bottom: 2px;
  width: 34px; height: 34px; border-radius: 6px; background: transparent;
}
.tv-sb-btn:hover .pill { background: rgb(242,242,242); }
.tv-sb-btn.tv-sel .pill { background: rgb(235,235,235); }
.tv-sb-btn.tv-on .pill { background: rgb(231,240,255); }
/* —— 小箭头：默认隐藏，悬停浮现 —— */
.tv-sb-caret {
  position: absolute; right: 0; top: 2px; width: 11px; height: 34px;
  border: 0; padding: 0; background: transparent; cursor: pointer;
  border-radius: 4px 0 0 4px; opacity: 0; overflow: hidden;
  transition: opacity .1s ease;
}
.tv-sb-tool:hover .tv-sb-caret { opacity: 1; }
.tv-sb-caret > svg { position: absolute; left: 3px; top: 13px; width: 4px; height: 7px; fill: rgb(15,15,15); transition: transform .5s cubic-bezier(.175,.885,.32,1.275); }
.tv-sb-caret:hover > svg { transform: scale(1.25); }
.tv-sb-tool.open .tv-sb-caret > svg { transform: rotate(180deg); }
/* —— 子菜单：白卡阴影，右侧弹出 —— */
.tv-sb-menu {
  position: absolute; left: 52px; top: 0; min-width: 220px; padding: 6px 0; margin: 0;
  list-style: none; background: #fff; border-radius: 6px;
  box-shadow: 0 4px 10px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.04);
  font-size: 13px; z-index: 120; display: none;
}
.tv-sb-menu.open { display: block; }
.tv-sb-menu li {
  display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; cursor: pointer;
  transition: background-color .06s ease; white-space: nowrap;
}
.tv-sb-menu li:hover { background: rgb(242,242,242); }
.tv-sb-menu li > svg { flex: 0 0 auto; }
.tv-sb-menu li.sel { color: rgb(41,98,255); }
`;

function injectStyle(): void {
  if (document.getElementById('tv-sidebar-css')) return;
  const s = document.createElement('style');
  s.id = 'tv-sidebar-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------- 子菜单数据 */
// 主图标 / 箭头图标 / 悬停标题 / 子菜单项（标签 + 图标；未捕获到原稿子菜单内容，
// 按 TradingView 真实工具组给出常用项）
interface ToolDef { icon: string; caret?: string; label: string; items?: Array<[string, string]> }

// 分段与原稿分隔线位置一致：十字线 | 趋势/斐波 | 形态/仓位/笔刷/文字 | 图标 |
// 测量/放大 | 磁铁/继续/锁定/隐藏 | 移除。
// 子菜单内容原稿未捕获（均为收起态），按 TradingView 真实工具组给出常用项。
interface ToolDef { icon: string; caret?: string; label: string; items?: Array<[string, string]> }
type Section = { pad?: string; tools: ToolDef[] };

const SECTIONS: Section[] = [
  { tools: [
    { icon: CROSS, caret: CARET, label: '十字线', items: [['十字线', CROSS], ['光标', CROSS], ['点', CROSS], ['橡皮擦', CROSS]] },
  ]},
  { tools: [
    { icon: TRENDLINE, caret: CARET, label: '趋势线', items: [['趋势线', TRENDLINE], ['水平线', TRENDLINE], ['垂直线', TRENDLINE], ['平行通道', TRENDLINE]] },
    { icon: FIB, caret: CARET, label: '斐波那契回撤', items: [['斐波那契回撤', FIB], ['斐波那契扩展', FIB], ['斐波那契通道', FIB]] },
  ]},
  { tools: [
    { icon: PATTERN, caret: CARET, label: 'XABCD形态', items: [['XABCD形态', PATTERN], ['三角形形态', PATTERN], ['头肩形态', PATTERN]] },
    { icon: LONG_POS, caret: CARET, label: '多头仓位', items: [['多头仓位', LONG_POS], ['空头仓位', LONG_POS]] },
    { icon: BRUSH, caret: CARET, label: '笔刷', items: [['笔刷', BRUSH], ['荧光笔', BRUSH], ['路径', BRUSH]] },
    { icon: TEXT, caret: CARET, label: '文字', items: [['文字', TEXT], ['便签', TEXT], ['价格标签', TEXT], ['日期范围', TEXT]] },
  ]},
  { tools: [
    { icon: STICKER, caret: CARET, label: '图标', items: [['图标', STICKER], ['旗帜', STICKER], ['箭头标记', STICKER]] },
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
}

export function createSidebar(mount: HTMLElement, cb: SidebarCallbacks = {}): HTMLElement {
  injectStyle();

  const root = el('div', 'tv-sidebar');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-orientation', 'vertical');
  root.setAttribute('aria-label', '左侧绘图工具栏');

  const menus: HTMLElement[] = [];
  const closeMenus = (except?: HTMLElement): void => {
    menus.forEach(m => { if (m !== except) { m.classList.remove('open'); m.parentElement?.classList.remove('open'); } });
  };

  let selected: HTMLButtonElement | null = null;
  const pick = (btn: HTMLButtonElement, label: string): void => {
    selected?.classList.remove('tv-sel');
    btn.classList.add('tv-sel');
    selected = btn;
    cb.onTool?.(label);
  };

  for (const section of SECTIONS) {
    const sec = el('div', 'tv-sb-section');
    if (section.pad) sec.style.padding = section.pad;
    for (const t of section.tools) {
      const cell = el('div', 'tv-sb-tool');
      const btn = el('button', 'tv-sb-btn') as HTMLButtonElement;
      btn.type = 'button';
      btn.tabIndex = -1;
      btn.setAttribute('aria-label', t.label);
      btn.title = t.label;
      btn.innerHTML = `<span class="pill"></span>${t.icon}`;
      if (t.caret) {
        const caret = el('button', 'tv-sb-caret') as HTMLButtonElement;
        // 主按钮：工具类 → 选中；开关类 → 直接切换
        btn.addEventListener('click', () => {
          if (['锁定绘图和指标', '隐藏所有图形', '移除对象'].includes(t.label)) {
            const on = btn.classList.toggle('tv-on');
            cb.onToggle?.(t.label, on);
          } else {
            pick(btn, t.label);
          }
        });
        caret.type = 'button';
        caret.tabIndex = -1;
        caret.setAttribute('aria-label', t.label + '（子菜单）');
        caret.innerHTML = t.caret;
        const menu = el('ul', 'tv-sb-menu');
        for (const [label, icon] of t.items ?? []) {
          const li = el('li');
          li.innerHTML = icon + `<span>${label}</span>`;
          li.addEventListener('click', e => {
            e.stopPropagation();
            menu.querySelectorAll('li').forEach(x => x.classList.remove('sel'));
            li.classList.add('sel');
            closeMenus();
            pick(btn, label);
          });
          menu.appendChild(li);
        }
        caret.addEventListener('click', e => {
          e.stopPropagation();
          const was = menu.classList.contains('open');
          closeMenus();
          if (!was) { menu.classList.add('open'); cell.classList.add('open'); }
        });
        menus.push(menu);
        cell.appendChild(caret);
        cell.appendChild(menu);
      } else {
        btn.addEventListener('click', () => {
          if (t.label === '继续绘图') {
            const on = btn.classList.toggle('tv-on');
            cb.onToggle?.(t.label, on);
          } else {
            pick(btn, t.label);
          }
        });
      }
      cell.appendChild(btn);
      sec.appendChild(cell);
    }
    root.appendChild(sec);
    root.appendChild(el('div', 'tv-sb-div'));
  }

  document.addEventListener('click', () => closeMenus());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

  mount.appendChild(root);
  // 默认选中第一个工具（十字线），对应原稿 #ebebeb 选中药丸
  const first = root.querySelector('.tv-sb-btn') as HTMLButtonElement;
  first.classList.add('tv-sel');
  selected = first;
  return root;
}
