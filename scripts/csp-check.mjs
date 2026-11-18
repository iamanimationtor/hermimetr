// Security regression guard: assert the strict same-origin CSP (with per-request nonce) does not
// block anything the app needs — main UI, calculator, dark theme, PDF preview iframe, report pages.
// Collects real `securitypolicyviolation` DOM events plus CSP console errors. Requires a running server.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const violations = [];
const flush = async () => {
  try {
    const found = await page.evaluate(() => window.__cspViolations || []);
    for (const v of found) violations.push(v);
  } catch { /* page may be mid-navigation */ }
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fa-IR" });
const page = await context.newPage();

page.on("dialog", (dialog) => dialog.accept());
page.on("console", (message) => {
  if (/content security policy|content-security-policy/i.test(message.text())) violations.push(message.text());
});
// Collect real `securitypolicyviolation` DOM events in a window global across all navigations and frames.
page.addInitScript(() => {
  window.__cspViolations = [];
  window.addEventListener("securitypolicyviolation", (e) => {
    window.__cspViolations.push((e.blockedURI ? e.blockedURI + " | " : "") + (e.effectiveDirective || "?") + " | " + (e.disposition || ""));
  });
});

try {
  // 1) Main app + navigation + calculator + dark theme.
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /سلام/ }).waitFor();
  await page.locator(".nav-item", { hasText: "بانک قواعد متره" }).click();
  await page.locator('[data-rule="sys:concrete.prism@2"]').click();
  await page.locator('[data-testid="rule-card"]').waitFor();
  await page.locator(".nav-item", { hasText: "متره و مقادیر" }).click();
  await page.locator(".intro-actions .button-primary", { hasText: "محاسبه با قاعده" }).click();
  await page.selectOption('[data-testid="calc-rule"]', "sys:concrete.prism@1");
  await page.fill('[data-param="length"]', "3");
  await page.fill('[data-param="width"]', "4");
  await page.fill('[data-param="height"]', "0.5");
  await page.locator('[data-testid="calc-result"]').waitFor();
  await page.locator(".modal-close").click();
  await page.locator(".modal-backdrop").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  await page.locator('button[title="تم تاریک"]').click();
  await page.locator(".app-frame.theme-dark").waitFor();
  await page.locator('button[title="تم روشن"]').click();
  await flush();
  console.log("✓ main UI, rule card, calculator and theme switch render under CSP");

  // 2) A real, valid PDF preview must be served same-origin and frameable ONLY by this origin.
  const pdfSource = await context.newPage();
  await pdfSource.setContent('<html><body><h1>PDF audit sample</h1><p>12345</p></body></html>');
  const validPdf = await pdfSource.pdf({ format: "A4" });
  await pdfSource.close();
  await page.locator(".nav-item", { hasText: "نقشه‌ها و اسناد" }).click();
  await page.locator(".page-intro .button-primary", { hasText: "بارگذاری سند" }).click();
  await page.locator(".upload-drop").waitFor({ timeout: 10000 });
  const fileInput = page.locator('.upload-drop input[type="file"]');
  await fileInput.setInputFiles({ name: "csp-check.pdf", mimeType: "application/pdf", buffer: validPdf });
  await page.waitForTimeout(300);
  await page.locator(".modal-footer .button-primary", { hasText: "بارگذاری فایل" }).click();
  await page.locator(".toast").waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  await page.locator('.document-item button[title="مشاهده"]').first().click();
  const frame = page.locator("iframe[title='csp-check.pdf']");
  await frame.waitFor({ timeout: 15000 });
  const fileUrl = await frame.getAttribute("src");
  assert(fileUrl?.startsWith("/api/documents?id="), "preview iframe must point to the private file endpoint");
  const pdfResponse = await context.request.get(base + fileUrl);
  assert.equal(pdfResponse.status(), 200);
  const pdfHeaders = pdfResponse.headers();
  if (process.env.ARENA_PREVIEW !== "1") assert.equal(pdfHeaders["x-frame-options"]?.toUpperCase(), "SAMEORIGIN");
  else assert.equal(pdfHeaders["x-frame-options"], undefined);
  assert.match(pdfHeaders["content-security-policy"] ?? "", /frame-ancestors 'self'/);
  assert.match(pdfHeaders["content-security-policy"] ?? "", /sandbox/);
  assert.equal(pdfHeaders["content-type"], "application/pdf");
  assert(Buffer.from(await pdfResponse.body()).equals(validPdf), "served PDF bytes must equal the uploaded valid PDF");
  await page.waitForTimeout(300);
  await flush();
  console.log("✓ valid PDF served privately; same-origin frame allowed, other origins blocked, sandbox retained");

  // Images are displayed by the browser itself, so verify actual decoding (not just the modal).
  await page.locator(".document-preview-header button").click();
  await page.locator(".document-preview").waitFor({ state: "detached" });
  await page.locator(".page-intro .button-primary", { hasText: "بارگذاری سند" }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lH8AAAAASUVORK5CYII=", "base64");
  await page.locator('.upload-drop input[type="file"]').setInputFiles({ name: "csp-image.png", mimeType: "image/png", buffer: png });
  await page.locator(".modal-footer .button-primary", { hasText: "بارگذاری فایل" }).click();
  const imageRow = page.locator(".document-item", { hasText: "csp-image.png" });
  await imageRow.waitFor({ timeout: 15000 });
  await imageRow.locator('button[title="مشاهده"]').click();
  const decoded = await page.locator('.document-image-wrap img').evaluate(async (image) => {
    if (!image.complete) await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
    return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight };
  });
  assert.deepEqual(decoded, { complete: true, width: 1, height: 1 });
  await flush();
  console.log("✓ private PNG is decoded and visibly rendered in the browser preview");

  // 3) Report pages (estimate snapshot + takeoff report) must render under CSP.
  // CSP is response-based, so build the report data with a fresh node fetch session and open the
  // report pages in a fresh browser page carrying that session's cookie.
  const boot = await fetch(base + "/api/workspace"); // creates a guest and returns its session
  const freshCookie = (boot.headers.get("set-cookie") || "").split(";")[0];
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", Cookie: freshCookie }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  };
  const post = (path, body) => call("POST", path, body);
  const patch = (path, body) => call("PATCH", path, body);
  const p = await post("/api/projects", { name: "پروژه گزارش CSP", type: "مسکونی", floors: 1, basements: 0, fundingType: "private", pricingBasis: "market", stage: "detailed" });
  const row = await post("/api/takeoffs", { projectId: p.project.id, title: "بتن گزارش", category: "بتن‌ریزی", kind: "volume", length: "2", width: "3", height: "0.5", count: "1", sourceNote: "نقشه" });
  const price = await post("/api/prices", { title: "بهای بتن", unit: "مترمکعب", basis: "market", amount: "1000", currency: "IRR", sourceName: "s", priceDate: "1404/01/01", confirmed: true });
  await patch("/api/takeoffs", { id: row.item.id, action: "assignPrice", priceId: price.item.id });
  await patch("/api/takeoffs", { id: row.item.id, action: "confirm" });
  const snap = await post("/api/estimates", { projectId: p.project.id });

  const reportPage = await context.newPage();
  reportPage.on("dialog", (d) => d.accept());
  reportPage.on("console", (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
  reportPage.addInitScript(() => {
    window.__cspViolations = [];
    window.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations.push((e.blockedURI ? e.blockedURI + " | " : "") + (e.effectiveDirective || "?"));
    });
  });
  await reportPage.context().addCookies([{ name: "metra_session", value: freshCookie.split("=")[1], url: base }]);
  const reportFlush = async () => { try { (await reportPage.evaluate(() => window.__cspViolations || [])).forEach((v) => violations.push(v)); } catch { /* mid-nav */ } };
  await reportPage.goto(`${base}/report/${snap.snapshot.id}`, { waitUntil: "networkidle" });
  await reportPage.locator(".report-page").waitFor({ timeout: 15000 });
  await reportFlush();
  await reportPage.goto(`${base}/report/takeoff/${p.project.id}`, { waitUntil: "networkidle" });
  await reportPage.locator(".report-page").waitFor({ timeout: 15000 });
  await reportFlush();
  await reportPage.close();
  console.log("✓ estimate and takeoff report pages render under CSP");

  assert.equal(violations.length, 0, "CSP violations detected:\n" + violations.join("\n"));
  console.log("✓ ZERO CSP violations across main UI, PDF preview and report pages");
} catch (error) {
  if (violations.length) console.error("CSP violations:\n" + violations.join("\n"));
  throw error;
} finally {
  await browser.close();
}
