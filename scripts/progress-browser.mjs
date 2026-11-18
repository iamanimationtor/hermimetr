import assert from "node:assert/strict";
import { chromium } from "playwright";
const base = process.env.METRA_BASE || "http://127.0.0.1:3000";
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const ctx = await browser.newContext({ locale: "fa-IR" });
const page = await ctx.newPage();
await page.goto(`${base}/?view=progress`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "پیشرفت کار" }).first().waitFor({ timeout: 15000 });
await page.getByText("برای گزارش پیشرفت").first().waitFor({ timeout: 8000 }).catch(async () => await page.getByTestId("progress-view").waitFor({ timeout: 8000 }));
// create minimal project via API to allow UI to have snapshot
await page.evaluate(async () => {
  const r = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "پروژه مرورگر پیشرفت", type: "مسکونی", fundingType: "private", pricingBasis: "market", stage: "detailed" }) });
  return r.ok;
});
await page.reload();
await page.getByRole("button", { name: "پیشرفت کار" }).click();
await page.getByText("نسخه").first().waitFor({ timeout: 10000 }).catch(()=>{});
for (const w of [390, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  const ov = await page.evaluate(()=> document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(ov <= 2, `${w}px overflow ${ov}`);
}
await browser.close();
console.log("✓ progress browser responsive");
