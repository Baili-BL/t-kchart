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

  openDialog: () => void;
  closeDialog: () => void;
  edit: (uid: string | null) => void;
  /** 按清单 id 加一个指标；不可用 / 不存在返回 ok=false 并说明原因 */
  addIndicator: (id: string, inputs?: { [k: string]: any }) => StudyResult;
  /** 按 uid 删除；返回是否删到了 */
  removeStudy: (uid: string) => boolean;
  /** 按名称 / id / 关键词删除图上所有同类指标，返回删除个数 */
  removeByQuery: (q: string) => number;
  setInputs: (uid: string, inputs: { [k: string]: any }) => void;
  clearStudies: () => void;
  toggleFavorite: (id: string) => void;
}

export const useStudyStore = create<StudyState>((set, get) => ({
  studies: [],
  favorites: loadFavorites(),
  dialogOpen: false,
  editingUid: null,

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
  edit: (editingUid) => set({ editingUid }),

  addIndicator: (id, inputs = {}) => {
    const def = indicatorById(id);
    if (!def) return { ok: false, message: `没有这个指标：${id}` };
    if (!def.source) return { ok: false, message: `「${def.name}」暂不可用：${def.unsupported ?? '没有脚本'}` };
    const study = makeStudyDef(def, inputs);
    set((s) => ({ studies: [...s.studies, study] }));
    return { ok: true, message: `已添加指标「${def.name}」` };
  },

  removeStudy: (uid) => {
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

  setInputs: (uid, inputs) =>
    set((s) => ({ studies: s.studies.map((x) => (x.uid === uid ? { ...x, inputs: { ...inputs } } : x)) })),

  clearStudies: () => set({ studies: [], editingUid: null }),

  toggleFavorite: (id) => {
    const cur = get().favorites;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    saveFavorites(next);
    set({ favorites: next });
  },
}));
