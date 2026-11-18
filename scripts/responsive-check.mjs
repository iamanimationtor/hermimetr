// Layout regression: every main view must remain usable at mobile, tablet, and desktop widths.
// This checks actual DOM scroll dimensions, not artificial overflow clipping.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE || "http://127.0.0.1:3000";
const views = [
  ["dashboard", /سلام/], ["projects", /پروژه‌ها/], ["takeoff", /متره و مقادیر/],
  ["estimates", /برآورد مالی/], ["prices", /بانک قیمت‌ها/], ["documents", /نقشه‌ها و اسناد/],
  ["references", /منابع و ضوابط/], ["reports", /گزارش‌ها و خروجی‌ها/],
  ["rules", /بانک قواعد متره/], ["pricebook", /فهرست‌بها/],
];
const browser = await chromium.launch();
let checked = 0;
try {
  for (const width of [390, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, locale: "fa-IR" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    for (const [view, title] of views) {
      const response = await page.goto(`${base}/?view=${view}`, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200, `${width}px / ${view}: HTTP response`);
      await page.locator("main.content h1").waitFor();
      const heading = await page.locator("main.content h1").innerText();
      assert.match(heading, title, `${width}px / ${view}: heading`);
      const state = await page.evaluate(() => {
        const root = document.documentElement;
        return { overflow: root.scrollWidth - root.clientWidth, direction: getComputedStyle(root).direction };
      });
      assert.equal(state.direction, "rtl", `${width}px / ${view}: RTL direction`);
      assert.equal(state.overflow, 0, `${width}px / ${view}: horizontal page overflow is ${state.overflow}px`);
      assert.deepEqual(errors.splice(0), [], `${width}px / ${view}: browser console errors`);
      checked++;
    }
    if (width === 390) {
      // The dashboard table is wider than a phone; it must scroll inside its card, not the page.
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      const table = await page.evaluate(() => {
        const wrap = document.querySelector(".project-table-wrap");
        return { width: wrap.clientWidth, scroll: wrap.scrollWidth, overflow: getComputedStyle(wrap).overflowX };
      });
      assert(table.scroll > table.width, "dashboard project table must be wider than its mobile card");
      assert.equal(table.overflow, "auto", "the project table must have local horizontal scrolling");
    }
    if (width === 768) {
      await page.goto(`${base}/?view=rules`, { waitUntil: "networkidle" });
      const toolbar = await page.evaluate(() => {
        const bar = document.querySelector(".rule-toolbar");
        const tabs = bar.querySelector(".segmented").getBoundingClientRect();
        const search = bar.querySelector(".filter-search").getBoundingClientRect();
        return { searchTop: search.top, tabsBottom: tabs.bottom, searchLeft: search.left };
      });
      assert(toolbar.searchTop >= toolbar.tabsBottom && toolbar.searchLeft >= 0,
        "on portrait tablet, rule search must wrap below tabs without protruding outside the viewport");
    }
    console.log(`✓ ${width}px: all 10 views load RTL without horizontal overflow or browser errors`);
    await context.close();
  }
  assert.equal(checked, 40);
  console.log("Responsive check passed: 40 width/view combinations.");
} finally { await browser.close(); }
