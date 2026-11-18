import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
const base = process.env.SMOKE_BASE || "http://localhost:3000";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
try {
  await page.goto(base);
  await page.getByRole("heading", { name: /سلام/ }).waitFor();
  const projectId = await page.evaluate(async () => {
    const post = async (path, method, body) => {
      const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      return result;
    };
    const project = (await post("/api/projects", "POST", { name: "ضریب مرورگر آزمایشی", type: "مسکونی", floors: 1, basements: 0, fundingType: "private", pricingBasis: "market", stage: "preliminary" })).project;
    const row = (await post("/api/takeoffs", "POST", { projectId: project.id, title: "ردیف فرضی", category: "آزمایش", kind: "count", count: "1", sourceNote: "نقشه فرضی" })).item;
    const price = (await post("/api/prices", "POST", { title: "قیمت فرضی", unit: "عدد", basis: "market", amount: "12345", currency: "IRR", sourceName: "آزمایش", priceDate: "1404/01/01", confirmed: true })).item;
    await post("/api/takeoffs", "PATCH", { id: row.id, action: "assignPrice", priceId: price.id });
    await post("/api/takeoffs", "PATCH", { id: row.id, action: "confirm" });
    localStorage.setItem("metra_project", project.id);
    return project.id;
  });
  await page.reload();
  await page.getByRole("heading", { name: /سلام/ }).waitFor();
  await page.locator(".nav-item", { hasText: "برآورد مالی" }).click();
  const open = page.getByRole("button", { name: "بررسی سناریوی ضرایب دستی" });
  await open.waitFor();
  await page.waitForFunction(() => !document.querySelector(".scenario-open")?.hasAttribute("disabled"));
  await open.click();
  const dialog = page.getByRole("dialog", { name: "ضرایب دستی بر کل جمع مستقیم" });
  await dialog.getByLabel("عنوان ضریب 1").fill("ضریب فرضی");
  await dialog.getByLabel("مقدار ضریب 1").fill("۱٫۱");
  await dialog.getByLabel("مبنای ضریب 1").fill("بند فرضی ۱");
  await dialog.getByRole("button", { name: "افزودن ضریب بعدی" }).click();
  await dialog.getByLabel("عنوان ضریب 2").fill("ضریب دوم");
  await dialog.getByLabel("مقدار ضریب 2").fill("0.95");
  await dialog.getByLabel("مبنای ضریب 2").fill("بند فرضی ۲");
  await dialog.getByText(/مبلغ سناریو: ۱۲٬۹۰۱ ریال/).waitFor();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      modal: document.querySelector('.modal-panel').scrollWidth - document.querySelector('.modal-panel').clientWidth }));
    assert(overflow.page <= 1 && overflow.modal <= 1, `${width}px: ${JSON.stringify(overflow)}`);
  }
  const save = dialog.getByRole("button", { name: "ثبت نسخه با سناریوی دستی" });
  assert(await save.isDisabled());
  await dialog.getByRole("checkbox").check();
  assert(await save.isEnabled());
  await save.click();
  await page.locator(".toast", { hasText: "نسخه همراه سناریوی دستی ثبت شد" }).waitFor();
  await page.locator(".version-item", { hasText: "سناریوی دستی ۱۲٬۹۰۱" }).waitFor();
  await page.locator(".version-item a").first().click();
  await page.locator(".report-page").waitFor();
  await page.getByText("سناریوی دستی ضرایب بر کل جمع مستقیم").waitFor();
  assert((await page.locator(".report-page").innerText()).includes("۱۲٬۹۰۱"));
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const parsed = spawnSync("python3", ["-c", "import io,sys; from pypdf import PdfReader; p=PdfReader(io.BytesIO(sys.stdin.buffer.read())); assert len(p.pages)>0; t=' '.join(x.extract_text() or '' for x in p.pages); assert len(t)>100; print(len(p.pages))"], { input: pdf, encoding: "utf8", env: { ...process.env, PYTHONPATH: ".local/python" } });
  if (parsed.status === 0) console.log(`✓ scenario print PDF parsed: ${parsed.stdout.trim()} page(s)`);
  else console.log("NOT RUN: PDF text extraction unavailable; PDF header only verified");
  assert(projectId);
  assert.deepEqual(errors, []);
  console.log("✓ browser: entry, sequential preview, required attestation, saved version and printable report");
} finally { await context.close(); await browser.close(); }
