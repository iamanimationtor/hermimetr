// Real-browser (Chromium via Playwright) test of the phase-2 user interface. Requires a running server.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const shots = process.env.SHOT_DIR || "/tmp/shots";
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fa-IR" });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) pageErrors.push(message.text()); });
page.on("dialog", (dialog) => dialog.accept());

const nav = (label) => page.locator(".nav-item", { hasText: label }).click();
const toast = (text) => page.locator(".toast", { hasText: text }).waitFor({ timeout: 15000 });
const shot = (name, fullPage = false) => page.screenshot({ path: `${shots}/${name}.png`, fullPage });
const fillRule = async (values) => { for (const [key, value] of Object.entries(values)) await page.fill(`[data-param="${key}"]`, value); };
const rowOf = (title) => page.locator("tr.clickable-row", { hasText: title });

try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /سلام/ }).waitFor();
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  await shot("01-dashboard");
  const lastNav = await page.locator(".nav-item", { hasText: "گزارش‌ها" }).boundingBox();
  const sidebarBottom = await page.locator(".sidebar-bottom").boundingBox();
  assert(lastNav.y + lastNav.height <= sidebarBottom.y + 1, "every navigation entry must be fully visible above the sidebar footer");

  // A real (non-educational) project is needed for confirmable rows.
  await page.locator(".page-intro .button-primary", { hasText: "پروژه جدید" }).click();
  await page.getByPlaceholder("مثلاً ساختمان مسکونی بهار").fill("پروژه آزمون مرورگر");
  await page.locator(".modal-footer .button-primary", { hasText: "ایجاد پروژه" }).click();
  await toast("پروژه جدید ایجاد شد");
  console.log("✓ dashboard renders right-to-left and a project can be created");

  // Rule bank.
  await nav("بانک قواعد متره");
  await page.getByRole("heading", { name: "بانک قواعد متره" }).waitFor();
  assert.equal(await page.locator("[data-rule]").count(), 29);
  await page.locator('[data-rule="sys:concrete.prism@2"]').click();
  const card = page.locator('[data-testid="rule-card"]');
  await card.getByText("سند تأییدنشده").first().waitFor();
  assert(await card.getByText("آزمایشی — تأییدنشده").first().isVisible());
  assert((await card.innerText()).includes("فصل هشتم"));
  await shot("02-rule-card", true);
  await page.locator(".segmented button", { hasText: "مثال‌های مرجع" }).click();
  await page.getByText("۳۰ از ۳۰ منطبق").waitFor();
  await page.locator("tr.clickable-row", { hasText: "RC-E2" }).click();
  await page.getByText("محاسبه دستی").first().waitFor();
  await shot("03-reference-cases");
  await page.locator(".segmented button", { hasText: "دفتر منابع رسمی" }).click();
  assert.equal(await page.locator(".register-card").count(), 10);
  assert.equal(await page.locator(".register-card .badge-orange", { hasText: "تأییدنشده" }).count(), 10);
  // The 1405 entry must show the dated, contradictory intermediary reports rather than a verdict.
  const abnieh1405 = page.locator(".register-card", { hasText: "فهرست‌بهای واحد پایه رشته ابنیه سال ۱۴۰۵" });
  await abnieh1405.locator(".report-list li").first().waitFor();
  assert((await abnieh1405.locator(".report-list").innerText()).includes("مرداد ۱۴۰۵"));
  assert.equal(await page.locator(".register-card", { hasText: "ضرایب اصلاحی فهرست‌بهای ابنیه برای سال ۱۴۰۵" }).count(), 1);
  console.log("✓ rule bank lists 29 rule versions, 30 matching reference cases and 10 unverified official documents");

  // Rule calculator with live trace, saving and duplicate guard.
  const openCalculator = async (ruleRef, title, location) => {
    await page.locator(".intro-actions .button-primary", { hasText: "محاسبه با قاعده" }).click();
    await page.selectOption('[data-testid="calc-rule"]', ruleRef);
    await fillRule({ length: "12.5", width: "8.2", height: "0.6" });
    await page.click('[data-add-list="voids"]');
    for (const [field, value] of Object.entries({ v_length: "0.4", v_width: "0.4", v_height: "0.6", v_count: "2" })) await page.fill(`[data-field="voids.0.${field}"]`, value);
    await page.fill('[data-testid="calc-title"]', title);
    await page.fill('[data-testid="calc-location"]', location);
    await page.fill('[data-testid="calc-source"]', "نقشه آزمایشی S-01، محور ۱ تا ۳");
  };
  await nav("متره و مقادیر");
  await openCalculator("sys:concrete.prism@1", "بتن فونداسیون آزمون مرورگر", "محور A تا C");
  const result = page.locator('[data-testid="calc-result"]');
  await result.getByText("۶۱٫۳۰۸").waitFor();
  assert((await page.locator('[data-testid="calc-trace"]').innerText()).includes("12.5 × 8.2 × 0.6 × 1"));
  await page.fill('[data-param="length"]', "abc");
  await page.locator('[data-testid="calc-trace"]').getByText("باید عدد نامنفی معتبر باشد").waitFor();
  assert(await page.locator('[data-testid="calc-save"]').isDisabled(), "invalid input must disable saving");
  await page.fill('[data-param="length"]', "12.5");
  await result.getByText("۶۱٫۳۰۸").waitFor();
  await shot("04-calculator");
  await page.click('[data-testid="calc-save"]');
  await toast("ریزمتره ثبت شد");
  await rowOf("بتن فونداسیون آزمون مرورگر").waitFor();

  await openCalculator("sys:concrete.prism@1", "تکرار همان محاسبه", "محور A تا C");
  await page.click('[data-testid="calc-save"]');
  await page.locator(".dup-box", { hasText: "ردیف مشابهی" }).waitFor();
  assert(await page.locator('[data-testid="calc-save"]').isDisabled(), "a duplicate needs a stated reason");
  await page.locator(".modal-footer .button-outline", { hasText: "انصراف" }).click();
  assert.equal(await rowOf("تکرار همان محاسبه").count(), 0);
  console.log("✓ calculator shows a live trace, blocks invalid input, saves a draft row and refuses a duplicate");

  // Confirmation of a geometric row and inline trace.
  await rowOf("بتن فونداسیون آزمون مرورگر").locator('button[title="تأیید مقدار"]').click();
  await toast("نهایی شد");
  await rowOf("بتن فونداسیون آزمون مرورگر").getByText("تأییدشده").waitFor();
  await rowOf("بتن فونداسیون آزمون مرورگر").locator("td").first().click();
  await page.locator(".rule-trace-inline", { hasText: "ردیابی محاسبه با قاعده" }).waitFor();
  await shot("05-takeoff-trace");

  // An unverified regulatory draft is stored as provisional and cannot be confirmed.
  await openCalculator("sys:concrete.prism@2", "بتن با ضابطه پیش‌نویس", "محور D");
  await page.click('[data-testid="calc-save"]');
  await toast("آزمایشی");
  await rowOf("بتن با ضابطه پیش‌نویس").getByText("آزمایشی").first().waitFor();
  await rowOf("بتن با ضابطه پیش‌نویس").locator('button[title="تأیید مقدار"]').click();
  await toast("قابل تأیید قطعی نیست");
  assert.equal(await rowOf("بتن با ضابطه پیش‌نویس").getByText("تأییدشده").count(), 0);
  console.log("✓ geometric row is confirmed with its trace; a provisional row cannot be confirmed from the interface");

  // Pricebook: edition, validated import, gated activation.
  await nav("فهرست‌بها");
  await page.getByText("هنوز نسخه‌ای از فهرست‌بها ثبت نشده است").waitFor();
  await page.locator(".page-intro .button-primary", { hasText: "نسخه جدید فهرست‌بها" }).click();
  await page.getByPlaceholder("مثلاً فهرست‌بهای واحد پایه رشته ابنیه").fill("فهرست آزمایشی مرورگر (داده آزمون)");
  await page.getByPlaceholder("مثلاً ۱۴۰۴").fill("1404");
  await page.locator(".modal-footer .button-primary", { hasText: "ایجاد نسخه پیش‌نویس" }).click();
  await toast("نسخه پیش‌نویس ساخته شد");
  const edition = page.locator('[data-edition="فهرست آزمایشی مرورگر (داده آزمون)"]');
  await edition.locator("button", { hasText: "ورود ردیف‌ها" }).click();
  await page.fill('[data-testid="import-text"]', "code,description,unit,price\nT-1,ردیف آزمایشی,عدد,abc");
  await page.click('[data-testid="import-submit"]');
  await page.locator(".error-box", { hasText: "بهای واحد" }).waitFor();
  await page.fill('[data-testid="import-text"]', "code,chapterTitle,description,unit,price\nT-0801,بتن درجا (آزمایشی),بتن با مقاومت 25 مگاپاسکال (داده آزمایشی),مترمکعب,2000000\nT-0701,میلگرد (آزمایشی),میلگرد آجدار (داده آزمایشی),کیلوگرم,50000");
  await page.click('[data-testid="import-submit"]');
  await toast("ردیف وارد شد");
  await page.locator(".pricebook-items code", { hasText: "T-0801" }).waitFor();
  await edition.locator("button", { hasText: "فعال‌سازی" }).click();
  await toast("سند مرجع");
  await edition.getByText("پیش‌نویس").waitFor();
  await shot("06-pricebook");

  // Match dialog explains why nothing can be confirmed yet.
  await nav("متره و مقادیر");
  await rowOf("بتن فونداسیون آزمون مرورگر").locator('button[title="پیشنهاد ردیف فهرست‌بها"]').click();
  await page.getByText("هیچ نسخه فعال فهرست‌بها").waitFor();
  assert(await page.locator('[data-testid="match-confirm"]').isDisabled());
  await shot("07-match-dialog");
  await page.locator(".modal-footer .button-outline", { hasText: "بستن" }).click();
  console.log("✓ pricebook import is validated, activation is gated by the reference, and matching stays a blocked suggestion");

  // ── Phase 3: new disciplines, reviewer role, and full rule authoring ──
  await nav("بانک قواعد متره");
  await page.locator(".rule-filter button", { hasText: "اسکلت فلزی" }).click();
  assert.equal(await page.locator("[data-rule]").count(), 4, "four steel rules are scaffolded");
  await page.locator('[data-rule="sys:steel.member_mass@1"]').click();
  await page.locator('[data-testid="rule-card"]').getByText("اسکلت فلزی").first().waitFor();
  assert((await page.locator('[data-testid="rule-card"]').innerText()).includes("جرم واحد طول"));

  // Compute a steel row through the calculator (list-only rule).
  await nav("متره و مقادیر");
  await page.locator(".intro-actions .button-primary", { hasText: "محاسبه با قاعده" }).click();
  await page.selectOption('[data-testid="calc-rule"]', "sys:steel.member_mass@1");
  // This rule declares minItems 1, so the first list row is already present.
  assert.equal(await page.locator('[data-field^="members.0."]').count(), 3);
  for (const [field, value] of Object.entries({ m_length: "4.2", m_count: "6", unit_mass: "42.6" })) await page.fill(`[data-field="members.0.${field}"]`, value);
  await page.fill('[data-testid="calc-title"]', "میلگرد و پروفیل آزمون مرورگر");
  await page.fill('[data-testid="calc-source"]', "لیستوفر آزمایشی آزمون مرورگر");
  await page.locator('[data-testid="calc-result"]').getByText("۱٬۰۷۳٫۵۲").waitFor();
  await page.click('[data-testid="calc-save"]');
  await toast("ریزمتره ثبت شد");
  await rowOf("میلگرد و پروفیل آزمون مرورگر").waitFor();
  await rowOf("میلگرد و پروفیل آزمون مرورگر").locator('button[title="تأیید مقدار"]').click();
  await toast("نهایی شد");
  await rowOf("میلگرد و پروفیل آزمون مرورگر").getByText("تأییدشده").waitFor();
  console.log("✓ steel rules are computable and confirmable through the interface");

  // Reviewer role is part of the approval record.
  await nav("بانک قواعد متره");
  await page.locator('[data-rule="sys:steel.member_mass@1"]').click();
  await page.locator('[data-testid="rule-card"] .review-actions button', { hasText: "ثبت بازبینی" }).click();
  await page.locator('[data-testid="review-role"]').waitFor();
  assert.equal(await page.locator('[data-testid="review-role"] option').count(), 5);
  await page.fill('[data-testid="review-name"]', "بازبین آزمون مرورگر");
  await page.selectOption('[data-testid="review-role"]', "technical_manager");
  await page.locator('[data-testid="review-attest"]').check();
  await page.click('[data-testid="review-submit"]');
  await toast("تأیید متخصص ثبت شد");
  await page.locator('[data-rule="sys:steel.member_mass@1"]').click();
  await page.locator('[data-testid="rule-card"] .review-line.approved', { hasText: "بازبین آزمون مرورگر" }).waitFor();
  assert((await page.locator('[data-testid="rule-card"] .review-box').innerText()).includes("مدیر دفتر فنی"));
  console.log("✓ reviewer identity and role are recorded and displayed");

  // Full definition editor: adding a parameter and an invalid formula is caught live.
  await page.locator('[data-testid="rule-card"] .rule-actions button', { hasText: "نسخه مستند جدید" }).click();
  await page.locator('[data-testid="add-parameter"]').click();
  const paramRow = page.locator('[data-testid="parameters-editor"] > div').last();
  await paramRow.locator("input").first().fill("waste");
  await paramRow.locator("input").nth(1).fill("ضریب پرت");
  const lastFormula = page.locator(".step-editor > div").last().locator("input.step-formula");
  // The steel rule this editor was opened for defines total_length, mass and the list "members".
  // A formula that reads an undeclared name must be rejected before anything is sent to the server.
  await lastFormula.fill("sum(members, m_length * m_count * unit_mass) * unknown_factor");
  await page.locator(".error-box", { hasText: "تعریف قاعده نامعتبر" }).waitFor();
  // The newly added parameter is immediately usable in the formula.
  await lastFormula.fill("sum(members, m_length * m_count * unit_mass) * waste");
  await page.locator(".ok-box", { hasText: "فرمول‌ها ایمن" }).waitFor();
  await lastFormula.fill("sum(members, m_length * m_count * unit_mass)");
  await page.locator(".ok-box", { hasText: "فرمول‌ها ایمن" }).waitFor();
  await page.fill('[data-testid="version-change-note"]', "آزمون ویرایشگر تعریف قاعده در مرورگر");
  await page.locator('.modal-footer button[data-testid="version-submit"]').click();
  await toast("ثبت شد");
  await page.locator('[data-testid="rule-card"]', { hasText: "نسخه ۲" }).first().waitFor();
  console.log("✓ rule definitions can be extended with new parameters; invalid formulas are rejected live");

  // An outdated notice appears for rows computed with an older rule version.
  await nav("متره و مقادیر");
  await page.locator('[data-testid="outdated-banner"]').waitFor();
  await rowOf("میلگرد و پروفیل آزمون مرورگر").getByText("نسخه جدید قاعده موجود است").waitFor();
  await rowOf("میلگرد و پروفیل آزمون مرورگر").locator("td").first().click();
  await page.locator('[data-testid="row-validity"]', { hasText: "نسخه ۲" }).waitFor();
  await shot("10-outdated-notice");
  // The blocking banner is expected to list the provisional trial row from the earlier scenario,
  // but it must NOT list the steel row: a newer rule version is informational, not blocking.
  const banner = page.locator('[data-testid="validity-banner"]');
  assert.equal(await banner.count(), 1, "the provisional trial row remains blocked, as designed");
  assert((await banner.innerText()).includes("بتن با ضابطه پیش‌نویس"), "the blocking banner lists the provisional row");
  assert(!(await banner.innerText()).includes("میلگرد و پروفیل آزمون مرورگر"), "the outdated row must not be treated as blocked");
  console.log("✓ a newer rule version is reported informationally without blocking the row");

  // Dark theme and a narrow viewport.
  await nav("بانک قواعد متره");
  await page.locator('button[title="تم تاریک"]').click();
  await page.locator(".app-frame.theme-dark").waitFor();
  await page.waitForTimeout(450); // colour transition
  const contrast = await page.evaluate(() => {
    const rgb = (value) => value.match(/\d+/g).slice(0, 3).map(Number);
    const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const title = document.querySelector(".rule-head h2");
    const card = document.querySelector(".rule-card");
    return luminance(rgb(getComputedStyle(title).color)) - luminance(rgb(getComputedStyle(card).backgroundColor));
  });
  assert(contrast > 120, `rule title must be readable on the dark card (luminance difference ${contrast})`);
  await shot("08-rules-dark");
  // Regression: on 768px portrait tablets the tabs and search field previously overflowed
  // 13px to the left in RTL. Verify that the flex items actually wrap (not clipped).
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const toolbar = document.querySelector(".rule-toolbar");
      const tabs = toolbar.querySelector(".segmented").getBoundingClientRect();
      const search = toolbar.querySelector(".filter-search").getBoundingClientRect();
      return { overflow: root.scrollWidth - root.clientWidth, searchLeft: search.left,
        searchRight: search.right, tabsBottom: tabs.bottom, searchTop: search.top };
    });
    assert.equal(layout.overflow, 0, `${width}px viewport has horizontal overflow: ${layout.overflow}px`);
    assert(layout.searchLeft >= -1 && layout.searchRight <= width + 1,
      `search field protrudes outside ${width}px viewport`);
    if (width === 768) assert(layout.searchTop >= layout.tabsBottom,
      "portrait tablet must wrap rule search beneath the tabs rather than clip it");
  }
  console.log("✓ 390/768/1024/1440px rule views have zero horizontal overflow; 768px toolbar wraps cleanly");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".rule-list").waitFor();
  await page.waitForTimeout(500); // let the off-canvas sidebar transition finish
  const sidebar = await page.locator(".sidebar").boundingBox();
  assert(sidebar.x >= 388, "the sidebar must be off-canvas on a narrow viewport");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 2, `horizontal overflow on mobile: ${overflow}px`);
  await shot("09-rules-mobile");
  assert.deepEqual(pageErrors, [], "the browser console must stay free of errors");
  console.log("✓ dark theme and mobile layout render without horizontal overflow or console errors");
  console.log("Browser test passed.");
} catch (error) {
  await shot("failure", true).catch(() => {});
  console.error("Browser test failed:", error);
  console.error("Console errors:", pageErrors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
