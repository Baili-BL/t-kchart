/**
 * kc-chart / replay.ts
 * ---------------------------------------------------------------------------
 * Bar Replay（K 线回放）的状态机。纯计算，不碰 DOM / 定时器 / 图表。
 *
 *   index  = 当前显示到第几根（0-based），图上可见的 bar 数 = index + 1
 *   tick() = 由外部用「经过了多少毫秒」驱动，不自己开定时器 ——
 *            所以播放速度、暂停、到头自动停都能被确定性地测试。
 *
 * 口径：
 *   · 回放只截断「显示」，不改数据：指标按截断后的序列**重算**（KChart.setReplayCount），
 *     因此指标值与「直接喂前 index+1 根」逐值一致，不会泄露未来。
 *   · 到最后一根自动暂停；已经在最后一根时 play() 返回 false，而不是悄悄从头再来。
 *   · 速度是「每秒前进几根」，只接受 REPLAY_SPEEDS 里的值，其它值抛错。
 * ---------------------------------------------------------------------------
 */

import { log } from './chart';

/** 每秒前进几根 */
export const REPLAY_SPEEDS = [1, 2, 5, 10, 30] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

export interface ReplayState {
  active: boolean;
  playing: boolean;
  /** 当前显示到第几根（0-based）；未启动时为 -1 */
  index: number;
  /** 数据总根数 */
  total: number;
  speed: ReplaySpeed;
}

export class ReplayController {
  private s: ReplayState;
  /** tick 里攒下的、还不够前进一根的毫秒数 */
  private acc = 0;
  private listeners = new Set<(s: ReplayState) => void>();

  constructor(total = 0) {
    this.s = { active: false, playing: false, index: -1, total: Math.max(0, Math.floor(total)), speed: 2 };
  }

  state(): ReplayState {
    return { ...this.s };
  }

  subscribe(fn: (s: ReplayState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const snap = this.state();
    this.listeners.forEach((fn) => fn(snap));
  }

  /** 进入回放，停在第 index 根（暂停）。数据为空时返回 false。 */
  start(index: number, total?: number): boolean {
    if (total !== undefined) this.s.total = Math.max(0, Math.floor(total));
    if (this.s.total < 1) return false;
    this.s.active = true;
    this.s.playing = false;
    this.s.index = this.clampIndex(index);
    this.acc = 0;
    this.emit();
    return true;
  }

  /** 退出回放（恢复显示全部）。没在回放时什么也不做。 */
  stop(): void {
    if (!this.s.active) return;
    this.s.active = false;
    this.s.playing = false;
    this.s.index = -1;
    this.acc = 0;
    this.emit();
  }

  /** 换了数据（标的 / 周期变了）：旧的回放位置已经没有意义，直接退出并更新总数 */
  reset(total: number): void {
    this.s.total = Math.max(0, Math.floor(total));
    this.s.active = false;
    this.s.playing = false;
    this.s.index = -1;
    this.acc = 0;
    this.emit();
  }

  /** 前进一根。已经在最后一根时返回 false 并停止播放。 */
  stepForward(): boolean {
    if (!this.s.active) return false;
    if (this.s.index >= this.s.total - 1) {
      this.s.playing = false;
      this.emit();
      return false;
    }
    this.s.index++;
    if (this.s.index >= this.s.total - 1) this.s.playing = false;
    this.emit();
    return true;
  }

  /** 后退一根（最少停在第 0 根）。已经在第 0 根时返回 false。 */
  stepBack(): boolean {
    if (!this.s.active || this.s.index <= 0) return false;
    this.s.index--;
    this.acc = 0;
    this.emit();
    return true;
  }

  seek(index: number): boolean {
    if (!this.s.active) return false;
    this.s.index = this.clampIndex(index);
    if (this.s.index >= this.s.total - 1) this.s.playing = false;
    this.acc = 0;
    this.emit();
    return true;
  }

  /** 开始自动播放。没在回放、或已经在最后一根时返回 false。 */
  play(): boolean {
    if (!this.s.active || this.s.index >= this.s.total - 1) return false;
    this.s.playing = true;
    this.acc = 0;
    this.emit();
    return true;
  }

  pause(): void {
    if (!this.s.active || !this.s.playing) return;
    this.s.playing = false;
    this.acc = 0;
    this.emit();
  }

  togglePlay(): boolean {
    if (this.s.playing) {
      this.pause();
      return true;
    }
    return this.play();
  }

  setSpeed(speed: number): void {
    if (!(REPLAY_SPEEDS as readonly number[]).includes(speed)) {
      throw new Error(`回放速度必须是 ${REPLAY_SPEEDS.join(' / ')} 之一（每秒几根），收到 ${speed}`);
    }
    this.s.speed = speed as ReplaySpeed;
    this.acc = 0;
    this.emit();
  }

  /**
   * 由外部定时器驱动：过去了 elapsedMs 毫秒。播放中才会前进；返回这次前进了几根。
   * 不足一根的零头会攒着，所以每 100ms 调一次和每 1000ms 调一次结果相同。
   */
  tick(elapsedMs: number): number {
    if (!this.s.active || !this.s.playing || !(elapsedMs > 0)) return 0;
    this.acc += elapsedMs;
    const per = 1000 / this.s.speed;
    const want = Math.floor(this.acc / per + 1e-9);
    if (want <= 0) return 0;
    this.acc -= want * per;
    const room = this.s.total - 1 - this.s.index;
    const steps = Math.min(want, room);
    this.s.index += steps;
    if (this.s.index >= this.s.total - 1) {
      this.s.playing = false;
      this.acc = 0;
    }
    this.emit();
    return steps;
  }

  /** 图上应该显示前几根；没在回放返回 null（= 显示全部） */
  visibleCount(): number | null {
    return this.s.active ? this.s.index + 1 : null;
  }

  private clampIndex(i: number): number {
    const n = Math.round(Number.isFinite(i) ? i : 0);
    return Math.min(this.s.total - 1, Math.max(0, n));
  }
}

/* ===========================================================================
 * 自检（纯计算）：手算期望值
 * ========================================================================= */

export interface ReplayTestResult {
  pass: number;
  fail: number;
  names: string[];
}

export function replaySelfTest(): ReplayTestResult {
  let pass = 0;
  let fail = 0;
  const names: string[] = [];
  const t = (name: string, ok: boolean, extra = ''): void => {
    names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
    if (ok) pass++;
    else fail++;
    log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
  };
  const throws = (fn: () => unknown): boolean => {
    try {
      fn();
      return false;
    } catch (e) {
      return true;
    }
  };

  // --- 启停 ---
  const c = new ReplayController(100);
  t('初始：未启动，visibleCount 为 null', !c.state().active && c.visibleCount() === null && c.state().index === -1);
  t('没启动时 step / play / seek 都不生效', !c.stepForward() && !c.stepBack() && !c.play() && !c.seek(5));
  t('start(40) → 激活、暂停、显示 41 根', c.start(40) && c.state().active && !c.state().playing && c.visibleCount() === 41);
  t('start 的下标会夹到 [0, total-1]', (() => {
    const d = new ReplayController(10);
    d.start(999);
    const hi = d.state().index;
    d.start(-5);
    return hi === 9 && d.state().index === 0;
  })());
  t('数据为空时 start 返回 false 且不激活', (() => {
    const d = new ReplayController(0);
    return !d.start(0) && !d.state().active;
  })());

  // --- 步进 ---
  c.start(40);
  c.stepForward();
  t('stepForward：显示 42 根', c.visibleCount() === 42);
  c.stepBack();
  c.stepBack();
  t('stepBack ×2：显示 40 根', c.visibleCount() === 40);
  c.seek(0);
  t('在第 0 根 stepBack 返回 false 且不变', !c.stepBack() && c.state().index === 0);
  c.seek(99);
  t('在最后一根 stepForward 返回 false 且不变', !c.stepForward() && c.state().index === 99);
  t('seek 到最后一根时自动暂停', (() => {
    const d = new ReplayController(10);
    d.start(0);
    d.play();
    d.seek(9);
    return !d.state().playing;
  })());

  // --- 播放 / 速度 / tick ---
  const p = new ReplayController(100);
  p.start(10);
  p.setSpeed(5);
  t('未播放时 tick 不前进', p.tick(5000) === 0 && p.state().index === 10);
  t('play()：进入播放', p.play() && p.state().playing);
  t('5 根/秒：tick(1000) 前进 5 根（10 → 15）', p.tick(1000) === 5 && p.state().index === 15, String(p.state().index));
  t('零头会攒着：tick(100) ×10 与 tick(1000) 等价（15 → 20）', (() => {
    let n = 0;
    for (let i = 0; i < 10; i++) n += p.tick(100);
    return n === 5 && p.state().index === 20;
  })(), String(p.state().index));
  t('不足一根时不前进（200ms 刚好 1 根，150ms 不够）', (() => {
    const d = new ReplayController(50);
    d.start(0);
    d.setSpeed(5);
    d.play();
    return d.tick(150) === 0 && d.tick(50) === 1 && d.state().index === 1;
  })());
  p.setSpeed(30);
  t('换速度后按新速度走：30 根/秒 tick(1000) 前进 30 根', p.tick(1000) === 30 && p.state().index === 50, String(p.state().index));
  p.pause();
  t('pause 之后 tick 不前进', !p.state().playing && p.tick(5000) === 0 && p.state().index === 50);
  t('togglePlay 在暂停时开始播放、播放时暂停', p.togglePlay() && p.state().playing && p.togglePlay() && !p.state().playing);
  t('非法速度抛错，不悄悄用默认值', throws(() => p.setSpeed(7)) && throws(() => p.setSpeed(0)) && throws(() => p.setSpeed(NaN)));
  t('合法速度都能设置', REPLAY_SPEEDS.every((s) => {
    p.setSpeed(s);
    return p.state().speed === s;
  }));

  // --- 到头自动停 ---
  const e = new ReplayController(20);
  e.start(15);
  e.setSpeed(10);
  e.play();
  const moved = e.tick(10000);
  t('播放到头：只前进到最后一根（15 → 19，不越界）并自动暂停',
    moved === 4 && e.state().index === 19 && !e.state().playing, `moved=${moved} idx=${e.state().index}`);
  t('已在最后一根时 play() 返回 false（不悄悄从头再来）', !e.play() && !e.state().playing);
  t('到头后 tick 不再前进', e.tick(5000) === 0);

  // --- 退出 / 重置 ---
  e.stop();
  t('stop：退出回放，visibleCount 回到 null', !e.state().active && e.visibleCount() === null && e.state().index === -1);
  t('重复 stop 不报错也不重复通知', (() => {
    const d = new ReplayController(5);
    let n = 0;
    d.subscribe(() => n++);
    d.stop();
    d.stop();
    return n === 0;
  })());
  t('reset(新总数)：回放作废、总数更新（换标的 / 周期时用）', (() => {
    const d = new ReplayController(100);
    d.start(50);
    d.play();
    d.reset(30);
    return !d.state().active && !d.state().playing && d.state().total === 30;
  })());

  // --- 通知 ---
  t('状态变化会通知订阅者，取消订阅后不再通知', (() => {
    const d = new ReplayController(10);
    let n = 0;
    const off = d.subscribe(() => n++);
    d.start(0);
    d.stepForward();
    const before = n;
    off();
    d.stepForward();
    return before === 2 && n === before;
  })());

  log('回放自检：' + pass + ' PASS / ' + fail + ' FAIL');
  return { pass, fail, names };
}
