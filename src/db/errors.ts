import { databaseConfigured } from "@/db";

/**
 * Turns low-level database failures into an actionable, user-facing message.
 *
 * The loading screen has no other way to tell "the database is unreachable" from
 * "the code is broken", so every failure mode that is fixable by configuration is
 * named explicitly here.
 */

export type DatabaseIssue = {
  kind: "database";
  code: string;
  hint: string;
  status: number;
};

type ErrorLike = { code?: unknown; message?: unknown; cause?: unknown };

const CONNECTIVITY_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ENETDOWN",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
  "53300",
]);

const AUTH_CODES = new Set(["28P01", "28000", "42501"]);
const SSL_CODES = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
]);

const TIMEOUT_PATTERN = /timeout|timed out|Connection terminated|Client has encountered a connection error/i;
const SSL_PATTERN = /ssl|tls|certificate/i;

function readError(error: unknown): { code: string; message: string } | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as ErrorLike;
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const code = typeof candidate.code === "string" ? candidate.code : "";
  if (code) return { code, message };
  const nested = readError(candidate.cause);
  if (nested) return nested;
  return message ? { code: "", message } : null;
}

export function describeDatabaseError(error: unknown): DatabaseIssue | null {
  const details = readError(error);
  const message = details?.message ?? (error instanceof Error ? error.message : "");
  const code = details?.code ?? "";

  const looksLikeConnectionProblem =
    CONNECTIVITY_CODES.has(code) || TIMEOUT_PATTERN.test(message) || SSL_CODES.has(code);

  if (!databaseConfigured && looksLikeConnectionProblem) {
    return {
      kind: "database",
      code: "DATABASE_URL_MISSING",
      hint: "متغیر محیطی DATABASE_URL روی سرور تنظیم نشده است. نشانی پایگاه داده را در تنظیمات محیط استقرار اضافه کنید و برنامه را دوباره راه‌اندازی کنید.",
      status: 503,
    };
  }

  if (AUTH_CODES.has(code)) {
    return {
      kind: "database",
      code,
      hint: "نام کاربری یا رمز پایگاه داده پذیرفته نشد. مقدار DATABASE_URL و دسترسی کاربر پایگاه داده را بررسی کنید.",
      status: 503,
    };
  }

  if (code === "3D000") {
    return {
      kind: "database",
      code,
      hint: "پایگاه داده‌ای که در DATABASE_URL آمده وجود ندارد. ابتدا آن را در سرور پایگاه داده بسازید.",
      status: 503,
    };
  }

  if (code === "42P01" || code === "3F000") {
    return {
      kind: "database",
      code,
      hint: "جدول‌های برنامه در پایگاه داده ساخته نشده‌اند. با راه‌اندازی مجدد سرور (ساخت خودکار شِما) یا اجرای «npm run db:push» این مرحله انجام می‌شود.",
      status: 503,
    };
  }

  if (SSL_CODES.has(code) || (SSL_PATTERN.test(message) && !CONNECTIVITY_CODES.has(code))) {
    return {
      kind: "database",
      code: code || "SSL",
      hint: "اتصال امن (SSL) به پایگاه داده برقرار نشد. اگر سرویس پایگاه داده اتصال رمزنگاری‌شده لازم دارد، «?sslmode=require» را به انتهای DATABASE_URL اضافه کنید.",
      status: 503,
    };
  }

  if (CONNECTIVITY_CODES.has(code) || TIMEOUT_PATTERN.test(message)) {
    return {
      kind: "database",
      code: code || "CONNECT_FAILED",
      hint: "اتصال به پایگاه داده برقرار نشد یا بیش از حد طول کشید. دسترسی شبکه سرور به میزبان پایگاه داده، صحت DATABASE_URL و فعال بودن سرور پایگاه داده را بررسی کنید.",
      status: 503,
    };
  }

  return null;
}
