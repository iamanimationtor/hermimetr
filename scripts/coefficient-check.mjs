// Synthetic-only end-to-end checks: no official rates or legal claims are implied.
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const jars = { owner: "", other: "" };
async function request(path, method = "GET", body, jar = "owner") {
  const headers = {};
  if (jars[jar]) headers.Cookie = jars[jar];
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  jars[jar] = response.headers.get("set-cookie")?.match(/metra_session=[^;]+/)?.[0] || jars[jar];
  return response;
}
async function json(path, method = "GET", body, expected = 200, jar = "owner") {
  const response = await request(path, method, body, jar);
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
await json("/api/workspace");
await json("/api/workspace", "GET", undefined, 200, "other");
const project = (await json("/api/projects", "POST", { name: "آزمون ضرایب فرضی", type: "مسکونی", floors: 1, basements: 0,
  fundingType: "private", pricingBasis: "market", stage: "preliminary" }, 201)).project;
const row = (await json("/api/takeoffs", "POST", { projectId: project.id, title: "آزمایشی", category: "آزمایش", kind: "count", count: "1", sourceNote: "نقشه فرضی" }, 201)).item;
const priceFields = { title: "بهای آزمایشی", unit: "عدد", basis: "market", amount: "12345", currency: "IRR", sourceName: "داده فرضی", priceDate: "1404/01/01", confirmed: true };
const price = (await json("/api/prices", "POST", priceFields, 201)).item;
await json("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: price.id });
await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" });
const path = `/api/estimates?projectId=${project.id}`;
let preview = await json(path);
assert.equal(preview.totalRial, "12345");
assert.match(preview.reviewHash, /^[a-f0-9]{64}$/);
const factors = [{ label: "ضریب اول آزمایشی", multiplier: "۱٫۱", source: "بند فرضی ۱" }, { label: "ضریب دوم آزمایشی", multiplier: "0.95", source: "بند فرضی ۲" }];
const payload = (hash, attestScope = true) => ({ projectId: project.id, coefficientScenario: { factors, attestScope, expectedReviewHash: hash } });
await json("/api/estimates", "POST", payload(preview.reviewHash, false), 400);
await json("/api/estimates", "POST", { ...payload(preview.reviewHash), coefficientScenario: { ...payload(preview.reviewHash).coefficientScenario, factors: [{ label: "x", multiplier: "100", source: "test" }] } }, 400);
await json("/api/estimates", "POST", payload(preview.reviewHash), 404, "other");
// Even if the sum remains the same, changed source data invalidates the review fingerprint.
await json("/api/prices", "PATCH", { ...priceFields, id: price.id, sourceName: "سند فرضی جدید" });
await json("/api/estimates", "POST", payload(preview.reviewHash), 409);
preview = await json(path);
const snapshot = (await json("/api/estimates", "POST", payload(preview.reviewHash), 201)).snapshot;
assert.equal(snapshot.totalRial, "12345"); // the original direct total is never replaced
const scenario = snapshot.projectSnapshot.coefficientScenario;
assert.equal(scenario.steps[0].outputRial, "13580");
assert.equal(scenario.finalTotalRial, "12901");
assert.equal(snapshot.projectSnapshot.coefficientReview.scopeAttested, true);
assert.equal(snapshot.projectSnapshot.coefficientReview.reviewHash, preview.reviewHash);
assert.match(snapshot.projectSnapshot.coefficientReview.confirmedAt, /^\d{4}-\d{2}-\d{2}T/);
const prefix = `/api/export?projectId=${project.id}&snapshotId=${snapshot.id}&format=`;
const jsonBefore = await json(prefix + "json");
assert.deepEqual(jsonBefore.snapshot.projectSnapshot.coefficientScenario, scenario);
const csv = await (await request(prefix + "csv")).text();
assert(csv.includes('"12345"') && csv.includes('"12901"') && csv.includes("بند فرضی ۲"));
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(Buffer.from(await (await request(prefix + "xlsx")).arrayBuffer()));
assert.equal(workbook.getWorksheet("برآورد").getCell("F6").value.result, 12345);
const sheet = workbook.getWorksheet("سناریوی ضرایب");
assert(sheet);
assert.equal(sheet.getCell("D3").value, "12345");
assert.equal(sheet.getCell("E3").value, "13580");
assert.equal(sheet.getCell("E5").value, "12901");
assert.equal(typeof sheet.getCell("E5").value, "string");
const report = await (await request(`/report/${snapshot.id}`)).text();
assert(report.includes("سناریوی دستی ضرایب") && report.includes("۱۲٬۹۰۱") && report.includes("بند فرضی ۲"));
await json("/api/prices", "PATCH", { ...priceFields, id: price.id, amount: "1" });
assert.deepEqual(await json(prefix + "json"), jsonBefore, "the frozen scenario must not follow later price changes");
await json(prefix + "json", "GET", undefined, 404, "other");
const newest = await json(path);
const concurrent = await Promise.all(Array.from({ length: 5 }, () => json("/api/estimates", "POST", payload(newest.reviewHash), 201)));
assert.deepEqual(concurrent.map((entry) => entry.snapshot.version).sort((a, b) => a - b), [2, 3, 4, 5, 6]);
assert(concurrent.every((entry) => entry.snapshot.totalRial === "1" && entry.snapshot.projectSnapshot.coefficientScenario.finalTotalRial === "1"));
console.log("✓ exact sequential scenario, review binding, attestation, isolation, frozen HTML/CSV/XLSX/JSON and concurrent snapshots");
