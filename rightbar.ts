// tv-rightbar —— TradingView 图表页右侧边栏工具条
// 依据 magicpatterns 导入稿（cn.tradingview.com）1:1 还原：
// 宽 45px、白底、padding 2px 0、按钮 44×44（图标整幅 44×44）、
// 悬停药丸 34×34 圆角 6px（rgb(242,242,242)），选中同药丸 rgb(235,235,235)；
// 上组：自选表/警报/对象树；弹性撑开；下组：AI Copilot/筛选器/Pine Editor/
// 日历/社区/通知/聊天/产品 + 33px 分隔线 + 帮助中心。
// 用法：createRightbar(document.getElementById('mount'));
import { WATCHLIST, ALERTS, OBJECT_TREE, AI_COPILOT, SCREENER, PINE_EDITOR, CALENDAR, COMMUNITY, NOTIFICATIONS, CHAT, PRODUCTS, HELP } from './rightbar-icons.js';

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
.tv-rightbar {
  display: flex; flex-direction: column; align-items: center; flex: 0 0 auto;
  width: 45px; padding: 2px 0; background: #fff; color: rgb(15,15,15);
  user-select: none; position: relative; z-index: 100;
  font: 400 14px/normal -apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif;
  font-feature-settings: "lnum","tnum";
}
.tv-rb-btn {
  position: relative; z-index: 0; display: flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; margin: 0; padding: 0; flex: 0 0 auto;
  border: 0; border-radius: 0; background: transparent; cursor: pointer;
  transition: background-color .06s ease, opacity .06s ease, color .06s ease;
}
.tv-rb-btn + .tv-rb-btn { margin-top: 2px; }
.tv-rb-btn svg { display: block; }
.tv-rb-btn .pill {
  position: absolute; z-index: -1; left: 5px; top: 5px; width: 34px; height: 34px;
  border-radius: 6px; background: transparent;
}
.tv-rb-btn:hover .pill { background: rgb(242,242,242); }
.tv-rb-btn.tv-on .pill { background: rgb(235,235,235); }
.tv-rb-btn.tv-on svg { color: rgb(41,98,255); }
.tv-rb-spacer { flex: 1 1 100%; min-height: 16px; width: 45px; }
.tv-rb-div {
  width: 33px; align-self: stretch; flex: 0 0 auto;
  border: 0; border-top: 1px solid rgb(235,235,235); margin: 6px;
}
`;

function injectStyle(): void {
  if (document.getElementById('tv-rightbar-css')) return;
  const s = document.createElement('style');
  s.id = 'tv-rightbar-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ 组件 */
export interface RightbarCallbacks {
  onSelect?: (label: string, on: boolean) => void;
}

export function createRightbar(mount: HTMLElement, cb: RightbarCallbacks = {}): HTMLElement {
  injectStyle();

  const root = el('div', 'tv-rightbar');
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-orientation', 'vertical');
  root.setAttribute('aria-label', '右侧边栏工具条');

  let selected: HTMLButtonElement | null = null;

  function makeBtn(icon: string, label: string): HTMLButtonElement {
    const btn = el('button', 'tv-rb-btn') as HTMLButtonElement;
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', 'false');
    btn.title = label;
    btn.innerHTML = `<span class="pill"></span>${icon}`;
    btn.addEventListener('click', () => {
      // 再次点击已选中的按钮 = 收起面板
      const on = btn !== selected;
      selected?.classList.remove('tv-on');
      selected?.setAttribute('aria-pressed', 'false');
      if (on) {
        btn.classList.add('tv-on');
        btn.setAttribute('aria-pressed', 'true');
        selected = btn;
      } else {
        selected = null;
      }
      cb.onSelect?.(label, on);
    });
    return btn;
  }

  // 上组：自选表 / 警报 / 对象树
  root.append(
    makeBtn(WATCHLIST, '自选表、详情和新闻'),
    makeBtn(ALERTS, '警报'),
    makeBtn(OBJECT_TREE, '对象树和数据窗口'),
  );

  // 弹性撑开（原稿中段为 flexGrow 占位）
  root.appendChild(el('div', 'tv-rb-spacer'));

  // 下组：AI Copilot / 筛选器 / Pine Editor / 日历 / 社区 / 通知 / 聊天 / 产品 + 分隔线 + 帮助中心
  root.append(
    makeBtn(AI_COPILOT, 'AI Copilot'),
    makeBtn(SCREENER, '筛选器'),
    makeBtn(PINE_EDITOR, 'Pine Editor'),
    makeBtn(CALENDAR, '日历'),
    makeBtn(COMMUNITY, '社区'),
    makeBtn(NOTIFICATIONS, '通知'),
    makeBtn(CHAT, '聊天'),
    makeBtn(PRODUCTS, '产品'),
  );
  root.appendChild(el('hr', 'tv-rb-div'));
  root.appendChild(makeBtn(HELP, '帮助中心'));

  mount.appendChild(root);
  return root;
}
