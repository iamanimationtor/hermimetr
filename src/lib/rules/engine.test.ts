import assert from "node:assert/strict";
import test from "node:test";
import { RULE_OPERATIONS, SYSTEM_RULES, systemRuleRef } from "./catalog";
import { canonicalInputs, compileRule, evaluateRule, RuleError, ruleUsability, stableStringify, type RuleDefinition } from "./engine";
import { REFERENCE_CASES } from "./reference-cases";

const rule = (ref: string): RuleDefinition => {
  const found = SYSTEM_RULES.find((def) => systemRuleRef(def) === ref);
  assert(found, `missing rule ${ref}`);
  return found;
};

/* ── Independent exact arithmetic (BigInt rationals). Deliberately shares no code with the rule engine. ── */
type Q = { n: bigint; d: bigint };
const q = (text: string): Q => {
  const [whole, fraction = ""] = text.split(".");
  return { n: BigInt(whole + fraction), d: BigInt(`1${"0".repeat(fraction.length)}`) };
};
const mul = (...xs: Q[]): Q => xs.reduce((a, b) => ({ n: a.n * b.n, d: a.d * b.d }));
const add = (...xs: Q[]): Q => xs.reduce((a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d }));
const sub = (a: Q, b: Q): Q => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const div = (a: Q, b: Q): Q => ({ n: a.n * b.d, d: a.d * b.n });
const lte = (a: Q, b: Q) => a.n * b.d <= b.n * a.d;
const lt = (a: Q, b: Q) => a.n * b.d < b.n * a.d;
/** Half-up rounding of a non-negative rational to four decimals: floor(x·10⁴ + ½). */
const round4 = (x: Q): string => {
  const scaled = (x.n * BigInt(20000) + x.d) / (x.d * BigInt(2));
  const text = scaled.toString().padStart(5, "0");
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
};
const PI_Q = q("3.1415926535897932384626433832795028841971");
const barMass = (mm: string) => mul(div(mul(PI_Q, div(q(mm), q("1000")), div(q(mm), q("1000"))), q("4")), q("7850"));

const INDEPENDENT: Record<string, () => Q> = {
  "RC-C1": () => sub(mul(q("12.5"), q("8.2"), q("0.6")), mul(q("0.4"), q("0.4"), q("0.6"), q("2"))),
  "RC-C2": () => mul(q("2.4"), q("2.4"), q("0.55"), q("6")),
  "RC-C3": () => mul(div(mul(PI_Q, q("0.8"), q("0.8")), q("4")), q("12"), q("4")),
  "RC-C4": () => mul(sub(mul(q("10"), q("6.5")), add(mul(q("1.2"), q("2.4")), mul(q("0.6"), q("0.6"), q("2")))), q("0.2")),
  "RC-F1": () => mul(q("2"), add(q("2.4"), q("1.8")), q("0.6"), q("5")),
  "RC-F2": () => mul(q("2"), add(q("0.45"), q("0.5")), q("3.2"), q("12")),
  "RC-F3": () => mul(add(q("0.4"), mul(q("2"), sub(q("0.6"), q("0.2")))), q("5.6"), q("3")),
  "RC-F4": () => mul(sub(mul(q("8"), q("3")), mul(q("1"), q("2.1"))), q("2")),
  "RC-R1": () => add(mul(q("6.4"), q("24"), q("1.58")), mul(q("1.85"), q("60"), q("0.617"))),
  "RC-R2": () => add(mul(barMass("16"), q("12"), q("10")), mul(barMass("10"), q("2.5"), q("40"))),
  "RC-E1": () => mul(q("18"), q("12"), q("3.2")),
  // Closed form D·[L·W + m·D·(L+W) + 4/3·m²·D²]: a different derivation from the prismoidal formula in the rule.
  "RC-E2": () => mul(q("3"), add(mul(q("10"), q("6")), mul(q("0.5"), q("3"), add(q("10"), q("6"))), mul(div(q("4"), q("3")), q("0.5"), q("0.5"), q("3"), q("3")))),
  "RC-E3": () => mul(div(add(q("0.8"), q("1.6")), q("2")), q("1.5"), q("42")),
  "RC-M1": () => sub(mul(q("7.35"), q("2.9"), q("2")), add(mul(q("0.9"), q("2.1"), q("2")), mul(q("1.5"), q("1.2")))),
  "RC-M2": () => mul(sub(mul(q("5.2"), q("3")), mul(q("1"), q("2.2"))), q("0.22")),
  "RC-D1": () => [["0.4", "0.5", "0.2", "2"], ["1", "1.1", "0.2", "1"], ["0.5", "0.5", "0.2", "1"]].reduce((left, [l, w, h, n]) => {
    const one = mul(q(l), q(w), q(h));
    return lte(one, q("0.05")) ? left : sub(left, mul(one, q(n)));
  }, mul(q("6"), q("5"), q("0.2"))),
  "RC-D2": () => mul(q("8"), q("3"), q("2")),
  "RC-D3": () => [["0.2", "0.2", "3"], ["0.25", "0.2", "1"], ["1.2", "1.5", "1"]].reduce((left, [w, h, n]) => {
    const one = mul(q(w), q(h));
    return lt(one, q("0.05")) ? left : sub(left, mul(one, q(n)));
  }, mul(q("4"), q("3"))),
  "RC-PL1": () => sub(mul(q("5.2"), q("2.9"), q("2")), add(mul(q("0.9"), q("2.1"), q("2")), mul(q("1.5"), q("1.2")))),
  "RC-PL2": () => sub(mul(q("6.4"), q("3.8")), add(mul(q("0.6"), q("0.6"), q("2")), mul(q("1.2"), q("1.2")))),
  "RC-PL3": () => mul(sub(mul(q("10"), q("3")), mul(q("1"), q("2"))), q("0.02")),
  "RC-FL1": () => mul(q("12.5"), q("8.4"), q("0.07"), q("1")),
  "RC-FL2": () => sub(mul(q("9.6"), q("5.4")), mul(q("0.8"), q("0.8"), q("3"))),
  "RC-FL3": () => sub(mul(q("2"), add(q("4.8"), q("3.6")), q("3")), mul(q("0.9"), q("2"))),
  "RC-IN1": () => add(mul(q("8"), q("5")), mul(q("26"), q("0.3"))),
  "RC-IN2": () => add(mul(q("12"), q("3"), q("1")), mul(q("6.5"), q("3"), q("2"))),
  "RC-ST1": () => add(mul(q("4.2"), q("6"), q("42.6")), mul(q("2.8"), q("14"), q("24.2"))),
  "RC-ST2": () => mul(q("2"), q("1"), div(q("10"), q("1000")), q("1"), q("7850")),
  "RC-ST3": () => mul(q("1.24"), q("6"), q("10")),
  "RC-ST4": () => mul(add(mul(q("0.3"), q("0.25"), div(q("12"), q("1000")), q("8")), mul(q("0.2"), q("0.15"), div(q("8"), q("1000")), q("4"))), q("7850")),
};

/** Evaluates an exported Excel formula with plain double arithmetic (test-only; the string is generated by the engine). */
function evalExcel(formula: string): number {
  const js = formula.replace(/PI\(\)/g, "Math.PI").replace(/ROUND\(/g, "R(").replace(/IF\(/g, "IFF(").replace(/([^<>!=])=([^=])/g, "$1==$2");
  const R = (x: number, n: number) => Number(`${Math.round(Number(`${x}e${n}`))}e-${n}`);
  const IFF = (condition: unknown, a: number, b: number) => (condition ? a : b);
  return new Function("R", "IFF", `"use strict"; return (${js});`)(R, IFF) as number;
}

const custom = (overrides: Partial<RuleDefinition> = {}): RuleDefinition => ({
  key: "test.rounding", version: 1, title: "قاعده آزمایشی", operation: "آزمون", discipline: "آزمون", outputKind: "length", unit: "متر",
  basis: "geometric",
  parameters: [{ key: "a", label: "الف", unit: "متر", kind: "decimal", scale: 4 }, { key: "b", label: "ب", unit: "متر", kind: "decimal", scale: 4 }],
  steps: [{ key: "out", label: "خروجی", expression: "a * b" }], result: "out", rounding: { scale: 4, mode: "half_up" },
  measurementRule: "فقط برای آزمون", additions: "", deductions: "", exceptions: "", scope: "", citations: [],
  validFrom: null, validTo: null, sourceStatus: "not_applicable", ...overrides,
});

test("every system rule compiles, is uniquely versioned and has a reference case", () => {
  const refs = new Set<string>();
  for (const def of SYSTEM_RULES) {
    assert.doesNotThrow(() => compileRule(def), def.key);
    const ref = systemRuleRef(def);
    assert(!refs.has(ref), `duplicate ${ref}`);
    refs.add(ref);
    assert(REFERENCE_CASES.some((item) => item.ruleRef === ref), `no reference case for ${ref}`);
    if (def.basis === "regulatory") {
      assert.equal(def.sourceStatus, "unverified", `${ref} must not claim a verified source`);
      assert(def.citations.length > 0 && def.citations.every((citation) => citation.clause && citation.page));
    } else assert.equal(def.sourceStatus, "not_applicable");
  }
  for (const operation of RULE_OPERATIONS) {
    assert(SYSTEM_RULES.some((def) => def.operation === operation), operation);
  }
});

test("reference cases: engine = hand calculation = independent exact arithmetic", () => {
  for (const item of REFERENCE_CASES) {
    const result = evaluateRule(rule(item.ruleRef), item.input);
    assert.equal(result.quantity, item.expected, `${item.id}: engine vs hand calculation`);
    assert(INDEPENDENT[item.id], `${item.id}: independent calculation missing`);
    assert.equal(round4(INDEPENDENT[item.id]()), item.expected, `${item.id}: independent vs hand calculation`);
    assert.equal(result.unit, item.unit, `${item.id}: unit`);
  }
  assert.equal(Object.keys(INDEPENDENT).length, REFERENCE_CASES.length);
});

test("exported Excel formulas recompute to the stored quantity", () => {
  for (const item of REFERENCE_CASES) {
    const result = evaluateRule(rule(item.ruleRef), item.input);
    assert(result.excelFormula, `${item.id}: no Excel formula`);
    assert(Math.abs(evalExcel(result.excelFormula) - Number(result.quantity)) < 1e-9, `${item.id}: ${result.excelFormula}`);
  }
});

test("every result carries its trace, formula and normalised inputs", () => {
  const result = evaluateRule(rule("sys:concrete.prism@1"), REFERENCE_CASES[0].input);
  assert.deepEqual(result.trace.map((step) => [step.key, step.value]), [["gross", "61.5"], ["void_volume", "0.192"], ["net", "61.308"]]);
  assert.equal(result.trace[0].expression, "length × width × height × count");
  assert.equal(result.trace[0].substituted, "12.5 × 8.2 × 0.6 × 1");
  assert.equal(result.trace[2].substituted, "61.5 − 0.192");
  assert.equal(result.formula, "12.5 × 8.2 × 0.6 × 1 − 0.4 × 0.4 × 0.6 × 2");
  assert.equal(result.excelFormula, "ROUND(12.5*8.2*0.6*1-0.4*0.4*0.6*2,4)");
  assert.deepEqual(result.inputs.values, { length: "12.5", width: "8.2", height: "0.6", count: "1" });
  assert.equal(result.unrounded, "61.308");
});

test("inputs are validated strictly; Persian digits and defaults are accepted", () => {
  const prism = rule("sys:concrete.prism@1");
  const values = { length: "۱۲٫۵", width: "8.2", height: "0.6", count: "۱" };
  assert.equal(evaluateRule(prism, { values, lists: { voids: [] } }).quantity, "61.5000");
  assert.equal(evaluateRule(prism, { values: { length: "2", width: "2", height: "2" } }).quantity, "8.0000");
  assert.throws(() => evaluateRule(prism, { values: { ...values, length: "-1" } }), RuleError);
  assert.throws(() => evaluateRule(prism, { values: { ...values, length: "abc" } }), /عدد نامنفی/);
  assert.throws(() => evaluateRule(prism, { values: { ...values, length: "1e3" } }), /عدد نامنفی/);
  assert.throws(() => evaluateRule(prism, { values: { ...values, length: "0" } }), /بزرگ‌تر از/);
  assert.throws(() => evaluateRule(prism, { values: { ...values, length: "1.23456" } }), /رقم اعشار/);
  assert.throws(() => evaluateRule(prism, { values: { ...values, length: 0.1 + 0.2 } }), /رقم اعشار/);
  assert.throws(() => evaluateRule(prism, { values: { ...values, count: "1.5" } }), /صحیح/);
  assert.throws(() => evaluateRule(prism, { values: { ...values, extra: "1" } }), /ناشناخته/);
  assert.throws(() => evaluateRule(prism, { values: { width: "1", height: "1" } }), /الزامی/);
  assert.throws(() => evaluateRule(prism, { values, lists: { voids: [{ v_length: "1" }] } }), /الزامی/);
  assert.throws(() => evaluateRule(prism, { values, lists: { other: [] } }), /ناشناخته/);
  assert.throws(() => evaluateRule(prism, { values, lists: { voids: "x" } }), /فهرستی/);
  assert.throws(() => evaluateRule(prism, { values: { ...values, length: "999999999999999" } }), /حد مجاز/);
});

test("constraints, exception conditions and threshold boundaries", () => {
  assert.throws(() => evaluateRule(rule("sys:concrete.prism@1"), { values: { length: "1", width: "1", height: "1" }, lists: { voids: [{ v_length: "2", v_width: "1", v_height: "1" }] } }), /فضاهای خالی/);
  assert.throws(() => evaluateRule(rule("sys:formwork.beam_drop@1"), { values: { beam_width: "0.4", beam_depth: "0.5", slab_thickness: "0.5", length: "3" } }), /ضخامت دال/);
  assert.throws(() => evaluateRule(rule("sys:earthwork.trench_trapezoid@1"), { values: { bottom_width: "2", top_width: "1", depth: "1", length: "1" } }), /عرض بالا/);
  assert.throws(() => evaluateRule(rule("sys:rebar.mass_from_unit_mass@1"), { lists: { bars: [] } }), /دست‌کم/);
  assert.throws(() => evaluateRule(rule("sys:formwork.wall_faces@1"), { values: { length: "2", height: "2", faces: "3" } }), /حد مجاز/);
  assert.throws(() => evaluateRule(rule("sys:rebar.mass_theoretical@1"), { lists: { bars: [{ diameter_mm: "16", bar_length: "1" }] } }), /چگالی/);
  // A vertical pit (slope 0) must reduce to the box formula.
  assert.equal(evaluateRule(rule("sys:earthwork.prismoid_pit@1"), { values: { bottom_length: "18", bottom_width: "12", depth: "3.2", slope: "0" } }).quantity, "691.2000");
  // Draft threshold "0.05 m³ or less is not deducted": the boundary itself is not deducted, just above it is.
  const draft = rule("sys:concrete.prism@2");
  const withVoid = (height: string) => evaluateRule(draft, { values: { length: "2", width: "2", height: "1" }, lists: { voids: [{ v_length: "0.5", v_width: "0.5", v_height: height }] } }).quantity;
  assert.equal(withVoid("0.2"), "4.0000");
  assert.equal(withVoid("0.2004"), "3.9499");
  // Execution condition changes the deduction (continuous formwork at openings).
  const wall = rule("sys:formwork.wall_faces@2");
  const wallInput = (continuous: string) => ({ values: { length: "8", height: "3", faces: "2", count: "1", continuous }, lists: { openings: [{ o_width: "1", o_height: "2.1" }] } });
  assert.equal(evaluateRule(wall, wallInput("0")).quantity, "43.8000");
  assert.equal(evaluateRule(wall, wallInput("1")).quantity, "48.0000");
  assert.throws(() => evaluateRule(wall, wallInput("2")), /حد مجاز/);
});

test("rounding is half-up at the declared scale and independent of display", () => {
  const run = (a: string, b: string, scale = 4) => evaluateRule(custom({ rounding: { scale, mode: "half_up" } }), { values: { a, b } });
  assert.equal(run("1.0001", "0.5").quantity, "0.5001");
  assert.equal(run("1.0001", "0.5").unrounded, "0.50005");
  assert.equal(run("1.0001", "1.5").quantity, "1.5002");
  assert.equal(run("0.3333", "0.3333").quantity, "0.1111");
  assert.equal(run("1.5", "1.63", 2).quantity, "2.4500");
  assert.equal(run("2.5", "1", 0).quantity, "3.0000");
  assert.equal(run("0.1", "0.2").quantity, "0.0200");
  assert.match(evaluateRule(custom(), { values: { a: "0", b: "5" } }).warnings.join(" "), /صفر/);
});

test("unit conversion inside a rule (mm → m) reproduces nominal mass per metre", () => {
  const perMetre = (diameter: string) => evaluateRule(rule("sys:rebar.mass_theoretical@1"),
    { values: { density: "7850" }, lists: { bars: [{ diameter_mm: diameter, bar_length: "1", bar_count: "1" }] } }).quantity;
  assert.equal(perMetre("10"), "0.6165");
  assert.equal(perMetre("12"), "0.8878");
  assert.equal(perMetre("16"), "1.5783");
  assert.equal(perMetre("20"), "2.4662");
});

test("usability gates: unverified or unapproved regulatory rules never become definitive", () => {
  const geometric = rule("sys:concrete.prism@1");
  const regulatory = rule("sys:concrete.prism@2");
  assert.equal(ruleUsability(geometric).certainty, "geometric");
  assert.equal(ruleUsability(geometric, { expertRejected: true }).certainty, "blocked");
  assert.equal(ruleUsability(regulatory).certainty, "provisional");
  assert.equal(ruleUsability(regulatory, { sourceVerified: true }).certainty, "provisional");
  assert.equal(ruleUsability(regulatory, { expertApproved: true }).certainty, "provisional");
  const ready = { sourceVerified: true, expertApproved: true };
  assert.equal(ruleUsability(regulatory, ready).certainty, "definitive");
  assert.equal(ruleUsability(regulatory, { ...ready, lifecycle: "retired" }).certainty, "blocked");
  assert.equal(ruleUsability(regulatory, { ...ready, expertRejected: true }).certainty, "blocked");
  assert.equal(ruleUsability(regulatory, { ...ready, onDate: "1403/12/29" }).certainty, "blocked");
  assert.equal(ruleUsability(regulatory, { ...ready, onDate: "1404/06/01" }).certainty, "definitive");
  assert.equal(ruleUsability(regulatory, { ...ready, requireDate: true }).certainty, "provisional");
  assert.equal(ruleUsability({ ...regulatory, validTo: "1404/12/29" }, { ...ready, onDate: "1405/01/01" }).certainty, "blocked");
});

test("versions of one rule stay separate, hashable and reproducible", () => {
  const input = REFERENCE_CASES.find((item) => item.id === "RC-D1")!.input;
  const v1 = evaluateRule(rule("sys:concrete.prism@1"), input);
  const v2 = evaluateRule(rule("sys:concrete.prism@2"), input);
  assert.equal(v1.quantity, "5.6500");
  assert.equal(v2.quantity, "5.7800");
  assert.equal(v1.ruleVersion, 1);
  assert.equal(v2.ruleVersion, 2);
  assert.notEqual(stableStringify(rule("sys:concrete.prism@1")), stableStringify(rule("sys:concrete.prism@2")));
  assert.equal(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] }), stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  // Historic compatibility: re-running the stored normalised inputs gives the identical result and trace.
  assert.deepEqual(evaluateRule(rule("sys:concrete.prism@2"), v2.inputs), v2);
});

test("canonical inputs detect duplicates regardless of row order and number formatting", () => {
  const def = rule("sys:masonry.wall_area_net@1");
  const first = evaluateRule(def, { values: { length: "7.35", height: "2.90", count: "2" }, lists: { openings: [{ o_width: "0.9", o_height: "2.1", o_count: "2" }, { o_width: "1.5", o_height: "1.2", o_count: "1" }] } });
  const same = evaluateRule(def, { values: { length: "۷٫۳۵", height: "2.9", count: 2 }, lists: { openings: [{ o_width: "1.50", o_height: "1.2" }, { o_width: "0.9", o_height: "2.1", o_count: "2" }] } });
  const other = evaluateRule(def, { values: { length: "7.35", height: "2.9", count: "2" }, lists: { openings: [{ o_width: "0.9", o_height: "2.1", o_count: "1" }, { o_width: "1.5", o_height: "1.2", o_count: "1" }] } });
  assert.equal(canonicalInputs(first.inputs), canonicalInputs(same.inputs));
  assert.notEqual(canonicalInputs(first.inputs), canonicalInputs(other.inputs));
});

test("invalid or unsafe rule definitions are rejected at compile time", () => {
  const bad = (overrides: Partial<RuleDefinition>, pattern: RegExp) => assert.throws(() => compileRule(custom(overrides)), pattern);
  const parameter = { key: "a", label: "الف", unit: "متر", kind: "decimal" as const };
  bad({ steps: [{ key: "out", label: "x", expression: "a * c" }] }, /تعریف نشده/);
  bad({ steps: [{ key: "out", label: "x", expression: "a.constructor" }] }, /غیرمجاز/);
  bad({ steps: [{ key: "out", label: "x", expression: "eval(a)" }] }, /مجاز نیست/);
  bad({ steps: [{ key: "first", label: "x", expression: "second + a" }, { key: "second", label: "y", expression: "a" }], result: "second" }, /پیش از تعریف/);
  bad({ steps: [{ key: "out", label: "x", expression: "sum(rows, a)" }] }, /فهرست/);
  bad({ result: "missing" }, /نتیجه/);
  bad({ parameters: [{ ...parameter, key: "constructor" }], steps: [{ key: "out", label: "x", expression: "1" }] }, /مجاز نیست/);
  bad({ parameters: [{ ...parameter, key: "sum" }], steps: [{ key: "out", label: "x", expression: "1" }] }, /مجاز نیست/);
  bad({ parameters: [parameter, parameter] }, /تکراری/);
  bad({ unit: "مترمربع" }, /واحد خروجی/);
  bad({ rounding: { scale: 9, mode: "half_up" } }, /گرد کردن/);
  bad({ basis: "regulatory", sourceStatus: "unverified" }, /استناد/);
  bad({ validFrom: "1404-01-01" }, /تاریخ اعتبار/);
  bad({ validFrom: "1404/02/01", validTo: "1404/01/01" }, /پایان اعتبار/);
  bad({ key: "Bad Key" }, /شناسه/);
  bad({ version: 0 }, /نسخه/);
  assert.doesNotThrow(() => compileRule(custom({ basis: "regulatory", sourceStatus: "unverified", citations: [{ documentTitle: "سند آزمایشی", clause: "بند ۱", page: "۱۲" }] })));
});
