import { REPLAY_SPEEDS } from '../engine/replay';
import { replayController, useReplayStore } from '../store/replayStore';
import { getGrid } from './gridRegistry';

export interface ReplayResult {
  ok: boolean;
  message: string;
}

const MAX_STEPS = 500;

/** 从活动格视口正中间那根开始回放（至少留一根「未来」可以播） */
export function startReplay(): ReplayResult {
  const g = getGrid();
  if (!g) return { ok: false, message: '图表尚未就绪' };
  const tile = g.activeIndex();
  const chart = g.charts()[tile];
  if (!chart) return { ok: false, message: '没有活动图' };
  const total = chart.fullBarCount();
  if (total < 3) return { ok: false, message: `数据只有 ${total} 根，不够回放` };
  const idx = Math.min(Math.max(chart.centerIndex(), Math.min(20, total - 2)), total - 2);
  // 先记下是哪一格，再启动：启动会同步通知 ChartGridView，它要用这个序号去截断对应的图
  useReplayStore.getState().setTile(tile);
  if (!replayController.start(idx, total)) {
    useReplayStore.getState().setTile(-1);
    return { ok: false, message: '无法启动回放' };
  }
  return { ok: true, message: `已进入回放，停在第 ${idx + 1} / ${total} 根（仅活动格）` };
}

export function stopReplay(): void {
  replayController.stop();
}

export function toggleReplay(): ReplayResult {
  if (replayController.state().active) {
    stopReplay();
    return { ok: true, message: '已退出回放' };
  }
  return startReplay();
}

export const REPLAY_ACTIONS = ['start', 'stop', 'play', 'pause', 'step', 'back', 'speed'] as const;
export type ReplayAction = (typeof REPLAY_ACTIONS)[number];

/** Agent 工具的入口：参数在 tools.ts 里已经校验过，这里再兜一层，状态不对就如实说 */
export function replayControl(action: ReplayAction, value?: number): ReplayResult {
  const c = replayController;
  if (action === 'start') return c.state().active ? { ok: true, message: '已经在回放中' } : startReplay();
  if (!c.state().active) return { ok: false, message: '当前没有在回放，请先 start' };
  switch (action) {
    case 'stop':
      stopReplay();
      return { ok: true, message: '已退出回放' };
    case 'play':
      return c.play()
        ? { ok: true, message: `开始播放（每秒 ${c.state().speed} 根）` }
        : { ok: false, message: '已经在最后一根，无法继续播放' };
    case 'pause':
      c.pause();
      return { ok: true, message: '已暂停' };
    case 'step': {
      const n = Math.min(MAX_STEPS, Math.max(1, Math.round(value ?? 1)));
      let moved = 0;
      for (let i = 0; i < n && c.stepForward(); i++) moved++;
      return moved
        ? { ok: true, message: `前进 ${moved} 根，现在第 ${c.state().index + 1} / ${c.state().total} 根${moved < n ? '（已到最后一根）' : ''}` }
        : { ok: false, message: '已经在最后一根' };
    }
    case 'back': {
      const n = Math.min(MAX_STEPS, Math.max(1, Math.round(value ?? 1)));
      let moved = 0;
      for (let i = 0; i < n && c.stepBack(); i++) moved++;
      return moved
        ? { ok: true, message: `后退 ${moved} 根，现在第 ${c.state().index + 1} / ${c.state().total} 根` }
        : { ok: false, message: '已经在第一根' };
    }
    case 'speed': {
      if (value === undefined || !(REPLAY_SPEEDS as readonly number[]).includes(value)) {
        return { ok: false, message: `速度必须是 ${REPLAY_SPEEDS.join(' / ')} 之一（每秒几根）` };
      }
      c.setSpeed(value);
      return { ok: true, message: `回放速度已设为每秒 ${value} 根` };
    }
  }
}
