CREATE TABLE "progress_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"period" varchar(160) NOT NULL,
	"rows" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"notes" text,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_snapshot_id_estimate_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."estimate_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_reports" ADD CONSTRAINT "progress_reports_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "progress_snapshot_sequence_unique" ON "progress_reports" USING btree ("snapshot_id","sequence");--> statement-breakpoint
CREATE INDEX "progress_snapshot_idx" ON "progress_reports" USING btree ("snapshot_id");