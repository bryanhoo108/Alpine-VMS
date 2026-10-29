CREATE TYPE "public"."visit_type" AS ENUM('visitor', 'contractor');--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"department" text,
	"phone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" "visit_type" NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"phone" text,
	"group_size" integer DEFAULT 1 NOT NULL,
	"host_id" uuid NOT NULL,
	"purpose" text,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"until_time" text,
	"plate" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid
);
--> statement-breakpoint
CREATE TABLE "muster_marks" (
	"site_id" uuid NOT NULL,
	"muster_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"marked_at" timestamp with time zone NOT NULL,
	"marked_by" uuid NOT NULL,
	CONSTRAINT "muster_marks_muster_id_entry_id_pk" PRIMARY KEY("muster_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "musters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"started_by" uuid NOT NULL,
	"roll" jsonb NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid
);
--> statement-breakpoint
CREATE TABLE "staff_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"camera" "camera" NOT NULL,
	"plate" text NOT NULL,
	"plate_read_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"logged_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"visit_no" text NOT NULL,
	"type" "visit_type" NOT NULL,
	"status" "trip_status" DEFAULT 'on_site' NOT NULL,
	"invite_id" uuid,
	"name" text NOT NULL,
	"company" text,
	"phone" text,
	"group_size" integer NOT NULL,
	"ic_last4" text,
	"host_id" uuid,
	"host_confirmed" boolean NOT NULL,
	"plate" text,
	"card_id" uuid,
	"expected_until" timestamp with time zone,
	"gate_in_at" timestamp with time zone NOT NULL,
	"gate_in_by" uuid NOT NULL,
	"gate_out_at" timestamp with time zone,
	"gate_out_by" uuid,
	"exit_level" "exit_level",
	"exit_reasons" jsonb,
	"card_returned" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "current_visit_id" uuid;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "plate_reads" ADD COLUMN "handled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muster_marks" ADD CONSTRAINT "muster_marks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muster_marks" ADD CONSTRAINT "muster_marks_muster_id_musters_id_fk" FOREIGN KEY ("muster_id") REFERENCES "public"."musters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "muster_marks" ADD CONSTRAINT "muster_marks_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "musters" ADD CONSTRAINT "musters_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "musters" ADD CONSTRAINT "musters_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "musters" ADD CONSTRAINT "musters_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_entries" ADD CONSTRAINT "staff_entries_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_entries" ADD CONSTRAINT "staff_entries_plate_read_id_plate_reads_id_fk" FOREIGN KEY ("plate_read_id") REFERENCES "public"."plate_reads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_entries" ADD CONSTRAINT "staff_entries_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_gate_in_by_users_id_fk" FOREIGN KEY ("gate_in_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_gate_out_by_users_id_fk" FOREIGN KEY ("gate_out_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_site_code" ON "invites" USING btree ("site_id","code");--> statement-breakpoint
CREATE INDEX "musters_site_started" ON "musters" USING btree ("site_id","started_at");--> statement-breakpoint
CREATE INDEX "staff_entries_site_at" ON "staff_entries" USING btree ("site_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_site_visit_no" ON "visits" USING btree ("site_id","visit_no");--> statement-breakpoint
CREATE INDEX "visits_site_status" ON "visits" USING btree ("site_id","status");--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_current_visit_id_visits_id_fk" FOREIGN KEY ("current_visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;