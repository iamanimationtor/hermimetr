import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { checkAuthRateLimit, clearSession, createSession, currentUser, previewSessionHeaders, prunePresentedSession } from "@/lib/auth";
import { ApiError, apiFailure, requestBody } from "@/lib/api";

const emailSchema = z.string().trim().toLowerCase().email("ایمیل معتبر وارد کنید.").max(255);

export async function POST(request: Request) {
  try {
    const body = await requestBody(request) as Record<string, unknown>;
    if (body.action === "logout") {
      await clearSession();
      return Response.json({ ok: true });
    }
    if (!checkAuthRateLimit(request)) throw new ApiError("تلاش‌های ورود بیش از حد مجاز است؛ چند دقیقه دیگر تلاش کنید.", 429);
    await prunePresentedSession();
    const email = emailSchema.parse(body.email);
    const password = z.string().min(10, "رمز عبور باید حداقل ۱۰ نویسه داشته باشد.").max(128).parse(body.password);
    if (body.action === "register") {
      const name = z.string().trim().min(2).max(160).parse(body.name);
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new ApiError("این ایمیل قبلاً ثبت شده است.", 409);
      const guest = await currentUser();
      const passwordHash = await bcrypt.hash(password, 12);
      const [account] = guest?.isGuest
        ? await db.update(users).set({ email, passwordHash, name, isGuest: false }).where(eq(users.id, guest.id)).returning()
        : await db.insert(users).values({ email, passwordHash, name, isGuest: false }).returning();
      await clearSession();
      const token = await createSession(account.id);
      return Response.json({ user: { id: account.id, name: account.name, email: account.email, isGuest: false } }, { headers: previewSessionHeaders(request, token) });
    }
    if (body.action === "login") {
      const [account] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!account?.passwordHash || !(await bcrypt.compare(password, account.passwordHash))) throw new ApiError("ایمیل یا رمز عبور صحیح نیست.", 401);
      await clearSession();
      const token = await createSession(account.id);
      return Response.json({ user: { id: account.id, name: account.name, email: account.email, isGuest: false } }, { headers: previewSessionHeaders(request, token) });
    }
    throw new ApiError("عملیات ناشناخته است.");
  } catch (error) { return apiFailure(error); }
}
