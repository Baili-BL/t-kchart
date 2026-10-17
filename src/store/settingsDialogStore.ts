import { create } from 'zustand';

/** 图表「设置」弹窗的开关。顶栏设置按钮走这里。 */
interface SettingsDialogState {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
