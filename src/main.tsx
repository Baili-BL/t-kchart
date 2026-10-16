import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/app.css';
import { getGrid } from './workspace/gridRegistry';
import { useChartStore } from './store/chartStore';
import { useStudyStore } from './store/studyStore';
import { runBrowserSelfTests } from './dev/browserSelfTest';
import { replayController } from './store/replayStore';
import { LAYOUTS } from './engine/layouts';

// 仅开发环境：给 E2E / 控制台调试留个口子（生产构建里会被摇掉）
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__app = { getGrid, chartStore: useChartStore, studyStore: useStudyStore, replay: replayController, layouts: LAYOUTS, runBrowserSelfTests };
}

const root = document.getElementById('root');
if (!root) throw new Error('缺少 #root 容器');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
