import { create } from 'zustand';
import type { StudyDef } from '../engine/studies';
import { findIndicator, indicatorById, makeStudyDef } from '../indicators';

const FAV_KEY = 'kc.indicator.favorites';

function loadFavorites(): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(FAV_KEY) : null;
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && indicatorById(x)) : [];
  } catch (_e) {
    return [];
  }
}

function saveFavorites(list: string[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FAV_KEY, JSON.stringify(list));
  } catch (_e) { /* 存不下就算了：收藏只是便利功能 */ }
}

export interface StudyResult {
  ok: boolean;
  message: string;
}

interface StudyState {
  /** 图上的指标（所有格共用同一组定义，各自在自己的数据上运行） */
  studies: StudyDef[];
  favorites: string[];
  dialogOpen: boolean;
  /** 正在改参数的指标 uid */
  editingUid: string | null;
  /** 左栏「锁定指标」：锁住后改参数 / 删指标都要先解锁 */
  locked: boolean;

  openDialog: () => void;
  closeDialog: () => void;
  /** 进参数编辑；被锁时返回 false */
  edit: (uid: string | null) => boolean;
  /** 按清单 id 加一个指标；不可用 / 不存在返回 ok=false 并说明原因 */
  addIndicator: (id: string, inputs?: { [k: string]: any }) => StudyResult;
  /** 按 uid 删除；返回是否删到了 */
  removeStudy: (uid: string) => boolean;
  /** 按名称 / id / 关键词删除图上所有同类指标，返回删除个数 */
  removeByQuery: (q: string) => number;
  setInputs: (uid: string, inputs: { [k: string]: any }) => void;
  clearStudies: () => void;
  /** 左栏「隐藏指标」：全部不画（仍照常计算，图例保留） */
  setAllHidden: (on: boolean) => void;
  /** 左栏「锁定指标」：锁住参数编辑与删除 */
  setLocked: (on: boolean) => void;
  toggleFavorite: (id: string) => void;
}

export const useStudyStore = create<StudyState>((set, get) => ({
  studies: [],
  favorites: loadFavorites(),
  dialogOpen: false,
  editingUid: null,
  locked: false,

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  edit: (editingUid) => {
    // 被锁时连「取消编辑」（uid=null）都放行，不然会卡在编辑态出不来
    if (editingUid && get().locked) return false;
    set({ editingUid });
    return true;
  },

  addIndicator: (id, inputs = {}) => {
    const def = indicatorById(id);
    if (!def) return { ok: false, message: `没有这个指标：${id}` };
    if (!def.source) return { ok: false, message: `「${def.name}」暂不可用：${def.unsupported ?? '没有脚本'}` };
    const study = makeStudyDef(def, inputs);
    set((s) => ({ studies: [...s.studies, study] }));
    return { ok: true, message: `已添加指标「${def.name}」` };
  },

  removeStudy: (uid) => {
    if (get().locked) return false;
    const had = get().studies.some((s) => s.uid === uid);
    if (had) set((s) => ({ studies: s.studies.filter((x) => x.uid !== uid), editingUid: s.editingUid === uid ? null : s.editingUid }));
    return had;
  },

  removeByQuery: (q) => {
    const hit = findIndicator(q);
    if (!hit) return 0;
    const n = get().studies.filter((s) => s.indicatorId === hit.id).length;
    if (n) set((s) => ({ studies: s.studies.filter((x) => x.indicatorId !== hit.id) }));
    return n;
  },

  setInputs: (uid, inputs) => {
    if (get().locked) return;
    set((s) => ({ studies: s.studies.map((x) => (x.uid === uid ? { ...x, inputs: { ...inputs } } : x)) }));
  },

  clearStudies: () => set({ studies: [], editingUid: null }),

  setAllHidden: (on) => set((s) => ({
    studies: s.studies.map((d) => (d.hidden === !!on ? d : { ...d, hidden: !!on })),
  })),

  setLocked: (on) => set({ locked: !!on, editingUid: on ? null : get().editingUid }),

  toggleFavorite: (id) => {
    const cur = get().favorites;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    saveFavorites(next);
    set({ favorites: next });
  },
}));
