import { create } from 'zustand';

/** 「创建警报」弹窗的开关。右侧警报面板 / Alerts 页 / 顶栏警报按钮都走这里 */
interface AlertDialogState {
  open: boolean;
  openDialog: () => void;
  closeDialog: () => void;
}

export const useAlertDialogStore = create<AlertDialogState>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  closeDialog: () => set({ open: false }),
}));
