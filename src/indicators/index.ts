import { INDICATORS } from './catalog';
import type { IndicatorDef, IndicatorKind } from './catalog';
import type { StudyDef } from '../engine/studies';
import './runner';

export { INDICATORS } from './catalog';
export type { IndicatorDef, IndicatorKind } from './catalog';
export { inputDefsOf, runStudy } from './runner';

/** 按名字排序（忽略大小写；数字开头排最前），清单就是按这个顺序显示的 */
export const SORTED_INDICATORS: IndicatorDef[] = INDICATORS.slice().sort((a, b) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'));

export function indicatorById(id: string): IndicatorDef | null {
  return INDICATORS.find((d) => d.id === id) ?? null;
}

const norm = (s: string): string => s.toLowerCase().replace(/[\s_\-/()%]+/g, '');

/** 按 id / 全名 / 短名 / 中文关键词模糊找一个指标（Agent 用） */
export function findIndicator(q: string): IndicatorDef | null {
  const k = norm(q);
  if (!k) return null;
  const exact = INDICATORS.find((d) => d.id === q || norm(d.name) === k || norm(d.short) === k || d.keywords.some((w) => norm(w) === k));
  if (exact) return exact;
  return INDICATORS.find((d) => norm(d.name).includes(k) || norm(d.short).includes(k) || d.keywords.some((w) => norm(w).includes(k))) ?? null;
}

/** 搜索：空串 = 全部；否则名称 / 短名 / 关键词 / id 任一包含（忽略大小写与空白） */
export function searchIndicators(q: string, list: IndicatorDef[] = SORTED_INDICATORS): IndicatorDef[] {
  const k = norm(q);
  if (!k) return list;
  return list.filter((d) =>
    norm(d.name).includes(k) || norm(d.short).includes(k) || norm(d.id).includes(k) || d.keywords.some((w) => norm(w).includes(k)));
}

let seq = 0;
/** 由内置指标造一个图上的实例定义（uid 唯一；inputs 为空 = 全用脚本默认值） */
export function makeStudyDef(def: IndicatorDef, inputs: { [k: string]: any } = {}): StudyDef {
  if (!def.source) throw new Error('「' + def.name + '」不可用：' + (def.unsupported || '没有脚本'));
  seq++;
  return { uid: def.id + '#' + seq + '-' + Date.now().toString(36), indicatorId: def.id, name: def.name, short: def.short, source: def.source, inputs };
}
