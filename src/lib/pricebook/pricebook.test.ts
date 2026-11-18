import assert from "node:assert/strict";
import test from "node:test";
import { parseCsv, validatePricebookTable } from "./import";
import { normalizeUnit, suggestMatches, type MatchItem } from "./match";

// All rows below are synthetic test data. They are not official pricebook rows or prices.
const items: MatchItem[] = [
  { id: "1", code: "T-0801", chapterCode: "08", chapterTitle: "بتن درجا (آزمایشی)", description: "تهیه و اجرای بتن با مقاومت فشاری مشخصه 25 مگاپاسکال (داده آزمایشی)", unit: "مترمکعب", unitPriceRial: "1000", conditions: null },
  { id: "2", code: "T-0802", chapterCode: "08", chapterTitle: "بتن درجا (آزمایشی)", description: "تهیه و اجرای بتن با مقاومت فشاری مشخصه 30 مگاپاسکال (داده آزمایشی)", unit: "متر مکعب", unitPriceRial: "1200", conditions: "فقط برای آزمون" },
  { id: "3", code: "T-0701", chapterCode: "07", chapterTitle: "کارهای فولادی با میلگرد (آزمایشی)", description: "تهیه و نصب میلگرد آجدار (داده آزمایشی)", unit: "کیلوگرم", unitPriceRial: "50", conditions: null },
  { id: "4", code: "T-0803", chapterCode: "08", chapterTitle: "بتن درجا (آزمایشی)", description: "اضافه‌بها برای بتن‌ریزی در ارتفاع (داده آزمایشی)", unit: "مترمربع", unitPriceRial: null, conditions: null },
];

test("CSV parsing handles quotes, delimiters, BOM and CRLF", () => {
  assert.deepEqual(parseCsv('\uFEFFcode,description,unit\r\nT-01,"بتن، با ""عیار"" مشخص",مترمکعب\r\n'),
    [["code", "description", "unit"], ["T-01", 'بتن، با "عیار" مشخص', "مترمکعب"]]);
  assert.deepEqual(parseCsv("کد;شرح;واحد\nT-02;شرح دوم;عدد"), [["کد", "شرح", "واحد"], ["T-02", "شرح دوم", "عدد"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  assert.throws(() => parseCsv('a,b\n"open,1'), /نقل‌قول/);
});

test("pricebook tables are validated row by row and nothing is guessed", () => {
  const good = validatePricebookTable([
    ["کد", "عنوان فصل", "شرح", "واحد", "بهای واحد (ریال)", "شرایط"],
    ["T-۰۱", "بتن درجا (آزمایشی)", "ردیف آزمایشی بتن", "مترمکعب", "۱٬۲۵۰٬۰۰۰", "فقط آزمون"],
    ["", "", "", "", "", ""],
    ["T-02", "", "ردیف بدون بها", "عدد", "", ""],
  ]);
  assert.deepEqual(good.errors, []);
  assert.equal(good.skippedEmpty, 1);
  assert.deepEqual(good.rows[0], {
    code: "T-01", chapterCode: null, chapterTitle: "بتن درجا (آزمایشی)", description: "ردیف آزمایشی بتن", unit: "مترمکعب",
    unitPriceRial: "1250000", conditions: "فقط آزمون", notes: null, page: null,
  });
  assert.equal(good.rows[1].unitPriceRial, null);
  assert.equal(good.rows[1].chapterTitle, null);

  const bad = validatePricebookTable([
    ["code", "description", "unit", "price"],
    ["T-01", "الف", "عدد", "10"], ["T-01", "ب", "عدد", "10"], ["T-03", "", "عدد", "abc"], ["bad code!", "ج", "", "-5"], ["T-05", "د", "عدد", "1.234"],
  ]);
  assert.equal(bad.rows.length, 1);
  for (const pattern of [/تکراری/, /شرح ردیف خالی/, /بهای واحد/, /کد ردیف معتبر نیست/, /واحد ردیف خالی/]) {
    assert(bad.errors.some((error) => pattern.test(error)), String(pattern));
  }
  assert(bad.errors.every((error) => /^سطر \d+:/.test(error)));
  assert.match(validatePricebookTable([["description", "unit"], ["x", "y"]]).errors[0], /ستون الزامی «کد»/);
  assert.match(validatePricebookTable([]).errors[0], /خالی/);
  assert.match(validatePricebookTable([["code", "description", "unit"]]).errors[0], /هیچ ردیف/);
});

test("units are compared after normalisation only, without conversion", () => {
  assert.equal(normalizeUnit("متر مکعب"), normalizeUnit("مترمکعب"));
  assert.equal(normalizeUnit("مترطول"), "متر");
  assert.equal(normalizeUnit("كيلوگرم"), normalizeUnit("کیلوگرم"));
  assert.notEqual(normalizeUnit("مترمربع"), normalizeUnit("مترمکعب"));
  assert.notEqual(normalizeUnit("تن"), normalizeUnit("کیلوگرم"));
});

test("matching is a ranked suggestion with reasons and never relies on text alone", () => {
  const result = suggestMatches({ title: "بتن فونداسیون با مقاومت 25 مگاپاسکال", category: "بتن‌ریزی", unit: "مترمکعب" }, items);
  assert.equal(result[0].item.code, "T-0801");
  assert(result[0].unitOk && result[0].confirmable);
  assert(result[0].reasons.some((reason) => /مشخصه عددی مشترک: 25/.test(reason)));
  assert(result[0].reasons.some((reason) => /واحد ردیف/.test(reason)));
  assert.equal(result[0].breakdown.unit, 30);

  const second = result.find((entry) => entry.item.code === "T-0802")!;
  assert(second.unitOk, "unit with a space must still match");
  assert(second.score < result[0].score);
  assert(second.cautions.some((caution) => /25/.test(caution)));
  assert(second.cautions.some((caution) => /شرایط کاربرد/.test(caution)));

  const mismatch = result.find((entry) => entry.item.code === "T-0803")!;
  assert.equal(mismatch.unitOk, false);
  assert.equal(mismatch.confirmable, false);
  assert(mismatch.cautions.some((caution) => /تأیید ممکن نیست/.test(caution)));
  assert(result.indexOf(mismatch) > result.indexOf(second), "unit-compatible rows are listed first");
  assert(!result.some((entry) => entry.item.code === "T-0701"), "rows with no operational overlap are not suggested");
});

test("a unit match alone is not a suggestion and rows without a price cannot be confirmed", () => {
  assert.deepEqual(suggestMatches({ title: "نصب درب چوبی", category: "درب و پنجره", unit: "کیلوگرم" }, items), []);
  const rebar = suggestMatches({ title: "میلگرد آجدار فونداسیون", category: "آرماتوربندی", unit: "کیلوگرم" }, items);
  assert.equal(rebar[0].item.code, "T-0701");
  assert(rebar[0].confirmable);
  const unpriced = suggestMatches({ title: "بتن‌ریزی در ارتفاع", category: "بتن‌ریزی", unit: "مترمربع" }, items).find((entry) => entry.item.code === "T-0803")!;
  assert(unpriced.unitOk);
  assert.equal(unpriced.confirmable, false);
});

test("pricebook import rejects ambiguous columns and unsafe numeric grouping", () => {
  const duplicate = validatePricebookTable([["code", "description", "شرح", "unit"], ["1", "الف", "ب", "عدد"]]);
  assert(duplicate.errors.some((error) => /تکراری/.test(error)));
  assert(validatePricebookTable([["code", "description", "unit", "نام ناشناس"], ["1", "الف", "عدد", "ب"]]).errors.some((error) => /شناخته نمی‌شود/.test(error)));
  assert(validatePricebookTable([["code", "description", "unit", ""], ["1", "الف", "عدد", "ب"]]).errors.some((error) => /بدون عنوان/.test(error)));
  assert(validatePricebookTable([["code", "description", "unit"], ["1,2", "الف", "عدد"]]).errors.some((error) => /کد ردیف معتبر نیست/.test(error)));
  const extra = validatePricebookTable(parseCsv("code,description,unit,price\nA,ردیف,عدد,1,000"));
  assert(extra.errors.some((error) => /تعداد ستون/.test(error)));
  for (const price of ["1,20", "1٬23", "1٬234,567", "1,,000"]) {
    assert(validatePricebookTable([["code", "description", "unit", "price"], ["A", "ردیف", "عدد", price]]).errors.some((error) => /بهای واحد/.test(error)), price);
  }
  const grouped = validatePricebookTable(parseCsv('code,description,unit,price\nA,ردیف,عدد,"1,234,567.89"'));
  assert.deepEqual(grouped.errors, []);
  assert.equal(grouped.rows[0].unitPriceRial, "1234567.89");
  assert.throws(() => parseCsv('code,description,unit\nA,در"ب,عدد'), /نقل‌قول/);
  assert.throws(() => parseCsv('code,description,unit\nA,"در"ب,عدد'), /نقل‌قول/);
  assert.deepEqual(parseCsv('"code,foo";description;unit\nA;ردیف;عدد'), [["code,foo", "description", "unit"], ["A", "ردیف", "عدد"]]);
});
