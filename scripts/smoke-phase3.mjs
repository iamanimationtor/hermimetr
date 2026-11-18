// Phase-3 integration test against a running server: reviewer provenance, rule-change propagation,
// extended rule authoring (parameters/steps/constraints) and the new discipline scaffolding.
// All documents, rows and prices created here are synthetic test data.
import assert from "node:assert/strict";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
let cookie = "";
async function request(path, method = "GET", payload) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (payload) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  const setCookie = response.headers.get("set-cookie")?.match(/metra_session=[^;]+/)?.[0];
  if (setCookie) cookie = setCookie;
  return response;
}
async function json(path, method = "GET", payload, expected = 200) {
  const response = await request(path, method, payload);
  const body = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}
const rules = (payload, expected = 200) => json("/api/rules", "POST", payload, expected);

/* 1 ─ scaffolding for the new disciplines, still strictly geometric */
const workspace = await json("/api/workspace");
const bank = workspace.ruleBank;
assert.equal(bank.length, 29);
assert.equal(bank.filter((entry) => entry.usability.certainty === "geometric").length, 26);
assert.equal(bank.filter((entry) => entry.usability.certainty === "provisional").length, 3);
assert.equal(bank.filter((entry) => entry.usability.certainty === "definitive").length, 0, "nothing may be definitive without a verified official document");
for (const operation of ["اندودکاری", "کف‌سازی", "عایق‌کاری", "اسکلت فلزی"]) {
  const group = bank.filter((entry) => entry.definition.operation === operation);
  assert(group.length >= 2, operation);
  assert(group.every((entry) => entry.definition.basis === "geometric"), `${operation} must only contain geometric identities`);
  assert(group.every((entry) => entry.definition.citations.length === 0), `${operation} must not claim a measurement provision`);
}
const cases = (await json("/api/rules")).cases;
assert.equal(cases.length, 30);
const steel = cases.find((item) => item.id === "RC-ST1");
assert.equal((await rules({ action: "evaluate", ruleRef: "sys:steel.member_mass@1", input: steel.input })).result.quantity, "2022.1600");
const skirting = cases.find((item) => item.id === "RC-FL3");
assert.equal((await rules({ action: "evaluate", ruleRef: "sys:floor.skirting_length@1", input: skirting.input })).result.quantity, "48.6000");
console.log("✓ four new disciplines scaffolded with 12 geometric rules and 12 verified reference cases");

/* 2 ─ reviewer provenance is recorded */
const review = { action: "review", subjectType: "rule", subjectKey: "sys:plaster.wall_face_area@1", status: "approved",
  reviewerName: "بازبین آزمون مرحله سوم", reviewerCredential: "داده آزمون", reviewerRole: "technical_manager", note: "کنترل فرمول", attest: true };
await rules({ ...review, attest: false }, 400);
await rules({ ...review, reviewerRole: "unknown" }, 400);
await rules(review, 201);
let entry = (await json("/api/workspace")).ruleBank.find((item) => item.ref === "sys:plaster.wall_face_area@1");
assert.equal(entry.review.reviewerRole, "technical_manager");
assert.equal(entry.review.ruleRef, "sys:plaster.wall_face_area@1");
assert.equal(entry.review.ruleKey, "plaster.wall_face_area");
assert.equal(entry.review.ruleVersion, 1);
assert.equal(entry.review.basis, "geometric");
assert.ok(entry.review.createdAt);
const caseReview = { action: "review", subjectType: "reference_case", subjectKey: "RC-ST1", status: "approved",
  reviewerName: "بازبین آزمون مرحله سوم", reviewerCredential: "داده آزمون", reviewerRole: "external_expert", note: "", attest: true };
await rules(caseReview, 201);
const reviewed = await json("/api/workspace");
assert.equal(reviewed.caseReviews["RC-ST1"].reviewerRole, "external_expert");
assert.equal(reviewed.ruleBank.find((item) => item.ref === "sys:plaster.wall_face_area@1").review.reviewerName, "بازبین آزمون مرحله سوم");
console.log("✓ reviewer identity, role, time, rule version and basis are stored with each approval");

/* 3 ─ a project to exercise rule-based rows */
const project = (await json("/api/projects", "POST", {
  name: "آزمون مرحله سوم (داده آزمون)", code: "P3-TEST", type: "مسکونی", province: "تهران", city: "تهران", area: "300",
  floors: 2, basements: 0, structure: "فولادی", foundation: "گسترده", employer: "", contractor: "", contractType: "",
  fundingType: "private", pricingBasis: "market", contractReference: "", estimateDate: "1404/06/01", stage: "detailed", notes: "آزمون خودکار",
}, 201)).project;

/* 4 ─ extended authoring: a brand-new rule with its own parameters, steps and constraints */
const newRule = {
  action: "createVersion", baseRef: "sys:plaster.wall_face_area@1", key: "plaster.workspace_test",
  title: "قاعده آزمایشی فضای کار با پارامتر و شرط تازه", operation: "اندودکاری", discipline: "ابنیه",
  outputKind: "area", basis: "geometric", roundingScale: 4,
  parameters: [
    { key: "length", label: "طول دیوار", unit: "متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 4 },
    { key: "height", label: "ارتفاع دیوار", unit: "متر", kind: "decimal", min: "0", exclusiveMin: true, scale: 4 },
    { key: "repeats", label: "تعداد دیوار", unit: "عدد", kind: "integer", min: "1", scale: 0, default: "1" },
  ],
  lists: [{ key: "openings", label: "بازشوها", fields: [
    { key: "o_width", label: "عرض بازشو", unit: "متر", kind: "decimal", min: "0", scale: 4 },
    { key: "o_height", label: "ارتفاع بازشو", unit: "متر", kind: "decimal", min: "0", scale: 4 },
    { key: "o_count", label: "تعداد", unit: "عدد", kind: "integer", min: "1", scale: 0, default: "1" }] }],
  steps: [
    { key: "gross", label: "سطح ناخالص", expression: "length * height * repeats" },
    { key: "opening_area", label: "سطح بازشوها", expression: "sum(openings, o_width * o_height * o_count)" },
    { key: "net", label: "سطح خالص", expression: "gross - opening_area" },
  ],
  result: "net", constraints: [{ expression: "opening_area < gross", message: "سطح بازشوها باید کمتر از سطح ناخالص باشد." }],
  measurementRule: "سطح ناخالص منهای بازشوها؛ قاعده آزمایشی برای آزمون ویرایش کامل تعریف.",
  additions: "", deductions: "بازشوها کسر می‌شوند.", exceptions: "", scope: "فقط آزمون خودکار",
  referenceId: null, clause: "", page: "", quote: "", validFrom: "", validTo: "", changeNote: "ایجاد قاعده جدید با پارامترها و شرط تازه",
};
for (const broken of [
  { ...newRule, steps: [{ key: "gross", label: "x", expression: "length * height * repeats" }, { key: "net", label: "y", expression: "gross - unknown" }] },
  { ...newRule, steps: [{ key: "gross", label: "x", expression: "gross.constructor" }, { key: "net", label: "y", expression: "gross" }] },
  { ...newRule, parameters: newRule.parameters.map((p) => (p.key === "length" ? { ...p, key: "constructor" } : p)) },
  { ...newRule, outputKind: "bogus" },   // unknown quantity kind
  { ...newRule, roundingScale: 9 },       // rounding outside the allowed range
  { ...newRule, basis: "regulatory", referenceId: null, clause: "", page: "" },
  { ...newRule, changeNote: "" },
]) await rules(broken, 400);
const created = (await rules(newRule, 201)).version;
assert.equal(created.ruleKey, "plaster.workspace_test");
assert.equal(created.version, 1, "a new rule family starts at version 1");
let state = await json("/api/workspace");
const wsRef = created.ref;
entry = state.ruleBank.find((item) => item.ref === wsRef);
assert.equal(entry.usability.certainty, "provisional", "a user-authored rule is not usable until an expert approves it");
console.log("✓ rules can be authored with new parameters, lists, steps and constraints; unsafe formulas are rejected");

/* 5 ─ an unapproved workspace rule cannot be confirmed */
const rowBody = { projectId: project.id, ruleRef: wsRef, title: "اندود دیوار آزمون", floor: "همکف", location: "محور A",
  sourceNote: "نقشه آزمایشی", documentId: null, input: { values: { length: "5.2", height: "2.9", repeats: "2" },
    lists: { openings: [{ o_width: "0.9", o_height: "2.1", o_count: "2" }] } } };
let row = (await json("/api/takeoffs", "POST", rowBody, 201)).item;
state = await json("/api/workspace");   // re-read so the new row is included in the validity map
assert.equal(row.quantity, "26.3800");
assert.equal(row.ruleVersion, 1);
assert.equal(row.certainty, "provisional");
assert.equal(state.rowValidity[row.id].state, "unusable");
await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" }, 400);
console.log("✓ an unapproved workspace rule produces a provisional row that cannot be confirmed");

/* 6 ─ expert approval makes it usable */
await rules({ action: "review", subjectType: "rule", subjectKey: wsRef, status: "approved",
  reviewerName: "بازبین آزمون مرحله سوم", reviewerCredential: "داده آزمون", reviewerRole: "reviewer", note: "", attest: true }, 201);
state = await json("/api/workspace");
assert.equal(state.ruleBank.find((item) => item.ref === wsRef).usability.certainty, "geometric");
assert.equal(state.rowValidity[row.id].state, "ok");
row = (await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" })).item;
assert.equal(row.status, "confirmed");
const price = (await json("/api/prices", "POST", { title: "بهای آزمایشی اندود", code: "", category: "", unit: "مترمربع", basis: "market",
  amount: "100000", currency: "IRR", sourceName: "پیش‌فاکتور آزمایشی (داده آزمون)", sourceUrl: "", supplier: "", region: "",
  priceDate: "1404/06/01", validUntil: "", referenceId: null, confirmed: true }, 201)).item;
await json("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: price.id });
const snapshot = (await json("/api/estimates", "POST", { projectId: project.id, notes: "نسخه آزمون مرحله سوم" }, 201)).snapshot;
assert.equal(snapshot.totalRial, "2638000");
const frozenUrl = `/api/export?projectId=${project.id}&snapshotId=${snapshot.id}&format=json`;
const frozen = await json(frozenUrl);
console.log("✓ after expert approval the row is confirmed, estimated and snapshotted");

/* 7 ─ changing the rule flags dependent rows without touching stored data */
const changed = { ...newRule, steps: newRule.steps.map((step) => step.key === "net" ? { ...step, expression: "gross - opening_area + 1" } : step),
  changeNote: "افزودن یک مترمربع ثابت برای آزمون انتشار تغییر" };
const second = (await rules(changed, 201)).version;
assert.equal(second.version, 2, "the same rule family is versioned, not overwritten");
state = await json("/api/workspace");
const v1Entry = state.ruleBank.find((item) => item.ref === wsRef);
const v2Entry = state.ruleBank.find((item) => item.ref === second.ref);
assert.equal(v1Entry.definition.version, 1, "version 1 must still exist unchanged");
assert.equal(v2Entry.definition.version, 2, "version 2 must be a separate entry");
assert.notEqual(v1Entry.hash, v2Entry.hash, "the two versions must have different content hashes");
assert.equal(v2Entry.definition.steps[2].expression, "gross - opening_area + 1");
const stored = state.takeoffs.find((item) => item.id === row.id);
assert.equal(stored.quantity, "26.3800", "the stored row value is never rewritten");
assert.equal(stored.status, "confirmed", "the stored status is never rewritten");
// A new version is informational: the row is pinned to an immutable version that still reproduces.
assert.equal(state.rowValidity[row.id].state, "outdated", "the row is flagged as using an older rule version");
assert.match(state.rowValidity[row.id].label, /نسخه ۲/);
row = (await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" })).item;
assert.equal(row.status, "confirmed", "an informational flag must not block confirmation");
let preview = await json(`/api/estimates?projectId=${project.id}`);
assert.deepEqual(preview.issues, [], "an informational flag must not remove the row from the estimate");
assert.equal(preview.totalRial, "2638000");
assert.deepEqual(await json(frozenUrl), frozen, "a stored estimate version must stay byte-identical after the rule changed");
console.log("✓ a new rule version is reported informationally; the pinned row, its confirmation and snapshots stay intact");

/* 8 ─ revoking the approval flags rows as unusable; recalculating clears the flag */
await rules({ action: "review", subjectType: "rule", subjectKey: wsRef, status: "revoked",
  reviewerName: "بازبین آزمون مرحله سوم", reviewerCredential: "داده آزمون", reviewerRole: "reviewer", note: "لغو", attest: true }, 201);
state = await json("/api/workspace");
assert.equal(state.ruleBank.find((item) => item.ref === wsRef).usability.certainty, "provisional");
assert.equal(state.rowValidity[row.id].state, "unusable");
// Revoking the approval is blocking: the row can no longer be confirmed or estimated.
await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" }, 400);
preview = await json(`/api/estimates?projectId=${project.id}`);
assert(preview.issues.some((message) => /بازبینی شود/.test(message)), "a row without a valid rule must be excluded from the estimate");
assert.equal(preview.lines.length, 0);
assert.deepEqual(await json(frozenUrl), frozen, "snapshots are not rewritten when an approval is revoked");
const recalculated = (await json("/api/takeoffs", "PATCH", { ...rowBody, ruleRef: second.ref, id: row.id, action: "updateRule",
  input: { values: { length: "5.2", height: "2.9", repeats: "2" }, lists: { openings: [{ o_width: "0.9", o_height: "2.1", o_count: "2" }] } } })).item;
assert.equal(recalculated.quantity, "27.3800", "the row now follows version 2 of the rule");
assert.equal(recalculated.status, "draft", "recalculation always requires a new confirmation");
state = await json("/api/workspace");
assert.equal(state.rowValidity[row.id].state, "unusable", "still unusable because the approval was revoked");
// The approval must be recorded for the version the row now uses (version 2), not for version 1.
await rules({ action: "review", subjectType: "rule", subjectKey: second.ref, status: "approved",
  reviewerName: "بازبین آزمون مرحله سوم", reviewerCredential: "داده آزمون", reviewerRole: "estimator", note: "تأیید نسخه ۲", attest: true }, 201);
state = await json("/api/workspace");
assert.equal(state.ruleBank.find((item) => item.ref === second.ref).review.reviewerRole, "estimator");
assert.equal(state.ruleBank.find((item) => item.ref === wsRef).review, null, "version 1 stays unapproved");
assert.equal(state.rowValidity[row.id].state, "ok");
row = (await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" })).item;
assert.equal(row.status, "confirmed");
assert.equal(row.quantity, "27.3800");
console.log("✓ revoking an approval marks rows unusable; recalculating with the current version restores usability");

/* 9 ─ retiring a version blocks new calculations but keeps history */
await rules({ action: "retire", id: created.id });
state = await json("/api/workspace");
assert.equal(state.ruleBank.find((item) => item.ref === wsRef).usability.certainty, "blocked");
await json("/api/takeoffs", "POST", { ...rowBody, location: "محور Z" }, 400);
assert.equal(state.takeoffs.find((item) => item.id === row.id).quantity, "27.3800", "history is preserved after retirement");
assert.deepEqual(await json(frozenUrl), frozen, "snapshots survive retirement too");
console.log("✓ retiring a version blocks new calculations while rows and snapshots remain intact");
console.log("Phase-3 smoke test passed.");
