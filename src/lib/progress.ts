import Decimal from "decimal.js";
import { z } from "zod";

const Exact = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const digits = (value: string) => value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".").trim();
const frozenSchema = z.object({ takeoffId: z.string().uuid(), title: z.string().min(1).max(240), unit: z.string().min(1).max(40),
  quantity: z.string(), unitPriceRial: z.string(), amountRial: z.string() });
export const progressInputSchema = z.object({ takeoffId: z.string().uuid(), currentQuantity: z.string().max(32), evidence: z.string().trim().max(500) }).strict();
export type ProgressInput = z.infer<typeof progressInputSchema>;
export type ProgressRow = { takeoffId: string; title: string; unit: string; estimatedQuantity: string; unitPriceRial: string;
  previousQuantity: string; currentQuantity: string; periodQuantity: string; previousAmountRial: string; cumulativeAmountRial: string; periodAmountRial: string; evidence: string };
export type ProgressTotals = { previousRial: string; cumulativeRial: string; periodRial: string; baselineRial: string };

const savedRow = z.object({ takeoffId: z.string().uuid(), title: z.string(), unit: z.string(), estimatedQuantity: z.string(), unitPriceRial: z.string(),
  previousQuantity: z.string(), currentQuantity: z.string(), periodQuantity: z.string(), previousAmountRial: z.string(), cumulativeAmountRial: z.string(), periodAmountRial: z.string(), evidence: z.string() });

function quantity(raw: string, label: string) {
  const value = digits(raw);
  if (!/^\d{1,16}(?:\.\d{1,4})?$/.test(value)) throw new Error(`${label}: مقدار باید عدد نامنفی با حداکثر چهار رقم اعشار باشد؛ جداکننده هزارگان مجاز نیست.`);
  return new Exact(value);
}

/** Immutable snapshot stays the source of truth; voiding only hides the latest valid report. */
export function sanitizeProgressPeriod(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) throw new Error("عنوان دوره باید ۱ تا ۱۶۰ نویسه باشد.");
  if (/^[\s\uFEFF]*[=+\-@\t\r]/.test(trimmed)) throw new Error("عنوان دوره نمی‌تواند با =، +، -، @ یا تب آغاز شود.");
  return trimmed;
}

/** Cumulative quantities are entered explicitly. Period money is the difference of rounded cumulative line amounts. */
export function calculateProgress(frozenRows: unknown[], expectedTotal: string, previousRows: unknown[] | null, inputs: ProgressInput[]): { rows: ProgressRow[]; totals: ProgressTotals } {
  if (!frozenRows.length || frozenRows.length > 500) throw new Error("این قابلیت برای نسخه‌هایی با ۱ تا ۵۰۰ ردیف قابل استفاده است.");
  const parsed = z.array(frozenSchema).safeParse(frozenRows);
  if (!parsed.success) throw new Error("اطلاعات ردیف‌های نسخه مبنا ناقص است.");
  if (!/^\d{1,24}$/.test(expectedTotal)) throw new Error("جمع نسخه مبنا معتبر نیست.");
  const inputParse = z.array(progressInputSchema).max(500).safeParse(inputs);
  if (!inputParse.success) throw new Error("ورودی گزارش پیشرفت معتبر نیست.");
  const byId = new Map(inputParse.data.map((row) => [row.takeoffId, row]));
  if (byId.size !== inputParse.data.length || byId.size !== parsed.data.length || new Set(parsed.data.map((row) => row.takeoffId)).size !== parsed.data.length) throw new Error("ورودی هر ردیف باید دقیقاً یک‌بار ارائه شود.");
  const previous = previousRows === null ? [] : z.array(savedRow).parse(previousRows);
  if (previousRows !== null && (previous.length !== parsed.data.length || new Set(previous.map((row) => row.takeoffId)).size !== previous.length)) throw new Error("گزارش قبلی ناسازگار است.");
  const prevById = new Map(previous.map((row) => [row.takeoffId, row]));
  let changed = false;
  let base = new Exact(0), priorTotal = new Exact(0), cumulativeTotal = new Exact(0);
  const rows = parsed.data.map((frozen): ProgressRow => {
    const input = byId.get(frozen.takeoffId);
    if (!input) throw new Error(`مقدار ردیف «${frozen.title}» ارائه نشده است.`);
    const estimated = quantity(frozen.quantity, frozen.title);
    const current = quantity(input.currentQuantity, frozen.title);
    const previousRow = prevById.get(frozen.takeoffId);
    if (previousRows !== null && !previousRow) throw new Error("ردیف گزارش قبلی پیدا نشد.");
    const prior = previousRow ? quantity(previousRow.currentQuantity, frozen.title) : new Exact(0);
    if (!/^\d{1,21}(?:\.\d{1,2})?$/.test(frozen.unitPriceRial) || !/^\d{1,24}$/.test(frozen.amountRial)) throw new Error("بهای نسخه مبنا نامعتبر است.");
    const price = new Exact(frozen.unitPriceRial);
    if (estimated.lte(0) || price.lte(0) || prior.gt(estimated) || current.gt(estimated)) throw new Error(`مقدار «${frozen.title}» از مقدار نسخه مبنا بیشتر است.`);
    if (frozen.unit === "عدد" && (!estimated.isInteger() || !current.isInteger() || !prior.isInteger())) throw new Error(`مقدار «${frozen.title}» باید عدد صحیح باشد.`);
    if (current.lt(prior)) throw new Error(`مقدار تجمعی «${frozen.title}» کمتر از گزارش قبلی است؛ ابتدا آخرین گزارش را با دلیل باطل کنید.`);
    if (current.gt(prior)) {
      changed = true;
      if (input.evidence.length < 3) throw new Error(`برای پیشرفت «${frozen.title}» منبع یا شرح اندازه‌گیری لازم است.`);
    }
    const estimateAmount = estimated.mul(price).toDecimalPlaces(0, Exact.ROUND_HALF_UP);
    if (!estimateAmount.eq(frozen.amountRial)) throw new Error(`مبلغ ردیف «${frozen.title}» در نسخه مبنا بازتولید نمی‌شود.`);
    const previousAmount = prior.mul(price).toDecimalPlaces(0, Exact.ROUND_HALF_UP);
    const cumulativeAmount = current.mul(price).toDecimalPlaces(0, Exact.ROUND_HALF_UP);
    base = base.plus(estimateAmount); priorTotal = priorTotal.plus(previousAmount); cumulativeTotal = cumulativeTotal.plus(cumulativeAmount);
    return { takeoffId: frozen.takeoffId, title: frozen.title, unit: frozen.unit, estimatedQuantity: estimated.toFixed(4), unitPriceRial: price.toFixed(2),
      previousQuantity: prior.toFixed(4), currentQuantity: current.toFixed(4), periodQuantity: current.minus(prior).toFixed(4),
      previousAmountRial: previousAmount.toFixed(0), cumulativeAmountRial: cumulativeAmount.toFixed(0), periodAmountRial: cumulativeAmount.minus(previousAmount).toFixed(0), evidence: input.evidence };
  });
  if (!base.eq(expectedTotal)) throw new Error("جمع ردیف‌های نسخه مبنا بازتولید نمی‌شود.");
  if (!changed) throw new Error("هیچ پیشرفت جدیدی ثبت نشده است.");
  if (base.gte("1000000000000000000000000")) throw new Error("جمع از محدوده مالی مجاز بیشتر است.");
  return { rows, totals: { previousRial: priorTotal.toFixed(0), cumulativeRial: cumulativeTotal.toFixed(0), periodRial: cumulativeTotal.minus(priorTotal).toFixed(0), baselineRial: base.toFixed(0) } };
}
