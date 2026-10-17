/**
 * 仅开发环境：把各格的 DrawLayer 登记下来，供 E2E 断言「图形数 / 图形类型」。
 *
 * 为什么需要它：画布像素不能当撤销的判据 —— 指标线（布林带/EMA）与最后价虚线
 * 每次重绘的抗锯齿落点都不完全一致，一次重绘就会产生几百个差异像素，
 * 于是「撤销后回到基线」会被误判成失败。图形数才是真正的口径。
 */
import type { DrawLayer } from '../engine/draw';

const layers = new Set<DrawLayer>();

export function registerDrawLayer(layer: DrawLayer): void {
  layers.add(layer);
}

export function unregisterDrawLayer(layer: DrawLayer): void {
  layers.delete(layer);
}

export interface DrawLayerSnapshot {
  /** 该层当前工具 key（cursor / trend / pitchfork …） */
  tool: string;
  /** 已成型图形数 */
  count: number;
  /** 已成型图形的 type 列表（顺序即放置顺序） */
  types: string[];
  /** 未成型的待定图形已放置锚点数（0 表示没有半成品） */
  pending: number;
  /** 已锁定的图形数（左栏「锁定所有绘图」） */
  locked: number;
  /** emoji / 文字图元落笔的字符（顺序同 types 过滤后），用于断言「选的是哪个就落的哪个」 */
  texts: string[];
}

/** 所有活着的绘图层的快照 */
export function drawLayerSnapshots(): DrawLayerSnapshot[] {
  return [...layers].map((l) => ({
    tool: l.tool,
    count: l.drawings.length,
    types: l.drawings.map((d) => d.type),
    pending: l.pendingCount(),
    locked: l.drawings.filter((d) => d.locked).length,
    texts: l.drawings.filter((d) => d.type === 'emoji' || d.type === 'text').map((d) => d.style.text || ''),
  }));
}

/** 所有层的图形总数（多格布局下也适用） */
export function drawingCount(): number {
  let n = 0;
  for (const l of layers) n += l.drawings.length;
  return n;
}
