"use strict";
/**
 * tv-chart / pine.ts
 * ---------------------------------------------------------------------------
 * Pine Script v5 **子集** 解释器（T3 Phase 1）。
 *
 * 依赖 chart.ts（全局脚本，先加载 chart.js 再加载 pine.js）。
 * 只使用可擦除类型语法，`pine.js` 就是本文件删掉类型注解后的样子：
 *
 *     npx --yes typescript@5 tsc -p tsconfig.json
 *
 * ============================ 说在前面的丑话 ============================
 * 这是**子集**，不是 Pine 兼容实现。我不承诺、也不假装它能跑任意脚本。
 *
 * 真正难的不是语法，是**执行模型**：Pine 里每个变量都是一条时间序列，
 * 脚本对每根 bar 重跑一遍，`x[1]` 取的是上一根的值。`var` 的初值只在第 0 根
 * 执行一次。内置函数（ta.sma 之类）的状态按**调用点**隔离。
 * 这三条搞错任何一条，指标数值就会静默错掉——不报错，只是数不对。
 *
 * 参考：你自己仓库里的 `vela-h5-test/PINE-对齐清单.md` 记录的是
 * PineTS 0.11.1（专门的、活跃维护的引擎）在 strategy 仓位计算上都会静默归零。
 * 所以下面每一条实现都尽量写成「错了能看出来」，并且配了手算自检。
 *
 * 支持：
 *   //@version=5 / indicator() / strategy()(仅声明) / input.*
 *   变量：x =  /  x :=  /  var x =  /  [a,b] = f()
 *   控制：if / else / if 表达式 / for [to] [by] / while / 三元
 *   函数：f(a, b) => expr  和 多行缩进体
 *   序列：x[n]（含 `f(x)[n]` 兜底）
 *   算子：+ - * / %  == != < <= > >=  and or not  ?:  字符串 +
 *   内置：ta.* / math.* / input.* / nz / na / fixnan / str.tostring / color.*
 *         plot / plotshape / plotchar / bgcolor / hline
 *
 * 不支持（明确拒答，不静默给错值）：
 *   strategy.* 撮合交易、数组/矩阵/map、request.*、table.*、label.*、line.*、
 *   barstate.*、fill()、box.*、多返回值以外的元组、`f(x)[1]` 以外的复杂历史引用
 * ===========================================================================
 */
/* ===========================================================================
 * 1. NA 与基础类型
 * ========================================================================= */
/** Pine 的 na。用一个唯一对象而不是 NaN，才能和「真的算出了 NaN」区分开。 */
const NA = { __na: true };
function isNa(v) {
    if (v === NA || v === undefined || v === null)
        return true;
    if (typeof v === 'number')
        return !isFinite(v);
    return false;
}
/** Pine 的布尔很严：只有 true 才算真。这里放宽一点，数值 0/na 为假。 */
function truthy(v) {
    if (v === true)
        return true;
    if (v === false || v === NA || v === undefined || v === null)
        return false;
    if (typeof v === 'number')
        return v !== 0 && isFinite(v);
    if (typeof v === 'string')
        return v.length > 0;
    return !!v;
}
function toNum(v) {
    if (typeof v === 'number')
        return v;
    if (v === true)
        return 1;
    if (v === false)
        return 0;
    if (typeof v === 'string') {
        const n = parseFloat(v);
        return isFinite(n) ? n : NaN;
    }
    return NaN;
}
/** 一元/二元运算里 na 的传播规则，集中在这里，别散落各处 */
function pBin(op, a, b) {
    if (op === 'and')
        return truthy(a) && truthy(b);
    if (op === 'or')
        return truthy(a) || truthy(b);
    if (op === '+') {
        if (typeof a === 'string' || typeof b === 'string') {
            return (isNa(a) ? '' : String(a)) + (isNa(b) ? '' : String(b));
        }
    }
    if (isNa(a) || isNa(b)) {
        // 比较运算遇到 na 一律 false；算术运算传播 na
        if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=')
            return false;
        return NA;
    }
    const x = toNum(a);
    const y = toNum(b);
    switch (op) {
        case '+': return x + y;
        case '-': return x - y;
        case '*': return x * y;
        case '/': return y === 0 ? NA : x / y;
        case '%': return y === 0 ? NA : x % y;
        case '==': return x === y;
        case '!=': return x !== y;
        case '<': return x < y;
        case '<=': return x <= y;
        case '>': return x > y;
        case '>=': return x >= y;
    }
    throw new Error('未实现的运算符：' + op);
}
/* ===========================================================================
 * 2. 序列（Pine 执行模型的地基）
 * ========================================================================= */
/**
 * 一条时间序列。
 *   cur      —— 当前 bar 的值
 *   buf[i]   —— 第 i 根 bar 已经**结算**的值
 *   get(n)   —— 等价于 Pine 的 `x[n]`
 *
 * `commit()` 在每根 bar 的**末尾**调用一次（不是赋值时调），
 * 这样 bar 中途的多次赋值不会污染历史。
 */
class PSeries {
    constructor(init) {
        this.buf = [];
        this.cur = init === undefined ? NA : init;
        this.inited = false;
    }
    get(off) {
        if (off <= 0)
            return this.cur;
        const i = this.buf.length - off;
        return i >= 0 ? this.buf[i] : NA;
    }
    set(v) {
        this.cur = v;
    }
    commit() {
        this.buf.push(this.cur);
    }
}
/* ===========================================================================
 * 3. 作用域
 * ========================================================================= */
/**
 * 变量 / 函数 / 内置状态的作用域。
 *
 * 关键点：**内置函数的状态按调用点的 AST 节点记忆**（`state()`）。
 * 否则同一个 `ta.sma(close, 20)` 在两个地方调用会共享一个滚动和，
 * 数值全错而且不报错。用户函数同理：每个调用点有一个独立的 `PEnv`。
 */
class PEnv {
    constructor(parent) {
        this.parent = parent;
        this.vars = Object.create(null);
        this.funcs = Object.create(null);
        this.st = new Map();
        this.fnMemo = new Map();
    }
    lookup(name) {
        let e = this;
        while (e) {
            if (name in e.vars)
                return e.vars[name];
            e = e.parent;
        }
        return null;
    }
    lookupFunc(name) {
        let e = this;
        while (e) {
            if (name in e.funcs)
                return e.funcs[name];
            e = e.parent;
        }
        return null;
    }
    /** 声明并赋值。`isVar` 为真时只在本环境的第 0 根 bar 生效。 */
    declare(name, v, isVar) {
        let s = this.vars[name];
        if (!s) {
            s = new PSeries(NA);
            this.vars[name] = s;
        }
        if (isVar && s.inited)
            return s;
        s.set(v);
        s.inited = true;
        return s;
    }
    /** 参数绑定：每次调用都要更新当前值，但不清历史 */
    bindSeries(name, v) {
        let s = this.vars[name];
        if (!s) {
            s = new PSeries(NA);
            this.vars[name] = s;
        }
        s.set(v);
        s.inited = true;
        return s;
    }
    state(node, make) {
        let s = this.st.get(node);
        if (s === undefined) {
            s = make();
            this.st.set(node, s);
        }
        return s;
    }
    fnEnvFor(node) {
        let e = this.fnMemo.get(node);
        if (!e) {
            e = new PEnv(this);
            this.fnMemo.set(node, e);
        }
        return e;
    }
    commitAll(seen) {
        if (seen.has(this))
            return;
        seen.add(this);
        for (const k in this.vars)
            this.vars[k].commit();
        this.st.forEach((v) => {
            if (v && typeof v.commit === 'function')
                v.commit();
        });
        this.fnMemo.forEach((e) => e.commitAll(seen));
    }
}
const PINE_OPS_2 = [':=', '==', '!=', '<=', '>=', '=>'];
const PINE_OPS_1 = '+-*/%()[],?:<>=!';
function pineTokenize(src) {
    const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    const stack = [0];
    let depth = 0;
    let cont = false;
    for (let li = 0; li < lines.length; li++) {
        const noTab = lines[li].replace(/\t/g, '    ');
        const trimmed = noTab.replace(/^ +/, '');
        if (!cont && (trimmed === '' || trimmed.slice(0, 2) === '//'))
            continue;
        if (!cont) {
            const ind = noTab.length - trimmed.length;
            const top = stack[stack.length - 1];
            if (ind > top) {
                stack.push(ind);
                out.push({ t: 'INDENT', v: '', line: li + 1 });
            }
            else if (ind < top) {
                while (stack.length > 1 && stack[stack.length - 1] > ind) {
                    stack.pop();
                    out.push({ t: 'DEDENT', v: '', line: li + 1 });
                }
                if (stack[stack.length - 1] !== ind) {
                    throw new Error('第 ' + (li + 1) + ' 行缩进对不齐（' + ind + ' 个空格 vs ' + stack[stack.length - 1] + '）');
                }
            }
        }
        let i = 0;
        let lastWasOp = false;
        while (i < noTab.length) {
            const ch = noTab[i];
            if (ch === ' ') {
                i++;
                continue;
            }
            if (ch === '/' && noTab[i + 1] === '/')
                break;
            if (ch >= '0' && ch <= '9') {
                let j = i;
                while (j < noTab.length && noTab[j] >= '0' && noTab[j] <= '9')
                    j++;
                if (noTab[j] === '.') {
                    j++;
                    while (j < noTab.length && noTab[j] >= '0' && noTab[j] <= '9')
                        j++;
                }
                if (noTab[j] === 'e' || noTab[j] === 'E') {
                    let k2 = j + 1;
                    if (noTab[k2] === '+' || noTab[k2] === '-')
                        k2++;
                    if (noTab[k2] >= '0' && noTab[k2] <= '9') {
                        j = k2;
                        while (j < noTab.length && noTab[j] >= '0' && noTab[j] <= '9')
                            j++;
                    }
                }
                out.push({ t: 'NUM', v: noTab.slice(i, j), line: li + 1 });
                i = j;
                lastWasOp = false;
                continue;
            }
            if (ch === '"' || ch === "'") {
                const q = ch;
                let j = i + 1;
                let s = '';
                while (j < noTab.length && noTab[j] !== q) {
                    if (noTab[j] === '\\' && j + 1 < noTab.length) {
                        s += noTab[j + 1];
                        j += 2;
                    }
                    else {
                        s += noTab[j];
                        j++;
                    }
                }
                if (j >= noTab.length)
                    throw new Error('第 ' + (li + 1) + ' 行字符串没闭合');
                out.push({ t: 'STR', v: s, line: li + 1 });
                i = j + 1;
                lastWasOp = false;
                continue;
            }
            if (/[A-Za-z_]/.test(ch)) {
                let j = i;
                while (j < noTab.length && /[A-Za-z0-9_]/.test(noTab[j]))
                    j++;
                // 点号连缀：ta.sma / strategy.entry / color.red —— 合成一个 IDENT，省掉成员访问
                while (noTab[j] === '.' && /[A-Za-z_]/.test(noTab[j + 1] || '')) {
                    j++;
                    while (j < noTab.length && /[A-Za-z0-9_]/.test(noTab[j]))
                        j++;
                }
                out.push({ t: 'IDENT', v: noTab.slice(i, j), line: li + 1 });
                i = j;
                lastWasOp = false;
                continue;
            }
            const two = noTab.slice(i, i + 2);
            let op = null;
            if (PINE_OPS_2.indexOf(two) >= 0)
                op = two;
            else if (PINE_OPS_1.indexOf(ch) >= 0)
                op = ch;
            if (!op)
                throw new Error('第 ' + (li + 1) + ' 行有无法识别的字符：' + ch);
            if (op === '(' || op === '[')
                depth++;
            if (op === ')' || op === ']')
                depth = Math.max(0, depth - 1);
            out.push({ t: 'OP', v: op, line: li + 1 });
            i += op.length;
            // `=>` 是块的开头，不是续行
            lastWasOp = op === '=>' ? false : '+-*/%<>=!:,'.indexOf(op.charAt(op.length - 1)) >= 0;
        }
        if (depth > 0 || lastWasOp)
            cont = true;
        else {
            cont = false;
            out.push({ t: 'NEWLINE', v: '', line: li + 1 });
        }
    }
    while (stack.length > 1) {
        stack.pop();
        out.push({ t: 'DEDENT', v: '', line: lines.length });
    }
    out.push({ t: 'EOF', v: '', line: lines.length });
    return out;
}
/* ===========================================================================
 * 5. 语法
 * ========================================================================= */
function pineParse(src) {
    const toks = pineTokenize(src);
    let p = 0;
    const at = (t, v) => {
        if (toks[p].t !== t)
            return false;
        return v === undefined || toks[p].v === v;
    };
    const fail = (msg) => {
        throw new Error(msg + '（第 ' + toks[p].line + ' 行，读到 ' + toks[p].t + '「' + toks[p].v + '」）');
    };
    const eat = (t, v) => {
        if (!at(t, v))
            fail('期望 ' + t + (v ? '「' + v + '」' : ''));
        return toks[p++];
    };
    const skipNL = () => { while (at('NEWLINE'))
        p++; };
    /* ---------------------------------------------------------- 表达式 */
    const parseExpr = () => parseTernary();
    const parseTernary = () => {
        const c = parseOr();
        if (at('OP', '?')) {
            p++;
            const a = parseTernary();
            eat('OP', ':');
            const b = parseTernary();
            return { k: 'tern', c, a, b };
        }
        return c;
    };
    const parseOr = () => {
        let l = parseAnd();
        while (at('IDENT', 'or')) {
            p++;
            l = { k: 'bin', op: 'or', a: l, b: parseAnd() };
        }
        return l;
    };
    const parseAnd = () => {
        let l = parseEq();
        while (at('IDENT', 'and')) {
            p++;
            l = { k: 'bin', op: 'and', a: l, b: parseEq() };
        }
        return l;
    };
    const parseEq = () => {
        let l = parseRel();
        while (at('OP', '==') || at('OP', '!=')) {
            const op = toks[p++].v;
            l = { k: 'bin', op, a: l, b: parseRel() };
        }
        return l;
    };
    const parseRel = () => {
        let l = parseAdd();
        while (at('OP', '<') || at('OP', '<=') || at('OP', '>') || at('OP', '>=')) {
            const op = toks[p++].v;
            l = { k: 'bin', op, a: l, b: parseAdd() };
        }
        return l;
    };
    const parseAdd = () => {
        let l = parseMul();
        while (at('OP', '+') || at('OP', '-')) {
            const op = toks[p++].v;
            l = { k: 'bin', op, a: l, b: parseMul() };
        }
        return l;
    };
    const parseMul = () => {
        let l = parseUnary();
        while (at('OP', '*') || at('OP', '/') || at('OP', '%')) {
            const op = toks[p++].v;
            l = { k: 'bin', op, a: l, b: parseUnary() };
        }
        return l;
    };
    const parseUnary = () => {
        if (at('OP', '-')) {
            p++;
            return { k: 'un', op: '-', a: parseUnary() };
        }
        if (at('OP', '+')) {
            p++;
            return parseUnary();
        }
        if (at('OP', '!')) {
            p++;
            return { k: 'un', op: 'not', a: parseUnary() };
        }
        if (at('IDENT', 'not')) {
            p++;
            return { k: 'un', op: 'not', a: parseUnary() };
        }
        return parsePostfix();
    };
    const parsePostfix = () => {
        let e = parsePrimary();
        while (at('OP', '[')) {
            p++;
            const off = parseExpr();
            eat('OP', ']');
            e = { k: 'hist', obj: e, off };
        }
        return e;
    };
    const parseArgs = () => {
        const args = [];
        const kwargs = {};
        if (at('OP', ')'))
            return { args, kwargs };
        for (;;) {
            if (at('IDENT') && toks[p + 1] && toks[p + 1].t === 'OP' && toks[p + 1].v === '=') {
                const key = toks[p].v;
                p += 2;
                kwargs[key] = parseExpr();
            }
            else {
                args.push(parseExpr());
            }
            if (at('OP', ',')) {
                p++;
                continue;
            }
            break;
        }
        return { args, kwargs };
    };
    const parsePrimary = () => {
        if (at('NUM'))
            return { k: 'num', v: parseFloat(toks[p++].v) };
        if (at('STR'))
            return { k: 'str', v: toks[p++].v };
        if (at('OP', '(')) {
            p++;
            const e = parseExpr();
            eat('OP', ')');
            return e;
        }
        if (at('OP', '[')) {
            p++;
            const items = [];
            if (!at('OP', ']')) {
                items.push(parseExpr());
                while (at('OP', ',')) {
                    p++;
                    items.push(parseExpr());
                }
            }
            eat('OP', ']');
            return { k: 'arr', items };
        }
        // Pine 允许 `x = if cond \n a \n else \n b` —— if 当表达式用
        if (at('IDENT', 'if'))
            return parseIf();
        if (at('IDENT')) {
            const name = toks[p++].v;
            if (at('OP', '(')) {
                p++;
                const a = parseArgs();
                eat('OP', ')');
                return { k: 'call', name, args: a.args, kwargs: a.kwargs };
            }
            if (name === 'true')
                return { k: 'bool', v: true };
            if (name === 'false')
                return { k: 'bool', v: false };
            if (name === 'na')
                return { k: 'na' };
            return { k: 'ident', name };
        }
        return fail('无法解析的表达式');
    };
    /* ---------------------------------------------------------- 语句 */
    const parseBody = () => {
        const out = [];
        skipNL();
        eat('INDENT');
        for (;;) {
            skipNL();
            if (at('DEDENT') || at('EOF'))
                break;
            out.push(parseStmt());
            skipNL();
        }
        if (at('DEDENT'))
            p++;
        return out;
    };
    const parseIf = () => {
        eat('IDENT', 'if');
        const cond = parseExpr();
        skipNL();
        const then = parseBody();
        skipNL();
        let els = null;
        if (at('IDENT', 'else')) {
            p++;
            skipNL();
            els = at('IDENT', 'if') ? [parseIf()] : parseBody();
        }
        return { k: 'if', cond, then, els };
    };
    const parseFor = () => {
        eat('IDENT', 'for');
        const name = eat('IDENT').v;
        eat('OP', '=');
        const from = parseExpr();
        eat('IDENT', 'to');
        const to = parseExpr();
        let by = null;
        if (at('IDENT', 'by')) {
            p++;
            by = parseExpr();
        }
        skipNL();
        const body = parseBody();
        return { k: 'for', name, from, to, by, body };
    };
    const parseWhile = () => {
        eat('IDENT', 'while');
        const cond = parseExpr();
        skipNL();
        const body = parseBody();
        return { k: 'while', cond, body };
    };
    /** `f(a, b) => expr` 或 `f(a, b) =>` + 缩进体 */
    const tryFn = () => {
        if (!at('IDENT'))
            return null;
        if (!(toks[p + 1] && toks[p + 1].t === 'OP' && toks[p + 1].v === '('))
            return null;
        const name = toks[p].v;
        let q = p + 2;
        const params = [];
        if (toks[q].t === 'IDENT') {
            params.push(toks[q].v);
            q++;
            while (toks[q] && toks[q].t === 'OP' && toks[q].v === ',') {
                q++;
                if (!toks[q] || toks[q].t !== 'IDENT')
                    return null;
                params.push(toks[q].v);
                q++;
            }
        }
        if (!(toks[q] && toks[q].t === 'OP' && toks[q].v === ')'))
            return null;
        if (!(toks[q + 1] && toks[q + 1].t === 'OP' && toks[q + 1].v === '=>'))
            return null;
        p = q + 2;
        skipNL();
        if (at('INDENT'))
            return { k: 'fn', name, params, body: parseBody() };
        const e = parseExpr();
        return { k: 'fn', name, params, body: [{ k: 'ret', expr: e }] };
    };
    const parseStmt = () => {
        if (at('IDENT', 'var') || at('IDENT', 'varip')) {
            p++;
            const name = eat('IDENT').v;
            eat('OP', '=');
            return { k: 'decl', name, expr: parseExpr(), isVar: true };
        }
        if (at('IDENT', 'if'))
            return parseIf();
        if (at('IDENT', 'for'))
            return parseFor();
        if (at('IDENT', 'while'))
            return parseWhile();
        const fn = tryFn();
        if (fn)
            return fn;
        // 元组解构 [a, b] = f()
        if (at('OP', '[')) {
            const save = p;
            p++;
            const names = [];
            if (at('IDENT')) {
                names.push(toks[p++].v);
                while (at('OP', ',')) {
                    p++;
                    if (!at('IDENT')) {
                        names.length = 0;
                        break;
                    }
                    names.push(toks[p++].v);
                }
            }
            if (names.length && at('OP', ']') && toks[p + 1] && toks[p + 1].t === 'OP' && toks[p + 1].v === '=') {
                p += 2;
                return { k: 'tupleDecl', names, expr: parseExpr(), isVar: false };
            }
            p = save;
        }
        if (at('IDENT')) {
            const save = p;
            const name = toks[p++].v;
            if (at('OP', '=')) {
                p++;
                return { k: 'decl', name, expr: parseExpr(), isVar: false };
            }
            if (at('OP', ':=')) {
                p++;
                return { k: 'assign', name, expr: parseExpr() };
            }
            p = save;
        }
        return { k: 'expr', expr: parseExpr() };
    };
    /* ---------------------------------------------------------- 程序 */
    skipNL();
    if (!at('IDENT'))
        fail('脚本开头必须是 indicator(...) 或 strategy(...)');
    const kind = toks[p++].v;
    if (kind !== 'indicator' && kind !== 'strategy') {
        fail('只支持 indicator(...) / strategy(...) 声明');
    }
    eat('OP', '(');
    const head = parseArgs();
    eat('OP', ')');
    const body = [];
    for (;;) {
        skipNL();
        if (at('EOF'))
            break;
        body.push(parseStmt());
        skipNL();
    }
    /**
     * 声明头里的 title / overlay 等是**元信息**，在解析期就要拿到字面量。
     * ⚠️ 直接存 AST 节点会导致 `!!opts.overlay` 恒为 true（对象永远为真）——
     * 于是 overlay=false 的脚本也被当成叠加在主图上。这是我第一版踩的坑。
     */
    const lit = (n, dflt) => {
        if (!n)
            return dflt;
        if (n.k === 'num' || n.k === 'str' || n.k === 'bool')
            return n.v;
        if (n.k === 'na')
            return null;
        return dflt;
    };
    const opts = {};
    for (const k in head.kwargs)
        opts[k] = lit(head.kwargs[k], undefined);
    return {
        kind,
        title: lit(head.kwargs.title, lit(head.args[0], '')),
        opts,
        body,
    };
}
/* ===========================================================================
 * 6. 常量
 * ========================================================================= */
const PINE_CONSTS = {
    'math.pi': Math.PI,
    'math.e': Math.E,
    'color.red': '#f23645',
    'color.green': '#089981',
    'color.blue': '#2962ff',
    'color.orange': '#ff9800',
    'color.yellow': '#ffeb3b',
    'color.white': '#ffffff',
    'color.black': '#000000',
    'color.gray': '#787b86',
    'color.navy': '#311b92',
    'color.lime': '#00e676',
    'color.fuchsia': '#e040fb',
    'color.aqua': '#00bcd4',
    'color.silver': '#b2b5be',
    'color.maroon': '#880e4f',
    'color.olive': '#808000',
    'color.teal': '#00897b',
    'color.purple': '#9c27b0',
    'plot.style_line': 'line',
    'plot.style_linebr': 'linebr',
    'plot.style_stepline': 'stepline',
    'plot.style_histogram': 'histogram',
    'plot.style_cross': 'cross',
    'plot.style_area': 'area',
    'plot.style_columns': 'columns',
    'shape.triangleup': 'triangleup',
    'shape.triangledown': 'triangledown',
    'shape.circle': 'circle',
    'shape.cross': 'cross',
    'shape.diamond': 'diamond',
    'shape.flag': 'flag',
    'shape.arrowup': 'arrowup',
    'shape.arrowdown': 'arrowdown',
    'shape.labelup': 'labelup',
    'shape.labeldown': 'labeldown',
    'shape.xcross': 'xcross',
    'location.abovebar': 'abovebar',
    'location.belowbar': 'belowbar',
    'location.top': 'top',
    'location.bottom': 'bottom',
    'location.absolute': 'absolute',
    'size.tiny': 'tiny',
    'size.small': 'small',
    'size.normal': 'normal',
    'size.large': 'large',
    'size.huge': 'huge',
    'barmerge.gaps_off': 'gaps_off',
    'barmerge.lookahead_off': 'lookahead_off',
    // strategy/position 常量先占位，Phase 2 的撮合引擎会用到
    'strategy.long': 'long',
    'strategy.short': 'short',
    'strategy.percent_of_equity': 'percent_of_equity',
    'strategy.fixed': 'fixed',
    'strategy.cash': 'cash',
    'math.max_bars_back': 5000,
};
const PINE_CONST_PREFIXES = [
    'color.', 'plot.', 'shape.', 'location.', 'size.', 'barmerge.',
    'strategy.', 'math.', 'timeframe.', 'syminfo.', 'ta.', 'input.', 'request.', 'table.', 'label.',
];
/** 需要「参数的上一根值」的内置，都靠这个拿 */
function prevOf(ctx, node, key) {
    const st = ctx.env.state(node, () => ({}));
    return st[key];
}
function setPrev(ctx, node, key, v) {
    const st = ctx.env.state(node, () => ({}));
    st[key] = v;
}
const PINE_BUILTINS = {
    /* ------------------------------------------------------------- 输出 */
    plot: (ctx, node, a, kw) => {
        const p = ctx.engine.plotFor(node, kw);
        p.values[ctx.bar] = isNa(a[0]) ? null : toNum(a[0]);
        return a[0];
    },
    plotshape: (ctx, node, a, kw) => {
        if (truthy(a[0]))
            ctx.engine.markFor(node, kw, 'shape').marks[ctx.bar] = kw.text || kw.style || '•';
        return a[0];
    },
    plotchar: (ctx, node, a, kw) => {
        if (truthy(a[0]))
            ctx.engine.markFor(node, kw, 'char').marks[ctx.bar] = kw.char || kw.text || '•';
        return a[0];
    },
    bgcolor: (ctx, node, a, kw) => {
        // Pine 里 bgcolor(na) 表示「这根不染色」，不能记成一条 na 色带
        if (!isNa(a[0])) {
            ctx.engine.bg[ctx.bar] = { color: a[0], transp: kw.transp == null ? 0 : toNum(kw.transp) };
        }
        return NA;
    },
    hline: (ctx, node, a, kw) => {
        ctx.engine.hlineFor(node, kw, a[0]);
        return NA;
    },
    fill: () => NA, // 明确不支持，不装作支持
    /* ------------------------------------------------------------ 输入 */
    'input.int': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    'input.float': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    'input.bool': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    'input.string': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    'input.color': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    'input.timeframe': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    'input.symbol': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    'input.price': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    'input.time': (ctx, node, a, kw) => inputVal(ctx, a, kw),
    // ⚠️ 只返回当前值，不是「序列引用」——所以 input.source(close)[1] 不支持
    'input.source': (ctx, node, a) => a[0],
    /* ------------------------------------------------------------ math */
    'math.abs': (c, n, a) => (isNa(a[0]) ? NA : Math.abs(toNum(a[0]))),
    'math.max': (c, n, a) => (isNa(a[0]) || isNa(a[1]) ? NA : Math.max(toNum(a[0]), toNum(a[1]))),
    'math.min': (c, n, a) => (isNa(a[0]) || isNa(a[1]) ? NA : Math.min(toNum(a[0]), toNum(a[1]))),
    'math.round': (c, n, a) => (isNa(a[0]) ? NA : roundTo(toNum(a[0]), a.length > 1 ? toNum(a[1]) : 0)),
    'math.floor': (c, n, a) => (isNa(a[0]) ? NA : Math.floor(toNum(a[0]))),
    'math.ceil': (c, n, a) => (isNa(a[0]) ? NA : Math.ceil(toNum(a[0]))),
    'math.sqrt': (c, n, a) => (isNa(a[0]) || toNum(a[0]) < 0 ? NA : Math.sqrt(toNum(a[0]))),
    'math.pow': (c, n, a) => (isNa(a[0]) || isNa(a[1]) ? NA : Math.pow(toNum(a[0]), toNum(a[1]))),
    'math.log': (c, n, a) => (isNa(a[0]) || toNum(a[0]) <= 0 ? NA : Math.log(toNum(a[0]))),
    'math.log10': (c, n, a) => (isNa(a[0]) || toNum(a[0]) <= 0 ? NA : Math.log10(toNum(a[0]))),
    'math.exp': (c, n, a) => (isNa(a[0]) ? NA : Math.exp(toNum(a[0]))),
    'math.sign': (c, n, a) => (isNa(a[0]) ? NA : Math.sign(toNum(a[0]))),
    'math.avg': (c, n, a) => avgOf(a),
    'math.sum': (c, n, a) => {
        let s = 0;
        for (const v of a) {
            if (isNa(v))
                return NA;
            s += toNum(v);
        }
        return s;
    },
    /* -------------------------------------------------------------- ta */
    'ta.sma': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ buf: [], sum: 0 }));
        const v = toNum(a[0]);
        if (isNa(a[0]))
            return NA;
        st.buf.push(v);
        st.sum += v;
        if (st.buf.length > len)
            st.sum -= st.buf.shift();
        return st.buf.length < len ? NA : st.sum / len;
    },
    /**
     * ta.ema：前 len-1 根为 na，第 len 根用 SMA 播种，之后 alpha = 2/(len+1)。
     * ⚠️ 播种方式是我按 TradingView 文档实现的；这个引擎**没有**对 TV 逐值验证过。
     */
    'ta.ema': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ n: 0, sum: 0, prev: NA }));
        if (isNa(a[0]))
            return NA;
        const v = toNum(a[0]);
        st.n++;
        if (st.n < len) {
            st.sum += v;
            return NA;
        }
        if (st.n === len) {
            st.sum += v;
            st.prev = st.sum / len;
            return st.prev;
        }
        const alpha = 2 / (len + 1);
        st.prev = alpha * v + (1 - alpha) * st.prev;
        return st.prev;
    },
    /** ta.rma：Wilder 平滑，alpha = 1/len，同样 SMA 播种 */
    'ta.rma': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ n: 0, sum: 0, prev: NA }));
        if (isNa(a[0]))
            return NA;
        const v = toNum(a[0]);
        st.n++;
        if (st.n < len) {
            st.sum += v;
            return NA;
        }
        if (st.n === len) {
            st.sum += v;
            st.prev = st.sum / len;
            return st.prev;
        }
        st.prev = (st.prev * (len - 1) + v) / len;
        return st.prev;
    },
    'ta.wma': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ buf: [] }));
        if (isNa(a[0]))
            return NA;
        st.buf.push(toNum(a[0]));
        if (st.buf.length > len)
            st.buf.shift();
        if (st.buf.length < len)
            return NA;
        let num = 0;
        let den = 0;
        for (let i = 0; i < len; i++) {
            const w = i + 1;
            num += st.buf[len - 1 - i] * w;
            den += w;
        }
        return num / den;
    },
    'ta.rsi': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ prev: NA, up: NA, dn: NA, n: 0, su: 0, sd: 0 }));
        if (isNa(a[0]))
            return NA;
        const v = toNum(a[0]);
        if (isNa(st.prev)) {
            st.prev = v;
            return NA;
        }
        const ch = v - st.prev;
        st.prev = v;
        const gain = ch > 0 ? ch : 0;
        const loss = ch < 0 ? -ch : 0;
        st.n++;
        if (st.n < len) {
            st.su += gain;
            st.sd += loss;
            return NA;
        }
        if (st.n === len) {
            st.su = (st.su + gain) / len;
            st.sd = (st.sd + loss) / len;
        }
        else {
            st.su = (st.su * (len - 1) + gain) / len;
            st.sd = (st.sd * (len - 1) + loss) / len;
        }
        if (st.sd === 0)
            return st.su === 0 ? 50 : 100;
        const rs = st.su / st.sd;
        return 100 - 100 / (1 + rs);
    },
    'ta.tr': (ctx, node, a) => trueRange(ctx, node),
    'ta.atr': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[0])));
        const st = ctx.env.state(node, () => ({ n: 0, sum: 0, prev: NA, tprev: NA }));
        const b = ctx.engine.bars[ctx.bar];
        const pc = ctx.bar > 0 ? ctx.engine.bars[ctx.bar - 1].close : NA;
        let tr;
        if (isNa(pc))
            tr = b.high - b.low;
        else
            tr = Math.max(b.high - b.low, Math.abs(b.high - toNum(pc)), Math.abs(b.low - toNum(pc)));
        st.n++;
        if (st.n < len) {
            st.sum += tr;
            return NA;
        }
        if (st.n === len) {
            st.sum += tr;
            st.prev = st.sum / len;
            return st.prev;
        }
        st.prev = (st.prev * (len - 1) + tr) / len;
        return st.prev;
    },
    'ta.highest': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ buf: [] }));
        if (isNa(a[0]))
            return NA;
        st.buf.push(toNum(a[0]));
        if (st.buf.length > len)
            st.buf.shift();
        if (st.buf.length < len)
            return NA;
        let m = -Infinity;
        for (const v of st.buf)
            if (v > m)
                m = v;
        return m;
    },
    'ta.lowest': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ buf: [] }));
        if (isNa(a[0]))
            return NA;
        st.buf.push(toNum(a[0]));
        if (st.buf.length > len)
            st.buf.shift();
        if (st.buf.length < len)
            return NA;
        let m = Infinity;
        for (const v of st.buf)
            if (v < m)
                m = v;
        return m;
    },
    /**
     * ta.change(src, len) = src - src[len]。
     * ⚠️ 必须用「先读后写」的序列，不能拿一个长度 len 的窗口去减 ——
     * len=1 时窗口里只有当前值，会永远返回 na（这是我第一版踩的坑）。
     */
    'ta.change': (ctx, node, a) => {
        const len = a.length > 1 ? Math.max(1, Math.round(toNum(a[1]))) : 1;
        const st = ctx.env.state(node, () => new PSeries(NA));
        const prev = st.buf.length >= len ? st.buf[st.buf.length - len] : NA;
        st.set(a[0]);
        if (isNa(a[0]) || isNa(prev))
            return NA;
        return toNum(a[0]) - toNum(prev);
    },
    'ta.roc': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ buf: [] }));
        if (isNa(a[0]))
            return NA;
        st.buf.push(toNum(a[0]));
        if (st.buf.length > len + 1)
            st.buf.shift();
        if (st.buf.length <= len)
            return NA;
        const prev = st.buf[0];
        return prev === 0 ? NA : ((st.buf[st.buf.length - 1] - prev) / prev) * 100;
    },
    'ta.stdev': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const st = ctx.env.state(node, () => ({ buf: [] }));
        if (isNa(a[0]))
            return NA;
        st.buf.push(toNum(a[0]));
        if (st.buf.length > len)
            st.buf.shift();
        if (st.buf.length < len)
            return NA;
        const m = avgOf(st.buf);
        let acc = 0;
        for (const v of st.buf)
            acc += (v - m) * (v - m);
        return Math.sqrt(acc / len);
    },
    'ta.cum': (ctx, node, a) => {
        const st = ctx.env.state(node, () => ({ s: 0 }));
        if (isNa(a[0]))
            return st.s;
        st.s += toNum(a[0]);
        return st.s;
    },
    'ta.crossover': (ctx, node, a) => crossCheck(ctx, node, a, true),
    'ta.crossunder': (ctx, node, a) => crossCheck(ctx, node, a, false),
    'ta.barssince': (ctx, node, a) => {
        const st = ctx.env.state(node, () => ({ since: NA, n: 0 }));
        if (truthy(a[0]))
            st.since = 0;
        else if (isNa(st.since))
            st.since = NA;
        else
            st.since = st.since + 1;
        return st.since;
    },
    'ta.valuewhen': (ctx, node, a) => {
        const occ = Math.max(0, Math.round(toNum(a[2])));
        const st = ctx.env.state(node, () => ({ arr: [] }));
        if (truthy(a[0]))
            st.arr.unshift(a[1]);
        return st.arr.length > occ ? st.arr[occ] : NA;
    },
    /** ta.macd → [macd, signal, hist] */
    'ta.macd': (ctx, node, a) => {
        const fast = Math.max(1, Math.round(toNum(a[1] == null ? 12 : a[1])));
        const slow = Math.max(1, Math.round(toNum(a[2] == null ? 26 : a[2])));
        const sig = Math.max(1, Math.round(toNum(a[3] == null ? 9 : a[3])));
        const st = ctx.env.state(node, () => ({ f: emaState(), s: emaState(), g: emaState() }));
        if (isNa(a[0]))
            return [NA, NA, NA];
        const v = toNum(a[0]);
        const ef = emaStep(st.f, v, fast);
        const es = emaStep(st.s, v, slow);
        if (isNa(ef) || isNa(es))
            return [NA, NA, NA];
        const macd = ef - es;
        const signal = emaStep(st.g, macd, sig);
        return [macd, signal, isNa(signal) ? NA : macd - signal];
    },
    /** ta.bb → [middle, upper, lower] */
    'ta.bb': (ctx, node, a) => {
        const len = Math.max(1, Math.round(toNum(a[1])));
        const mult = a.length > 2 ? toNum(a[2]) : 2;
        const st = ctx.env.state(node, () => ({ buf: [] }));
        if (isNa(a[0]))
            return [NA, NA, NA];
        st.buf.push(toNum(a[0]));
        if (st.buf.length > len)
            st.buf.shift();
        if (st.buf.length < len)
            return [NA, NA, NA];
        const m = avgOf(st.buf);
        let acc = 0;
        for (const v of st.buf)
            acc += (v - m) * (v - m);
        const sd = Math.sqrt(acc / len);
        return [m, m + mult * sd, m - mult * sd];
    },
    /* ------------------------------------------------------------- 杂项 */
    'nz': (c, n, a) => (isNa(a[0]) ? (a.length > 1 ? a[1] : 0) : a[0]),
    'na': (c, n, a) => isNa(a[0]),
    'fixnan': (ctx, node, a) => {
        const st = ctx.env.state(node, () => ({ last: NA }));
        if (!isNa(a[0]))
            st.last = a[0];
        return st.last;
    },
    'str.tostring': (c, n, a, kw) => {
        const v = a[0];
        if (isNa(v))
            return 'NaN';
        if (typeof v === 'string')
            return v;
        if (typeof v === 'boolean')
            return v ? 'true' : 'false';
        const num = toNum(v);
        return fmtNum(num, a.length > 1 ? String(a[1]) : null);
    },
    'str.length': (c, n, a) => String(isNa(a[0]) ? '' : a[0]).length,
    'color.new': (c, n, a) => withAlpha(a[0], a.length > 1 ? toNum(a[1]) : 0),
    'color.rgb': (c, n, a) => {
        const r = Math.round(toNum(a[0]));
        const g = Math.round(toNum(a[1]));
        const b = Math.round(toNum(a[2]));
        const t = a.length > 3 ? toNum(a[3]) : 0;
        return withAlpha('rgb(' + r + ',' + g + ',' + b + ')', t);
    },
};
/** 需要「参数上一根值」的交叉判断 */
function crossCheck(ctx, node, a, up) {
    const st = ctx.env.state(node, () => ({ pa: NA, pb: NA }));
    const x = toNum(a[0]);
    const y = toNum(a[1]);
    let r = false;
    if (!isNa(st.pa) && !isNa(st.pb) && !isNa(a[0]) && !isNa(a[1])) {
        r = up ? (x > y && st.pa <= st.pb) : (x < y && st.pa >= st.pb);
    }
    st.pa = a[0];
    st.pb = a[1];
    return r;
}
/** 第一根 bar 的 TR 就是 high-low（没有前收） */
function trueRange(ctx, node) {
    const b = ctx.engine.bars[ctx.bar];
    if (ctx.bar === 0)
        return b.high - b.low;
    const pc = ctx.engine.bars[ctx.bar - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
}
function emaState() { return { n: 0, sum: 0, prev: NA }; }
/** 复用同一套 EMA 递推，避免 ta.macd 里再写一遍 */
function emaStep(st, v, len) {
    st.n++;
    if (st.n < len) {
        st.sum += v;
        return NA;
    }
    if (st.n === len) {
        st.sum += v;
        st.prev = st.sum / len;
        return st.prev;
    }
    const alpha = 2 / (len + 1);
    st.prev = alpha * v + (1 - alpha) * st.prev;
    return st.prev;
}
function avgOf(arr) {
    let s = 0;
    let n = 0;
    for (const v of arr) {
        if (isNa(v))
            continue;
        s += toNum(v);
        n++;
    }
    return n ? s / n : NaN;
}
function roundTo(v, digits) {
    const p = Math.pow(10, digits);
    return Math.round(v * p) / p;
}
function fmtNum(v, fmt) {
    if (!fmt)
        return String(roundTo(v, 4));
    const m = /^#(?:\.(#+))?$/.exec(fmt);
    if (m)
        return v.toFixed(m[1] ? m[1].length : 0);
    if (fmt === '#.##')
        return v.toFixed(2);
    return String(roundTo(v, 4));
}
function withAlpha(color, transp) {
    const c = String(color == null ? '#000000' : color);
    const a = Math.max(0, Math.min(100, transp)) / 100;
    const m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) {
        const n = parseInt(m[1], 16);
        return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (1 - a).toFixed(3) + ')';
    }
    return c;
}
/**
 * input.* 的取值：优先用 `inputs` 里按 **title** 键覆盖的值。
 * ⚠️ title 既可能来自 kwargs（`input.int(3, title="N")`），
 * 也可能是**第二个位置参数**（`input.int(3, "N")`）——两个都得认，
 * 只认 kwargs 的话位置写法会被静默忽略。
 */
function inputVal(ctx, a, kw) {
    let key = null;
    if (kw && kw.title != null)
        key = String(kw.title);
    else if (a.length > 1 && a[1] != null)
        key = String(a[1]);
    if (key && ctx.engine.inputs && Object.prototype.hasOwnProperty.call(ctx.engine.inputs, key)) {
        return ctx.engine.inputs[key];
    }
    return a[0];
}
/* ===========================================================================
 * 8. 求值
 * ========================================================================= */
function pEval(node, env, eng) {
    switch (node.k) {
        case 'num': return node.v;
        case 'str': return node.v;
        case 'bool': return node.v;
        case 'na': return NA;
        case 'ident': {
            const s = env.lookup(node.name);
            if (s)
                return s.get(0);
            if (node.name in PINE_CONSTS)
                return PINE_CONSTS[node.name];
            for (const pre of PINE_CONST_PREFIXES) {
                if (node.name.indexOf(pre) === 0) {
                    throw new Error('「' + node.name + '」这一类在这个 Pine 子集里还没实现');
                }
            }
            throw new Error('未知标识符：' + node.name);
        }
        case 'arr': {
            const out = [];
            for (const e of node.items)
                out.push(pEval(e, env, eng));
            return out;
        }
        case 'hist': {
            const off = Math.round(toNum(pEval(node.off, env, eng)));
            if (off <= 0)
                return pEval(node.obj, env, eng);
            if (node.obj.k === 'ident') {
                const s = env.lookup(node.obj.name);
                if (s)
                    return s.get(off);
            }
            // 兜底：给这个表达式节点单独维护一条历史（`ta.sma(...)[1]` 这类）
            const hs = env.state(node.obj, () => new PSeries(NA));
            const r = hs.get(off);
            hs.set(pEval(node.obj, env, eng));
            return r;
        }
        case 'un': {
            if (node.op === 'not')
                return !truthy(pEval(node.a, env, eng));
            const v = pEval(node.a, env, eng);
            if (node.op === '-')
                return isNa(v) ? NA : -toNum(v);
            return v;
        }
        case 'bin': return pBin(node.op, pEval(node.a, env, eng), pEval(node.b, env, eng));
        case 'tern': return truthy(pEval(node.c, env, eng)) ? pEval(node.a, env, eng) : pEval(node.b, env, eng);
        case 'if': {
            const r = pExec(node, env, eng);
            return r && r.__ret ? r.v : r;
        }
        case 'call': return pCall(node, env, eng);
    }
    throw new Error('未实现的表达式节点：' + node.k);
}
function pCall(node, env, eng) {
    const fnNode = env.lookupFunc(node.name);
    if (fnNode) {
        const fe = env.fnEnvFor(node);
        for (let i = 0; i < fnNode.params.length; i++) {
            const v = node.args[i] ? pEval(node.args[i], env, eng) : NA;
            fe.bindSeries(fnNode.params[i], v);
        }
        const r = pExecBody(fnNode.body, fe, eng);
        return r && r.__ret ? r.v : r;
    }
    const b = PINE_BUILTINS[node.name];
    if (!b) {
        for (const pre of PINE_CONST_PREFIXES) {
            if (node.name.indexOf(pre) === 0) {
                throw new Error('「' + node.name + '」这一类在这个 Pine 子集里还没实现');
            }
        }
        throw new Error('未知函数：' + node.name);
    }
    const args = [];
    for (const a of node.args)
        args.push(pEval(a, env, eng));
    const kw = {};
    for (const k in node.kwargs)
        kw[k] = pEval(node.kwargs[k], env, eng);
    return b({ env, engine: eng, bar: eng.bar }, node, args, kw);
}
function pExecBody(body, env, eng) {
    let last = NA;
    for (const st of body) {
        const r = pExec(st, env, eng);
        if (r && r.__ret)
            return r; // 原样往上抛，别在这里解包
        last = r;
    }
    return last;
}
function pExec(st, env, eng) {
    switch (st.k) {
        case 'decl':
            return env.declare(st.name, pEval(st.expr, env, eng), st.isVar);
        case 'tupleDecl': {
            const r = pEval(st.expr, env, eng);
            const arr = Array.isArray(r) ? r : [r];
            for (let i = 0; i < st.names.length; i++) {
                env.declare(st.names[i], i < arr.length ? arr[i] : NA, st.isVar);
            }
            return NA;
        }
        case 'assign': {
            const s = env.lookup(st.name);
            if (!s)
                throw new Error('给未声明的变量赋值（:=）：' + st.name);
            s.set(pEval(st.expr, env, eng));
            return NA;
        }
        case 'expr': return pEval(st.expr, env, eng);
        case 'fn':
            env.funcs[st.name] = st;
            return NA;
        case 'ret':
            return { __ret: true, v: pEval(st.expr, env, eng) };
        case 'if':
            if (truthy(pEval(st.cond, env, eng)))
                return pExecBody(st.then, env, eng);
            if (st.els)
                return pExecBody(st.els, env, eng);
            return NA;
        case 'for': {
            const from = Math.round(toNum(pEval(st.from, env, eng)));
            const to = Math.round(toNum(pEval(st.to, env, eng)));
            const rawBy = st.by ? Math.round(toNum(pEval(st.by, env, eng))) : 1;
            const step = rawBy === 0 ? 1 : Math.abs(rawBy);
            env.declare(st.name, from, false);
            const vs = env.lookup(st.name);
            let guard = 0;
            if (from <= to) {
                for (let i = from; i <= to; i += step) {
                    if (vs)
                        vs.set(i);
                    const r = pExecBody(st.body, env, eng);
                    if (r && r.__ret)
                        return r;
                    if (++guard > 100000)
                        throw new Error('for 循环超过 10 万次');
                }
            }
            else {
                for (let i = from; i >= to; i -= step) {
                    if (vs)
                        vs.set(i);
                    const r = pExecBody(st.body, env, eng);
                    if (r && r.__ret)
                        return r;
                    if (++guard > 100000)
                        throw new Error('for 循环超过 10 万次');
                }
            }
            return NA;
        }
        case 'while': {
            let guard = 0;
            while (truthy(pEval(st.cond, env, eng))) {
                const r = pExecBody(st.body, env, eng);
                if (r && r.__ret)
                    return r;
                if (++guard > 100000)
                    throw new Error('while 循环超过 10 万次，疑似死循环');
            }
            return NA;
        }
    }
    throw new Error('未实现的语句节点：' + st.k);
}
/* ===========================================================================
 * 9. 引擎
 * ========================================================================= */
class PineEngine {
    constructor(code, bars, opts) {
        this.code = code;
        this.bars = bars;
        this.program = pineParse(code);
        this.kind = this.program.kind;
        this.title = String(this.program.title || '');
        this.overlay = !!this.program.opts.overlay;
        this.globalEnv = new PEnv(null);
        this.plots = [];
        this.marks = [];
        this.hlines = [];
        this.bg = [];
        this.inputs = (opts && opts.inputs) || {};
        this.logs = [];
        this.plotByNode = new Map();
        this.bar = 0;
        this.error = null;
        this.symbol = (opts && opts.symbol) || 'DEMO';
        this.timeframe = (opts && opts.timeframe) || '1D';
    }
    plotFor(node, kw) {
        let p = this.plotByNode.get(node);
        if (!p) {
            p = {
                title: kw && kw.title != null ? String(kw.title) : 'plot' + this.plots.length,
                color: kw && kw.color != null ? String(kw.color) : '#4d7cff',
                width: kw && kw.linewidth != null ? toNum(kw.linewidth) : 1,
                style: kw && kw.style != null ? String(kw.style) : 'line',
                values: [],
            };
            this.plotByNode.set(node, p);
            this.plots.push(p);
        }
        return p;
    }
    markFor(node, kw, kind) {
        let m = this.plotByNode.get('mark' + kind + String(this.marks.length));
        m = this.plotByNode.get(node);
        if (!m) {
            m = {
                kind,
                title: kw && kw.title != null ? String(kw.title) : kind,
                style: kw && kw.style != null ? String(kw.style) : 'circle',
                location: kw && kw.location != null ? String(kw.location) : 'abovebar',
                color: kw && kw.color != null ? String(kw.color) : '#f5c542',
                size: kw && kw.size != null ? String(kw.size) : 'small',
                marks: [],
            };
            this.plotByNode.set(node, m);
            this.marks.push(m);
        }
        return m;
    }
    hlineFor(node, kw, price) {
        let h = this.plotByNode.get(node);
        if (!h) {
            h = {
                price: toNum(price),
                title: kw && kw.title != null ? String(kw.title) : 'hline',
                color: kw && kw.color != null ? String(kw.color) : '#787b86',
                linestyle: kw && kw.linestyle != null ? String(kw.linestyle) : 'dashed',
            };
            this.plotByNode.set(node, h);
            this.hlines.push(h);
        }
        return h;
    }
    setBarVars(i) {
        const b = this.bars[i];
        const g = this.globalEnv;
        const d = new Date(b.time);
        const put = (name, v) => {
            let s = g.vars[name];
            if (!s) {
                s = new PSeries(NA);
                g.vars[name] = s;
            }
            s.set(v);
            s.inited = true;
        };
        put('open', b.open);
        put('high', b.high);
        put('low', b.low);
        put('close', b.close);
        put('volume', b.volume);
        put('time', b.time);
        put('time_close', b.time);
        put('bar_index', i);
        put('last_bar_index', this.bars.length - 1);
        put('hl2', (b.high + b.low) / 2);
        put('hlc3', (b.high + b.low + b.close) / 3);
        put('ohlc4', (b.open + b.high + b.low + b.close) / 4);
        put('hlcc4', (b.high + b.low + b.close + b.close) / 4);
        put('year', d.getFullYear());
        put('month', d.getMonth() + 1);
        put('dayofmonth', d.getDate());
        put('dayofweek', d.getDay() + 1);
        put('hour', d.getHours());
        put('minute', d.getMinutes());
    }
    run() {
        const n = this.bars.length;
        for (let i = 0; i < n; i++) {
            this.bar = i;
            this.setBarVars(i);
            pExecBody(this.program.body, this.globalEnv, this);
            this.globalEnv.commitAll(new Set());
        }
        // 补齐稀疏数组，方便下游按索引取
        for (const p of this.plots) {
            for (let i = 0; i < n; i++)
                if (p.values[i] === undefined)
                    p.values[i] = null;
            if (p.values.length > n)
                p.values.length = n;
        }
        return this;
    }
    /** 最后一根 bar 上所有变量的值，自检和「数据窗口」都用它 */
    snapshot() {
        const out = {};
        const g = this.globalEnv;
        for (const k in g.vars)
            out[k] = g.vars[k].get(0);
        return out;
    }
    lastPlot(i) {
        const p = this.plots[i || 0];
        if (!p)
            return null;
        return p.values[p.values.length - 1];
    }
    /** 把 plot / plotshape 的输出灌进 TVChart */
    applyTo(chart) {
        chart.clearLines();
        chart.clearMarks();
        for (const p of this.plots) {
            if (p.style === 'histogram' || p.style === 'columns')
                continue;
            chart.addLine({
                name: p.title,
                color: p.color,
                values: p.values.slice(),
                width: p.width,
                dash: [],
            });
        }
        for (const h of this.hlines) {
            const vals = [];
            for (let i = 0; i < this.bars.length; i++)
                vals.push(h.price);
            chart.addLine({ name: h.title, color: h.color, values: vals, width: 1, dash: [4, 4] });
        }
        for (const m of this.marks) {
            const above = m.location === 'abovebar' || m.location === 'top';
            const list = [];
            for (let i = 0; i < this.bars.length; i++) {
                const txt = m.marks[i];
                if (txt === undefined)
                    continue;
                list.push({
                    index: i,
                    price: above ? this.bars[i].high : this.bars[i].low,
                    color: m.color,
                    text: String(txt),
                    above,
                });
            }
            if (list.length)
                chart.addMarkers(list);
        }
    }
    /** 给图例/数据窗口用的一行摘要 */
    summary() {
        const parts = [];
        parts.push(this.kind + ' "' + this.title + '"' + (this.overlay ? ' overlay' : ''));
        parts.push('bars=' + this.bars.length);
        parts.push('plots=' + this.plots.length);
        if (this.marks.length)
            parts.push('marks=' + this.marks.length);
        if (this.hlines.length)
            parts.push('hlines=' + this.hlines.length);
        return parts.join('  ');
    }
}
/** 造一批测试用 K 线：open=前收，high/low 各让 0.5，方便手算 ATR */
function pineTestBars(closes) {
    const out = [];
    let t = new Date(2020, 0, 2, 9, 30, 0, 0).getTime();
    for (let i = 0; i < closes.length; i++) {
        const c = closes[i];
        const o = i === 0 ? c : closes[i - 1];
        out.push({
            time: t,
            open: o,
            high: Math.max(o, c) + 0.5,
            low: Math.min(o, c) - 0.5,
            close: c,
            volume: 100,
        });
        t += 86400000;
    }
    return out;
}
function pineSelfTest() {
    let pass = 0;
    let fail = 0;
    const names = [];
    const t = (name, ok, extra = '') => {
        names.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  :: ' + extra : ''));
        if (ok)
            pass++;
        else
            fail++;
        log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  :: ' + extra : ''));
    };
    const near = (a, b, eps = 1e-9) => {
        if (isNa(a) && isNa(b))
            return true;
        if (isNa(a) || isNa(b))
            return false;
        return Math.abs(toNum(a) - toNum(b)) <= eps;
    };
    const RISE = [1, 2, 3, 4, 5];
    const run1 = (code, closes, inputs) => {
        const eng = new PineEngine(code, pineTestBars(closes), { inputs });
        eng.run();
        return eng;
    };
    const last = (code, closes) => {
        const e = run1(code, closes);
        return e.lastPlot(0);
    };
    // --- 最基本的赋值与绘制 ---
    t('x = 5 / plot(x) 末值 5', near(last('indicator("t")\nx = 5\nplot(x)', RISE), 5), String(last('indicator("t")\nx = 5\nplot(x)', RISE)));
    // --- 序列语义：x[n] 取上一根 ---
    t('bar_index[1] 在第 5 根是 3', near(last('indicator("t")\nplot(bar_index[1])', RISE), 3), String(last('indicator("t")\nplot(bar_index[1])', RISE)));
    t('bar_index[2] 在第 5 根是 2', near(last('indicator("t")\nplot(bar_index[2])', RISE), 2), '');
    // --- var：初值只在第 0 根算一次 ---
    t('var n = 0 / n := n + 1 跑 5 根 → 5', near(last('indicator("t")\nvar n = 0\nn := n + 1\nplot(n)', RISE), 5), String(last('indicator("t")\nvar n = 0\nn := n + 1\nplot(n)', RISE)));
    t('非 var 变量每根重新赋值，但历史照样保留 → n[1] = 6', near(last('indicator("t")\nn = bar_index * 2\nplot(n[1])', RISE), 6), String(last('indicator("t")\nn = bar_index * 2\nplot(n[1])', RISE)));
    t('在声明式里引用自己必须抛错（Pine 不允许）', (() => {
        try {
            new PineEngine('indicator("t")\nn = nz(n[1], 0) + 1\nplot(n)', pineTestBars(RISE)).run();
            return false;
        }
        catch (e) {
            return String(e).indexOf('未知标识符') >= 0;
        }
    })(), '');
    // --- ta.sma / ema / rma ---
    t('ta.sma(close, 3) 在 [1..5] 末值 4', near(last('indicator("t")\nplot(ta.sma(close, 3))', RISE), 4), '');
    t('ta.sma 前 2 根是 na', (() => {
        const e = run1('indicator("t")\nplot(ta.sma(close, 3))', RISE);
        return e.plots[0].values[0] === null && e.plots[0].values[1] === null && e.plots[0].values[2] !== null;
    })(), '');
    // ema(3) 播种 = sma(3) = 2，之后 alpha=0.5：bar3 = .5*4+.5*2 = 3，bar4 = .5*5+.5*3 = 4
    t('ta.ema(close, 3) 按 SMA 播种 → 4', near(last('indicator("t")\nplot(ta.ema(close, 3))', RISE), 4, 1e-9), String(last('indicator("t")\nplot(ta.ema(close, 3))', RISE)));
    // rma(3) 播种 = 2，之后 alpha=1/3：bar3 = (2*2+4)/3 = 2.6667，bar4 = (2.6667*2+5)/3 = 3.4444
    t('ta.rma(close, 3) 按 SMA 播种 → 3.4444', near(last('indicator("t")\nplot(ta.rma(close, 3))', RISE), 3.444444, 1e-5), String(last('indicator("t")\nplot(ta.rma(close, 3))', RISE)));
    // --- 单调上涨序列的 RSI 必须是 100 ---
    t('ta.rsi(单调上涨, 2) = 100', near(last('indicator("t")\nplot(ta.rsi(close, 2))', RISE), 100, 1e-9), String(last('indicator("t")\nplot(ta.rsi(close, 2))', RISE)));
    // --- highest / change / stdev ---
    t('ta.highest(close, 3) → 5', near(last('indicator("t")\nplot(ta.highest(close, 3))', RISE), 5), '');
    t('ta.lowest(close, 3) → 3', near(last('indicator("t")\nplot(ta.lowest(close, 3))', RISE), 3), '');
    t('ta.change(close) → 1', near(last('indicator("t")\nplot(ta.change(close))', RISE), 1), '');
    // stdev(3) 在 [3,4,5] 上 = sqrt(2/3) = 0.81650（总体标准差）
    t('ta.stdev(close, 3) → sqrt(2/3)', near(last('indicator("t")\nplot(ta.stdev(close, 3))', RISE), Math.sqrt(2 / 3), 1e-9), String(last('indicator("t")\nplot(ta.stdev(close, 3))', RISE)));
    // --- 调用点隔离：同一函数在两个地方调用必须各自独立 ---
    t('同一个 ta.sma 在两个调用点互不干扰', (() => {
        // 上面那条 sma(close,3) 与下面这条 sma(close,5)：若共享状态，第 2 个会拿到错值
        const e = run1('indicator("t")\na = ta.sma(close, 3)\nb = ta.sma(close, 5)\nplot(a - b)', RISE);
        // a 末值 4；b 末值 (1+2+3+4+5)/5 = 3 → 差 1
        return near(e.lastPlot(0), 1, 1e-9);
    })(), '');
    // --- crossover 只出现一次 ---
    t('ta.crossover 在 [1,2,3,2,1] 上恰好触发 1 次', (() => {
        const e = run1('indicator("t")\nc = ta.crossover(close, 2.5)\nplot(c ? 1 : 0)', [1, 2, 3, 2, 1]);
        let n = 0;
        for (const v of e.plots[0].values)
            if (v === 1)
                n++;
        return n === 1;
    })(), '');
    // --- ta.bb 元组解构 ---
    // [3,4,5]：mean=4，总体 sd = sqrt(2/3)，u-m = 2*sd = 1.63299
    t('[m,u,l] = ta.bb(close, 3, 2) 元组解构正确', (() => {
        const e = run1('indicator("t")\n[m, u, l] = ta.bb(close, 3, 2)\nplot(u - m)', RISE);
        return near(e.lastPlot(0), 2 * Math.sqrt(2 / 3), 1e-9);
    })(), '');
    t('ta.bb 的 l 在中轨下方', (() => {
        const e = run1('indicator("t")\n[m, u, l] = ta.bb(close, 3, 2)\nplot(m - l)', RISE);
        return near(e.lastPlot(0), 2 * Math.sqrt(2 / 3), 1e-9);
    })(), '');
    // --- 控制流 ---
    t('for i = 1 to 3 累加 → 6', near(last('indicator("t")\ns = 0\nfor i = 1 to 3\n    s := s + i\nplot(s)', RISE), 6), String(last('indicator("t")\ns = 0\nfor i = 1 to 3\n    s := s + i\nplot(s)', RISE)));
    t('if 表达式：close > 3 ? 1 : 0 → 1', near(last('indicator("t")\nv = if close > 3\n    1\nelse\n    0\nplot(v)', RISE), 1), '');
    t('三元 + and/or 优先级正确', near(last('indicator("t")\nplot(close > 4 and close < 6 ? 10 : 0)', RISE), 10), '');
    t('while 循环能退出且结果正确', near(last('indicator("t")\nk = 0\nwhile k < 4\n    k := k + 1\nplot(k)', RISE), 4), '');
    // --- 用户函数：每个调用点独立状态 ---
    t('f(x) => x * 2 / f(3) → 6', near(last('indicator("t")\nf(x) => x * 2\nplot(f(3))', RISE), 6), '');
    t('函数体里的 ta.sma 跨 bar 保持状态：[1..5] → 4.5', near(last('indicator("t")\nf() => ta.sma(close, 2)\nplot(f())', RISE), 4.5, 1e-9), String(last('indicator("t")\nf() => ta.sma(close, 2)\nplot(f())', RISE)));
    t('多行函数体 + return 的最后一表达式', near(last('indicator("t")\ng(a, b) =>\n    c = a + b\n    c * 10\nplot(g(1, 2))', RISE), 30), '');
    // --- na 传播 ---
    t('na 传播：na + 1 仍是 na（plot 里落成 null）', (() => {
        const e = run1('indicator("t")\nplot(na + 1)', RISE);
        return e.plots[0].values[4] === null;
    })(), '');
    t('nz(na, 7) → 7', near(last('indicator("t")\nplot(nz(na, 7))', RISE), 7), '');
    t('na 比较一律 false', near(last('indicator("t")\nplot(na > 1 ? 1 : 0)', RISE), 0), '');
    // --- math / str / color ---
    t('math.max(1, 5) → 5', near(last('indicator("t")\nplot(math.max(1, 5))', RISE), 5), '');
    t('math.round(3.14159, 2) → 3.14', near(last('indicator("t")\nplot(math.round(3.14159, 2))', RISE), 3.14), '');
    t('str.tostring 返回字符串', (() => {
        const e = run1('indicator("t")\ns = str.tostring(3.14159, "#.##")\nplot(str.length(s))', RISE);
        return near(e.lastPlot(0), 4);
    })(), '');
    // --- 输出通道 ---
    t('plotshape 只在条件成立时落点', (() => {
        const e = run1('indicator("t")\nplotshape(close > 3, title="hi")', RISE);
        const m = e.marks[0];
        if (!m)
            return false;
        let n = 0;
        for (let i = 0; i < RISE.length; i++)
            if (m.marks[i] !== undefined)
                n++;
        return n === 2; // close = 4, 5
    })(), '');
    t('bgcolor 每根都记录', (() => {
        const e = run1('indicator("t")\nbgcolor(color.red, transp=80)', RISE);
        return e.bg.length === 5;
    })(), '');
    t('bgcolor(na) 不记录（Pine 里表示这根不染色）', (() => {
        const e = run1('indicator("t")\nbgcolor(close > 4 ? color.green : na)', RISE);
        let n = 0;
        for (let i = 0; i < RISE.length; i++)
            if (e.bg[i] !== undefined)
                n++;
        // RISE=[1,2,3,4,5]，close > 4 只有最后一根成立（是 > 不是 >=）
        return n === 1;
    })(), '');
    // --- 声明头元信息必须是**字面量**，不能把 AST 节点存进去 ---
    // 存了节点的话 `!!opts.overlay` 恒为 true（对象永远为真），overlay=false 的脚本会被当叠加图
    t('indicator() 的 title 是字符串不是 AST 节点', (() => {
        const e = new PineEngine('indicator("我的指标", overlay=true)\nplot(1)', pineTestBars(RISE));
        return e.title === '我的指标' && e.overlay === true;
    })(), '');
    t('overlay=false 不能被算成 true（!!对象 恒真是经典坑）', (() => {
        const e = new PineEngine('indicator("x", overlay=false)\nplot(1)', pineTestBars(RISE));
        return e.overlay === false;
    })(), '');
    t('不写 overlay 时默认 false', (() => {
        const e = new PineEngine('indicator("x")\nplot(1)', pineTestBars(RISE));
        return e.overlay === false;
    })(), '');
    t('hline 被收集', (() => {
        const e = run1('indicator("t")\nhline(42, title="L")', RISE);
        return e.hlines.length === 1 && e.hlines[0].price === 42;
    })(), '');
    // --- input 覆盖 ---
    t('input.int 的默认值生效', near(last('indicator("t")\nlen = input.int(3, "N")\nplot(ta.sma(close, len))', RISE), 4), '');
    t('input.int 可被 inputs 覆盖 → len=5 时 sma=3', (() => {
        const e = run1('indicator("t")\nlen = input.int(3, "N")\nplot(ta.sma(close, len))', RISE, { N: 5 });
        return near(e.lastPlot(0), 3);
    })(), '');
    // --- ATR（手算）---
    // pineTestBars([1,2,3])：open=前收，high=max(o,c)+0.5，low=min(o,c)-0.5
    //   bar0: o=1 c=1 h=1.5 l=0.5 → TR = h-l = 1.0（第 0 根没有前收）
    //   bar1: o=1 c=2 h=2.5 l=0.5 → TR = max(2.0, |2.5-1|=1.5, |0.5-1|=0.5) = 2.0
    //   bar2: o=2 c=3 h=3.5 l=1.5 → TR = max(2.0, |3.5-2|=1.5, |1.5-2|=0.5) = 2.0
    // ATR(2) = RMA(TR,2)，SMA 播种：bar1 = (1.0+2.0)/2 = 1.5
    //                              bar2 = (1.5*1 + 2.0)/2 = 1.75
    t('ta.atr(2) 手算 = 1.75', (() => {
        const e = run1('indicator("t")\nplot(ta.atr(2))', [1, 2, 3]);
        return near(e.lastPlot(0), 1.75, 1e-9);
    })(), String(run1('indicator("t")\nplot(ta.atr(2))', [1, 2, 3]).lastPlot(0)));
    t('ta.atr 第 0 根是 na（RMA 还没播满）', (() => {
        const e = run1('indicator("t")\nplot(ta.atr(2))', [1, 2, 3]);
        return e.plots[0].values[0] === null;
    })(), '');
    // --- 错误必须明确报出来，不能静默给 na ---
    const throws = (code) => {
        try {
            const e = new PineEngine(code, pineTestBars([1, 2, 3]));
            e.run();
            return false;
        }
        catch (err) {
            return true;
        }
    };
    t('未知标识符要抛错（不是静默 na）', throws('indicator("t")\nplot(nosuchvar)'), '');
    t('未知函数要抛错', throws('indicator("t")\nplot(nosuchfn(1))'), '');
    t('缩进不齐要抛错', throws('indicator("t")\nif close > 1\n     x = 1\n   y = 2\nplot(x)'), '');
    t('开头不是 indicator/strategy 要抛错', throws('x = 1\nplot(x)'), '');
    t('给未声明变量 := 要抛错', throws('indicator("t")\nz := 1\nplot(z)'), '');
    t('strategy.* 这类未实现的前缀要明确抛错', throws('indicator("t")\nstrategy.entry("L", strategy.long)\nplot(1)'), '');
    log('Pine 自检：' + pass + ' PASS / ' + fail + ' FAIL');
    return { pass, fail, names };
}
