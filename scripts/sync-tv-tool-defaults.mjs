#!/usr/bin/env node
/**
 * 把 charting_library 里「每种线工具的默认属性表」抽成本仓库的数据文件。
 *
 * 官方这张表在 webpack 模块 64548（`library.*.js`）里，形如：
 *
 *   const {getHexColorByName:r} = i(7394), {generateColor:n} = i(38031);
 *   L = r("color-tv-blue-500"), K = r("color-ripe-red-500"), …
 *   TradingView.defaultProperties = { linetoolrectangle: { color: te, … }, … }
 *
 * 手抄容易抄错（颜色全是单字母变量，且 generateColor 会转成 rgba），
 * 所以这里照 emoji 脚本的做法：**在源码上做一次可复现的求值**——
 * 先把模块头的变量赋值解析成 变量 → 颜色，再把 linetoolXXX 块里的
 * 标量属性解析成最终值，写进 tv-tool-defaults.json。渲染端只读这份快照。
 *
 *   用法：
 *     node scripts/sync-tv-tool-defaults.mjs            # 重新生成
 *     node scripts/sync-tv-tool-defaults.mjs --check    # 只校对，不一致退出码 1
 *     CHARTING_LIBRARY_DIR=/path/to/charting_library node scripts/sync-tv-tool-defaults.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(REPO, 'src/engine/tv-tool-defaults.json');
const CHECK = process.argv.includes('--check');

/* ------------------------------------------------ 1. 找到参考库 */
function findLibrary() {
  const roots = [process.env.CHARTING_LIBRARY_DIR, '/Users/kevin/Desktop/charting_library'].filter(Boolean);
  for (const root of roots) {
    for (const sub of ['charting_library/bundles', 'bundles']) {
      const bundles = path.join(root, sub);
      if (fs.existsSync(bundles)) return { root, bundles };
    }
  }
  return null;
}

const lib = findLibrary();
if (!lib) {
  if (CHECK) {
    console.log('跳过：没找到本机 charting_library（--check 视为通过）');
    process.exit(0);
  }
  console.error('找不到 charting_library：请设置 CHARTING_LIBRARY_DIR');
  process.exit(1);
}

/* 候选 bundle 必须排序，否则 readdir 顺序不定会让 --check 假红 */
const candidates = fs.readdirSync(lib.bundles)
  .filter((f) => /^library\..*\.js$/.test(f))
  .sort();
let file = null;
let src = '';
for (const f of candidates) {
  const s = fs.readFileSync(path.join(lib.bundles, f), 'utf8');
  if (s.includes('linetoolbrush:{')) { file = f; src = s; break; }
}
if (!file) {
  console.error('bundle 里没有找到 linetoolbrush —— 参考库版本不对？');
  process.exit(1);
}

/* ------------------------------------------------ 2. 调色板 */
const palette = {};
for (const m of src.matchAll(/"([\w-]+)":"(#[0-9a-fA-F]{6}|rgba?\([^"]*\))"/g)) {
  if (!(m[1] in palette)) palette[m[1]] = m[2];
}

/* ------------------------------------------------ 3. 定位模块 */
const anchor = src.indexOf('linetoolbrush:{');
const modStartRe = /(\d+):\(e,t,i\)=>\{/g;
let modId = null;
let modStart = 0;
for (const m of src.matchAll(modStartRe)) {
  if (m.index > anchor) break;
  modId = Number(m[1]);
  modStart = m.index;
}
const nextMod = new RegExp(',(\\d+):\\(e,t,i\\)=>\\{', 'g');
nextMod.lastIndex = modStart + 10;
const nm = nextMod.exec(src);
const modEnd = nm ? nm.index : src.length;
const mod = src.slice(modStart, modEnd);

/* ------------------------------------------------ 4. 变量 → 颜色 */
/** generateColor(hex|name, pct) 的语义：alpha = (100 - pct) / 100 */
function generateColor(base, pct) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(base);
  if (!m) return base;
  const n = parseInt(m[1], 16);
  const a = Math.round((100 - pct)) / 100;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const vars = new Map();
const resolveColor = (token) => {
  token = token.trim();
  const inline = /^n\((\w+),(\d+)\)$/.exec(token);
  if (inline) {
    const base = vars.get(inline[1]);
    return base ? generateColor(base, Number(inline[2])) : null;
  }
  const lit = /^"([^"]+)"$/.exec(token);
  if (lit) return lit[1];
  return vars.get(token) ?? null;
};

// 两遍：先取 r("color-xxx")，再取 n(X, pct)（可能依赖上一遍的变量）
for (let pass = 0; pass < 3; pass++) {
  for (const m of mod.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)=(r|n)\(([^()]*)\)/g)) {
    const [, name, fn, args] = m;
    if (fn === 'r') {
      const lit = /^\s*"([^"]+)"\s*$/.exec(args);
      if (lit) {
        const hex = palette[lit[1]] || lit[1];
        vars.set(name, hex);
      }
    } else {
      const parts = args.split(',').map((s) => s.trim());
      if (parts.length === 2) {
        const base = vars.get(parts[0]);
        if (base) vars.set(name, generateColor(base, Number(parts[1])));
      }
    }
  }
}

/* ------------------------------------------------ 5. 逐块解析 linetoolXXX */
function body(text, openIdx) {
  let depth = 0;
  let q = null;
  let esc = false;
  for (let j = openIdx; j < text.length; j++) {
    const ch = text[j];
    if (q) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(openIdx, j + 1);
    }
  }
  return text.slice(openIdx, openIdx + 600);
}

const LINESTYLE = { w: 'solid', C: 'dashed', P: 'dotted' };

/**
 * 官方属性表的键名并不统一：线色有 color / linecolor / lineColor 三种写法，
 * 填充色叫 backgroundColor，字号有 fontsize / fontSize 两种。这里统一归一。
 */
const ALIAS = {
  color: ['color', 'linecolor', 'lineColor', 'plateColor'],
  fill: ['backgroundColor'],
  width: ['linewidth', 'lineWidth'],
  dash: ['linestyle', 'lineStyle'],
  fontSize: ['fontsize', 'fontSize'],
  transparency: ['transparency'],
  backgroundTransparency: ['backgroundTransparency'],
  fillBackground: ['fillBackground'],
  smooth: ['smooth'],
};

/** 顶层标量属性（跳过嵌套对象 / 数组） */
function scalars(block) {
  const out = {};
  let depth = 0;
  let q = null;
  let esc = false;
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (q) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '{' || ch === '[') { depth++; continue; }
    if (ch === '}' || ch === ']') { depth--; continue; }
    if (depth !== 1) continue;
    if (ch !== ':' && !(ch === ',' || ch === '{')) continue;
    // 取 key
    const tail = block.slice(0, i);
    const km = /([A-Za-z_$][\w$]*)\s*$/.exec(tail);
    if (!km) continue;
    // 取 value（到下一个顶层逗号/右括号为止）
    const rest = block.slice(i + 1);
    let d2 = 0;
    let v = '';
    let qq = null;
    let ee = false;
    for (const c of rest) {
      if (qq) {
        v += c;
        if (ee) ee = false;
        else if (c === '\\') ee = true;
        else if (c === qq) qq = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { qq = c; v += c; continue; }
      if (c === '(' || c === '[' || c === '{') d2++;
      if (c === ')' || c === ']' || c === '}') {
        if (d2 === 0) break;
        d2--;
      }
      if (c === ',' && d2 === 0) break;
      v += c;
    }
    out[km[1]] = v.trim();
  }
  return out;
}

const tools = {};
for (const m of mod.matchAll(/linetool([a-z0-9]+):\{/g)) {
  const name = m[1];
  const b = body(mod, m.index + m[0].length - 1);
  const raw = scalars(b);
  const pick = (field) => {
    for (const k of ALIAS[field]) if (raw[k] !== undefined) return raw[k];
    return undefined;
  };

  const entry = {};
  const colorTok = pick('color');
  const color = colorTok ? resolveColor(colorTok) : null;
  if (color) entry.color = color;

  const fillTok = pick('fill');
  const fill = fillTok ? resolveColor(fillTok) : null;
  if (fill) entry.fillColor = fill;

  const w = pick('width');
  if (w !== undefined && /^[0-9.]+$/.test(w)) entry.linewidth = Number(w);

  const d = pick('dash');
  if (d !== undefined) {
    const ls = resolveColor(d) || d;
    entry.linestyle = LINESTYLE[ls] || 'solid';
  }

  for (const [field, key] of [['transparency', 'transparency'], ['backgroundTransparency', 'backgroundTransparency']]) {
    const v = pick(field);
    if (v !== undefined && /^!?[0-9.]+$/.test(v)) entry[key] = Number(v.replace('!', ''));
  }

  const fb = pick('fillBackground');
  if (fb !== undefined) entry.fillBackground = fb === '!0';

  const sm = pick('smooth');
  if (sm !== undefined && /^[0-9.]+$/.test(sm)) entry.smooth = Number(sm);

  const fs = pick('fontSize');
  if (fs !== undefined && /^[0-9.]+$/.test(fs)) entry.fontSize = Number(fs);

  // 音叉/江恩这类工具的主色挂在嵌套的 median 上
  const med = /(?:^|[,{])median:\{([^{}]*)\}/.exec(b);
  if (med && !entry.color) {
    const mc = /(?:^|,)\s*color:([A-Za-z_$][\w$]*)/.exec(med[1]);
    const resolved = mc ? resolveColor(mc[1]) : null;
    if (resolved) entry.medianColor = resolved;
  }
  // 斐波那契/江恩的另一类：颜色逐 level 给，没有单一主色
  if (/levels:\[/.test(b) || /level0:/.test(b) || /level1:/.test(b)) entry.levels = true;

  // 兜底：没有任何顶层颜色时，取块里第一个 color（fib 的 trendline、回归的 styles.upLine）
  if (!entry.color && !entry.medianColor) {
    const first = /(?:^|[,{])\s*(?:line)?[cC]olor:((?:"(?:[^"\\]|\\.)*")|[A-Za-z_$][\w$]*)/.exec(b);
    const resolved = first ? resolveColor(first[1]) : null;
    if (resolved) entry.nestedColor = resolved;
  }

  // 同名工具会出现多次（官方在不同默认集里重复声明）：以第一份为准，
  // 后面出现的只用来填第一份缺的字段（例如某些默认集不写颜色）
  const prev = tools[name];
  if (!prev) tools[name] = entry;
  else for (const [k, v] of Object.entries(entry)) if (prev[k] === undefined) prev[k] = v;
}

if (process.env.DEBUG_TOOL) {
  console.log('DEBUG', process.env.DEBUG_TOOL, JSON.stringify(tools[process.env.DEBUG_TOOL]));
}

/* ------------------------------------------------ 6. 就地断言 */
const problems = [];
if (Object.keys(tools).length < 80) problems.push(`工具数量异常：${Object.keys(tools).length} < 80`);
for (const must of ['trendline', 'rectangle', 'circle', 'ellipse', 'triangle', 'fibretracement', 'brush', 'highlighter', 'text']) {
  if (!tools[must]) problems.push(`缺少官方工具 ${must}`);
}
// 少数工具（order/position/execution/image/flagmark）本身没有线色属性
const NO_COLOR = new Set([
  'order', 'position', 'execution', 'image', 'flagmark', 'icon', 'emoji',
  // 文字类：颜色由字体/背景决定，没有线色
  'note', 'noteabsolute', 'arrowmarker', 'ghostfeed',
]);
for (const [k, v] of Object.entries(tools)) {
  if (!v.color && !v.medianColor && !v.nestedColor && !v.levels && !NO_COLOR.has(k)) problems.push(`${k} 没有解析出颜色`);
  if (v.color && /^[A-Za-z_$]{1,2}$/.test(v.color)) problems.push(`${k} 颜色变量未解析：${v.color}`);
}
if (problems.length) {
  console.error('抽取结果自检失败：\n  ' + problems.join('\n  '));
  process.exit(1);
}

const payload = {
  source: {
    library: `charting_library/bundles/${file}`,
    module: modId,
    note: 'linetoolXXX 默认属性（color 已按 generateColor 解析成 rgba）',
  },
  tools,
};
const text = JSON.stringify(payload, null, 2) + '\n';

if (CHECK) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (old !== text) {
    console.error('tv-tool-defaults.json 与参考库不一致：请运行 node scripts/sync-tv-tool-defaults.mjs');
    process.exit(1);
  }
  console.log(`一致：${Object.keys(tools).length} 个线工具的默认属性`);
  process.exit(0);
}

fs.writeFileSync(OUT, text);
console.log(`写出 ${path.relative(REPO, OUT)}：${Object.keys(tools).length} 个线工具（模块 ${modId}，${file}）`);
