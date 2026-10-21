CREATE TYPE "public"."alert_level" AS ENUM('amber', 'red', 'logged');--> statement-breakpoint
CREATE TYPE "public"."camera" AS ENUM('entry', 'exit');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('free', 'issued', 'lost');--> statement-breakpoint
CREATE TYPE "public"."checker_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."do_link_source" AS ENUM('auto', 'clerk');--> statement-breakpoint
CREATE TYPE "public"."do_link_state" AS ENUM('linked', 'unlinked');--> statement-breakpoint
CREATE TYPE "public"."exit_level" AS ENUM('green', 'amber', 'red');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."photo_kind" AS ENUM('plate', 'ic', 'document', 'load');--> statement-breakpoint
CREATE TYPE "public"."reject_reason" AS ENUM('wrong_item', 'wrong_quantity', 'damaged', 'other');--> statement-breakpoint
CREATE TYPE "public"."sdo_link_source" AS ENUM('pre_registration', 'clerk');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('on_site', 'closed');--> statement-breakpoint
CREATE TYPE "public"."trip_type" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('guard', 'clerk', 'checker', 'supervisor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."watch_kind" AS ENUM('plate', 'transporter');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"trip_id" uuid,
	"type" text NOT NULL,
	"level" "alert_level" NOT NULL,
	"detail" jsonb,
	"notify" text[] NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"cleared_by" uuid,
	"clear_reason" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"card_no" text NOT NULL,
	"status" "card_status" DEFAULT 'free' NOT NULL,
	"current_trip_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checker_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"checker_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decision" "checker_decision" NOT NULL,
	"reason" "reject_reason",
	"note" text,
	"line_checks" jsonb NOT NULL,
	"sdo_snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cwis_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "do_cache" (
	"site_id" uuid NOT NULL,
	"do_no" text NOT NULL,
	"customer_code" text NOT NULL,
	"sap_created_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "do_cache_site_id_do_no_pk" PRIMARY KEY("site_id","do_no")
);
--> statement-breakpoint
CREATE TABLE "do_lines" (
	"site_id" uuid NOT NULL,
	"do_no" text NOT NULL,
	"line_no" integer NOT NULL,
	"item_code" text NOT NULL,
	"pieces" integer NOT NULL,
	"base_sdo_no" text,
	"base_line_no" integer,
	CONSTRAINT "do_lines_site_id_do_no_line_no_pk" PRIMARY KEY("site_id","do_no","line_no")
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text,
	"ic_last4" text,
	"transporter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"trip_id" uuid,
	"checker_decision_id" uuid,
	"kind" "photo_kind" NOT NULL,
	"path" text NOT NULL,
	"content_type" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_by" uuid,
	"delete_after" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plate_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"camera" "camera" NOT NULL,
	"plate_text" text NOT NULL,
	"confidence" real NOT NULL,
	"photo_id" uuid,
	"read_at" timestamp with time zone NOT NULL,
	"trip_id" uuid,
	"confirmed_plate" text,
	"corrected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pre_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"transporter_id" uuid,
	"expected_date" date NOT NULL,
	"sdo_nos" text[] NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"arrived_trip_id" uuid,
	"cleared_at" timestamp with time zone,
	"cleared_by" uuid,
	"clear_reason" text
);
--> statement-breakpoint
CREATE TABLE "sap_writes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"do_no" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"udfs" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sdo_cache" (
	"site_id" uuid NOT NULL,
	"sdo_no" text NOT NULL,
	"customer_code" text NOT NULL,
	"customer_name" text NOT NULL,
	"status" text NOT NULL,
	"doc_date" timestamp with time zone NOT NULL,
	"sap_updated_at" timestamp with time zone NOT NULL,
	"version" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sdo_cache_site_id_sdo_no_pk" PRIMARY KEY("site_id","sdo_no")
);
--> statement-breakpoint
CREATE TABLE "sdo_lines" (
	"site_id" uuid NOT NULL,
	"sdo_no" text NOT NULL,
	"line_no" integer NOT NULL,
	"item_code" text NOT NULL,
	"description" text NOT NULL,
	"size" text NOT NULL,
	"spec" text NOT NULL,
	"length" text NOT NULL,
	"pieces" integer NOT NULL,
	CONSTRAINT "sdo_lines_site_id_sdo_no_line_no_pk" PRIMARY KEY("site_id","sdo_no","line_no")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL,
	CONSTRAINT "sites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "transporters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sap_bp_code" text,
	"lost_card_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_dos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"do_no" text NOT NULL,
	"source" "do_link_source" NOT NULL,
	"state" "do_link_state" DEFAULT 'linked' NOT NULL,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_sdos" (
	"site_id" uuid NOT NULL,
	"trip_id" uuid NOT NULL,
	"sdo_no" text NOT NULL,
	"source" "sdo_link_source" NOT NULL,
	"linked_by" uuid,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sdo_version_at_link" text,
	CONSTRAINT "trip_sdos_trip_id_sdo_no_pk" PRIMARY KEY("trip_id","sdo_no")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"trip_no" text NOT NULL,
	"type" "trip_type" NOT NULL,
	"status" "trip_status" DEFAULT 'on_site' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"plate_in" text NOT NULL,
	"plate_out" text,
	"transporter_id" uuid,
	"driver_id" uuid,
	"card_id" uuid,
	"pre_registration_id" uuid,
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"pin_hash" text,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"transporter_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"kind" "watch_kind" NOT NULL,
	"value" text NOT NULL,
	"reason" text NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "weigh_tickets" (
	"site_id" uuid NOT NULL,
	"ticket_no" text NOT NULL,
	"trip_id" uuid,
	"plate" text NOT NULL,
	"sdo_no" text,
	"transporter_name" text,
	"vms_trip_no" text,
	"weigh_in_at" timestamp with time zone,
	"weigh_out_at" timestamp with time zone,
	"cwis_updated_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weigh_tickets_site_id_ticket_no_pk" PRIMARY KEY("site_id","ticket_no")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_current_trip_id_trips_id_fk" FOREIGN KEY ("current_trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checker_decisions" ADD CONSTRAINT "checker_decisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checker_decisions" ADD CONSTRAINT "checker_decisions_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checker_decisions" ADD CONSTRAINT "checker_decisions_checker_id_users_id_fk" FOREIGN KEY ("checker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cwis_pushes" ADD CONSTRAINT "cwis_pushes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cwis_pushes" ADD CONSTRAINT "cwis_pushes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_cache" ADD CONSTRAINT "do_cache_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "do_lines" ADD CONSTRAINT "do_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_checker_decision_id_checker_decisions_id_fk" FOREIGN KEY ("checker_decision_id") REFERENCES "public"."checker_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate_reads" ADD CONSTRAINT "plate_reads_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate_reads" ADD CONSTRAINT "plate_reads_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plate_reads" ADD CONSTRAINT "plate_reads_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_arrived_trip_id_trips_id_fk" FOREIGN KEY ("arrived_trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_registrations" ADD CONSTRAINT "pre_registrations_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sap_writes" ADD CONSTRAINT "sap_writes_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdo_cache" ADD CONSTRAINT "sdo_cache_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sdo_lines" ADD CONSTRAINT "sdo_lines_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transporters" ADD CONSTRAINT "transporters_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_dos" ADD CONSTRAINT "trip_dos_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_dos" ADD CONSTRAINT "trip_dos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_dos" ADD CONSTRAINT "trip_dos_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_sdos" ADD CONSTRAINT "trip_sdos_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_sdos" ADD CONSTRAINT "trip_sdos_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_sdos" ADD CONSTRAINT "trip_sdos_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_persons_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_pre_registration_id_pre_registrations_id_fk" FOREIGN KEY ("pre_registration_id") REFERENCES "public"."pre_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_gate_in_by_users_id_fk" FOREIGN KEY ("gate_in_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_gate_out_by_users_id_fk" FOREIGN KEY ("gate_out_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_transporter_id_transporters_id_fk" FOREIGN KEY ("transporter_id") REFERENCES "public"."transporters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weigh_tickets" ADD CONSTRAINT "weigh_tickets_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weigh_tickets" ADD CONSTRAINT "weigh_tickets_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_site_open" ON "alerts" USING btree ("site_id","cleared_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_site_card_no" ON "cards" USING btree ("site_id","card_no");--> statement-breakpoint
CREATE INDEX "checker_decisions_trip" ON "checker_decisions" USING btree ("trip_id","decided_at");--> statement-breakpoint
CREATE INDEX "cwis_pushes_due" ON "cwis_pushes" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "do_lines_site_base_sdo" ON "do_lines" USING btree ("site_id","base_sdo_no");--> statement-breakpoint
CREATE INDEX "plate_reads_site_read_at" ON "plate_reads" USING btree ("site_id","read_at");--> statement-breakpoint
CREATE INDEX "pre_registrations_site_plate" ON "pre_registrations" USING btree ("site_id","plate");--> statement-breakpoint
CREATE UNIQUE INDEX "sap_writes_site_key" ON "sap_writes" USING btree ("site_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "sap_writes_due" ON "sap_writes" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transporters_site_bp" ON "transporters" USING btree ("site_id","sap_bp_code");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_dos_trip_do" ON "trip_dos" USING btree ("trip_id","do_no");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_dos_one_claim" ON "trip_dos" USING btree ("site_id","do_no") WHERE "trip_dos"."state" = 'linked';--> statement-breakpoint
CREATE UNIQUE INDEX "trips_site_trip_no" ON "trips" USING btree ("site_id","trip_no");--> statement-breakpoint
CREATE INDEX "trips_site_status" ON "trips" USING btree ("site_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_site_username" ON "users" USING btree ("site_id","username");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_site_plate" ON "vehicles" USING btree ("site_id","plate");--> statement-breakpoint
CREATE INDEX "weigh_tickets_trip" ON "weigh_tickets" USING btree ("trip_id");