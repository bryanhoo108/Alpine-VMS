ALTER TYPE "public"."outbox_status" ADD VALUE 'superseded';--> statement-breakpoint
ALTER TABLE "sap_writes" ADD COLUMN "trip_id" uuid;--> statement-breakpoint
ALTER TABLE "sap_writes" ADD CONSTRAINT "sap_writes_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;