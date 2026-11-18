import Decimal from "decimal.js";
import { z } from "zod";

// Separate precision context: all accepted intermediate products fit exactly before rounding.
const Exact = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const digits = (value: string) => value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".").trim();

const factorSchema = z.object({
  label: z.string().trim().min(1, "عنوان ضریب الزامی است.").max(80),
  multiplier: z.string().trim().min(1, "مقدار ضریب الزامی است.").max(20),
  source: z.string().trim().min(3, "ارجاع به بند یا مبنای ضریب الزامی است.").max(300),
}).strict();
export const coefficientInputSchema = z.object({
  factors: z.array(factorSchema).min(1).max(8),
  attestScope: z.literal(true, { error: "تأیید شمول و ترتیب ضرایب الزامی است." }),
  expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type CoefficientFactor = z.infer<typeof factorSchema>;
export type CoefficientStep = CoefficientFactor & { inputRial: string; outputRial: string };
export type CoefficientScenario = { version: 1; scope: "whole_direct_sum"; rounding: "half_up_each_step"; directTotalRial: string; finalTotalRial: string; steps: CoefficientStep[] };

/** Explicit scenario only: sequential multipliers apply to the whole direct sum, rounding to a rial after each step. */
export function calculateCoefficientScenario(totalRial: string, factors: CoefficientFactor[]): CoefficientScenario {
  if (!/^\d{1,24}$/.test(totalRial)) throw new Error("جمع مستقیم معتبر نیست.");
  if (!factors.length || factors.length > 8) throw new Error("بین ۱ تا ۸ ضریب وارد کنید.");
  let running = new Exact(totalRial);
  const steps = factors.map((input) => {
    const factor = factorSchema.safeParse(input);
    if (!factor.success) throw new Error(factor.error.issues[0]?.message || "اطلاعات ضریب معتبر نیست.");
    const normalized = digits(factor.data.multiplier);
    if (!/^\d{1,2}(?:\.\d{1,6})?$/.test(normalized)) throw new Error("ضریب باید عدد مثبت با حداکثر ۶ رقم اعشار باشد؛ جداکننده هزارگان مجاز نیست.");
    const multiplier = new Exact(normalized);
    if (multiplier.lte(0) || multiplier.gt(10)) throw new Error("ضریب باید بزرگ‌تر از صفر و حداکثر ۱۰ باشد.");
    const inputRial = running.toFixed(0);
    running = running.mul(multiplier).toDecimalPlaces(0, Exact.ROUND_HALF_UP);
    if (running.gte("1000000000000000000000000")) throw new Error("مبلغ پس از اعمال ضریب از محدوده قابل ذخیره‌سازی بیشتر است.");
    return { label: factor.data.label, multiplier: multiplier.toString(), source: factor.data.source, inputRial, outputRial: running.toFixed(0) };
  });
  return { version: 1, scope: "whole_direct_sum", rounding: "half_up_each_step", directTotalRial: new Exact(totalRial).toFixed(0), finalTotalRial: running.toFixed(0), steps };
}

// Older snapshots have no scenario; reject malformed/unknown future versions instead of guessing.
const savedSchema = z.object({ version: z.literal(1), scope: z.literal("whole_direct_sum"), rounding: z.literal("half_up_each_step"),
  directTotalRial: z.string().regex(/^\d{1,24}$/), finalTotalRial: z.string().regex(/^\d{1,24}$/),
  steps: z.array(factorSchema.extend({ inputRial: z.string().regex(/^\d{1,24}$/), outputRial: z.string().regex(/^\d{1,24}$/) })).min(1).max(8) });
export function readCoefficientScenario(snapshot: Record<string, unknown>): CoefficientScenario | null {
  const parsed = savedSchema.safeParse(snapshot.coefficientScenario);
  if (!parsed.success) return null;
  try {
    const recomputed = calculateCoefficientScenario(parsed.data.directTotalRial, parsed.data.steps.map(({ label, multiplier, source }) => ({ label, multiplier, source })));
    return JSON.stringify(recomputed) === JSON.stringify(parsed.data) ? recomputed : null;
  } catch { return null; }
}
