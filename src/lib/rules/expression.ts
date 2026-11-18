import Decimal from "decimal.js";

/**
 * Safe arithmetic language for measurement rules.
 *
 * Source text is tokenised and parsed into a small AST which is interpreted with decimal arithmetic.
 * There is no eval / Function, no property access, no strings, no assignment and no user-defined functions,
 * so a formula can only ever compute a number from the declared inputs.
 */
export const RD = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -60, toExpPos: 60 });
export const PI = RD.acos(-1);
export class ExpressionError extends Error {}

type BinOp = "+" | "-" | "*" | "/" | "<" | "<=" | ">" | ">=" | "==" | "!=";
export type Node =
  | { t: "num"; v: string }
  | { t: "id"; name: string }
  | { t: "neg"; arg: Node }
  | { t: "bin"; op: BinOp; l: Node; r: Node }
  | { t: "call"; fn: string; args: Node[] }
  | { t: "sum"; list: string; body: Node }
  | { t: "count"; list: string };
export type Scope = { values: Record<string, Decimal>; lists: Record<string, Record<string, Decimal>[]> };

const ARITY: Record<string, [number, number]> = {
  min: [2, 8], max: [2, 8], abs: [1, 1], sqrt: [1, 1], round: [2, 2], ceil: [1, 1], floor: [1, 1],
  if: [3, 3], and: [2, 8], or: [2, 8], not: [1, 1],
};
export const RESERVED_WORDS = new Set([...Object.keys(ARITY), "sum", "count", "PI", "pi"]);
const COMPARE = new Set(["<", "<=", ">", ">=", "==", "!="]);
const MAX_LENGTH = 600;
const MAX_NODES = 400;
const MAX_DEPTH = 32;
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

type Token = { k: "num" | "id" | "op" | "end"; v: string; at: number };

function tokenize(source: string): Token[] {
  if (source.length > MAX_LENGTH) throw new ExpressionError("عبارت محاسباتی بیش از حد طولانی است.");
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") { i++; continue; }
    const rest = source.slice(i);
    const number = /^\d+(?:\.\d+)?/.exec(rest);
    if (number) {
      if (number[0].length > 30) throw new ExpressionError("عدد ثابت بیش از حد طولانی است.");
      tokens.push({ k: "num", v: number[0], at: i }); i += number[0].length; continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (identifier) { tokens.push({ k: "id", v: identifier[0], at: i }); i += identifier[0].length; continue; }
    const operator = /^(?:<=|>=|==|!=|[-+*/(),<>])/.exec(rest);
    if (operator) { tokens.push({ k: "op", v: operator[0], at: i }); i += operator[0].length; continue; }
    throw new ExpressionError(`نویسه غیرمجاز «${char}» در موقعیت ${i + 1}.`);
  }
  tokens.push({ k: "end", v: "", at: source.length });
  return tokens;
}

export function parseExpression(source: string): Node {
  if (typeof source !== "string" || !source.trim()) throw new ExpressionError("عبارت محاسباتی خالی است.");
  const tokens = tokenize(source);
  let pos = 0;
  let nodes = 0;
  let depth = 0;
  let inSum = false;
  const peek = () => tokens[pos];
  const isOp = (value: string) => peek().k === "op" && peek().v === value;
  const expect = (value: string) => {
    if (!isOp(value)) throw new ExpressionError(`در موقعیت ${peek().at + 1} نماد «${value}» لازم است.`);
    pos++;
  };
  const node = <T extends Node>(value: T): T => {
    if (++nodes > MAX_NODES) throw new ExpressionError("عبارت محاسباتی بیش از حد پیچیده است.");
    return value;
  };
  const nested = <T>(run: () => T): T => {
    if (++depth > MAX_DEPTH) throw new ExpressionError("تودرتویی عبارت بیش از حد مجاز است.");
    try { return run(); } finally { depth--; }
  };

  function comparison(): Node {
    const left = additive();
    if (peek().k === "op" && COMPARE.has(peek().v)) {
      const op = tokens[pos++].v as BinOp;
      return node({ t: "bin", op, l: left, r: additive() });
    }
    return left;
  }
  function additive(): Node {
    let current = multiplicative();
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].v as BinOp;
      current = node({ t: "bin", op, l: current, r: multiplicative() });
    }
    return current;
  }
  function multiplicative(): Node {
    let current = unary();
    while (isOp("*") || isOp("/")) {
      const op = tokens[pos++].v as BinOp;
      current = node({ t: "bin", op, l: current, r: unary() });
    }
    return current;
  }
  function unary(): Node {
    if (!isOp("-")) return primary();
    return nested(() => { pos++; return node({ t: "neg", arg: unary() }); });
  }
  function primary(): Node {
    const token = tokens[pos++];
    if (token.k === "num") return node({ t: "num", v: token.v });
    if (token.k === "op" && token.v === "(") return nested(() => { const inner = comparison(); expect(")"); return inner; });
    if (token.k === "id") {
      if (!isOp("(")) {
        // "count" is only a function when followed by "("; as a bare name it is an ordinary input (e.g. repeat count).
        if (RESERVED_WORDS.has(token.v) && token.v !== "PI" && token.v !== "count") throw new ExpressionError(`«${token.v}» نام رزروشده است.`);
        return node({ t: "id", name: token.v });
      }
      pos++;
      return nested(() => {
        if (token.v === "sum" || token.v === "count") {
          const list = tokens[pos++];
          if (list.k !== "id" || RESERVED_WORDS.has(list.v)) throw new ExpressionError(`نام فهرست در ${token.v} معتبر نیست.`);
          if (token.v === "count") { expect(")"); return node({ t: "count", list: list.v }); }
          expect(",");
          if (inSum) throw new ExpressionError("استفاده تودرتو از sum مجاز نیست.");
          inSum = true;
          try { const body = comparison(); expect(")"); return node({ t: "sum", list: list.v, body }); } finally { inSum = false; }
        }
        const arity = own(ARITY, token.v) ? ARITY[token.v] : undefined;
        if (!arity) throw new ExpressionError(`تابع «${token.v}» مجاز نیست.`);
        const args: Node[] = [];
        if (!isOp(")")) {
          args.push(comparison());
          while (isOp(",")) { pos++; args.push(comparison()); }
        }
        expect(")");
        if (args.length < arity[0] || args.length > arity[1]) throw new ExpressionError(`تعداد ورودی تابع «${token.v}» درست نیست.`);
        if (token.v === "round") {
          const digits = args[1];
          if (digits.t !== "num" || !/^[0-8]$/.test(digits.v)) throw new ExpressionError("رقم اعشار round باید عدد ثابت ۰ تا ۸ باشد.");
        }
        return node({ t: "call", fn: token.v, args });
      });
    }
    throw new ExpressionError(token.k === "end" ? "عبارت محاسباتی ناقص است." : `نماد «${token.v}» در موقعیت ${token.at + 1} معتبر نیست.`);
  }

  const root = comparison();
  if (peek().k !== "end") throw new ExpressionError(`نماد اضافی «${peek().v}» در موقعیت ${peek().at + 1}.`);
  return root;
}

const LIMIT = new RD("1e30");
const bool = (value: boolean) => new RD(value ? 1 : 0);
const guard = (value: Decimal) => {
  if (!value.isFinite() || value.abs().gt(LIMIT)) throw new ExpressionError("نتیجه میانی خارج از محدوده مجاز است.");
  return value;
};

export function evaluate(root: Node, scope: Scope): Decimal {
  const run = (n: Node, local: Record<string, Decimal> | null): Decimal => {
    switch (n.t) {
      case "num": return new RD(n.v);
      case "id": {
        if (n.name === "PI") return PI;
        if (local && own(local, n.name)) return local[n.name];
        if (own(scope.values, n.name)) return scope.values[n.name];
        throw new ExpressionError(`مقدار «${n.name}» تعریف نشده است.`);
      }
      case "neg": return run(n.arg, local).neg();
      case "bin": {
        const a = run(n.l, local);
        const b = run(n.r, local);
        switch (n.op) {
          case "+": return guard(a.plus(b));
          case "-": return guard(a.minus(b));
          case "*": return guard(a.mul(b));
          case "/":
            if (b.isZero()) throw new ExpressionError("تقسیم بر صفر مجاز نیست.");
            return guard(a.div(b));
          case "<": return bool(a.lt(b));
          case "<=": return bool(a.lte(b));
          case ">": return bool(a.gt(b));
          case ">=": return bool(a.gte(b));
          case "==": return bool(a.eq(b));
          default: return bool(!a.eq(b));
        }
      }
      case "count":
        if (!own(scope.lists, n.list)) throw new ExpressionError(`فهرست «${n.list}» تعریف نشده است.`);
        return new RD(scope.lists[n.list].length);
      case "sum": {
        if (local) throw new ExpressionError("استفاده تودرتو از sum مجاز نیست.");
        if (!own(scope.lists, n.list)) throw new ExpressionError(`فهرست «${n.list}» تعریف نشده است.`);
        return scope.lists[n.list].reduce((total, item) => guard(total.plus(run(n.body, item))), new RD(0));
      }
      case "call": {
        if (n.fn === "if") return run(n.args[0], local).isZero() ? run(n.args[2], local) : run(n.args[1], local);
        const v = n.args.map((arg) => run(arg, local));
        switch (n.fn) {
          case "min": return RD.min(...v);
          case "max": return RD.max(...v);
          case "abs": return v[0].abs();
          case "sqrt":
            if (v[0].isNegative()) throw new ExpressionError("جذر عدد منفی تعریف نشده است.");
            return v[0].sqrt();
          case "round": return v[0].toDecimalPlaces(v[1].toNumber(), RD.ROUND_HALF_UP);
          case "ceil": return v[0].ceil();
          case "floor": return v[0].floor();
          case "and": return bool(v.every((x) => !x.isZero()));
          case "or": return bool(v.some((x) => !x.isZero()));
          case "not": return bool(v[0].isZero());
          default: throw new ExpressionError(`تابع «${n.fn}» مجاز نیست.`);
        }
      }
    }
  };
  return run(root, null);
}

export function plainNumber(value: Decimal, places = 8): string {
  const text = value.toDecimalPlaces(places, RD.ROUND_HALF_UP).toFixed();
  return text === "-0" ? "0" : text;
}

const PRECEDENCE: Record<BinOp, number> = { "<": 1, "<=": 1, ">": 1, ">=": 1, "==": 1, "!=": 1, "+": 2, "-": 2, "*": 3, "/": 3 };
const SYMBOLS: Record<string, string> = { "*": "×", "/": "÷", "-": "−", "<=": "≤", ">=": "≥", "!=": "≠", "==": "=" };
const EXCEL_OPERATORS: Record<string, string> = { "==": "=", "!=": "<>" };
const EXCEL_FUNCTIONS: Record<string, string> = { min: "MIN", max: "MAX", abs: "ABS", sqrt: "SQRT", round: "ROUND", if: "IF", and: "AND", or: "OR", not: "NOT" };

/**
 * source: the formula as written (identifiers kept).
 * values: identifiers replaced by their numbers, sums expanded term by term (human-readable trace).
 * excel:  the same expansion in Excel syntax with full-precision literals.
 */
export function formatExpression(root: Node, mode: "source" | "values" | "excel", scope?: Scope): string {
  const excel = mode === "excel";
  const listOf = (name: string) => {
    if (!scope || !own(scope.lists, name)) throw new ExpressionError(`فهرست «${name}» تعریف نشده است.`);
    return scope.lists[name];
  };
  const valueOf = (name: string, local: Record<string, Decimal> | null) => {
    const value = local && own(local, name) ? local[name] : scope && own(scope.values, name) ? scope.values[name] : undefined;
    if (!value) throw new ExpressionError(`مقدار «${name}» تعریف نشده است.`);
    const text = excel ? value.toFixed() : plainNumber(value);
    return value.isNegative() ? `(${text})` : text;
  };
  const fmt = (n: Node, parent: number, local: Record<string, Decimal> | null): string => {
    switch (n.t) {
      case "num": return n.v;
      case "id":
        if (n.name === "PI") return excel ? "PI()" : "π";
        return mode === "source" ? n.name : valueOf(n.name, local);
      case "neg": {
        const text = `${excel ? "-" : "−"}${fmt(n.arg, 4, local)}`;
        return parent > 3 ? `(${text})` : text;
      }
      case "bin": {
        const p = PRECEDENCE[n.op];
        const left = fmt(n.l, p === 1 ? 2 : p, local);
        const right = fmt(n.r, p + 1, local);
        const text = excel ? `${left}${EXCEL_OPERATORS[n.op] ?? n.op}${right}` : `${left} ${SYMBOLS[n.op] ?? n.op} ${right}`;
        return p < parent ? `(${text})` : text;
      }
      case "count": return mode === "source" ? `count(${n.list})` : String(listOf(n.list).length);
      case "sum": {
        if (mode === "source") return `Σ ${n.list} [ ${fmt(n.body, 0, null)} ]`;
        const items = listOf(n.list);
        if (!items.length) return "0";
        if (items.length === 1) return fmt(n.body, parent, items[0]);
        const text = items.map((item) => fmt(n.body, 2, item)).join(excel ? "+" : " + ");
        return parent > 2 ? `(${text})` : text;
      }
      case "call": {
        const args = n.args.map((arg) => fmt(arg, 0, local));
        if (!excel) return `${n.fn}(${args.join(", ")})`;
        if (n.fn === "ceil") return `(-INT(-(${args[0]})))`;
        if (n.fn === "floor") return `INT(${args[0]})`;
        return `${EXCEL_FUNCTIONS[n.fn]}(${args.join(",")})`;
      }
    }
  };
  return fmt(root, 0, null);
}

/** Replaces references to earlier steps by their expressions so one self-contained formula can be shown and exported. */
export function inlineSteps(root: Node, definitions: Record<string, Node>, limit = 2500): Node {
  let count = 0;
  const walk = (n: Node, insideSum: boolean): Node => {
    if (++count > limit) throw new ExpressionError("عبارت ترکیبی بیش از حد بزرگ است.");
    switch (n.t) {
      case "num":
      case "count": return n;
      case "id": return own(definitions, n.name) ? walk(definitions[n.name], insideSum) : n;
      case "neg": return { t: "neg", arg: walk(n.arg, insideSum) };
      case "bin": return { t: "bin", op: n.op, l: walk(n.l, insideSum), r: walk(n.r, insideSum) };
      case "call": return { t: "call", fn: n.fn, args: n.args.map((arg) => walk(arg, insideSum)) };
      case "sum":
        if (insideSum) throw new ExpressionError("ترکیب مراحل به sum تودرتو منجر می‌شود.");
        return { t: "sum", list: n.list, body: walk(n.body, true) };
    }
  };
  return walk(root, false);
}

/** Static analysis used when a rule definition is validated: which names and lists does an expression read? */
export function references(root: Node): { outer: Set<string>; inner: { list: string; names: Set<string> }[]; lists: Set<string> } {
  const outer = new Set<string>();
  const lists = new Set<string>();
  const inner: { list: string; names: Set<string> }[] = [];
  const walk = (n: Node, bucket: Set<string>) => {
    switch (n.t) {
      case "num": return;
      case "id": if (n.name !== "PI") bucket.add(n.name); return;
      case "neg": walk(n.arg, bucket); return;
      case "bin": walk(n.l, bucket); walk(n.r, bucket); return;
      case "call": n.args.forEach((arg) => walk(arg, bucket)); return;
      case "count": lists.add(n.list); return;
      case "sum": {
        lists.add(n.list);
        const names = new Set<string>();
        inner.push({ list: n.list, names });
        walk(n.body, names);
      }
    }
  };
  walk(root, outer);
  return { outer, inner, lists };
}
