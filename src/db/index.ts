import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

/**
 * Lazy database initialization — never throws at import time.
 *
 * Next.js collects page data at build time (even for `force-dynamic` routes)
 * by importing every route module. If we throw for a missing DATABASE_URL
 * at module load, the entire Netlify build fails before any code runs.
 * Instead we defer the throw to the first *actual* use of `db`/`pool`, so
 * the build can complete and the error only surfaces at runtime when a
 * request really needs the database.
 */

type DrizzleDb = ReturnType<typeof drizzle>;

const globalForDb = globalThis as typeof globalThis & {
  __hermimetrPool?: Pool;
  __hermimetrDb?: DrizzleDb;
  // keep legacy key for dev HMR from the previous implementation
  __arenaNextJsPostgresqlPool?: Pool;
};

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !url.trim()) throw new Error("DATABASE_URL is required");
  return url.trim();
}

function createPool(): Pool {
  const url = getDatabaseUrl();
  const config: PoolConfig = {
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    // Fail fast on unreachable hosts — the UI must not spin forever.
    connectionTimeoutMillis: 7_000,
    allowExitOnIdle: true,
    // Netlify/lambda: don't keep idle clients alive unnecessarily
    keepAlive: false,
  };
  // Many managed Postgres providers (Neon, Supabase, etc.) require TLS.
  // `pg` honours `?sslmode=require` in the URL in recent versions, but we
  // also set it explicitly when the URL clearly points to a non-local host
  // or already asks for SSL, to avoid silent connection hangs.
  const needsSSL =
    /sslmode=(require|verify-ca|verify-full)/i.test(url) ||
    (process.env.NODE_ENV === "production" && !/(localhost|127\.0\.0\.1)/.test(url));
  if (needsSSL) {
    config.ssl = { rejectUnauthorized: false };
  }
  return new Pool(config);
}

function getPool(): Pool {
  if (globalForDb.__hermimetrPool) return globalForDb.__hermimetrPool;
  if (globalForDb.__arenaNextJsPostgresqlPool) {
    globalForDb.__hermimetrPool = globalForDb.__arenaNextJsPostgresqlPool;
    return globalForDb.__hermimetrPool;
  }
  const pool = createPool();
  // Cache in dev so HMR doesn't leak pools; in production the lambda
  // reuses the same global across warm invocations.
  globalForDb.__hermimetrPool = pool;
  globalForDb.__arenaNextJsPostgresqlPool = pool;
  // Surface pool-level errors to logs instead of crashing silently
  pool.on("error", (err) => console.error("[db] pool error", err));
  return pool;
}

function getDb(): DrizzleDb {
  if (globalForDb.__hermimetrDb) return globalForDb.__hermimetrDb;
  const instance = drizzle(getPool());
  globalForDb.__hermimetrDb = instance;
  return instance;
}

/** Preferred accessor when you want an explicit runtime check. */
export function requireDb(): DrizzleDb {
  return getDb();
}

// Proxied exports preserve `import { db } from "@/db"` call sites while
// deferring the throw until a property/method is actually accessed.
function proxyFor<T extends object>(getter: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const real = getter() as unknown as Record<string | symbol, unknown>;
      const value = real[prop as string];
      if (typeof value === "function") return (value as (...args: unknown[]) => unknown).bind(real);
      return value;
    },
    has(_target, prop) {
      return prop in (getter() as unknown as object);
    },
    ownKeys() {
      return Reflect.ownKeys(getter() as unknown as object);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(getter() as unknown as object, prop);
      if (descriptor) descriptor.configurable = true;
      return descriptor;
    },
  });
}

export const pool: Pool = proxyFor(getPool);
export const db: DrizzleDb = proxyFor(getDb);
