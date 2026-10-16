import type { ChartGrid } from '../engine/grid';

/**
 * 当前挂载的 ChartGrid。
 * React 组件、Agent 工具都需要「摸到」图表实例，但实例不该进 store
 * （它不是可序列化状态），所以放在模块级的注册表里。
 */
let current: ChartGrid | null = null;
const listeners = new Set<() => void>();

export function registerGrid(g: ChartGrid | null): void {
  current = g;
  listeners.forEach((fn) => fn());
}

export function getGrid(): ChartGrid | null {
  return current;
}

export function onGridChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
