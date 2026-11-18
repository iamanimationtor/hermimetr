// Phase-2 integration test against a running server. All documents, rows and prices created here are synthetic test data.
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const jars = { main: "", other: "" };
async function request(path, method = "GET", payload, jar = "main") {
  const headers = {};
  if (jars[jar]) headers.Cookie = jars[jar];
  if (payload) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  const cookie = response.headers.get("set-cookie")?.match(/metra_session=[^;]+/)?.[0];
  if (cookie) jars[jar] = cookie;
  return response;
}
async function json(path, method = "GET", payload, expected = 200, jar = "main") {
  const response = await request(path, method, payload, jar);
  const body = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}
const rulePost = (payload, expected = 200) => json("/api/rules", "POST", payload, expected);
const pricebook = (payload, expected = 200) => json("/api/pricebook", "POST", payload, expected);

/* 1 ─ rule bank and reference calculations through the API */
const workspace = await json("/api/workspace");
assert.equal(workspace.ruleBank.length, 29);
assert(workspace.ruleBank.every((entry) => /^[0-9a-f]{64}$/.test(entry.hash)));
assert.equal(workspace.ruleBank.filter((entry) => entry.usability.certainty === "geometric").length, 26);
assert.equal(workspace.ruleBank.filter((entry) => entry.usability.certainty === "provisional").length, 3);
assert.equal(workspace.ruleBank.filter((entry) => entry.usability.certainty === "definitive").length, 0, "no rule may be definitive out of the box");
assert.deepEqual(workspace.editions, []);
const bank = await json("/api/rules");
assert.equal(bank.cases.length, 30);
for (const item of bank.cases) {
  const run = await rulePost({ action: "evaluate", ruleRef: item.ruleRef, input: item.input });
  assert.equal(run.result.quantity, item.expected, item.id);
  assert(run.result.trace.length > 0 && run.result.formula && run.ruleHash);
}
await rulePost({ action: "evaluate", ruleRef: "sys:concrete.prism@1", input: { values: { length: "1; DROP TABLE", width: "1", height: "1" } } }, 400);
await rulePost({ action: "evaluate", ruleRef: "sys:missing.rule@1", input: {} }, 404);
console.log("✓ rule bank served with content hashes; 30 reference cases reproduce through the API");

/* 2 ─ rule-based takeoff, traceability and duplicate prevention */
const projectFields = { name: "آزمون مرحله دوم (داده آزمون)", code: "P2-TEST", type: "مسکونی", province: "تهران", city: "تهران", area: "400",
  floors: 3, basements: 1, structure: "بتنی", foundation: "گسترده", employer: "", contractor: "", contractType: "", fundingType: "public",
  pricingBasis: "official", contractReference: "بند آزمایشی پیمان (داده آزمون)", estimateDate: "1404/06/01", stage: "detailed", notes: "آزمون خودکار" };
const project = (await json("/api/projects", "POST", projectFields, 201)).project;
const c1 = bank.cases.find((item) => item.id === "RC-C1");
const takeoff = { projectId: project.id, ruleRef: "sys:concrete.prism@1", title: "بتن فونداسیون با مقاومت 25 مگاپاسکال (آزمون)", floor: "زیرزمین",
  location: "محور A تا C", sourceNote: "نقشه آزمایشی S-01", documentId: null, input: c1.input };
const created = await json("/api/takeoffs", "POST", takeoff, 201);
const row = created.item;
const prismEntry = workspace.ruleBank.find((entry) => entry.ref === "sys:concrete.prism@1");
assert.equal(row.quantity, "61.3080");
assert.equal(row.status, "draft");
assert.equal(row.certainty, "geometric");
assert.equal(row.category, "بتن‌ریزی");
assert.equal(row.unit, "مترمکعب");
assert.equal(row.ruleKey, "concrete.prism");
assert.equal(row.ruleVersion, 1);
assert.equal(row.ruleHash, prismEntry.hash);
// The provisional draft must be reported as such through the API too.
assert.equal((await rulePost({ action: "evaluate", ruleRef: "sys:concrete.prism@2", input: bank.cases.find((item) => item.id === "RC-D1").input })).usability.certainty, "provisional");
assert.equal(row.ruleTrace.length, 3);
// "workspace" predates this row, so re-read before checking its validity entry.
// concrete.prism already ships a v2 draft, so a v1 row is "outdated" (informational, still usable) rather than "ok".
const freshValidity = (await json("/api/workspace")).rowValidity[row.id].state;
assert(["ok", "outdated"].includes(freshValidity), `a freshly computed row must be usable, got "${freshValidity}"`);
assert.equal(row.excelFormula, "ROUND(12.5*8.2*0.6*1-0.4*0.4*0.6*2,4)");
assert.deepEqual(row.ruleInputs.values, { length: "12.5", width: "8.2", height: "0.6", count: "1" });

assert.match((await json("/api/takeoffs", "POST", takeoff, 409)).error, /مشابه/);
const reformatted = { ...takeoff, title: "عنوان متفاوت", input: { values: { length: "۱۲٫۵", width: "8.20", height: "0.6", count: 1 }, lists: c1.input.lists } };
await json("/api/takeoffs", "POST", reformatted, 409);
const intentional = await json("/api/takeoffs", "POST", { ...takeoff, duplicateReason: "دو پی یکسان در دو بلوک جداگانه" }, 201);
assert.equal(intentional.item.duplicateNote, "دو پی یکسان در دو بلوک جداگانه");
await json("/api/takeoffs", "DELETE", { id: intentional.item.id });
const race = await Promise.all([1, 2].map(() => request("/api/takeoffs", "POST", { ...takeoff, location: "محور D تا F" })));
assert.deepEqual(race.map((response) => response.status).sort(), [201, 409], "concurrent identical requests must not both be stored");
const basic = { projectId: project.id, title: "ردیف ساده آزمون", category: "کف‌سازی", floor: "همکف", location: "سالن", kind: "area", length: "4", width: "3",
  height: "", count: "1", unitWeight: "", deduction: "0", sourceNote: "آزمون", ruleReference: "", documentId: null };
const basicRow = (await json("/api/takeoffs", "POST", basic, 201)).item;
assert.equal(basicRow.ruleRef, null);
await json("/api/takeoffs", "POST", { ...basic, length: "4.0" }, 409);
console.log("✓ rule-based rows store rule version, hash, inputs, trace and formula; duplicates are refused (also under concurrency)");

/* 3 ─ confirmation, recalculation and protection of rule rows */
const confirmed = (await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" })).item;
assert.equal(confirmed.status, "confirmed");
const recalculated = (await json("/api/takeoffs", "PATCH", { ...takeoff, id: row.id, action: "updateRule",
  input: { values: { length: "12.5", width: "8.2", height: "0.7", count: "1" }, lists: { voids: [] } } })).item;
assert.equal(recalculated.quantity, "71.7500");
assert.equal(recalculated.status, "draft", "a recalculated row must be confirmed again");
assert.match((await json("/api/takeoffs", "PATCH", { ...basic, id: row.id, action: "update" }, 400)).error, /قاعده/);
await json("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" });

/* 4 ─ unverified regulatory drafts can be tried but never confirmed */
const d1 = bank.cases.find((item) => item.id === "RC-D1");
const provisional = (await json("/api/takeoffs", "POST", { ...takeoff, ruleRef: "sys:concrete.prism@2", location: "محور G", input: d1.input }, 201)).item;
assert.equal(provisional.quantity, "5.7800");
assert.equal(provisional.certainty, "provisional");
assert.match((await json("/api/takeoffs", "PATCH", { id: provisional.id, action: "confirm" }, 400)).error, /تأییدنشده/);
const review = { action: "review", subjectType: "rule", subjectKey: "sys:concrete.prism@2", status: "approved", reviewerName: "بازبین آزمون خودکار", reviewerCredential: "داده آزمون", reviewerRole: "reviewer", note: "", attest: true };
await rulePost({ ...review, attest: false }, 400);
await rulePost(review, 201);
assert.match((await json("/api/takeoffs", "PATCH", { id: provisional.id, action: "confirm" }, 400)).error, /سند مرجع/, "expert approval alone must not unlock an unverified source");
await rulePost({ action: "review", subjectType: "reference_case", subjectKey: "RC-C1", status: "approved", reviewerName: "بازبین آزمون خودکار", reviewerCredential: "", reviewerRole: "reviewer", note: "", attest: true }, 201);
assert.equal((await json("/api/workspace")).caseReviews["RC-C1"].status, "approved");
console.log("✓ recalculation resets confirmation; unverified drafts stay provisional even with an expert approval");

/* 5 ─ workspace rule versions: safe formulas, versioning, source + expert gates */
const technicalRef = (await json("/api/references", "POST", { title: "سند فنی آزمایشی (داده آزمون، غیررسمی)", kind: "technical", issuer: "آزمون خودکار",
  documentNumber: "TEST-1", issueDate: "1404/01/01", effectiveDate: "1404/01/01", basePeriod: "", scope: "فقط آزمون خودکار", amendments: "", replacement: "",
  url: "https://example.com/test-document", notes: "" }, 201)).item;
const steps = [
  { key: "gross", label: "حجم ناخالص", expression: "length * width * height * count" },
  { key: "void_volume", label: "حفره‌های قابل کسر", expression: "sum(voids, if(v_length * v_width * v_height <= 0.1, 0, v_length * v_width * v_height) * v_count)" },
  { key: "net", label: "حجم قابل اندازه‌گیری", expression: "gross - void_volume" },
];
const prismDef = workspace.ruleBank.find((entry) => entry.ref === "sys:concrete.prism@2").definition;
// Phase 3 requires the complete definition in the payload; take the base rule's own fields.
const versionBody = { action: "createVersion", baseRef: "sys:concrete.prism@2", title: "نسخه آزمایشی فضای کار (آستانه ۰٫۱)", steps, result: "net",
  operation: prismDef.operation, discipline: prismDef.discipline, outputKind: prismDef.outputKind, basis: prismDef.basis,
  parameters: prismDef.parameters, lists: prismDef.lists, roundingScale: prismDef.rounding.scale,
  measurementRule: "متن آزمایشی برای آزمون نسخه‌گذاری", additions: "", deductions: "", exceptions: "", scope: "", referenceId: technicalRef.id,
  clause: "بند آزمایشی ۶", page: "۱۲", quote: "", validFrom: "1404/01/01", validTo: "", changeNote: "آزمون نسخه‌گذاری قواعد" };
for (const expression of ["process.exit(1)", "gross.constructor", "gross - voids[0]", "eval(gross)", "gross - unknown_name", "gross; 1", "require('fs')"]) {
  const unsafe = await rulePost({ ...versionBody, steps: [steps[0], steps[1], { ...steps[2], expression }] }, 400);
  assert.match(unsafe.error, /تعریف قاعده نامعتبر/, expression);
}
await rulePost({ ...versionBody, clause: "" }, 400);
await rulePost({ ...versionBody, referenceId: "00000000-0000-4000-8000-000000000000" }, 404);
const version = (await rulePost(versionBody, 201)).version;
assert.equal(version.version, 3, "workspace versions continue after the system versions 1 and 2");
assert.equal((await rulePost({ ...versionBody, title: "نسخه آزمایشی دوم" }, 201)).version.version, 4);
let state = await json("/api/workspace");
let wsEntry = state.ruleBank.find((entry) => entry.ref === version.ref);
assert.equal(wsEntry.origin, "workspace");
assert.equal(wsEntry.usability.certainty, "provisional");
assert.equal(state.ruleBank.find((entry) => entry.ref === "sys:concrete.prism@1").hash, prismEntry.hash, "existing versions are untouched");

const voidInput = { values: { length: "6", width: "5", height: "0.2", count: "1" }, lists: { voids: [{ v_length: "0.4", v_width: "1", v_height: "0.2", v_count: "1" }] } };
assert.equal((await rulePost({ action: "evaluate", ruleRef: "sys:concrete.prism@2", input: voidInput })).result.quantity, "5.9200");
const wsRow = (await json("/api/takeoffs", "POST", { ...takeoff, ruleRef: version.ref, title: "بتن دال با مقاومت 25 مگاپاسکال (آزمون)", location: "محور H", input: voidInput }, 201)).item;
assert.equal(wsRow.quantity, "6.0000", "the workspace version applies its own threshold");
assert.equal(wsRow.ruleVersion, 3);
const confirmWs = (expected) => json("/api/takeoffs", "PATCH", { id: wsRow.id, action: "confirm" }, expected);
await confirmWs(400);
await rulePost({ ...review, subjectKey: version.ref }, 201);
assert.match((await confirmWs(400)).error, /سند مرجع/);
await json("/api/references", "PATCH", { id: technicalRef.id, action: "status", status: "verified" });
state = await json("/api/workspace");
assert.equal(state.ruleBank.find((entry) => entry.ref === version.ref).usability.certainty, "definitive");
const definitive = (await confirmWs(200)).item;
assert.equal(definitive.status, "confirmed");
assert.equal(definitive.certainty, "definitive");
console.log("✓ workspace versions: unsafe formulas rejected, numbering continues, definitive only with verified source AND expert approval");

/* 6 ─ official pricebook: validated import, gated activation, suggested matching confirmed by the user */
const pricebookRef = (await json("/api/references", "POST", { title: "فهرست‌بهای آزمایشی (داده آزمون، غیررسمی)", kind: "pricebook", issuer: "آزمون خودکار",
  documentNumber: "TEST-PB", issueDate: "1403/12/29", effectiveDate: "1404/01/01", basePeriod: "1404", scope: "فقط آزمون خودکار", amendments: "", replacement: "",
  url: "https://sama.mporg.ir/test-only-not-a-real-document", notes: "نشانی آزمایشی" }, 201)).item;
const edition = (await pricebook({ action: "createEdition", title: "فهرست آزمایشی ابنیه (داده آزمون)", discipline: "ابنیه", baseYear: "1404", referenceId: pricebookRef.id, notes: "" }, 201)).edition;
assert.equal(edition.status, "draft");
const rejected = await pricebook({ action: "import", editionId: edition.id, format: "csv", content: "code,description,unit,price\nT-1,الف,عدد,10\nT-1,ب,عدد,abc\n" }, 400);
assert(rejected.errors.length >= 2);
assert.equal((await json(`/api/pricebook?editionId=${edition.id}`)).total, 0, "a rejected file must import nothing");
const csv = [
  "کد,کد فصل,عنوان فصل,شرح,واحد,بهای واحد,شرایط",
  'T-0801,08,بتن درجا (آزمایشی),"تهیه و اجرای بتن با مقاومت فشاری مشخصه 25 مگاپاسکال (داده آزمایشی)",مترمکعب,۲٬۰۰۰٬۰۰۰,فقط آزمون',
  "T-0802,08,بتن درجا (آزمایشی),تهیه و اجرای بتن با مقاومت فشاری مشخصه 30 مگاپاسکال (داده آزمایشی),مترمکعب,2400000,",
  "T-0701,07,کارهای فولادی با میلگرد (آزمایشی),تهیه و نصب میلگرد آجدار (داده آزمایشی),کیلوگرم,50000,",
  "T-0803,08,بتن درجا (آزمایشی),اضافه‌بها بتن‌ریزی در ارتفاع (داده آزمایشی),مترمربع,,",
].join("\n");
const staged = await pricebook({ action: "import", editionId: edition.id, format: "csv", content: csv, preview: true });
assert.equal(staged.count, 4);
assert.equal(staged.sample[0].unitPriceRial, "2000000");
assert.equal((await json(`/api/pricebook?editionId=${edition.id}`)).total, 0, "preview never writes rows");
const shifted = await pricebook({ action: "import", editionId: edition.id, format: "csv", content: "code,description,unit,price\nA,آزمایشی,عدد,1,000" }, 400);
assert(shifted.errors.some((error) => /تعداد ستون/.test(error)));
assert.equal((await json(`/api/pricebook?editionId=${edition.id}`)).total, 0);
assert.equal((await pricebook({ action: "import", editionId: edition.id, format: "csv", content: csv }, 201)).imported, 4);
await pricebook({ action: "import", editionId: edition.id, format: "csv", content: csv }, 400);
assert.equal((await json("/api/workspace")).editions.find((item) => item.id === edition.id).itemCount, 4, "the workspace must report the imported row count");
assert.match((await pricebook({ action: "setStatus", editionId: edition.id, status: "active" }, 400)).error, /تأییدنشده/);
assert((await json(`/api/pricebook?suggestFor=${row.id}`)).blockers.some((text) => /نسخه فعال/.test(text)));
await json("/api/references", "PATCH", { id: pricebookRef.id, action: "status", status: "verified" });
await pricebook({ action: "setStatus", editionId: edition.id, status: "active" });
assert.match((await pricebook({ action: "import", editionId: edition.id, format: "csv", content: "code,description,unit\nT-9,x,عدد" }, 400)).error, /پیش‌نویس/, "an active edition is immutable");
assert.equal((await json(`/api/pricebook?editionId=${edition.id}&q=${encodeURIComponent("میلگرد")}`)).total, 1);
assert.equal((await json(`/api/pricebook?editionId=${edition.id}`)).chapters.length, 2);
// Excel (xlsx) import path, on a separate draft edition that is deleted afterwards.
const xlsxBook = new ExcelJS.Workbook();
const xlsxSheet = xlsxBook.addWorksheet("rows");
xlsxSheet.addRow(["کد", "شرح", "واحد", "بهای واحد"]);
xlsxSheet.addRow(["X-01", "ردیف آزمایشی اکسل (داده آزمون)", "عدد", 125000]);
xlsxSheet.addRow(["X-02", "ردیف آزمایشی دوم (داده آزمون)", "مترمربع", 98000.5]);
const xlsxEdition = (await pricebook({ action: "createEdition", title: "نسخه آزمایشی اکسل (داده آزمون)", discipline: "ابنیه", baseYear: "1404", referenceId: null, notes: "" }, 201)).edition;
const xlsxContent = Buffer.from(await xlsxBook.xlsx.writeBuffer()).toString("base64");
assert.equal((await pricebook({ action: "import", editionId: xlsxEdition.id, format: "xlsx", content: xlsxContent }, 201)).imported, 2);
assert.deepEqual((await json(`/api/pricebook?editionId=${xlsxEdition.id}`)).items.map((item) => [item.code, item.unitPriceRial]), [["X-01", "125000.00"], ["X-02", "98000.50"]]);
const formulaBook = new ExcelJS.Workbook();
const formulaSheet = formulaBook.addWorksheet("bad");
formulaSheet.addRow(["code", "description", "unit", "price"]);
formulaSheet.addRow(["X-03", "آزمایشی", "عدد", { formula: "50*2", result: 100 }]);
const formulaResult = await pricebook({ action: "import", editionId: xlsxEdition.id, format: "xlsx", content: Buffer.from(await formulaBook.xlsx.writeBuffer()).toString("base64") }, 400);
assert.match(formulaResult.error, /فرمول/);
assert.equal((await json(`/api/pricebook?editionId=${xlsxEdition.id}`)).total, 2);
await pricebook({ action: "import", editionId: xlsxEdition.id, format: "xlsx", content: "bm90IGFuIGV4Y2VsIGZpbGU=" }, 400);
assert.match((await pricebook({ action: "setStatus", editionId: xlsxEdition.id, status: "active" }, 400)).error, /سند مرجع/, "an edition without a reference can never be activated");
await json("/api/pricebook", "DELETE", { editionId: xlsxEdition.id });

const suggestions = await json(`/api/pricebook?suggestFor=${row.id}`);
assert.deepEqual(suggestions.blockers, []);
assert.equal(suggestions.suggestions[0].item.code, "T-0801");
assert(suggestions.suggestions[0].reasons.length >= 3 && suggestions.suggestions[0].cautions.some((text) => /شرایط کاربرد/.test(text)));
assert(!suggestions.suggestions.some((entry) => entry.item.code === "T-0701"), "steel rows are not suggested for concrete");
const best = suggestions.suggestions[0].item;
const wrongUnit = suggestions.suggestions.find((entry) => entry.item.code === "T-0803");
assert.equal(wrongUnit.confirmable, false);
await pricebook({ action: "confirmMatch", takeoffId: row.id, itemId: best.id, attest: false }, 400);
assert.match((await pricebook({ action: "confirmMatch", takeoffId: row.id, itemId: wrongUnit.item.id, attest: true }, 400)).error, /واحد/);
assert.equal((await json("/api/workspace")).takeoffs.find((item) => item.id === row.id).priceId, null, "nothing is linked before the user confirms");
const matched = await pricebook({ action: "confirmMatch", takeoffId: row.id, itemId: best.id, attest: true });
assert.equal(matched.price.basis, "official");
assert.equal(matched.price.amount, "2000000.00");
assert.equal(matched.price.referenceId, pricebookRef.id);
assert.equal(matched.item.priceId, matched.price.id);
assert.match((await json("/api/prices", "PATCH", { id: matched.price.id, amount: "1" }, 400)).error, /قابل ویرایش نیست/);
assert.match((await json("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: matched.price.id }, 400)).error, /تطبیق/);
const editableFields = { projectId: project.id, title: "ردیف آزمایشی تغییرپذیر", category: "بتن‌ریزی", kind: "volume", length: "2", width: "2", height: "2", count: "1", sourceNote: "نقشه فرضی", location: "محور W" };
const editable = (await json("/api/takeoffs", "POST", editableFields, 201)).item;
await pricebook({ action: "confirmMatch", takeoffId: editable.id, itemId: best.id, attest: true });
const changed = (await json("/api/takeoffs", "PATCH", { ...editableFields, title: "شرح تغییرکرده", id: editable.id, action: "update" })).item;
assert.equal(changed.priceId, null, "editing a matched measurement invalidates the match");
assert.equal(changed.pricebookItemId, null);
assert.equal((await pricebook({ action: "confirmMatch", takeoffId: wsRow.id, itemId: best.id, attest: true })).price.id, matched.price.id, "the same official row is reused, not duplicated");
console.log("✓ pricebook: atomic validated import, activation gated by a verified official reference, matching only by explicit user confirmation");

/* 7 ─ estimate integration, frozen rule evidence and historic stability */
const preview = await json(`/api/estimates?projectId=${project.id}`);
assert.deepEqual(preview.issues, []);
assert.equal(preview.lines.length, 2);
assert.equal(preview.totalRial, "155500000");
assert(preview.draftCount >= 3, "draft and provisional rows are excluded from the total");
const snapshot = (await json("/api/estimates", "POST", { projectId: project.id, notes: "نسخه آزمون مرحله دوم" }, 201)).snapshot;
const exportUrl = `/api/export?projectId=${project.id}&snapshotId=${snapshot.id}&format=json`;
const frozenBefore = await json(exportUrl);
const frozenLine = frozenBefore.snapshot.rows.find((line) => line.takeoffId === wsRow.id);
assert.equal(frozenLine.rule.ref, version.ref);
assert.equal(frozenLine.rule.certainty, "definitive");
assert.equal(frozenLine.ruleSnapshot.trace.length, 3);
assert.deepEqual(frozenLine.ruleSnapshot.inputs.lists.voids.length, 1);
assert.equal(frozenLine.referenceSnapshot.id, pricebookRef.id);
assert.equal(frozenLine.pricebookSnapshot.item.code, "T-0801");
assert.equal(frozenLine.pricebookSnapshot.item.conditions, "فقط آزمون");
assert.equal(frozenLine.pricebookSnapshot.edition.id, edition.id);
const reportHtml = await (await request(`/report/${snapshot.id}`)).text();
assert(reportHtml.includes("T-0801") && reportHtml.includes("فقط آزمون"), "report exposes the frozen pricebook code and conditions");

await rulePost({ ...review, subjectKey: version.ref, status: "revoked" }, 201);
await rulePost({ action: "retire", id: version.id });
await pricebook({ action: "setStatus", editionId: edition.id, status: "archived" });
assert.match((await json("/api/pricebook", "DELETE", { editionId: edition.id }, 400)).error, /بانک قیمت/, "used editions are kept for history");
await json("/api/takeoffs", "POST", { ...takeoff, ruleRef: version.ref, location: "محور K", input: voidInput }, 400);
state = await json("/api/workspace");
assert.equal(state.ruleBank.find((entry) => entry.ref === version.ref).usability.certainty, "blocked");
assert.equal(state.takeoffs.find((item) => item.id === wsRow.id).status, "confirmed", "historic confirmed rows are not changed by later rule changes");
assert.deepEqual(await json(exportUrl), frozenBefore, "a stored estimate version must not change when rules or pricebooks change");
console.log("✓ estimate uses confirmed rule rows with official matches; snapshot freezes rule evidence and survives later changes");

/* 8 ─ takeoff reports: real Excel formulas checked against stored and independently summed values */
const excel = await request(`/api/export/takeoff?projectId=${project.id}`);
assert.equal(excel.status, 200);
const workbook = new ExcelJS.Workbook();
const excelBytes = Buffer.from(await excel.arrayBuffer());
await workbook.xlsx.load(excelBytes);
const detail = workbook.getWorksheet("ریزمتره");
const summary = workbook.getWorksheet("خلاصه متره");
assert(detail && summary && workbook.getWorksheet("قواعد و مبانی"));
const projectRows = state.takeoffs.filter((item) => item.projectId === project.id);
let checked = 0;
detail.eachRow((sheetRow, number) => {
  if (number < 5) return;
  const stored = projectRows.find((item) => item.title === sheetRow.getCell(2).value && Number(item.quantity) === (sheetRow.getCell(8).value.result ?? sheetRow.getCell(8).value));
  assert(stored, `row ${number} not found in stored takeoff`);
  const cell = sheetRow.getCell(8).value;
  assert(cell.formula, `row ${number} must carry a real formula`);
  if (stored.excelFormula) assert.equal(cell.formula, stored.excelFormula);
  assert.equal(cell.result, Number(stored.quantity));
  checked++;
});
assert.equal(checked, projectRows.length);
assert.equal(detail.getCell("H5").value.formula.startsWith("ROUND("), true);
let groups = 0;
summary.eachRow((sheetRow, number) => {
  if (number < 5) return;
  const [category, unit] = [sheetRow.getCell(1).value, sheetRow.getCell(2).value];
  const sum = (status) => projectRows.filter((item) => item.category === category && item.unit === unit && item.status === status && (status !== "confirmed" || !["stale", "unusable"].includes(state.rowValidity[item.id]?.state))).reduce((total, item) => total + Number(item.quantity), 0);
  assert(sheetRow.getCell(3).value.formula.startsWith("SUMPRODUCT("));
  // ExcelJS does not write a cached value for a formula whose result is zero; Excel recalculates it on open.
  assert(Math.abs((sheetRow.getCell(3).value.result ?? 0) - sum("confirmed")) < 1e-9, `${category} confirmed total`);
  assert(Math.abs((sheetRow.getCell(4).value.result ?? 0) - sum("draft")) < 1e-9, `${category} draft total`);
  assert.equal(sheetRow.getCell(5).value.result, projectRows.filter((item) => item.category === category && item.unit === unit).length);
  groups++;
});
assert.equal(groups, 2);
// ExcelJS does not read calcPr back, so the flag is checked in the raw workbook XML.
const { default: JSZip } = await import("jszip");
const workbookXml = await (await JSZip.loadAsync(excelBytes)).file("xl/workbook.xml").async("string");
assert.match(workbookXml, /fullCalcOnLoad="1"/, "Excel must recalculate the formulas when the file is opened");
const printable = await request(`/report/takeoff/${project.id}`);
assert.equal(printable.status, 200);
const html = await printable.text();
assert(html.includes("آزمون مرحله دوم") && html.includes("concrete.prism") && html.includes("خلاصه متره"));
const snapshotExcel = await request(`/api/export?projectId=${project.id}&snapshotId=${snapshot.id}&format=xlsx`);
assert.equal(snapshotExcel.status, 200);
console.log("✓ takeoff Excel carries real formulas whose cached values equal stored quantities and independent sums; printable report renders");

/* 9 ─ isolation between workspaces */
const stranger = await json("/api/workspace", "GET", undefined, 200, "other");
assert.equal(stranger.ruleBank.length, 29, "another workspace never sees workspace rule versions");
assert.deepEqual(stranger.editions, []);
assert.equal((await request(`/api/export/takeoff?projectId=${project.id}`, "GET", undefined, "other")).status, 404);
assert.equal((await request(`/api/pricebook?editionId=${edition.id}`, "GET", undefined, "other")).status, 404);
assert.equal((await request(`/api/pricebook?suggestFor=${row.id}`, "GET", undefined, "other")).status, 404);
assert.equal((await request(`/report/takeoff/${project.id}`, "GET", undefined, "other")).status, 404);
await json("/api/rules", "POST", { action: "evaluate", ruleRef: version.ref, input: voidInput }, 404, "other");
await json("/api/takeoffs", "POST", { ...takeoff, location: "نفوذ" }, 404, "other");
console.log("✓ rule versions, pricebook editions and takeoff reports are isolated per workspace");
console.log("Phase-2 smoke test passed.");
