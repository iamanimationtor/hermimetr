import { eq, and } from "drizzle-orm";
import { z, ZodError } from "zod";
import { db } from "@/db";
import { auditLogs, projects } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { CalculationError, normalizeDigits } from "@/lib/calculations";
import { RuleError } from "@/lib/rules/engine";
import { MAX_JSON_BYTES } from "@/lib/limits";

export class ApiError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const uuid = z.string().uuid();
export const shortText = (max = 240) => z.string().trim().min(1, "این فیلد الزامی است.").max(max);
export const optionalText = (max = 500) => z.string().trim().max(max).optional().nullable();

export function validDateLabel(value: string, label: string) {
  const normalized = normalizeDigits(value).replaceAll("-", "/");
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12 || Number(match[3]) < 1 || Number(match[3]) > 31) {
    throw new ApiError(`${label} باید به‌شکل سال/ماه/روز معتبر ثبت شود.`);
  }
  return `${match[1]}/${match[2].padStart(2, "0")}/${match[3].padStart(2, "0")}`;
}

export async function requestBody(request: Request): Promise<unknown> {
  const origin = request.headers.get("origin");
  if (origin) {
    const requestHost = request.headers.get("x-forwarded-host") || new URL(request.url).host;
    let originHost = "";
    try { originHost = new URL(origin).host; } catch { throw new ApiError("مبدأ درخواست مجاز نیست.", 403); }
    if (originHost !== requestHost) throw new ApiError("مبدأ درخواست مجاز نیست.", 403);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_JSON_BYTES) throw new ApiError("حجم درخواست بیش از حد مجاز است.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("بدنه درخواست معتبر نیست.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ApiError("حجم درخواست بیش از حد مجاز است.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { throw new ApiError("بدنه درخواست معتبر نیست."); }
}

export async function requiredUser() {
  const user = await currentUser();
  if (!user) throw new ApiError("نشست در دسترس نیست؛ ممکن است منقضی شده باشد یا مرورگر کوکی را مسدود کرده باشد. در صورت نیاز وارد حساب شوید یا سایت را در برگه مستقل باز کنید.", 401);
  return user;
}

export async function ownedProject(projectId: string, ownerId: string) {
  const id = uuid.parse(projectId);
  const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, ownerId))).limit(1);
  if (!project) throw new ApiError("پروژه یافت نشد یا دسترسی ندارید.", 404);
  return project;
}

export async function audit(ownerId: string, projectId: string | null, entityType: string, entityId: string | null, action: string,
  before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  await db.insert(auditLogs).values({ ownerId, projectId, entityType, entityId, action, before, after });
}

export function apiFailure(error: unknown) {
  if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message || "ورودی معتبر نیست." }, { status: 400 });
  if (error instanceof ApiError || error instanceof CalculationError) return Response.json({ error: error.message }, { status: error instanceof ApiError ? error.status : 400 });
  if (error instanceof RuleError) return Response.json({ error: error.message, kind: error.kind }, { status: 400 });
  const message = error instanceof Error ? error.message : "";
  // Missing or unreachable DB — surface as actionable 503 instead of generic 500
  if (message.includes("DATABASE_URL")) {
    console.error("[api] DATABASE_URL missing", error);
    return Response.json({ error: "پیکربندی پایگاه داده کامل نیست. متغیر DATABASE_URL را در تنظیمات محیط (Netlify → Environment variables) تنظیم و دوباره دیپلوی کنید." }, { status: 503 });
  }
  if (/connect ECONNREFUSED|getaddrinfo ENOTFOUND|Connection terminated|timeout expired|connectionTimeoutMillis|self signed certificate/i.test(message)) {
    console.error("[api] DB connection failed", error);
    return Response.json({ error: "اتصال به پایگاه داده برقرار نشد. مقدار DATABASE_URL و دسترسی شبکه دیتابیس را بررسی کنید." }, { status: 503 });
  }
  console.error("API error", error);
  return Response.json({ error: "خطای داخلی رخ داد. دوباره تلاش کنید." }, { status: 500 });
}
