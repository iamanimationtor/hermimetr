import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).unique(),
  passwordHash: text("password_hash"),
  name: varchar("name", { length: 160 }).notNull(),
  role: varchar("role", { length: 32 }).default("owner").notNull(),
  isGuest: boolean("is_guest").default(true).notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [index("sessions_user_idx").on(table.userId)]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 220 }).notNull(),
  code: varchar("code", { length: 60 }),
  type: varchar("type", { length: 80 }).default("مسکونی").notNull(),
  province: varchar("province", { length: 100 }),
  city: varchar("city", { length: 100 }),
  area: numeric("area", { precision: 18, scale: 3 }),
  floors: integer("floors").default(0).notNull(),
  basements: integer("basements").default(0).notNull(),
  structure: varchar("structure", { length: 100 }),
  foundation: varchar("foundation", { length: 100 }),
  employer: varchar("employer", { length: 160 }),
  contractor: varchar("contractor", { length: 160 }),
  contractType: varchar("contract_type", { length: 100 }),
  fundingType: varchar("funding_type", { length: 32 }).default("private").notNull(),
  pricingBasis: varchar("pricing_basis", { length: 32 }).default("market").notNull(),
  contractReference: text("contract_reference"),
  estimateDate: varchar("estimate_date", { length: 30 }),
  stage: varchar("stage", { length: 32 }).default("conceptual").notNull(),
  status: varchar("status", { length: 24 }).default("active").notNull(),
  notes: text("notes"),
  isDemo: boolean("is_demo").default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("projects_owner_idx").on(table.ownerId)]);

export const sourceReferences = pgTable("source_references", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 300 }).notNull(),
  kind: varchar("kind", { length: 50 }).notNull(),
  issuer: varchar("issuer", { length: 220 }).notNull(),
  documentNumber: varchar("document_number", { length: 120 }),
  issueDate: varchar("issue_date", { length: 30 }),
  effectiveDate: varchar("effective_date", { length: 30 }),
  basePeriod: varchar("base_period", { length: 60 }),
  scope: text("scope"),
  amendments: text("amendments"),
  replacement: text("replacement"),
  status: varchar("status", { length: 24 }).default("unverified").notNull(),
  url: text("url"),
  notes: text("notes"),
  createdAt: createdAt(),
}, (table) => [index("references_owner_idx").on(table.ownerId)]);

export const priceItems = pgTable("price_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 300 }).notNull(),
  code: varchar("code", { length: 80 }),
  category: varchar("category", { length: 100 }),
  unit: varchar("unit", { length: 20 }).notNull(),
  basis: varchar("basis", { length: 32 }).notNull(),
  amount: numeric("amount", { precision: 22, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("IRR").notNull(),
  sourceName: varchar("source_name", { length: 240 }).notNull(),
  sourceUrl: text("source_url"),
  supplier: varchar("supplier", { length: 200 }),
  region: varchar("region", { length: 120 }),
  priceDate: varchar("price_date", { length: 30 }).notNull(),
  validUntil: varchar("valid_until", { length: 30 }),
  referenceId: uuid("reference_id").references(() => sourceReferences.id, { onDelete: "set null" }),
  confirmed: boolean("confirmed").default(false).notNull(),
  // Phase 2: set when the price was created from a user-confirmed pricebook match.
  pricebookItemId: uuid("pricebook_item_id"),
  createdAt: createdAt(),
}, (table) => [index("prices_owner_idx").on(table.ownerId)]);

export const projectDocuments = pgTable("project_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  contentBase64: text("content_base64").notNull(),
  version: varchar("version", { length: 80 }).default("نسخه ۱").notNull(),
  description: text("description"),
  uploadedAt: createdAt(),
}, (table) => [index("documents_project_idx").on(table.projectId)]);

export const takeoffItems = pgTable("takeoff_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 240 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  floor: varchar("floor", { length: 80 }),
  location: varchar("location", { length: 160 }),
  kind: varchar("kind", { length: 24 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  length: numeric("length", { precision: 18, scale: 4 }),
  width: numeric("width", { precision: 18, scale: 4 }),
  height: numeric("height", { precision: 18, scale: 4 }),
  count: numeric("count", { precision: 18, scale: 4 }).notNull(),
  unitWeight: numeric("unit_weight", { precision: 18, scale: 4 }),
  deduction: numeric("deduction", { precision: 18, scale: 4 }).default("0").notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 4 }).notNull(),
  formula: text("formula").notNull(),
  sourceNote: text("source_note"),
  ruleReference: text("rule_reference"),
  documentId: uuid("document_id").references(() => projectDocuments.id, { onDelete: "set null" }),
  priceId: uuid("price_id").references(() => priceItems.id, { onDelete: "set null" }),
  status: varchar("status", { length: 24 }).default("draft").notNull(),
  isDemo: boolean("is_demo").default(false).notNull(),
  // Phase 2 (all nullable so historic rows stay untouched): rule-engine traceability.
  ruleRef: varchar("rule_ref", { length: 160 }),
  ruleKey: varchar("rule_key", { length: 120 }),
  ruleVersion: integer("rule_version"),
  ruleHash: varchar("rule_hash", { length: 64 }),
  ruleInputs: jsonb("rule_inputs").$type<{ values: Record<string, string>; lists: Record<string, Record<string, string>[]> }>(),
  ruleTrace: jsonb("rule_trace").$type<Record<string, unknown>[]>(),
  excelFormula: text("excel_formula"),
  certainty: varchar("certainty", { length: 24 }),
  fingerprint: varchar("fingerprint", { length: 64 }),
  duplicateNote: text("duplicate_note"),
  pricebookItemId: uuid("pricebook_item_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("takeoffs_project_idx").on(table.projectId)]);

export const estimateSnapshots = pgTable("estimate_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  basis: varchar("basis", { length: 32 }).notNull(),
  totalRial: numeric("total_rial", { precision: 24, scale: 0 }).notNull(),
  rows: jsonb("rows").$type<Record<string, unknown>[]>().notNull(),
  projectSnapshot: jsonb("project_snapshot").$type<Record<string, unknown>>().notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("estimates_project_version_unique").on(table.projectId, table.version)]);

// Append-only quantity progress against one immutable estimate snapshot. Voiding keeps history.
export const progressReports = pgTable("progress_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  snapshotId: uuid("snapshot_id").notNull().references(() => estimateSnapshots.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  period: varchar("period", { length: 160 }).notNull(),
  rows: jsonb("rows").$type<Record<string, unknown>[]>().notNull(),
  totals: jsonb("totals").$type<Record<string, unknown>>().notNull(),
  actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  notes: text("notes"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("progress_snapshot_sequence_unique").on(table.snapshotId, table.sequence), index("progress_snapshot_idx").on(table.snapshotId)]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  entityType: varchar("entity_type", { length: 40 }).notNull(),
  entityId: uuid("entity_id"),
  action: varchar("action", { length: 32 }).notNull(),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  createdAt: createdAt(),
}, (table) => [index("audit_owner_idx").on(table.ownerId)]);

/* ───────────── Phase 2: versioned measurement rules, engineering reviews, official pricebook ───────────── */

// Workspace-authored rule versions. Rows are immutable once written; a change is always a new version.
export const ruleVersions = pgTable("rule_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ruleKey: varchar("rule_key", { length: 120 }).notNull(),
  version: integer("version").notNull(),
  baseRef: varchar("base_ref", { length: 160 }),
  definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
  definitionHash: varchar("definition_hash", { length: 64 }).notNull(),
  referenceId: uuid("reference_id").references(() => sourceReferences.id, { onDelete: "set null" }),
  status: varchar("status", { length: 24 }).default("active").notNull(),
  changeNote: text("change_note"),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("rule_versions_owner_key_version").on(table.ownerId, table.ruleKey, table.version)]);

// Append-only record of expert reviews. A review is bound to the exact content hash it was given for.
export const engineeringReviews = pgTable("engineering_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subjectType: varchar("subject_type", { length: 24 }).notNull(),
  subjectKey: varchar("subject_key", { length: 200 }).notNull(),
  definitionHash: varchar("definition_hash", { length: 64 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(),
  reviewerName: varchar("reviewer_name", { length: 160 }).notNull(),
  reviewerCredential: varchar("reviewer_credential", { length: 200 }),
  // Phase 3: full provenance of an approval — who, in what role, when, against which document and rule version.
  reviewerRole: varchar("reviewer_role", { length: 80 }),
  ruleRef: varchar("rule_ref", { length: 160 }),
  ruleKey: varchar("rule_key", { length: 120 }),
  ruleVersion: integer("rule_version"),
  referenceId: uuid("reference_id"),
  basis: varchar("basis", { length: 24 }),
  note: text("note"),
  createdAt: createdAt(),
}, (table) => [index("reviews_owner_subject_idx").on(table.ownerId, table.subjectType, table.subjectKey)]);

export const pricebookEditions = pgTable("pricebook_editions", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 300 }).notNull(),
  discipline: varchar("discipline", { length: 100 }).notNull(),
  baseYear: varchar("base_year", { length: 20 }).notNull(),
  referenceId: uuid("reference_id").references(() => sourceReferences.id, { onDelete: "set null" }),
  status: varchar("status", { length: 24 }).default("draft").notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
}, (table) => [index("editions_owner_idx").on(table.ownerId)]);

export const pricebookItems = pgTable("pricebook_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  editionId: uuid("edition_id").notNull().references(() => pricebookEditions.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 30 }).notNull(),
  chapterCode: varchar("chapter_code", { length: 20 }),
  chapterTitle: varchar("chapter_title", { length: 200 }),
  description: text("description").notNull(),
  unit: varchar("unit", { length: 40 }).notNull(),
  unitPriceRial: numeric("unit_price_rial", { precision: 22, scale: 2 }),
  conditions: text("conditions"),
  notes: text("notes"),
  page: varchar("page", { length: 20 }),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("pricebook_items_edition_code").on(table.editionId, table.code)]);

// Hybrid auto-sync: tracks last check of official source for each edition/reference.
// No price is ever overwritten automatically — a detected change only creates a notification + draft for user confirmation.
export const pricebookSyncStates = pgTable("pricebook_sync_states", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  editionId: uuid("edition_id").references(() => pricebookEditions.id, { onDelete: "cascade" }),
  referenceId: uuid("reference_id").references(() => sourceReferences.id, { onDelete: "cascade" }),
  sourceUrl: text("source_url"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastRemoteHash: varchar("last_remote_hash", { length: 128 }),
  lastRemoteModified: varchar("last_remote_modified", { length: 120 }),
  etag: varchar("etag", { length: 200 }),
  updateAvailable: boolean("update_available").default(false).notNull(),
  autoCheckEnabled: boolean("auto_check_enabled").default(true).notNull(),
  lastError: text("last_error"),
  createdAt: createdAt(),
}, (table) => [index("sync_owner_idx").on(table.ownerId), uniqueIndex("sync_edition_unique").on(table.editionId)]);
