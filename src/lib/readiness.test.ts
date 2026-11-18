import test from "node:test";
import assert from "node:assert/strict";
import { buildReadiness } from "./readiness.js";

test("readiness blocks demo and missing official reference", () => {
  const r = buildReadiness(
    { id: "p1", name: "P", pricingBasis: "official", contractReference: "", stage: "detailed", isDemo: true },
    [],
    [],
    [],
    {},
    false
  );
  assert.equal(r.blocked, true);
  assert.ok(r.exportBlockedReason);
  assert.ok(r.items.some((i) => i.id === "demo" && i.status === "blocked"));
  assert.ok(r.items.some((i) => i.id === "verifiedRef"));
});

test("readiness ready when all linked", () => {
  const r = buildReadiness(
    { id: "p1", name: "P", pricingBasis: "market", contractReference: null, stage: "detailed", isDemo: false },
    [{ id: "t1", projectId: "p1", title: "T", quantity: "10.0000", unit: "مترمکعب", status: "confirmed", isDemo: false, sourceNote: "نقشه A", priceId: "pr1", pricebookItemId: null, certainty: null }],
    [{ id: "pr1", unit: "مترمکعب", basis: "market", amount: "1000", currency: "IRR", sourceName: "بازار", priceDate: "1404/01/01", confirmed: true, referenceId: null }],
    [],
    { t1: { state: "ok" } },
    true
  );
  assert.equal(r.blocked, false);
  assert.equal(r.exportBlockedReason, null);
});

test("readiness blocks missing price and source", () => {
  const r = buildReadiness(
    { id: "p1", name: "P", pricingBasis: "market", contractReference: null, stage: "detailed", isDemo: false },
    [{ id: "t1", projectId: "p1", title: "T", quantity: "10.0000", unit: "مترمکعب", status: "confirmed", isDemo: false, sourceNote: "", priceId: null, pricebookItemId: null, certainty: null }],
    [],
    [],
    {},
    true
  );
  assert.equal(r.blocked, true);
  assert.ok(r.previewBlockedReasons.some((m) => m.includes("منبع مقدار")));
  assert.ok(r.previewBlockedReasons.some((m) => m.includes("بهای واحد")));
});
