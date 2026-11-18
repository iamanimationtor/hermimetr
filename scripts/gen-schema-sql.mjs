#!/usr/bin/env node
/**
 * Regenerates `src/db/schema-sql.ts` from the Drizzle migrations in `drizzle/`.
 *
 * The deployment cannot rely on `drizzle-kit push` being run by hand against the
 * production database (that step is what leaves a fresh deploy with no tables),
 * and reading .sql files at runtime is not guaranteed to survive bundling. So the
 * DDL is inlined as a TypeScript module and made idempotent here.
 *
 * Usage: node scripts/gen-schema-sql.mjs
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const migrationsDir = path.join(root, "drizzle");
const target = path.join(root, "src/db/schema-sql.ts");

const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
if (!files.length) {
  console.error("No .sql migrations found in drizzle/. Run `npm run db:generate` first.");
  process.exit(1);
}

const statements = [];
for (const file of files) {
  const sqlText = await readFile(path.join(migrationsDir, file), "utf8");
  for (const chunk of sqlText.split("--> statement-breakpoint")) {
    const statement = chunk.trim();
    if (!statement || statement.startsWith("--")) continue;
    statements.push(makeIdempotent(statement));
  }
}

function makeIdempotent(statement) {
  if (/^CREATE TABLE "/i.test(statement)) return statement.replace(/^CREATE TABLE "/i, 'CREATE TABLE IF NOT EXISTS "');
  if (/^CREATE INDEX "/i.test(statement)) return statement.replace(/^CREATE INDEX "/i, 'CREATE INDEX IF NOT EXISTS "');
  if (/^CREATE UNIQUE INDEX "/i.test(statement)) return statement.replace(/^CREATE UNIQUE INDEX "/i, 'CREATE UNIQUE INDEX IF NOT EXISTS "');
  const foreignKey = /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY ([\s\S]*?);?$/.exec(statement);
  if (foreignKey) {
    const [, table, constraint, rest] = foreignKey;
    return [
      "DO $$",
      "BEGIN",
      `  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraint}') THEN`,
      `    ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}" FOREIGN KEY ${rest};`,
      "  END IF;",
      "END $$;",
    ].join("\n");
  }
  return statement;
}

const banner = `/**
 * Idempotent schema DDL generated from drizzle/${files.join(", drizzle/")}.
 *
 * Do not edit by hand: run \`npm run db:sql\` after changing src/db/schema.ts.
 * Every statement is safe to run on an existing database, which lets a fresh
 * deployment create its own tables on first request (see src/db/migrate.ts).
 */
`;

const body = `${banner}\nexport const schemaStatements: string[] = [\n${statements
  .map((statement) => `  ${JSON.stringify(statement)},`)
  .join("\n")}\n];\n`;

await writeFile(target, body, "utf8");
console.log(`Wrote ${statements.length} statements to ${path.relative(root, target)}`);
