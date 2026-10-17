/**
 * emoji 面板的 tab 图标（手绘 SVG，线性风格对齐设计稿）。
 *
 * 官方 charting_library 用的是另一套贴图图标，这里只借「分组与字符」，
 * 图标保持本项目自己的线性风格；按分组语义 key 对应，不放位置索引，
 * 这样参考库调整分组顺序也不会错位。
 */

/** 最左侧「最近使用」tab（时钟） */
export const EMOJI_CLOCK_ICON =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="14" cy="14" r="10.5"/><path d="M14 8 V14 L18 17"/></svg>';

const I_SMILE =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="14" cy="14" r="10.5"/><path d="M9.5 16.5 C10.8 19 17.2 19 18.5 16.5"/><circle cx="10.5" cy="11.5" r="0.6" fill="currentColor"/><circle cx="17.5" cy="11.5" r="0.6" fill="currentColor"/></svg>';
const I_ANIMAL =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5 C5 7 4 11 5.5 14 C4 16 4 19 6 21 C8 23 12 23.5 14 22 C16 23.5 20 23 22 21 C24 19 24 16 22.5 14 C24 11 23 7 20 5 C17 3 11 3 8 5 Z"/><circle cx="11" cy="13" r="0.7" fill="currentColor"/><circle cx="17" cy="13" r="0.7" fill="currentColor"/></svg>';
const I_FOOD =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16 C5 12 9 9.5 14 9.5 C19 9.5 23 12 23 16 Z"/><path d="M4 16 H24 M6.5 16 V20 H21.5 V16"/><path d="M14 9.5 C13 7.5 14.5 6.5 14 5"/></svg>';
const I_SPORT =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="14" cy="14" r="10.5"/><path d="M14 3.5 V24.5 M3.5 14 H24.5 M6.2 6.2 C10 10 10 18 6.2 21.8 M21.8 6.2 C18 10 18 18 21.8 21.8"/></svg>';
const I_TRAVEL =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3 C17 6 18 11 17 16 L11 16 C10 11 11 6 14 3 Z"/><path d="M11 12 L6 16 L8 18 L11.5 16 M17 12 L22 16 L20 18 L16.5 16 M12 18 L11 24 L14 21 L17 24 L16 18"/><circle cx="14" cy="9" r="1.2"/></svg>';
const I_OBJECT =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4 A7 7 0 0 1 18 16.5 C17 17.5 16.5 18.5 16.5 20 H11.5 C11.5 18.5 11 17.5 10 16.5 A7 7 0 0 1 14 4 Z"/><path d="M11.5 23 H16.5 M12.5 25.5 H15.5"/></svg>';
const I_SYMBOL =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M14 23 C8 18.5 4 15 4 10.5 C4 7.4 6.4 5 9.5 5 C11.5 5 13.2 6 14 7.7 C14.8 6 16.5 5 18.5 5 C21.6 5 24 7.4 24 10.5 C24 15 20 18.5 14 23 Z"/></svg>';
const I_FLAG =
  '<svg viewBox="0 0 28 28" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 25 V4 M7 5 H21 L17.5 9.5 L21 14 H7"/></svg>';

/** 语义 key → tab 图标 */
export const EMOJI_ICONS: Record<string, string> = {
  smile: I_SMILE,
  animal: I_ANIMAL,
  food: I_FOOD,
  sport: I_SPORT,
  travel: I_TRAVEL,
  object: I_OBJECT,
  symbol: I_SYMBOL,
  flag: I_FLAG,
};
