import assert from "node:assert/strict";
import test from "node:test";
import { evaluate, ExpressionError, formatExpression, inlineSteps, parseExpression, RD, references, type Scope } from "./expression";

const scope = (values: Record<string, string> = {}, lists: Record<string, Record<string, string>[]> = {}): Scope => ({
  values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, new RD(value)])),
  lists: Object.fromEntries(Object.entries(lists).map(([key, items]) =>
    [key, items.map((item) => Object.fromEntries(Object.entries(item).map(([field, value]) => [field, new RD(value)])))])),
});
const calc = (source: string, s: Scope = scope()) => evaluate(parseExpression(source), s).toFixed();
const openings = { items: [{ w: "1.2", h: "2.1", n: "2" }, { w: "0.9", h: "2.1", n: "1" }] };

test("arithmetic follows precedence and is exact in decimal", () => {
  assert.equal(calc("2 + 3 * 4"), "14");
  assert.equal(calc("(2 + 3) * 4"), "20");
  assert.equal(calc("10 / 4"), "2.5");
  assert.equal(calc("10 - 4 - 3"), "3");
  assert.equal(calc("100 / 10 / 5"), "2");
  assert.equal(calc("-3 + 5"), "2");
  assert.equal(calc("2 * -3"), "-6");
  assert.equal(calc("0.1 + 0.2"), "0.3");
  assert.equal(calc("1.1 * 1.1"), "1.21");
});

test("whitelisted functions, comparisons and lazy conditionals", () => {
  assert.equal(calc("min(3, 1, 2)"), "1");
  assert.equal(calc("max(3, 1, 2)"), "3");
  assert.equal(calc("abs(0 - 2.5)"), "2.5");
  assert.equal(calc("sqrt(2.25)"), "1.5");
  assert.equal(calc("round(2.345, 2)"), "2.35");
  assert.equal(calc("round(2.344, 2)"), "2.34");
  assert.equal(calc("ceil(2.1)"), "3");
  assert.equal(calc("floor(2.9)"), "2");
  assert.equal(calc("if(1 < 2, 10, 20)"), "10");
  assert.equal(calc("if(0, 10, 20)"), "20");
  assert.equal(calc("if(1, 5, 1 / 0)"), "5");
  assert.equal(calc("and(1, 0)"), "0");
  assert.equal(calc("or(1, 0)"), "1");
  assert.equal(calc("not(0)"), "1");
  assert.equal(calc("3 <= 3"), "1");
  assert.equal(calc("3 != 3"), "0");
  assert.equal(calc("2 == 2"), "1");
  assert.equal(calc("PI * 2").slice(0, 12), "6.2831853071");
});

test("sum and count iterate over list rows with access to outer values", () => {
  assert.equal(calc("sum(items, w * h * n)", scope({}, openings)), "6.93");
  assert.equal(calc("count(items)", scope({}, openings)), "2");
  assert.equal(calc("sum(items, w * k)", scope({ k: "2" }, openings)), "4.2");
  assert.equal(calc("sum(items, w)", scope({}, { items: [] })), "0");
  assert.equal(calc("sum(items, if(w * h < 2, 0, w * h) * n)", scope({}, openings)), "5.04");
});

test("anything outside the grammar is rejected before evaluation", () => {
  const rejected = [
    "a.b", "a[0]", "x => x", "1; 2", "`x`", "eval(1)", "process.exit()", "require('fs')", "a = 1", "2 ** 3", "1 +", "(1",
    "sum(items, sum(items, w))", "round(1.5, x)", "min(1)", "", "__proto__()", "1e5", "0x10", "a ? b : c", "new Date()",
    "constructor(1)", "a b", "1,2", "sum(1, 2)", "\"text\"", "a && b", "a || b", "!a", "a % 2",
  ];
  for (const source of rejected) assert.throws(() => parseExpression(source), ExpressionError, `should reject: ${source}`);
  assert.throws(() => parseExpression(`${"1+".repeat(400)}1`), /طولانی/);
  assert.throws(() => parseExpression(`${"(".repeat(40)}1${")".repeat(40)}`), /تودرتویی/);
  assert.throws(() => parseExpression(`1${"+1".repeat(250)}`), /پیچیده/);
});

test("prototype names never resolve and numeric faults are reported", () => {
  for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty", "this", "globalThis", "process"]) {
    assert.throws(() => evaluate(parseExpression(name), scope()), /تعریف نشده/, name);
  }
  assert.throws(() => calc("1 / 0"), /تقسیم بر صفر/);
  assert.throws(() => calc("sqrt(0 - 1)"), /جذر/);
  assert.throws(() => calc("sum(missing, 1)"), /فهرست/);
  assert.throws(() => calc("a * a * a", scope({ a: "100000000000000" })), /محدوده/);
});

test("expressions render as source, as substituted values and as Excel formulas", () => {
  const values = scope({ a: "2", b: "1.5", c: "0.5", d: "3", total: "10", n: "2", x: "0.04" }, openings);
  const expression = parseExpression("a * (b + c) - d / 2");
  assert.equal(formatExpression(expression, "source"), "a × (b + c) − d ÷ 2");
  assert.equal(formatExpression(expression, "values", values), "2 × (1.5 + 0.5) − 3 ÷ 2");
  assert.equal(formatExpression(expression, "excel", values), "2*(1.5+0.5)-3/2");
  assert.equal(formatExpression(parseExpression("a - (b - c)"), "source"), "a − (b − c)");
  assert.equal(formatExpression(parseExpression("a - b - c"), "source"), "a − b − c");
  const withSum = parseExpression("total - sum(items, w * h * n)");
  assert.equal(formatExpression(withSum, "source"), "total − Σ items [ w × h × n ]");
  assert.equal(formatExpression(withSum, "values", values), "10 − (1.2 × 2.1 × 2 + 0.9 × 2.1 × 1)");
  assert.equal(formatExpression(withSum, "excel", values), "10-(1.2*2.1*2+0.9*2.1*1)");
  assert.equal(formatExpression(parseExpression("if(x <= 0.05, 0, x) * n"), "excel", values), "IF(0.04<=0.05,0,0.04)*2");
  assert.equal(formatExpression(parseExpression("PI * a * a / 4"), "source"), "π × a × a ÷ 4");
  assert.equal(formatExpression(parseExpression("PI * a * a / 4"), "excel", values), "PI()*2*2/4");
  assert.equal(formatExpression(parseExpression("neg * 3"), "values", scope({ neg: "-2" })), "(-2) × 3");
  assert.equal(formatExpression(parseExpression("ceil(a) + floor(b)"), "excel", values), "(-INT(-(2)))+INT(1.5)");
  assert.equal(formatExpression(parseExpression("if(a == 2, 1, 0) + if(a != 2, 1, 0)"), "excel", values), "IF(2=2,1,0)+IF(2<>2,1,0)");
});

test("steps can be inlined into one self-contained formula; static references are reported", () => {
  const definitions = { gross: parseExpression("l * w"), holes: parseExpression("sum(items, w * h)") };
  assert.equal(formatExpression(inlineSteps(parseExpression("gross - holes"), definitions), "source"), "l × w − Σ items [ w × h ]");
  assert.throws(() => inlineSteps(parseExpression("sum(items, holes)"), definitions), /تودرتو/);
  const refs = references(parseExpression("a + sum(items, w * b) + count(items) + PI"));
  assert.deepEqual([...refs.outer], ["a"]);
  assert.deepEqual([...refs.lists], ["items"]);
  assert.deepEqual([...refs.inner[0].names].sort(), ["b", "w"]);
});
