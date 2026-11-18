import { sql } from "drizzle-orm";
import { db, databaseConfigured } from "@/db";
import { describeDatabaseError } from "@/db/errors";
import { ensureSchema } from "@/db/migrate";

export const dynamic = "force-dynamic";

async function usersTableExists() {
  const result = await db.execute<{ present: boolean }>(sql`select to_regclass('public.users') is not null as present`);
  return result.rows[0]?.present === true;
}

/**
 * Deployment probe. It answers the questions the loading screen cannot:
 * is the database configured, is it reachable, and do its tables exist?
 *
 * Open it on the deployed URL: GET /api/health
 * Only error codes and short hints are returned — never credentials.
 */
export async function GET() {
  const startedAt = Date.now();

  if (!databaseConfigured) {
    return Response.json({
      ok: false,
      database: { configured: false, reachable: false, schemaReady: false },
      error: describeDatabaseError({ code: "ECONNREFUSED", message: "DATABASE_URL is not set" })?.hint,
      code: "DATABASE_URL_MISSING",
    }, { status: 503 });
  }

  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    const issue = describeDatabaseError(error);
    return Response.json({
      ok: false,
      database: { configured: true, reachable: false, schemaReady: false, latencyMs: Date.now() - startedAt },
      error: issue?.hint ?? "اتصال به پایگاه داده برقرار نشد.",
      code: issue?.code ?? "CONNECT_FAILED",
    }, { status: 503 });
  }

  try {
    await ensureSchema();
    const schemaReady = await usersTableExists();
    return Response.json({
      ok: schemaReady,
      database: { configured: true, reachable: true, schemaReady, latencyMs: Date.now() - startedAt },
    }, { status: schemaReady ? 200 : 503 });
  } catch (error) {
    const issue = describeDatabaseError(error);
    return Response.json({
      ok: false,
      database: { configured: true, reachable: true, schemaReady: false, latencyMs: Date.now() - startedAt },
      error: issue?.hint ?? "ساخت جدول‌های پایگاه داده کامل نشد.",
      code: issue?.code ?? "SCHEMA_FAILED",
    }, { status: 503 });
  }
}
