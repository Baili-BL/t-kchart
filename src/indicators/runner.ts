import { makeBars } from '../engine/chart';
import type { Bar } from '../engine/chart';
import { PineEngine } from '../engine/pine';
import { registerStudyRunner } from '../engine/studies';
import type { StudyDef, StudyFillRef, StudyInputDef, StudyOutput } from '../engine/studies';

/**
 * 跑一个指标脚本（Pine v6），把引擎的输出整理成图表能直接画的 StudyOutput。
 * 出错（语法 / 不支持的写法 / 运行时）一律抛出，由 KChart 捕获成「指标出错」显示在图例里。
 */
export function runStudy(def: StudyDef, bars: Bar[], meta: { symbol: string; timeframe: string }): StudyOutput {
  const eng = new PineEngine(def.source, bars, { inputs: def.inputs, symbol: meta.symbol, timeframe: meta.timeframe });
  if (eng.kind !== 'indicator') throw new Error('只能把 indicator(...) 脚本加成指标（这是 ' + eng.kind + '）');
  eng.run();
  const n = bars.length;
  const fixLen = <T>(arr: (T | null | undefined)[]): (T | null)[] => {
    const out: (T | null)[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = arr[i] === undefined ? null : (arr[i] as T | null);
    return out;
  };
  const plots = eng.plots.map((p: any) => ({
    title: p.title as string,
    color: p.color as string,
    width: p.width as number,
    style: p.style as string,
    values: fixLen<number>(p.values),
    colors: fixLen<string>(p.colors),
    hidden: !!p.hidden,
  }));
  const refOf = (h: any): StudyFillRef => {
    const idx = eng.plots.indexOf(h);
    if (idx >= 0) return { kind: 'plot', index: idx };
    return { kind: 'hline', price: Number(h.price) };
  };
  const inputDefs: StudyInputDef[] = Object.keys(eng.inputDefs).map((k) => eng.inputDefs[k]);
  const inputs: { [k: string]: any } = {};
  for (const d of inputDefs) inputs[d.title] = d.title in def.inputs ? def.inputs[d.title] : d.def;
  return {
    title: eng.title,
    overlay: eng.overlay,
    plots,
    hlines: eng.hlines.map((h: any) => ({ price: h.price, title: h.title, color: h.color, linestyle: h.linestyle })),
    fills: eng.fills.map((f: any) => ({ a: refOf(f.a), b: refOf(f.b), colors: fixLen<string>(f.colors) })),
    inputDefs,
    inputs,
  };
}

/** 取一个脚本的参数声明（标题 / 类型 / 默认值 / 范围）：在一小段合成行情上空跑一遍 */
const inputCache = new Map<string, StudyInputDef[]>();
export function inputDefsOf(source: string): StudyInputDef[] {
  const hit = inputCache.get(source);
  if (hit) return hit;
  const eng = new PineEngine(source, makeBars(120, 7, 100));
  eng.run();
  const defs = Object.keys(eng.inputDefs).map((k) => eng.inputDefs[k]);
  inputCache.set(source, defs);
  return defs;
}

registerStudyRunner(runStudy);
