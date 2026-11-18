import Decimal from "decimal.js";

// Geometric quantities only. No Iranian schedule-of-rates measurement rules are inferred here.
Decimal.set({ precision: 36, rounding: Decimal.ROUND_HALF_UP });

export class CalculationError extends Error {}

export type MeasurementKind = "length" | "area" | "volume" | "count" | "weight";
export type PricingBasis = "market" | "contractor" | "official";
export type GeometryInput = {
  kind: MeasurementKind;
  length?: string | number | null;
  width?: string | number | null;
  height?: string | number | null;
  count?: string | number | null;
  unitWeight?: string | number | null;
  deduction?: string | number | null;
};

export const measurementUnits: Record<MeasurementKind, string> = {
  length: "متر", area: "مترمربع", volume: "مترمکعب", count: "عدد", weight: "کیلوگرم",
};

export function normalizeDigits(value: string): string {
  return value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬,]/g, "").replace(/٫/g, ".").trim();
}

export function decimal(value: string | number | null | undefined, label = "مقدار"): Decimal {
  const raw = normalizeDigits(String(value ?? ""));
  if (!/^(?:\d+)(?:\.\d+)?$/.test(raw) || raw.length > 40) throw new CalculationError(`${label} باید عدد نامنفی معتبر و در محدوده مجاز باشد.`);
  const number = new Decimal(raw);
  if (!number.isFinite()) throw new CalculationError(`${label} معتبر نیست.`);
  return number;
}

function positive(value: string | number | null | undefined, label: string): Decimal {
  const result = decimal(value, label);
  if (result.lte(0)) throw new CalculationError(`${label} باید بزرگ‌تر از صفر باشد.`);
  // Input numeric columns have precision 18, scale 4: at most 14 integral digits.
  if (result.gte("100000000000000")) throw new CalculationError(`${label} از محدوده قابل ذخیره‌سازی بزرگ‌تر است.`);
  if (result.decimalPlaces() > 4) throw new CalculationError(`${label} حداکثر چهار رقم اعشار می‌پذیرد.`);
  return result;
}

export function calculateQuantity(input: GeometryInput): { quantity: string; formula: string; unit: string } {
  if (!(input.kind in measurementUnits)) throw new CalculationError("نوع اندازه‌گیری معتبر نیست.");
  const count = positive(input.count ?? "1", "تعداد تکرار");
  if (!count.isInteger()) throw new CalculationError("تعداد تکرار باید عدد صحیح باشد.");
  const deduction = decimal(input.deduction ?? "0", "مقدار کسر");
  if (deduction.gte("100000000000000")) throw new CalculationError("مقدار کسر از محدوده قابل ذخیره‌سازی بزرگ‌تر است.");
  if (deduction.decimalPlaces() > 4) throw new CalculationError("مقدار کسر حداکثر چهار رقم اعشار می‌پذیرد.");
  let gross: Decimal;
  let expression: string;
  if (input.kind === "count") {
    gross = count;
    expression = count.toString();
  } else if (input.kind === "weight") {
    const weight = positive(input.unitWeight, "وزن هر واحد");
    gross = weight.mul(count);
    expression = `${weight.toString()} × ${count.toString()}`;
  } else {
    const length = positive(input.length, "طول");
    const factors: Decimal[] = [length];
    if (input.kind === "area" || input.kind === "volume") factors.push(positive(input.width, "عرض"));
    if (input.kind === "volume") factors.push(positive(input.height, "ارتفاع/ضخامت"));
    gross = factors.reduce((acc, factor) => acc.mul(factor), new Decimal(1)).mul(count);
    expression = [...factors, count].map((factor) => factor.toString()).join(" × ");
  }
  if (deduction.gt(gross)) throw new CalculationError("مقدار کسر نمی‌تواند از مقدار ناخالص بیشتر باشد.");
  if (input.kind === "count" && !deduction.isInteger()) throw new CalculationError("کسر تعداد باید عدد صحیح باشد.");
  const net = gross.minus(deduction).toDecimalPlaces(4);
  // Output numeric column has precision 20, scale 4: at most 16 integral digits.
  if (net.gte("10000000000000000")) throw new CalculationError("مقدار نهایی از محدوده قابل ذخیره‌سازی بزرگ‌تر است.");
  return { quantity: net.toFixed(4), formula: deduction.isZero() ? expression : `(${expression}) − ${deduction.toString()}`,
    unit: measurementUnits[input.kind] };
}

export function toRial(amount: string | number, currency: "IRR" | "IRT"): Decimal {
  const value = decimal(amount, "بهای واحد");
  if (currency !== "IRR" && currency !== "IRT") throw new CalculationError("واحد پول معتبر نیست.");
  return currency === "IRT" ? value.mul(10) : value;
}

export type EstimateRuleInfo = { ref: string; key: string | null; version: number | null; hash: string | null; certainty: string | null };
export type EstimateInputRow = { id: string; title: string; quantity: string; unit: string; formula: string; sourceNote?: string | null; status: string; priceId?: string | null; isDemo?: boolean;
  certainty?: string | null; ruleRef?: string | null; ruleKey?: string | null; ruleVersion?: number | null; ruleHash?: string | null;
  /** Live assessment of the rule this row depends on: "ok", "stale" (rule changed) or "unusable". */
  ruleValidity?: string | null };
export type EstimateInputPrice = { id: string; title: string; unit: string; amount: string; currency: string; basis: string; confirmed: boolean; sourceName: string; priceDate: string; referenceId?: string | null };
export type EstimateLine = { takeoffId: string; title: string; quantity: string; unit: string; formula: string; sourceNote: string; priceId: string; priceTitle: string; unitPriceRial: string; amountRial: string; priceSource: string; priceDate: string; referenceId: string | null; rule?: EstimateRuleInfo | null };

export function calculateEstimate(
  rows: EstimateInputRow[], prices: EstimateInputPrice[], basis: PricingBasis,
  options: { contractReference?: string | null; verifiedReferenceIds?: string[] } = {},
): { lines: EstimateLine[]; totalRial: string; issues: string[]; draftCount: number } {
  const issues: string[] = [];
  const lines: EstimateLine[] = [];
  const confirmed = rows.filter((row) => row.status === "confirmed");
  const draftCount = rows.length - confirmed.length;
  if (!confirmed.length) issues.push("هنوز هیچ ردیف متره تأییدشده‌ای وجود ندارد.");
  if (basis === "official" && !options.contractReference?.trim()) issues.push("برای مبنای رسمی، ارجاع صریح به سند پیمان لازم است.");
  const priceMap = new Map(prices.map((price) => [price.id, price]));
  for (const row of confirmed) {
    if (row.isDemo) { issues.push(`«${row.title}» آموزشی است و باید با داده واقعی جایگزین شود.`); continue; }
    if (!row.sourceNote?.trim()) { issues.push(`منبع مقدار «${row.title}» ثبت نشده است.`); continue; }
    if (row.certainty === "provisional" || row.certainty === "blocked") { issues.push(`«${row.title}» با قاعده تأییدنشده محاسبه شده و در برآورد قابل استفاده نیست.`); continue; }
    if (row.ruleValidity === "stale" || row.ruleValidity === "unusable") { issues.push(`«${row.title}» به قاعده‌ای وابسته است که پس از محاسبه تغییر کرده یا اعتبار خود را از دست داده است؛ ردیف باید بازبینی شود.`); continue; }
    const price = row.priceId ? priceMap.get(row.priceId) : undefined;
    if (!price) { issues.push(`برای «${row.title}» بهای واحد انتخاب نشده است.`); continue; }
    if (price.unit !== row.unit) { issues.push(`واحد بها و مقدار «${row.title}» یکسان نیست.`); continue; }
    if (price.basis !== basis) { issues.push(`مبنای قیمت «${row.title}» با مبنای پروژه متفاوت است.`); continue; }
    if (!price.confirmed || !price.sourceName?.trim() || !price.priceDate?.trim()) { issues.push(`بهای «${row.title}» منبع و تأیید کافی ندارد.`); continue; }
    if (basis === "official" && (!price.referenceId || !options.verifiedReferenceIds?.includes(price.referenceId))) {
      issues.push(`سند فهرست‌بهای «${row.title}» تأیید نشده است.`); continue;
    }
    try {
      const unitPrice = toRial(price.amount, price.currency as "IRR" | "IRT");
      if (unitPrice.lte(0)) throw new CalculationError("بهای واحد باید بزرگ‌تر از صفر باشد.");
      const quantity = decimal(row.quantity, "مقدار");
      if (quantity.lte(0)) throw new CalculationError("مقدار قابل برآورد باید بزرگ‌تر از صفر باشد.");
      const amount = quantity.mul(unitPrice).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
      if (amount.gte("1000000000000000000000000")) throw new CalculationError("مبلغ ردیف از محدوده مالی مجاز بزرگ‌تر است.");
      lines.push({ takeoffId: row.id, title: row.title, quantity: quantity.toFixed(4), unit: row.unit, formula: row.formula,
        sourceNote: row.sourceNote, priceId: price.id, priceTitle: price.title, unitPriceRial: unitPrice.toFixed(2),
        amountRial: amount.toFixed(0), priceSource: price.sourceName, priceDate: price.priceDate, referenceId: price.referenceId ?? null,
        rule: row.ruleRef ? { ref: row.ruleRef, key: row.ruleKey ?? null, version: row.ruleVersion ?? null, hash: row.ruleHash ?? null, certainty: row.certainty ?? null } : null });
    } catch (error) { issues.push(`${row.title}: ${error instanceof Error ? error.message : "خطای محاسبه"}`); }
  }
  const total = lines.reduce((sum, line) => sum.plus(line.amountRial), new Decimal(0));
  if (total.gte("1000000000000000000000000")) issues.push("جمع برآورد از محدوده مالی مجاز بزرگ‌تر است.");
  return { lines, totalRial: total.toFixed(0), issues, draftCount };
}
