import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema } from "@/db/migrate";
import { projects, sessions, takeoffItems, users } from "@/db/schema";
import { calculateQuantity, type GeometryInput } from "@/lib/calculations";

const COOKIE_NAME = "metra_session";
const MAX_AGE = 60 * 60 * 24 * 30;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

async function seedGuest(ownerId: string) {
  const demoProjects = await db.insert(projects).values([
    { ownerId, name: "مجتمع مسکونی نمونه", code: "DEMO-001", type: "مسکونی", province: "تهران", city: "تهران", area: "1250", floors: 5, basements: 2, structure: "بتنی", foundation: "گسترده", stage: "preliminary", status: "active", isDemo: true, notes: "پروژه صرفاً آموزشی است؛ ابعاد و مقادیر نمونه، مبنای تصمیم اجرایی یا مالی نیستند." },
    { ownerId, name: "ساختمان اداری نمونه", code: "DEMO-002", type: "اداری", province: "اصفهان", city: "اصفهان", area: "860", floors: 4, basements: 1, structure: "فولادی", stage: "conceptual", status: "active", isDemo: true, notes: "اطلاعات فرضی برای آشنایی با فضای کار." },
    { ownerId, name: "بازسازی ویلای نمونه", code: "DEMO-003", type: "بازسازی", province: "گیلان", city: "رشت", area: "320", floors: 2, basements: 0, stage: "conceptual", status: "archived", isDemo: true, notes: "پروژه آموزشی آرشیوشده." },
  ]).returning();
  const samples: Array<{ projectId: string; title: string; category: string; floor: string; location: string; geometry: GeometryInput }> = [
    { projectId: demoProjects[0].id, title: "حجم هندسی فونداسیون", category: "بتن‌ریزی", floor: "زیرزمین ۲", location: "پی اصلی", geometry: { kind: "volume", length: "12", width: "8", height: "0.5", count: "1" } },
    { projectId: demoProjects[0].id, title: "مساحت هندسی دیوار پیرامونی", category: "دیوارچینی", floor: "همکف", location: "پیرامون پلان", geometry: { kind: "area", length: "20", width: "3", count: "2", deduction: "12" } },
    { projectId: demoProjects[0].id, title: "طول هندسی لوله‌کشی", category: "تأسیسات مکانیکی", floor: "طبقه اول", location: "مسیر نمونه", geometry: { kind: "length", length: "42", count: "2" } },
    { projectId: demoProjects[0].id, title: "شمارش درب‌های داخلی", category: "درب و پنجره", floor: "طبقه اول", location: "اتاق‌ها", geometry: { kind: "count", count: "8" } },
    { projectId: demoProjects[1].id, title: "مساحت هندسی کف نمونه", category: "کف‌سازی", floor: "همکف", location: "سالن", geometry: { kind: "area", length: "14", width: "9", count: "1" } },
  ];
  await db.insert(takeoffItems).values(samples.map((sample) => {
    const result = calculateQuantity(sample.geometry);
    return { projectId: sample.projectId, title: sample.title, category: sample.category, floor: sample.floor, location: sample.location,
      kind: sample.geometry.kind, unit: result.unit, length: sample.geometry.length?.toString(), width: sample.geometry.width?.toString(),
      height: sample.geometry.height?.toString(), count: sample.geometry.count?.toString() ?? "1", unitWeight: sample.geometry.unitWeight?.toString(),
      deduction: sample.geometry.deduction?.toString() ?? "0", quantity: result.quantity, formula: result.formula,
      sourceNote: "ابعاد فرضی؛ فقط داده آموزشی", status: "draft", isDemo: true };
  }));
}

export async function currentUser(createGuest = false) {
  // Every authenticated request funnels through here, so the schema bootstrap runs
  // before the first query of a fresh deployment (and stays cached afterwards).
  await ensureSchema();
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    const [row] = await db.select({ user: users }).from(sessions).innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date()))).limit(1);
    if (row) return row.user;
  }
  if (!createGuest) return null;
  const [guest] = await db.insert(users).values({ name: "مهندس همراه", isGuest: true }).returning();
  await seedGuest(guest.id);
  await createSession(guest.id);
  return guest;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({ userId, tokenHash: hash(token), expiresAt: new Date(Date.now() + MAX_AGE * 1000) });
  const store = await cookies();
  // A Secure cookie is dropped by the browser on a plain-HTTP deployment, which would
  // start a brand-new guest workspace on every request. Only relax it when the request
  // explicitly arrived over HTTP.
  const forwardedProto = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const secureOverride = process.env.COOKIE_SECURE?.trim().toLowerCase();
  const secure = secureOverride
    ? secureOverride === "true"
    : process.env.NODE_ENV === "production" && forwardedProto !== "http";
  store.set(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: MAX_AGE });
}

export async function clearSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));
  store.delete(COOKIE_NAME);
}

/**
 * Minimal in-memory rate limiter for authentication attempts (login/register).
 * Single-instance guard against credential stuffing; a shared store would be needed for multi-instance deploys.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 30;

const guestAttempts = new Map<string, { count: number; resetAt: number }>();

function withinLimit(request: Request, entries: Map<string, { count: number; resetAt: number }>, maximum: number): boolean {
  // A reverse proxy must overwrite X-Forwarded-For on public deployments; direct IP headers
  // are not an identity proof. This limiter is only a single-instance backstop.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const record = entries.get(ip);
  if (!record || now >= record.resetAt) {
    if (entries.size >= 5000) {
      for (const [key, value] of entries) if (value.resetAt <= now) entries.delete(key);
      if (entries.size >= 5000) entries.delete(entries.keys().next().value!);
    }
    entries.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return true;
  }
  record.count += 1;
  return record.count <= maximum;
}

export function checkAuthRateLimit(request: Request): boolean {
  return withinLimit(request, attempts, AUTH_MAX_ATTEMPTS);
}

/** Applies only when a request would create a new guest, not to existing guest/account sessions. */
export function checkGuestRateLimit(request: Request): boolean {
  return withinLimit(request, guestAttempts, 60);
}

/** Lazily removes the presented session row when it is expired or unknown, so stale rows do not accumulate. */
export async function prunePresentedSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return;
  const [row] = await db.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.tokenHash, hash(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  if (!row) await db.delete(sessions).where(eq(sessions.tokenHash, hash(token)));
}
