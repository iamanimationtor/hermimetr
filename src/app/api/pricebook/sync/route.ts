import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { pricebookEditions, pricebookSyncStates, sourceReferences } from "@/db/schema";
import { ApiError, apiFailure, audit, requestBody, requiredUser, uuid } from "@/lib/api";
import { checkOfficialSource } from "@/lib/pricebook/sync";
import { isAllowedOfficialHost } from "@/lib/pricebook/publisher-registry";

export const dynamic = "force-dynamic";

async function ownedEdition(id: string, ownerId: string) {
  const [ed] = await db.select().from(pricebookEditions).where(and(eq(pricebookEditions.id, id), eq(pricebookEditions.ownerId, ownerId))).limit(1);
  if (!ed) throw new ApiError("نسخه فهرست‌بها یافت نشد.", 404);
  return ed;
}

export async function GET(request: Request) {
  try {
    const user = await requiredUser();
    const url = new URL(request.url);
    const editionId = url.searchParams.get("editionId");
    const referenceId = url.searchParams.get("referenceId");
    if (editionId) {
      const edition = await ownedEdition(uuid.parse(editionId), user.id);
      const [sync] = await db.select().from(pricebookSyncStates).where(eq(pricebookSyncStates.editionId, edition.id)).limit(1).catch(() => [] as any);
      let refUrl: string | null = null;
      if (edition.referenceId) {
        const [ref] = await db.select({ url: sourceReferences.url }).from(sourceReferences).where(and(eq(sourceReferences.id, edition.referenceId), eq(sourceReferences.ownerId, user.id))).limit(1);
        refUrl = ref?.url ?? null;
      }
      if (!refUrl) {
        return Response.json({ sync: sync ?? null, check: { ok: false, url: "", messageFa: "برای این نسخه سند مرجع با URL ثبت نشده است.", detailFa: "در «منابع مرجع» URL رسمی mporg.ir را ثبت کنید." } });
      }
      const prev = sync ? { hash: sync.lastRemoteHash, etag: sync.etag } : undefined;
      const check = await checkOfficialSource(refUrl, prev);
      // persist last check (best-effort)
      try {
        if (sync) {
          await db.update(pricebookSyncStates).set({ lastCheckedAt: new Date(), lastError: check.ok ? null : check.messageFa, etag: check.etag ?? sync.etag, updateAvailable: check.updateAvailable ?? false }).where(eq(pricebookSyncStates.id, sync.id));
        } else {
          await db.insert(pricebookSyncStates).values({ ownerId: user.id, editionId: edition.id, referenceId: edition.referenceId, sourceUrl: refUrl, lastCheckedAt: new Date(), updateAvailable: check.updateAvailable ?? false, lastError: check.ok ? null : check.messageFa } as any);
        }
      } catch {}
      return Response.json({ sync: sync ?? null, check, edition: { id: edition.id, title: edition.title, status: edition.status, referenceId: edition.referenceId } });
    }
    if (referenceId) {
      const [ref] = await db.select().from(sourceReferences).where(and(eq(sourceReferences.id, uuid.parse(referenceId)), eq(sourceReferences.ownerId, user.id))).limit(1);
      if (!ref) throw new ApiError("سند مرجع یافت نشد.", 404);
      const [sync] = await db.select().from(pricebookSyncStates).where(eq(pricebookSyncStates.referenceId, ref.id)).limit(1).catch(() => [] as any);
      const prev = sync ? { hash: sync.lastRemoteHash, etag: sync.etag } : undefined;
      const check = await checkOfficialSource(ref.url ?? "", prev);
      try {
        if (sync) await db.update(pricebookSyncStates).set({ lastCheckedAt: new Date(), lastError: check.ok ? null : check.messageFa, etag: check.etag ?? sync.etag, updateAvailable: check.updateAvailable ?? false }).where(eq(pricebookSyncStates.id, sync.id));
        else await db.insert(pricebookSyncStates).values({ ownerId: user.id, referenceId: ref.id, sourceUrl: ref.url, lastCheckedAt: new Date(), updateAvailable: check.updateAvailable ?? false, lastError: check.ok ? null : check.messageFa } as any);
      } catch {}
      return Response.json({ sync: sync ?? null, check, reference: { id: ref.id, title: ref.title, url: ref.url } });
    }
    // list all sync states
    const all = await db.select().from(pricebookSyncStates).where(eq(pricebookSyncStates.ownerId, user.id)).catch(() => [] as any);
    const editions = await db.select({ id: pricebookEditions.id, title: pricebookEditions.title, status: pricebookEditions.status, referenceId: pricebookEditions.referenceId }).from(pricebookEditions).where(eq(pricebookEditions.ownerId, user.id));
    return Response.json({ syncStates: all, editions });
  } catch (e) { return apiFailure(e); }
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const body = await requestBody(request) as Record<string, unknown>;
    if (body.action === "enableAutoCheck") {
      const { editionId, enabled } = z.object({ editionId: uuid, enabled: z.boolean() }).parse(body);
      const edition = await ownedEdition(editionId, user.id);
      const [existing] = await db.select().from(pricebookSyncStates).where(eq(pricebookSyncStates.editionId, edition.id)).limit(1);
      if (existing) await db.update(pricebookSyncStates).set({ autoCheckEnabled: enabled }).where(eq(pricebookSyncStates.id, existing.id));
      else await db.insert(pricebookSyncStates).values({ ownerId: user.id, editionId: edition.id, referenceId: edition.referenceId, autoCheckEnabled: enabled } as any);
      await audit(user.id, null, "pricebook", edition.id, enabled ? "enable_auto_check" : "disable_auto_check", null, { enabled });
      return Response.json({ ok: true });
    }
    if (body.action === "setSourceUrl") {
      const { referenceId, url } = z.object({ referenceId: uuid, url: z.string().trim().min(8).max(1000) }).parse(body);
      if (!isAllowedOfficialHost(url)) throw new ApiError("فقط دامنه‌های رسمی mporg.ir برای منبع خودکار مجازند.");
      const [ref] = await db.select().from(sourceReferences).where(and(eq(sourceReferences.id, referenceId), eq(sourceReferences.ownerId, user.id))).limit(1);
      if (!ref) throw new ApiError("سند مرجع یافت نشد.", 404);
      if (ref.kind !== "pricebook") throw new ApiError("فقط اسناد نوع فهرست‌بها می‌توانند منبع خودکار داشته باشند.");
      await db.update(sourceReferences).set({ url }).where(eq(sourceReferences.id, ref.id));
      const [sync] = await db.select().from(pricebookSyncStates).where(eq(pricebookSyncStates.referenceId, ref.id)).limit(1).catch(() => [] as any);
      if (sync) await db.update(pricebookSyncStates).set({ sourceUrl: url }).where(eq(pricebookSyncStates.id, sync.id));
      else await db.insert(pricebookSyncStates).values({ ownerId: user.id, referenceId: ref.id, sourceUrl: url } as any);
      await audit(user.id, null, "pricebook", ref.id, "set_source_url", { url: ref.url }, { url });
      return Response.json({ ok: true });
    }
    throw new ApiError("عملیات نامعتبر است.");
  } catch (e) { return apiFailure(e); }
}
