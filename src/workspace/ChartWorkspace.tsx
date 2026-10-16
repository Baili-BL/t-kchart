import { ChartGridView } from './ChartGridView';
import { DrawToolbar } from './DrawToolbar';
import { IndicatorDialog, StudySettingsDialog } from './IndicatorDialog';
import { PaperTrade } from './PaperTrade';
import { ReplayBar } from './ReplayBar';
import { RangeBar } from './RangeBar';
import { RightPanel } from './RightPanel';
import { RightRail } from './RightRail';
import { TopBar } from './TopBar';

/** 右侧专业图表软件风格的图表区：顶栏 / 绘图栏 / 多图网格 / 范围条 / 右侧面板 / 右侧图标栏 */
export function ChartWorkspace(): JSX.Element {
  return (
    <div className="workspace">
      <div className="ws-main">
        <TopBar />
        <div className="ws-middle">
          <DrawToolbar />
          <div className="ws-grid">
            <ChartGridView />
            <PaperTrade />
            <ReplayBar />
          </div>
        </div>
        <RangeBar />
      </div>
      <RightPanel />
      <RightRail />
      <IndicatorDialog />
      <StudySettingsDialog />
    </div>
  );
}
