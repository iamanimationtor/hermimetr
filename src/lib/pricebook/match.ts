/**
 * Suggests pricebook rows for a takeoff row. Pure function, no database access.
 *
 * A suggestion is never applied automatically and is never based on text similarity alone:
 * the unit must be identical, the operation must overlap with the chapter, numeric specifications are compared,
 * and recorded conditions of use are always surfaced for the user, who gives the final confirmation.
 */

export type MatchQuery = { title: string; category: string; unit: string; specification?: string | null };
export type MatchItem = {
  id: string; code: string; chapterCode: string | null; chapterTitle: string | null; description: string; unit: string;
  unitPriceRial: string | null; conditions: string | null;
};
export type MatchSuggestion = {
  item: MatchItem; score: number; unitOk: boolean; confirmable: boolean;
  breakdown: { unit: number; operation: number; terms: number; numbers: number };
  reasons: string[]; cautions: string[]; distinctTerms: string[];
};

// Function words plus generic construction verbs that appear in almost every row and therefore carry no matching signal.
const STOP_WORDS = new Set([
  "و", "با", "در", "به", "از", "برای", "که", "هر", "یا", "تا", "ها", "های", "این", "ان", "بر", "شده", "می", "شود", "باشد", "است", "طور", "کامل",
  "تهیه", "نصب", "اجرا", "اجرای", "حمل", "کار", "کارهای", "کردن", "انواع", "مربوط", "the", "of", "and",
]);

export function normalizeText(value: string): string {
  return value
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[ۀة]/g, "ه").replace(/[أإآ]/g, "ا")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/\u200c/g, " ")
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/٫/g, ".").toLowerCase().replace(/[^a-z0-9\u0600-\u06FF.]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Units are compared after normalisation only; no unit conversion is attempted. */
export function normalizeUnit(value: string): string {
  const unit = normalizeText(value).replace(/\s/g, "");
  return unit === "مترطول" ? "متر" : unit;
}

function tokens(value: string): { words: string[]; numbers: string[] } {
  const words: string[] = [];
  const numbers: string[] = [];
  for (const raw of normalizeText(value).split(" ")) {
    const token = raw.replace(/^\.+|\.+$/g, "");
    if (!token) continue;
    const digits = token.match(/\d+(?:\.\d+)?/g);
    if (digits) for (const number of digits) if (!numbers.includes(number)) numbers.push(number);
    if (/^\d+(\.\d+)?$/.test(token)) continue;
    if (token.length >= 2 && !STOP_WORDS.has(token) && !words.includes(token)) words.push(token);
  }
  return { words, numbers };
}

const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

export function suggestMatches(query: MatchQuery, items: MatchItem[], limit = 8): MatchSuggestion[] {
  const q = tokens(`${query.title} ${query.specification ?? ""}`);
  const operation = tokens(query.category).words;
  const unit = normalizeUnit(query.unit);
  const suggestions: MatchSuggestion[] = [];

  for (const item of items) {
    const description = tokens(item.description);
    const chapter = tokens(item.chapterTitle ?? "").words;
    const unitOk = normalizeUnit(item.unit) === unit;
    const termHits = q.words.filter((word) => description.words.some((other) => sameWord(word, other)));
    const operationHits = operation.filter((word) => [...chapter, ...description.words].some((other) => sameWord(word, other)));
    if (!termHits.length && !operationHits.length) continue;
    const numberHits = q.numbers.filter((number) => description.numbers.includes(number));
    const missingNumbers = q.numbers.filter((number) => !description.numbers.includes(number));
    const breakdown = {
      unit: unitOk ? 30 : 0,
      operation: operation.length ? Math.round(20 * operationHits.length / operation.length) : 0,
      terms: q.words.length ? Math.round(35 * termHits.length / q.words.length) : 0,
      numbers: q.numbers.length ? Math.round(15 * numberHits.length / q.numbers.length) : 0,
    };
    const reasons: string[] = [];
    const cautions: string[] = [];
    if (unitOk) reasons.push(`واحد ردیف (${item.unit}) با واحد متره یکسان است.`);
    else cautions.push(`واحد ردیف (${item.unit}) با واحد متره (${query.unit}) یکسان نیست؛ تبدیل واحد انجام نمی‌شود و تأیید ممکن نیست.`);
    if (operationHits.length) reasons.push(`عملیات «${query.category}» با ${item.chapterTitle ? `فصل «${item.chapterTitle}»` : "شرح ردیف"} هم‌پوشانی دارد (${operationHits.join("، ")}).`);
    else cautions.push("دسته عملیات متره در عنوان فصل یا شرح این ردیف دیده نشد.");
    if (termHits.length) reasons.push(`واژه‌های مشترک با شرح ردیف: ${termHits.join("، ")}.`);
    if (numberHits.length) reasons.push(`مشخصه عددی مشترک: ${numberHits.join("، ")}.`);
    if (missingNumbers.length) cautions.push(`مشخصه عددی متره (${missingNumbers.join("، ")}) در شرح ردیف دیده نشد.`);
    if (item.conditions) cautions.push(`شرایط کاربرد ثبت‌شده برای ردیف: ${item.conditions}`);
    if (item.unitPriceRial === null) cautions.push("این ردیف در فهرست واردشده بهای واحد ندارد.");
    const distinctTerms = description.words.filter((word) => !q.words.some((other) => sameWord(word, other)) && !operation.some((other) => sameWord(word, other))).slice(0, 8);
    const hasPrice = item.unitPriceRial !== null && Number(item.unitPriceRial) > 0;
    suggestions.push({
      item, score: breakdown.unit + breakdown.operation + breakdown.terms + breakdown.numbers, unitOk,
      confirmable: unitOk && hasPrice, breakdown, reasons, cautions, distinctTerms,
    });
  }
  return suggestions
    .sort((a, b) => Number(b.unitOk) - Number(a.unitOk) || b.score - a.score || a.item.code.localeCompare(b.item.code))
    .slice(0, limit);
}
