import { pool } from "@/db";
import { schemaStatements } from "@/db/schema-sql";

/**
 * Creates the tables a fresh database needs before the first query runs.
 *
 * Deployments start against an empty database (the schema was only ever pushed by
 * hand in development), which used to fail every API call. The DDL in schema-sql.ts
 * is generated from the Drizzle migrations and is idempotent, so running it on an
 * existing database is a no-op — guarded by a fast `to_regclass` check and a
 * PostgreSQL advisory lock so concurrent cold starts cannot race each other.
 *
 * Disable with AUTO_MIGRATE=false when the schema is managed by an external
 * migration pipeline.
 */

const SCHEMA_LOCK_KEY = 727_274_001;

const globalForSchema = globalThis as typeof globalThis & {
  __metraSchemaReady?: Promise<void>;
};

async function schemaExists(client: { query: (text: string) => Promise<{ rows: Array<{ present: boolean | null }> }> }) {
  const result = await client.query("select to_regclass('public.users') is not null as present");
  return result.rows[0]?.present === true;
}

async function createSchema() {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
    try {
      if (await schemaExists(client)) return;
      for (const statement of schemaStatements) {
        await client.query(statement);
      }
      console.log(`Database schema created (${schemaStatements.length} statements)`);
    } finally {
      await client.query("select pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export function ensureSchema(): Promise<void> {
  if (process.env.AUTO_MIGRATE === "false") return Promise.resolve();
  if (!globalForSchema.__metraSchemaReady) {
    const pending = createSchema().catch((error) => {
      // Let the next request retry instead of caching a permanent failure.
      globalForSchema.__metraSchemaReady = undefined;
      throw error;
    });
    globalForSchema.__metraSchemaReady = pending;
  }
  return globalForSchema.__metraSchemaReady;
}
