import { create } from 'zustand';

export type NavKey = 'quant' | 'strategies' | 'alerts' | 'screener';
/** 右侧图标栏按钮的 aria-label（见 dom/rightbar.ts），同时是面板标题 */
export type RightPanelKind = string;
export type Theme = 'light' | 'dark';

export interface UserInfo {
  name: string;
  email: string;
  credits: number;
}

interface AppState {
  nav: NavKey;
  sidebarCollapsed: boolean;
  /** Agent 面板宽度（px） */
  agentWidth: number;
  agentCollapsed: boolean;
  rightPanel: RightPanelKind | null;
  theme: Theme;
  user: UserInfo;

  setNav: (n: NavKey) => void;
  toggleSidebar: () => void;
  setAgentWidth: (w: number) => void;
  toggleAgent: () => void;
  setRightPanel: (k: RightPanelKind | null) => void;
  toggleRightPanel: (k: RightPanelKind) => void;
  closeRightPanel: () => void;
  toggleTheme: () => void;
}

export const AGENT_MIN = 260;
export const AGENT_MAX = 560;

export const useAppStore = create<AppState>((set) => ({
  nav: 'quant',
  sidebarCollapsed: false,
  agentWidth: 310,
  agentCollapsed: false,
  rightPanel: null,
  theme: 'light',
  user: { name: 'kevin', email: 'kevin@example.com', credits: 295 },

  setNav: (nav) => set({ nav }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setAgentWidth: (w) => set({ agentWidth: Math.min(AGENT_MAX, Math.max(AGENT_MIN, Math.round(w))) }),
  toggleAgent: () => set((s) => ({ agentCollapsed: !s.agentCollapsed })),
  setRightPanel: (rightPanel) => set({ rightPanel }),
  toggleRightPanel: (k) => set((s) => ({ rightPanel: s.rightPanel === k ? null : k })),
  closeRightPanel: () => set({ rightPanel: null }),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      return { theme };
    }),
}));
