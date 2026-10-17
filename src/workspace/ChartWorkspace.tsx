import { ChartGridView } from './ChartGridView';
import { DrawToolbar } from './DrawToolbar';
import { AlertDialog } from './AlertDialog';
import { SettingsDialog } from './SettingsDialog';
import { TradePanel } from './TradePanel';
import { IndicatorDialog, StudySettingsDialog } from './IndicatorDialog';
import { ReplayBar } from './ReplayBar';
import { RangeBar } from './RangeBar';
import { RightPanel } from './RightPanel';
import { RightRail } from './RightRail';
import { SymbolSearchDialog } from './SymbolSearchDialog';
import { TopBar } from './TopBar';
import { useChartSettingsStore } from '../store/chartSettingsStore';

/** 右侧专业图表软件风格的图表区：顶栏 / 绘图栏 / 多图网格 / 范围条 / 右侧面板 / 右侧图标栏 */
export function ChartWorkspace(): JSX.Element {
  const buySell = useChartSettingsStore((s) => s.settings.buySell);
  return (
    <div className="workspace">
      <div className="ws-main">
        <TopBar />
        {/* 左栏（绘图工具栏）穿到底：底部范围条只占它右边那一块，不再从它下面横过去 */}
        <div className="ws-body">
          <DrawToolbar />
          <div className="ws-stack">
            <div className="ws-grid">
              <ChartGridView />
              {buySell && <TradePanel />}
              <ReplayBar />
            </div>
            <RangeBar />
          </div>
        </div>
      </div>
      <RightPanel />
      <RightRail />
      <SymbolSearchDialog />
      <AlertDialog />
      <SettingsDialog />
      <IndicatorDialog />
      <StudySettingsDialog />
    </div>
  );
}
