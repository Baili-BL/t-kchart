import { create } from 'zustand';

/** 「比较商品」弹窗的开关（顶栏「比较」按钮打开） */
interface CompareDialogState {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useCompareDialogStore = create<CompareDialogState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
