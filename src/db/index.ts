import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

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
  if (!url) throw new Error("DATABASE_URL is required");
  return url;
}

function createPool(): Pool {
  return new Pool({
    connectionString: getDatabaseUrl(),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
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
