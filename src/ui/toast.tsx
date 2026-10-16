import { create } from 'zustand';

interface ToastState {
  message: string | null;
  show: (message: string, ms?: number) => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message, ms = 2200) => {
    if (timer) clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: null }), ms);
  },
}));

export function Toaster(): JSX.Element | null {
  const message = useToast((s) => s.message);
  if (!message) return null;
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
