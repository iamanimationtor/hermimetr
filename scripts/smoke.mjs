import assert from "node:assert/strict";
import ExcelJS from "exceljs";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
let cookie = "";
let otherCookie = "";
async function request(path, method = "GET", payload, useOther = false) {
  const headers = {};
  if (useOther ? otherCookie : cookie) headers.Cookie = useOther ? otherCookie : cookie;
  if (payload && !(payload instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: payload ? payload instanceof FormData ? payload : JSON.stringify(payload) : undefined });
  const newCookie = response.headers.get("set-cookie")?.match(/metra_session=[^;]+/)?.[0];
  if (newCookie) { if (useOther) otherCookie = newCookie; else cookie = newCookie; }
  return response;
}
async function json(path, method, payload, expected = 200, useOther = false) {
  const response = await request(path, method, payload, useOther);
  const body = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`);
  return body;
}

const initial = await json("/api/workspace", "GET");
assert.equal(initial.user.isGuest, true);
assert.equal(initial.projects.length, 3);
assert(initial.projects.every((p) => p.isDemo));
const demoBlocked = await json("/api/estimates", "POST", { projectId: initial.projects[0].id }, 400);
assert.match(demoBlocked.error, /آموزشی/);
console.log("✓ isolated guest, educational samples and blocked demo snapshots");

const fields = { name: "آزمون یکپارچه مستقل", code: "SMOKE-001", type: "مسکونی", province: "تهران", city: "تهران", area: "250",
  floors: 2, basements: 1, structure: "بتنی", foundation: "گسترده", employer: "", contractor: "", contractType: "",
  fundingType: "private", pricingBasis: "market", contractReference: "", estimateDate: "1404/01/01", stage: "detailed", notes: "آزمایش خودکار؛ قیمت رسمی نیست" };
const blockedOfficial = await json("/api/projects", "POST", { ...fields, pricingBasis: "official" }, 400);
assert.match(blockedOfficial.error, /پیمان/);
const untrustedReference = (await json("/api/references", "POST", { title: "سند غیررسمی آزمایشی", kind: "pricebook", issuer: "منبع آزمایشی",
  documentNumber: "TEST", issueDate: "1404/01/01", effectiveDate: "1404/01/01", basePeriod: "1404",
  scope: "صرفاً آزمون", amendments: "", replacement: "", url: "https://example.com/not-official", notes: "آزمون رد منبع" }, 201)).item;
const rejectedSource = await json("/api/references", "PATCH", { id: untrustedReference.id, action: "status", status: "verified" }, 400);
assert.match(rejectedSource.error, /mporg.ir/);
const project = (await json("/api/projects", "POST", fields, 201)).project;
assert.equal(project.isDemo, false);
const takeoffInput = { projectId: project.id, title: "حجم هندسی نمونه آزمایش", category: "بتن‌ریزی", floor: "همکف", location: "محور A-1",
  kind: "volume", length: "2.5", width: "2", height: "0.65", count: "1", unitWeight: "", deduction: "0",
  sourceNote: "ابعاد آزمایشی بازبینی‌شده توسط آزمون", ruleReference: "هندسه پایه؛ بدون ضابطه رسمی", documentId: null };
const item = (await json("/api/takeoffs", "POST", takeoffInput, 201)).item;
assert.equal(item.quantity, "3.2500");
assert.equal(item.status, "draft");
await json("/api/takeoffs", "PATCH", { id: item.id, action: "confirm" });
const missing = await json(`/api/estimates?projectId=${project.id}`, "GET");
assert(missing.issues.some((message) => message.includes("بهای واحد")));
assert.equal((await json("/api/estimates", "POST", { projectId: project.id }, 400)).error.includes("نسخه ثابت"), true);
console.log("✓ calculation, human confirmation and blocked incomplete estimate");

const priceInput = { title: "بهای آزمایشی بتن", code: "TEST-01", category: "آزمایش", unit: "مترمکعب", basis: "market",
  amount: "420000", currency: "IRR", sourceName: "پیش‌فاکتور آزمایشی (غیرواقعی)", sourceUrl: "", supplier: "تأمین‌کننده آزمایشی",
  region: "تهران", priceDate: "1404/01/01", validUntil: "", referenceId: null, confirmed: true };
assert.match((await json("/api/prices", "POST", { ...priceInput, priceDate: "unknown" }, 400)).error, /تاریخ قیمت/);
const price = (await json("/api/prices", "POST", priceInput, 201)).item;
await json("/api/takeoffs", "PATCH", { id: item.id, action: "assignPrice", priceId: price.id });
const ready = await json(`/api/estimates?projectId=${project.id}`, "GET");
assert.deepEqual(ready.issues, []);
assert.equal(ready.totalRial, "1365000");
const snap1 = (await json("/api/estimates", "POST", { projectId: project.id, notes: "نسخه آزمایش ۱" }, 201)).snapshot;
assert.equal(snap1.version, 1);
console.log("✓ documented market price, exact arithmetic and immutable snapshot");

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lH8AAAAASUVORK5CYII=", "base64");
const upload = new FormData(); upload.append("projectId", project.id); upload.append("version", "نسخه آزمون"); upload.append("file", new Blob([png], { type: "image/png" }), "test-plan.png");
const docResponse = await request("/api/documents", "POST", upload);
const uploadedBody = await docResponse.json();
assert.equal(docResponse.status, 201, JSON.stringify(uploadedBody));
const document = uploadedBody.document;
const downloaded = await request(`/api/documents?id=${document.id}`);
assert.equal(downloaded.status, 200);
assert.equal(downloaded.headers.get("content-type"), "image/png");
assert.equal(Buffer.from(await downloaded.arrayBuffer()).compare(png), 0);
await json("/api/workspace", "GET", undefined, 200, true);
assert.equal((await request(`/api/documents?id=${document.id}`, "GET", undefined, true)).status, 404);
assert.equal((await json("/api/takeoffs", "POST", takeoffInput, 404, true)).error.includes("دسترسی"), true);
console.log("✓ file persistence and cross-session project isolation");

const refUrl = `/api/export?projectId=${project.id}&snapshotId=${snap1.id}`;
const xlsxResponse = await request(`${refUrl}&format=xlsx`);
assert.equal(xlsxResponse.status, 200);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(Buffer.from(await xlsxResponse.arrayBuffer()));
const sheet = workbook.getWorksheet("برآورد");
assert.equal(sheet.getCell("F5").value.formula, "ROUND(D5*E5,0)");
assert.equal(sheet.getCell("F5").value.result, 1365000);
assert.equal(sheet.getCell("F6").value.formula, "SUM(F5:F5)");
const report = await request(`/report/${snap1.id}`);
assert.equal(report.status, 200);
assert((await report.text()).includes("آزمون یکپارچه مستقل"));
console.log("✓ real Excel formulas, cached results and printable Persian report");

await json("/api/prices", "PATCH", { ...priceInput, id: price.id, amount: "500000" });
const snap2 = (await json("/api/estimates", "POST", { projectId: project.id, notes: "نسخه آزمایش ۲" }, 201)).snapshot;
assert.equal(snap2.totalRial, "1625000");
const frozen = await json(`${refUrl}&format=json`, "GET");
assert.equal(frozen.snapshot.totalRial, "1365000");
assert.equal(frozen.snapshot.rows[0].unitPriceRial, "420000.00");
const csv = await request(`${refUrl}&format=csv`);
assert.equal(csv.status, 200);
assert((await csv.text()).includes("1365000"));
console.log("✓ historic version exports remain unchanged after price edits");

const concurrent = await Promise.all(Array.from({ length: 5 }, () => json("/api/estimates", "POST", { projectId: project.id }, 201)));
assert.deepEqual(concurrent.map((entry) => entry.snapshot.version).sort((a, b) => a - b), [3, 4, 5, 6, 7]);
console.log("✓ concurrent snapshots complete without pool starvation and receive unique versions");

await json("/api/projects", "DELETE", { id: project.id, confirmName: "wrong" }, 400);
await json("/api/projects", "DELETE", { id: project.id, confirmName: project.name });
await json("/api/references", "DELETE", { id: untrustedReference.id });
console.log("✓ controlled deletion and cascade cleanup");
const email = `metra-smoke-${Date.now()}@example.test`;
const password = "SmokeOnly#2026Strong";
const account = await json("/api/auth", "POST", { action: "register", email, password, name: "کاربر آزمون" });
assert.equal(account.user.id, initial.user.id);
assert.equal((await json("/api/workspace", "GET")).projects.length, 3);
await json("/api/auth", "POST", { action: "logout" });
const relogin = await json("/api/auth", "POST", { action: "login", email, password });
assert.equal(relogin.user.id, account.user.id);
assert.equal((await json("/api/workspace", "GET")).user.email, email);
console.log("✓ guest-to-account upgrade and persistent authenticated ownership");
console.log("Smoke test passed.");
