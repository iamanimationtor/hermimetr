import test from "node:test";
import assert from "node:assert/strict";
import { calculateProgress } from "./progress.js";

const frozen = [{ takeoffId: "550e8400-e29b-41d4-a716-446655440001", title: "بتن مگر", unit: "مترمکعب", quantity: "10.0000", unitPriceRial: "1000.00", amountRial: "10000" }, { takeoffId: "550e8400-e29b-41d4-a716-446655440002", title: "میلگرد", unit: "عدد", quantity: "4.0000", unitPriceRial: "500.00", amountRial: "2000" }];
const total = "12000";

test("progress calculates period from rounded cumulatives", () => {
  const first = calculateProgress(frozen, total, null, [{ takeoffId: frozen[0].takeoffId, currentQuantity: "6", evidence: "صورت‌جلسه ۱" }, { takeoffId: frozen[1].takeoffId, currentQuantity: "2", evidence: "قبض ۱" }]);
  assert.equal(first.totals.periodRial, "7000"); assert.equal(first.totals.cumulativeRial, "7000");
  const second = calculateProgress(frozen, total, first.rows as unknown[], [{ takeoffId: frozen[0].takeoffId, currentQuantity: "10.0000", evidence: "صورت‌جلسه ۲" }, { takeoffId: frozen[1].takeoffId, currentQuantity: "2", evidence: "قبض ۱" }]);
  assert.equal(second.rows[0].periodQuantity, "4.0000"); assert.equal(second.totals.periodRial, "4000");
});

test("progress rejects overflow, integer violation and missing evidence", () => {
  assert.throws(() => calculateProgress(frozen, total, null, [{ takeoffId: frozen[0].takeoffId, currentQuantity: "11", evidence: "صورت‌جلسه" }, { takeoffId: frozen[1].takeoffId, currentQuantity: "2", evidence: "قبض ۱" }]), /بیشتر/);
  assert.throws(() => calculateProgress(frozen, total, null, [{ takeoffId: frozen[0].takeoffId, currentQuantity: "5", evidence: "صورت‌جلسه ۱" }, { takeoffId: frozen[1].takeoffId, currentQuantity: "1.5", evidence: "قبض ۱" }]), /صحیح/);
  assert.throws(() => calculateProgress(frozen, total, null, [{ takeoffId: frozen[0].takeoffId, currentQuantity: "1", evidence: "اب" }, { takeoffId: frozen[1].takeoffId, currentQuantity: "0", evidence: "" }]), /منبع/);
});

test("progress rejects no change and regression", () => {
  const first = calculateProgress(frozen, total, null, [{ takeoffId: frozen[0].takeoffId, currentQuantity: "1", evidence: "صورت‌جلسه ۱" }, { takeoffId: frozen[1].takeoffId, currentQuantity: "1", evidence: "قبض ۱" }]);
  assert.throws(() => calculateProgress(frozen, total, first.rows as unknown[], [{ takeoffId: frozen[0].takeoffId, currentQuantity: "1", evidence: "صورت‌جلسه ۱" }, { takeoffId: frozen[1].takeoffId, currentQuantity: "1", evidence: "قبض ۱" }]), /هیچ پیشرفت/);
  assert.throws(() => calculateProgress(frozen, total, first.rows as unknown[], [{ takeoffId: frozen[0].takeoffId, currentQuantity: "0.5", evidence: "صورت‌جلسه ۱" }, { takeoffId: frozen[1].takeoffId, currentQuantity: "1", evidence: "قبض ۱" }]), /کمتر/);
});
