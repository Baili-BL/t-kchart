import type { LayoutDef } from '../engine/layouts';
import { LAYOUT_ICONS } from './layoutIcons';

/**
 * 布局缩略图。
 * 优先用设计稿原图标（`layoutIcons.ts`，键 = 布局 id，纯静态字符串）；
 * 目录里新增了布局而还没有原图标时，退回按几何画的描边框，保证菜单里永远有图。
 */
export function LayoutIcon({ def }: { def: LayoutDef }): JSX.Element {
  const icon = LAYOUT_ICONS[def.id];
  if (icon) {
    return (
      <svg
        width={icon.w}
        height={icon.h}
        viewBox={icon.viewBox}
        fill={icon.noFill ? 'none' : undefined}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ display: 'block' }}
        // 内容是仓库内的静态常量，不含任何外部输入
        dangerouslySetInnerHTML={{ __html: icon.body }}
      />
    );
  }
  const width = 21;
  const height = 19;
  const pad = 1;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const g = 0.5;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      {def.cells.map((c, i) => (
        <rect
          key={i}
          x={pad + c[0] * w + g}
          y={pad + c[1] * h + g}
          width={(c[2] - c[0]) * w - g * 2}
          height={(c[3] - c[1]) * h - g * 2}
          rx={1.2}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
