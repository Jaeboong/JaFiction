CREATE TABLE "device_users" (
	"device_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_users_device_id_user_id_pk" PRIMARY KEY("device_id","user_id")
);
--> statement-breakpoint
INSERT INTO "device_users" ("device_id", "user_id")
SELECT "id", "user_id" FROM "devices"
WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "device_users" ADD CONSTRAINT "device_users_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_users" ADD CONSTRAINT "device_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "user_id";
