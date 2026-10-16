import { useCallback, useEffect, useState } from 'react';
import { RANGES } from '../engine/chart';
import { getGrid, onGridChange } from './gridRegistry';
import { daysBetween, matchRange } from './rangeMatch';
import { useChartStore } from '../store/chartStore';

interface BtnState {
  key: string;
  label: string;
  ok: boolean;
}

function useUtcClock(): string {
  const fmt = (): string => new Date().toISOString().slice(11, 19);
  const [t, setT] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setT(fmt()), 1000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/**
 * 底部显示范围条。
 * 注意：这是「视口覆盖多长时间」，不是 K 线周期（README §9）。
 * 高亮按当前视口跨度反推，不记「上次点了哪个」。
 */
export function RangeBar(): JSX.Element {
  const [btns, setBtns] = useState<BtnState[]>(() => RANGES.map((r) => ({ key: r.key, label: r.label, ok: false })));
  const [active, setActive] = useState<string | null>(null);
  const [session, setSession] = useState<'RTH' | 'ETH'>('RTH');
  const clock = useUtcClock();
  // 活动格 / 标的 / 周期变了也要刷新
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const activeTile = useChartStore((s) => s.activeTile);

  const refresh = useCallback((): void => {
    const g = getGrid();
    if (!g) return;
    setBtns(g.rangeAvailability());
    const chart = g.charts()[g.activeIndex()];
    if (!chart || !chart.bars.length) return setActive(null);
    const vt = chart.viewTimes();
    if (!vt) return setActive(null);
    const bars = chart.bars;
    const last = bars[bars.length - 1].time;
    const yStart = new Date(new Date(last).getFullYear(), 0, 1).getTime();
    setActive(
      matchRange({
        spanDays: daysBetween(vt[0], vt[1]),
        dataDays: daysBetween(bars[0].time, last),
        atRightEdge: vt[1] === last,
        ytdDays: daysBetween(yStart, last),
      }),
    );
  }, []);

  useEffect(() => {
    let detach: (() => void) | null = null;
    const bind = (): void => {
      detach?.();
      detach = null;
      const g = getGrid();
      if (!g) return;
      g.el.addEventListener('viewchange', refresh);
      g.el.addEventListener('activechange', refresh);
      const el = g.el;
      detach = () => {
        el.removeEventListener('viewchange', refresh);
        el.removeEventListener('activechange', refresh);
      };
      refresh();
    };
    bind();
    const off = onGridChange(bind);
    return () => {
      off();
      detach?.();
    };
  }, [refresh]);

  useEffect(refresh, [refresh, symbol, timeframe, activeTile]);

  const pick = (key: string, ok: boolean): void => {
    const g = getGrid();
    if (!g || !ok) return;
    g.setRange(key);
    refresh();
  };

  return (
    <div className="rangebar">
      <div className="range-btns" role="group" aria-label="显示范围">
        {btns.map((b, i) => (
          <span key={b.key} className="range-cell">
            {b.key === 'ALL' && i > 0 && <span className="range-sep" />}
            <button
              type="button"
              className={'range-btn' + (active === b.key ? ' on' : '') + (b.ok ? '' : ' off')}
              disabled={!b.ok}
              aria-pressed={active === b.key}
              onClick={() => pick(b.key, b.ok)}
            >
              {b.label}
            </button>
          </span>
        ))}
      </div>
      <span className="rangebar-spacer" />
      <span className="clock">{clock} UTC</span>
      <div className="seg" role="group" aria-label="交易时段">
        {(['RTH', 'ETH'] as const).map((s) => (
          <button
            type="button"
            key={s}
            className={session === s ? 'on' : ''}
            aria-pressed={session === s}
            onClick={() => setSession(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
