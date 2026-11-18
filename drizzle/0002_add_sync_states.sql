CREATE TABLE "pricebook_sync_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"edition_id" uuid,
	"reference_id" uuid,
	"source_url" text,
	"last_checked_at" timestamp with time zone,
	"last_remote_hash" varchar(128),
	"last_remote_modified" varchar(120),
	"etag" varchar(200),
	"update_available" boolean DEFAULT false NOT NULL,
	"auto_check_enabled" boolean DEFAULT true NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pricebook_sync_states" ADD CONSTRAINT "pricebook_sync_states_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_sync_states" ADD CONSTRAINT "pricebook_sync_states_edition_id_pricebook_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."pricebook_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_sync_states" ADD CONSTRAINT "pricebook_sync_states_reference_id_source_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."source_references"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_owner_idx" ON "pricebook_sync_states" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_edition_unique" ON "pricebook_sync_states" USING btree ("edition_id");