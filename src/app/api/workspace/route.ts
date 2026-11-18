import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, estimateSnapshots, priceItems, pricebookEditions, projectDocuments, projects, sourceReferences, takeoffItems } from "@/db/schema";
import { checkGuestRateLimit, currentUser } from "@/lib/auth";
import { ApiError, apiFailure } from "@/lib/api";
import { assessRows, loadRuleBank } from "@/lib/rules/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const existing = await currentUser();
    if (!existing && !checkGuestRateLimit(request)) throw new ApiError("تعداد نشست‌های آزمایشی بیش از حد مجاز است؛ بعداً تلاش کنید یا با حساب قبلی وارد شوید.", 429);
    const user = existing ?? await currentUser(true);
    if (!user) throw new Error("Session creation failed");
    const projectList = await db.select().from(projects).where(eq(projects.ownerId, user.id)).orderBy(desc(projects.updatedAt));
    const ids = projectList.map((project) => project.id);
    const [measurements, prices, references, documents, estimates, activity, rules, editions] = await Promise.all([
      ids.length ? db.select().from(takeoffItems).where(inArray(takeoffItems.projectId, ids)).orderBy(desc(takeoffItems.createdAt)) : [],
      db.select().from(priceItems).where(eq(priceItems.ownerId, user.id)).orderBy(desc(priceItems.createdAt)),
      db.select().from(sourceReferences).where(eq(sourceReferences.ownerId, user.id)).orderBy(desc(sourceReferences.createdAt)),
      ids.length ? db.select({ id: projectDocuments.id, projectId: projectDocuments.projectId, fileName: projectDocuments.fileName,
        mimeType: projectDocuments.mimeType, sizeBytes: projectDocuments.sizeBytes, version: projectDocuments.version,
        description: projectDocuments.description, uploadedAt: projectDocuments.uploadedAt }).from(projectDocuments).where(inArray(projectDocuments.projectId, ids)).orderBy(desc(projectDocuments.uploadedAt)) : [],
      ids.length ? db.select().from(estimateSnapshots).where(inArray(estimateSnapshots.projectId, ids)).orderBy(desc(estimateSnapshots.createdAt)) : [],
      db.select().from(auditLogs).where(eq(auditLogs.ownerId, user.id)).orderBy(desc(auditLogs.createdAt)).limit(30),
      loadRuleBank(user.id),
      db.select({
        id: pricebookEditions.id, title: pricebookEditions.title, discipline: pricebookEditions.discipline, baseYear: pricebookEditions.baseYear,
        referenceId: pricebookEditions.referenceId, status: pricebookEditions.status, notes: pricebookEditions.notes, createdAt: pricebookEditions.createdAt,
        // The outer column is written fully qualified on purpose: an unqualified "id" would bind to pricebook_items.id inside the subquery.
        itemCount: sql<number>`(select count(*)::int from pricebook_items where pricebook_items.edition_id = pricebook_editions.id)`,
      }).from(pricebookEditions).where(eq(pricebookEditions.ownerId, user.id)).orderBy(desc(pricebookEditions.createdAt)),
    ]);
    return Response.json({ user: { id: user.id, name: user.name, email: user.email, isGuest: user.isGuest },
      projects: projectList, takeoffs: measurements, rowValidity: assessRows(measurements, rules.bank), prices, references, documents, estimates, activity,
      ruleBank: rules.bank, caseReviews: rules.caseReviews, editions });
  } catch (error) { return apiFailure(error); }
}
