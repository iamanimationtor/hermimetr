import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await db.execute(sql`select bool_and(to_regclass(name) is not null) as ready
      from unnest(array['users','sessions','projects','source_references','price_items','project_documents',
        'takeoff_items','estimate_snapshots','audit_logs','rule_versions','engineering_reviews',
        'pricebook_editions','pricebook_items']) as tables(name)`);
    if (result.rows[0]?.ready !== true) return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
