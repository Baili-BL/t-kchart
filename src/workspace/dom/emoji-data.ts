/**
 * emoji 面板数据 —— 不再手抄，直接吃参考库的抽取结果。
 *
 * `emoji-source.json` 由 `scripts/sync-tv-emoji.mjs` 生成，做法是把本机
 * charting_library 的 webpack 模块 173 **在 vm 里跑起来**，读它导出的
 * `emojiGroups`（分组与字符）和 `removeUnavailableEmoji`（白名单语义），
 * 再用真语言包（zh.4782 / en.4782）解出分类名。所以这里看到的字符、
 * 组序、组名都是官方运行时的真值，不是抄录，也没有第二份副本会漂。
 *
 * 参考库升级后：`npm run sync:emoji` 重新生成；`npm run check:emoji` 只校对。
 * 出处（版本 / chunk / sha256）在 EMOJI_SOURCE 里，出问题先看它。
 */
import source from './emoji-source.json';
import { EMOJI_CLOCK_ICON, EMOJI_ICONS } from './emoji-icons';

export { EMOJI_CLOCK_ICON };

export interface EmojiCategory {
  /** 分类 id（tab key，本项目内部标识） */
  key: string;
  /** 分类标题（官方 zh 文案） */
  label: string;
  /** 官方英文名（对齐核对用，不参与渲染） */
  labelEn: string;
  /** tab 图标（手绘 SVG，线性风格对齐设计稿） */
  icon: string;
  /** emoji 列表（官方顺序，未重排） */
  items: readonly string[];
}

/** 抽取出处：参考库版本、来源 chunk、文件 sha256、语言包 —— 排查与核对用 */
export const EMOJI_SOURCE = source.source;

/**
 * 官方分组 key（语言包模块 id）→ 本项目 tab id。
 *
 * 用 id 对应而不是数组下标：参考库若调整分组顺序，图标与 id 不会串。
 * 若官方改了这些 key，这里会退回 `g<id>`，`tests/emojiData.test.ts` 先红。
 */
const GROUP_KEYS: Record<string, string> = {
  '96330': 'smile',
  '60558': 'animal',
  '35305': 'food',
  '14232': 'sport',
  '15395': 'travel',
  '72302': 'object',
  '6878': 'symbol',
  '49546': 'flag',
};

/** 官方第一组是「最近使用」（官方数据里为空），面板自己置顶，这里去掉 */
const GROUPS = source.groups.filter((g) => g.items.length > 0);

export const EMOJI_CATEGORIES: EmojiCategory[] = GROUPS.map((g) => {
  const key = GROUP_KEYS[String(g.localeKey)] ?? `g${g.localeKey}`;
  return { key, label: g.label, labelEn: g.labelEn, icon: EMOJI_ICONS[key] ?? '', items: g.items };
});

/** 全部字符（官方 8 组并集，1720 个） */
export const EMOJI_ALL: readonly string[] = EMOJI_CATEGORIES.flatMap((c) => c.items);

/** 官方 `k = new Set([...8组])` 的等价物 */
const EMOJI_SET = new Set(EMOJI_ALL);

/** 官方 `removeUnavailableEmoji(e) = e.filter(k.has)` 的等价物 */
export function isKnownEmoji(char: string): boolean {
  return EMOJI_SET.has(char);
}

/** 仅保留官方集内的字符 —— 外部来源（历史记录 / 模板 / 注入）落笔前过一遍 */
export function filterKnownEmoji(list: readonly string[]): string[] {
  return list.filter((c) => EMOJI_SET.has(c));
}

/** 最近使用条目数上限（面板一行 9 列 × 2 行） */
export const EMOJI_RECENTS_MAX = 18;

const RECENTS_KEY = 'kc-emoji-recents';

export function loadEmojiRecents(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]') as string[];
    return Array.isArray(arr)
      ? filterKnownEmoji(arr.filter((c) => typeof c === 'string')).slice(0, EMOJI_RECENTS_MAX)
      : [];
  } catch (_e) {
    return [];
  }
}

/** 记录一次使用：去重后前插，超出上限裁剪 */
export function saveEmojiRecent(char: string): string[] {
  const list = loadEmojiRecents().filter((c) => c !== char);
  list.unshift(char);
  const next = list.slice(0, EMOJI_RECENTS_MAX);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch (_e) { /* 忽略 */ }
  return next;
}
