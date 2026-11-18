import { defineConfig } from "drizzle-kit";

const migrationUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!migrationUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required for database migrations");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: migrationUrl },
});
