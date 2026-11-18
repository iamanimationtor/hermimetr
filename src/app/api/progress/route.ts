import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, estimateSnapshots, progressReports, projects } from "@/db/schema";
import { ApiError, apiFailure, requestBody, requiredUser, uuid } from "@/lib/api";
import { calculateProgress, progressInputSchema, sanitizeProgressPeriod } from "@/lib/progress";

export const dynamic = "force-dynamic";
const createSchema = z.object({ action: z.literal("create"), snapshotId: uuid, expectedSequence: z.number().int().min(0),
  expectedActiveId: uuid.nullable(), period: z.string().trim().min(1).max(160), notes: z.string().trim().max(1000).optional(),
  rows: z.array(progressInputSchema).min(1).max(500), attest: z.literal(true, { error: "تأیید مبنا، مقادیر و محدودیت‌ها الزامی است." }) }).strict();
const voidSchema = z.object({ action: z.literal("void"), snapshotId: uuid, reportId: uuid, expectedSequence: z.number().int().min(1),
  reason: z.string().trim().min(5, "دلیل ابطال حداقل پنج نویسه باشد.").max(500) }).strict();

async function ownedSnapshot(id: string, ownerId: string, client: Pick<typeof db, "select"> = db) {
  const [found] = await client.select({ snapshot: estimateSnapshots, projectId: projects.id }).from(estimateSnapshots)
    .innerJoin(projects, eq(projects.id, estimateSnapshots.projectId))
    .where(and(eq(estimateSnapshots.id, id), eq(projects.ownerId, ownerId))).limit(1);
  if (!found) throw new ApiError("نسخه برآورد یافت نشد یا دسترسی ندارید.", 404);
  return found.snapshot;
}

export async function GET(request: Request) {
  try {
    const user = await requiredUser();
    const snapshotId = uuid.parse(new URL(request.url).searchParams.get("snapshotId"));
    const snapshot = await ownedSnapshot(snapshotId, user.id);
    const reports = await db.select().from(progressReports).where(eq(progressReports.snapshotId, snapshotId)).orderBy(desc(progressReports.sequence));
    return Response.json({ snapshot: { id: snapshot.id, version: snapshot.version, rows: snapshot.rows, totalRial: snapshot.totalRial,
      projectSnapshot: snapshot.projectSnapshot }, reports }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requiredUser();
    const body = z.discriminatedUnion("action", [createSchema, voidSchema]).parse(await requestBody(request));
    await ownedSnapshot(body.snapshotId, user.id);
    const perform = () => db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM estimate_snapshots WHERE id = ${body.snapshotId} FOR UPDATE`);
      const snapshot = await ownedSnapshot(body.snapshotId, user.id, tx);
      const [latest] = await tx.select().from(progressReports).where(eq(progressReports.snapshotId, snapshot.id)).orderBy(desc(progressReports.sequence)).limit(1);
      const [active] = await tx.select().from(progressReports).where(and(eq(progressReports.snapshotId, snapshot.id), isNull(progressReports.voidedAt))).orderBy(desc(progressReports.sequence)).limit(1);
      if ((latest?.sequence ?? 0) !== body.expectedSequence) throw new ApiError("تاریخچه پیشرفت تغییر کرده است؛ اطلاعات را تازه و دوباره بررسی کنید.", 409);
      if (body.action === "void") {
        if (!active || active.id !== body.reportId) throw new ApiError("فقط آخرین گزارش معتبر قابل ابطال است؛ تاریخچه را تازه کنید.", 409);
        const safeReason = body.reason.replace(/^[\s\uFEFF]*[=+\-@\t\r]/, "'$&");
        const [voided] = await tx.update(progressReports).set({ voidedAt: new Date(), voidReason: safeReason })
          .where(and(eq(progressReports.id, active.id), isNull(progressReports.voidedAt))).returning();
        if (!voided) throw new ApiError("گزارش قبلاً ابطال شده است.", 409);
        await tx.insert(auditLogs).values({ ownerId: user.id, projectId: snapshot.projectId, entityType: "progress", entityId: active.id,
          action: "void", before: { sequence: active.sequence }, after: { reason: body.reason, snapshotId: snapshot.id } });
        return { report: voided };
      }
      if ((active?.id ?? null) !== body.expectedActiveId) throw new ApiError("گزارش مبنا تغییر کرده است؛ اطلاعات را تازه کنید.", 409);
      const period = sanitizeProgressPeriod(body.period);
      const safeNotes = body.notes ? body.notes.replace(/^[\s\uFEFF]*[=+\-@\t\r]/, "'$&") : null;
      let calculated;
      try { calculated = calculateProgress(snapshot.rows, snapshot.totalRial, active?.rows ?? null, body.rows); }
      catch (error) { throw new ApiError(error instanceof Error ? error.message : "مقادیر معتبر نیستند."); }
      const [report] = await tx.insert(progressReports).values({ snapshotId: snapshot.id, sequence: (latest?.sequence ?? 0) + 1,
        period, rows: calculated.rows, totals: calculated.totals, actorId: user.id, notes: safeNotes }).returning();
      await tx.insert(auditLogs).values({ ownerId: user.id, projectId: snapshot.projectId, entityType: "progress", entityId: report.id,
        action: "create", before: { previousReportId: active?.id ?? null }, after: { snapshotId: snapshot.id, sequence: report.sequence,
          period: report.period, totals: calculated.totals, attested: true } });
      return { report };
    }, { isolationLevel: "serializable" });
    for (let attempt = 0; attempt < 8; attempt++) {
      try { return Response.json(await perform(), { status: body.action === "create" ? 201 : 200 }); }
      catch (error) {
        let current: unknown = error; let retryable = false;
        for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
          const cause = current as { code?: string; constraint?: string; cause?: unknown };
          if (cause.code === "40001" || cause.code === "40P01" || (cause.code === "23505" && cause.constraint === "progress_snapshot_sequence_unique")) retryable = true;
          current = cause.cause;
        }
        if (!retryable || attempt === 7) throw error;
      }
    }
    throw new Error("Progress transaction did not complete");
  } catch (error) { return apiFailure(error); }
}
