import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Connection pool for the application database.
 *
 * Two rules matter for deployments:
 *  1. Every network step has a timeout. Postgres' default `connectionTimeoutMillis`
 *     is 0 ("wait forever"), so an unreachable host makes the request never settle —
 *     which the UI shows as an endless loading screen with no error and no retry.
 *  2. A missing `DATABASE_URL` must not crash the module import. Throwing here breaks
 *     `next build` (page data collection imports the route) and hides the real cause
 *     behind a generic 500. Instead the pool points at a closed port so the first
 *     query fails immediately with a descriptive message from `@/db/errors`.
 */

const databaseUrl = process.env.DATABASE_URL?.trim();

export const databaseConfigured = Boolean(databaseUrl);

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    // Port 1 refuses instantly: a deployment without DATABASE_URL reports a clear
    // configuration error instead of hanging on a connection attempt.
    connectionString: databaseUrl || "postgresql://127.0.0.1:1/database_url_missing",
    max: positiveIntFromEnv("DB_POOL_MAX", 10),
    connectionTimeoutMillis: positiveIntFromEnv("DB_CONNECT_TIMEOUT_MS", 8000),
    idleTimeoutMillis: positiveIntFromEnv("DB_IDLE_TIMEOUT_MS", 30000),
    // Server-side and client-side guards so a slow/locked database cannot hold a
    // request (and the loading screen) open indefinitely.
    statement_timeout: positiveIntFromEnv("DB_STATEMENT_TIMEOUT_MS", 15000),
    query_timeout: positiveIntFromEnv("DB_STATEMENT_TIMEOUT_MS", 15000),
    keepAlive: true,
    application_name: "metra",
  });

// Reuse the pool across hot reloads in development; in production a single module
// instance per process is enough and the OS reaps the sockets with the process.
if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

pool.on("error", (error) => {
  // Idle clients can be dropped by the server or a proxy; log instead of crashing.
  console.error("Postgres pool error", error instanceof Error ? error.message : error);
});

export const db = drizzle(pool);
