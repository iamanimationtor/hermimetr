import assert from "node:assert/strict";
const base = process.env.METRA_BASE || "http://127.0.0.1:3000";
async function request(path, init = {}) {
  const res = await fetch(`${base}${path}`, init);
  const json = await res.json().catch(() => ({}));
  return { res, json };
}
async function json(path, method, body, expectedStatus) {
  const r = await fetch(`${base}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (expectedStatus !== undefined) assert.equal(r.status, expectedStatus, `${method} ${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
}
let cookie = "";
function authHeader() { return cookie ? { Cookie: cookie } : {}; }
async function authJson(path, method, body, expectedStatus) {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", ...authHeader() }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (expectedStatus !== undefined) assert.equal(r.status, expectedStatus, `${method} ${path} ${r.status} ${JSON.stringify(j)}`);
  return { res: r, json: j };
}
const email = `progress_${Date.now()}@example.com`;
const pass = "progress-" + "x".repeat(10);
let reg = await request("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", email, password: pass, name: "پیشرفت" }) });
assert.equal(reg.res.status, 200, JSON.stringify(reg.json));
cookie = reg.res.headers.get("set-cookie")?.split(";")[0] || "";
const fields = { name: "پروژه پیشرفت", code: "PROG-001", type: "مسکونی", province: "تهران", city: "تهران", area: "250", floors: 2, basements: 0, structure: "بتنی", foundation: "گسترده", employer: "", contractor: "", contractType: "", fundingType: "private", pricingBasis: "market", contractReference: "", estimateDate: "1404/01/01", stage: "detailed", notes: "آزمایش پیشرفت" };
let pr = await authJson("/api/projects", "POST", fields, 201); const projectId = pr.json.project.id;
// create two takeoff rows: one volume (m3) and one count (عدد)
const t1 = await authJson("/api/takeoffs", "POST", { projectId, title: "بتن مگر", category: "بتن‌ریزی", floor: "همکف", location: "محور A", kind: "volume", length: "2", width: "5", height: "1", count: "1", deduction: "0", sourceNote: "نقشه الف", ruleReference: "", documentId: null }, 201);
const t2 = await authJson("/api/takeoffs", "POST", { projectId, title: "میلگرد", category: "آرماتور", floor: "همکف", location: "محور A", kind: "count", length: "", width: "", height: "", count: "4", deduction: "0", sourceNote: "نقشه ب", ruleReference: "", documentId: null }, 201);
await authJson("/api/takeoffs", "PATCH", { id: t1.json.item.id, action: "confirm" }, 200);
await authJson("/api/takeoffs", "PATCH", { id: t2.json.item.id, action: "confirm" }, 200);
// prices must match units: مترمکعب and عدد
let price1 = await authJson("/api/prices", "POST", { title: "بهای بتن", unit: "مترمکعب", basis: "market", amount: "1000", currency: "IRR", sourceName: "بازار", priceDate: "۱۴۰۴/۰۱/۰۱", confirmed: true }, 201);
let price2 = await authJson("/api/prices", "POST", { title: "بهای میلگرد", unit: "عدد", basis: "market", amount: "500", currency: "IRR", sourceName: "بازار", priceDate: "۱۴۰۴/۰۱/۰۱", confirmed: true }, 201);
// assign
await authJson("/api/takeoffs", "PATCH", { id: t1.json.item.id, action: "assignPrice", priceId: price1.json.item.id }, 200);
await authJson("/api/takeoffs", "PATCH", { id: t2.json.item.id, action: "assignPrice", priceId: price2.json.item.id }, 200);
// estimate
let est = await authJson("/api/estimates", "POST", { projectId }, 201); const snapshotId = est.json.snapshot.id;
assert.equal(est.json.snapshot.totalRial, "12000");
// progress
let g = await authJson(`/api/progress?snapshotId=${snapshotId}`, "GET", undefined, 200); assert.equal(g.json.reports.length, 0);
const r1 = await authJson("/api/progress", "POST", { action: "create", snapshotId, expectedSequence: 0, expectedActiveId: null, period: "مهر ۱۴۰۴ – دوره ۱", rows: [{ takeoffId: t1.json.item.id, currentQuantity: "6.0000", evidence: "صورت‌جلسه ۱" }, { takeoffId: t2.json.item.id, currentQuantity: "2", evidence: "فاکتور ۱" }], attest: true }, 201); assert.equal(r1.json.report.totals.periodRial, "7000");
let g2 = await authJson(`/api/progress?snapshotId=${snapshotId}`, "GET", undefined, 200); const activeId = g2.json.reports.find((x)=>!x.voidedAt).id; const seq = g2.json.reports.find((x)=>!x.voidedAt).sequence;
const rBad = await authJson("/api/progress", "POST", { action: "create", snapshotId, expectedSequence: seq, expectedActiveId: activeId, period: "آبان", rows: [{ takeoffId: t1.json.item.id, currentQuantity: "5", evidence: "کمتر" }, { takeoffId: t2.json.item.id, currentQuantity: "2", evidence: "قبض ۱" }], attest: true }, 400);
const stale = await authJson("/api/progress", "POST", { action: "create", snapshotId, expectedSequence: 0, expectedActiveId: null, period: "دوره تکراری", rows: [{ takeoffId: t1.json.item.id, currentQuantity: "7", evidence: "صورت‌جلسه" }, { takeoffId: t2.json.item.id, currentQuantity: "2", evidence: "قبض ۱" }], attest: true }, 409);
const r2 = await authJson("/api/progress", "POST", { action: "create", snapshotId, expectedSequence: 1, expectedActiveId: activeId, period: "آبان ۱۴۰۴ – دوره ۲", rows: [{ takeoffId: t1.json.item.id, currentQuantity: "10.0000", evidence: "صورت‌جلسه ۲" }, { takeoffId: t2.json.item.id, currentQuantity: "2", evidence: "فاکتور ۱" }], attest: true }, 201);
const v = await authJson("/api/progress", "POST", { action: "void", snapshotId, reportId: r1.json.report.id, expectedSequence: 2, reason: "تست ابطال گزارش قدیمی باید رد شود" }, 409);
const v2 = await authJson("/api/progress", "POST", { action: "void", snapshotId, reportId: r2.json.report.id, expectedSequence: 2, reason: "اصلاح مقدار به دلیل اشتباه ثبتی" }, 200);
let g3 = await authJson(`/api/progress?snapshotId=${snapshotId}`, "GET", undefined, 200); assert.equal(g3.json.reports.filter((x)=>!x.voidedAt).length, 1);
// isolation: other user cannot see
let other = await request("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", email: `other_${Date.now()}@example.com`, password: pass, name: "دیگر" }) }); assert.equal(other.res.status, 200);
let otherCookie = other.res.headers.get("set-cookie")?.split(";")[0] || "";
let otherFetch = await fetch(`${base}/api/progress?snapshotId=${snapshotId}`, { headers: { Cookie: otherCookie } }); assert.equal(otherFetch.status, 404);
console.log("✓ progress sequential, stale, void, isolation");
