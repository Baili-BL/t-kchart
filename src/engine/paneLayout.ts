/**
 * kc-chart / paneLayout.ts
 * ---------------------------------------------------------------------------
 * 副图（pane）布局的**纯计算**：默认等高 → 权重可拖 → 最大化 / 折叠。
 * 不碰 canvas / DOM，vitest 可以直接测；chart.ts 只负责命中、拖拽与绘制。
 *
 * 布局模型：
 *   - 可用高度 avail = H - 时间轴高度 - 顶部留白(6)。
 *   - 没拖过：每格默认高度与旧版 paneHeight() 完全一致
 *     （each = clamp(round(avail*0.22), 60, 200)，总高 = min(each*k, avail*0.6)），
 *     保证「主图至少留 40%」的既有断言不变红。
 *   - 拖主图↔副图分隔条：paneTotalPx（副图总面积）变化，增量全部给上方被拖的副图，
 *     其它副图像素高度不变（单位 = px/权重 在拖拽中不变，见 chart.ts 的推导）。
 *   - 拖副图↔副图分隔条：权重此消彼长，总面积不变。
 *   - 最大化：主图压成细条，被最大化的副图占满其余空间，其余副图收窄到最小高度。
 *   - 折叠：副图收成一条细标题栏。
 * ========================================================================= */

/** 一个副图的交互状态（按指标 uid 存在 KChart 上） */
export interface PaneLayoutState {
  /** 相对权重（默认 100）。拖副图间分隔条时此消彼长 */
  weight: number;
  /** 折叠成细标题栏 */
  collapsed: boolean;
  /** 最大化（同一时刻最多一个；与 collapsed 互斥） */
  maximized: boolean;
}

export function defaultPaneState(): PaneLayoutState {
  return { weight: 100, collapsed: false, maximized: false };
}

/** 折叠后的细标题栏高度 */
export const PANE_COLLAPSED_H = 22;
/** 最大化时主图保留的细条高度 */
export const PANE_MAX_MAIN_H = 64;
/** 最大化时其它副图的兜底高度 / 拖拽下限下副图最小高度 */
export const PANE_MIN_H = 40;
/** 拖拽后主图允许的最小高度 */
export const PANE_MAIN_MIN_H = 90;
/** 权重下限（防止某个副图被拖没） */
export const PANE_MIN_WEIGHT = 20;
/** 分隔条的命中半径（±px） */
export const PANE_SEPARATOR_HIT = 5;

export interface PaneLayout {
  /** 主图高度（avail - 副图总面积） */
  mainH: number;
  /** 与传入 states 一一对应的高度（collapsed = 细条高度） */
  heights: number[];
  /** 副图总面积（heights 之和） */
  paneTotal: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 默认（没拖过）状态下的副图总面积 —— 与旧版 paneHeight() 的总量公式一致 */
export function defaultPaneTotal(avail: number, k: number): number {
  if (k <= 0) return 0;
  const each = clamp(Math.round(avail * 0.22), 60, 200);
  return Math.min(each * k, avail * 0.6);
}

/** 副图总面积的合法区间。
 *  @param dragged true = 用户拖过（下限 PANE_MIN_H，拖不没）；false = 默认自动布局，
 *                 下限沿用旧版每格 24px —— 小窗口 + 多副图时 40px 下限会顶破「总高 ≤ 60%」的既有不变式 */
export function paneTotalRange(avail: number, states: PaneLayoutState[], dragged = true): { min: number; max: number } {
  const strips = states.filter((s) => s.collapsed).length * PANE_COLLAPSED_H;
  const normals = states.filter((s) => !s.collapsed).length;
  const min = strips + (dragged ? PANE_MIN_H : 24) * normals;
  const max = Math.max(min, avail - PANE_MAIN_MIN_H);
  return { min, max };
}

/**
 * 布局主计算。
 * @param avail        可用高度（H - 时间轴 - 顶部留白）
 * @param states       与副图顺序一一对应的状态
 * @param paneTotalPx  用户拖出来的副图总面积；null = 还没拖过（用默认）
 */
export function computePaneLayout(avail: number, states: PaneLayoutState[], paneTotalPx: number | null): PaneLayout {
  const k = states.length;
  if (k === 0 || !(avail > 0)) return { mainH: Math.max(1, avail), heights: [], paneTotal: 0 };

  // ---- 最大化：主图压成细条，被最大化的副图吃掉其余空间
  if (states.some((s) => s.maximized)) {
    const fixed = states.reduce((sum, s) => sum + (s.maximized ? 0 : s.collapsed ? PANE_COLLAPSED_H : PANE_MIN_H), 0);
    const fill = Math.max(PANE_MIN_H, avail - PANE_MAX_MAIN_H - fixed);
    const heights = states.map((s) => (s.maximized ? fill : s.collapsed ? PANE_COLLAPSED_H : PANE_MIN_H));
    const paneTotal = heights.reduce((s, h) => s + h, 0);
    return { mainH: Math.max(1, avail - paneTotal), heights, paneTotal };
  }

  const { min, max } = paneTotalRange(avail, states, paneTotalPx != null);
  const wanted = clamp(paneTotalPx == null ? defaultPaneTotal(avail, k) : paneTotalPx, min, max);

  // ---- 权重分配（floor + 余数给最后一个普通副图，保证 Σheights = paneTotal）
  const stripsPx = states.filter((s) => s.collapsed).length * PANE_COLLAPSED_H;
  const budget = Math.max(0, wanted - stripsPx);
  const normals = states.filter((s) => !s.collapsed);
  const wsum = normals.reduce((s, x) => s + Math.max(PANE_MIN_WEIGHT, x.weight), 0) || 1;
  const lastNormal = (() => { for (let i = k - 1; i >= 0; i--) if (!states[i].collapsed) return i; return -1; })();

  const heights: number[] = new Array(k).fill(PANE_COLLAPSED_H);
  let normalUsed = 0;
  for (let i = 0; i < k; i++) {
    const s = states[i];
    if (s.collapsed) continue;
    const w = Math.max(PANE_MIN_WEIGHT, s.weight);
    // 最后一个普通副图吸收 floor 的余数与 24px 下限的差值，保证总面积守恒
    const h = i === lastNormal
      ? Math.max(24, budget - normalUsed)
      : Math.max(24, Math.floor((budget * w) / wsum));
    heights[i] = h;
    normalUsed += h;
  }
  const paneTotal = normalUsed + stripsPx;
  // 主图兜底：极端小窗口下 Σheights 可能吃穿 avail
  return { mainH: Math.max(1, avail - paneTotal), heights, paneTotal };
}
