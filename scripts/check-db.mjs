#!/usr/bin/env node
/**
 * Checks a DATABASE_URL the same way the app does: with hard timeouts, so a broken
 * deployment answers in seconds instead of hanging.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npm run db:check
 */
import "dotenv/config";
import { Client } from "pg";

const url = process.env.DATABASE_URL?.trim();

const fail = (message, detail) => {
  console.error(`✗ ${message}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(1);
};

if (!url) fail("DATABASE_URL تنظیم نشده است.", "متغیر محیطی را در سرور یا فایل .env قرار دهید.");

let host = "";
try {
  const parsed = new URL(url);
  host = `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
} catch {
  fail("DATABASE_URL یک نشانی معتبر نیست.", "قالب درست: postgresql://user:password@host:5432/database");
}

const client = new Client({
  connectionString: url,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8000),
  query_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),
});

const startedAt = Date.now();
try {
  await client.connect();
  console.log(`✓ اتصال به پایگاه داده برقرار شد (${host}) در ${Date.now() - startedAt} میلی‌ثانیه`);
} catch (error) {
  const code = error?.code ? ` (${error.code})` : "";
  fail(`اتصال به پایگاه داده برقرار نشد${code}: ${error?.message ?? error}`,
    "دسترسی شبکه سرور به میزبان پایگاه داده، صحت نام کاربری/رمز و فعال بودن سرور را بررسی کنید. برای اتصال رمزنگاری‌شده «?sslmode=require» را به انتهای نشانی اضافه کنید.");
}

try {
  const { rows } = await client.query("select to_regclass('public.users') is not null as present");
  if (rows[0]?.present) {
    console.log("✓ جدول‌های برنامه موجود هستند.");
  } else {
    console.log("! جدول‌های برنامه ساخته نشده‌اند؛ با اولین درخواست به برنامه، یا با اجرای `npm run db:push` ساخته می‌شوند.");
  }
  const { rows: counts } = await client.query("select count(*)::int as users from users").catch(() => ({ rows: [{ users: null }] }));
  if (counts[0]?.users !== null) console.log(`  کاربران ثبت‌شده: ${counts[0].users}`);
  console.log("✓ پایگاه داده آماده است.");
} catch (error) {
  fail(`پرس‌وجوی آزمایشی ناموفق بود: ${error?.message ?? error}`);
} finally {
  await client.end().catch(() => undefined);
}
