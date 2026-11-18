// Exercise the real cross-site embedding and partitioned cookie in Chromium.
// Run against the production preview with ARENA_PREVIEW=1.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--test-third-party-cookie-phaseout", "--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebRTC"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.route("https://arena.ai/**", (route) => route.fulfill({
  status: 200, contentType: "text/html",
  body: '<html><body><iframe title="preview" src="http://localhost:3000/" style="width:1400px;height:900px"></iframe></body></html>',
}));
try {
  const page = await context.newPage();
  await page.goto("https://arena.ai/test");
  const frame = page.frameLocator('iframe[title="preview"]');
  await frame.getByRole("heading", { name: /سلام/ }).waitFor({ timeout: 30000 });
  const cookies = await context.cookies("http://localhost:3000");
  const sessionCookie = cookies.find((cookie) => cookie.name === "metra_session");
  assert(sessionCookie?.partitionKey, "embedded session cookie must be partitioned");
  let child = page.frames().find((item) => item.url().startsWith("http://localhost:3000"));
  assert(child, "preview frame must be present");
  const initial = await child.evaluate(async () => (await fetch("/api/auth/session")).json());
  assert(initial.userId, "cookie must be sent back inside cross-site iframe");
  await frame.locator(".page-intro .button-primary", { hasText: "پروژه جدید" }).click();
  await frame.getByPlaceholder("مثلاً ساختمان مسکونی بهار").fill("آزمون نشست پیش‌نمایش");
  await frame.locator(".modal-footer .button-primary", { hasText: "ایجاد پروژه" }).click();
  await frame.locator(".toast", { hasText: "پروژه جدید ایجاد شد" }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await frame.getByRole("heading", { name: /سلام/ }).waitFor();
  child = page.frames().find((item) => item.url().startsWith("http://localhost:3000"));
  assert(child);
  const after = await child.evaluate(async () => (await fetch("/api/workspace?existing=1")).json());
  assert.equal(after.user.id, initial.userId);
  const project = after.projects.find((item) => item.name === "آزمون نشست پیش‌نمایش");
  assert(project);
  const snapshotId = await child.evaluate(async (projectId) => {
    const post = async (path, method, body) => {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result;
    };
    const row = (await post("/api/takeoffs", "POST", { projectId, title: "آزمون", category: "آزمون", kind: "count", count: "2", sourceNote: "آزمون" })).item;
    const price = (await post("/api/prices", "POST", { title: "آزمون", unit: "عدد", basis: "market", amount: "10", currency: "IRR", sourceName: "آزمون", priceDate: "1404/01/01", confirmed: true })).item;
    await post("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: price.id });
    await post("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" });
    return (await post("/api/estimates", "POST", { projectId })).snapshot.id;
  }, project.id);
  await page.reload({ waitUntil: "networkidle" });
  await frame.getByRole("heading", { name: /سلام/ }).waitFor();
  await frame.locator(".nav-item", { hasText: "گزارش‌ها" }).click();
  await frame.locator(`a[href="/report/${snapshotId}"]`).click();
  await frame.locator(".report-page").waitFor();
  await frame.locator(".report-back").click();
  await frame.getByRole("heading", { name: /سلام/ }).waitFor();
  child = page.frames().find((item) => item.url().startsWith("http://localhost:3000"));
  assert(child);
  await context.clearCookies();
  const lost = await child.evaluate(async () => (await fetch("/api/workspace?existing=1")).status);
  assert.equal(lost, 401, "losing a cookie must not silently create a replacement workspace");
  console.log("✓ cross-site iframe: partitioned cookie, project creation, report navigation, reload and lost-session handling");

  const blocked = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    await blocked.route("https://arena.ai/**", (route) => route.fulfill({ status: 200, contentType: "text/html",
      body: '<iframe title="preview" src="http://localhost:3000/" style="width:1400px;height:900px"></iframe>' }));
    // Strip every Set-Cookie, including auth transitions; emulate a browser that rejects all cookies.
    await blocked.route("http://localhost:3000/**", async (route) => {
      const requestHeaders = { ...route.request().headers(), cookie: "" };
      const response = await route.fetch({ headers: requestHeaders });
      // Playwright's route.fetch itself processes Set-Cookie; prevent it from persisting.
      await blocked.clearCookies();
      const headers = { ...response.headers() };
      delete headers["set-cookie"];
      await route.fulfill({ response, headers });
    });
    const blockedPage = await blocked.newPage();
    await blockedPage.goto("https://arena.ai/test");
    const blockedFrame = blockedPage.frameLocator('iframe[title="preview"]');
    await blockedFrame.getByRole("heading", { name: /سلام/ }).waitFor({ timeout: 30000 });
    let blockedChild = blockedPage.frames().find((item) => item.url().startsWith("http://localhost:3000"));
    assert(blockedChild);
    assert.equal((await blocked.cookies()).length, 0);
    const originalToken = await blockedChild.evaluate(() => sessionStorage.getItem("metra_preview_session"));
    assert.match(originalToken, /^[a-f0-9]{64}$/);
    await blockedFrame.locator(".page-intro .button-primary", { hasText: "پروژه جدید" }).click();
    await blockedFrame.getByPlaceholder("مثلاً ساختمان مسکونی بهار").fill("پروژه بدون کوکی");
    await blockedFrame.locator(".modal-footer .button-primary", { hasText: "ایجاد پروژه" }).click();
    await blockedFrame.locator(".toast", { hasText: "پروژه جدید ایجاد شد" }).waitFor();
    await blockedPage.reload({ waitUntil: "networkidle" });
    await blockedFrame.getByRole("heading", { name: /سلام/ }).waitFor();
    blockedChild = blockedPage.frames().find((item) => item.url().startsWith("http://localhost:3000"));
    const ids = await blockedChild.evaluate(async () => {
      const token = sessionStorage.getItem("metra_preview_session");
      const request = async (path, method = "GET", body) => {
        const headers = { "x-metra-preview-session": token };
        if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
        const response = await fetch(path, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
        if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
        return response.json();
      };
      const workspace = await request("/api/workspace?existing=1");
      const project = workspace.projects.find((p) => p.name === "پروژه بدون کوکی");
      if (!project) throw new Error("project missing after reload");
      const row = (await request("/api/takeoffs", "POST", { projectId: project.id, title: "آزمون", category: "آزمون", kind: "count", count: "2", sourceNote: "آزمون" })).item;
      const price = (await request("/api/prices", "POST", { title: "آزمون", unit: "عدد", basis: "market", amount: "10", currency: "IRR", sourceName: "آزمون", priceDate: "1404/01/01", confirmed: true })).item;
      await request("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: price.id });
      await request("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" });
      const snapshot = (await request("/api/estimates", "POST", { projectId: project.id })).snapshot;
      const form = new FormData();
      form.set("projectId", project.id);
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Z1sAAAAASUVORK5CYII="), (x) => x.charCodeAt(0));
      form.set("file", new File([bytes], "test.png", { type: "image/png" }));
      await request("/api/documents", "POST", form);
      return { projectId: project.id, snapshotId: snapshot.id, userId: workspace.user.id };
    });
    await blockedPage.reload({ waitUntil: "networkidle" });
    await blockedFrame.getByRole("heading", { name: /سلام/ }).waitFor();
    await blockedFrame.locator(".nav-item", { hasText: "گزارش‌ها" }).click();
    await blockedFrame.locator(`a[href="/report/${ids.snapshotId}"]`).click();
    await blockedFrame.getByRole("dialog", { name: "گزارش چاپی" }).waitFor();
    const report = blockedFrame.frameLocator('iframe[title="گزارش چاپی"]');
    await report.locator(".report-page").waitFor();
    assert.equal(await report.locator(".report-total").count(), 1);
    await blockedFrame.getByRole("button", { name: "بستن گزارش" }).click();
    const downloadPromise = blockedPage.waitForEvent("download");
    await blockedFrame.locator(`a[href*="snapshotId=${ids.snapshotId}"][href*="format=xlsx"]`).first().click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /\.xlsx$/);
    await blockedFrame.locator(".nav-item", { hasText: "نقشه‌ها و اسناد" }).click();
    await blockedFrame.getByTitle("مشاهده").first().click();
    const image = blockedFrame.getByRole("dialog", { name: "پیش‌نمایش سند" }).locator("img");
    await image.waitFor();
    assert(await image.evaluate((img) => img.complete && img.naturalWidth > 0));
    await blockedFrame.getByRole("button", { name: "بستن سند" }).click();
    await blockedFrame.getByTitle("حساب کاربری").click();
    const email = `preview-${Date.now()}@example.com`;
    await blockedFrame.getByPlaceholder("نام و نام خانوادگی").fill("کاربر آزمایشی");
    await blockedFrame.getByPlaceholder("name@example.com").fill(email);
    await blockedFrame.getByPlaceholder("حداقل ۱۰ نویسه").fill("ExamplePassword123!");
    await blockedFrame.locator(".modal-footer button", { hasText: "ساخت حساب" }).click();
    await blockedFrame.locator(".sidebar-user small", { hasText: email }).waitFor();
    blockedChild = blockedPage.frames().find((item) => item.url().startsWith("http://localhost:3000"));
    const accountToken = await blockedChild.evaluate(() => sessionStorage.getItem("metra_preview_session"));
    assert.notEqual(accountToken, originalToken);
    await blockedPage.reload({ waitUntil: "networkidle" });
    await blockedFrame.locator(".sidebar-user small", { hasText: email }).waitFor();
    await blockedFrame.getByTitle("حساب کاربری").click();
    await blockedFrame.getByRole("button", { name: "خروج از حساب فعلی" }).click();
    await blockedFrame.locator(".sidebar-user small", { hasText: "حساب مهمان" }).waitFor();
    blockedChild = blockedPage.frames().find((item) => item.url().startsWith("http://localhost:3000"));
    const revoked = await blockedChild.evaluate(async (token) => (await fetch("/api/workspace?existing=1", { headers: { "x-metra-preview-session": token } })).status, accountToken);
    assert.equal(revoked, 401);
    await blockedFrame.getByTitle("حساب کاربری").click();
    await blockedFrame.getByRole("button", { name: "ورود", exact: true }).click();
    await blockedFrame.getByPlaceholder("name@example.com").fill(email);
    await blockedFrame.getByPlaceholder("حداقل ۱۰ نویسه").fill("ExamplePassword123!");
    await blockedFrame.locator(".modal-footer button", { hasText: "ورود" }).click();
    await blockedFrame.locator(".sidebar-user small", { hasText: email }).waitFor();
    await blockedFrame.locator(".nav-item", { hasText: "پروژه‌ها", exact: true }).click();
    assert(await blockedFrame.getByLabel("انتخاب پروژه").locator('option', { hasText: "پروژه بدون کوکی" }).count());
    blockedChild = blockedPage.frames().find((item) => item.url().startsWith("http://localhost:3000"));
    await blockedChild.evaluate(() => sessionStorage.setItem("metra_preview_session", "a".repeat(64)));
    await blockedPage.reload({ waitUntil: "networkidle" });
    await blockedFrame.getByText(/نشست در دسترس نیست/).waitFor();
    blockedPage.once("dialog", (dialog) => dialog.accept());
    await blockedFrame.getByRole("button", { name: "شروع فضای جدید / ورود به حساب" }).click();
    await blockedFrame.getByRole("heading", { name: /سلام/ }).waitFor();
    console.log("✓ all cookies blocked: project + reload, report, XLSX download, image, register, logout, revoke, login and explicit recovery");
  } finally { await blocked.close(); }
  const noStorage = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    await noStorage.addInitScript(() => {
      for (const name of ["localStorage", "sessionStorage"]) Object.defineProperty(window, name, { get() { throw new DOMException("Blocked", "SecurityError"); } });
    });
    await noStorage.route("https://arena.ai/**", (route) => route.fulfill({ status: 200, contentType: "text/html",
      body: '<iframe title="preview" src="http://localhost:3000/" style="width:1400px;height:900px"></iframe>' }));
    await noStorage.route("http://localhost:3000/**", async (route) => {
      const response = await route.fetch({ headers: { ...route.request().headers(), cookie: "" } });
      await noStorage.clearCookies();
      const headers = { ...response.headers() }; delete headers["set-cookie"];
      await route.fulfill({ response, headers });
    });
    const page = await noStorage.newPage();
    await page.goto("https://arena.ai/test");
    const frame = page.frameLocator('iframe[title="preview"]');
    await frame.getByRole("heading", { name: /سلام/ }).waitFor({ timeout: 30000 });
    await frame.getByRole("status").getByText(/با بارگذاری مجدد، نشست این برگه از دست می‌رود/).waitFor();
    await frame.locator(".page-intro .button-primary", { hasText: "پروژه جدید" }).click();
    await frame.getByPlaceholder("مثلاً ساختمان مسکونی بهار").fill("فقط حافظه");
    await frame.locator(".modal-footer .button-primary", { hasText: "ایجاد پروژه" }).click();
    await frame.locator(".toast", { hasText: "پروژه جدید ایجاد شد" }).waitFor();
    console.log("✓ cookies and storage blocked: memory-only session works and warns about reload");
  } finally { await noStorage.close(); }
} finally {
  await context.close();
  await browser.close();
}
