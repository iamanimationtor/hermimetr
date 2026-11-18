import type Decimal from "decimal.js";
import { measurementUnits, normalizeDigits, type MeasurementKind } from "../calculations";
import {
  evaluate, ExpressionError, formatExpression, inlineSteps, parseExpression, plainNumber, RD, references, RESERVED_WORDS,
  type Node, type Scope,
} from "./expression";

/**
 * Measurement rule engine.
 * Pure TypeScript: no database, HTTP or React imports, so the same code runs in the API, in tests and in the browser preview.
 */

export class RuleError extends Error {
  constructor(message: string, public kind: "definition" | "input" | "calculation" = "input") { super(message); }
}

export type RuleParameter = {
  key: string; label: string; unit: string; kind: "decimal" | "integer";
  min?: string; max?: string; exclusiveMin?: boolean; scale?: number; default?: string; help?: string;
};
export type RuleList = { key: string; label: string; fields: RuleParameter[]; minItems?: number; maxItems?: number; help?: string };
export type RuleStep = { key: string; label: string; expression: string; unit?: string };
export type RuleConstraint = { expression: string; message: string };
export type RuleCitation = {
  documentKey?: string; referenceId?: string; documentTitle: string; documentNumber?: string | null; documentDate?: string | null;
  clause: string; page: string; quote?: string | null; note?: string | null;
};
export type RuleDefinition = {
  key: string; version: number; title: string; operation: string; discipline: string;
  outputKind: MeasurementKind; unit: string;
  /** geometric: a mathematical identity. regulatory: encodes a measurement provision of a cited document. */
  basis: "geometric" | "regulatory";
  parameters: RuleParameter[]; lists?: RuleList[];
  steps: RuleStep[]; result: string; constraints?: RuleConstraint[];
  rounding: { scale: number; mode: "half_up" };
  measurementRule: string; additions: string; deductions: string; exceptions: string; scope: string;
  citations: RuleCitation[];
  validFrom: string | null; validTo: string | null;
  sourceStatus: "verified" | "unverified" | "not_applicable";
  changeNote?: string | null; supersedes?: string | null;
};
export type RuleInput = { values?: unknown; lists?: unknown };
export type NormalizedInputs = { values: Record<string, string>; lists: Record<string, Record<string, string>[]> };
export type TraceStep = { key: string; label: string; expression: string; substituted: string; value: string; unit: string | null };
export type RuleResult = {
  ruleKey: string; ruleVersion: number; unit: string; outputKind: MeasurementKind;
  quantity: string; unrounded: string; rounding: { scale: number; mode: "half_up" };
  inputs: NormalizedInputs; trace: TraceStep[]; formula: string; excelFormula: string | null; warnings: string[];
};
export type Certainty = "geometric" | "definitive" | "provisional" | "blocked";
export type Usability = { certainty: Certainty; label: string; reasons: string[] };
export type ReviewInfo = { status: string; reviewerName: string; reviewerCredential: string | null; note: string | null; createdAt: string;
  reviewerRole?: string | null; ruleRef?: string | null; ruleKey?: string | null; ruleVersion?: number | null; referenceId?: string | null; basis?: string | null };
export type RuleBankEntry = {
  ref: string; origin: "system" | "workspace"; id: string | null; definition: RuleDefinition; hash: string;
  lifecycle: "active" | "retired"; referenceId: string | null; sourceVerified: boolean; baseRef: string | null;
  review: ReviewInfo | null; usability: Usability; createdAt: string | null;
};

const NAME = /^[a-z][a-z0-9_]{0,31}$/;
const RULE_KEY = /^[a-z][a-z0-9_]{1,30}(\.[a-z][a-z0-9_]{1,40}){1,3}$/;
const NUMBER = /^\d+(\.\d+)?$/;
const DATE = /^\d{4}\/\d{2}\/\d{2}$/;
const FORBIDDEN_NAMES = new Set([...[...RESERVED_WORDS].filter((word) => word !== "count"), "constructor", "prototype", "valueof", "tostring", "hasownproperty"]);
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export type CompiledRule = {
  def: RuleDefinition;
  steps: { step: RuleStep; ast: Node }[];
  constraints: { item: RuleConstraint; ast: Node }[];
  inlined: Node | null;
};
const compiledCache = new WeakMap<RuleDefinition, CompiledRule>();

/** Validates a rule definition completely and parses its formulas. Throws RuleError("definition") on any problem. */
export function compileRule(def: RuleDefinition): CompiledRule {
  const cached = compiledCache.get(def);
  if (cached) return cached;
  const fail = (message: string): never => { throw new RuleError(`تعریف قاعده نامعتبر است: ${message}`, "definition"); };
  if (!isRecord(def)) fail("ساختار قاعده خوانده نشد.");
  if (typeof def.key !== "string" || !RULE_KEY.test(def.key)) fail("شناسه قاعده معتبر نیست.");
  if (!Number.isInteger(def.version) || def.version < 1 || def.version > 9999) fail("شماره نسخه معتبر نیست.");
  const texts: [string, unknown, number, boolean][] = [
    ["عنوان", def.title, 200, true], ["عملیات", def.operation, 100, true], ["رشته", def.discipline, 100, true],
    ["ضابطه اندازه‌گیری", def.measurementRule, 3000, true], ["موارد اضافه", def.additions, 3000, false],
    ["موارد کسر", def.deductions, 3000, false], ["شرایط و استثناها", def.exceptions, 3000, false], ["دامنه کاربرد", def.scope, 3000, false],
  ];
  for (const [label, value, max, required] of texts) {
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(`${label} الزامی است یا بیش از حد طولانی است.`);
  }
  if (typeof def.outputKind !== "string" || !own(measurementUnits, def.outputKind) || def.unit !== measurementUnits[def.outputKind]) fail("واحد خروجی با نوع کمیت سازگار نیست.");
  if (!isRecord(def.rounding) || def.rounding.mode !== "half_up" || !Number.isInteger(def.rounding.scale) || def.rounding.scale < 0 || def.rounding.scale > 4) {
    fail("روش گرد کردن باید «نیم به بالا» با ۰ تا ۴ رقم اعشار باشد.");
  }
  if (def.basis !== "geometric" && def.basis !== "regulatory") fail("مبنای قاعده معتبر نیست.");
  if (!["verified", "unverified", "not_applicable"].includes(def.sourceStatus)) fail("وضعیت منبع معتبر نیست.");

  const names = new Set<string>();
  const declare = (name: unknown, what: string): string => {
    if (typeof name !== "string" || !NAME.test(name) || FORBIDDEN_NAMES.has(name)) fail(`نام «${String(name)}» برای ${what} مجاز نیست.`);
    if (names.has(name as string)) fail(`نام «${String(name)}» تکراری است.`);
    names.add(name as string);
    return name as string;
  };
  const checkParameter = (p: RuleParameter, what: string) => {
    if (!isRecord(p)) fail(`${what} خوانده نشد.`);
    declare(p.key, what);
    if (typeof p.label !== "string" || !p.label.trim() || p.label.length > 140) fail(`برچسب ${what} «${p.key}» معتبر نیست.`);
    if (typeof p.unit !== "string" || p.unit.length > 40) fail(`واحد ${what} «${p.key}» معتبر نیست.`);
    if (p.kind !== "decimal" && p.kind !== "integer") fail(`نوع ${what} «${p.key}» معتبر نیست.`);
    if (p.scale !== undefined && (!Number.isInteger(p.scale) || p.scale < 0 || p.scale > 4)) fail(`دقت ${what} «${p.key}» باید ۰ تا ۴ رقم باشد.`);
    for (const bound of [p.min, p.max, p.default]) if (bound !== undefined && (typeof bound !== "string" || !NUMBER.test(bound))) fail(`حدود ${what} «${p.key}» معتبر نیست.`);
  };

  const parameters = Array.isArray(def.parameters) ? def.parameters : fail("فهرست پارامترها خوانده نشد.");
  if (parameters.length > 24) fail("تعداد پارامترها بیش از حد مجاز است.");
  parameters.forEach((p) => checkParameter(p, "پارامتر"));
  const lists = def.lists === undefined ? [] : Array.isArray(def.lists) ? def.lists : fail("فهرست‌های ورودی خوانده نشد.");
  if (lists.length > 4) fail("تعداد فهرست‌های ورودی بیش از حد مجاز است.");
  const fieldsByList = new Map<string, Set<string>>();
  for (const list of lists) {
    if (!isRecord(list)) fail("فهرست ورودی خوانده نشد.");
    declare(list.key, "فهرست");
    if (typeof list.label !== "string" || !list.label.trim() || list.label.length > 140) fail(`برچسب فهرست «${list.key}» معتبر نیست.`);
    if (!Array.isArray(list.fields) || !list.fields.length || list.fields.length > 8) fail(`فیلدهای فهرست «${list.key}» معتبر نیست.`);
    list.fields.forEach((field) => checkParameter(field, "فیلد فهرست"));
    for (const limit of [list.minItems, list.maxItems]) if (limit !== undefined && (!Number.isInteger(limit) || limit < 0 || limit > 200)) fail(`حدود تعداد ردیف «${list.key}» معتبر نیست.`);
    fieldsByList.set(list.key, new Set(list.fields.map((field) => field.key)));
  }

  const scalars = new Set(parameters.map((p) => p.key));
  const parse = (expression: unknown, where: string): Node => {
    if (typeof expression !== "string") return fail(`${where} عبارت محاسباتی ندارد.`);
    let ast: Node;
    try { ast = parseExpression(expression); } catch (error) { return fail(`${where}: ${error instanceof Error ? error.message : "عبارت معتبر نیست."}`); }
    const refs = references(ast);
    for (const name of refs.outer) if (!scalars.has(name)) fail(`${where}: «${name}» تعریف نشده یا پیش از تعریف استفاده شده است.`);
    for (const list of refs.lists) if (!fieldsByList.has(list)) fail(`${where}: فهرست «${list}» تعریف نشده است.`);
    for (const group of refs.inner) for (const name of group.names) {
      if (!fieldsByList.get(group.list)!.has(name) && !scalars.has(name)) fail(`${where}: «${name}» در فهرست «${group.list}» تعریف نشده است.`);
    }
    return ast;
  };

  if (!Array.isArray(def.steps) || !def.steps.length || def.steps.length > 24) fail("تعداد مراحل محاسبه باید بین ۱ تا ۲۴ باشد.");
  const steps = def.steps.map((step) => {
    if (!isRecord(step)) fail("مرحله محاسبه خوانده نشد.");
    const key = declare(step.key, "مرحله");
    if (typeof step.label !== "string" || !step.label.trim() || step.label.length > 140) fail(`برچسب مرحله «${key}» معتبر نیست.`);
    const ast = parse(step.expression, `مرحله «${key}»`);
    scalars.add(key);
    return { step, ast };
  });
  if (typeof def.result !== "string" || !steps.some((entry) => entry.step.key === def.result)) fail("مرحله نتیجه نهایی تعریف نشده است.");

  const constraintList = def.constraints === undefined ? [] : Array.isArray(def.constraints) ? def.constraints : fail("شرط‌های کنترلی خوانده نشد.");
  if (constraintList.length > 12) fail("تعداد شرط‌های کنترلی بیش از حد مجاز است.");
  const constraints = constraintList.map((item, index) => {
    if (!isRecord(item) || typeof item.message !== "string" || !item.message.trim() || item.message.length > 300) fail(`پیام شرط کنترلی ${index + 1} معتبر نیست.`);
    return { item, ast: parse(item.expression, `شرط کنترلی ${index + 1}`) };
  });

  if (!Array.isArray(def.citations) || def.citations.length > 8) fail("فهرست استنادها خوانده نشد.");
  for (const citation of def.citations) {
    if (!isRecord(citation)) fail("استناد خوانده نشد.");
    for (const [label, value, max] of [["عنوان سند", citation.documentTitle, 400], ["بند", citation.clause, 300], ["صفحه", citation.page, 120]] as const) {
      if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} در استناد الزامی است.`);
    }
    if (citation.quote != null && (typeof citation.quote !== "string" || citation.quote.length > 2000)) fail("متن نقل‌شده بیش از حد طولانی است.");
  }
  if (def.basis === "regulatory" && !def.citations.length) fail("قاعده ضابطه‌ای باید دست‌کم یک استناد با بند و صفحه داشته باشد.");
  for (const date of [def.validFrom, def.validTo]) if (date !== null && (typeof date !== "string" || !DATE.test(date))) fail("تاریخ اعتبار باید به‌شکل ۱۴۰۴/۰۱/۰۱ باشد.");
  if (def.validFrom && def.validTo && def.validFrom > def.validTo) fail("تاریخ پایان اعتبار پیش از تاریخ شروع است.");

  let inlined: Node | null = null;
  try {
    const result = steps.find((entry) => entry.step.key === def.result)!;
    inlined = inlineSteps(result.ast, Object.fromEntries(steps.map((entry) => [entry.step.key, entry.ast])));
  } catch { inlined = null; }

  const compiled: CompiledRule = { def, steps, constraints, inlined };
  compiledCache.set(def, compiled);
  return compiled;
}

function readNumber(raw: unknown, parameter: RuleParameter, where = ""): Decimal {
  const label = `«${parameter.label}»${where}`;
  let text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? normalizeDigits(raw) : "";
  if (!text) {
    if (parameter.default === undefined) throw new RuleError(`${label} الزامی است.`);
    text = parameter.default;
  }
  if (text.length > 30 || !NUMBER.test(text)) throw new RuleError(`${label} باید عدد نامنفی معتبر باشد.`);
  const value = new RD(text);
  if (parameter.kind === "integer" && !value.isInteger()) throw new RuleError(`${label} باید عدد صحیح باشد.`);
  const scale = parameter.scale ?? 4;
  if (value.decimalPlaces() > scale) throw new RuleError(`${label} حداکثر ${scale} رقم اعشار می‌پذیرد.`);
  const min = new RD(parameter.min ?? "0");
  if (parameter.exclusiveMin ? value.lte(min) : value.lt(min)) {
    throw new RuleError(`${label} باید ${parameter.exclusiveMin ? "بزرگ‌تر از" : "حداقل"} ${min.toFixed()} باشد.`);
  }
  if (value.gt(new RD(parameter.max ?? "99999999999999"))) throw new RuleError(`${label} از حد مجاز بزرگ‌تر است.`);
  return value;
}

/** Runs a rule on user inputs. Deterministic: the same definition and inputs always give the same result and trace. */
export function evaluateRule(def: RuleDefinition, input: RuleInput): RuleResult {
  const rule = compileRule(def);
  const scope: Scope = { values: {}, lists: {} };
  const inputs: NormalizedInputs = { values: {}, lists: {} };
  const rawValues = isRecord(input?.values) ? input.values : {};
  const rawLists = isRecord(input?.lists) ? input.lists : {};
  const lists = def.lists ?? [];

  for (const key of Object.keys(rawValues)) if (!def.parameters.some((p) => p.key === key)) throw new RuleError(`ورودی ناشناخته «${key}» پذیرفته نمی‌شود.`);
  for (const key of Object.keys(rawLists)) if (!lists.some((list) => list.key === key)) throw new RuleError(`فهرست ناشناخته «${key}» پذیرفته نمی‌شود.`);
  for (const parameter of def.parameters) {
    const value = readNumber(own(rawValues, parameter.key) ? rawValues[parameter.key] : undefined, parameter);
    scope.values[parameter.key] = value;
    inputs.values[parameter.key] = value.toFixed();
  }
  for (const list of lists) {
    const rawItems = own(rawLists, list.key) ? rawLists[list.key] : [];
    if (!Array.isArray(rawItems)) throw new RuleError(`«${list.label}» باید فهرستی از ردیف‌ها باشد.`);
    if (rawItems.length > (list.maxItems ?? 50)) throw new RuleError(`تعداد ردیف‌های «${list.label}» بیش از حد مجاز است.`);
    if (rawItems.length < (list.minItems ?? 0)) throw new RuleError(`برای «${list.label}» دست‌کم ${list.minItems} ردیف لازم است.`);
    scope.lists[list.key] = [];
    inputs.lists[list.key] = [];
    rawItems.forEach((rawItem, index) => {
      if (!isRecord(rawItem)) throw new RuleError(`ردیف ${index + 1} در «${list.label}» خوانده نشد.`);
      for (const key of Object.keys(rawItem)) if (!list.fields.some((field) => field.key === key)) throw new RuleError(`فیلد ناشناخته «${key}» در «${list.label}» پذیرفته نمی‌شود.`);
      const numbers: Record<string, Decimal> = {};
      const texts: Record<string, string> = {};
      for (const field of list.fields) {
        const value = readNumber(own(rawItem, field.key) ? rawItem[field.key] : undefined, field, ` در ردیف ${index + 1} «${list.label}»`);
        numbers[field.key] = value;
        texts[field.key] = value.toFixed();
      }
      scope.lists[list.key].push(numbers);
      inputs.lists[list.key].push(texts);
    });
  }

  const trace: TraceStep[] = [];
  try {
    for (const { step, ast } of rule.steps) {
      const value = evaluate(ast, scope);
      trace.push({
        key: step.key, label: step.label, expression: formatExpression(ast, "source"),
        substituted: formatExpression(ast, "values", scope), value: plainNumber(value), unit: step.unit ?? null,
      });
      scope.values[step.key] = value;
    }
    for (const { item, ast } of rule.constraints) if (evaluate(ast, scope).isZero()) throw new RuleError(item.message);
  } catch (error) {
    if (error instanceof ExpressionError) throw new RuleError(error.message, "calculation");
    throw error;
  }

  const raw = scope.values[def.result];
  if (raw.isNegative()) throw new RuleError("نتیجه منفی شد؛ مقدار کسرها از مقدار ناخالص بیشتر است.", "calculation");
  const rounded = raw.toDecimalPlaces(def.rounding.scale, RD.ROUND_HALF_UP);
  if (rounded.gte("10000000000000000")) throw new RuleError("نتیجه از محدوده قابل ذخیره‌سازی بزرگ‌تر است.", "calculation");

  let formula = trace.find((step) => step.key === def.result)!.substituted;
  let excelFormula: string | null = null;
  if (rule.inlined) {
    try {
      const text = formatExpression(rule.inlined, "values", scope);
      if (text.length <= 1500) formula = text;
      const excel = `ROUND(${formatExpression(rule.inlined, "excel", scope)},${def.rounding.scale})`;
      if (excel.length <= 7000) excelFormula = excel;
    } catch { /* the step-wise trace remains the authoritative record */ }
  }
  const warnings: string[] = [];
  if (rounded.isZero()) warnings.push("نتیجه محاسبه صفر است.");
  return {
    ruleKey: def.key, ruleVersion: def.version, unit: def.unit, outputKind: def.outputKind,
    quantity: rounded.toFixed(4), unrounded: plainNumber(raw, 12), rounding: def.rounding,
    inputs, trace, formula, excelFormula, warnings,
  };
}

/**
 * Decides how far a result of this rule may be relied on.
 * geometric   → mathematical identity; the user may confirm it as a geometric quantity (not a payment provision).
 * definitive  → regulatory rule whose source document is verified AND which an expert approved.
 * provisional → regulatory rule missing one of those gates; results are trial values and cannot be confirmed.
 * blocked     → retired, rejected by the reviewer, or outside its validity period.
 */
export function ruleUsability(def: RuleDefinition, context: {
  lifecycle?: string; sourceVerified?: boolean; expertApproved?: boolean; expertRejected?: boolean; onDate?: string | null; requireDate?: boolean;
  /** System rules ship with independently verified reference cases; workspace rules carry no such evidence until reviewed. */
  origin?: "system" | "workspace";
} = {}): Usability {
  const blocked = (reason: string): Usability => ({ certainty: "blocked", label: "مسدود", reasons: [reason] });
  if (context.lifecycle === "retired") return blocked("این نسخه بازنشسته شده و برای محاسبه جدید قابل استفاده نیست.");
  if (context.expertRejected) return blocked("بازبین متخصص این نسخه را رد کرده است.");
  if (context.onDate && def.validFrom && context.onDate < def.validFrom) return blocked(`تاریخ مبنای برآورد (${context.onDate}) پیش از آغاز اعتبار این نسخه (${def.validFrom}) است.`);
  if (context.onDate && def.validTo && context.onDate > def.validTo) return blocked(`تاریخ مبنای برآورد (${context.onDate}) پس از پایان اعتبار این نسخه (${def.validTo}) است.`);
  if (def.basis === "geometric") {
    if (context.origin === "workspace" && !context.expertApproved) {
      return {
        certainty: "provisional", label: "هندسی فضای کار — در انتظار بازبینی",
        reasons: ["این رابطه هندسی توسط کاربر تعریف شده و تا تأیید متخصص، قابل اتکا تلقی نمی‌شود."],
      };
    }
    return {
      certainty: "geometric", label: "هندسی پایه",
      reasons: ["رابطه هندسی است و به‌تنهایی ضابطه پرداخت فهرست‌بها محسوب نمی‌شود.", ...(context.expertApproved ? [] : ["بازبینی متخصص برای این نسخه هنوز ثبت نشده است."])],
    };
  }
  const reasons: string[] = [];
  if (!context.sourceVerified) reasons.push("سند مرجع این ضابطه هنوز «تأییدنشده» است.");
  if (!context.expertApproved) reasons.push("تأیید متخصص برای این نسخه ثبت نشده است.");
  if (context.requireDate && (def.validFrom || def.validTo) && !context.onDate) reasons.push("تاریخ مبنای برآورد پروژه برای کنترل دوره اعتبار ثبت نشده است.");
  if (reasons.length) return { certainty: "provisional", label: "آزمایشی — تأییدنشده", reasons };
  return { certainty: "definitive", label: "ضابطه تأییدشده", reasons: ["سند مرجع بازبینی شده و این نسخه را متخصص تأیید کرده است."] };
}

/** Key-order independent JSON, used for content hashes and duplicate detection. */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** Canonical text of normalised inputs. List rows are sorted so that entering the same rows in another order is still a duplicate. */
export function canonicalInputs(inputs: NormalizedInputs): string {
  const lists: Record<string, string[]> = {};
  for (const key of Object.keys(inputs.lists)) lists[key] = inputs.lists[key].map(stableStringify).sort();
  return stableStringify({ values: inputs.values, lists });
}
