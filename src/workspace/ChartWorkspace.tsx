import { ChartGridView } from './ChartGridView';
import { DrawToolbar } from './DrawToolbar';
import { PaperTrade } from './PaperTrade';
import { RangeBar } from './RangeBar';
import { RightPanel } from './RightPanel';
import { RightRail } from './RightRail';
import { TopBar } from './TopBar';

/** 右侧类 TradingView 图表区：顶栏 / 绘图栏 / 多图网格 / 范围条 / 右侧面板 / 右侧图标栏 */
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
          </div>
        </div>
        <RangeBar />
      </div>
      <RightPanel />
      <RightRail />
    </div>
  );
}
