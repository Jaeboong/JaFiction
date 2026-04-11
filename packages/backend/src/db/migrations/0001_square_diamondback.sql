ALTER TABLE "devices" ALTER COLUMN "workspace_root" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "hostname" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "os" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "runner_version" text;
