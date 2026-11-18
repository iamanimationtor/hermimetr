import assert from "node:assert/strict";
import test from "node:test";
import { calculateEstimate, calculateQuantity, decimal, normalizeDigits, toRial } from "./calculations";

test("geometric length, area, volume, count and weight are reproducible", () => {
  assert.deepEqual(calculateQuantity({ kind: "length", length: "42", count: "2" }), { quantity: "84.0000", formula: "42 × 2", unit: "متر" });
  assert.deepEqual(calculateQuantity({ kind: "area", length: "20", width: "3", count: "2", deduction: "12" }),
    { quantity: "108.0000", formula: "(20 × 3 × 2) − 12", unit: "مترمربع" });
  assert.equal(calculateQuantity({ kind: "volume", length: "12", width: "8", height: "0.5" }).quantity, "48.0000");
  assert.equal(calculateQuantity({ kind: "count", count: "8", deduction: "2" }).quantity, "6.0000");
  assert.equal(calculateQuantity({ kind: "weight", unitWeight: "2.125", count: "4" }).quantity, "8.5000");
});

test("Persian numerals, precise decimals and declared rounding are deterministic", () => {
  assert.equal(normalizeDigits("۱٬۲۳۴٫۵۰"), "1234.50");
  assert.equal(decimal("٢٥٫٧٥").toString(), "25.75");
  assert.equal(calculateQuantity({ kind: "area", length: "۰٫۱", width: "۰٫۲", count: "۱" }).quantity, "0.0200");
  assert.equal(calculateQuantity({ kind: "area", length: "1.0001", width: "0.5" }).quantity, "0.5001");
  assert.equal(toRial("12.30", "IRT").toString(), "123");
  assert.equal(toRial("12.30", "IRR").toString(), "12.3");
});

test("invalid geometry and deductions are rejected", () => {
  assert.throws(() => calculateQuantity({ kind: "volume", length: "4", width: "2", height: "-1" }));
  assert.throws(() => calculateQuantity({ kind: "area", length: "4", width: "2", deduction: "9" }), /کسر/);
  assert.throws(() => calculateQuantity({ kind: "count", count: "1.5" }), /صحیح/);
  assert.throws(() => calculateQuantity({ kind: "count", count: "2", deduction: "0.5" }), /صحیح/);
  assert.throws(() => calculateQuantity({ kind: "length", length: "0" }), /بزرگ/);
  assert.throws(() => calculateQuantity({ kind: "length", length: "1.00001" }), /چهار رقم/);
  assert.throws(() => calculateQuantity({ kind: "volume", length: "99999999999999", width: "99999999999999", height: "2" }), /محدوده/);
});

const row = { id: "r1", title: "حجم هندسی", quantity: "2.5000", unit: "مترمکعب", formula: "5 × 1 × 0.5 × 1", sourceNote: "نقشه بازبینی‌شده A-01", status: "confirmed", priceId: "p1", isDemo: false };
const price = { id: "p1", title: "بهای دستی", unit: "مترمکعب", amount: "123.40", currency: "IRT", basis: "market", confirmed: true, sourceName: "پیش‌فاکتور نمونه آزمایشی", priceDate: "1404/01/01", referenceId: null };

test("market estimate uses exact unit conversion, line rounding and total", () => {
  const result = calculateEstimate([row], [price], "market");
  assert.deepEqual(result.issues, []);
  assert.equal(result.lines[0].unitPriceRial, "1234.00");
  assert.equal(result.lines[0].amountRial, "3085");
  assert.equal(result.totalRial, "3085");
  assert.equal(result.draftCount, 0);
});

test("draft, educational, missing source, mismatch and missing price never yield a complete version", () => {
  assert.equal(calculateEstimate([{ ...row, status: "draft" }], [price], "market").lines.length, 0);
  assert.match(calculateEstimate([{ ...row, isDemo: true }], [price], "market").issues.join(" "), /آموزشی/);
  assert.match(calculateEstimate([{ ...row, sourceNote: "" }], [price], "market").issues.join(" "), /منبع/);
  assert.match(calculateEstimate([row], [{ ...price, unit: "عدد" }], "market").issues.join(" "), /واحد/);
  assert.match(calculateEstimate([row], [], "market").issues.join(" "), /بهای واحد/);
  assert.match(calculateEstimate([row], [{ ...price, confirmed: false }], "market").issues.join(" "), /تأیید/);
});

test("official estimate requires explicit contract and verified pricebook reference", () => {
  const official = { ...price, basis: "official", referenceId: "ref1" };
  assert.match(calculateEstimate([row], [official], "official", { verifiedReferenceIds: ["ref1"] }).issues.join(" "), /پیمان/);
  assert.match(calculateEstimate([row], [official], "official", { contractReference: "بند پیمان" }).issues.join(" "), /تأیید نشده/);
  const ready = calculateEstimate([row], [official], "official", { contractReference: "بند پیمان", verifiedReferenceIds: ["ref1"] });
  assert.deepEqual(ready.issues, []);
  assert.equal(ready.totalRial, "3085");
});
