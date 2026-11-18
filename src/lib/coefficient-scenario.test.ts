import assert from "node:assert/strict";
import test from "node:test";
import { calculateCoefficientScenario, coefficientInputSchema, readCoefficientScenario } from "./coefficient-scenario";

const factors = [{ label: "ضریب فرضی", multiplier: "۱٫۱", source: "بند آزمایشی ۱" }, { label: "ضریب دوم", multiplier: "0.95", source: "بند آزمایشی ۲" }];
test("sequential multipliers, explicit scope and rial rounding are deterministic", () => {
  const scenario = calculateCoefficientScenario("12345", factors);
  assert.equal(scenario.steps[0].inputRial, "12345");
  assert.equal(scenario.steps[0].outputRial, "13580"); // 13579.5 => half up
  assert.equal(scenario.steps[1].inputRial, "13580");
  assert.equal(scenario.finalTotalRial, "12901");
  assert.equal(scenario.steps[0].multiplier, "1.1");
  assert.deepEqual(readCoefficientScenario({ coefficientScenario: scenario }), scenario);
  assert.equal(readCoefficientScenario({ coefficientScenario: { ...scenario, finalTotalRial: "1" } }), null);
  assert.equal(readCoefficientScenario({}), null);
});
test("invalid or unreviewed scenarios fail closed", () => {
  for (const multiplier of ["0", "10.000001", "-1", "1.0000001", "1,1", "1e2", "NaN", ""]) {
    assert.throws(() => calculateCoefficientScenario("100", [{ label: "آزمون", multiplier, source: "بند آزمایشی" }]));
  }
  assert.throws(() => calculateCoefficientScenario("100", [{ label: "", multiplier: "1", source: "بند آزمایشی" }]));
  assert.throws(() => calculateCoefficientScenario("100", [{ label: "الف", multiplier: "1", source: "" }]));
  assert.throws(() => calculateCoefficientScenario("999999999999999999999999", [{ label: "الف", multiplier: "10", source: "بند آزمایشی" }]), /محدوده/);
  assert.throws(() => calculateCoefficientScenario("1", Array.from({ length: 9 }, () => factors[0])));
  assert.equal(coefficientInputSchema.safeParse({ factors, attestScope: false, expectedReviewHash: "a".repeat(64) }).success, false);
});
test("calculation matches independent integer arithmetic at extremes and half-rial boundaries", () => {
  const totals = ["1", "5", "999999999999999999", "12345678901234567890123"];
  const multipliers = ["0.000001", "0.5", "1.234567", "9.999999"];
  for (const total of totals) for (const multiplier of multipliers) {
    const [whole, part = ""] = multiplier.split(".");
    const denominator = BigInt(10) ** BigInt(part.length);
    const numerator = BigInt(whole + part);
    const expected = (BigInt(total) * numerator * BigInt(2) + denominator) / (BigInt(2) * denominator);
    if (expected >= BigInt(10) ** BigInt(24)) continue;
    assert.equal(calculateCoefficientScenario(total, [{ label: "آزمایش", multiplier, source: "سند فرضی" }]).finalTotalRial, expected.toString());
  }
});
