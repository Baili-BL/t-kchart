import { create } from 'zustand';
import { ReplayController } from '../engine/replay';
import type { ReplayState } from '../engine/replay';

/**
 * 回放状态的唯一来源。
 *   controller —— 纯状态机（engine/replay.ts），所有进度 / 速度 / 播放逻辑都在里面
 *   store      —— 把状态镜像给 React（顶栏按钮高亮、控制条）；tile 记下是**哪一格**在回放
 * 图表怎么被截断由 ChartGridView 订阅 controller 去驱动，这里不碰 ChartGrid。
 */
export const replayController = new ReplayController();

interface ReplayStoreState {
  replay: ReplayState;
  /** 正在回放的格序号；没在回放时为 -1 */
  tile: number;
  setTile: (tile: number) => void;
}

export const useReplayStore = create<ReplayStoreState>((set) => ({
  replay: replayController.state(),
  tile: -1,
  setTile: (tile) => set({ tile }),
}));

replayController.subscribe((replay) => {
  useReplayStore.setState(replay.active ? { replay } : { replay, tile: -1 });
});
