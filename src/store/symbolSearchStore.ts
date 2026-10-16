import { create } from 'zustand';

/** 「商品代码搜索」弹窗的开关。顶栏品种胶囊 / 快速搜索 / 以后别的入口都走这里 */
interface SymbolSearchState {
  open: boolean;
  openSearch: () => void;
  closeSearch: () => void;
}

export const useSymbolSearchStore = create<SymbolSearchState>((set) => ({
  open: false,
  openSearch: () => set({ open: true }),
  closeSearch: () => set({ open: false }),
}));
