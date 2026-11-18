CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"project_id" uuid,
	"entity_type" varchar(40) NOT NULL,
	"entity_id" uuid,
	"action" varchar(32) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engineering_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"subject_type" varchar(24) NOT NULL,
	"subject_key" varchar(200) NOT NULL,
	"definition_hash" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"reviewer_name" varchar(160) NOT NULL,
	"reviewer_credential" varchar(200),
	"reviewer_role" varchar(80),
	"rule_ref" varchar(160),
	"rule_key" varchar(120),
	"rule_version" integer,
	"reference_id" uuid,
	"basis" varchar(24),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"basis" varchar(32) NOT NULL,
	"total_rial" numeric(24, 0) NOT NULL,
	"rows" jsonb NOT NULL,
	"project_snapshot" jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"code" varchar(80),
	"category" varchar(100),
	"unit" varchar(20) NOT NULL,
	"basis" varchar(32) NOT NULL,
	"amount" numeric(22, 2) NOT NULL,
	"currency" varchar(8) DEFAULT 'IRR' NOT NULL,
	"source_name" varchar(240) NOT NULL,
	"source_url" text,
	"supplier" varchar(200),
	"region" varchar(120),
	"price_date" varchar(30) NOT NULL,
	"valid_until" varchar(30),
	"reference_id" uuid,
	"confirmed" boolean DEFAULT false NOT NULL,
	"pricebook_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricebook_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"discipline" varchar(100) NOT NULL,
	"base_year" varchar(20) NOT NULL,
	"reference_id" uuid,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricebook_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"chapter_code" varchar(20),
	"chapter_title" varchar(200),
	"description" text NOT NULL,
	"unit" varchar(40) NOT NULL,
	"unit_price_rial" numeric(22, 2),
	"conditions" text,
	"notes" text,
	"page" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_base64" text NOT NULL,
	"version" varchar(80) DEFAULT 'نسخه ۱' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" varchar(220) NOT NULL,
	"code" varchar(60),
	"type" varchar(80) DEFAULT 'مسکونی' NOT NULL,
	"province" varchar(100),
	"city" varchar(100),
	"area" numeric(18, 3),
	"floors" integer DEFAULT 0 NOT NULL,
	"basements" integer DEFAULT 0 NOT NULL,
	"structure" varchar(100),
	"foundation" varchar(100),
	"employer" varchar(160),
	"contractor" varchar(160),
	"contract_type" varchar(100),
	"funding_type" varchar(32) DEFAULT 'private' NOT NULL,
	"pricing_basis" varchar(32) DEFAULT 'market' NOT NULL,
	"contract_reference" text,
	"estimate_date" varchar(30),
	"stage" varchar(32) DEFAULT 'conceptual' NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"notes" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"rule_key" varchar(120) NOT NULL,
	"version" integer NOT NULL,
	"base_ref" varchar(160),
	"definition" jsonb NOT NULL,
	"definition_hash" varchar(64) NOT NULL,
	"reference_id" uuid,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "source_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"kind" varchar(50) NOT NULL,
	"issuer" varchar(220) NOT NULL,
	"document_number" varchar(120),
	"issue_date" varchar(30),
	"effective_date" varchar(30),
	"base_period" varchar(60),
	"scope" text,
	"amendments" text,
	"replacement" text,
	"status" varchar(24) DEFAULT 'unverified' NOT NULL,
	"url" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "takeoff_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"category" varchar(100) NOT NULL,
	"floor" varchar(80),
	"location" varchar(160),
	"kind" varchar(24) NOT NULL,
	"unit" varchar(20) NOT NULL,
	"length" numeric(18, 4),
	"width" numeric(18, 4),
	"height" numeric(18, 4),
	"count" numeric(18, 4) NOT NULL,
	"unit_weight" numeric(18, 4),
	"deduction" numeric(18, 4) DEFAULT '0' NOT NULL,
	"quantity" numeric(20, 4) NOT NULL,
	"formula" text NOT NULL,
	"source_note" text,
	"rule_reference" text,
	"document_id" uuid,
	"price_id" uuid,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"rule_ref" varchar(160),
	"rule_key" varchar(120),
	"rule_version" integer,
	"rule_hash" varchar(64),
	"rule_inputs" jsonb,
	"rule_trace" jsonb,
	"excel_formula" text,
	"certainty" varchar(24),
	"fingerprint" varchar(64),
	"duplicate_note" text,
	"pricebook_item_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255),
	"password_hash" text,
	"name" varchar(160) NOT NULL,
	"role" varchar(32) DEFAULT 'owner' NOT NULL,
	"is_guest" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engineering_reviews" ADD CONSTRAINT "engineering_reviews_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_snapshots" ADD CONSTRAINT "estimate_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_items" ADD CONSTRAINT "price_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_items" ADD CONSTRAINT "price_items_reference_id_source_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."source_references"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_editions" ADD CONSTRAINT "pricebook_editions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_editions" ADD CONSTRAINT "pricebook_editions_reference_id_source_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."source_references"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_edition_id_pricebook_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."pricebook_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_reference_id_source_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."source_references"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_items" ADD CONSTRAINT "takeoff_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_items" ADD CONSTRAINT "takeoff_items_document_id_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."project_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takeoff_items" ADD CONSTRAINT "takeoff_items_price_id_price_items_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."price_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_owner_idx" ON "audit_logs" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "reviews_owner_subject_idx" ON "engineering_reviews" USING btree ("owner_id","subject_type","subject_key");--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_project_version_unique" ON "estimate_snapshots" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "prices_owner_idx" ON "price_items" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "editions_owner_idx" ON "pricebook_editions" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pricebook_items_edition_code" ON "pricebook_items" USING btree ("edition_id","code");--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "project_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_owner_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_versions_owner_key_version" ON "rule_versions" USING btree ("owner_id","rule_key","version");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "references_owner_idx" ON "source_references" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "takeoffs_project_idx" ON "takeoff_items" USING btree ("project_id");