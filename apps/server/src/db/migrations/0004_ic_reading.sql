ALTER TABLE "persons" ADD COLUMN "ic_encrypted" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "ic_last4" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "ic_name" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "ic_encrypted" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "ic_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "ic_encrypted" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "ic_name" text;