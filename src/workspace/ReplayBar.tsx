import { useEffect } from 'react';
import { REPLAY_SPEEDS } from '../engine/replay';
import { replayController, useReplayStore } from '../store/replayStore';
import { getGrid } from './gridRegistry';
import { stopReplay } from './replayActions';

/** 按 100ms 一次把「真实经过的毫秒数」喂给状态机；速度 / 到头自动停都在状态机里，这里只是个节拍器 */
function useReplayClock(playing: boolean): void {
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      replayController.tick(now - last);
      last = now;
    }, 100);
    return () => clearInterval(id);
  }, [playing]);
}

function fmtTime(t: number): string {
  return new Date(t).toISOString().replace('T', ' ').slice(0, 16);
}

/** 回放控制条：只在回放中显示，浮在图表区顶部居中 */
export function ReplayBar(): JSX.Element | null {
  const r = useReplayStore((s) => s.replay);
  const tile = useReplayStore((s) => s.tile);
  useReplayClock(r.playing);
  if (!r.active) return null;

  const chart = getGrid()?.charts()[tile];
  const bar = chart && chart.bars.length ? chart.bars[chart.bars.length - 1] : null;
  const atEnd = r.index >= r.total - 1;

  return (
    <div className="replay-bar" role="group" aria-label="K线回放">
      <button type="button" aria-label="回放·后退一根" title="后退一根" disabled={r.index <= 0} onClick={() => replayController.stepBack()}>
        ◀|
      </button>
      <button
        type="button"
        className="play"
        aria-label={r.playing ? '回放·暂停' : '回放·播放'}
        title={r.playing ? '暂停' : atEnd ? '已到最后一根' : '播放'}
        disabled={atEnd && !r.playing}
        onClick={() => replayController.togglePlay()}
      >
        {r.playing ? '❚❚' : '▶'}
      </button>
      <button type="button" aria-label="回放·前进一根" title="前进一根" disabled={atEnd} onClick={() => replayController.stepForward()}>
        |▶
      </button>
      <select
        aria-label="回放·速度"
        title="播放速度（每秒几根）"
        value={r.speed}
        onChange={(e) => replayController.setSpeed(Number(e.target.value))}
      >
        {REPLAY_SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s} 根/秒
          </option>
        ))}
      </select>
      <span className="replay-pos" aria-live="polite">
        {r.index + 1} / {r.total}
        {bar ? ' · ' + fmtTime(bar.time) : ''}
      </span>
      <button type="button" className="exit" aria-label="回放·退出" title="退出回放" onClick={stopReplay}>
        退出
      </button>
    </div>
  );
}
