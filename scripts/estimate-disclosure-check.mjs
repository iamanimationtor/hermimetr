// Verify that all estimate outputs expose omissions from the immutable snapshot, not live data.
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
let cookie = "";
async function request(path, method = "GET", body) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  cookie = response.headers.get("set-cookie")?.match(/metra_session=[^;]+/)?.[0] || cookie;
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response;
}
async function json(path, method = "GET", body) { return (await request(path, method, body)).json(); }

await json("/api/workspace");
const project = (await json("/api/projects", "POST", { name: "کنترل شفافیت خروجی", type: "مسکونی", floors: 1, basements: 0,
  fundingType: "private", pricingBasis: "market", stage: "preliminary" })).project;
const row = (await json("/api/takeoffs", "POST", { projectId: project.id, title: "ردیف تأییدشده", category: "آزمایش", kind: "count", count: "2", sourceNote: "نقشه آزمایشی" })).item;
const price = (await json("/api/prices", "POST", { title: "قیمت آزمایشی", unit: "عدد", basis: "market", amount: "100", currency: "IRR", sourceName: "آزمایش", priceDate: "1404/01/01", confirmed: true })).item;
await json("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: price.id });
await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" });
const draft = (await json("/api/takeoffs", "POST", { projectId: project.id, title: "ردیف پیش‌نویس", category: "آزمایش", kind: "count", count: "3", sourceNote: "نقشه آزمایشی" })).item;
const snapshot = (await json("/api/estimates", "POST", { projectId: project.id })).snapshot;
assert.equal(snapshot.projectSnapshot.includedDraftRows, 1);
// Later changes cannot alter the omission disclosure of an already-issued version.
await json("/api/takeoffs", "DELETE", { id: draft.id });
const prefix = `/api/export?projectId=${project.id}&snapshotId=${snapshot.id}&format=`;
const csv = await (await request(prefix + "csv")).text();
assert.match(csv, /1 ردیف پیش‌نویس.*کنار گذاشته/);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(Buffer.from(await (await request(prefix + "xlsx")).arrayBuffer()));
assert.match(workbook.getWorksheet("برآورد").getCell("A2").value, /1 ردیف پیش‌نویس.*کنار گذاشته/);
assert(workbook.getWorksheet("مبانی و محدودیت‌ها").getRows(1, 10).some((r) => String(r.getCell(2).value).includes("1 ردیف پیش‌نویس")));
const data = await json(prefix + "json");
assert.equal(data.snapshot.projectSnapshot.includedDraftRows, 1);
const html = await (await request(`/report/${snapshot.id}`)).text();
assert.match(html, /1 ردیف پیش‌نویس.*کنار گذاشته/);
console.log("✓ frozen draft exclusion is disclosed in HTML, CSV, XLSX and JSON after live data changes");
