/**
 * 「表情」面板的尺寸 —— 官方 cn.tradingview.com 面板 DOM 快照实测值。
 *
 * 为什么单列一个文件：这些数字同时被 CSS 和测试用。写死在 CSS 里就只能靠肉眼看
 * 截图，测试没法钉；导出成常量后，`tests/emojiPanel.test.ts` 直接对着
 * `tests/fixtures/emoji-panel.json` 里的快照值比对。
 *
 * 官方真实结构（快照里是绝对定位的一行行）：
 *   面板宽 349 / 白底 / 字色 rgb(15,15,15)
 *   行高 38，每行 9 格 —— 9×38=342 > 337（349−6−6），所以官方每格被压到 37.44
 *   图标 24×24（twemoji png，decoding=async、draggable=false、alt 空）
 *   分组标题：高 30、11px、字距 .4px、左缩进 18px、上内边距 6px、灰 rgb(128,128,128)、大写
 */
export const EMOJI_PANEL = {
  width: 349,
  columns: 9,
  rowHeight: 38,
  icon: 24,
  paddingInline: 6,
  background: 'rgb(255, 255, 255)',
  color: 'rgb(15, 15, 15)',
  fontFamily: '-apple-system, "system-ui", "Trebuchet MS", Roboto, Ubuntu, sans-serif',
  header: {
    height: 30,
    fontSize: 11,
    letterSpacing: 0.4,
    paddingInlineStart: 18,
    paddingBlockStart: 6,
    color: 'rgb(128, 128, 128)',
    textTransform: 'uppercase' as const,
  },
} as const;
